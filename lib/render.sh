# shellcheck shell=bash

# Output normalization and presentation helpers.
if [[ -n "${ITTE_RENDER_LOADED:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi
ITTE_RENDER_LOADED=1

normalize_summary_json() {
  local raw="$1"
  local cleaned candidate

  cleaned="$(printf "%s" "$raw" | sed -e '1s/^```json[[:space:]]*//' -e '1s/^```[[:space:]]*//' -e '$s/[[:space:]]*```$//')"
  candidate="$(trim "$cleaned")"

  if jq -e . >/dev/null 2>&1 <<<"$candidate"; then
    jq '{
      scene: (.scene // "General conversation"),
      intents: ((.intents // []) | map(tostring) | map(select(length > 0)) | .[:3]),
      useful_expressions: ((.useful_expressions // []) | map(tostring) | map(select(length > 0)) | .[:3]),
      try_next_time: (.try_next_time // "I can see the benefits, but I still need more practice.")
    }' <<<"$candidate"
    return 0
  fi

  fallback_summary_json
}

contains_cjk() {
  local text="$1"
  if grep -qE '[一-龯ぁ-ゟ゠-ヿ㐀-䶿]' <<<"$text"; then
    return 0
  fi
  return 1
}

unwrap_json_block() {
  local raw="$1"
  printf "%s" "$raw" \
    | sed -e '1s/^```json[[:space:]]*//' -e '1s/^```[[:space:]]*//' -e '$s/[[:space:]]*```$//'
}

strip_basic_markdown() {
  local raw="$1"
  printf "%s" "$raw" \
    | sed -E 's/\*\*([^*]+)\*\*/\1/g' \
    | sed -E 's/`([^`]+)`/\1/g' \
    | sed -E 's/\r//g'
}

looks_like_metadata_label_line() {
  local line="$1"
  local trimmed
  trimmed="$(trim "$line")"
  if [[ -z "$trimmed" ]]; then
    return 1
  fi
  if printf "%s" "$trimmed" | grep -Eq '^[[:space:]*-]*([[:digit:]]+[.)][[:space:]]*)?[A-Za-z一-龯][A-Za-z0-9一-龯[:space:]_/\-]{0,24}[:：][[:space:]]*$'; then
    return 0
  fi
  return 1
}

clean_metadata_text() {
  local raw="$1"
  local cleaned inline_count

  cleaned="$(strip_basic_markdown "$raw")"

  # Remove label-only metadata lines, e.g. "Round 1:" or "English:"
  cleaned="$(
    while IFS= read -r line || [[ -n "$line" ]]; do
      if looks_like_metadata_label_line "$line"; then
        continue
      fi
      printf "%s\n" "$line"
    done <<<"$cleaned"
  )"

  # If multiple short label-prefix lines appear, treat them as metadata wrappers and strip prefixes.
  inline_count="$(printf "%s" "$cleaned" | grep -Ec '^[[:space:]]*[-*]?[[:space:]]*([[:digit:]]+[.)][[:space:]]*)?[A-Za-z一-龯][A-Za-z0-9一-龯[:space:]_/\-]{0,20}[[:space:]]*[:：][[:space:]]+.+$' || true)"
  if [[ -n "$inline_count" && "$inline_count" -ge 2 ]]; then
    cleaned="$(printf "%s" "$cleaned" | sed -E 's/^[[:space:]]*[-*]?[[:space:]]*([[:digit:]]+[.)][[:space:]]*)?[A-Za-z一-龯][A-Za-z0-9一-龯[:space:]_/\-]{0,20}[[:space:]]*[:：][[:space:]]+//')"
  fi

  printf "%s" "$(trim "$cleaned")"
}

paragraphize_text() {
  local raw="$1"
  printf "%s" "$raw" | awk '
    function flush_para(    text, norm, n, i, count, buf, sent, ending, out) {
      if (para == "") return
      text = para
      gsub(/\n+/, " ", text)
      gsub(/[[:space:]]+/, " ", text)
      sub(/^[[:space:]]+/, "", text)
      sub(/[[:space:]]+$/, "", text)
      if (length(text) <= 180) {
        print text
        para = ""
        return
      }

      norm = text
      gsub(/([.!?。！？]["'\''”’）】」』]*)([[:space:]]+)/, "\\1\n", norm)
      n = split(norm, arr, /\n+/)
      count = 0
      buf = ""
      for (i = 1; i <= n; i++) {
        sent = arr[i]
        sub(/^[[:space:]]+/, "", sent)
        sub(/[[:space:]]+$/, "", sent)
        if (sent == "") continue
        if (buf == "") {
          buf = sent
          count = 1
        } else {
          ending = substr(buf, length(buf), 1)
          if (count >= 2 || length(buf " " sent) > 180) {
            out = out (out == "" ? "" : "\n\n") buf
            buf = sent
            count = 1
          } else {
            buf = buf " " sent
            count++
          }
        }
      }
      if (buf != "") out = out (out == "" ? "" : "\n\n") buf
      print out
      para = ""
    }

    BEGIN { para = ""; first = 1 }
    {
      line = $0
      if (line ~ /^[[:space:]]*$/) {
        flush_para()
        print ""
        next
      }
      para = (para == "" ? line : para "\n" line)
    }
    END {
      flush_para()
    }
  ' | awk '
    BEGIN { blank = 0 }
    {
      if ($0 ~ /^[[:space:]]*$/) {
        blank++
        if (blank <= 1) print ""
        next
      }
      blank = 0
      print $0
    }
  '
}

soft_wrap_for_tty() {
  local raw="$1"
  local cols
  if [[ ! -t 1 ]]; then
    printf "%s" "$raw"
    return 0
  fi

  cols="${COLUMNS:-}"
  if [[ -z "$cols" || ! "$cols" =~ ^[0-9]+$ || "$cols" -lt 40 ]]; then
    cols="$(tput cols 2>/dev/null || echo 80)"
  fi
  if [[ -z "$cols" || ! "$cols" =~ ^[0-9]+$ || "$cols" -lt 40 ]]; then
    cols=80
  fi

  printf "%s" "$raw" | fold -s -w "$cols"
}

format_assistant_text() {
  local raw="$1"
  local cleaned paragraphized
  cleaned="$(clean_metadata_text "$raw")"
  paragraphized="$(paragraphize_text "$cleaned")"
  soft_wrap_for_tty "$paragraphized"
}

language_pair_to_text() {
  local json="$1"
  local path="$2"
  local en zh

  en="$(jq -r "$path.en // empty" <<<"$json" 2>/dev/null || true)"
  zh="$(jq -r "$path.zh // empty" <<<"$json" 2>/dev/null || true)"
  en="$(trim "$en")"
  zh="$(trim "$zh")"

  if [[ "$ITTE_BILINGUAL_ASSIST" == "1" && -n "$en" && -n "$zh" ]]; then
    printf "%s\n\n%s" "$en" "$zh"
    return 0
  fi

  if [[ -n "$en" ]]; then
    printf "%s" "$en"
    return 0
  fi
  if [[ -n "$zh" ]]; then
    printf "%s" "$zh"
    return 0
  fi
  printf ""
}

normalize_bilingual_block() {
  local raw="$1"
  local cleaned english chinese

  cleaned="$(printf "%s" "$raw" \
    | sed -E 's/\*\*([^*]+)\*\*/\1/g' \
    | sed -E 's/`([^`]+)`/\1/g' \
    | sed -E 's/\r//g')"

  cleaned="$(printf "%s" "$cleaned" \
    | sed -E 's/[[:space:]]*([Ee][Nn][Gg][Ll][Ii][Ss][Hh]|英文|英语)[[:space:]]*[:：][[:space:]]*/\nEnglish:\n/g' \
    | sed -E 's/[[:space:]]*([Cc][Hh][Ii][Nn][Ee][Ss][Ee]|中文|汉语)[[:space:]]*[:：][[:space:]]*/\nChinese:\n/g')"

  english="$(
    awk '
      BEGIN { sec=0 }
      {
        lower=tolower($0)
        if (lower ~ /^[[:space:]]*english[[:space:]]*:[[:space:]]*$/) {
          sec=1
          next
        }
        if (lower ~ /^[[:space:]]*chinese[[:space:]]*:[[:space:]]*$/) {
          sec=2
          next
        }
        if (sec==1) print $0
      }
    ' <<<"$cleaned"
  )"

  chinese="$(
    awk '
      BEGIN { sec=0 }
      {
        lower=tolower($0)
        if (lower ~ /^[[:space:]]*chinese[[:space:]]*:[[:space:]]*$/) {
          sec=2
          next
        }
        if (lower ~ /^[[:space:]]*english[[:space:]]*:[[:space:]]*$/) {
          sec=1
          next
        }
        if (sec==2) print $0
      }
    ' <<<"$cleaned"
  )"

  english="$(trim "$english")"
  chinese="$(trim "$chinese")"

  if [[ -n "$english" && -n "$chinese" ]]; then
    printf "%s\n\n%s" "$english" "$chinese"
    return 0
  fi

  printf "%s" "$(trim "$(printf "%s" "$cleaned" | sed -E \
    '/^[[:space:]]*([Ee][Nn][Gg][Ll][Ii][Ss][Hh]|[Cc][Hh][Ii][Nn][Ee][Ss][Ee]|英文|英语|中文|汉语)[[:space:]]*[:：][[:space:]]*$/d')")"
}

normalize_help_text() {
  local raw="$1"
  local candidate cleaned logic_part continue_part

  candidate="$(trim "$(unwrap_json_block "$raw")")"
  if jq -e . >/dev/null 2>&1 <<<"$candidate"; then
    logic_part="$(language_pair_to_text "$candidate" '.translation_logic')"
    continue_part="$(language_pair_to_text "$candidate" '.continue_topic')"
    logic_part="$(trim "$logic_part")"
    continue_part="$(trim "$continue_part")"
    if [[ -n "$logic_part" || -n "$continue_part" ]]; then
      [[ -z "$logic_part" ]] && logic_part="I will keep it simple: first understand your meaning, then choose natural English words, then form one clear sentence."
      [[ -z "$continue_part" ]] && continue_part="Thanks for sharing. Can you tell me one more detail so I can help you say it naturally?"
      printf "Translation Logic:\n%s\n\nContinue the topic:\n%s" "$logic_part" "$continue_part"
      return 0
    fi
  fi

  cleaned="$(strip_basic_markdown "$raw")"

  logic_part="$(
    awk '
      BEGIN { sec=0 }
      {
        lower=tolower($0)
        if (lower ~ /^translation logic[[:space:]]*:/) {
          sec=1
          sub(/^[^:]*:[[:space:]]*/, "", $0)
          if (length($0) > 0) print $0
          next
        }
        if (lower ~ /^continue( the)? topic[[:space:]]*:/) {
          sec=2
          next
        }
        if (sec==1) print $0
      }
    ' <<<"$cleaned"
  )"

  continue_part="$(
    awk '
      BEGIN { sec=0 }
      {
        lower=tolower($0)
        if (lower ~ /^continue( the)? topic[[:space:]]*:/) {
          sec=2
          sub(/^[^:]*:[[:space:]]*/, "", $0)
          if (length($0) > 0) print $0
          next
        }
        if (lower ~ /^translation logic[[:space:]]*:/) {
          sec=1
          next
        }
        if (sec==2) print $0
      }
    ' <<<"$cleaned"
  )"

  logic_part="$(trim "$logic_part")"
  continue_part="$(trim "$continue_part")"

  # Fallback if labels are missing: split by first blank line.
  if [[ -z "$logic_part" || -z "$continue_part" ]]; then
    if [[ "$cleaned" == *$'\n\n'* ]]; then
      logic_part="$(trim "${cleaned%%$'\n\n'*}")"
      continue_part="$(trim "${cleaned#*$'\n\n'}")"
    else
      logic_part="$(trim "$cleaned")"
      continue_part=""
    fi
  fi

  if [[ -z "$logic_part" ]]; then
    logic_part="I will keep it simple: first understand your meaning, then choose natural English words, then form one clear sentence."
  fi
  if [[ -z "$continue_part" ]]; then
    continue_part="Thanks for sharing. Can you tell me one more detail so I can help you say it naturally?"
  fi

  printf "Translation Logic:\n%s\n\nContinue the topic:\n%s" "$logic_part" "$continue_part"
}

help_continue_body() {
  local normalized="$1"
  awk '
    BEGIN { sec=0 }
    {
      lower=tolower($0)
      if (lower ~ /^continue( the)? topic[[:space:]]*:/) {
        sec=1
        next
      }
      if (sec==1) print $0
    }
  ' <<<"$normalized"
}

help_logic_body() {
  local normalized="$1"
  awk '
    BEGIN { sec=0 }
    {
      lower=tolower($0)
      if (lower ~ /^translation logic[[:space:]]*:/) {
        sec=1
        next
      }
      if (lower ~ /^continue( the)? topic[[:space:]]*:/) {
        sec=2
        next
      }
      if (sec==1) print $0
    }
  ' <<<"$normalized"
}

print_help_output() {
  local normalized="$1"
  local logic_body continue_body
  local topic_color_code
  local reset="\033[0m"

  logic_body="$(trim "$(help_logic_body "$normalized")")"
  continue_body="$(trim "$(help_continue_body "$normalized")")"
  logic_body="$(format_assistant_text "$logic_body")"
  continue_body="$(format_assistant_text "$continue_body")"
  topic_color_code="$(ansi_for_color_name "$ITTE_TOPIC_COLOR")"

  echo "Translation Logic:"
  echo "$logic_body"
  echo
  echo "Continue the topic:"
  if [[ -t 1 ]]; then
    if [[ -n "$topic_color_code" ]]; then
      printf "%b%s%b\n" "$topic_color_code" "$continue_body" "$reset"
    else
      echo "$continue_body"
    fi
  else
    echo "$continue_body"
  fi
}

normalize_vibe_text() {
  local raw="$1"
  local candidate cleaned scene_part dialogue_part

  candidate="$(trim "$(unwrap_json_block "$raw")")"
  if jq -e . >/dev/null 2>&1 <<<"$candidate"; then
    scene_part="$(language_pair_to_text "$candidate" '.scene_setup')"
    dialogue_part="$(language_pair_to_text "$candidate" '.dialogue')"
    scene_part="$(trim "$scene_part")"
    dialogue_part="$(trim "$dialogue_part")"
    if [[ -n "$scene_part" || -n "$dialogue_part" ]]; then
      [[ -z "$scene_part" ]] && scene_part="Two coworkers are rushing to finish a project before a tight deadline. They need to align quickly and decide what to prioritize."
      [[ -z "$dialogue_part" ]] && dialogue_part="As the project lead, I need us to lock the must-have tasks now so we can ship safely today."
      dialogue_part="$(normalize_vibe_dialogue "$dialogue_part")"
      printf "Scene Setup:\n%s\n\nDialogue:\n%s" "$scene_part" "$dialogue_part"
      return 0
    fi
  fi

  cleaned="$(strip_basic_markdown "$raw")"

  scene_part="$(
    awk '
      BEGIN { sec=0 }
      {
        lower=tolower($0)
        if (lower ~ /^scene setup[[:space:]]*:/) {
          sec=1
          sub(/^[^:]*:[[:space:]]*/, "", $0)
          if (length($0) > 0) print $0
          next
        }
        if (lower ~ /^dialogue[[:space:]]*:/) {
          sec=2
          next
        }
        if (sec==1) print $0
      }
    ' <<<"$cleaned"
  )"

  dialogue_part="$(
    awk '
      BEGIN { sec=0 }
      {
        lower=tolower($0)
        if (lower ~ /^dialogue[[:space:]]*:/) {
          sec=2
          sub(/^[^:]*:[[:space:]]*/, "", $0)
          if (length($0) > 0) print $0
          next
        }
        if (lower ~ /^scene setup[[:space:]]*:/) {
          sec=1
          next
        }
        if (sec==2) print $0
      }
    ' <<<"$cleaned"
  )"

  scene_part="$(trim "$scene_part")"
  dialogue_part="$(trim "$dialogue_part")"

  if [[ -z "$scene_part" || -z "$dialogue_part" ]]; then
    if [[ "$cleaned" == *$'\n\n'* ]]; then
      scene_part="$(trim "${cleaned%%$'\n\n'*}")"
      dialogue_part="$(trim "${cleaned#*$'\n\n'}")"
    else
      scene_part="$(trim "$cleaned")"
      dialogue_part=""
    fi
  fi

  if [[ -z "$scene_part" ]]; then
    scene_part="Two coworkers are rushing to finish a project before a tight deadline. They need to align quickly and decide what to prioritize."
  fi
  if [[ -z "$dialogue_part" ]]; then
    dialogue_part="As the project lead, I need us to lock the must-have tasks now so we can ship safely today."
  fi

  dialogue_part="$(normalize_vibe_dialogue "$dialogue_part")"

  printf "Scene Setup:\n%s\n\nDialogue:\n%s" "$scene_part" "$dialogue_part"
}

first_sentence_compact() {
  local text="$1"
  local compact

  compact="$(printf "%s" "$text" | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/^[[:space:]]+//; s/[[:space:]]+$//')"
  compact="$(printf "%s" "$compact" | sed -E 's/^["'"'"'“”‘’]+//; s/["'"'"'“”‘’]+$//')"
  compact="$(printf "%s" "$compact" | sed -E 's/^([^.!?。！？]*[.!?。！？]).*$/\1/')"
  printf "%s" "$compact"
}

normalize_vibe_dialogue() {
  local dialogue="$1"
  local english chinese one head tail

  if grep -qiE '^[[:space:]]*(English|Chinese)[[:space:]]*[:：]' <<<"$dialogue" \
    || grep -qE '^[[:space:]]*(英文|英语|中文|汉语)[[:space:]]*[:：]' <<<"$dialogue"; then
    english="$(
      awk '
        BEGIN { sec=0 }
        {
          lower=tolower($0)
          if (lower ~ /^[[:space:]]*english[[:space:]]*[:：]/ || $0 ~ /^[[:space:]]*(英文|英语)[[:space:]]*[:：]/) {
            sec=1
            sub(/^[^:：]*[:：][[:space:]]*/, "", $0)
            if (length($0) > 0) print $0
            next
          }
          if (lower ~ /^[[:space:]]*chinese[[:space:]]*[:：]/ || $0 ~ /^[[:space:]]*(中文|汉语)[[:space:]]*[:：]/) {
            sec=2
            next
          }
          if (sec==1) print $0
        }
      ' <<<"$dialogue"
    )"
    chinese="$(
      awk '
        BEGIN { sec=0 }
        {
          lower=tolower($0)
          if (lower ~ /^[[:space:]]*chinese[[:space:]]*[:：]/ || $0 ~ /^[[:space:]]*(中文|汉语)[[:space:]]*[:：]/) {
            sec=2
            sub(/^[^:：]*[:：][[:space:]]*/, "", $0)
            if (length($0) > 0) print $0
            next
          }
          if (lower ~ /^[[:space:]]*english[[:space:]]*[:：]/ || $0 ~ /^[[:space:]]*(英文|英语)[[:space:]]*[:：]/) {
            sec=1
            next
          }
          if (sec==2) print $0
        }
      ' <<<"$dialogue"
    )"

    english="$(first_sentence_compact "$english")"
    chinese="$(first_sentence_compact "$chinese")"
    if [[ -z "$english" ]]; then
      english="As the project lead, I want us to finish the key tasks first so we can launch on time."
    fi
    if [[ -z "$chinese" ]]; then
      chinese="作为项目负责人，我希望我们先完成关键任务，这样今天就能按时上线。"
    fi
    printf "%s\n\n%s" "$english" "$chinese"
    return 0
  fi

  if [[ "$ITTE_BILINGUAL_ASSIST" == "1" && "$dialogue" == *$'\n\n'* ]]; then
    head="$(trim "${dialogue%%$'\n\n'*}")"
    tail="$(trim "${dialogue#*$'\n\n'}")"
    if [[ -n "$head" && -n "$tail" ]] && contains_cjk "$tail"; then
      english="$(first_sentence_compact "$head")"
      chinese="$(first_sentence_compact "$tail")"
      if [[ -z "$english" ]]; then
        english="As the project lead, I want us to finish the key tasks first so we can launch on time."
      fi
      if [[ -z "$chinese" ]]; then
        chinese="作为项目负责人，我希望我们先完成关键任务，这样今天就能按时上线。"
      fi
      printf "%s\n\n%s" "$english" "$chinese"
      return 0
    fi
  fi

  if [[ "$ITTE_BILINGUAL_ASSIST" == "1" ]]; then
    english="$(first_sentence_compact "$dialogue")"
    chinese="作为项目负责人，我希望我们先完成关键任务，这样今天就能按时上线。"
    if [[ -z "$english" ]]; then
      english="As the project lead, I want us to focus on the core tasks first so we can deliver on time."
    fi
    printf "%s\n\n%s" "$english" "$chinese"
    return 0
  fi

  one="$(first_sentence_compact "$dialogue")"
  if [[ -z "$one" ]]; then
    one="As the project lead, I want us to focus on the core tasks first so we can deliver on time."
  fi
  printf "%s" "$one"
}

vibe_scene_body() {
  local normalized="$1"
  awk '
    BEGIN { sec=0 }
    {
      lower=tolower($0)
      if (lower ~ /^scene setup[[:space:]]*:/) {
        sec=1
        next
      }
      if (lower ~ /^dialogue[[:space:]]*:/) {
        sec=2
        next
      }
      if (sec==1) print $0
    }
  ' <<<"$normalized"
}

vibe_dialogue_body() {
  local normalized="$1"
  awk '
    BEGIN { sec=0 }
    {
      lower=tolower($0)
      if (lower ~ /^dialogue[[:space:]]*:/) {
        sec=1
        next
      }
      if (sec==1) print $0
    }
  ' <<<"$normalized"
}

print_vibe_output() {
  local normalized="$1"
  local scene_body dialogue_body topic_color_code
  local reset="\033[0m"

  scene_body="$(trim "$(vibe_scene_body "$normalized")")"
  dialogue_body="$(trim "$(vibe_dialogue_body "$normalized")")"
  scene_body="$(format_assistant_text "$scene_body")"
  dialogue_body="$(format_assistant_text "$dialogue_body")"
  topic_color_code="$(ansi_for_color_name "$ITTE_TOPIC_COLOR")"

  echo "Scene Setup:"
  echo "$scene_body"
  echo
  echo "Dialogue:"
  if [[ -t 1 ]]; then
    if [[ -n "$topic_color_code" ]]; then
      printf "%b%s%b\n" "$topic_color_code" "$dialogue_body" "$reset"
    else
      echo "$dialogue_body"
    fi
  else
    echo "$dialogue_body"
  fi
}

print_summary() {
  local summary_json="$1"
  local scene intents useful try_next i
  scene="$(jq -r '.scene' <<<"$summary_json")"
  try_next="$(jq -r '.try_next_time' <<<"$summary_json")"

  echo "Session Summary"
  echo
  echo "Scene:"
  echo "$scene"
  echo
  echo "Intent:"
  intents="$(jq -r '.intents[]?' <<<"$summary_json")"
  if [[ -n "$intents" ]]; then
    while IFS= read -r i; do
      [[ -n "$i" ]] && echo "- $i"
    done <<<"$intents"
  else
    echo "- sharing opinions"
  fi
  echo
  echo "Useful Expressions:"
  useful="$(jq -r '.useful_expressions[]?' <<<"$summary_json")"
  if [[ -n "$useful" ]]; then
    while IFS= read -r i; do
      [[ -n "$i" ]] && echo "- $i"
    done <<<"$useful"
  else
    echo "- I can see the benefits, but I still have concerns."
  fi
  echo
  echo "Try Next Time:"
  echo "Try saying:"
  echo "\"$try_next\""
}

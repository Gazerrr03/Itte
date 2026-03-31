# shellcheck shell=bash

# Command parsing, handlers, and main loop dispatch.
if [[ -n "${ITTE_COMMANDS_LOADED:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi
ITTE_COMMANDS_LOADED=1

is_known_slash_command() {
  local token="$1"
  case "$token" in
    /optimize|/help|/daily|/vibe|/commands|/logs|/setting)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

extract_embedded_command_token() {
  local line="$1"
  awk '
    {
      for (i = 1; i <= NF; i++) {
        if ($i == "/optimize" || $i == "/help" || $i == "/daily" || $i == "/vibe" || $i == "/commands" || $i == "/logs" || $i == "/setting") {
          print $i
          exit
        }
      }
    }
  ' <<<"$line"
}

strip_first_command_token() {
  local line="$1"
  local token="$2"
  awk -v cmd="$token" '
    {
      found = 0
      out = ""
      for (i = 1; i <= NF; i++) {
        if (!found && $i == cmd) {
          found = 1
          continue
        }
        if (out == "") out = $i
        else out = out " " $i
      }
      print out
    }
  ' <<<"$line"
}

add_input_history() {
  local line="$1"
  local last_index=-1
  local len=0

  [[ -z "$(trim "$line")" ]] && return 0

  len="${#INPUT_HISTORY[@]}"
  if (( len > 0 )); then
    last_index=$((len - 1))
    if [[ "${INPUT_HISTORY[$last_index]}" == "$line" ]]; then
      INPUT_HISTORY_POS="${#INPUT_HISTORY[@]}"
      INPUT_HISTORY_STASH=""
      return 0
    fi
  fi

  INPUT_HISTORY+=("$line")
  len="${#INPUT_HISTORY[@]}"
  if (( len > MAX_INPUT_HISTORY )); then
    INPUT_HISTORY=("${INPUT_HISTORY[@]:1}")
  fi
  INPUT_HISTORY_POS="${#INPUT_HISTORY[@]}"
  INPUT_HISTORY_STASH=""
}

history_prev_line() {
  local current="$1"
  local len="${#INPUT_HISTORY[@]}"
  if (( len == 0 )); then
    printf "%s" "$current"
    return 0
  fi

  if (( INPUT_HISTORY_POS == len )); then
    INPUT_HISTORY_STASH="$current"
  fi
  if (( INPUT_HISTORY_POS > 0 )); then
    INPUT_HISTORY_POS=$((INPUT_HISTORY_POS - 1))
  fi
  printf "%s" "${INPUT_HISTORY[$INPUT_HISTORY_POS]}"
}

history_next_line() {
  local len="${#INPUT_HISTORY[@]}"
  if (( len == 0 )); then
    printf "%s" "${1:-}"
    return 0
  fi

  if (( INPUT_HISTORY_POS < len )); then
    INPUT_HISTORY_POS=$((INPUT_HISTORY_POS + 1))
  fi
  if (( INPUT_HISTORY_POS == len )); then
    printf "%s" "$INPUT_HISTORY_STASH"
  else
    printf "%s" "${INPUT_HISTORY[$INPUT_HISTORY_POS]}"
  fi
}

render_input_preview() {
  local line="$1"
  local command_color_code=""
  local reset="\033[0m"
  local cols text_len rows i
  local prefix suffix matched lead cmd trail

  cols="${COLUMNS:-}"
  if [[ -z "$cols" || ! "$cols" =~ ^[0-9]+$ || "$cols" -le 0 ]]; then
    cols="$(tput cols 2>/dev/null || echo 80)"
  fi
  if [[ -z "$cols" || ! "$cols" =~ ^[0-9]+$ || "$cols" -le 0 ]]; then
    cols=80
  fi

  text_len=$((2 + ${#line}))
  rows=$(((text_len + cols - 1) / cols))
  if (( rows < 1 )); then
    rows=1
  fi

  # Clear previously rendered wrapped rows before painting the latest input.
  if (( PREVIEW_ROWS > 1 )); then
    for ((i = 1; i < PREVIEW_ROWS; i++)); do
      printf "\033[1A\r"
    done
  fi
  for ((i = 1; i <= PREVIEW_ROWS; i++)); do
    printf "\033[2K"
    if (( i < PREVIEW_ROWS )); then
      printf "\033[1B\r"
    fi
  done
  if (( PREVIEW_ROWS > 1 )); then
    for ((i = 1; i < PREVIEW_ROWS; i++)); do
      printf "\033[1A\r"
    done
  fi
  printf "\r"

  command_color_code="$(ansi_for_color_name "$ITTE_COMMAND_COLOR")"

  if [[ "$line" =~ (^|[[:space:]])(/optimize|/help|/daily|/vibe|/commands|/logs|/setting)([[:space:]]|$) ]]; then
    matched="${BASH_REMATCH[0]}"
    lead="${BASH_REMATCH[1]}"
    cmd="${BASH_REMATCH[2]}"
    trail="${BASH_REMATCH[3]}"
    prefix="${line%%"$matched"*}"
    suffix="${line#*"$matched"}"
    if [[ -n "$command_color_code" ]]; then
      printf "\r\033[2K> %s%s%b%s%b%s%s" "$prefix" "$lead" "$command_color_code" "$cmd" "$reset" "$trail" "$suffix"
    else
      printf "\r\033[2K> %s%s%s%s%s" "$prefix" "$lead" "$cmd" "$trail" "$suffix"
    fi
  else
    printf "\r\033[2K> %s" "$line"
  fi

  PREVIEW_ROWS="$rows"
}

read_escape_sequence_tail() {
  local seq="" ch
  local i
  # Read up to 8 bytes after ESC and stop at CSI terminator.
  for i in 1 2 3 4 5 6 7 8; do
    if ! IFS= read -rsn1 -t 1 ch; then
      break
    fi
    seq+="$ch"
    if [[ "$ch" =~ [A-Za-z~]$ ]]; then
      break
    fi
  done
  printf "%s" "$seq"
}

read_input_line() {
  local line="" ch esc_seq
  READ_INPUT_LINE_VALUE=""
  INPUT_HISTORY_POS="${#INPUT_HISTORY[@]}"
  INPUT_HISTORY_STASH=""
  PREVIEW_ROWS=1

  if [[ "$ITTE_COLOR_COMMANDS" != "1" || ! -t 0 || ! -t 1 ]]; then
    printf "> "
    if ! IFS= read -r line; then
      return 1
    fi
    READ_INPUT_LINE_VALUE="$line"
    return 0
  fi

  printf "> "
  while true; do
    if ! IFS= read -rsn1 ch; then
      echo
      return 1
    fi

    # In some terminals Enter is consumed as an empty char with `read -n1`.
    if [[ -z "$ch" ]]; then
      echo
      READ_INPUT_LINE_VALUE="$line"
      return 0
    fi

    case "$ch" in
      $'\n'|$'\r')
        echo
        READ_INPUT_LINE_VALUE="$line"
        return 0
        ;;
      $'\177'|$'\b')
        [[ -n "$line" ]] && line="${line%?}"
        ;;
      $'\004')
        if [[ -z "$line" ]]; then
          echo
          return 1
        fi
        ;;
      $'\025')
        line=""
        ;;
      $'\033')
        # Drain full escape sequence to avoid leaving trailing bytes in input buffer.
        esc_seq="$(read_escape_sequence_tail)"
        case "$esc_seq" in
          *A)
            line="$(history_prev_line "$line")"
            ;;
          *B)
            line="$(history_next_line "$line")"
            ;;
        esac
        ;;
      *)
        line+="$ch"
        ;;
    esac

    render_input_preview "$line"
  done
}

print_usage() {
  cat <<'EOF'
Usage:
  ./itte
  ./itte --help
  ./itte --version
  ./itte --install
  ./itte --uninstall

Commands in session:
  /optimize <text>   Optimize your wording naturally
  /help <text>       Scaffold a sentence when you get stuck
  /daily             Start one guided daily practice prompt
  /vibe <scene>      Generate one scene opener and dialogue
  /logs [n]          Show latest structured run logs
  /setting           Open interactive settings
  /commands          Show command list
EOF
}

install_to_user_bin() {
  local bin_dir="${HOME}/.local/bin"
  local target="${bin_dir}/itte"

  mkdir -p "$bin_dir"
  ln -sf "$SCRIPT_PATH" "$target"

  echo "Installed: $target -> $SCRIPT_PATH"
  echo
  if [[ ":${PATH}:" != *":${bin_dir}:"* ]]; then
    cat <<EOF
Your PATH does not include ${bin_dir} yet.
Add this line to ~/.zshrc (or your shell profile), then restart terminal:
  export PATH="${bin_dir}:\$PATH"
EOF
  else
    echo "You can now run: itte"
  fi
}

uninstall_from_user_bin() {
  local target="${HOME}/.local/bin/itte"
  if [[ -L "$target" || -f "$target" ]]; then
    rm -f "$target"
    echo "Removed: $target"
  else
    echo "Nothing to remove. ${target} does not exist."
  fi
}

print_welcome() {
  local line
  local banner_delay="${ITTE_BANNER_DELAY_SEC:-0.06}"
  local text_char_delay="${ITTE_WELCOME_CHAR_DELAY_SEC:-0.015}"

  while IFS= read -r line; do
    echo "$line"
    if [[ -t 1 ]]; then
      sleep "$banner_delay"
    fi
  done <<'EOF'
                 ,----,         ,----,
               ,/   .`|       ,/   .`|
   ,---,     ,`   .'  :     ,`   .'  :     ,---,.
,`--.' |   ;    ;     /   ;    ;     /   ,'  .' |
|███:  : .'___,/    ,'  .'___,/    ,'  ,---.'   |
:███|  ' |████:     |   |████:     |   |███|   .'
|███:  | ;████|.';  ;   ;████|.';  ;   :███:  |-,
'███'  ; `----'  |  |   `----'  |  |   :███|  ;/|
|███|  |     '   :  ;       '   :  ;   |███:   .'
'███:  ;     |   |  '       |   |  '   |███|  |-,
|███|  '     '   :  |       '   :  |   '███:  ;/|
'███:  |     ;   |.'        ;   |.'    |███|    \
;███|.'      '---'          '---'      |███:   .'
'---'                                  |███| ,'
                                       `----'
EOF

  while IFS= read -r line; do
    if [[ -t 1 && "$line" != "---------------" ]]; then
      if [[ -z "$line" ]]; then
        echo
      else
        local i ch
        for ((i = 0; i < ${#line}; i++)); do
          ch="${line:i:1}"
          printf "%s" "$ch"
          sleep "$text_char_delay"
        done
        echo
      fi
    else
      echo "$line"
    fi
  done <<'EOF'
You’re in.

Let’s keep the conversation natural.
No pressure, no over-correction.

---------------

If you need support:
  /optimize <text>
  /help <text>
  /daily
  /vibe <scene>
  /logs [n]
  /setting

---------------

Start with one sentence.
EOF
}

print_commands() {
  cat <<'EOF'
/optimize <text>   -> optimize your expression
/help <text>       -> scaffold expression step-by-step
/daily             -> start one guided daily practice prompt
/vibe <scene>      -> generate scene setup and dialogue starter
/logs [n]          -> show latest structured run logs
/setting           -> open interactive settings
EOF
}

handle_setting() {
  if [[ ! -t 0 || ! -t 1 ]]; then
    echo "Settings (read-only in non-interactive mode):"
    echo "  command_color: $ITTE_COMMAND_COLOR"
    echo "  topic_color: $ITTE_TOPIC_COLOR"
    echo "  bilingual_assist: $(settings_bool_label "$ITTE_BILINGUAL_ASSIST")"
    echo "Tip: run /setting in an interactive terminal to modify settings."
    return 0
  fi
  settings_menu_loop
}

handle_normal_input() {
  local text="$1" reply
  add_user_message "$text"
  generate_response "normal" || true
  reply="$MODEL_REPLY"
  if [[ -n "$reply" ]]; then
    if [[ "$ITTE_BILINGUAL_ASSIST" == "1" ]]; then
      reply="$(normalize_bilingual_block "$reply")"
    fi
    reply="$(format_assistant_text "$reply")"
    MODEL_REPLY="$reply"
  fi
  if [[ -z "$reply" ]]; then
    reply="I am sorry, I hit a temporary issue. Please try again."
    MODEL_REPLY_STREAMED=0
  fi
  add_assistant_message "$reply"
  if [[ "$MODEL_REPLY_STREAMED" -eq 0 ]]; then
    echo "$reply"
  fi
}

handle_optimize() {
  local text="$1" reply
  if [[ -z "$text" ]]; then
    echo "Usage: /optimize <text>"
    return 0
  fi
  OPTIMIZE_COUNT=$((OPTIMIZE_COUNT + 1))
  add_user_message "$text"
  generate_response "optimize" || true
  reply="$MODEL_REPLY"
  if [[ -n "$reply" ]]; then
    if [[ "$ITTE_BILINGUAL_ASSIST" == "1" ]]; then
      reply="$(normalize_bilingual_block "$reply")"
    fi
    reply="$(format_assistant_text "$reply")"
    MODEL_REPLY="$reply"
  fi
  if [[ -z "$reply" ]]; then
    reply="I understand you mean this sentence needs polishing. Please try /optimize again with the text."
    MODEL_REPLY_STREAMED=0
  fi
  add_assistant_message "$reply"
  if [[ "$MODEL_REPLY_STREAMED" -eq 0 ]]; then
    echo "$reply"
  fi
}

handle_help_mode() {
  local text="$1" reply input_kind
  if [[ -z "$text" ]]; then
    echo "Usage: /help <text>"
    return 0
  fi
  input_kind="english"
  if contains_cjk "$text"; then
    input_kind="chinese"
  fi

  HELP_COUNT=$((HELP_COUNT + 1))
  add_user_message "$text"
  generate_response "help" "$input_kind" || true
  reply="$MODEL_REPLY"
  if [[ -n "$reply" ]]; then
    reply="$(normalize_help_text "$reply")"
    MODEL_REPLY="$reply"
  fi
  if [[ -z "$reply" ]]; then
    reply=$'Translation Logic:\nI keep it simple: understand your meaning, choose natural English words, and build one clear sentence.\n\nContinue the topic:\nThanks for sharing. Tell me one more detail, and I will help you say it naturally.'
    MODEL_REPLY_STREAMED=0
  fi
  add_assistant_message "$reply"
  if [[ "$MODEL_REPLY_STREAMED" -eq 0 ]]; then
    print_help_output "$reply"
  fi
}

handle_vibe_mode() {
  local text="$1" reply
  if [[ -z "$text" ]]; then
    echo "Usage: /vibe <scene>"
    return 0
  fi

  add_user_message "$text"
  generate_response "vibe" || true
  reply="$MODEL_REPLY"
  if [[ -n "$reply" ]]; then
    reply="$(normalize_vibe_text "$reply")"
    MODEL_REPLY="$reply"
  fi
  if [[ -z "$reply" ]]; then
    reply=$'Scene Setup:\nTwo coworkers are preparing for a high-pressure meeting with their manager. They need to align fast and speak clearly.\n\nDialogue:\nA: We only have ten minutes. What is our main point?\nB: Let us focus on one clear update and one concrete next step.'
    MODEL_REPLY_STREAMED=0
  fi

  add_assistant_message "$reply"
  if [[ "$MODEL_REPLY_STREAMED" -eq 0 ]]; then
    print_vibe_output "$reply"
  fi
}

handle_daily() {
  local total index topic title intro prompt scene message
  total="$(jq 'length' "$TOPICS_FILE")"
  if [[ -z "$total" || "$total" == "0" ]]; then
    echo "No daily topics available."
    return 0
  fi
  index=$((RANDOM % total))
  topic="$(jq -c --argjson idx "$index" '.[$idx]' "$TOPICS_FILE")"
  title="$(jq -r '.title' <<<"$topic")"
  intro="$(jq -r '.intro' <<<"$topic")"
  prompt="$(jq -r '.prompt' <<<"$topic")"
  scene="$(jq -r '.scene // "Daily practice"' <<<"$topic")"

  CURRENT_SCENE_HINT="$scene"
  DAILY_COUNT=$((DAILY_COUNT + 1))

  message=$'Today\'s topic: '"$title"$'\n\n'"$intro"$'\n\n'"$prompt"
  add_assistant_message "$message"
  echo "$message"
}

handle_summary() {
  local summary_json
  summary_json="$(generate_summary_json)"
  LAST_SUMMARY_JSON="$summary_json"
  CURRENT_SCENE_HINT="$(jq -r '.scene // "General conversation"' <<<"$summary_json")"
  update_profile_preview
  print_summary "$summary_json"
}

handle_logs() {
  local raw_n="${1:-}"
  local n=10

  if [[ -n "$raw_n" ]]; then
    if [[ ! "$raw_n" =~ ^[0-9]+$ ]] || [[ "$raw_n" == "0" ]]; then
      echo "Usage: /logs [n]  (n must be a positive integer)"
      return 0
    fi
    n="$raw_n"
  fi

  if [[ ! -s "$RUN_LOG_FILE" ]]; then
    echo "No run logs yet."
    return 0
  fi

  echo "Recent run logs (latest ${n})"
  tail -n "$n" "$RUN_LOG_FILE" | jq -r '
    "[" + (.logged_at // "-") + "] "
    + "mode=" + (.mode // "-")
    + " req=" + (.request_id // "-")
    + " stream=" + ((.stream // false) | tostring)
    + " http=" + (.http_code // "-")
    + " latency=" + ((.latency_ms // 0) | tostring) + "ms"
    + " tokens=" + ((.tokens.total // "-") | tostring)
    + " error=" + (.error // "-")
  '
}

handle_end() {
  local summary_json
  summary_json="$(generate_summary_json)"
  LAST_SUMMARY_JSON="$summary_json"
  CURRENT_SCENE_HINT="$(jq -r '.scene // "General conversation"' <<<"$summary_json")"

  update_profile_final "$summary_json"
  save_summary_record "$summary_json"

  echo "Session ended."
  echo
  print_summary "$summary_json"

  rm -f "$SESSION_FILE"
}

main_loop() {
  local input raw_input rest embedded_cmd
  while true; do
    if ! read_input_line; then
      echo
      break
    fi
    raw_input="$READ_INPUT_LINE_VALUE"
    input="$raw_input"

    input="$(trim "$input")"
    [[ -z "$input" ]] && continue
    add_input_history "$raw_input"

    embedded_cmd="$(extract_embedded_command_token "$input")"
    if [[ -n "$embedded_cmd" ]]; then
      rest="$(trim "$(strip_first_command_token "$input" "$embedded_cmd")")"
      case "$embedded_cmd" in
        /optimize)
          handle_optimize "$rest"
          ;;
        /help)
          handle_help_mode "$rest"
          ;;
        /daily)
          handle_daily
          ;;
        /vibe)
          handle_vibe_mode "$rest"
          ;;
        /logs)
          handle_logs "$rest"
          ;;
        /setting)
          handle_setting
          ;;
        /commands)
          print_commands
          ;;
      esac

      write_current_session
      echo
      continue
    fi

    case "$input" in
      /*)
        echo "Unknown command. Use /commands to see available commands."
        ;;
      *)
        handle_normal_input "$input"
        ;;
    esac

    write_current_session
    echo
  done
}

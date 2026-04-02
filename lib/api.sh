# shellcheck shell=bash

# Model API integration and prompt/response orchestration.
if [[ -n "${ITTE_API_LOADED:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi
ITTE_API_LOADED=1

extract_content_text() {
  local body="$1"
  jq -r '
    if (.choices[0].message.content | type) == "string" then
      .choices[0].message.content
    elif (.choices[0].message.content | type) == "array" then
      [ .choices[0].message.content[] | select(.type == "text") | .text ] | join("\n")
    else
      empty
    end
  ' <<<"$body"
}

call_chat_completion() {
  local mode="$1"
  local system_prompt="$2"
  local messages_json="$3"
  local temperature="$4"
  local max_tokens="$5"
  local stream_requested="${6:-0}"

  local payload raw_response body http_code api_error content req_temp
  local prompt_tokens completion_tokens total_tokens provider_request_id
  local attempt request_id start_ms end_ms latency_ms stream_json
  local stream_enabled stream_line stream_data stream_chunk stream_saw_chunk stream_body_buffer
  local reasoning_seen retry_reason thinking_mode thinking_notice_printed
  local log_error=""

  MODEL_REPLY=""
  MODEL_REPLY_STREAMED=0
  request_id="$(new_request_id)"
  start_ms="$(epoch_ms)"
  stream_enabled=0
  if [[ "$stream_requested" == "1" && "$ITTE_STREAM" == "1" ]]; then
    stream_enabled=1
  fi

  retry_reason=""
  thinking_notice_printed=0
  for attempt in 1 2; do
    req_temp="$temperature"
    thinking_mode=""
    if [[ "$attempt" -eq 2 && "$retry_reason" == "invalid_temperature" ]]; then
      req_temp="1"
    elif [[ "$attempt" -eq 2 && "$retry_reason" == "kimi_reasoning_only" ]]; then
      req_temp="0.6"
      thinking_mode="disabled"
    fi

    if [[ "$stream_enabled" -eq 1 ]]; then
      stream_json="true"
    else
      stream_json="false"
    fi

    payload="$(
      jq -n \
        --arg model "$ITTE_MODEL" \
        --arg system_prompt "$system_prompt" \
        --argjson messages "$messages_json" \
        --argjson temperature "$req_temp" \
        --argjson max_tokens "$max_tokens" \
        --argjson stream "$stream_json" \
        --arg thinking_mode "$thinking_mode" \
        '{
          model: $model,
          temperature: $temperature,
          max_tokens: $max_tokens,
          stream: $stream,
          messages: ([{role: "system", content: $system_prompt}] + $messages)
        }
        | if $thinking_mode == "" then . else (. + {thinking: {type: $thinking_mode}}) end'
    )"

    api_error=""
    content=""
    prompt_tokens=""
    completion_tokens=""
    total_tokens=""
    provider_request_id=""
    reasoning_seen=0

    if [[ "$thinking_notice_printed" -eq 0 ]]; then
      print_thinking_notice
      thinking_notice_printed=1
    fi

    if [[ "$stream_enabled" -eq 1 ]]; then
      stream_saw_chunk=0
      stream_body_buffer=""
      http_code=""

      while IFS= read -r stream_line; do
        if [[ "$stream_line" == "__ITTE_HTTP_CODE__:"* ]]; then
          http_code="${stream_line#__ITTE_HTTP_CODE__:}"
          continue
        fi

        if [[ "$stream_line" == data:* ]]; then
          stream_data="${stream_line#data: }"
          if [[ "$stream_data" == "[DONE]" ]]; then
            continue
          fi
          if jq -e . >/dev/null 2>&1 <<<"$stream_data"; then
            if [[ -z "$provider_request_id" ]]; then
              provider_request_id="$(jq -r '.id // empty' <<<"$stream_data")"
            fi
            stream_chunk="$(jq -r '.choices[0].delta.content // empty' <<<"$stream_data")"
            if [[ -n "$stream_chunk" ]]; then
              MODEL_REPLY+="$stream_chunk"
              stream_saw_chunk=1
              MODEL_REPLY_STREAMED=1
              printf "%s" "$stream_chunk"
            fi
            if [[ -z "$(jq -r '.choices[0].delta.reasoning_content // empty' <<<"$stream_data")" ]]; then
              :
            else
              reasoning_seen=1
            fi
            if [[ -z "$prompt_tokens" ]]; then
              prompt_tokens="$(jq -r '.usage.prompt_tokens // empty' <<<"$stream_data")"
            fi
            if [[ -z "$completion_tokens" ]]; then
              completion_tokens="$(jq -r '.usage.completion_tokens // empty' <<<"$stream_data")"
            fi
            if [[ -z "$total_tokens" ]]; then
              total_tokens="$(jq -r '.usage.total_tokens // empty' <<<"$stream_data")"
            fi
            if [[ -z "$api_error" ]]; then
              api_error="$(jq -r '.error.message // empty' <<<"$stream_data")"
            fi
          fi
          continue
        fi

        if [[ -n "$stream_line" ]]; then
          stream_body_buffer+="${stream_line}"$'\n'
        fi
      done < <(
        curl -sS -N -m 120 \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer ${ITTE_API_KEY}" \
          -d "$payload" \
          "$API_URL" \
          -w $'\n__ITTE_HTTP_CODE__:%{http_code}\n'
      )

      if [[ -z "$http_code" ]]; then
        http_code="000"
      fi

      # Some providers may ignore stream and return one JSON object.
      if [[ "$stream_saw_chunk" -eq 0 && -n "$stream_body_buffer" ]]; then
        body="$(trim "$stream_body_buffer")"
        api_error="$(jq -r '.error.message // empty' <<<"$body" 2>/dev/null || true)"
        content="$(extract_content_text "$body")"
        provider_request_id="$(jq -r '.id // empty' <<<"$body" 2>/dev/null || true)"
        prompt_tokens="$(jq -r '.usage.prompt_tokens // empty' <<<"$body" 2>/dev/null || true)"
        completion_tokens="$(jq -r '.usage.completion_tokens // empty' <<<"$body" 2>/dev/null || true)"
        total_tokens="$(jq -r '.usage.total_tokens // empty' <<<"$body" 2>/dev/null || true)"
        if [[ -n "$(jq -r '.choices[0].message.reasoning_content // empty' <<<"$body" 2>/dev/null || true)" ]]; then
          reasoning_seen=1
        fi
        if [[ -n "$content" ]]; then
          MODEL_REPLY="$content"
          MODEL_REPLY_STREAMED=0
        fi
      fi
    else
      raw_response="$(
        curl -sS -m 120 \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer ${ITTE_API_KEY}" \
          -d "$payload" \
          "$API_URL" \
          -w $'\n%{http_code}'
      )"

      body="$(printf "%s" "$raw_response" | sed '$d')"
      http_code="$(printf "%s" "$raw_response" | tail -n1)"
      api_error="$(jq -r '.error.message // empty' <<<"$body" 2>/dev/null || true)"
      content="$(extract_content_text "$body")"
      provider_request_id="$(jq -r '.id // empty' <<<"$body" 2>/dev/null || true)"
      prompt_tokens="$(jq -r '.usage.prompt_tokens // empty' <<<"$body" 2>/dev/null || true)"
      completion_tokens="$(jq -r '.usage.completion_tokens // empty' <<<"$body" 2>/dev/null || true)"
      total_tokens="$(jq -r '.usage.total_tokens // empty' <<<"$body" 2>/dev/null || true)"
      if [[ -n "$(jq -r '.choices[0].message.reasoning_content // empty' <<<"$body" 2>/dev/null || true)" ]]; then
        reasoning_seen=1
      fi
      MODEL_REPLY="$content"
    fi

    # Some models/providers only allow temperature=1. Retry once automatically.
    if [[ "$attempt" -eq 1 && "$temperature" != "1" && "$api_error" == *"invalid temperature"* ]]; then
      MODEL_REPLY=""
      MODEL_REPLY_STREAMED=0
      retry_reason="invalid_temperature"
      continue
    fi

    if [[ ! "$http_code" =~ ^2 ]]; then
      log_error="API request failed (HTTP ${http_code})."
      if [[ -n "$api_error" ]]; then
        log_error="${log_error} ${api_error}"
      fi
      echo "Error: $log_error" >&2
      end_ms="$(epoch_ms)"
      latency_ms=$((end_ms - start_ms))
      append_run_log "$request_id" "$mode" "$stream_enabled" "$latency_ms" "$log_error" "$http_code" "$prompt_tokens" "$completion_tokens" "$total_tokens" "$provider_request_id"
      return 1
    fi

    if [[ -n "$api_error" ]]; then
      log_error="API returned an error: $api_error"
      echo "Error: $log_error" >&2
      end_ms="$(epoch_ms)"
      latency_ms=$((end_ms - start_ms))
      append_run_log "$request_id" "$mode" "$stream_enabled" "$latency_ms" "$log_error" "$http_code" "$prompt_tokens" "$completion_tokens" "$total_tokens" "$provider_request_id"
      return 1
    fi

    if [[ -z "$MODEL_REPLY" ]]; then
      if [[ "$attempt" -eq 1 && "$reasoning_seen" -eq 1 ]] && is_kimi_k25_model; then
        # Kimi K2.5 may spend all completion tokens on reasoning_content.
        # Retry once with thinking disabled and provider-required temperature.
        MODEL_REPLY=""
        MODEL_REPLY_STREAMED=0
        retry_reason="kimi_reasoning_only"
        continue
      fi
      log_error="Empty model response."
      echo "Error: $log_error" >&2
      end_ms="$(epoch_ms)"
      latency_ms=$((end_ms - start_ms))
      append_run_log "$request_id" "$mode" "$stream_enabled" "$latency_ms" "$log_error" "$http_code" "$prompt_tokens" "$completion_tokens" "$total_tokens" "$provider_request_id"
      return 1
    fi

    if [[ "$MODEL_REPLY_STREAMED" -eq 1 ]]; then
      echo
    fi

    end_ms="$(epoch_ms)"
    latency_ms=$((end_ms - start_ms))
    append_run_log "$request_id" "$mode" "$stream_enabled" "$latency_ms" "" "$http_code" "$prompt_tokens" "$completion_tokens" "$total_tokens" "$provider_request_id"
    return 0
  done

  log_error="Failed to get a valid response from API."
  echo "Error: $log_error" >&2
  end_ms="$(epoch_ms)"
  latency_ms=$((end_ms - start_ms))
  append_run_log "$request_id" "$mode" "$stream_enabled" "$latency_ms" "$log_error" "000" "" "" "" ""
  return 1
}

bilingual_output_instruction() {
  if [[ "$ITTE_BILINGUAL_ASSIST" == "1" ]]; then
    cat <<'EOF'

When bilingual assist is ON:
- Keep English first, then Chinese.
- Use two short paragraphs separated by one blank line.
- Do not include language labels like "English:", "Chinese:", "英文：", or "中文：".
EOF
  fi
}

system_prompt_normal() {
  cat <<'EOF'
You are Itte, an English speaking practice companion.

Product policy:
- Default to English.
- Do not behave like a strict teacher.
- Prioritize understanding and conversation continuity.
- Do not auto-correct unless user explicitly asks.
- If user meaning is ambiguous, ask ONE minimal clarification question.
- If user clearly struggles to express, scaffold gently:
  1) identify intended meaning
  2) offer one usable sentence
  3) offer one optional alternative
  4) ask a follow-up question
- Keep replies concise and warm.
- If user explicitly asks for Chinese explanation, provide brief Chinese support then continue in English.

You should internally handle:
- S1 clear expression -> acknowledge + continue topic
- S2 understandable but unnatural -> continue topic, no correction lecture
- S3 ambiguous meaning -> minimal clarification
- S4 expression breakdown -> scaffold and continue
EOF
  bilingual_output_instruction
}

system_prompt_optimize() {
  cat <<'EOF'
You are Itte in optimize mode.
The user asked /optimize and wants expression polish.

Required output structure:
1) "I understand you mean ..."
2) "A more natural way to say it is: ..."
3) Optional simpler version (if useful)
4) One follow-up question that returns to conversation

Rules:
- Default English.
- Keep it concise.
- No long grammar lecture.
- Preserve original meaning.
EOF
  bilingual_output_instruction
}

system_prompt_help_mode() {
  local input_kind="${1:-english}"
  cat <<'EOF'
You are Itte in /help mode.

You MUST return STRICT JSON only (no markdown, no prose outside JSON):
{
  "translation_logic": {
    "en": "string",
    "zh": "string"
  },
  "continue_topic": {
    "en": "string",
    "zh": "string"
  }
}

Global rules:
- Keep wording simple enough for a 5-year-old learner.
- Be warm, practical, and non-judgmental.
- In continue_topic.en, keep the conversation moving with one follow-up question.
- Keep every value concise and directly usable.

Language rules:
- Always fill translation_logic.en and continue_topic.en.
- If bilingual assist is ON, fill zh values with natural Chinese.
- If bilingual assist is OFF, set both zh values to empty strings.
EOF

  if [[ "$ITTE_BILINGUAL_ASSIST" == "1" ]]; then
    cat <<'EOF'

Current runtime setting: bilingual assist is ON.
Return non-empty zh values.
EOF
  else
    cat <<'EOF'

Current runtime setting: bilingual assist is OFF.
Return zh as empty strings.
EOF
  fi

  if [[ "$input_kind" == "chinese" ]]; then
    cat <<'EOF'

Chinese-input behavior:
- The user text after /help is Chinese (or mixed with Chinese).
- Explain how to translate it into natural English:
  - what the key meaning is
  - why the chosen wording sounds natural
  - one clear natural English sentence to use
EOF
  else
    cat <<'EOF'

English-input behavior:
- The user text after /help is English.
- Evaluate expression quality explicitly (natural / awkward / incorrect).
- If awkward or incorrect, explain what is wrong and how to improve it.
- Include one improved sentence that the user can directly use.
EOF
  fi
}

system_prompt_vibe_mode() {
  cat <<'EOF'
You are Itte in /vibe mode.

The user gives a scenario idea and you generate one concise scene opener.
You MUST return STRICT JSON only (no markdown, no prose outside JSON):
{
  "scene_setup": {
    "en": "string",
    "zh": "string"
  },
  "dialogue": {
    "en": "string",
    "zh": "string"
  }
}

Rules:
- Keep it practical and conversational, not literary.
- In dialogue.en, choose a clear role in the scene (for example project lead, teammate, manager) and speak in first person.
- dialogue.en must be one sentence only and should sound like a real line someone can reply to immediately.
- scene_setup.en should be 2-4 short sentences.

Language rules:
- Always fill scene_setup.en and dialogue.en.
- If bilingual assist is ON, fill zh values with natural Chinese.
- If bilingual assist is OFF, set both zh values to empty strings.
EOF

  if [[ "$ITTE_BILINGUAL_ASSIST" == "1" ]]; then
    cat <<'EOF'

Current runtime setting: bilingual assist is ON.
Return non-empty zh values.
EOF
  else
    cat <<'EOF'

Current runtime setting: bilingual assist is OFF.
Return zh as empty strings.
EOF
  fi
}

system_prompt_summary() {
  cat <<'EOF'
You generate concise session summaries for an English practice CLI.

Return STRICT JSON only (no markdown, no explanation) with this schema:
{
  "scene": "string",
  "intents": ["string", "string", "string"],
  "useful_expressions": ["string", "string", "string"],
  "try_next_time": "string"
}

Rules:
- Use English text.
- Keep intents 1-3 items.
- Keep useful_expressions 1-3 items and reusable.
- try_next_time must be one concrete sentence.
EOF
}

generate_response() {
  local mode="$1"
  local mode_arg="${2:-}"
  local system_prompt messages stream_requested

  MODEL_REPLY=""
  MODEL_REPLY_STREAMED=0
  messages="$(recent_history_json 24)"
  case "$mode" in
    normal)
      system_prompt="$(system_prompt_normal)"
      stream_requested="0"
      if [[ "$ITTE_WEB_MODE" == "1" ]]; then
        stream_requested="1"
      fi
      call_chat_completion "normal" "$system_prompt" "$messages" "$ITTE_TEMPERATURE" "420" "$stream_requested"
      ;;
    optimize)
      system_prompt="$(system_prompt_optimize)"
      stream_requested="0"
      if [[ "$ITTE_WEB_MODE" == "1" ]]; then
        stream_requested="1"
      fi
      call_chat_completion "optimize" "$system_prompt" "$messages" "$ITTE_TEMPERATURE" "360" "$stream_requested"
      ;;
    help)
      system_prompt="$(system_prompt_help_mode "$mode_arg")"
      call_chat_completion "help" "$system_prompt" "$messages" "$ITTE_TEMPERATURE" "360" "0"
      ;;
    vibe)
      system_prompt="$(system_prompt_vibe_mode)"
      call_chat_completion "vibe" "$system_prompt" "$messages" "$ITTE_TEMPERATURE" "420" "0"
      ;;
    *)
      echo "Error: unknown response mode '$mode'" >&2
      return 1
      ;;
  esac
}

fallback_summary_json() {
  local scene intents_json useful_json try_next
  scene="$CURRENT_SCENE_HINT"
  if [[ "$scene" == "General conversation" && "$DAILY_COUNT" -gt 0 ]]; then
    scene="Daily practice"
  fi

  intents_json='["sharing opinions"]'
  if [[ "$HELP_COUNT" -gt 0 && "$OPTIMIZE_COUNT" -gt 0 ]]; then
    intents_json='["expressing opinions","asking for expression help","improving wording"]'
  elif [[ "$HELP_COUNT" -gt 0 ]]; then
    intents_json='["asking for expression help","expressing uncertainty"]'
  elif [[ "$OPTIMIZE_COUNT" -gt 0 ]]; then
    intents_json='["improving wording","sharing opinions"]'
  fi

  useful_json='[
    "I can see the benefits, but I still feel a little uneasy about it.",
    "In my experience, the biggest issue is ...",
    "Could you help me say this more naturally?"
  ]'
  try_next="I can see both sides, but I still have some concerns."

  jq -n \
    --arg scene "$scene" \
    --arg try_next_time "$try_next" \
    --argjson intents "$intents_json" \
    --argjson useful_expressions "$useful_json" \
    '{
      scene: $scene,
      intents: ($intents | .[:3]),
      useful_expressions: ($useful_expressions | .[:3]),
      try_next_time: $try_next_time
    }'
}

generate_summary_json() {
  local context_json summary_messages raw normalized
  context_json="$(
    jq -n \
      --arg session_id "$SESSION_ID" \
      --arg started_at "$SESSION_STARTED_AT" \
      --arg now "$(iso_utc)" \
      --arg scene_hint "$CURRENT_SCENE_HINT" \
      --argjson stats "$(session_stats_json)" \
      --argjson recent_history "$(recent_history_json 24)" \
      '{
        session_id: $session_id,
        started_at: $started_at,
        now: $now,
        scene_hint: $scene_hint,
        stats: $stats,
        recent_history: $recent_history
      }'
  )"

  summary_messages="$(
    jq -n --arg context "$(jq -c . <<<"$context_json")" '
      [
        {
          role: "user",
          content: ("Create session summary from this JSON context:\n" + $context)
        }
      ]'
  )"

  call_chat_completion "summary" "$(system_prompt_summary)" "$summary_messages" "$ITTE_TEMPERATURE" "320" "0" || true
  raw="$MODEL_REPLY"
  if [[ -z "$raw" ]]; then
    fallback_summary_json
    return 0
  fi

  normalized="$(normalize_summary_json "$raw")"
  printf "%s" "$normalized"
}

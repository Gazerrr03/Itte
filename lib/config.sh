# shellcheck shell=bash

# Configuration and environment bootstrap helpers.
if [[ -n "${ITTE_CONFIG_LOADED:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi
ITTE_CONFIG_LOADED=1

settings_bilingual_json() {
  if [[ "$ITTE_BILINGUAL_ASSIST" == "1" ]]; then
    printf "true"
  else
    printf "false"
  fi
}

save_settings() {
  jq -n \
    --arg command_color "$ITTE_COMMAND_COLOR" \
    --arg topic_color "$ITTE_TOPIC_COLOR" \
    --argjson bilingual_assist "$(settings_bilingual_json)" \
    '{
      command_color: $command_color,
      topic_color: $topic_color,
      bilingual_assist: $bilingual_assist
    }' > "$SETTINGS_FILE"
}

load_settings() {
  local file_command_color file_topic_color file_bilingual

  if [[ ! -f "$SETTINGS_FILE" ]]; then
    ITTE_COMMAND_COLOR="${ITTE_COMMAND_COLOR:-$(default_command_color)}"
    ITTE_TOPIC_COLOR="${ITTE_TOPIC_COLOR:-$(default_topic_color)}"
    ITTE_BILINGUAL_ASSIST="${ITTE_BILINGUAL_ASSIST:-$(default_bilingual_assist)}"
    save_settings
    return 0
  fi

  file_command_color="$(jq -r '.command_color // empty' "$SETTINGS_FILE" 2>/dev/null || true)"
  file_topic_color="$(jq -r '.topic_color // empty' "$SETTINGS_FILE" 2>/dev/null || true)"
  file_bilingual="$(jq -r '.bilingual_assist // empty' "$SETTINGS_FILE" 2>/dev/null || true)"

  if [[ -z "$ITTE_COMMAND_COLOR" ]]; then
    if is_valid_color_name "$file_command_color"; then
      ITTE_COMMAND_COLOR="$file_command_color"
    else
      ITTE_COMMAND_COLOR="$(default_command_color)"
    fi
  fi

  if [[ -z "$ITTE_TOPIC_COLOR" ]]; then
    if is_valid_color_name "$file_topic_color"; then
      ITTE_TOPIC_COLOR="$file_topic_color"
    else
      ITTE_TOPIC_COLOR="$(default_topic_color)"
    fi
  fi

  if [[ -z "$ITTE_BILINGUAL_ASSIST" ]]; then
    case "$file_bilingual" in
      true|1) ITTE_BILINGUAL_ASSIST="1" ;;
      false|0) ITTE_BILINGUAL_ASSIST="0" ;;
      *) ITTE_BILINGUAL_ASSIST="$(default_bilingual_assist)" ;;
    esac
  fi

  if ! is_valid_color_name "$ITTE_COMMAND_COLOR"; then
    ITTE_COMMAND_COLOR="$(default_command_color)"
  fi
  if ! is_valid_color_name "$ITTE_TOPIC_COLOR"; then
    ITTE_TOPIC_COLOR="$(default_topic_color)"
  fi
  if [[ ! "$ITTE_BILINGUAL_ASSIST" =~ ^(0|1)$ ]]; then
    ITTE_BILINGUAL_ASSIST="$(default_bilingual_assist)"
  fi
}

load_dotenv_if_exists() {
  if [[ -f ".env" ]]; then
    # shellcheck disable=SC1091
    set -a && source ".env" && set +a
  fi
}

ensure_data_files() {
  local now
  now="$(iso_utc)"

  mkdir -p "$DATA_DIR"

  if [[ ! -f "$TOPICS_FILE" ]]; then
    if [[ -f "${SCRIPT_DIR}/daily_topics.json" ]]; then
      cp "${SCRIPT_DIR}/daily_topics.json" "$TOPICS_FILE"
    else
      cat > "$TOPICS_FILE" <<'EOF'
[
  {
    "topic_id": "ai_daily_001",
    "scene": "News discussion",
    "title": "AI assistants in daily work",
    "intro": "Some people use AI tools every day to save time, while others worry this makes people think less.",
    "prompt": "What about you: do AI tools usually make your work easier, or more confusing?"
  }
]
EOF
    fi
  fi

  if [[ ! -f "$PROFILE_FILE" ]]; then
    jq -n --arg now "$now" '{
      schema_version: "itte_profile_v0",
      created_at: $now,
      updated_at: $now,
      stats: {
        total_sessions: 0,
        total_turns: 0,
        total_optimize_requests: 0,
        total_help_requests: 0,
        total_daily_requests: 0
      },
      language_profile: {
        estimated_level: "unknown",
        common_breakdown_types: [],
        preferred_sentence_complexity: "simple_to_medium",
        frequent_intents: [],
        optimize_usage_pattern: {
          optimize_per_session_avg: 0
        }
      },
      preference_profile: {
        prefers_more_guidance: null,
        prefers_short_feedback: null,
        preferred_topics: [],
        work_vs_life_ratio: "unknown",
        daily_mode_frequency: "low"
      },
      _counters: {
        topic_counts: {},
        intent_counts: {}
      }
    }' > "$PROFILE_FILE"
  fi

  if [[ ! -f "$SUMMARIES_FILE" ]]; then
    : > "$SUMMARIES_FILE"
  fi

  if [[ ! -f "$RUN_LOG_FILE" ]]; then
    : > "$RUN_LOG_FILE"
  fi

  if [[ ! -f "$SETTINGS_FILE" ]]; then
    jq -n \
      --arg command_color "$(default_command_color)" \
      --arg topic_color "$(default_topic_color)" \
      --argjson bilingual_assist false \
      '{
        command_color: $command_color,
        topic_color: $topic_color,
        bilingual_assist: $bilingual_assist
      }' > "$SETTINGS_FILE"
  fi
}

validate_env() {
  local missing=()
  local base_no_slash
  ITTE_API_BASE="${ITTE_API_BASE:-}"
  ITTE_API_KEY="${ITTE_API_KEY:-}"
  ITTE_MODEL="${ITTE_MODEL:-}"

  [[ -z "$ITTE_API_BASE" ]] && missing+=("ITTE_API_BASE")
  [[ -z "$ITTE_API_KEY" ]] && missing+=("ITTE_API_KEY")
  [[ -z "$ITTE_MODEL" ]] && missing+=("ITTE_MODEL")

  if (( ${#missing[@]} > 0 )); then
    echo "Configuration error: missing environment variables."
    local item
    for item in "${missing[@]}"; do
      echo "  - $item"
    done
    cat <<'EOF'

Quick setup:
  1) Copy .env.example to .env
  2) Fill your API values
  3) Run ./itte again
EOF
    exit 1
  fi

  if [[ ! "$ITTE_TEMPERATURE" =~ ^-?[0-9]+([.][0-9]+)?$ ]]; then
    echo "Configuration error: ITTE_TEMPERATURE must be a number (for example: 1 or 0.7)."
    exit 1
  fi

  if [[ ! "$ITTE_STREAM" =~ ^(0|1)$ ]]; then
    echo "Configuration error: ITTE_STREAM must be 0 or 1."
    exit 1
  fi

  if [[ ! "$ITTE_COLOR_COMMANDS" =~ ^(0|1)$ ]]; then
    echo "Configuration error: ITTE_COLOR_COMMANDS must be 0 or 1."
    exit 1
  fi

  if [[ ! "$ITTE_SHOW_THINKING" =~ ^(0|1)$ ]]; then
    echo "Configuration error: ITTE_SHOW_THINKING must be 0 or 1."
    exit 1
  fi

  if ! is_valid_color_name "$ITTE_COMMAND_COLOR"; then
    echo "Configuration error: ITTE_COMMAND_COLOR must be one of: default, purple, green, cyan, yellow, blue, red, gray."
    exit 1
  fi

  if ! is_valid_color_name "$ITTE_TOPIC_COLOR"; then
    echo "Configuration error: ITTE_TOPIC_COLOR must be one of: default, purple, green, cyan, yellow, blue, red, gray."
    exit 1
  fi

  if [[ ! "$ITTE_BILINGUAL_ASSIST" =~ ^(0|1)$ ]]; then
    echo "Configuration error: ITTE_BILINGUAL_ASSIST must be 0 or 1."
    exit 1
  fi

  if [[ ! "$ITTE_WEB_MODE" =~ ^(0|1)$ ]]; then
    echo "Configuration error: ITTE_WEB_MODE must be 0 or 1."
    exit 1
  fi

  base_no_slash="${ITTE_API_BASE%/}"
  if [[ "$base_no_slash" == */v1 ]]; then
    API_URL="${base_no_slash}/chat/completions"
  else
    API_URL="${base_no_slash}/v1/chat/completions"
  fi
}

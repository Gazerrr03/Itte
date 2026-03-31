# shellcheck shell=bash

# Core helpers: time, text normalization, colors, and common guards.
if [[ -n "${ITTE_CORE_LOADED:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi
ITTE_CORE_LOADED=1

iso_utc() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

epoch_ms() {
  printf "%s000" "$(date +%s)"
}

new_request_id() {
  printf "req_%s_%04d" "$(date +%Y%m%d%H%M%S)" "$((RANDOM % 10000))"
}

trim() {
  local input="${1:-}"
  printf "%s" "$input" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

default_command_color() {
  printf "purple"
}

default_topic_color() {
  printf "green"
}

default_bilingual_assist() {
  printf "0"
}

is_valid_color_name() {
  local name="$1"
  case "$name" in
    default|purple|green|cyan|yellow|blue|red|gray)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ansi_for_color_name() {
  local name="$1"
  case "$name" in
    purple) printf "\033[38;5;183m" ;;
    green) printf "\033[32m" ;;
    cyan) printf "\033[36m" ;;
    yellow) printf "\033[33m" ;;
    blue) printf "\033[34m" ;;
    red) printf "\033[31m" ;;
    gray) printf "\033[90m" ;;
    *) printf "" ;;
  esac
}

is_kimi_k25_model() {
  local model_lc
  model_lc="$(printf "%s" "$ITTE_MODEL" | tr '[:upper:]' '[:lower:]')"
  [[ "$model_lc" == *"kimi-k2.5"* ]]
}

print_thinking_notice() {
  if [[ "$ITTE_SHOW_THINKING" != "1" ]]; then
    return 0
  fi
  echo "thinking..." >&2
}

require_bin() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Error: Missing dependency '$name'. Please install it and retry."
    exit 1
  fi
}

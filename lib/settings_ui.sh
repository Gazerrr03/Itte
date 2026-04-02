# shellcheck shell=bash

# Interactive terminal settings menus.
if [[ -n "${ITTE_SETTINGS_UI_LOADED:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi
ITTE_SETTINGS_UI_LOADED=1

menu_read_key() {
  local ch esc_seq
  if ! IFS= read -rsn1 ch; then
    printf "quit"
    return 0
  fi
  if [[ -z "$ch" || "$ch" == $'\n' || "$ch" == $'\r' ]]; then
    printf "enter"
    return 0
  fi
  case "$ch" in
    q|Q) printf "quit" ;;
    $'\033')
      # Drain full escape sequence so one keypress maps to one menu action.
      esc_seq="$(read_escape_sequence_tail)"
      case "$esc_seq" in
        *A) printf "up" ;;
        *B) printf "down" ;;
        *) printf "other" ;;
      esac
      ;;
    *)
      printf "other"
      ;;
  esac
}

draw_settings_header() {
  local title="$1"
  printf "\033[2J\033[H"
  echo "Settings"
  echo "--------"
  echo "$title"
  echo
}

settings_bool_label() {
  if [[ "$1" == "1" ]]; then
    printf "On"
  else
    printf "Off"
  fi
}

settings_color_index() {
  local current="$1"
  local -a colors=("default" "purple" "green" "cyan" "yellow" "blue" "red" "gray")
  local i
  for i in "${!colors[@]}"; do
    if [[ "${colors[$i]}" == "$current" ]]; then
      printf "%s" "$i"
      return 0
    fi
  done
  printf "0"
}

settings_saved_notice() {
  echo
  echo "Saved."
  sleep 0.4
}

settings_pick_color_menu() {
  local target="$1"
  local title="$2"
  local current="$3"
  local -a colors=("default" "purple" "green" "cyan" "yellow" "blue" "red" "gray")
  local idx key i item ansi reset
  local needs_redraw=1

  idx="$(settings_color_index "$current")"
  reset="\033[0m"

  while true; do
    if [[ "$needs_redraw" == "1" ]]; then
      draw_settings_header "$title (Enter to save, q to go back)"
      for i in "${!colors[@]}"; do
        item="${colors[$i]}"
        if [[ "$i" -eq "$idx" ]]; then
          printf "> "
        else
          printf "  "
        fi
        ansi="$(ansi_for_color_name "$item")"
        if [[ -n "$ansi" ]]; then
          printf "%-8s %bPreview sample%b\n" "$item" "$ansi" "$reset"
        else
          printf "%-8s Preview sample\n" "$item"
        fi
      done
      needs_redraw=0
    fi

    key="$(menu_read_key)"
    case "$key" in
      up)
        idx=$((idx - 1))
        if (( idx < 0 )); then
          idx=$((${#colors[@]} - 1))
        fi
        needs_redraw=1
        ;;
      down)
        idx=$((idx + 1))
        if (( idx >= ${#colors[@]} )); then
          idx=0
        fi
        needs_redraw=1
        ;;
      enter)
        if [[ "$target" == "command" ]]; then
          ITTE_COMMAND_COLOR="${colors[$idx]}"
        else
          ITTE_TOPIC_COLOR="${colors[$idx]}"
        fi
        save_settings
        settings_saved_notice
        return 0
        ;;
      quit)
        return 0
        ;;
    esac
  done
}

settings_toggle_bilingual_menu() {
  local idx key
  local -a labels=("Off" "On")
  local needs_redraw=1

  if [[ "$ITTE_BILINGUAL_ASSIST" == "1" ]]; then
    idx=1
  else
    idx=0
  fi

  while true; do
    if [[ "$needs_redraw" == "1" ]]; then
      draw_settings_header "Chinese Assist (Enter to save, q to go back)"
      echo "When enabled: model replies include English first, then Chinese."
      echo
      for i in "${!labels[@]}"; do
        if [[ "$i" -eq "$idx" ]]; then
          printf "> %s\n" "${labels[$i]}"
        else
          printf "  %s\n" "${labels[$i]}"
        fi
      done
      needs_redraw=0
    fi

    key="$(menu_read_key)"
    case "$key" in
      up|down)
        if [[ "$idx" -eq 0 ]]; then idx=1; else idx=0; fi
        needs_redraw=1
        ;;
      enter)
        if [[ "$idx" -eq 1 ]]; then
          ITTE_BILINGUAL_ASSIST="1"
        else
          ITTE_BILINGUAL_ASSIST="0"
        fi
        save_settings
        settings_saved_notice
        return 0
        ;;
      quit)
        return 0
        ;;
    esac
  done
}

settings_menu_loop() {
  local idx=0 key
  local -a items=("Command Color" "Topic Color" "Chinese Assist" "Back")
  local needs_redraw=1

  while true; do
    if [[ "$needs_redraw" == "1" ]]; then
      draw_settings_header "Use Up/Down + Enter. Press q to exit."
      printf "Current settings:\n"
      printf "  command_color: %s\n" "$ITTE_COMMAND_COLOR"
      printf "  topic_color: %s\n" "$ITTE_TOPIC_COLOR"
      printf "  bilingual_assist: %s\n\n" "$(settings_bool_label "$ITTE_BILINGUAL_ASSIST")"

      for i in "${!items[@]}"; do
        if [[ "$i" -eq "$idx" ]]; then
          printf "> %s" "${items[$i]}"
        else
          printf "  %s" "${items[$i]}"
        fi

        case "$i" in
          0) printf "  (%s)\n" "$ITTE_COMMAND_COLOR" ;;
          1) printf "  (%s)\n" "$ITTE_TOPIC_COLOR" ;;
          2) printf "  (%s)\n" "$(settings_bool_label "$ITTE_BILINGUAL_ASSIST")" ;;
          *) printf "\n" ;;
        esac
      done
      needs_redraw=0
    fi

    key="$(menu_read_key)"
    case "$key" in
      up)
        idx=$((idx - 1))
        if (( idx < 0 )); then
          idx=$((${#items[@]} - 1))
        fi
        needs_redraw=1
        ;;
      down)
        idx=$((idx + 1))
        if (( idx >= ${#items[@]} )); then
          idx=0
        fi
        needs_redraw=1
        ;;
      enter)
        case "$idx" in
          0) settings_pick_color_menu "command" "Command Color" "$ITTE_COMMAND_COLOR" ;;
          1) settings_pick_color_menu "topic" "Topic Color" "$ITTE_TOPIC_COLOR" ;;
          2) settings_toggle_bilingual_menu ;;
          3) printf "\033[2J\033[H"; return 0 ;;
        esac
        needs_redraw=1
        ;;
      quit)
        printf "\033[2J\033[H"
        return 0
        ;;
    esac
  done
}

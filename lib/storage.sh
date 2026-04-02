# shellcheck shell=bash

# Session/profile/history persistence and run logging.
if [[ -n "${ITTE_STORAGE_LOADED:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi
ITTE_STORAGE_LOADED=1

append_run_log() {
  local request_id="$1"
  local mode="$2"
  local stream_flag="$3"
  local latency_ms="$4"
  local error_msg="$5"
  local http_code="$6"
  local prompt_tokens="${7:-}"
  local completion_tokens="${8:-}"
  local total_tokens="${9:-}"
  local provider_request_id="${10:-}"
  local logged_at

  logged_at="$(iso_utc)"

  jq -c -n \
    --arg logged_at "$logged_at" \
    --arg session_id "$SESSION_ID" \
    --arg request_id "$request_id" \
    --arg provider_request_id "$provider_request_id" \
    --arg mode "$mode" \
    --arg stream_flag "$stream_flag" \
    --argjson latency_ms "$latency_ms" \
    --arg http_code "$http_code" \
    --arg error "$error_msg" \
    --arg prompt_tokens "$prompt_tokens" \
    --arg completion_tokens "$completion_tokens" \
    --arg total_tokens "$total_tokens" \
    '{
      logged_at: $logged_at,
      session_id: $session_id,
      request_id: $request_id,
      provider_request_id: (if $provider_request_id == "" then null else $provider_request_id end),
      mode: $mode,
      stream: ($stream_flag == "1"),
      latency_ms: $latency_ms,
      http_code: $http_code,
      error: (if $error == "" then null else $error end),
      tokens: {
        prompt: (if $prompt_tokens == "" then null else ($prompt_tokens | tonumber) end),
        completion: (if $completion_tokens == "" then null else ($completion_tokens | tonumber) end),
        total: (if $total_tokens == "" then null else ($total_tokens | tonumber) end)
      }
    }' >> "$RUN_LOG_FILE"
}

new_session_id() {
  printf "sess_%s_%04d" "$(date +%Y%m%d%H%M%S)" "$((RANDOM % 10000))"
}

init_session() {
  SESSION_ID="$(new_session_id)"
  SESSION_STARTED_AT="$(iso_utc)"
  HISTORY_JSON='[]'
  LAST_SUMMARY_JSON=""
  CURRENT_SCENE_HINT="General conversation"

  USER_TURNS=0
  ASSISTANT_TURNS=0
  TOTAL_USER_CHARS=0
  OPTIMIZE_COUNT=0
  HELP_COUNT=0
  DAILY_COUNT=0
}

session_stats_json() {
  local avg_user_chars
  if (( USER_TURNS > 0 )); then
    avg_user_chars=$((TOTAL_USER_CHARS / USER_TURNS))
  else
    avg_user_chars=0
  fi

  jq -n \
    --argjson user_turns "$USER_TURNS" \
    --argjson assistant_turns "$ASSISTANT_TURNS" \
    --argjson optimize_count "$OPTIMIZE_COUNT" \
    --argjson help_count "$HELP_COUNT" \
    --argjson daily_count "$DAILY_COUNT" \
    --argjson avg_user_chars "$avg_user_chars" \
    '{
      user_turns: $user_turns,
      assistant_turns: $assistant_turns,
      optimize_count: $optimize_count,
      help_count: $help_count,
      daily_count: $daily_count,
      avg_user_chars: $avg_user_chars
    }'
}

write_current_session() {
  local updated_at has_summary summary_json
  updated_at="$(iso_utc)"
  if [[ -n "$LAST_SUMMARY_JSON" ]]; then
    has_summary="true"
    summary_json="$LAST_SUMMARY_JSON"
  else
    has_summary="false"
    summary_json="null"
  fi

  jq -n \
    --arg session_id "$SESSION_ID" \
    --arg started_at "$SESSION_STARTED_AT" \
    --arg updated_at "$updated_at" \
    --arg current_scene "$CURRENT_SCENE_HINT" \
    --argjson stats "$(session_stats_json)" \
    --argjson has_summary "$has_summary" \
    --argjson last_summary "$summary_json" \
    '{
      session_id: $session_id,
      started_at: $started_at,
      updated_at: $updated_at,
      current_scene: $current_scene,
      stats: $stats,
      has_summary: $has_summary,
      last_summary: $last_summary
    }' > "$SESSION_FILE"
}

append_history() {
  local role="$1"
  local content="$2"
  HISTORY_JSON="$(
    jq --arg role "$role" --arg content "$content" '
      . + [{role: $role, content: $content}]
      | if length > 40 then .[-40:] else . end
    ' <<<"$HISTORY_JSON"
  )"
}

add_user_message() {
  local text="$1"
  append_history "user" "$text"
  USER_TURNS=$((USER_TURNS + 1))
  TOTAL_USER_CHARS=$((TOTAL_USER_CHARS + ${#text}))
}

add_assistant_message() {
  local text="$1"
  append_history "assistant" "$text"
  ASSISTANT_TURNS=$((ASSISTANT_TURNS + 1))
}

recent_history_json() {
  local n="${1:-24}"
  jq --argjson n "$n" 'if length > $n then .[-$n:] else . end' <<<"$HISTORY_JSON"
}

infer_pref_more_guidance_json() {
  if (( HELP_COUNT >= 2 || HELP_COUNT > OPTIMIZE_COUNT )); then
    printf "true"
  elif (( OPTIMIZE_COUNT >= 2 && HELP_COUNT == 0 )); then
    printf "false"
  else
    printf "null"
  fi
}

infer_pref_short_feedback_json() {
  local avg
  if (( USER_TURNS > 0 )); then
    avg=$((TOTAL_USER_CHARS / USER_TURNS))
  else
    avg=0
  fi
  if (( avg > 0 && avg <= 90 )); then
    printf "true"
  elif (( avg >= 200 )); then
    printf "false"
  else
    printf "null"
  fi
}

update_profile_preview() {
  local now pref_more_json pref_short_json tmp_file
  now="$(iso_utc)"
  pref_more_json="$(infer_pref_more_guidance_json)"
  pref_short_json="$(infer_pref_short_feedback_json)"
  tmp_file="$(mktemp)"

  jq \
    --arg now "$now" \
    --argjson pref_more "$pref_more_json" \
    --argjson pref_short "$pref_short_json" \
    '
    .updated_at = $now
    | .preference_profile.prefers_more_guidance =
        (if $pref_more == null then .preference_profile.prefers_more_guidance else $pref_more end)
    | .preference_profile.prefers_short_feedback =
        (if $pref_short == null then .preference_profile.prefers_short_feedback else $pref_short end)
    ' "$PROFILE_FILE" > "$tmp_file"

  mv "$tmp_file" "$PROFILE_FILE"
}

update_profile_final() {
  local summary_json="$1"
  local now scene intents_json pref_more_json pref_short_json tmp_file
  now="$(iso_utc)"
  scene="$(jq -r '.scene // "General conversation"' <<<"$summary_json")"
  intents_json="$(jq -c '.intents // []' <<<"$summary_json")"
  pref_more_json="$(infer_pref_more_guidance_json)"
  pref_short_json="$(infer_pref_short_feedback_json)"
  tmp_file="$(mktemp)"

  jq \
    --arg now "$now" \
    --arg scene "$scene" \
    --argjson intents "$intents_json" \
    --argjson assistant_turns "$ASSISTANT_TURNS" \
    --argjson optimize "$OPTIMIZE_COUNT" \
    --argjson help "$HELP_COUNT" \
    --argjson daily "$DAILY_COUNT" \
    --argjson pref_more "$pref_more_json" \
    --argjson pref_short "$pref_short_json" \
    '
    .updated_at = $now
    | .stats.total_sessions += 1
    | .stats.total_turns += $assistant_turns
    | .stats.total_optimize_requests += $optimize
    | .stats.total_help_requests += $help
    | .stats.total_daily_requests += $daily
    | .preference_profile.prefers_more_guidance =
        (if $pref_more == null then .preference_profile.prefers_more_guidance else $pref_more end)
    | .preference_profile.prefers_short_feedback =
        (if $pref_short == null then .preference_profile.prefers_short_feedback else $pref_short end)
    | ._counters.topic_counts[$scene] = ((._counters.topic_counts[$scene] // 0) + 1)
    | reduce $intents[] as $intent (.;
        if ($intent | type) == "string" and ($intent | length) > 0 then
          ._counters.intent_counts[$intent] = ((._counters.intent_counts[$intent] // 0) + 1)
        else
          .
        end
      )
    | .language_profile.optimize_usage_pattern.optimize_per_session_avg =
        (if .stats.total_sessions > 0
         then ((.stats.total_optimize_requests / .stats.total_sessions) * 100 | round / 100)
         else 0
         end)
    | .preference_profile.preferred_topics =
        ((._counters.topic_counts // {}) | to_entries | sort_by(-.value) | map(.key)[:5])
    | .language_profile.frequent_intents =
        ((._counters.intent_counts // {}) | to_entries | sort_by(-.value) | map(.key)[:8])
    | .preference_profile.daily_mode_frequency =
        (if .stats.total_sessions == 0 then "low"
         else (
           (.stats.total_daily_requests / .stats.total_sessions) as $ratio
           | if $ratio >= 0.7 then "high"
             elif $ratio >= 0.3 then "medium"
             else "low"
             end
         ) end)
    | .language_profile.estimated_level =
        (if $help >= 3 then "A2-B1 (needs scaffolding often)"
         elif $help == 0 and $optimize >= 2 then "B1+ (actively refining)"
         else .language_profile.estimated_level
         end)
    ' "$PROFILE_FILE" > "$tmp_file"

  mv "$tmp_file" "$PROFILE_FILE"
}

save_summary_record() {
  local summary_json="$1"
  local ended_at entry
  ended_at="$(iso_utc)"
  entry="$(
    jq -c -n \
      --arg session_id "$SESSION_ID" \
      --arg started_at "$SESSION_STARTED_AT" \
      --arg ended_at "$ended_at" \
      --argjson summary "$summary_json" \
      --argjson stats "$(session_stats_json)" \
      '{
        session_id: $session_id,
        started_at: $started_at,
        ended_at: $ended_at,
        summary: $summary,
        stats: $stats
      }'
  )"
  printf "%s\n" "$entry" >> "$SUMMARIES_FILE"
}

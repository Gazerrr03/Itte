# Itte v0 (Pure Bash CLI)

Itte is a minimal English speaking practice CLI:

- default: keep conversation going in English
- on demand: optimize expression with `/optimize`
- when stuck: `/help` gives translation/expression logic + topic continuation
- one daily round: `/daily`
- inspect runtime logs: `/logs`

This version is intentionally minimal:

- single executable Bash script
- OpenAI-compatible API over `curl`
- local persistence in `~/.itte`
- no local shell execution by model

## Requirements

- Bash
- `curl`
- `jq`

## Quick start

1) Copy env template:

```bash
cp .env.example .env
```

2) Fill your values in `.env`:

- `ITTE_API_BASE` (OpenAI-compatible base URL)
- `ITTE_API_KEY`
- `ITTE_MODEL`
- `ITTE_TEMPERATURE` (optional, default is `1`)
- `ITTE_STREAM` (optional, `1` for token streaming, `0` to disable; default `1`)
- `ITTE_COLOR_COMMANDS` (optional, `1` to color `/...` commands; default `1`)
- `ITTE_SHOW_THINKING` (optional, `1` to print `thinking...` while waiting for model output; default `1`)
- `ITTE_COMMAND_COLOR` (optional, command highlight color; default `purple`)
- `ITTE_TOPIC_COLOR` (optional, `/help` topic section color; default `green`)
- `ITTE_BILINGUAL_ASSIST` (optional, `1` for English+Chinese model replies; default `0`)

Tip: if you want `/setting` to control these values persistently, keep the three `ITTE_*` setting overrides unset in `.env`.

3) Make script executable:

```bash
chmod +x ./itte
```

4) Run:

```bash
./itte
```

Optional (recommended): install a user-level command so you can run `itte` directly:

```bash
./itte --install
```

Then restart terminal (or source your shell profile) and run:

```bash
itte
```

## Commands

```text
/optimize <text>   -> optimize your expression
/help <text>       -> explain translation/expression logic, then continue topic
/daily             -> start one daily guided round
/logs [n]          -> show latest structured run logs
/setting           -> open interactive settings
/commands          -> show command list
```

CLI flags:

```text
--help      show usage
--version   show version
--install   create ~/.local/bin/itte symlink
--uninstall remove ~/.local/bin/itte
```

Notes:

- `/optimize` and `/help` must include text.
- `/help` output has two sections: `Translation Logic` and `Continue the topic`.
- `/setting` opens an interactive settings UI (colors + bilingual assist).
- Exit session with `Ctrl+D` in terminal.
- Default output language is English.
- When bilingual assist is on, model replies are English first, then Chinese.

## Data storage

All local files are under:

```text
~/.itte/
```

Files:

- `profile.json`: language/profile memory (structured, lightweight)
- `summaries.jsonl`: one summary record per ended session
- `run_logs.jsonl`: structured model call logs (`request_id`, `mode`, `latency`, `error`, `tokens`)
- `settings.json`: persistent settings used by `/setting`
- `daily_topics.json`: daily topic source (copied from repo on first run)
- `current_session.json`: temporary state for current session

Privacy behavior:

- It does **not** persist full turn-by-turn transcripts to disk.
- It persists profile and summary only.

## Troubleshooting

### Missing env variables

If startup says env vars are missing, check `.env` or export variables directly:

```bash
export ITTE_API_BASE="https://api.openai.com"
export ITTE_API_KEY="..."
export ITTE_MODEL="gpt-4o-mini"
```

### API auth error (401/403)

- verify `ITTE_API_KEY`
- verify your model name is available on your provider

### Model not found

- check `ITTE_MODEL`
- check if your `ITTE_API_BASE` provider supports chat completions endpoint

### HTTP 404 on first message

- verify `ITTE_API_BASE`
- both `https://your-host` and `https://your-host/v1` are supported
- if your provider has a custom path, ensure it maps to a chat completions-compatible API

### invalid temperature: only 1 is allowed for this model

- set `ITTE_TEMPERATURE=1`
- the script also auto-retries once with `temperature=1` when this error appears

### Missing jq or curl

Install both tools first, then rerun `./itte`.

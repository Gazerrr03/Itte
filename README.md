# Itte

> **边说边学 / Learn While Speaking**
>
> 一个面向真实表达的英语陪练 agent —— 不是"学完再说"，而是直接开口，在对话中自然提升。
> An English speaking practice companion built for real expression — start speaking first, improve naturally through conversation.

---

## 产品哲学 / Product Philosophy

大多数英语工具把语言当成知识来教：批改、纠错、打分。Itte 走相反的路：**把语言当成使用工具，在使用中自然提升。**

- **表达优先**：agent 的第一任务是接住你说的话、推进对话，而不是评判你的语言质量
- **优化按需触发**：想打磨表达时，用 `/optimize` 或 `/help` 主动触发；系统不会自动跳出来纠错
- **搭脚手架，不给标准答案**：当你说不出来时，agent 拆解你的表达意图，帮你一步步说出来
- **默认英文环境**：即使用户中英混杂，agent 也用英文承接；中文只在深度追问时出现
- **长期只记画像，不存聊天记录**：只沉淀"能力画像"和"交流偏好"，不保留逐字对话

Most English tools treat language as knowledge to be taught — correcting, grading, scoring. Itte inverts this: **language is a tool you sharpen by using it.**

- **Expression first**: the agent's job is to catch what you say and keep the conversation going, not judge your grammar
- **Optimization on demand**: trigger `/optimize` or `/help` when *you* want to polish; the system never interrupts to correct you
- **Scaffolding, not answers**: when you're stuck, the agent breaks down your intent and helps you build the sentence yourself
- **English by default**: agent replies in English even when you mix languages; Chinese only on deep request
- **Profile, not transcripts**: long-term memory stores only your capability profile and preferences — never full conversation logs

完整设计原则见 → [PRD](itte_mvp_prd.md) · [Agent Loop Spec](itte_agent_loop_spec.md)

---

## 产品形态 / Products

Itte 有两个独立的产品形态，共享同一套 AI 后端和设计理念。

Itte ships as two standalone products sharing the same AI backend and design principles.

### CLI v0 (Bash)

极简终端入口。单文件 Bash 脚本，零依赖（除 `curl` + `jq`），适合随时随地快速开口。

A minimal terminal entry point. Single Bash script, no runtime besides `curl` + `jq`.

**Requirements:** Bash, `curl`, `jq`

**Quick start:**

```bash
cp .env.example .env
# Fill in ITTE_API_BASE, ITTE_API_KEY, ITTE_MODEL in .env
chmod +x ./itte
./itte
```

Optional — install as a user-level command:

```bash
./itte --install
# Then restart your shell and run: itte
```

**Env vars:** `ITTE_API_BASE`, `ITTE_API_KEY`, `ITTE_MODEL`, `ITTE_TEMPERATURE` (default `1`), `ITTE_STREAM` (default `1`), `ITTE_COLOR_COMMANDS`, `ITTE_SHOW_THINKING`, `ITTE_COMMAND_COLOR`, `ITTE_TOPIC_COLOR`, `ITTE_BILINGUAL_ASSIST`

### Web UI (Next.js)

完整的浏览器端体验。流式对话、多会话管理、TTS 语音朗读、主动式每日练习调度、用户画像追踪。

Full browser experience with streaming messages, multi-session management, TTS read-aloud, proactive daily practice scheduling, and persona tracking.

**Requirements:** Node.js 20+

**Quick start:**

```bash
cd web
npm install
cp .env.example .env
# Fill in ITTE_API_BASE, ITTE_API_KEY, ITTE_MODEL in .env

# First time only — initialize database
touch prisma/dev.db
npm run prisma:migrate -- --name init

npm run dev
# Open http://localhost:3000
```

**Key features:**
- Streaming message display with structured blocks (dialogue vs. guidance separation)
- TTS read-aloud (browser SpeechSynthesis, auto-read assistant dialogue)
- Proactive daily scheduling (3–6 random practice prompts per day)
- Multi-session management (create, rename, delete, switch)
- User persona tracking (language level, topic interests, interaction preferences)
- Settings panel (model, streaming, TTS engine/voice/rate)
- "Liquid glass" Zen UI design

---

## 命令 / Commands

所有 slash 命令在 CLI 和 Web 中通用。

All slash commands work identically in CLI and Web.

| Command | Description |
|---|---|
| `/optimize <text>` | 优化表达，让说法更自然 / Polish expression to sound more natural |
| `/help <text>` | 拆解翻译逻辑，给出表达脚手架，然后继续话题 / Break down translation logic, scaffold expression, continue topic |
| `/daily` | 启动一轮引导式每日练习 / Start a guided daily practice prompt |
| `/vibe <scene>` | 生成场景设定 + 一句角色对话 / Generate scene setup + one in-character dialogue line |
| `/logs [n]` | 查看最近运行日志 (CLI only) / Show recent run logs |
| `/setting` | 打开交互式设置 (CLI only) / Open interactive settings |

**CLI flags:**

```text
--help      显示用法 / Show usage
--version   显示版本 / Show version
--install   创建 ~/.local/bin/itte 软链接 / Create symlink
--uninstall 移除 ~/.local/bin/itte / Remove symlink
```

---

## 技术栈 / Tech Stack

| Layer | CLI | Web |
|---|---|---|
| Runtime | Bash | Node.js 20+ |
| Framework | — | Next.js 16 (App Router) |
| Language | Bash | TypeScript 5 |
| UI | Terminal ANSI | React 19, Tailwind CSS 4 |
| AI Client | `curl` → OpenAI-compatible API | Direct HTTP client (streaming + retry) |
| Database | JSON files (`~/.itte/`) | SQLite via Prisma (`@libsql/client`) |
| TTS | — | Browser SpeechSynthesis API |
| Deployment | Anywhere with Bash | Vercel / Fly.io (Docker) |

---

## 项目结构 / Project Structure

```text
itte                  # CLI 入口 / CLI entry point (single script)
lib/                  # CLI 模块 / CLI modules
  core.sh             #   时间、文本、ANSI 工具
  config.sh           #   持久化设置
  storage.sh          #   会话 JSON 读写
  api.sh              #   AI API 调用编排
  render.sh           #   输出格式化
  commands.sh         #   命令分发与输入历史
  settings_ui.sh      #   /setting 交互界面
web/                  # Web UI
  src/
    app/              #   Next.js App Router (页面 + API 路由)
    components/       #   React 组件 (ZenInput, AssistantBubble, Settings...)
    lib/              #   客户端库 (TTS, assistant format, API client)
    server/           #   服务端逻辑 (AI client, DB, services)
    types/            #   TypeScript 类型定义
  prisma/             #   数据库 Schema 与迁移
itte_mvp_prd.md       # 产品需求文档 / Product PRD
itte_agent_loop_spec.md  # Agent 循环设计规范
itte_cli_interaction.md  # CLI 交互示例
docs/                 # 技术文档 / Technical docs
Dockerfile            # Docker 构建
fly.toml              # Fly.io 部署配置
```

---

## 数据与隐私 / Data & Privacy

**CLI** — 所有数据存储在 `~/.itte/`：

All data under `~/.itte/`:

| File | Content |
|---|---|
| `profile.json` | 语言能力画像 + 交流偏好 / Language profile + preferences |
| `summaries.jsonl` | 每次 session 结束后的摘要 / Per-session summaries |
| `run_logs.jsonl` | API 调用日志 (request_id, mode, latency, tokens) |
| `settings.json` | `/setting` 持久化配置 |
| `current_session.json` | 当前会话临时状态 |

**CLI 不会**保存完整的逐轮对话记录到磁盘。

The CLI does **not** persist full turn-by-turn transcripts.

**Web** — 数据存储在本地 SQLite 数据库，包含：

Data stored in local SQLite database:

- 会话与消息 / Sessions and messages
- 用户画像快照 / User persona snapshot
- 每日话题记录 / Daily topic runs
- Web 设置 / Web settings (TTS, streaming, model)

---

## 设计文档 / Design Docs

- [PRD / 产品需求文档](itte_mvp_prd.md) — 8 条产品原则、用户承诺、版本路线
- [Agent Loop Spec / Agent 循环规范](itte_agent_loop_spec.md) — S1-S4 对话状态、优化循环、回复风格
- [CLI Interaction / CLI 交互示例](itte_cli_interaction.md) — 终端交互 mock
- [TTS Custom Voice Evaluation](docs/tts-custom-voice-evaluation.md) — TTS 语音方案评估

---

## 部署 / Deployment

### CLI

放到任何有 Bash 的机器上即可运行。用 `./itte --install` 创建全局命令。

Drop it on any machine with Bash. Use `./itte --install` for a global command.

### Web — Vercel

Web 目录可直接部署到 Vercel（Next.js 原生支持）。确保配置 `ITTE_API_BASE`、`ITTE_API_KEY`、`ITTE_MODEL` 环境变量和 `DATABASE_URL`。

The `web/` directory deploys directly to Vercel. Set `ITTE_API_BASE`, `ITTE_API_KEY`, `ITTE_MODEL`, and `DATABASE_URL` env vars.

### Web — Fly.io (Docker)

项目根目录的 `Dockerfile` 和 `fly.toml` 已配置好：

Pre-configured at repo root:

```bash
fly launch          # first time
fly deploy          # subsequent deploys
fly secrets set ITTE_API_BASE=... ITTE_API_KEY=... ITTE_MODEL=...
```

SQLite 数据通过 Fly volumes 持久化到 `/data/itte.db`。

SQLite data persists via Fly volumes at `/data/itte.db`.

---

## 故障排除 / Troubleshooting

### Missing env variables

If startup says env vars are missing, check `.env` or export directly:

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

### Web: Prisma migration fails

```bash
# Ensure the dev.db file exists
touch web/prisma/dev.db
npm run prisma:migrate -- --name init
```

### Web: Module not found or import errors

```bash
cd web
rm -rf node_modules
npm install
npm run prisma:generate
```

### Web: Cold start latency (Vercel / Fly.io)

The server initializes the database connection lazily on first request. Expect a brief delay on cold starts. Fly.io's `auto_start_machines` + `min_machines_running = 0` means the app scales to zero when idle.

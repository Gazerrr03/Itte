# Itte Web

Next.js + Tailwind web interface for Itte, with a local Bash session bridge.

## Start (development)

```bash
cd /Users/qizhi_dong/Projects/Itte/web
npm install
cp .env.example .env
touch prisma/dev.db
npm run prisma:migrate -- --name init
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## How Bash bridge works

- API route spawns the repo-root `itte` script as a child process.
- Sessions are managed by a resident process pool (`LRU=3`).
- Evicted sessions are reconstructed from stored user inputs before continuing.
- Allowed commands in web mode: normal chat + `/optimize` `/help` `/daily` `/vibe`.
- Arbitrary shell commands are not exposed.

## Required env

`itte` itself reads `/Users/qizhi_dong/Projects/Itte/.env` on startup. Ensure:

- `ITTE_API_BASE`
- `ITTE_API_KEY`
- `ITTE_MODEL`

## Useful scripts

```bash
npm run lint
npm run build
npm run start
npm run prisma:generate
npm run prisma:migrate
npm run prisma:studio
```

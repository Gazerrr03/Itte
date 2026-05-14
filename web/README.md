# Itte Web

Next.js + Tailwind web interface for Itte. See the [root README](../README.md) for full project context.

## Start (development)

```bash
npm install
cp .env.example .env
# Fill in ITTE_API_BASE, ITTE_API_KEY, ITTE_MODEL in .env

# First time only — initialize database
touch prisma/dev.db
npm run prisma:migrate -- --name init

npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Required env

- `ITTE_API_BASE`
- `ITTE_API_KEY`
- `ITTE_MODEL`

The web server connects directly to the OpenAI-compatible API — no external process dependency.

## Useful scripts

```bash
npm run lint
npm run build
npm run start
npm run prisma:generate
npm run prisma:migrate
npm run prisma:studio
```

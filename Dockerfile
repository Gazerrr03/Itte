FROM node:20-bookworm-slim

WORKDIR /app

# itte script depends on curl and jq at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl jq \
  && rm -rf /var/lib/apt/lists/*

COPY . .

RUN chmod +x /app/itte \
  && cd /app/web \
  && npm ci \
  && npx prisma generate \
  && npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bash", "-lc", "mkdir -p /data/web && cd /app/web && npx prisma migrate deploy && npm run start"]

FROM node:20-bookworm-slim

WORKDIR /app

# itte script depends on curl and jq at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl jq \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies before copying the full repository for better layer caching.
COPY web/package*.json /app/web/
RUN cd /app/web \
  && npm ci

COPY . .

RUN chmod +x /app/itte \
  && cd /app/web \
  && npx prisma generate \
  && npm run build

ENV NODE_ENV=production
ENV HOME=/data
EXPOSE 3000

CMD ["bash", "-c", "mkdir -p /data/web /data/.itte && cd /app/web && npx prisma migrate deploy && npm run start"]

# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @leksy/api... build && pnpm deploy --filter @leksy/api --prod --legacy /out

FROM node:22-bookworm-slim
# Chromium renders PDFs; fonts cover Indic scripts and the rupee sign.
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-core fonts-noto-ui-core ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production CHROMIUM_PATH=/usr/bin/chromium PORT=4000
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 4000
CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/server.js"]

FROM node:20-slim AS builder

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY services/agent9-ingestion/package.json ./services/agent9-ingestion/

RUN pnpm install --filter @sinaur/agent9-ingestion --frozen-lockfile

COPY services/agent9-ingestion/tsconfig.json ./services/agent9-ingestion/
COPY services/agent9-ingestion/src            ./services/agent9-ingestion/src

RUN pnpm --filter @sinaur/agent9-ingestion build

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/agent9-ingestion/package.json ./services/agent9-ingestion/

RUN pnpm install --filter @sinaur/agent9-ingestion --frozen-lockfile --prod

COPY --from=builder /app/services/agent9-ingestion/dist ./services/agent9-ingestion/dist

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3005/health', r => process.exit(r.statusCode===200?0:1))"

EXPOSE 3005

CMD ["node", "services/agent9-ingestion/dist/index.js"]

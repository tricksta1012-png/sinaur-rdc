FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY services/sync-gateway/package.json ./services/sync-gateway/
RUN pnpm install --filter @sinaur/sync-gateway --frozen-lockfile

COPY tsconfig.base.json .
COPY services/sync-gateway ./services/sync-gateway
RUN pnpm --filter @sinaur/sync-gateway exec tsc --project tsconfig.json

FROM node:20-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/sync-gateway/package.json ./services/sync-gateway/
RUN pnpm install --filter @sinaur/sync-gateway --frozen-lockfile --prod

COPY --from=builder /app/services/sync-gateway/dist ./services/sync-gateway/dist

ENV NODE_ENV=production
EXPOSE 3003
CMD ["node", "services/sync-gateway/dist/index.js"]

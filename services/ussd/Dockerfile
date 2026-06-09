FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY services/ussd/package.json ./services/ussd/
COPY packages/metrics/package.json ./packages/metrics/
RUN pnpm install --filter @sinaur-rdc/ussd --frozen-lockfile

COPY services/ussd ./services/ussd
COPY packages/metrics ./packages/metrics
RUN pnpm --filter @sinaur/metrics build
RUN pnpm --filter @sinaur-rdc/ussd build

FROM node:20-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/ussd/package.json ./services/ussd/
COPY packages/metrics/package.json ./packages/metrics/
RUN pnpm install --filter @sinaur-rdc/ussd --frozen-lockfile --prod

COPY --from=builder /app/services/ussd/dist ./services/ussd/dist
COPY --from=builder /app/packages/metrics/dist ./packages/metrics/dist

ENV NODE_ENV=production
EXPOSE 3002
CMD ["node", "services/ussd/dist/index.js"]

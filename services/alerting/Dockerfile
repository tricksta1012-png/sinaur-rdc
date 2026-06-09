FROM node:20-slim AS builder
WORKDIR /app
RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY services/alerting/package.json ./services/alerting/
RUN pnpm install --filter @sinaur-rdc/alerting --frozen-lockfile

COPY services/alerting/tsconfig.json ./services/alerting/
COPY services/alerting/src ./services/alerting/src
RUN pnpm --filter @sinaur-rdc/alerting build

FROM node:20-slim
WORKDIR /app
RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/alerting/package.json ./services/alerting/
RUN pnpm install --filter @sinaur-rdc/alerting --frozen-lockfile --prod

COPY --from=builder /app/services/alerting/dist ./services/alerting/dist

ENV NODE_ENV=production
CMD ["node", "services/alerting/dist/index.js"]

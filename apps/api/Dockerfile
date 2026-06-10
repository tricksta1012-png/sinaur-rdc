FROM node:20-alpine AS base
RUN npm install -g pnpm@9

FROM base AS builder
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/metrics/package.json ./packages/metrics/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @sinaur/metrics build
RUN pnpm --filter @sinaur/shared-types build
RUN pnpm --filter @sinaur/api build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm@9
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/metrics/package.json ./packages/metrics/
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/packages/metrics/dist ./packages/metrics/dist
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]

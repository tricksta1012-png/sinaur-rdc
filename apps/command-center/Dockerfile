FROM node:20-alpine AS base
RUN npm install -g pnpm@9

FROM base AS builder
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc* ./
COPY apps/command-center/package.json ./apps/command-center/
COPY apps/api/package.json ./apps/api/
COPY apps/public/package.json ./apps/public/
COPY apps/web/package.json ./apps/web/
COPY apps/mobile/package.json ./apps/mobile/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/metrics/package.json ./packages/metrics/
COPY packages/geo/package.json ./packages/geo/
COPY packages/i18n/package.json ./packages/i18n/
COPY packages/ui/package.json ./packages/ui/
COPY services/alerting/package.json ./services/alerting/
COPY services/ingestion/package.json ./services/ingestion/
COPY services/sync-gateway/package.json ./services/sync-gateway/
COPY services/ussd/package.json ./services/ussd/
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter @sinaur/shared-types build
RUN pnpm --filter @sinaur/command-center build

FROM nginx:alpine
COPY --from=builder /app/apps/command-center/dist /usr/share/nginx/html
COPY apps/command-center/nginx.conf /etc/nginx/conf.d/default.conf.template
EXPOSE 8080
CMD ["/bin/sh", "-c", "envsubst '${PORT}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]

FROM node:20-alpine AS base
RUN npm install -g pnpm@9

FROM base AS builder
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/command-center/package.json ./apps/command-center/
COPY packages/shared-types/package.json ./packages/shared-types/
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter @sinaur/shared-types build
RUN pnpm --filter @sinaur/command-center build

FROM nginx:alpine
COPY --from=builder /app/apps/command-center/dist /usr/share/nginx/html
COPY apps/command-center/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

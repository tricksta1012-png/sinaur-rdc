FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json tsconfig.json ./
COPY ../../tsconfig.base.json ../../tsconfig.base.json 2>/dev/null || true
RUN npm install

COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3002
CMD ["node", "dist/index.js"]

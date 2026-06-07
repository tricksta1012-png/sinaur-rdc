FROM node:20-slim

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile --prod

COPY dist/ ./dist/

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]

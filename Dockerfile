FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm run build

RUN rm -rf node_modules && pnpm install --frozen-lockfile --ignore-scripts --prod

# ---

FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache curl

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://127.0.0.1:8080/health || exit 1

# NODE_MAX_OLD_SPACE: t4g.small(2GB) 기준 1200MB. 환경변수로 override 가능
CMD ["sh", "-c", "node --max-old-space-size=${NODE_MAX_OLD_SPACE:-1200} dist/main.js"]

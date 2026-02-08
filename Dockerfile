FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install curl for ECS health check
RUN apk add --no-cache curl

# Copy package files and install dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts --prod

# Copy source and build
COPY . .
RUN pnpm run build

# Remove dev dependencies to reduce image size
RUN rm -rf node_modules && pnpm install --frozen-lockfile --ignore-scripts --prod

EXPOSE 8080

# Set Node.js memory limit for 1GB Fargate Task (80% = 800MB)
# This prevents OOM kills by keeping heap within container limits
# For 2GB Task, use: --max-old-space-size=1600
CMD ["node", "--max-old-space-size=800", "dist/main.js"]

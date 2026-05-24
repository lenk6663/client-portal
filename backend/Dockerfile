FROM node:20-alpine

WORKDIR /app

# Install deps (cached layer)
COPY package.json package-lock.json* ./
RUN npm install

# Source code (overridden by volume mount in dev)
COPY . .

EXPOSE 3000

# Default command — overridden by docker-compose per service (backend vs migrate)
CMD ["npx", "ts-node-dev", "--respawn", "--transpile-only", "src/index.ts"]

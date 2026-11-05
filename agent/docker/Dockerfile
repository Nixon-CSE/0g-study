FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 build-essential && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN pnpm build

FROM base AS run
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY package.json ./
# Tenant registry (incl. the Study Pod personas) and the example agent directories are baked in so the
# image runs on hosts without a bind mount (Railway, Render, Fly). The default agent is copied to /agent;
# mount a volume at /agent (and /app/data) to persist study logs, uploads and tenant edits across deploys.
COPY data ./data
COPY examples ./examples
COPY examples/default-agent /agent
ENV NODE_ENV=production
ENV AGENT_DIR=/agent
EXPOSE 7777
ENTRYPOINT ["sh", "-c", "exec node dist/index.js \"${AGENT_DIR}\""]

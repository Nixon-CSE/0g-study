FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 build-essential && rm -rf /var/lib/apt/lists/*
# Same major as CI and the lockfile; "latest" could change how installs and build scripts behave.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
# A stale lockfile fails the build here rather than quietly deploying different versions.
RUN pnpm install --frozen-lockfile

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
# Baked defaults: the Study Pod tenants and the agent directory. A volume at /agent hides anything the image
# puts there, so docker/entrypoint.sh copies these in, only when missing, at every boot. Everything the
# app writes (study/, uploads/, memory/, data/tenants.json, skills it installs) lives under /agent.
COPY data ./data
COPY examples ./examples
COPY examples/default-agent ./defaults/agent
COPY docker/entrypoint.sh ./docker/entrypoint.sh
ENV NODE_ENV=production
ENV AGENT_DIR=/agent
ENV TENANTS_FILE=/agent/data/tenants.json
EXPOSE 7777
ENTRYPOINT ["sh", "/app/docker/entrypoint.sh"]
CMD ["sh", "-c", "exec node /app/dist/index.js \"$AGENT_DIR\""]

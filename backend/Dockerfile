FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 build-essential && rm -rf /var/lib/apt/lists/*
# Same major as CI and the lockfile; "latest" could change how installs and build scripts behave.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
# mongodb-memory-server is for tests: skip its 66 MB mongod download. A stale lockfile fails the build.
ENV MONGOMS_DISABLE_POSTINSTALL=1
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

FROM base AS run
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["node", "dist/index.js"]

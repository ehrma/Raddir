FROM node:22-bookworm-slim AS base

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/

# Build
RUN pnpm --filter @raddir/shared build
RUN pnpm --filter @raddir/server build

# ─── Production stage ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS production

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY --from=base /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=base /app/packages/shared/package.json packages/shared/
COPY --from=base /app/packages/server/package.json packages/server/
COPY --from=base /app/packages/client/package.json packages/client/

RUN pnpm install --frozen-lockfile --prod

COPY --from=base /app/packages/shared/dist packages/shared/dist
COPY --from=base /app/packages/server/dist packages/server/dist

ENV RADDIR_HOST=0.0.0.0
ENV RADDIR_PORT=4000
ENV RADDIR_DB_PATH=/data/raddir.db
ENV RADDIR_RTC_MIN_PORT=40000
ENV RADDIR_RTC_MAX_PORT=49999

EXPOSE 4000
EXPOSE 40000-49999/udp

VOLUME ["/data"]

CMD ["node", "packages/server/dist/index.js"]

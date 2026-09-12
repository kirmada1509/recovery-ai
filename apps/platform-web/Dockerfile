# syntax=docker/dockerfile:1
FROM oven/bun:1.3-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY apps/platform-web/package.json apps/platform-web/
COPY packages/ts-config/package.json packages/ts-config/
RUN bun install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY packages ./packages
COPY apps/platform-web ./apps/platform-web
WORKDIR /app/apps/platform-web
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app ./
WORKDIR /app/apps/platform-web
USER bun
EXPOSE 3000
CMD ["bun", "run", "start"]

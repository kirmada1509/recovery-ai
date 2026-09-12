# syntax=docker/dockerfile:1
FROM oven/bun:1.3-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY apps/insurer-sandbox-web/package.json apps/insurer-sandbox-web/
COPY packages/ts-config/package.json packages/ts-config/
RUN bun install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY packages ./packages
COPY apps/insurer-sandbox-web ./apps/insurer-sandbox-web
WORKDIR /app/apps/insurer-sandbox-web
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app ./
WORKDIR /app/apps/insurer-sandbox-web
USER bun
EXPOSE 3010
CMD ["bun", "run", "start"]

# syntax=docker/dockerfile:1
FROM oven/bun:1.3-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY packages/config-ts/package.json packages/config-ts/
COPY packages/observability-ts/package.json packages/observability-ts/
COPY packages/service-runtime/package.json packages/service-runtime/
COPY packages/ts-config/package.json packages/ts-config/
COPY services/claims-service/package.json services/claims-service/
RUN bun install --frozen-lockfile --production

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY packages ./packages
COPY services/claims-service ./services/claims-service
USER bun
EXPOSE 3003
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD bun -e "fetch('http://127.0.0.1:3003/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "services/claims-service/src/index.ts"]

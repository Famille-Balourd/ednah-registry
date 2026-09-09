# syntax=docker/dockerfile:1
# ---- Studio Registry (Fastify + Drizzle + Postgres) ----
# Utilisée par Coolify pour builder/déployer automatiquement.

# 1) Base avec pnpm
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /app

# 2) Dépendances (cache optimisé)
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install

# 3) Build TypeScript
FROM deps AS build
COPY . .
RUN pnpm build

# 4) Runtime minimal (prod deps only)
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
# Dossier des artefacts d'update de l'app desktop (auto-update Tauri).
# DOIT être monté comme volume persistant en Docker/Coolify (voir README "Updates").
ENV UPDATES_DIR=/data/updates
RUN mkdir -p /data/updates
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --prod --frozen-lockfile || pnpm install --prod
# Artefacts buildés + migrations versionnées (pour drizzle-kit migrate au démarrage)
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
# Volume persistant pour les artefacts d'update (latest.json + .app.tar.gz + .sig).
# En Coolify : déclarer un Persistent Storage monté sur /data (ou /data/updates).
VOLUME ["/data/updates"]
EXPOSE 3000
# Healthcheck aligné sur /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1
# Applique les migrations puis démarre l'API.
CMD ["sh", "-c", "pnpm drizzle-kit migrate && node dist/server.js"]

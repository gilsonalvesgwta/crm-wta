# syntax=docker/dockerfile:1.7
# Imagens do CRM WTA: "api" (API, migrações e configuração inicial) e "web" (interface).

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
# Em produção o Traefik manda /api para a API; este endereço só vale para a
# regra de reserva da interface, dentro da rede da stack.
ARG API_INTERNAL_URL=http://api:3001
# Versão publicada (data e commit), mostrada na interface e na verificação de saúde.
ARG VERSAO=dev
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_VERSAO=$VERSAO
COPY . .
RUN pnpm --filter @crm/api build && pnpm --filter @crm/web build
RUN pnpm --filter @crm/api deploy --legacy --prod /out/api

FROM node:24-slim AS api
ARG VERSAO=dev
# Cliente do PostgreSQL 18 (repositório oficial do PostgreSQL): migrações, cópia e restauração.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && . /etc/os-release \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-18 \
    && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production VERSAO=$VERSAO
WORKDIR /app
COPY --from=build /out/api/node_modules ./node_modules
COPY --from=build /out/api/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
COPY packages/db /app/db
COPY deploy/backup /app/backup
COPY deploy/stack-migrate.sh /app/db/stack-migrate.sh
RUN chmod +x /app/db/*.sh /app/backup/*.sh \
    && mkdir -p /data/files && chown node:node /data/files
USER node
EXPOSE 3001
# Período de início longo: numa atualização, a API nova espera as migrações
# (healthz responde 503 até lá) sem ser dada como falha.
HEALTHCHECK --interval=10s --timeout=3s --start-period=180s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

FROM node:24-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/entrar').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

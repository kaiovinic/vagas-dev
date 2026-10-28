# Imagem do frontend. O contexto de build e a RAIZ do monorepo:
#   docker build -f apps/web/Dockerfile -t devradar-web .

# ---------------------------------------------------------------------------
# 1. deps
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci

# ---------------------------------------------------------------------------
# 2. build — Vite gera os estaticos com hash no nome
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# O npm faz hoisting: no monorepo existe um unico node_modules, na raiz.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/web ./apps/web

RUN npm run build --workspace @devradar/web

# ---------------------------------------------------------------------------
# 3. runner — Nginx servindo os estaticos e repassando /api para a API
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runner

# A imagem oficial ja traz um default.conf; o nosso substitui.
RUN rm /etc/nginx/conf.d/default.conf

COPY apps/web/nginx.conf /etc/nginx/conf.d/devradar.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

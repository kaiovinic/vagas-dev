# Imagem da API. O contexto de build e a RAIZ do monorepo, nao esta pasta:
#   docker build -f apps/api/Dockerfile -t devradar-api .
# O package-lock.json e unico para os dois workspaces, e sem ele na raiz nao
# existe install reproduzivel.

# ---------------------------------------------------------------------------
# 1. deps — dependencias completas, em camada propria para reaproveitar cache
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps

WORKDIR /app

# Apenas os manifestos: assim uma mudanca em src/ nao invalida o npm ci.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci

# ---------------------------------------------------------------------------
# 2. build — compila o TypeScript e resolve os aliases @/ para caminhos reais
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# O npm faz hoisting: no monorepo existe um unico node_modules, na raiz.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/api ./apps/api

# O build do Nest precisa do client do Prisma gerado para tipar as queries.
RUN npx prisma generate --schema apps/api/prisma/schema.prisma \
  && npm run build --workspace @devradar/api

# ---------------------------------------------------------------------------
# 3. runner — imagem final enxuta, sem devDependencies e sem codigo-fonte
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner

# Os engines do Prisma sao binarios ligados ao OpenSSL do sistema.
RUN apk add --no-cache openssl

# CHECKPOINT_DISABLE: o CLI do Prisma nao chama a telemetria a cada migration.
ENV NODE_ENV=production \
    PORT=3333 \
    CHECKPOINT_DISABLE=1

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# O schema e as migrations ficam na imagem: o `migrate deploy` le os dois.
COPY apps/api/prisma ./apps/api/prisma

# Instalar, gerar o client e limpar em UM UNICO RUN e deliberado: cada RUN vira
# uma camada, e uma camada nunca encolhe por apagar arquivo na seguinte — o
# conteudo continua no historico da imagem.
#
# O CLI do Prisma e devDependency, mas o entrypoint precisa dele para rodar as
# migrations; entra explicitamente, na mesma versao do @prisma/client (versoes
# diferentes entre CLI e client fazem o `migrate deploy` reclamar).
#
# O `prisma generate` roda aqui, e nao no estagio de build, para que o engine
# baixado seja o da musl/OpenSSL desta imagem.
#
# A limpeza remove os engines dos outros bancos (mysql, sqlite, sqlserver,
# cockroachdb): o Prisma carrega apenas o variante do provider declarado no
# schema, que aqui e postgresql.
#
# As copias do query engine em @prisma/engines e prisma/ parecem redundantes
# (~17 MB cada, alem da de .prisma/client que o client usa), mas NAO podem ser
# apagadas: o CLI confere a presenca delas e, se faltarem, tenta baixar o
# binario em tempo de execucao — o que falha, porque o container roda como
# `node` e nao escreve em /app/node_modules. Testado: o entrypoint entrava em
# loop com "Can't write to /app/node_modules/@prisma/engines".
#
# Nota: `npm ci --workspace @devradar/api` NAO reduz a instalacao. O lockfile e
# unico para o monorepo e o npm resolve a arvore inteira, de modo que as
# dependencias de producao do frontend vem junto (~60 MB). Filtrar exigiria um
# lockfile separado por workspace e abriria mao do install reproduzivel.
RUN npm ci --omit=dev \
  && npm install --no-save --omit=dev prisma@6.16.2 \
  && npx prisma generate --schema apps/api/prisma/schema.prisma \
  && for provider in mysql sqlite sqlserver cockroachdb; do \
       rm -f node_modules/@prisma/client/runtime/query_engine_bg."$provider"* \
             node_modules/prisma/build/query_engine_bg."$provider"* \
             node_modules/prisma/prisma-client/runtime/query_engine_bg."$provider"*; \
     done \
  && npm cache clean --force \
  && rm -rf /root/.npm /tmp/*

COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# O usuario `node` ja existe na imagem oficial, com uid 1000 e sem privilegios.
# Nao existe `chown -R /app` aqui: os arquivos pertencem ao root e sao legiveis
# por todos, o que basta — a API nunca escreve no proprio diretorio. O chown
# recursivo reescrevia o node_modules inteiro em uma camada nova e praticamente
# dobrava o tamanho final da imagem.
USER node

EXPOSE 3333

# Checagem de prontidao real: o endpoint consulta o banco antes de responder.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3333)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "apps/api/dist/main.js"]

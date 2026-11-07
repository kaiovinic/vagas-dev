# Imagem do coletor de publicacoes. O contexto de build e a RAIZ do monorepo:
#   docker build -f apps/posts-worker/Dockerfile -t devradar-posts-worker .
# O package-lock.json e unico para os tres workspaces, e sem ele na raiz nao
# existe install reproduzivel.
#
# A base NAO e a `node:22-alpine` da API, e e por isso que este servico existe
# separado (RFC 001, secao 4): o Chromium do Playwright e ligado a glibc e nao
# sobe na musl do Alpine. Nao e preferencia, e incompatibilidade.
#
# A tag casa EXATAMENTE com o `playwright` do package.json (1.63.0). A imagem
# traz os navegadores em /ms-playwright, e cada versao do pacote espera uma
# revisao especifica: com as duas fora de sincronia o worker sobe e quebra na
# primeira navegacao, reclamando de navegador ausente.
ARG PLAYWRIGHT_VERSION=v1.63.0-jammy

# ---------------------------------------------------------------------------
# 1. deps — dependencias de producao, em camada propria para reaproveitar cache
# ---------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_VERSION} AS deps

WORKDIR /app

# Apenas os manifestos: assim uma mudanca em src/ nao invalida o npm ci.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/posts-worker/package.json apps/posts-worker/

# Nao ha estagio de build, e isto e deliberado.
#
# O worker roda o TypeScript direto, pelo `tsx`. Compilar exigiria reescrever
# os aliases `@/` para caminhos reais (o `tsc` sozinho nao o faz) e traria mais
# uma ferramenta para o processo de build. O `tsx` resolve os aliases pelo
# proprio tsconfig e custa ~30 MB numa imagem que ja carrega um Chromium de
# 500 MB: o ganho de compilar seria invisivel aqui.
#
# `--omit=dev` corta vitest, eslint e typescript; o `tsx` volta explicitamente,
# na versao exata do package.json, porque e ele quem executa em producao.
#
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: os navegadores ja estao na imagem. Sem
# isto, o postinstall do pacote baixaria outros 500 MB para dentro da camada.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN npm ci --omit=dev \
  && npm install --no-save --omit=dev tsx@4.20.6 \
  && npm cache clean --force \
  && rm -rf /root/.npm /tmp/*

# ---------------------------------------------------------------------------
# 2. runner — imagem final: node_modules, fonte do worker e nada mais
# ---------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_VERSION} AS runner

# POSTS_WORKER_DATA_DIR aponta para o volume, e nao para a pasta do workspace:
# o que sobrevive a um restart mora no volume, e o container e descartavel.
ENV NODE_ENV=production \
    TZ=America/Bahia \
    POSTS_WORKER_PORT=4000 \
    POSTS_WORKER_DATA_DIR=/data \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/posts-worker ./apps/posts-worker

# A pasta do volume nasce na imagem para herdar o dono: quando o Docker cria um
# volume nomeado vazio, ele copia dono e permissao do diretorio que existia
# aqui. Sem este chown o volume nasceria do root e o `pwuser` nao conseguiria
# gravar nem a sessao nem a colheita.
RUN mkdir -p /data && chown pwuser:pwuser /data

VOLUME ["/data"]

# `pwuser` ja existe na imagem do Playwright, sem privilegios. Navegador rodando
# como root e risco gratuito: uma pagina hostil passa a ter a maquina.
USER pwuser

EXPOSE 4000

# Checagem real: a rota le o volume e responde 200 enquanto o servidor estiver
# de pe. Ela devolve `degraded` no corpo, e nao erro, quando falta a sessao —
# nenhum restart traz uma sessao de volta, e reiniciar em laco so esconderia a
# causa (RFC 001, secao 11).
HEALTHCHECK --interval=60s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.POSTS_WORKER_PORT||4000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# `node --import tsx`, e nao `npm run serve`: assim o PID 1 e o proprio node e o
# SIGTERM do `docker stop` chega ao processo que sabe encerrar limpo. Com o npm
# no meio, o sinal pode morrer no wrapper e o container levar SIGKILL — que e
# exatamente o que corromperia uma colheita em gravacao.
CMD ["node", "--import", "tsx", "apps/posts-worker/src/scripts/serve.ts"]

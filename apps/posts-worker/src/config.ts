import { resolve } from 'node:path';

/**
 * Pasta de dados do worker. Em producao e um volume nomeado
 * (`devradar-linkedin-session`); em desenvolvimento, `apps/posts-worker/data`.
 *
 * Tudo que sobrevive a um restart mora aqui, e nada mais: o servico e
 * descartavel, o volume nao.
 */
export const DATA_DIR = resolve(
  process.env.POSTS_WORKER_DATA_DIR ?? resolve(__dirname, '..', 'data'),
);

/**
 * Sessao do LinkedIn em JSON (`storageState` do Playwright).
 *
 * E CREDENCIAL: quem tem este arquivo entra na conta. Nunca em imagem Docker,
 * nunca em log, nunca em mensagem. O `.gitignore` da pasta cobre o acidente
 * mais provavel.
 */
export const STATE_FILE = resolve(DATA_DIR, 'state.json');

/** Ultima colheita, servida como corpo do `GET /posts`. */
export const HARVEST_FILE = resolve(DATA_DIR, 'harvest.json');

/** Trava de instancia unica (`proper-lockfile`), ao lado do que ela protege. */
export const LOCK_FILE = resolve(DATA_DIR, '.lock');

/**
 * Porta do `GET /posts` quando o ambiente nao diz outra.
 *
 * E a mesma que o `LINKEDIN_POSTS_WORKER_URL` da API usa por padrao; fora do
 * compose ninguem alcanca o worker, que nao e exposto para fora da rede
 * interna.
 */
export const DEFAULT_PORT = 4000;

const MAX_PORT = 65535;

/**
 * Porta invalida cai no padrao em vez de derrubar o boot.
 *
 * O worker so serve cache: um servico de pe na porta errada aparece no primeiro
 * `GET /health` que a API nao consegue fazer, enquanto um container em loop de
 * restart esconde a causa atras do ruido.
 */
export function parsePort(raw: string | undefined): number {
  const port = Number(raw);

  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    return DEFAULT_PORT;
  }

  return port;
}

export const PORT = parsePort(process.env.POSTS_WORKER_PORT);

/**
 * Limites rigidos da colheita (RFC 001, secao 8).
 *
 * Nao sao afinacao de desempenho: sao o que impede uma busca ampla de virar
 * meia hora de navegador logado dentro do LinkedIn. O que custa aqui e a conta,
 * nao o tempo de CPU.
 */
export const DEFAULT_MAX_SCROLLS = 8;

export const DEFAULT_POSTS_PER_SEARCH = 15;

export const DEFAULT_TIMEOUT_IN_MS = 30_000;

/**
 * Inteiro positivo do ambiente, com padrao.
 *
 * `trim` antes, e ausente e em branco valendo a mesma coisa: foi um
 * `SERP_ENDPOINT` vazio chegando ao contêiner que deixou o outro coletor cinco
 * dias fora do ar. Valor invalido cai no padrao em vez de derrubar o boot —
 * worker de pe com limite padrao e melhor que container em loop de restart.
 */
export function parsePositive(raw: string | undefined, fallback: number): number {
  const value = Number(raw?.trim());

  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const MAX_SCROLLS = parsePositive(
  process.env.LINKEDIN_POSTS_MAX_SCROLLS,
  DEFAULT_MAX_SCROLLS,
);

export const POSTS_PER_SEARCH = parsePositive(
  process.env.LINKEDIN_POSTS_PER_QUERY,
  DEFAULT_POSTS_PER_SEARCH,
);

export const NAVIGATION_TIMEOUT_IN_MS = parsePositive(
  process.env.LINKEDIN_POSTS_TIMEOUT_MS,
  DEFAULT_TIMEOUT_IN_MS,
);

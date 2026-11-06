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

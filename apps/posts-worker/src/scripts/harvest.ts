/**
 * Uma colheita, do comeco ao fim. Rode com `npm run harvest -w @devradar/posts-worker`.
 *
 * Esta e a entrada do coletor: pega a trava de instancia unica, le a colheita
 * anterior, abre o Chromium com a sessao gravada, navega as buscas e grava o
 * `harvest.json`. Nao agenda nada — quem chama de hora em hora e o agendador
 * (ainda nao implementado: hoje a chamada e manual ou por cron de fora).
 *
 * Sai com 0 quando gravou, 0 tambem quando outra colheita ja estava em curso
 * (isso e normal, nao erro), e 1 so quando nada foi gravado.
 */
import {
  DATA_DIR,
  HARVEST_FILE,
  LOCK_FILE,
  MAX_SCROLLS,
  NAVIGATION_TIMEOUT_IN_MS,
  POSTS_PER_SEARCH,
  STATE_FILE,
} from '@/config';
import { readPreviousHarvest, writeHarvest } from '@/harvest/harvest-file';
import { runHarvest } from '@/harvest/harvest-runner';
import { openPostsBrowser } from '@/harvest/playwright/playwright-posts-page';
import { POSTS_SEARCHES } from '@/harvest/searches';
import { acquireHarvestLock } from '@/harvest/single-instance';

async function main(): Promise<void> {
  const held = await acquireHarvestLock({
    warn: (message) => console.warn(message),
    dataDir: DATA_DIR,
    lockFile: LOCK_FILE,
  });

  if (!held.acquired) {
    console.info(`Outra colheita esta em curso; esta sai sem fazer nada. ${held.reason}`);

    return;
  }

  try {
    await harvestOnce();
  } finally {
    await held.release();
  }
}

async function harvestOnce(): Promise<void> {
  const previous = await readPreviousHarvest();
  const browser = await openPostsBrowser({
    stateFile: STATE_FILE,
    timeoutInMs: NAVIGATION_TIMEOUT_IN_MS,
  });

  try {
    const harvest = await runHarvest({
      page: browser.page,
      previous,
      searches: POSTS_SEARCHES,
      maxScrolls: MAX_SCROLLS,
      postsPerSearch: POSTS_PER_SEARCH,
      now: () => new Date(),
      pause: wait,
      log: (message) => console.info(message),
    });

    await writeHarvest(harvest);

    report(harvest.status, harvest.posts.length);
  } finally {
    await browser.close();
  }
}

function report(status: string, posts: number): void {
  console.info(`Colheita gravada em ${HARVEST_FILE}: status ${status}, ${posts} publicacao(oes)`);

  if (status === 'session-lost') {
    console.warn('A sessao caiu. Refaca o login (npm run session:login) antes da proxima.');
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

void main().catch((error: unknown) => {
  console.error(`A colheita falhou e nada foi gravado: ${String(error)}`);
  process.exit(1);
});

/**
 * Uma colheita com os ajustes do ambiente, do comeco ao fim.
 *
 * E a unica funcao que junta tudo: trava de processo, colheita anterior,
 * navegador, orquestrador e gravacao. Mora ao lado do adaptador do Playwright, e
 * nao em `harvest/`, porque abre navegador de verdade e por isso fica fora da
 * conta de cobertura — cada peca que ela chama e testada por si, e o que sobra
 * aqui e a ligacao entre elas.
 *
 * Dois caminhos a chamam: o `npm run harvest`, a mao, e o agendador dentro do
 * `serve.ts`. Sao processos diferentes, e e por isso que a trava existe.
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

export interface ConfiguredHarvestDeps {
  readonly log: (message: string) => void;
  readonly warn: (message: string) => void;
}

/**
 * Quem nao pega a trava SAI, e nao espera.
 *
 * Duas colheitas ao mesmo tempo sao dois Chromium na mesma conta — e quem
 * perdeu a vez vai ser chamado de novo pelo agendador daqui a algumas horas.
 */
export async function runConfiguredHarvest(deps: ConfiguredHarvestDeps): Promise<void> {
  const held = await acquireHarvestLock({
    warn: deps.warn,
    dataDir: DATA_DIR,
    lockFile: LOCK_FILE,
  });

  if (!held.acquired) {
    deps.log(`Outra colheita esta em curso; esta sai sem fazer nada. ${held.reason}`);

    return;
  }

  try {
    await harvestWithBrowser(deps);
  } finally {
    await held.release();
  }
}

async function harvestWithBrowser(deps: ConfiguredHarvestDeps): Promise<void> {
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
      log: deps.log,
    });

    await writeHarvest(harvest);

    deps.log(
      `Colheita gravada em ${HARVEST_FILE}: status ${harvest.status}, ${harvest.posts.length} publicacao(oes)`,
    );

    if (harvest.status === 'session-lost') {
      deps.warn('A sessao caiu. Refaca o login (npm run session:login) antes da proxima.');
    }
  } finally {
    await browser.close();
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

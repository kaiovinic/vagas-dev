import { mkdir } from 'node:fs/promises';

import { lock } from 'proper-lockfile';

/** Trava considerada abandonada: o processo morreu sem soltar. */
const STALE_IN_MS = 60_000;

export type ReleaseLock = () => Promise<void>;

export type InstanceLock =
  | { readonly acquired: true; readonly release: ReleaseLock }
  | { readonly acquired: false; readonly reason: string };

export interface InstanceLockDeps {
  /** Para onde vai o aviso de trava perdida no meio da colheita. */
  readonly warn: (message: string) => void;
  /**
   * Caminhos sem padrao embutido, de proposito: quem chama passa os do
   * `config`. Caminho com dois donos — um padrao aqui e outro na configuracao —
   * e como se perde uma trava sem ninguem notar.
   */
  readonly dataDir: string;
  readonly lockFile: string;
  /**
   * Quando a trava conta como abandonada. Em teste e o minimo que a biblioteca
   * aceita, para que o caso "trava sumiu no meio" caiba em um teste de verdade
   * em vez de ficar sem cobertura.
   */
  readonly staleInMs?: number;
}

/**
 * Garante uma colheita por vez.
 *
 * Nao e zelo excessivo: duas colheitas ao mesmo tempo significam dois Chromium
 * na mesma conta, com a mesma sessao, batendo nas mesmas buscas — o padrao mais
 * parecido com robo que este projeto consegue produzir, e o caminho curto para
 * o LinkedIn restringir a conta. O custo de perder uma colheita e uma hora de
 * atraso; o de perder a conta e o projeto.
 *
 * Quem nao conseguiu a trava SAI, e nao espera: o agendador vai chamar de novo.
 */
export async function acquireHarvestLock(deps: InstanceLockDeps): Promise<InstanceLock> {
  await mkdir(deps.dataDir, { recursive: true });

  try {
    const release = await lock(deps.dataDir, {
      lockfilePath: deps.lockFile,
      realpath: false,
      stale: deps.staleInMs ?? STALE_IN_MS,
      retries: 0,
      // Sem isto o proper-lockfile LANCA de dentro de um temporizador, o que
      // derruba o processo no meio da colheita. Avisar e seguir e melhor: no
      // pior caso a gravacao disputa a trava do harvest, que tem a sua propria.
      onCompromised: (error) => {
        deps.warn(`Trava da colheita perdida no meio do caminho: ${error.message}`);
      },
    });

    return { acquired: true, release };
  } catch (error) {
    return { acquired: false, reason: String(error) };
  }
}

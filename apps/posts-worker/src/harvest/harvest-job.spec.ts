import { describe, expect, it } from 'vitest';

import { HarvestJob, type HarvestJobDeps } from '@/harvest/harvest-job';

interface Recorded {
  readonly logs: string[];
  readonly warnings: string[];
}

/** Uma colheita que o teste controla: resolve quando mandarem. */
function pending(): { readonly work: () => Promise<void>; finish: () => void; fail: () => void } {
  let settle: (() => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  const promise = new Promise<void>((done, failed) => {
    settle = done;
    reject = failed;
  });

  return {
    work: () => promise,
    finish: () => settle?.(),
    fail: () => reject?.(new Error('o Chromium morreu')),
  };
}

function jobWith(
  overrides: Partial<HarvestJobDeps> = {},
): { readonly job: HarvestJob; readonly recorded: Recorded } {
  const recorded: Recorded = { logs: [], warnings: [] };
  const job = new HarvestJob({
    harvest: () => Promise.resolve(),
    isSessionPresent: () => Promise.resolve(true),
    log: (message) => recorded.logs.push(message),
    warn: (message) => recorded.warnings.push(message),
    ...overrides,
  });

  return { job, recorded };
}

describe('HarvestJob', () => {
  it('dispara a colheita e volta sem esperar por ela', async () => {
    const controlled = pending();
    const { job } = jobWith({ harvest: controlled.work });

    await expect(job.start()).resolves.toBe('started');
    expect(job.running).toBe(true);

    controlled.finish();
    await job.settle(100);
  });

  /**
   * O ponto do arquivo: duas colheitas ao mesmo tempo sao dois Chromium na
   * mesma conta. A segunda nao entra na fila — ela e recusada.
   */
  it('recusa a segunda enquanto a primeira nao terminou', async () => {
    const controlled = pending();
    const { job } = jobWith({ harvest: controlled.work });

    await job.start();

    await expect(job.start()).resolves.toBe('already-running');

    controlled.finish();
    await job.settle(100);
  });

  it('depois de terminar, aceita a proxima', async () => {
    const { job } = jobWith();

    await job.start();
    await job.settle(100);

    await expect(job.start()).resolves.toBe('started');
    await job.settle(100);
  });

  /** Abrir o Chromium para ser barrado no login gasta um acesso a conta. */
  it('sem state.json nao abre navegador nenhum', async () => {
    let opened = false;
    const { job, recorded } = jobWith({
      isSessionPresent: () => Promise.resolve(false),
      harvest: () => {
        opened = true;

        return Promise.resolve();
      },
    });

    await expect(job.start()).resolves.toBe('no-session');
    expect(opened).toBe(false);
    expect(recorded.logs[0]).toContain('state.json');
  });

  it('sessao ausente nao deixa o trabalho marcado como ocupado', async () => {
    const { job } = jobWith({ isSessionPresent: () => Promise.resolve(false) });

    await job.start();

    expect(job.running).toBe(false);
  });

  it('conferencia de sessao que falha e tratada como sessao ausente', async () => {
    const { job, recorded } = jobWith({
      isSessionPresent: () => Promise.reject(new Error('disco sumiu')),
    });

    await expect(job.start()).resolves.toBe('no-session');
    expect(recorded.warnings[0]).toContain('conferir a sessao');
  });

  /** A colheita que explode nao pode derrubar o Fastify que a disparou. */
  it('colheita que falha e relatada, e nao propagada', async () => {
    const controlled = pending();
    const { job, recorded } = jobWith({ harvest: controlled.work });

    await job.start();
    controlled.fail();

    await expect(job.settle(100)).resolves.toBe(true);
    expect(recorded.warnings[0]).toContain('o Chromium morreu');
    expect(job.running).toBe(false);
  });

  it('esperar sem colheita em curso termina na hora', async () => {
    const { job } = jobWith();

    await expect(job.settle(100)).resolves.toBe(true);
  });

  /** O `docker stop` da poucos segundos: esperar sem prazo e virar SIGKILL. */
  it('esperar com prazo vencido devolve falso, e nao trava', async () => {
    const controlled = pending();
    const { job } = jobWith({ harvest: controlled.work });

    await job.start();

    await expect(job.settle(20)).resolves.toBe(false);

    controlled.finish();
    await job.settle(100);
  });
});

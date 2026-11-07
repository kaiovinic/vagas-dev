import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { check } from 'proper-lockfile';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { acquireHarvestLock, type InstanceLockDeps } from '@/harvest/single-instance';

describe('acquireHarvestLock', () => {
  let dir: string;
  let warnings: string[];
  let deps: InstanceLockDeps;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'devradar-lock-'));
    warnings = [];
    deps = {
      warn: (message) => warnings.push(message),
      dataDir: dir,
      lockFile: join(dir, '.lock'),
    };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('a primeira colheita pega a trava', async () => {
    const acquired = await acquireHarvestLock(deps);

    expect(acquired.acquired).toBe(true);

    if (acquired.acquired) {
      await acquired.release();
    }
  });

  /**
   * O ponto do arquivo: duas colheitas ao mesmo tempo sao dois Chromium na
   * mesma conta, que e o jeito mais rapido de o LinkedIn restringi-la.
   */
  it('a segunda nao pega, e diz por que', async () => {
    const first = await acquireHarvestLock(deps);

    const second = await acquireHarvestLock(deps);

    expect(second.acquired).toBe(false);

    if (!second.acquired) {
      expect(second.reason).toContain('Lock');
    }

    if (first.acquired) {
      await first.release();
    }
  });

  it('depois de soltar, a proxima pega de novo', async () => {
    const first = await acquireHarvestLock(deps);

    if (first.acquired) {
      await first.release();
    }

    const second = await acquireHarvestLock(deps);

    expect(second.acquired).toBe(true);

    if (second.acquired) {
      await second.release();
    }
  });

  it('a trava solta nao fica marcada no disco', async () => {
    const acquired = await acquireHarvestLock(deps);

    if (acquired.acquired) {
      await acquired.release();
    }

    await expect(
      check(dir, { lockfilePath: join(dir, '.lock'), realpath: false }),
    ).resolves.toBe(false);
  });

  it('cria a pasta de dados que ainda nao existe', async () => {
    const nested = join(dir, 'data');
    const acquired = await acquireHarvestLock({
      warn: deps.warn,
      dataDir: nested,
      lockFile: join(nested, '.lock'),
    });

    expect(acquired.acquired).toBe(true);

    if (acquired.acquired) {
      await acquired.release();
    }
  });

  /**
   * O que acontecia sem o `onCompromised`: o proper-lockfile LANCA de dentro do
   * temporizador que renova a trava, e o processo morre no meio da colheita,
   * com o Chromium aberto. Avisar e seguir e o comportamento que se quer.
   */
  it('trava apagada no meio do caminho avisa, e nao derruba o processo', async () => {
    const lockFile = join(dir, '.lock');
    const acquired = await acquireHarvestLock({ ...deps, staleInMs: 2_000 });

    await rm(lockFile, { recursive: true, force: true });
    await new Promise((done) => setTimeout(done, 1_500));

    expect(warnings[0]).toContain('Trava da colheita perdida');
    expect(acquired.acquired).toBe(true);
  });

  it('nao avisa nada enquanto a trava esta de pe', async () => {
    const acquired = await acquireHarvestLock(deps);

    if (acquired.acquired) {
      await acquired.release();
    }

    expect(warnings).toEqual([]);
  });
});

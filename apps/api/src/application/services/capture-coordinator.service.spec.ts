import { describe, expect, it, vi } from 'vitest';

import { CaptureCoordinator } from '@/application/services/capture-coordinator.service';
import type { RunJobCollectionUseCase } from '@/application/use-cases/run-job-collection.use-case';
import { FIXED_NOW } from '../../../test/factories/make-job';

const REPORT = {
  captureId: 'capture-1',
  startedAt: FIXED_NOW,
  finishedAt: FIXED_NOW,
  nextRunAt: new Date(FIXED_NOW.getTime() + 7_200_000),
  status: 'SUCCESS' as const,
  totalFound: 10,
  totalApproved: 4,
  totalRejected: 6,
  totalDuplicated: 1,
  totalPersisted: 3,
  failedSources: [],
};

/** Captura controlada: o teste decide quando ela termina. */
function deferredUseCase(): {
  useCase: RunJobCollectionUseCase;
  finish: () => void;
  calls: () => number;
} {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const execute = vi.fn(async () => {
    await pending;

    return REPORT;
  });

  return {
    useCase: { execute } as unknown as RunJobCollectionUseCase,
    finish: release,
    calls: () => execute.mock.calls.length,
  };
}

describe('CaptureCoordinator', () => {
  it('executa a captura e devolve o relatorio', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue(REPORT) } as unknown as
      RunJobCollectionUseCase;

    await expect(new CaptureCoordinator(useCase).run()).resolves.toEqual({
      report: REPORT,
      joinedRunning: false,
    });
  });

  it('comeca ocioso', () => {
    const useCase = { execute: vi.fn() } as unknown as RunJobCollectionUseCase;

    expect(new CaptureCoordinator(useCase).isRunning).toBe(false);
  });

  it('fica marcado como rodando durante a captura', async () => {
    const { useCase, finish } = deferredUseCase();
    const coordinator = new CaptureCoordinator(useCase);

    const running = coordinator.run();

    expect(coordinator.isRunning).toBe(true);

    finish();
    await running;

    expect(coordinator.isRunning).toBe(false);
  });

  it('nao abre uma segunda captura: a chamada paralela aguarda a primeira', async () => {
    const { useCase, finish, calls } = deferredUseCase();
    const coordinator = new CaptureCoordinator(useCase);

    const primeira = coordinator.run();
    const segunda = coordinator.run();

    finish();

    const [um, dois] = await Promise.all([primeira, segunda]);

    // Uma varredura so nas cinco fontes, mesmo com dois pedidos.
    expect(calls()).toBe(1);
    expect(um.joinedRunning).toBe(false);
    expect(dois.joinedRunning).toBe(true);
    expect(dois.report).toEqual(REPORT);
  });

  it('libera a trava e permite uma nova captura depois da primeira terminar', async () => {
    const execute = vi.fn().mockResolvedValue(REPORT);
    const coordinator = new CaptureCoordinator({ execute } as unknown as RunJobCollectionUseCase);

    await coordinator.run();
    await coordinator.run();

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('libera a trava mesmo quando a captura falha', async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('banco fora'))
      .mockResolvedValueOnce(REPORT);
    const coordinator = new CaptureCoordinator({ execute } as unknown as RunJobCollectionUseCase);

    await expect(coordinator.run()).rejects.toThrow('banco fora');
    expect(coordinator.isRunning).toBe(false);

    await expect(coordinator.run()).resolves.toMatchObject({ joinedRunning: false });
  });
});

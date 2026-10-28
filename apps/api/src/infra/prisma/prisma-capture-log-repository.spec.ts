import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaCaptureLogRepository } from '@/infra/prisma/prisma-capture-log-repository';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import { FIXED_NOW } from '../../../test/factories/make-job';

interface PrismaStub {
  captureLog: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
}

const NEXT_RUN_AT = new Date(FIXED_NOW.getTime() + 7_200_000);

describe('PrismaCaptureLogRepository', () => {
  let prisma: PrismaStub;
  let repository: PrismaCaptureLogRepository;

  beforeEach(() => {
    prisma = {
      captureLog: {
        create: vi.fn().mockResolvedValue({ id: 'capture-1' }),
        update: vi.fn().mockResolvedValue({}),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    repository = new PrismaCaptureLogRepository(prisma as unknown as PrismaService);
  });

  describe('start', () => {
    it('abre o log em RUNNING com a previsao da proxima captura', async () => {
      await expect(
        repository.start({ startedAt: FIXED_NOW, nextRunAt: NEXT_RUN_AT }),
      ).resolves.toBe('capture-1');

      expect(prisma.captureLog.create).toHaveBeenCalledWith({
        data: { startedAt: FIXED_NOW, nextRunAt: NEXT_RUN_AT, status: 'RUNNING' },
        select: { id: true },
      });
    });
  });

  describe('finish', () => {
    it('grava os totais e o status final', async () => {
      await repository.finish({
        captureId: 'capture-1',
        finishedAt: FIXED_NOW,
        status: 'PARTIAL',
        totalFound: 30,
        totalApproved: 12,
        totalRejected: 18,
        totalDuplicated: 4,
        totalPersisted: 8,
        failedSources: ['linkedin'],
      });

      expect(prisma.captureLog.update).toHaveBeenCalledWith({
        where: { id: 'capture-1' },
        data: {
          finishedAt: FIXED_NOW,
          status: 'PARTIAL',
          totalFound: 30,
          totalApproved: 12,
          totalRejected: 18,
          totalDuplicated: 4,
          totalPersisted: 8,
          failedSources: ['linkedin'],
          errorMessage: null,
        },
      });
    });

    it('persiste a mensagem de erro quando a captura falha inteira', async () => {
      await repository.finish({
        captureId: 'capture-2',
        finishedAt: FIXED_NOW,
        status: 'FAILED',
        totalFound: 0,
        totalApproved: 0,
        totalRejected: 0,
        totalDuplicated: 0,
        totalPersisted: 0,
        failedSources: ['gupy', 'remotar'],
        errorMessage: 'Todas as 2 fontes falharam',
      });

      const [[call]] = prisma.captureLog.update.mock.calls as [
        [{ data: Record<string, unknown> }],
      ];

      expect(call.data.errorMessage).toBe('Todas as 2 fontes falharam');
    });
  });

  describe('findLastFinished', () => {
    it('devolve a ultima captura concluida, ignorando as em andamento', async () => {
      prisma.captureLog.findFirst.mockResolvedValue({
        startedAt: FIXED_NOW,
        finishedAt: new Date(FIXED_NOW.getTime() + 20_000),
        nextRunAt: NEXT_RUN_AT,
        status: 'SUCCESS',
        totalPersisted: 7,
        failedSources: [],
      });

      await expect(repository.findLastFinished()).resolves.toEqual({
        startedAt: FIXED_NOW,
        finishedAt: new Date(FIXED_NOW.getTime() + 20_000),
        nextRunAt: NEXT_RUN_AT,
        status: 'SUCCESS',
        totalPersisted: 7,
        failedSources: [],
      });
      expect(prisma.captureLog.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { finishedAt: { not: null } },
          orderBy: { startedAt: 'desc' },
        }),
      );
    });

    it('devolve nulo quando nunca houve captura concluida', async () => {
      await expect(repository.findLastFinished()).resolves.toBeNull();
    });
  });
});

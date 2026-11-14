import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TitleSeniorityBucket } from '@/domain/repositories/seniority-metrics-repository';
import type { CalendarRange } from '@/domain/services/brasilia-calendar';
import { PrismaSeniorityMetricsRepository } from '@/infra/prisma/prisma-seniority-metrics-repository';
import type { PrismaService } from '@/infra/prisma/prisma.service';

interface PrismaStub {
  job: { count: ReturnType<typeof vi.fn> };
}

const RANGE: CalendarRange = {
  start: new Date('2026-10-01T03:00:00.000Z'),
  end: new Date('2026-11-01T03:00:00.000Z'),
};

const MID: TitleSeniorityBucket = {
  id: 'MID',
  keywords: ['pleno'],
  outranked: ['senior', 'lead'],
};

const LEAD: TitleSeniorityBucket = {
  id: 'LEAD',
  keywords: ['lead'],
  outranked: [],
};

describe('PrismaSeniorityMetricsRepository', () => {
  let prisma: PrismaStub;
  let repository: PrismaSeniorityMetricsRepository;

  beforeEach(() => {
    prisma = { job: { count: vi.fn().mockResolvedValue(0) } };
    repository = new PrismaSeniorityMetricsRepository(prisma as unknown as PrismaService);
  });

  describe('countCapturedJobs', () => {
    it('conta pela data de captura, nao pela de publicacao', async () => {
      prisma.job.count.mockResolvedValue(140);

      await expect(repository.countCapturedJobs(RANGE)).resolves.toBe(140);
      expect(prisma.job.count).toHaveBeenCalledWith({
        where: { createdAt: { gte: RANGE.start, lt: RANGE.end } },
      });
    });

    /**
     * A borda superior e exclusiva: com `lte`, a vaga da meia-noite em ponto
     * apareceria no mes que acaba e no que comeca.
     */
    it('fecha a borda superior com `lt`', async () => {
      await repository.countCapturedJobs(RANGE);

      const [{ where }] = prisma.job.count.mock.calls[0] as [
        { where: { createdAt: Record<string, unknown> } },
      ];

      expect(where.createdAt).not.toHaveProperty('lte');
    });
  });

  describe('countCapturedByTitleBucket', () => {
    it('devolve uma contagem por nivel, na ordem recebida', async () => {
      prisma.job.count.mockResolvedValueOnce(30).mockResolvedValueOnce(10);

      await expect(repository.countCapturedByTitleBucket(RANGE, [MID, LEAD])).resolves.toEqual([
        { id: 'MID', total: 30 },
        { id: 'LEAD', total: 10 },
      ]);
    });

    it('procura os termos do nivel apenas no titulo, sem diferenciar caixa', async () => {
      await repository.countCapturedByTitleBucket(RANGE, [LEAD]);

      expect(prisma.job.count).toHaveBeenCalledWith({
        where: {
          createdAt: { gte: RANGE.start, lt: RANGE.end },
          OR: [{ title: { contains: 'lead', mode: 'insensitive' } }],
        },
      });
    });

    /** Sem a exclusao, "Tech Lead Senior" seria contado em Pleno e em Lead. */
    it('exclui os termos dos niveis superiores', async () => {
      await repository.countCapturedByTitleBucket(RANGE, [MID]);

      expect(prisma.job.count).toHaveBeenCalledWith({
        where: {
          createdAt: { gte: RANGE.start, lt: RANGE.end },
          OR: [{ title: { contains: 'pleno', mode: 'insensitive' } }],
          NOT: {
            OR: [
              { title: { contains: 'senior', mode: 'insensitive' } },
              { title: { contains: 'lead', mode: 'insensitive' } },
            ],
          },
        },
      });
    });

    it('nao consulta nada quando nenhum nivel e pedido', async () => {
      await expect(repository.countCapturedByTitleBucket(RANGE, [])).resolves.toEqual([]);
      expect(prisma.job.count).not.toHaveBeenCalled();
    });

    it('trata contagem ausente como zero', async () => {
      prisma.job.count.mockResolvedValue(undefined);

      await expect(repository.countCapturedByTitleBucket(RANGE, [LEAD])).resolves.toEqual([
        { id: 'LEAD', total: 0 },
      ]);
    });
  });
});

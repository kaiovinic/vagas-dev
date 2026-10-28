import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeywordBucket } from '@/domain/repositories/market-insights-repository';
import { PrismaMarketInsightsRepository } from '@/infra/prisma/prisma-market-insights-repository';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import { FIXED_NOW, hoursAgo } from '../../../test/factories/make-job';

interface PrismaStub {
  job: {
    count: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
  };
}

describe('PrismaMarketInsightsRepository', () => {
  let prisma: PrismaStub;
  let repository: PrismaMarketInsightsRepository;

  beforeEach(() => {
    prisma = {
      job: {
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn().mockResolvedValue([]),
      },
    };
    repository = new PrismaMarketInsightsRepository(prisma as unknown as PrismaService);
  });

  it('conta as vagas abertas na janela de 72h', async () => {
    prisma.job.count.mockResolvedValue(52);

    await expect(repository.countOpenJobs(FIXED_NOW)).resolves.toBe(52);
    expect(prisma.job.count).toHaveBeenCalledWith({
      where: { publishedAt: { gte: hoursAgo(72), lte: FIXED_NOW } },
    });
  });

  it('agrupa por modalidade', async () => {
    prisma.job.groupBy.mockResolvedValue([
      { workModel: 'REMOTE', _count: { _all: 49 } },
      { workModel: 'ONSITE', _count: { _all: 3 } },
    ]);

    await expect(repository.countByWorkModel(FIXED_NOW)).resolves.toEqual([
      { workModel: 'REMOTE', total: 49 },
      { workModel: 'ONSITE', total: 3 },
    ]);
  });

  it('agrupa por mercado nacional e internacional', async () => {
    prisma.job.groupBy.mockResolvedValue([
      { scope: 'NATIONAL', _count: { _all: 27 } },
      { scope: 'INTERNATIONAL', _count: { _all: 19 } },
    ]);

    await expect(repository.countByScope(FIXED_NOW)).resolves.toEqual([
      { scope: 'NATIONAL', total: 27 },
      { scope: 'INTERNATIONAL', total: 19 },
    ]);
    expect(prisma.job.groupBy).toHaveBeenCalledWith({
      by: ['scope'],
      where: { publishedAt: { gte: hoursAgo(72), lte: FIXED_NOW } },
      _count: { _all: true },
    });
  });

  describe('countByKeywordBuckets', () => {
    const titleBucket: KeywordBucket = {
      id: 'SENIOR',
      label: 'Senior',
      keywords: ['senior', 'sênior'],
      scope: 'TITLE',
    };

    const textBucket: KeywordBucket = {
      id: 'React',
      label: 'React',
      keywords: ['react'],
      scope: 'TEXT',
    };

    it('procura o grupo de titulo apenas no titulo', async () => {
      await repository.countByKeywordBuckets(FIXED_NOW, [titleBucket]);

      expect(prisma.job.count).toHaveBeenCalledWith({
        where: {
          publishedAt: { gte: hoursAgo(72), lte: FIXED_NOW },
          OR: [
            { title: { contains: 'senior', mode: 'insensitive' } },
            { title: { contains: 'sênior', mode: 'insensitive' } },
          ],
        },
      });
    });

    it('procura o grupo de texto no titulo, na descricao e nas tags', async () => {
      await repository.countByKeywordBuckets(FIXED_NOW, [textBucket]);

      const [[call]] = prisma.job.count.mock.calls as [[{ where: { OR: unknown[] } }]];

      expect(call.where.OR).toEqual([
        { title: { contains: 'react', mode: 'insensitive' } },
        { description: { contains: 'react', mode: 'insensitive' } },
        { tags: { hasSome: ['react'] } },
      ]);
    });

    it('devolve uma contagem por grupo, na ordem recebida', async () => {
      prisma.job.count.mockResolvedValueOnce(25).mockResolvedValueOnce(20);

      await expect(
        repository.countByKeywordBuckets(FIXED_NOW, [titleBucket, textBucket]),
      ).resolves.toEqual([
        { id: 'SENIOR', label: 'Senior', total: 25 },
        { id: 'React', label: 'React', total: 20 },
      ]);
    });

    it('nao consulta nada quando nao ha grupos', async () => {
      await expect(repository.countByKeywordBuckets(FIXED_NOW, [])).resolves.toEqual([]);
      expect(prisma.job.count).not.toHaveBeenCalled();
    });
  });
});

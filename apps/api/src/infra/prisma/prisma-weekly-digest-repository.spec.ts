import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeywordBucket } from '@/domain/repositories/market-insights-repository';
import { PrismaWeeklyDigestRepository } from '@/infra/prisma/prisma-weekly-digest-repository';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import { FIXED_NOW, hoursAgo } from '../../../test/factories/make-job';

interface PrismaStub {
  job: { count: ReturnType<typeof vi.fn> };
}

const REACT: KeywordBucket = {
  id: 'React',
  label: 'React',
  keywords: ['react', 'reactjs'],
  scope: 'TEXT',
};

describe('PrismaWeeklyDigestRepository', () => {
  let prisma: PrismaStub;
  let repository: PrismaWeeklyDigestRepository;

  beforeEach(() => {
    prisma = { job: { count: vi.fn().mockResolvedValue(0) } };
    repository = new PrismaWeeklyDigestRepository(prisma as unknown as PrismaService);
  });

  function whereOf(callIndex: number): Record<string, unknown> {
    const call = prisma.job.count.mock.calls[callIndex]?.[0] as { where: Record<string, unknown> };

    return call.where;
  }

  describe('janelas', () => {
    it('conta as vagas abertas na janela de 72h', async () => {
      await repository.summarize(FIXED_NOW, 7, []);

      expect(whereOf(0)).toEqual({ publishedAt: { gte: hoursAgo(72), lte: FIXED_NOW } });
    });

    it('conta as novas na janela do periodo informado', async () => {
      await repository.summarize(FIXED_NOW, 7, []);

      expect(whereOf(1)).toEqual({ publishedAt: { gte: hoursAgo(168), lte: FIXED_NOW } });
    });

    it('respeita um periodo diferente de sete dias', async () => {
      await repository.summarize(FIXED_NOW, 2, []);

      expect(whereOf(1)).toEqual({ publishedAt: { gte: hoursAgo(48), lte: FIXED_NOW } });
    });
  });

  describe('recortes das vagas abertas', () => {
    it('separa remotas e presenciais dentro da janela de 72h', async () => {
      await repository.summarize(FIXED_NOW, 7, []);

      expect(whereOf(2)).toMatchObject({ isRemote: true });
      expect(whereOf(3)).toMatchObject({ isRemote: false });
      // Os dois recortes saem da mesma janela das abertas, nao da semana.
      expect(whereOf(2)['publishedAt']).toEqual({ gte: hoursAgo(72), lte: FIXED_NOW });
    });
  });

  describe('contagem por stack', () => {
    it('conta cada grupo na janela da semana, nao na das abertas', async () => {
      await repository.summarize(FIXED_NOW, 7, [REACT]);

      expect(whereOf(4)['publishedAt']).toEqual({ gte: hoursAgo(168), lte: FIXED_NOW });
    });

    it('procura o termo no titulo, na descricao e nas tags', async () => {
      await repository.summarize(FIXED_NOW, 7, [REACT]);

      expect(whereOf(4)['OR']).toEqual([
        { title: { contains: 'react', mode: 'insensitive' } },
        { title: { contains: 'reactjs', mode: 'insensitive' } },
        { description: { contains: 'react', mode: 'insensitive' } },
        { description: { contains: 'reactjs', mode: 'insensitive' } },
        { tags: { hasSome: ['react', 'reactjs'] } },
      ]);
    });

    it('limita ao titulo quando o grupo pede so o titulo', async () => {
      await repository.summarize(FIXED_NOW, 7, [{ ...REACT, scope: 'TITLE' }]);

      expect(whereOf(4)['OR']).toEqual([
        { title: { contains: 'react', mode: 'insensitive' } },
        { title: { contains: 'reactjs', mode: 'insensitive' } },
      ]);
    });

    it('devolve rotulo e total de cada grupo', async () => {
      prisma.job.count.mockResolvedValue(12);

      const snapshot = await repository.summarize(FIXED_NOW, 7, [REACT]);

      expect(snapshot.technologies).toEqual([{ id: 'React', label: 'React', total: 12 }]);
    });
  });

  it('consolida os cinco numeros do resumo', async () => {
    prisma.job.count
      .mockResolvedValueOnce(88)
      .mockResolvedValueOnce(134)
      .mockResolvedValueOnce(74)
      .mockResolvedValueOnce(14)
      .mockResolvedValueOnce(61);

    const snapshot = await repository.summarize(FIXED_NOW, 7, [REACT]);

    expect(snapshot).toEqual({
      openJobs: 88,
      newInPeriod: 134,
      remoteJobs: 74,
      localJobs: 14,
      technologies: [{ id: 'React', label: 'React', total: 61 }],
    });
  });
});

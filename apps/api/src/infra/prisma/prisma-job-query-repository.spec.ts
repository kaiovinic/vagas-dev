import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobListFilters } from '@/domain/repositories/job-query-repository';
import { PrismaJobQueryRepository } from '@/infra/prisma/prisma-job-query-repository';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import { FIXED_NOW, hoursAgo } from '../../../test/factories/make-job';

interface PrismaStub {
  job: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
  };
}

function baseFilters(overrides: Partial<JobListFilters> = {}): JobListFilters {
  return {
    page: 1,
    perPage: 20,
    sortBy: 'publishedAt',
    sortDirection: 'desc',
    ...overrides,
  };
}

describe('PrismaJobQueryRepository', () => {
  let prisma: PrismaStub;
  let repository: PrismaJobQueryRepository;

  beforeEach(() => {
    prisma = {
      job: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn().mockResolvedValue([]),
      },
    };
    repository = new PrismaJobQueryRepository(prisma as unknown as PrismaService);
  });

  function lastWhere(): Record<string, unknown> {
    const [[call]] = prisma.job.findMany.mock.calls as [[{ where: Record<string, unknown> }]];

    return call.where;
  }

  describe('list', () => {
    it('devolve itens, total e pagina', async () => {
      prisma.job.findMany.mockResolvedValue([{ id: 'job-1' }]);
      prisma.job.count.mockResolvedValue(42);

      const result = await repository.list(baseFilters({ page: 2, perPage: 10 }));

      expect(result).toMatchObject({ total: 42, page: 2, perPage: 10 });
      expect(result.items).toHaveLength(1);
    });

    it('pagina com skip e take', async () => {
      await repository.list(baseFilters({ page: 3, perPage: 15 }));

      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 30, take: 15 }),
      );
    });

    it('ordena pelo campo e direcao informados', async () => {
      await repository.list(baseFilters({ sortBy: 'company', sortDirection: 'asc' }));

      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { company: 'asc' } }),
      );
    });

    it('nao filtra nada quando nenhum filtro e informado', async () => {
      await repository.list(baseFilters());

      expect(lastWhere()).toEqual({});
    });

    it('filtra pela janela de publicacao', async () => {
      await repository.list(baseFilters({ publishedAfter: hoursAgo(72) }));

      expect(lastWhere()).toEqual({ publishedAt: { gte: hoursAgo(72) } });
    });

    it.each([['nacionais','NATIONAL'],['internacionais','INTERNATIONAL']] as const)(
      'filtra vagas %s por igualdade, sem busca textual',
      async (_label, scope) => {
        await repository.list(baseFilters({ scope }));

        expect(lastWhere()).toEqual({ scope });
      },
    );

    it('filtra por fonte', async () => {
      await repository.list(baseFilters({ source: 'gupy' }));

      expect(lastWhere()).toEqual({ source: 'gupy' });
    });

    it.each([
      ['remotas', true],
      ['presenciais', false],
    ])('filtra vagas %s', async (_label, isRemote) => {
      await repository.list(baseFilters({ isRemote }));

      expect(lastWhere()).toEqual({ isRemote });
    });

    it('compara empresa e recrutador sem diferenciar maiusculas', async () => {
      await repository.list(baseFilters({ company: 'Acme Corp', recruiterName: 'octocat' }));

      expect(lastWhere()).toEqual({
        company: { equals: 'Acme Corp', mode: 'insensitive' },
        recruiterName: { equals: 'octocat', mode: 'insensitive' },
      });
    });

    it('busca cidade por conteudo parcial', async () => {
      await repository.list(baseFilters({ city: 'salvador' }));

      expect(lastWhere()).toEqual({ city: { contains: 'salvador', mode: 'insensitive' } });
    });

    it('busca textual em titulo, empresa e descricao', async () => {
      await repository.list(baseFilters({ search: 'react' }));

      expect(lastWhere()).toEqual({
        OR: [
          { title: { contains: 'react', mode: 'insensitive' } },
          { company: { contains: 'react', mode: 'insensitive' } },
          { description: { contains: 'react', mode: 'insensitive' } },
        ],
      });
    });

    it('exige que a vaga cite ao menos uma das tecnologias marcadas', async () => {
      await repository.list(baseFilters({ technologies: ['React', '.NET'] }));

      expect(lastWhere()).toEqual({
        AND: [
          {
            OR: [
              { title: { contains: 'React', mode: 'insensitive' } },
              { description: { contains: 'React', mode: 'insensitive' } },
              { title: { contains: '.NET', mode: 'insensitive' } },
              { description: { contains: '.NET', mode: 'insensitive' } },
              { tags: { hasSome: ['React', '.NET'] } },
            ],
          },
        ],
      });
    });

    it('combina busca textual e tecnologias sem um anular o outro', async () => {
      await repository.list(baseFilters({ search: 'pleno', technologies: ['React'] }));

      const where = lastWhere();

      expect(where.OR).toHaveLength(3);
      expect(where.AND).toHaveLength(1);
    });

    it('procura a senioridade apenas no titulo', async () => {
      await repository.list(baseFilters({ seniorityKeywords: ['pleno', 'plena'] }));

      // Sem descricao e sem tags: "Vaga internacional" casava como estagio.
      expect(lastWhere()).toEqual({
        AND: [
          {
            OR: [
              { title: { contains: 'pleno', mode: 'insensitive' } },
              { title: { contains: 'plena', mode: 'insensitive' } },
            ],
          },
        ],
      });
    });

    it('combina tecnologia e senioridade em grupos separados', async () => {
      await repository.list(
        baseFilters({ technologies: ['React'], seniorityKeywords: ['senior'] }),
      );

      const where = lastWhere();

      // Dois grupos em AND: uma tecnologia E uma senioridade, nao um OR unico.
      expect(where.AND).toHaveLength(2);
    });

    it('ignora lista de senioridade vazia', async () => {
      await repository.list(baseFilters({ seniorityKeywords: [] }));

      expect(lastWhere()).toEqual({});
    });

    it('ignora lista de tecnologias vazia', async () => {
      await repository.list(baseFilters({ technologies: [] }));

      expect(lastWhere()).toEqual({});
    });

    it('usa o mesmo filtro na contagem e na busca', async () => {
      await repository.list(baseFilters({ source: 'gupy' }));

      expect(prisma.job.count).toHaveBeenCalledWith({ where: { source: 'gupy' } });
    });
  });

  describe('countByCompany', () => {
    it('combina o total geral com o total de remotas', async () => {
      prisma.job.groupBy
        .mockResolvedValueOnce([
          { company: 'Acme Corp', _count: { _all: 4 }, _max: { publishedAt: hoursAgo(1) } },
          { company: 'Globex', _count: { _all: 2 }, _max: { publishedAt: hoursAgo(5) } },
        ])
        .mockResolvedValueOnce([{ company: 'Acme Corp', _count: { _all: 3 } }]);

      await expect(repository.countByCompany(hoursAgo(72))).resolves.toEqual([
        { name: 'Acme Corp', total: 4, remoteTotal: 3, lastPublishedAt: hoursAgo(1) },
        { name: 'Globex', total: 2, remoteTotal: 0, lastPublishedAt: hoursAgo(5) },
      ]);
    });

    it('ignora empresas sem nome', async () => {
      prisma.job.groupBy
        .mockResolvedValueOnce([
          { company: '   ', _count: { _all: 9 }, _max: { publishedAt: hoursAgo(1) } },
          { company: 'Acme Corp', _count: { _all: 1 }, _max: { publishedAt: hoursAgo(2) } },
        ])
        .mockResolvedValueOnce([]);

      const result = await repository.countByCompany(hoursAgo(72));

      expect(result.map((row) => row.name)).toEqual(['Acme Corp']);
    });

    it('ignora agrupamentos sem data de publicacao', async () => {
      prisma.job.groupBy
        .mockResolvedValueOnce([
          { company: 'Acme Corp', _count: { _all: 1 }, _max: { publishedAt: null } },
        ])
        .mockResolvedValueOnce([]);

      await expect(repository.countByCompany(hoursAgo(72))).resolves.toEqual([]);
    });

    it('desempata pelo nome quando o total e igual', async () => {
      prisma.job.groupBy
        .mockResolvedValueOnce([
          { company: 'Zeta', _count: { _all: 2 }, _max: { publishedAt: hoursAgo(1) } },
          { company: 'Alpha', _count: { _all: 2 }, _max: { publishedAt: hoursAgo(1) } },
        ])
        .mockResolvedValueOnce([]);

      const result = await repository.countByCompany(hoursAgo(72));

      expect(result.map((row) => row.name)).toEqual(['Alpha', 'Zeta']);
    });

    it('restringe a janela e exige nome de empresa', async () => {
      await repository.countByCompany(hoursAgo(72));

      expect(prisma.job.groupBy).toHaveBeenNthCalledWith(1, {
        by: ['company'],
        where: { publishedAt: { gte: hoursAgo(72) }, company: { not: '' } },
        _count: { _all: true },
        _max: { publishedAt: true },
      });
      expect(prisma.job.groupBy).toHaveBeenNthCalledWith(2, {
        by: ['company'],
        where: { publishedAt: { gte: hoursAgo(72) }, company: { not: '' }, isRemote: true },
        _count: { _all: true },
      });
    });
  });

  describe('countByRecruiter', () => {
    it('agrupa por recrutador ignorando vagas sem recrutador', async () => {
      prisma.job.groupBy
        .mockResolvedValueOnce([
          { recruiterName: 'octocat', _count: { _all: 3 }, _max: { publishedAt: hoursAgo(2) } },
          { recruiterName: null, _count: { _all: 8 }, _max: { publishedAt: hoursAgo(1) } },
        ])
        .mockResolvedValueOnce([{ recruiterName: 'octocat', _count: { _all: 1 } }]);

      await expect(repository.countByRecruiter(hoursAgo(72))).resolves.toEqual([
        { name: 'octocat', total: 3, remoteTotal: 1, lastPublishedAt: hoursAgo(2) },
      ]);
    });

    it('exige recrutador preenchido na consulta', async () => {
      await repository.countByRecruiter(FIXED_NOW);

      expect(prisma.job.groupBy).toHaveBeenNthCalledWith(1, {
        by: ['recruiterName'],
        where: { publishedAt: { gte: FIXED_NOW }, recruiterName: { not: null } },
        _count: { _all: true },
        _max: { publishedAt: true },
      });
    });
  });
});

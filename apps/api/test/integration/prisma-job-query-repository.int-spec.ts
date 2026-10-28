import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { JobListFilters } from '@/domain/repositories/job-query-repository';
import { PrismaJobQueryRepository } from '@/infra/prisma/prisma-job-query-repository';
import { PrismaJobRepository } from '@/infra/prisma/prisma-job-repository';
import type { PersistableJob } from '@/domain/repositories/job-write-repository';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import { createTestPrisma, resetDatabase } from './database';
import { hoursAgo, makeJob } from '../factories/make-job';

const prisma: PrismaService = createTestPrisma();
const repository = new PrismaJobQueryRepository(prisma);
const writer = new PrismaJobRepository(prisma);

function filters(overrides: Partial<JobListFilters> = {}): JobListFilters {
  return {
    page: 1,
    perPage: 20,
    sortBy: 'publishedAt',
    sortDirection: 'desc',
    ...overrides,
  };
}

function entry(overrides: Partial<PersistableJob> = {}): PersistableJob {
  return {
    job: makeJob(),
    publishedAtSource: 'SOURCE',
    recruiterName: '',
    tags: [],
    scope: 'UNKNOWN',
    ...overrides,
  };
}

async function seed(): Promise<void> {
  await writer.saveMany([
    entry({
      job: makeJob({
        title: 'Pessoa Desenvolvedora Frontend React Senior',
        company: 'Fcamara',
        source: 'gupy',
        url: 'https://fcamara.gupy.io/job/1',
        location: 'Salvador/BA',
        workModel: 'REMOTE',
        description: 'Atuacao com React e TypeScript',
        publishedAt: hoursAgo(2),
      }),
      tags: ['React', 'TypeScript'],
    }),
    entry({
      job: makeJob({
        title: 'Desenvolvedor Angular Pleno',
        company: 'Globex',
        source: 'linkedin',
        url: 'https://linkedin.com/jobs/2',
        location: 'Lauro de Freitas/BA',
        workModel: 'ONSITE',
        description: 'Stack Angular e .NET',
        publishedAt: hoursAgo(10),
      }),
      recruiterName: 'octocat',
      tags: ['Angular'],
    }),
    entry({
      job: makeJob({
        title: 'Dev Fullstack Node.js',
        company: 'Initech',
        source: 'github',
        url: 'https://github.com/frontendbr/vagas/issues/3',
        location: 'Remoto',
        workModel: 'REMOTE',
        description: 'Node.js no backend',
        publishedAt: hoursAgo(40),
      }),
      recruiterName: 'octocat',
      tags: ['Node.js'],
    }),
    entry({
      job: makeJob({
        title: 'Dev React Antigo',
        company: 'Velha Corp',
        source: 'gupy',
        url: 'https://gupy.io/vagas/4',
        // Descricao e local explicitos: os padroes do `makeJob` citam TypeScript e
        // Salvador e contaminariam os filtros deste cenario.
        description: 'Vaga antiga, ainda com React',
        location: 'Remoto',
        workModel: 'REMOTE',
        publishedAt: hoursAgo(100),
      }),
      tags: ['React'],
    }),
  ]);
}

beforeEach(async () => {
  await resetDatabase(prisma);
  await seed();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PrismaJobQueryRepository (integracao)', () => {
  describe('list', () => {
    it('devolve todas as vagas sem filtro, da mais recente para a mais antiga', async () => {
      const result = await repository.list(filters());

      expect(result.total).toBe(4);
      expect(result.items.map((item) => item.company)).toEqual([
        'Fcamara',
        'Globex',
        'Initech',
        'Velha Corp',
      ]);
    });

    it('limita a janela de 72h quando pedido', async () => {
      const result = await repository.list(filters({ publishedAfter: hoursAgo(72) }));

      expect(result.total).toBe(3);
      expect(result.items.some((item) => item.company === 'Velha Corp')).toBe(false);
    });

    it('pagina de verdade, com skip e take', async () => {
      const page2 = await repository.list(filters({ page: 2, perPage: 2 }));

      expect(page2.total).toBe(4);
      expect(page2.page).toBe(2);
      expect(page2.items.map((item) => item.company)).toEqual(['Initech', 'Velha Corp']);
    });

    it('ordena por empresa em ordem crescente', async () => {
      const result = await repository.list(filters({ sortBy: 'company', sortDirection: 'asc' }));

      expect(result.items.map((item) => item.company)).toEqual([
        'Fcamara',
        'Globex',
        'Initech',
        'Velha Corp',
      ]);
    });

    it('filtra por fonte', async () => {
      const result = await repository.list(filters({ source: 'gupy' }));

      expect(result.total).toBe(2);
      expect(result.items.every((item) => item.source === 'gupy')).toBe(true);
    });

    it.each([
      ['remotas', true, 3],
      ['presenciais', false, 1],
    ])('filtra vagas %s', async (_label, isRemote, expected) => {
      const result = await repository.list(filters({ isRemote }));

      expect(result.total).toBe(expected);
    });

    it('busca sem diferenciar maiusculas em titulo, empresa e descricao', async () => {
      await expect(repository.list(filters({ search: 'ANGULAR' }))).resolves.toMatchObject({
        total: 1,
      });
      await expect(repository.list(filters({ search: 'fcamara' }))).resolves.toMatchObject({
        total: 1,
      });
      await expect(repository.list(filters({ search: 'typescript' }))).resolves.toMatchObject({
        total: 1,
      });
    });

    it('compara empresa inteira, sem diferenciar maiusculas', async () => {
      const result = await repository.list(filters({ company: 'fcamara' }));

      expect(result.total).toBe(1);
      expect(result.items[0]?.company).toBe('Fcamara');
    });

    it('filtra por recrutador', async () => {
      const result = await repository.list(filters({ recruiterName: 'OCTOCAT' }));

      expect(result.total).toBe(2);
    });

    it('busca cidade por conteudo parcial', async () => {
      const result = await repository.list(filters({ city: 'salvador' }));

      expect(result.total).toBe(1);
      expect(result.items[0]?.city).toBe('Salvador/BA');
    });

    it.each([
      ['no titulo', ['Angular'], 1],
      ['na descricao', ['.NET'], 1],
      ['nas tags', ['TypeScript'], 1],
    ])('encontra a tecnologia %s', async (_label, technologies, expected) => {
      const result = await repository.list(filters({ technologies }));

      expect(result.total).toBe(expected);
    });

    it('aceita qualquer uma das tecnologias marcadas', async () => {
      const result = await repository.list(filters({ technologies: ['Angular', 'Node.js'] }));

      expect(result.total).toBe(2);
      expect(result.items.map((item) => item.company).sort()).toEqual(['Globex', 'Initech']);
    });

    it('combina busca textual e tecnologia sem um anular o outro', async () => {
      await expect(
        repository.list(filters({ search: 'Pleno', technologies: ['Angular'] })),
      ).resolves.toMatchObject({ total: 1 });

      await expect(
        repository.list(filters({ search: 'Pleno', technologies: ['React'] })),
      ).resolves.toMatchObject({ total: 0 });
    });

    it('ignora lista de tecnologias vazia', async () => {
      await expect(repository.list(filters({ technologies: [] }))).resolves.toMatchObject({
        total: 4,
      });
    });

    it('devolve todas as colunas que a listagem precisa', async () => {
      const result = await repository.list(filters({ perPage: 1 }));
      const item = result.items[0];

      expect(item).toMatchObject({
        title: 'Pessoa Desenvolvedora Frontend React Senior',
        company: 'Fcamara',
        source: 'gupy',
        city: 'Salvador/BA',
        isRemote: true,
        workModel: 'REMOTE',
        tags: ['React', 'TypeScript'],
        publishedAtSource: 'SOURCE',
      });
      expect(item?.publishedAt).toBeInstanceOf(Date);
      expect(item?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    it('devolve lista vazia quando nada casa', async () => {
      await expect(repository.list(filters({ search: 'cobol' }))).resolves.toMatchObject({
        items: [],
        total: 0,
      });
    });
  });

  describe('countByCompany', () => {
    it('agrupa por empresa com total, remotas e ultima publicacao', async () => {
      const rows = await repository.countByCompany(hoursAgo(72));

      expect(rows).toHaveLength(3);
      expect(rows.map((row) => row.name)).toEqual(['Fcamara', 'Globex', 'Initech']);
      expect(rows[0]).toMatchObject({ name: 'Fcamara', total: 1, remoteTotal: 1 });
      expect(rows[1]).toMatchObject({ name: 'Globex', total: 1, remoteTotal: 0 });
      expect(rows[0]?.lastPublishedAt).toEqual(hoursAgo(2));
    });

    it('soma varias vagas da mesma empresa', async () => {
      await writer.saveMany([
        entry({
          job: makeJob({
            title: 'Outra vaga React',
            company: 'Fcamara',
            source: 'gupy',
            url: 'https://fcamara.gupy.io/job/9',
            workModel: 'ONSITE',
            location: 'Salvador/BA',
            publishedAt: hoursAgo(1),
          }),
        }),
      ]);

      const rows = await repository.countByCompany(hoursAgo(72));

      expect(rows[0]).toMatchObject({ name: 'Fcamara', total: 2, remoteTotal: 1 });
      expect(rows[0]?.lastPublishedAt).toEqual(hoursAgo(1));
    });

    it('respeita a janela informada', async () => {
      const rows = await repository.countByCompany(hoursAgo(5));

      expect(rows.map((row) => row.name)).toEqual(['Fcamara']);
    });
  });

  describe('countByRecruiter', () => {
    it('agrupa por recrutador, ignorando vagas sem recrutador', async () => {
      const rows = await repository.countByRecruiter(hoursAgo(72));

      expect(rows).toEqual([
        { name: 'octocat', total: 2, remoteTotal: 1, lastPublishedAt: hoursAgo(10) },
      ]);
    });

    it('devolve lista vazia quando ninguem publicou na janela', async () => {
      await expect(repository.countByRecruiter(hoursAgo(1))).resolves.toEqual([]);
    });
  });
});

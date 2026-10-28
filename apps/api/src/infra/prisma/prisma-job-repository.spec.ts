import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PersistableJob } from '@/domain/repositories/job-write-repository';
import { PrismaJobRepository } from '@/infra/prisma/prisma-job-repository';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import { FIXED_NOW, hoursAgo, makeJob } from '../../../test/factories/make-job';

interface PrismaStub {
  job: {
    findMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
  };
  $queryRaw: ReturnType<typeof vi.fn>;
}

function createPrismaStub(): PrismaStub {
  return {
    job: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
}

function persistable(overrides: Partial<PersistableJob> = {}): PersistableJob {
  return {
    job: makeJob(),
    publishedAtSource: 'SOURCE',
    recruiterName: '',
    tags: [],
    scope: 'UNKNOWN',
    ...overrides,
  };
}

describe('PrismaJobRepository', () => {
  let prisma: PrismaStub;
  let repository: PrismaJobRepository;

  beforeEach(() => {
    prisma = createPrismaStub();
    repository = new PrismaJobRepository(prisma as unknown as PrismaService);
  });

  describe('findExistingFingerprints', () => {
    it('consulta apenas os fingerprints informados', async () => {
      prisma.job.findMany.mockResolvedValue([{ fingerprint: 'abc' }]);

      await expect(repository.findExistingFingerprints(['abc', 'def'])).resolves.toEqual(['abc']);
      expect(prisma.job.findMany).toHaveBeenCalledWith({
        where: { fingerprint: { in: ['abc', 'def'] } },
        select: { fingerprint: true },
      });
    });

    it('nao consulta o banco para uma lista vazia', async () => {
      await expect(repository.findExistingFingerprints([])).resolves.toEqual([]);
      expect(prisma.job.findMany).not.toHaveBeenCalled();
    });
  });

  describe('saveMany', () => {
    it('nao toca no banco quando nao ha vagas', async () => {
      await expect(repository.saveMany([])).resolves.toEqual({ created: 0, duplicated: 0 });
      expect(prisma.job.createMany).not.toHaveBeenCalled();
    });

    it('insere vagas novas e conta as criadas', async () => {
      prisma.job.createMany.mockResolvedValue({ count: 1 });

      const result = await repository.saveMany([persistable()]);

      expect(result).toEqual({ created: 1, duplicated: 0 });
      expect(prisma.job.updateMany).not.toHaveBeenCalled();
    });

    it('mapeia a entidade para as colunas da tabela', async () => {
      prisma.job.createMany.mockResolvedValue({ count: 1 });
      const job = makeJob({
        title: 'Dev React',
        company: 'Acme Corp',
        source: 'gupy',
        location: 'Salvador/BA',
        workModel: 'REMOTE',
        publishedAt: hoursAgo(3),
      });

      await repository.saveMany([
        persistable({
          job,
          recruiterName: 'Ana Recrutadora',
          tags: ['React', 'TypeScript'],
          publishedAtSource: 'SOURCE',
        }),
      ]);

      expect(prisma.job.createMany).toHaveBeenCalledWith({
        skipDuplicates: true,
        data: [
          expect.objectContaining({
            fingerprint: job.fingerprint.value,
            source: 'gupy',
            title: 'Dev React',
            company: 'Acme Corp',
            recruiterName: 'Ana Recrutadora',
            city: 'Salvador/BA',
            isRemote: true,
            workModel: 'REMOTE',
            tags: ['React', 'TypeScript'],
            publishedAtSource: 'SOURCE',
          }),
        ],
      });
    });

    it('grava nulo quando recrutador e localidade nao vieram da fonte', async () => {
      prisma.job.createMany.mockResolvedValue({ count: 1 });

      await repository.saveMany([
        persistable({ job: makeJob({ location: '', workModel: 'UNKNOWN' }) }),
      ]);

      const [[call]] = prisma.job.createMany.mock.calls as [[{ data: Record<string, unknown>[] }]];

      expect(call.data[0]).toMatchObject({ recruiterName: null, city: null, isRemote: false });
    });

    it('apenas renova lastSeenAt das vagas que ja existiam', async () => {
      const job = makeJob();
      prisma.job.findMany.mockResolvedValue([{ fingerprint: job.fingerprint.value }]);

      const result = await repository.saveMany([persistable({ job })]);

      expect(result).toEqual({ created: 0, duplicated: 1 });
      expect(prisma.job.updateMany).toHaveBeenCalledWith({
        where: { fingerprint: { in: [job.fingerprint.value] } },
        data: { lastSeenAt: expect.any(Date) },
      });
      expect(prisma.job.createMany).not.toHaveBeenCalled();
    });

    it('separa novas de duplicadas no mesmo lote', async () => {
      const existing = makeJob({ company: 'Acme Corp' });
      const fresh = makeJob({ company: 'Globex' });
      prisma.job.findMany.mockResolvedValue([{ fingerprint: existing.fingerprint.value }]);
      prisma.job.createMany.mockResolvedValue({ count: 1 });

      const result = await repository.saveMany([
        persistable({ job: existing }),
        persistable({ job: fresh }),
      ]);

      expect(result).toEqual({ created: 1, duplicated: 1 });
    });
  });

  describe('getOpenJobsSummary', () => {
    it('conta os KPIs dentro das janelas de 72h e 24h', async () => {
      prisma.job.count
        .mockResolvedValueOnce(42)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(30);
      prisma.job.groupBy.mockResolvedValue([{ company: 'Acme' }, { company: 'Globex' }]);

      await expect(repository.getOpenJobsSummary(FIXED_NOW)).resolves.toEqual({
        openJobs: 42,
        newInLast24h: 10,
        newInPrevious24h: 7,
        remoteJobs: 30,
        hiringCompanies: 2,
      });
    });

    it('usa a janela de 72 horas nas vagas abertas', async () => {
      await repository.getOpenJobsSummary(FIXED_NOW);

      expect(prisma.job.count).toHaveBeenNthCalledWith(1, {
        where: { publishedAt: { gte: hoursAgo(72), lte: FIXED_NOW } },
      });
    });

    it('compara as 24h anteriores sem sobrepor as ultimas 24h', async () => {
      await repository.getOpenJobsSummary(FIXED_NOW);

      expect(prisma.job.count).toHaveBeenNthCalledWith(3, {
        where: { publishedAt: { gte: hoursAgo(48), lt: hoursAgo(24) } },
      });
    });

    it('conta apenas remotas no KPI de remoto', async () => {
      await repository.getOpenJobsSummary(FIXED_NOW);

      expect(prisma.job.count).toHaveBeenNthCalledWith(4, {
        where: { publishedAt: { gte: hoursAgo(72), lte: FIXED_NOW }, isRemote: true },
      });
    });

    it('ignora empresas sem nome informado na contagem de contratantes', async () => {
      await repository.getOpenJobsSummary(FIXED_NOW);

      expect(prisma.job.groupBy).toHaveBeenCalledWith({
        by: ['company'],
        where: { publishedAt: { gte: hoursAgo(72), lte: FIXED_NOW }, company: { not: '' } },
      });
    });
  });

  describe('countOpenJobsBySource', () => {
    it('agrupa por fonte e ordena da maior para a menor', async () => {
      prisma.job.groupBy.mockResolvedValue([
        { source: 'gupy', _count: { _all: 3 } },
        { source: 'linkedin', _count: { _all: 9 } },
        { source: 'remotar', _count: { _all: 5 } },
      ]);

      await expect(repository.countOpenJobsBySource(FIXED_NOW)).resolves.toEqual([
        { source: 'linkedin', total: 9 },
        { source: 'remotar', total: 5 },
        { source: 'gupy', total: 3 },
      ]);
    });

    it('restringe a consulta a janela de 72 horas', async () => {
      await repository.countOpenJobsBySource(FIXED_NOW);

      expect(prisma.job.groupBy).toHaveBeenCalledWith({
        by: ['source'],
        where: { publishedAt: { gte: hoursAgo(72), lte: FIXED_NOW } },
        _count: { _all: true },
      });
    });
  });

  describe('countJobsByDayAndSource', () => {
    it('agrupa por dia no horario de Brasilia via sql', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { day: '2026-10-25', source: 'gupy', total: 4n },
        { day: '2026-10-26', source: 'linkedin', total: 2 },
      ]);

      await expect(repository.countJobsByDayAndSource(FIXED_NOW, 14)).resolves.toEqual([
        { day: '2026-10-25', source: 'gupy', total: 4 },
        { day: '2026-10-26', source: 'linkedin', total: 2 },
      ]);
    });

    it('converte o periodo em dias para o intervalo da consulta', async () => {
      await repository.countJobsByDayAndSource(FIXED_NOW, 14);

      const [[query]] = prisma.$queryRaw.mock.calls as [[{ values: unknown[]; sql: string }]];

      expect(query.sql).toContain('AT TIME ZONE');
      expect(query.values).toContain('America/Bahia');
      expect(query.values).toContain(hoursAgo(14 * 24).toISOString());
      expect(query.values).toContain(FIXED_NOW.toISOString());
    });

    it('envia as datas como texto ISO lido como timestamptz', async () => {
      await repository.countJobsByDayAndSource(FIXED_NOW, 14);

      const [[query]] = prisma.$queryRaw.mock.calls as [[{ values: unknown[]; sql: string }]];

      // Um parametro `Date` cru seria interpretado no fuso do processo.
      expect(query.sql).toContain('::timestamptz');
      expect(query.values.every((value) => !(value instanceof Date))).toBe(true);
    });
  });
});

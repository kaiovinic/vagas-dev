import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaJobRepository } from '@/infra/prisma/prisma-job-repository';
import type { PersistableJob } from '@/domain/repositories/job-write-repository';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import { createTestPrisma, resetDatabase } from './database';
import { FIXED_NOW, hoursAgo, makeJob } from '../factories/make-job';

const prisma: PrismaService = createTestPrisma();
const repository = new PrismaJobRepository(prisma);

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

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PrismaJobRepository (integracao)', () => {
  describe('saveMany', () => {
    it('persiste a vaga com todas as colunas mapeadas', async () => {
      const job = makeJob({
        title: 'Dev React',
        company: 'Acme Corp',
        source: 'gupy',
        url: 'https://gupy.io/vagas/1',
        location: 'Salvador/BA',
        workModel: 'REMOTE',
        description: 'React e TypeScript',
        publishedAt: hoursAgo(3),
      });

      const result = await repository.saveMany([
        persistable({
          job,
          recruiterName: 'Ana Recrutadora',
          tags: ['React', 'TypeScript'],
          publishedAtSource: 'SOURCE',
        }),
      ]);

      expect(result).toEqual({ created: 1, duplicated: 0 });

      const row = await prisma.job.findUniqueOrThrow({
        where: { fingerprint: job.fingerprint.value },
      });

      expect(row).toMatchObject({
        source: 'gupy',
        title: 'Dev React',
        company: 'Acme Corp',
        recruiterName: 'Ana Recrutadora',
        city: 'Salvador/BA',
        isRemote: true,
        workModel: 'REMOTE',
        url: 'https://gupy.io/vagas/1',
        description: 'React e TypeScript',
        tags: ['React', 'TypeScript'],
        publishedAtSource: 'SOURCE',
      });
      expect(row.publishedAt).toEqual(hoursAgo(3));
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('grava nulo quando recrutador e localidade nao vieram da fonte', async () => {
      const job = makeJob({ location: '', workModel: 'UNKNOWN' });

      await repository.saveMany([persistable({ job })]);

      const row = await prisma.job.findUniqueOrThrow({
        where: { fingerprint: job.fingerprint.value },
      });

      expect(row.recruiterName).toBeNull();
      expect(row.city).toBeNull();
      expect(row.isRemote).toBe(false);
    });

    it('marca a data estimada na captura', async () => {
      const job = makeJob({ company: 'ProgramaThor Corp' });

      await repository.saveMany([persistable({ job, publishedAtSource: 'CAPTURE' })]);

      const row = await prisma.job.findUniqueOrThrow({
        where: { fingerprint: job.fingerprint.value },
      });

      expect(row.publishedAtSource).toBe('CAPTURE');
    });

    it('o indice unico de fingerprint impede a mesma vaga duas vezes', async () => {
      const job = makeJob();

      await repository.saveMany([persistable({ job })]);
      const second = await repository.saveMany([persistable({ job })]);

      expect(second).toEqual({ created: 0, duplicated: 1 });
      expect(await prisma.job.count()).toBe(1);
    });

    it('renova lastSeenAt da vaga ja conhecida, preservando firstSeenAt', async () => {
      const job = makeJob();

      await repository.saveMany([persistable({ job })]);
      const before = await prisma.job.findUniqueOrThrow({
        where: { fingerprint: job.fingerprint.value },
      });

      await repository.saveMany([persistable({ job })]);
      const after = await prisma.job.findUniqueOrThrow({
        where: { fingerprint: job.fingerprint.value },
      });

      expect(after.firstSeenAt).toEqual(before.firstSeenAt);
      expect(after.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before.lastSeenAt.getTime());
    });

    it('separa novas de duplicadas no mesmo lote', async () => {
      const conhecida = makeJob({ company: 'Acme Corp' });
      await repository.saveMany([persistable({ job: conhecida })]);

      const result = await repository.saveMany([
        persistable({ job: conhecida }),
        persistable({ job: makeJob({ company: 'Globex' }) }),
      ]);

      expect(result).toEqual({ created: 1, duplicated: 1 });
      expect(await prisma.job.count()).toBe(2);
    });

    it('deduplica a mesma vaga vinda de fontes diferentes', async () => {
      const gupy = makeJob({ source: 'gupy', url: 'https://gupy.io/vagas/1' });
      const linkedin = makeJob({
        source: 'linkedin',
        url: 'https://linkedin.com/jobs/2',
        title: 'desenvolvedor   frontend react',
      });

      await repository.saveMany([persistable({ job: gupy })]);
      const result = await repository.saveMany([persistable({ job: linkedin })]);

      expect(result.created).toBe(0);
      expect(await prisma.job.count()).toBe(1);
    });

    it('nao toca no banco para um lote vazio', async () => {
      await expect(repository.saveMany([])).resolves.toEqual({ created: 0, duplicated: 0 });
      expect(await prisma.job.count()).toBe(0);
    });
  });

  describe('findExistingFingerprints', () => {
    it('devolve apenas os fingerprints ja persistidos', async () => {
      const job = makeJob();
      await repository.saveMany([persistable({ job })]);

      const found = await repository.findExistingFingerprints([
        job.fingerprint.value,
        'f'.repeat(64),
      ]);

      expect(found).toEqual([job.fingerprint.value]);
    });

    it('devolve lista vazia sem consultar quando nao ha fingerprints', async () => {
      await expect(repository.findExistingFingerprints([])).resolves.toEqual([]);
    });
  });

  describe('metricas do dashboard', () => {
    beforeEach(async () => {
      await repository.saveMany([
        persistable({
          job: makeJob({ company: 'Acme Corp', source: 'gupy', publishedAt: hoursAgo(2) }),
        }),
        persistable({
          job: makeJob({ company: 'Globex', source: 'gupy', publishedAt: hoursAgo(30) }),
        }),
        persistable({
          job: makeJob({
            company: 'Initech',
            source: 'linkedin',
            publishedAt: hoursAgo(50),
            workModel: 'ONSITE',
            location: 'Salvador/BA',
          }),
        }),
        persistable({
          job: makeJob({ company: 'Velha Corp', source: 'remotar', publishedAt: hoursAgo(100) }),
        }),
      ]);
    });

    it('conta as vagas abertas dentro da janela de 72h', async () => {
      const summary = await repository.getOpenJobsSummary(FIXED_NOW);

      expect(summary.openJobs).toBe(3);
    });

    it('compara as novas de 24h com as 24h anteriores', async () => {
      const summary = await repository.getOpenJobsSummary(FIXED_NOW);

      expect(summary.newInLast24h).toBe(1);
      expect(summary.newInPrevious24h).toBe(1);
    });

    it('conta apenas as remotas no KPI de remoto', async () => {
      const summary = await repository.getOpenJobsSummary(FIXED_NOW);

      expect(summary.remoteJobs).toBe(2);
    });

    it('conta empresas distintas contratando', async () => {
      const summary = await repository.getOpenJobsSummary(FIXED_NOW);

      expect(summary.hiringCompanies).toBe(3);
    });

    it('agrupa as vagas abertas por fonte, da maior para a menor', async () => {
      await expect(repository.countOpenJobsBySource(FIXED_NOW)).resolves.toEqual([
        { source: 'gupy', total: 2 },
        { source: 'linkedin', total: 1 },
      ]);
    });

    it('agrupa por dia de publicacao no horario de Brasilia', async () => {
      const rows = await repository.countJobsByDayAndSource(FIXED_NOW, 14);

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(typeof row.total).toBe('number');
      }
      expect(rows.reduce((total, row) => total + row.total, 0)).toBe(4);
    });

    it('usa o fuso de Brasilia, e nao UTC, na virada do dia', async () => {
      await resetDatabase(prisma);
      // 01:30Z do dia 27 ainda e 22:30 do dia 26 em Brasilia.
      const reference = new Date('2026-10-27T12:00:00.000Z');
      await repository.saveMany([
        persistable({
          job: makeJob({ company: 'Virada', publishedAt: new Date('2026-10-27T01:30:00.000Z') }),
        }),
      ]);

      const rows = await repository.countJobsByDayAndSource(reference, 14);

      expect(rows).toEqual([{ day: '2026-10-26', source: 'gupy', total: 1 }]);
    });

    it('devolve metricas zeradas quando nao ha vagas', async () => {
      await resetDatabase(prisma);

      await expect(repository.getOpenJobsSummary(FIXED_NOW)).resolves.toEqual({
        openJobs: 0,
        newInLast24h: 0,
        newInPrevious24h: 0,
        remoteJobs: 0,
        hiringCompanies: 0,
      });
      await expect(repository.countOpenJobsBySource(FIXED_NOW)).resolves.toEqual([]);
      await expect(repository.countJobsByDayAndSource(FIXED_NOW, 14)).resolves.toEqual([]);
    });
  });
});

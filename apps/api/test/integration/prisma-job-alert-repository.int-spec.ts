import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaJobAlertRepository } from '@/infra/prisma/prisma-job-alert-repository';
import { PrismaJobRepository } from '@/infra/prisma/prisma-job-repository';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import { createTestPrisma, resetDatabase } from './database';
import { FIXED_NOW, hoursAgo, makeJob } from '../factories/make-job';

const prisma: PrismaService = createTestPrisma();
const repository = new PrismaJobAlertRepository(prisma);
const jobs = new PrismaJobRepository(prisma);

interface SaveOptions {
  readonly company?: string;
  readonly url?: string;
  readonly publishedAt?: Date;
  readonly tags?: readonly string[];
}

async function saveJob(options: SaveOptions = {}): Promise<void> {
  await jobs.saveMany([
    {
      job: makeJob({
        company: options.company ?? 'Acme Corp',
        url: options.url ?? 'https://gupy.io/vagas/1',
        publishedAt: options.publishedAt ?? hoursAgo(2),
      }),
      publishedAtSource: 'SOURCE',
      recruiterName: '',
      tags: options.tags ?? ['React'],
      scope: 'NATIONAL',
    },
  ]);
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PrismaJobAlertRepository (integracao)', () => {
  it('entrega a vaga recem-gravada como pendente, com tags e mercado da captura', async () => {
    await saveJob({ tags: ['React', 'TypeScript'] });

    const pending = await repository.findPendingAlerts(FIXED_NOW, 10);

    expect(pending).toHaveLength(1);
    expect(pending[0]?.alert.job.company).toBe('Acme Corp');
    expect(pending[0]?.alert.tags).toEqual(['React', 'TypeScript']);
    expect(pending[0]?.alert.scope).toBe('NATIONAL');
  });

  it('para de entregar a vaga depois de marcada como avisada', async () => {
    await saveJob();
    const [pending] = await repository.findPendingAlerts(FIXED_NOW, 10);

    await repository.markNotified(pending?.jobId ?? '', FIXED_NOW);

    expect(await repository.findPendingAlerts(FIXED_NOW, 10)).toEqual([]);

    const row = await prisma.job.findFirstOrThrow();

    expect(row.notifiedAt).toEqual(FIXED_NOW);
  });

  it('ignora vaga fora da janela de 72h: alerta atrasado demais nao interessa', async () => {
    await saveJob({ publishedAt: hoursAgo(80) });

    expect(await repository.findPendingAlerts(FIXED_NOW, 10)).toEqual([]);
  });

  it('ignora vaga encerrada na fonte', async () => {
    await saveJob();
    await prisma.job.updateMany({ data: { closedAt: FIXED_NOW } });

    expect(await repository.findPendingAlerts(FIXED_NOW, 10)).toEqual([]);
  });

  it('entrega da mais antiga para a mais nova, respeitando o teto do lote', async () => {
    await saveJob({ company: 'Antiga', url: 'https://gupy.io/vagas/1', publishedAt: hoursAgo(10) });
    await saveJob({ company: 'Meio', url: 'https://gupy.io/vagas/2', publishedAt: hoursAgo(5) });
    await saveJob({ company: 'Nova', url: 'https://gupy.io/vagas/3', publishedAt: hoursAgo(1) });

    const pending = await repository.findPendingAlerts(FIXED_NOW, 2);

    expect(pending.map((entry) => entry.alert.job.company)).toEqual(['Antiga', 'Meio']);
  });

  it('tira da fila a linha estragada, em vez de deixa-la travando o lote', async () => {
    await saveJob();
    await prisma.job.updateMany({ data: { title: '' } });

    expect(await repository.findPendingAlerts(FIXED_NOW, 10)).toEqual([]);

    const row = await prisma.job.findFirstOrThrow();

    expect(row.notifiedAt).not.toBeNull();
  });
});

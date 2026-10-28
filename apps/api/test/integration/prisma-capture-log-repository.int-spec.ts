import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaCaptureLogRepository } from '@/infra/prisma/prisma-capture-log-repository';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import { createTestPrisma, resetDatabase } from './database';
import { FIXED_NOW } from '../factories/make-job';

const prisma: PrismaService = createTestPrisma();
const repository = new PrismaCaptureLogRepository(prisma);

const NEXT_RUN_AT = new Date(FIXED_NOW.getTime() + 2 * 60 * 60 * 1000);

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PrismaCaptureLogRepository (integracao)', () => {
  it('abre o log em RUNNING e devolve o id gerado', async () => {
    const captureId = await repository.start({ startedAt: FIXED_NOW, nextRunAt: NEXT_RUN_AT });

    expect(captureId).toMatch(/^[0-9a-f-]{36}$/);

    const row = await prisma.captureLog.findUniqueOrThrow({ where: { id: captureId } });

    expect(row).toMatchObject({
      status: 'RUNNING',
      totalFound: 0,
      totalPersisted: 0,
      failedSources: [],
      errorMessage: null,
    });
    expect(row.startedAt).toEqual(FIXED_NOW);
    expect(row.nextRunAt).toEqual(NEXT_RUN_AT);
    expect(row.finishedAt).toBeNull();
  });

  it('fecha o log com os totais da execucao', async () => {
    const captureId = await repository.start({ startedAt: FIXED_NOW, nextRunAt: NEXT_RUN_AT });
    const finishedAt = new Date(FIXED_NOW.getTime() + 30_000);

    await repository.finish({
      captureId,
      finishedAt,
      status: 'PARTIAL',
      totalFound: 30,
      totalApproved: 12,
      totalRejected: 18,
      totalDuplicated: 4,
      totalPersisted: 8,
      failedSources: ['linkedin'],
    });

    const row = await prisma.captureLog.findUniqueOrThrow({ where: { id: captureId } });

    expect(row).toMatchObject({
      status: 'PARTIAL',
      totalFound: 30,
      totalApproved: 12,
      totalRejected: 18,
      totalDuplicated: 4,
      totalPersisted: 8,
      failedSources: ['linkedin'],
      errorMessage: null,
    });
    expect(row.finishedAt).toEqual(finishedAt);
  });

  it('persiste a mensagem quando a captura falha inteira', async () => {
    const captureId = await repository.start({ startedAt: FIXED_NOW, nextRunAt: NEXT_RUN_AT });

    await repository.finish({
      captureId,
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

    const row = await prisma.captureLog.findUniqueOrThrow({ where: { id: captureId } });

    expect(row.status).toBe('FAILED');
    expect(row.errorMessage).toBe('Todas as 2 fontes falharam');
    expect(row.failedSources).toEqual(['gupy', 'remotar']);
  });

  it('devolve nulo quando nunca houve captura concluida', async () => {
    await expect(repository.findLastFinished()).resolves.toBeNull();
  });

  it('ignora a captura ainda em andamento', async () => {
    await repository.start({ startedAt: FIXED_NOW, nextRunAt: NEXT_RUN_AT });

    await expect(repository.findLastFinished()).resolves.toBeNull();
  });

  it('devolve a ultima captura concluida, nao a mais antiga', async () => {
    const older = await repository.start({
      startedAt: new Date(FIXED_NOW.getTime() - 7_200_000),
      nextRunAt: FIXED_NOW,
    });
    await repository.finish({
      captureId: older,
      finishedAt: new Date(FIXED_NOW.getTime() - 7_100_000),
      status: 'SUCCESS',
      totalFound: 5,
      totalApproved: 2,
      totalRejected: 3,
      totalDuplicated: 0,
      totalPersisted: 2,
      failedSources: [],
    });

    const latest = await repository.start({ startedAt: FIXED_NOW, nextRunAt: NEXT_RUN_AT });
    await repository.finish({
      captureId: latest,
      finishedAt: new Date(FIXED_NOW.getTime() + 20_000),
      status: 'SUCCESS',
      totalFound: 30,
      totalApproved: 12,
      totalRejected: 18,
      totalDuplicated: 4,
      totalPersisted: 7,
      failedSources: [],
    });

    const snapshot = await repository.findLastFinished();

    expect(snapshot).toEqual({
      startedAt: FIXED_NOW,
      finishedAt: new Date(FIXED_NOW.getTime() + 20_000),
      nextRunAt: NEXT_RUN_AT,
      status: 'SUCCESS',
      totalPersisted: 7,
      failedSources: [],
    });
  });

  it('mantem a captura em andamento fora do cabecalho mesmo apos uma concluida', async () => {
    const finished = await repository.start({ startedAt: FIXED_NOW, nextRunAt: NEXT_RUN_AT });
    await repository.finish({
      captureId: finished,
      finishedAt: new Date(FIXED_NOW.getTime() + 10_000),
      status: 'SUCCESS',
      totalFound: 1,
      totalApproved: 1,
      totalRejected: 0,
      totalDuplicated: 0,
      totalPersisted: 1,
      failedSources: [],
    });

    await repository.start({
      startedAt: new Date(FIXED_NOW.getTime() + 7_200_000),
      nextRunAt: new Date(FIXED_NOW.getTime() + 14_400_000),
    });

    const snapshot = await repository.findLastFinished();

    expect(snapshot?.finishedAt).toEqual(new Date(FIXED_NOW.getTime() + 10_000));
  });
});

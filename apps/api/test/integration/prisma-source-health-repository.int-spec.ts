import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaSourceHealthRepository } from '@/infra/prisma/prisma-source-health-repository';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import { createTestPrisma, resetDatabase } from './database';

const prisma: PrismaService = createTestPrisma();
const repository = new PrismaSourceHealthRepository(prisma);

const REFERENCE = new Date('2026-10-30T12:00:00.000Z');
const WINDOW_IN_HOURS = 24;

function hoursBefore(hours: number): Date {
  return new Date(REFERENCE.getTime() - hours * 60 * 60 * 1000);
}

/** `ranAt` tem `default(now())`, e a janela depende dele: aqui ele e explicito. */
async function seed(
  rows: readonly {
    source: string;
    ranAt: Date;
    totalFound?: number;
    failed?: boolean;
  }[],
): Promise<void> {
  await prisma.captureSourceLog.createMany({
    data: rows.map((row, index) => ({
      captureId: `capture-${index}`,
      source: row.source,
      ranAt: row.ranAt,
      totalFound: row.totalFound ?? 0,
      failed: row.failed ?? false,
    })),
  });
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PrismaSourceHealthRepository (integracao)', () => {
  it('grava uma linha por fonte da captura', async () => {
    await repository.record([
      { captureId: 'abc', source: 'gupy', totalFound: 59, failed: false },
      {
        captureId: 'abc',
        source: 'linkedin',
        totalFound: 0,
        failed: true,
        errorMessage: 'timeout',
      },
    ]);

    const rows = await prisma.captureSourceLog.findMany({ orderBy: { source: 'asc' } });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ source: 'gupy', totalFound: 59, failed: false, errorMessage: null });
    expect(rows[1]).toMatchObject({ source: 'linkedin', failed: true, errorMessage: 'timeout' });
  });

  it('nao toca no banco quando a captura nao produziu nada', async () => {
    await repository.record([]);

    expect(await prisma.captureSourceLog.count()).toBe(0);
  });

  it('soma as vagas lidas e conta as execucoes dentro da janela', async () => {
    await seed([
      { source: 'gupy', ranAt: hoursBefore(1), totalFound: 20 },
      { source: 'gupy', ranAt: hoursBefore(5), totalFound: 39 },
      // Fora da janela de 24h: nao entra no agregado.
      { source: 'gupy', ranAt: hoursBefore(30), totalFound: 500 },
    ]);

    const [health] = await repository.summarize(REFERENCE, WINDOW_IN_HOURS);

    expect(health).toEqual({
      source: 'gupy',
      lastRunAt: hoursBefore(1),
      ok: true,
      runsInWindow: 2,
      failuresInWindow: 0,
      totalFoundInWindow: 59,
    });
  });

  // O que a tabela mostra e o estado AGORA: onze sucessos nao salvam a fonte
  // que acabou de falhar.
  it('reporta a ultima execucao, e nao a media da janela', async () => {
    await seed([
      { source: 'linkedin', ranAt: hoursBefore(4), totalFound: 49 },
      { source: 'linkedin', ranAt: hoursBefore(1), failed: true },
    ]);

    const [health] = await repository.summarize(REFERENCE, WINDOW_IN_HOURS);

    expect(health).toMatchObject({
      ok: false,
      failuresInWindow: 1,
      runsInWindow: 2,
      totalFoundInWindow: 49,
    });
  });

  it('ignora execucoes posteriores a referencia', async () => {
    await seed([
      { source: 'gupy', ranAt: hoursBefore(2), totalFound: 10 },
      { source: 'gupy', ranAt: new Date(REFERENCE.getTime() + 60_000), totalFound: 999, failed: true },
    ]);

    const [health] = await repository.summarize(REFERENCE, WINDOW_IN_HOURS);

    expect(health).toMatchObject({ ok: true, lastRunAt: hoursBefore(2), totalFoundInWindow: 10 });
  });

  it('mantem a fonte que so rodou fora da janela, com os contadores zerados', async () => {
    await seed([{ source: 'jobbol', ranAt: hoursBefore(48), totalFound: 12 }]);

    const [health] = await repository.summarize(REFERENCE, WINDOW_IN_HOURS);

    expect(health).toMatchObject({
      source: 'jobbol',
      lastRunAt: hoursBefore(48),
      runsInWindow: 0,
      totalFoundInWindow: 0,
    });
  });

  it('devolve uma entrada por fonte', async () => {
    await seed([
      { source: 'gupy', ranAt: hoursBefore(1), totalFound: 59 },
      { source: 'nextcommit', ranAt: hoursBefore(1), totalFound: 131 },
      { source: 'linkedin-posts', ranAt: hoursBefore(3), totalFound: 5 },
    ]);

    const health = await repository.summarize(REFERENCE, WINDOW_IN_HOURS);

    expect(health.map((entry) => entry.source).sort()).toEqual([
      'gupy',
      'linkedin-posts',
      'nextcommit',
    ]);
  });

  it('devolve vazio quando nenhum coletor rodou', async () => {
    expect(await repository.summarize(REFERENCE, WINDOW_IN_HOURS)).toEqual([]);
  });
});

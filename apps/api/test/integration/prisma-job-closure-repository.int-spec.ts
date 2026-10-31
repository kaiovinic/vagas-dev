import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { JobListFilters } from '@/domain/repositories/job-query-repository';
import type { PersistableJob } from '@/domain/repositories/job-write-repository';
import { PrismaJobClosureRepository } from '@/infra/prisma/prisma-job-closure-repository';
import { PrismaJobQueryRepository } from '@/infra/prisma/prisma-job-query-repository';
import { PrismaJobRepository } from '@/infra/prisma/prisma-job-repository';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import { createTestPrisma, resetDatabase } from './database';
import { makeJob, FIXED_NOW } from '../factories/make-job';

const prisma: PrismaService = createTestPrisma();
const closures = new PrismaJobClosureRepository(prisma);
const writer = new PrismaJobRepository(prisma);
const queries = new PrismaJobQueryRepository(prisma);

const ABERTA = 'https://github.com/frontendbr/vagas/issues/1';
const FECHADA = 'https://github.com/frontendbr/vagas/issues/2';
const DESCONHECIDA = 'https://github.com/frontendbr/vagas/issues/999';

const ENCERRADA_EM = new Date('2026-10-31T18:00:00.000Z');

function feed(): JobListFilters {
  return { page: 1, perPage: 10, sortBy: 'publishedAt', sortDirection: 'desc' };
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

describe('PrismaJobClosureRepository (integracao)', () => {
  beforeEach(async () => {
    await resetDatabase(prisma);
    await writer.saveMany([
      entry({
        job: makeJob({ title: 'Dev React aberta', company: 'Acme', source: 'github', url: ABERTA }),
      }),
      entry({
        job: makeJob({
          title: 'Dev React encerrada',
          company: 'Contoso',
          source: 'github',
          url: FECHADA,
        }),
      }),
    ]);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('encerra a vaga da url informada', async () => {
    const closed = await closures.closeByUrl([FECHADA], ENCERRADA_EM);

    expect(closed).toBe(1);
  });

  it('nao encerra a vaga que nao foi citada', async () => {
    await closures.closeByUrl([FECHADA], ENCERRADA_EM);

    const { items } = await queries.list(feed());

    expect(items.map((job) => job.url)).toEqual([ABERTA]);
  });

  it('tira a vaga encerrada do feed', async () => {
    const antes = await queries.list(feed());
    await closures.closeByUrl([FECHADA], ENCERRADA_EM);
    const depois = await queries.list(feed());

    expect(antes.total).toBe(2);
    expect(depois.total).toBe(1);
  });

  it('nao conta a vaga encerrada como aberta nos KPIs', async () => {
    await closures.closeByUrl([FECHADA], ENCERRADA_EM);

    const summary = await writer.getOpenJobsSummary(FIXED_NOW);

    expect(summary.openJobs).toBe(1);
  });

  it('tira a vaga encerrada do grafico por fonte', async () => {
    await closures.closeByUrl([FECHADA], ENCERRADA_EM);

    const bySource = await writer.countOpenJobsBySource(FIXED_NOW);

    expect(bySource).toEqual([{ source: 'github', total: 1 }]);
  });

  it('ignora url que o radar nunca gravou', async () => {
    const closed = await closures.closeByUrl([DESCONHECIDA], ENCERRADA_EM);

    expect(closed).toBe(0);
  });

  it('nao reencerra vaga ja encerrada, preservando a data original', async () => {
    await closures.closeByUrl([FECHADA], ENCERRADA_EM);
    const segundo = await closures.closeByUrl([FECHADA], new Date('2026-11-01T18:00:00.000Z'));

    const [row] = await prisma.job.findMany({
      where: { url: FECHADA },
      select: { closedAt: true },
    });

    expect(segundo).toBe(0);
    expect(row?.closedAt?.toISOString()).toBe(ENCERRADA_EM.toISOString());
  });

  it('nao consulta o banco com lista vazia', async () => {
    await expect(closures.closeByUrl([], ENCERRADA_EM)).resolves.toBe(0);
  });
});

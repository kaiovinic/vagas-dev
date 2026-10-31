import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PersistableJob } from '@/domain/repositories/job-write-repository';
import { PrismaInhireTenantReader } from '@/infra/prisma/prisma-inhire-tenant-reader';
import { PrismaJobClosureRepository } from '@/infra/prisma/prisma-job-closure-repository';
import { PrismaJobRepository } from '@/infra/prisma/prisma-job-repository';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import { extractInhireTenants } from '@/infra/scrapers/support/inhire-tenants';
import { createTestPrisma, resetDatabase } from './database';
import { hoursAgo, makeJob } from '../factories/make-job';

const prisma: PrismaService = createTestPrisma();
const reader = new PrismaInhireTenantReader(prisma);
const writer = new PrismaJobRepository(prisma);
const closures = new PrismaJobClosureRepository(prisma);

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

describe('PrismaInhireTenantReader (integracao)', () => {
  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('le a url da propria vaga da inhire', async () => {
    await writer.saveMany([
      entry({
        job: makeJob({
          company: 'Sympla',
          source: 'inhire',
          url: 'https://sympla.inhire.app/vagas/abc',
        }),
      }),
    ]);

    expect(await reader.findTextsMentioningInhire(100)).toContain(
      'https://sympla.inhire.app/vagas/abc',
    );
  });

  it('le o link da inhire citado na descricao de outra fonte', async () => {
    await writer.saveMany([
      entry({
        job: makeJob({
          company: 'Nova Tech',
          source: 'remotar',
          url: 'https://remotar.com.br/vagas/1',
          description: 'Candidate-se em https://novatech.inhire.app/vagas/xyz',
        }),
      }),
    ]);

    const textos = await reader.findTextsMentioningInhire(100);

    expect(extractInhireTenants(textos)).toEqual(['novatech']);
  });

  it('ignora a vaga que nao cita a inhire', async () => {
    await writer.saveMany([
      entry({
        job: makeJob({
          company: 'Acme',
          source: 'gupy',
          url: 'https://acme.gupy.io/job/1',
          description: 'Vaga para React Pleno',
        }),
      }),
    ]);

    expect(await reader.findTextsMentioningInhire(100)).toEqual([]);
  });

  it('le tambem a vaga encerrada, que ainda prova que o tenant existe', async () => {
    const url = 'https://sympla.inhire.app/vagas/abc';
    await writer.saveMany([
      entry({ job: makeJob({ company: 'Sympla', source: 'inhire', url }) }),
    ]);
    await closures.closeByUrl([url], new Date());

    expect(await reader.findTextsMentioningInhire(100)).toContain(url);
  });

  it('respeita o teto de linhas, da mais recente para a mais antiga', async () => {
    await writer.saveMany([
      entry({
        job: makeJob({
          company: 'Antiga',
          source: 'inhire',
          url: 'https://antiga.inhire.app/vagas/1',
          publishedAt: hoursAgo(70),
        }),
      }),
      entry({
        job: makeJob({
          company: 'Recente',
          source: 'inhire',
          url: 'https://recente.inhire.app/vagas/2',
          publishedAt: hoursAgo(1),
        }),
      }),
    ]);

    const textos = await reader.findTextsMentioningInhire(1);

    expect(extractInhireTenants(textos)).toEqual(['recente']);
  });
});

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PersistableJob } from '@/domain/repositories/job-write-repository';
import { PrismaJobDescriptionRepository } from '@/infra/prisma/prisma-job-description-repository';
import { PrismaJobRepository } from '@/infra/prisma/prisma-job-repository';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import { createTestPrisma, resetDatabase } from './database';
import { makeJob } from '../factories/make-job';

const prisma: PrismaService = createTestPrisma();
const repository = new PrismaJobDescriptionRepository(prisma);
const writer = new PrismaJobRepository(prisma);

const COM_DESCRICAO = 'https://br.linkedin.com/jobs/view/com-descricao-1';
const SEM_DESCRICAO = 'https://br.linkedin.com/jobs/view/sem-descricao-2';
const NUNCA_VISTA = 'https://br.linkedin.com/jobs/view/nunca-vista-3';

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

describe('PrismaJobDescriptionRepository (integracao)', () => {
  beforeEach(async () => {
    await resetDatabase(prisma);
    await writer.saveMany([
      entry({
        job: makeJob({
          title: 'Dev React com descricao',
          company: 'Acme',
          source: 'linkedin',
          url: COM_DESCRICAO,
          description: 'Vaga React em Feira de Santana.',
        }),
      }),
      entry({
        job: makeJob({
          title: 'Dev React sem descricao',
          company: 'Contoso',
          source: 'linkedin',
          url: SEM_DESCRICAO,
          description: '',
        }),
      }),
    ]);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('devolve a descricao das vagas que ja a tem', async () => {
    const found = await repository.findDescriptionsByUrl([COM_DESCRICAO]);

    expect(found.get(COM_DESCRICAO)).toBe('Vaga React em Feira de Santana.');
  });

  it('nao devolve vaga gravada com descricao vazia', async () => {
    // Esta e a vaga capturada antes de a busca de detalhe existir: ela precisa
    // aparecer como desconhecida para o coletor busca-la uma vez.
    const found = await repository.findDescriptionsByUrl([SEM_DESCRICAO]);

    expect(found.has(SEM_DESCRICAO)).toBe(false);
  });

  it('ignora url que nunca foi vista', async () => {
    const found = await repository.findDescriptionsByUrl([NUNCA_VISTA]);

    expect(found.size).toBe(0);
  });

  it('responde a uma consulta com varias urls de uma vez', async () => {
    const found = await repository.findDescriptionsByUrl([
      COM_DESCRICAO,
      SEM_DESCRICAO,
      NUNCA_VISTA,
    ]);

    expect([...found.keys()]).toEqual([COM_DESCRICAO]);
  });

  it('nao consulta o banco com lista vazia', async () => {
    const found = await repository.findDescriptionsByUrl([]);

    expect(found.size).toBe(0);
  });
});

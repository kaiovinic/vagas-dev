import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { GeneratedResumeContent } from '@/domain/providers/resume-generator';
import { PrismaJobRepository } from '@/infra/prisma/prisma-job-repository';
import { PrismaResumeRepository } from '@/infra/prisma/prisma-resume-repository';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import { createTestPrisma, resetDatabase } from './database';
import { hoursAgo, makeJob } from '../factories/make-job';

const prisma: PrismaService = createTestPrisma();
const repository = new PrismaResumeRepository(prisma);
const jobs = new PrismaJobRepository(prisma);

function content(overrides: Partial<GeneratedResumeContent> = {}): GeneratedResumeContent {
  return {
    markdown: '# Kaio Vinicius',
    rationale: ['Abri pela Acme.'],
    gaps: ['Sem Angular.'],
    usage: {
      model: 'claude-opus-5-5',
      inputTokens: 300,
      outputTokens: 1_800,
      cacheReadTokens: 2_600,
      cacheCreationTokens: 0,
    },
    ...overrides,
  };
}

async function saveJob(): Promise<string> {
  await jobs.saveMany([
    {
      job: makeJob({ company: 'Globex', url: 'https://gupy.io/vagas/1', publishedAt: hoursAgo(2) }),
      publishedAtSource: 'SOURCE',
      recruiterName: '',
      tags: ['React'],
      scope: 'NATIONAL',
    },
  ]);

  const row = await prisma.job.findFirstOrThrow();

  return row.id;
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PrismaResumeRepository (integracao)', () => {
  it('entrega a vaga alvo com o que o prompt precisa saber dela', async () => {
    const jobId = await saveJob();

    const job = await repository.findById(jobId);

    expect(job).toMatchObject({
      id: jobId,
      company: 'Globex',
      workModel: 'REMOTE',
      location: 'Salvador/BA',
      tags: ['React'],
    });
  });

  it('devolve nulo para vaga que nao existe', async () => {
    expect(await repository.findById('fantasma')).toBeNull();
  });

  it('grava o curriculo com o consumo que a geracao custou', async () => {
    const jobId = await saveJob();

    const stored = await repository.save(jobId, content());

    expect(stored).toMatchObject({
      jobId,
      markdown: '# Kaio Vinicius',
      rationale: ['Abri pela Acme.'],
      gaps: ['Sem Angular.'],
      model: 'claude-opus-5-5',
      inputTokens: 300,
      outputTokens: 1_800,
    });
    expect(stored.createdAt).toBeInstanceOf(Date);
  });

  it('nao acha historico onde ainda nao houve geracao', async () => {
    const jobId = await saveJob();

    expect(await repository.findLatestByJob(jobId)).toBeNull();
  });

  it('devolve a versao mais recente da vaga', async () => {
    const jobId = await saveJob();
    await repository.save(jobId, content({ markdown: 'primeira' }));
    await repository.save(jobId, content({ markdown: 'segunda' }));

    const latest = await repository.findLatestByJob(jobId);

    expect(latest?.markdown).toBe('segunda');
  });

  it('leva o historico embora junto com a vaga apagada', async () => {
    const jobId = await saveJob();
    await repository.save(jobId, content());

    await prisma.job.delete({ where: { id: jobId } });

    expect(await prisma.generatedResume.count()).toBe(0);
  });
});

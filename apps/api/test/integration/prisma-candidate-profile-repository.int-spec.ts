import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CandidateProfile,
  type CreateCandidateProfileProps,
} from '@/domain/entities/candidate-profile';
import { SOLE_CANDIDATE_PROFILE_ID } from '@/domain/repositories/candidate-profile-repository';
import { PrismaCandidateProfileRepository } from '@/infra/prisma/prisma-candidate-profile-repository';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import { createTestPrisma, resetDatabase } from './database';

const prisma: PrismaService = createTestPrisma();
const repository = new PrismaCandidateProfileRepository(prisma);

const PROPS: CreateCandidateProfileProps = {
  fullName: 'Kaio Vinicius',
  headline: 'Desenvolvedor Frontend',
  summary: 'Interfaces em React e TypeScript.',
  email: 'kaio@example.com',
  city: 'Salvador, BA',
  phone: '+55 71 90000-0000',
  linkedinUrl: 'https://linkedin.com/in/kaio',
  githubUrl: 'https://github.com/kaio',
  portfolioUrl: null,
  experiences: [
    {
      company: 'Acme',
      role: 'Frontend',
      startedAt: '2022-01',
      endedAt: null,
      description: 'Painel de metricas em React.',
      techs: ['React', 'TypeScript'],
    },
  ],
  education: [
    { institution: 'UFBA', degree: 'Sistemas de Informacao', startedAt: '2016-02', endedAt: '2020-12' },
  ],
  skills: [{ category: 'Frontend', items: ['React', 'Next.js'] }],
  projects: [
    { name: 'DevRadar', description: 'Agregador de vagas.', url: 'https://devradar.dev', techs: ['NestJS'] },
  ],
};

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PrismaCandidateProfileRepository (integracao)', () => {
  it('devolve nulo enquanto o perfil nunca foi salvo', async () => {
    await expect(repository.find()).resolves.toBeNull();
  });

  it('cria o perfil na linha unica e le de volta tudo o que foi gravado', async () => {
    await repository.save(CandidateProfile.create(PROPS));

    const found = await repository.find();

    expect(found).not.toBeNull();
    expect(found?.toJSON()).toEqual(CandidateProfile.create(PROPS).toJSON());

    const rows = await prisma.candidateProfile.findMany();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(SOLE_CANDIDATE_PROFILE_ID);
  });

  it('atualiza a mesma linha no segundo save, sem criar um segundo perfil', async () => {
    await repository.save(CandidateProfile.create(PROPS));
    await repository.save(CandidateProfile.create({ ...PROPS, headline: 'Fullstack' }));

    const rows = await prisma.candidateProfile.findMany();

    expect(rows).toHaveLength(1);
    expect((await repository.find())?.headline).toBe('Fullstack');
  });

  it('apaga de verdade a lista que o usuario esvaziou, em vez de manter a anterior', async () => {
    await repository.save(CandidateProfile.create(PROPS));
    await repository.save(
      CandidateProfile.create({ ...PROPS, projects: [], education: [], portfolioUrl: null }),
    );

    const found = await repository.find();

    expect(found?.projects).toEqual([]);
    expect(found?.education).toEqual([]);
  });

  it('le lista vazia quando a coluna JSON tem algo que nao e lista', async () => {
    await repository.save(CandidateProfile.create(PROPS));
    await prisma.candidateProfile.update({
      where: { id: SOLE_CANDIDATE_PROFILE_ID },
      data: { projects: { quebrado: true } },
    });

    expect((await repository.find())?.projects).toEqual([]);
  });
});

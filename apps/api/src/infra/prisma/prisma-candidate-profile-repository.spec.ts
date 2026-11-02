import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CandidateProfile,
  type CreateCandidateProfileProps,
} from '@/domain/entities/candidate-profile';
import { SOLE_CANDIDATE_PROFILE_ID } from '@/domain/repositories/candidate-profile-repository';
import { PrismaCandidateProfileRepository } from '@/infra/prisma/prisma-candidate-profile-repository';
import type { PrismaService } from '@/infra/prisma/prisma.service';

interface PrismaStub {
  candidateProfile: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
}

const PROPS: CreateCandidateProfileProps = {
  fullName: 'Kaio Vinicius',
  headline: 'Desenvolvedor Frontend',
  summary: 'Interfaces em React e TypeScript.',
  email: 'kaio@example.com',
  city: 'Salvador, BA',
  phone: null,
  linkedinUrl: null,
  githubUrl: null,
  portfolioUrl: null,
  experiences: [
    {
      company: 'Acme',
      role: 'Frontend',
      startedAt: '2022-01',
      endedAt: null,
      description: 'Painel de metricas.',
      techs: ['React'],
    },
  ],
  education: [],
  skills: [{ category: 'Frontend', items: ['React'] }],
  projects: [],
};

describe('PrismaCandidateProfileRepository', () => {
  let prisma: PrismaStub;
  let repository: PrismaCandidateProfileRepository;

  beforeEach(() => {
    prisma = {
      candidateProfile: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
    };
    repository = new PrismaCandidateProfileRepository(prisma as unknown as PrismaService);
  });

  it('procura sempre a linha unica do perfil', async () => {
    await expect(repository.find()).resolves.toBeNull();
    expect(prisma.candidateProfile.findUnique).toHaveBeenCalledWith({
      where: { id: SOLE_CANDIDATE_PROFILE_ID },
    });
  });

  it('reconstroi a entidade a partir da linha lida', async () => {
    prisma.candidateProfile.findUnique.mockResolvedValue(CandidateProfile.create(PROPS).toJSON());

    const found = await repository.find();

    expect(found?.fullName).toBe('Kaio Vinicius');
    expect(found?.experiences[0]?.company).toBe('Acme');
  });

  it('grava os mesmos campos no create e no update, para o upsert nao deixar resto', async () => {
    const profile = CandidateProfile.create(PROPS);

    prisma.candidateProfile.upsert.mockResolvedValue(profile.toJSON());

    await repository.save(profile);

    const call = prisma.candidateProfile.upsert.mock.calls[0]?.[0] as {
      where: { id: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };

    expect(call.where).toEqual({ id: SOLE_CANDIDATE_PROFILE_ID });
    expect(call.create).toMatchObject({ id: SOLE_CANDIDATE_PROFILE_ID, fullName: 'Kaio Vinicius' });
    expect(call.update).toEqual(
      expect.objectContaining({ fullName: 'Kaio Vinicius', skills: [{ category: 'Frontend', items: ['React'] }] }),
    );
    expect(Object.keys(call.update).sort()).toEqual(
      Object.keys(call.create)
        .filter((key) => key !== 'id')
        .sort(),
    );
  });

  it('trata coluna JSON que nao e lista como lista vazia', async () => {
    prisma.candidateProfile.findUnique.mockResolvedValue({
      ...CandidateProfile.create(PROPS).toJSON(),
      projects: { quebrado: true },
      education: null,
    });

    const found = await repository.find();

    expect(found?.projects).toEqual([]);
    expect(found?.education).toEqual([]);
  });
});

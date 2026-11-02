import {
  CandidateProfile,
  type CreateCandidateProfileProps,
} from '@/domain/entities/candidate-profile';
import type { ResumeTargetJob } from '@/domain/providers/resume-generator';

export function makeProfileProps(
  overrides: Partial<CreateCandidateProfileProps> = {},
): CreateCandidateProfileProps {
  return {
    fullName: 'Kaio Vinicius',
    headline: 'Desenvolvedor Frontend',
    summary: 'Cinco anos construindo interfaces em React e TypeScript.',
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
      {
        institution: 'UFBA',
        degree: 'Sistemas de Informacao',
        startedAt: '2016-02',
        endedAt: '2020-12',
      },
    ],
    skills: [{ category: 'Frontend', items: ['React', 'Next.js'] }],
    projects: [
      {
        name: 'DevRadar',
        description: 'Agregador de vagas.',
        url: 'https://devradar.dev',
        techs: ['NestJS'],
      },
    ],
    ...overrides,
  };
}

export function makeProfile(overrides: Partial<CreateCandidateProfileProps> = {}): CandidateProfile {
  return CandidateProfile.create(makeProfileProps(overrides));
}

export function makeResumeTargetJob(overrides: Partial<ResumeTargetJob> = {}): ResumeTargetJob {
  return {
    id: 'job-1',
    title: 'Desenvolvedor Frontend React',
    company: 'Globex',
    description: 'Buscamos alguem com React, TypeScript e testes automatizados.',
    tags: ['React', 'TypeScript'],
    workModel: 'REMOTE',
    location: 'Salvador/BA',
    url: 'https://gupy.io/vagas/1',
    ...overrides,
  };
}

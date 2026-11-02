import { describe, expect, it } from 'vitest';

import type { CandidateProfile } from '@/api/schemas';
import {
  EMPTY_FORM,
  profileFormSchema,
  toFormValues,
  toProfilePayload,
} from '@/components/profile/profile-form-values';

const PROFILE: CandidateProfile = {
  fullName: 'Kaio Vinicius',
  headline: 'Desenvolvedor Frontend',
  summary: 'Interfaces em React.',
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
      description: 'Painel.',
      techs: ['React', 'TypeScript'],
    },
  ],
  education: [{ institution: 'UFBA', degree: 'SI', startedAt: '2016-02', endedAt: null }],
  skills: [{ category: 'Frontend', items: ['React'] }],
  projects: [{ name: 'DevRadar', description: 'Agregador.', url: null, techs: ['NestJS'] }],
};

describe('profile-form-values', () => {
  it('abre o formulario vazio na primeira visita', () => {
    expect(toFormValues(null)).toEqual(EMPTY_FORM);
  });

  it('transforma nulo em campo vazio e lista em texto separado por virgula', () => {
    const values = toFormValues(PROFILE);

    expect(values.phone).toBe('');
    expect(values.experiences[0]?.endedAt).toBe('');
    expect(values.experiences[0]?.techs).toBe('React, TypeScript');
    expect(values.education[0]?.endedAt).toBe('');
    expect(values.skills[0]?.items).toBe('React');
    expect(values.projects[0]?.url).toBe('');
    expect(values.projects[0]?.techs).toBe('NestJS');
  });

  it('volta ao perfil sem perder nada no caminho de ida e volta', () => {
    expect(toProfilePayload(toFormValues(PROFILE))).toEqual(PROFILE);
  });

  it('transforma campo vazio em nulo e descarta virgula sobrando', () => {
    const payload = toProfilePayload({
      ...EMPTY_FORM,
      fullName: '  Kaio  ',
      headline: 'Dev',
      summary: 'Resumo',
      email: 'kaio@example.com',
      city: 'Salvador',
      phone: '   ',
      experiences: [
        {
          company: 'Acme',
          role: 'Dev',
          startedAt: '2022-01',
          endedAt: '',
          description: 'Painel',
          techs: 'React, , TypeScript,',
        },
      ],
      skills: [{ category: 'Front', items: 'React,,Next.js' }],
    });

    expect(payload.fullName).toBe('Kaio');
    expect(payload.phone).toBeNull();
    expect(payload.experiences[0]).toMatchObject({ endedAt: null, techs: ['React', 'TypeScript'] });
    expect(payload.skills[0]?.items).toEqual(['React', 'Next.js']);
  });

  it('aceita o fim do periodo em branco, mas recusa o mes fora do formato', () => {
    const base = {
      ...EMPTY_FORM,
      fullName: 'Kaio',
      headline: 'Dev',
      summary: 'Resumo',
      email: 'kaio@example.com',
      city: 'Salvador',
      education: [{ institution: 'UFBA', degree: 'SI', startedAt: '2016-02', endedAt: '' }],
    };

    expect(profileFormSchema.safeParse(base).success).toBe(true);

    const badEnd = {
      ...base,
      education: [{ institution: 'UFBA', degree: 'SI', startedAt: '2016-02', endedAt: '12/2020' }],
    };

    expect(profileFormSchema.safeParse(badEnd).success).toBe(false);
  });
});

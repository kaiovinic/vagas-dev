import { describe, expect, it } from 'vitest';

import {
  CandidateProfile,
  type CreateCandidateProfileProps,
} from '@/domain/entities/candidate-profile';
import { InvalidCandidateProfileError } from '@/domain/errors/invalid-candidate-profile-error';

function makeProps(overrides: Partial<CreateCandidateProfileProps> = {}): CreateCandidateProfileProps {
  return {
    fullName: '  Kaio Vinicius  ',
    headline: 'Desenvolvedor Frontend',
    summary: 'Cinco anos construindo interfaces em React e TypeScript.',
    email: 'kaio@example.com',
    city: 'Salvador, BA',
    phone: ' +55 71 90000-0000 ',
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
    ...overrides,
  };
}

describe('CandidateProfile', () => {
  it('normaliza os campos e expoe o perfil completo', () => {
    const profile = CandidateProfile.create(makeProps());

    expect(profile.fullName).toBe('Kaio Vinicius');
    expect(profile.headline).toBe('Desenvolvedor Frontend');
    expect(profile.summary).toBe('Cinco anos construindo interfaces em React e TypeScript.');
    expect(profile.email).toBe('kaio@example.com');
    expect(profile.city).toBe('Salvador, BA');
    expect(profile.phone).toBe('+55 71 90000-0000');
    expect(profile.linkedinUrl).toBe('https://linkedin.com/in/kaio');
    expect(profile.githubUrl).toBe('https://github.com/kaio');
    expect(profile.portfolioUrl).toBeNull();
    expect(profile.experiences).toHaveLength(1);
    expect(profile.education[0]?.endedAt).toBe('2020-12');
    expect(profile.skills[0]?.items).toEqual(['React', 'Next.js']);
    expect(profile.projects[0]?.url).toBe('https://devradar.dev');
    expect(profile.toJSON().fullName).toBe('Kaio Vinicius');
  });

  it('trata as listas ausentes como vazias e o telefone vazio como nulo', () => {
    const profile = CandidateProfile.create({
      fullName: 'Kaio',
      headline: 'Dev',
      summary: 'Resumo',
      email: 'kaio@example.com',
      city: 'Salvador',
      phone: '   ',
    });

    expect(profile.phone).toBeNull();
    expect(profile.linkedinUrl).toBeNull();
    expect(profile.experiences).toEqual([]);
    expect(profile.education).toEqual([]);
    expect(profile.skills).toEqual([]);
    expect(profile.projects).toEqual([]);
  });

  it('serve para gerar curriculo quando tem experiencia e competencia', () => {
    expect(CandidateProfile.create(makeProps()).isUsableForResume).toBe(true);
    expect(CandidateProfile.create(makeProps({ experiences: [] })).isUsableForResume).toBe(false);
    expect(CandidateProfile.create(makeProps({ skills: [] })).isUsableForResume).toBe(false);
  });

  it.each([
    ['fullName', { fullName: '   ' }],
    ['headline', { headline: '' }],
    ['summary', { summary: '  ' }],
    ['city', { city: '' }],
  ])('recusa o perfil sem %s', (_field, overrides) => {
    expect(() => CandidateProfile.create(makeProps(overrides))).toThrow(InvalidCandidateProfileError);
  });

  it.each(['sem-arroba', 'kaio@sem-dominio', ''])('recusa o e-mail invalido %s', (email) => {
    expect(() => CandidateProfile.create(makeProps({ email }))).toThrow(InvalidCandidateProfileError);
  });

  it('recusa link sem protocolo http', () => {
    expect(() => CandidateProfile.create(makeProps({ githubUrl: 'github.com/kaio' }))).toThrow(
      /valid absolute URL/,
    );
    expect(() => CandidateProfile.create(makeProps({ githubUrl: 'ftp://github.com/kaio' }))).toThrow(
      /http or https/,
    );
  });

  it('recusa experiencia com periodo invertido ou mes fora do formato', () => {
    const inverted = makeProps({
      experiences: [
        {
          company: 'Acme',
          role: 'Frontend',
          startedAt: '2023-01',
          endedAt: '2022-12',
          description: 'Painel.',
          techs: [],
        },
      ],
    });

    expect(() => CandidateProfile.create(inverted)).toThrow(/experiences\[0\].endedAt/);

    const badMonth = makeProps({
      experiences: [
        {
          company: 'Acme',
          role: 'Frontend',
          startedAt: '2023-13',
          endedAt: null,
          description: 'Painel.',
          techs: [],
        },
      ],
    });

    expect(() => CandidateProfile.create(badMonth)).toThrow(/YYYY-MM/);
  });

  it('recusa experiencia sem empresa, cargo, descricao ou com tech vazia', () => {
    const base = {
      company: 'Acme',
      role: 'Frontend',
      startedAt: '2023-01',
      endedAt: null,
      description: 'Painel.',
      techs: ['React'],
    };

    expect(() => CandidateProfile.create(makeProps({ experiences: [{ ...base, company: ' ' }] }))).toThrow(
      /experiences\[0\].company/,
    );
    expect(() => CandidateProfile.create(makeProps({ experiences: [{ ...base, role: '' }] }))).toThrow(
      /experiences\[0\].role/,
    );
    expect(() => CandidateProfile.create(makeProps({ experiences: [{ ...base, description: '' }] }))).toThrow(
      /experiences\[0\].description/,
    );
    expect(() => CandidateProfile.create(makeProps({ experiences: [{ ...base, techs: [' '] }] }))).toThrow(
      /experiences\[0\].techs\[0\]/,
    );
  });

  it('aceita experiencia sem lista de techs e sem fim informado', () => {
    const profile = CandidateProfile.create(
      makeProps({
        experiences: [
          {
            company: 'Acme',
            role: 'Frontend',
            startedAt: '2023-01',
            endedAt: undefined as unknown as null,
            description: 'Painel.',
            techs: undefined as unknown as string[],
          },
        ],
      }),
    );

    expect(profile.experiences[0]).toMatchObject({ endedAt: null, techs: [] });
  });

  it('recusa campo ausente de vez, e nao so vazio, vindo de dado estragado', () => {
    expect(() =>
      CandidateProfile.create(makeProps({ fullName: undefined as unknown as string })),
    ).toThrow(/fullName is required/);

    const noStart = makeProps({
      experiences: [
        {
          company: 'Acme',
          role: 'Frontend',
          startedAt: undefined as unknown as string,
          endedAt: null,
          description: 'Painel.',
          techs: [],
        },
      ],
    });

    expect(() => CandidateProfile.create(noStart)).toThrow(/YYYY-MM/);
  });

  it('recusa techs que nao sejam lista', () => {
    const props = makeProps({
      experiences: [
        {
          company: 'Acme',
          role: 'Frontend',
          startedAt: '2023-01',
          endedAt: null,
          description: 'Painel.',
          techs: 'React' as unknown as string[],
        },
      ],
    });

    expect(() => CandidateProfile.create(props)).toThrow(/must be a list/);
  });

  it('recusa formacao sem instituicao ou sem curso', () => {
    const base = { institution: 'UFBA', degree: 'SI', startedAt: '2016-02', endedAt: null };

    expect(() => CandidateProfile.create(makeProps({ education: [{ ...base, institution: '' }] }))).toThrow(
      /education\[0\].institution/,
    );
    expect(() => CandidateProfile.create(makeProps({ education: [{ ...base, degree: ' ' }] }))).toThrow(
      /education\[0\].degree/,
    );
  });

  it('recusa grupo de competencia sem categoria ou sem itens', () => {
    expect(() => CandidateProfile.create(makeProps({ skills: [{ category: '', items: ['React'] }] }))).toThrow(
      /skills\[0\].category/,
    );
    expect(() => CandidateProfile.create(makeProps({ skills: [{ category: 'Front', items: [] }] }))).toThrow(
      /at least one item/,
    );
  });

  it('recusa projeto invalido e aceita projeto sem link', () => {
    const base = { name: 'DevRadar', description: 'Agregador.', url: null, techs: ['NestJS'] };

    expect(() => CandidateProfile.create(makeProps({ projects: [{ ...base, name: '' }] }))).toThrow(
      /projects\[0\].name/,
    );
    expect(() => CandidateProfile.create(makeProps({ projects: [{ ...base, description: ' ' }] }))).toThrow(
      /projects\[0\].description/,
    );

    const profile = CandidateProfile.create(makeProps({ projects: [base] }));

    expect(profile.projects[0]?.url).toBeNull();
  });
});

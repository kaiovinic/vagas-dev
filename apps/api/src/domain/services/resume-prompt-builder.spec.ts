import { describe, expect, it } from 'vitest';

import { ProfileNotReadyForResumeError } from '@/domain/errors/resume-errors';
import {
  MAX_JOB_DESCRIPTION_CHARS,
  RESUME_RULES,
  ResumePromptBuilder,
} from '@/domain/services/resume-prompt-builder';
import { makeProfile, makeResumeTargetJob } from '../../../test/factories/make-candidate-profile';

const builder = new ResumePromptBuilder();

function build(
  profileOverrides: Parameters<typeof makeProfile>[0] = {},
  jobOverrides: Parameters<typeof makeResumeTargetJob>[0] = {},
): ReturnType<ResumePromptBuilder['build']> {
  return builder.build({
    profile: makeProfile(profileOverrides),
    job: makeResumeTargetJob(jobOverrides),
  });
}

describe('ResumePromptBuilder', () => {
  it('abre com as regras do jogo, iguais em toda geracao', () => {
    expect(build().rules).toBe(RESUME_RULES);
    expect(RESUME_RULES).toContain('SOMENTE fatos presentes no perfil');
  });

  /**
   * O painel so tem o que estilizar se o Markdown chegar com os niveis certos:
   * uma geracao em texto plano vira um PDF sem hierarquia nenhuma. Por isso a
   * estrutura e contrato testado, e nao uma sugestao no meio do prompt.
   */
  describe('contrato de estrutura do Markdown', () => {
    const { rules } = build();

    it('exige um unico nome no topo, seguido dos contatos', () => {
      expect(rules).toContain('Um unico "# Nome Completo" no topo');
      expect(rules).toContain('contatos separados por " | "');
    });

    it('exige as secoes em caixa alta, na ordem do curriculo', () => {
      expect(rules).toContain('Cada secao e um "## " em CAIXA ALTA');
      expect(rules).toContain('RESUMO, EXPERIÊNCIA,');
      expect(rules).toContain('COMPETÊNCIAS, PROJETOS, FORMAÇÃO');
    });

    /** Fora dos parenteses o `splitPeriod` do painel nao acha a data. */
    it('exige o periodo entre parenteses no fim do titulo da entrada', () => {
      expect(rules).toContain('Cada cargo, projeto ou curso e um "### Titulo (periodo)"');
      expect(rules).toContain('nunca fora deles');
      expect(rules).toContain('a atual');
    });

    it('fixa a linha de tecnologias, que vira as etiquetas do PDF', () => {
      expect(rules).toContain('"**Tecnologias:** item1, item2"');
      expect(rules).toContain('Em nenhum outro lugar');
    });

    /** `####` o leitor de Markdown do painel nao reconhece: viraria texto. */
    it('proibe nivel de titulo que o painel nao renderiza', () => {
      expect(rules).toContain('Nunca use "####" ou mais fundo');
    });

    it('mostra o esqueleto, e nao so descreve', () => {
      expect(rules).toContain('### Cargo na Empresa (2024-10 a atual)');
      expect(rules).toContain('**Tecnologias:** React, TypeScript');
      expect(rules).toContain('## EXPERIÊNCIA');
    });
  });

  it('leva o perfil inteiro para o bloco estavel', () => {
    const { profile } = build();

    expect(profile).toContain('Kaio Vinicius');
    expect(profile).toContain('Desenvolvedor Frontend');
    expect(profile).toContain('Cinco anos construindo interfaces');
    expect(profile).toContain('E-mail: kaio@example.com');
    expect(profile).toContain('Telefone: +55 71 90000-0000');
    expect(profile).toContain('LinkedIn: https://linkedin.com/in/kaio');
    expect(profile).toContain('GitHub: https://github.com/kaio');
    expect(profile).toContain('Frontend na Acme (2022-01 a atual)');
    expect(profile).toContain('Tecnologias: React, TypeScript');
    expect(profile).toContain('- Frontend: React, Next.js');
    expect(profile).toContain('DevRadar (https://devradar.dev)');
    expect(profile).toContain('Sistemas de Informacao — UFBA (2016-02 a 2020-12)');
  });

  it('omite o contato que o candidato nao informou, em vez de mandar vazio', () => {
    const { profile } = build();

    expect(profile).not.toContain('Portfolio:');
  });

  it('diz o periodo fechado quando a experiencia terminou', () => {
    const { profile } = build({
      experiences: [
        {
          company: 'Initech',
          role: 'Fullstack',
          startedAt: '2019-03',
          endedAt: '2021-11',
          description: 'API em Node.',
          techs: ['Node'],
        },
      ],
    });

    expect(profile).toContain('Fullstack na Initech (2019-03 a 2021-11)');
  });

  it('nao cria secao vazia de projetos nem de formacao', () => {
    const { profile } = build({ projects: [], education: [] });

    expect(profile).not.toContain('## Projetos');
    expect(profile).not.toContain('## Formacao');
  });

  it('cita o projeto sem link sem deixar parenteses solto', () => {
    const { profile } = build({
      projects: [{ name: 'Robo interno', description: 'Scraper.', url: null, techs: ['Python'] }],
    });

    expect(profile).toContain('- Robo interno\n');
    expect(profile).not.toContain('Robo interno (');
  });

  it('leva a vaga para o bloco volatil, com regime traduzido', () => {
    const { job } = build();

    expect(job).toContain('Titulo: Desenvolvedor Frontend React');
    expect(job).toContain('Empresa: Globex');
    expect(job).toContain('Regime: remoto');
    expect(job).toContain('Localidade: Salvador/BA');
    expect(job).toContain('Tecnologias marcadas na captura: React, TypeScript');
    expect(job).toContain('Link: https://gupy.io/vagas/1');
    expect(job).toContain('testes automatizados');
  });

  it.each([
    ['HYBRID', 'hibrido'],
    ['ONSITE', 'presencial'],
    ['UNKNOWN', 'nao informado'],
  ] as const)('traduz o regime %s', (workModel, expected) => {
    expect(build({}, { workModel }).job).toContain(`Regime: ${expected}`);
  });

  it('nao esconde a ausencia de localidade nem de tags atras de campo vazio', () => {
    const { job } = build({}, { location: '', tags: [] });

    expect(job).toContain('Localidade: nao informada');
    expect(job).toContain('Tecnologias marcadas na captura: nenhuma');
  });

  it('corta a descricao gigante, para o custo por geracao nao depender do anuncio', () => {
    const { job } = build({}, { description: 'a'.repeat(MAX_JOB_DESCRIPTION_CHARS + 500) });

    expect(job).toContain('[descricao truncada]');
    expect(job.length).toBeLessThan(MAX_JOB_DESCRIPTION_CHARS + 500);
  });

  it('deixa passar a descricao que cabe, sem marca de corte', () => {
    expect(build().job).not.toContain('[descricao truncada]');
  });

  it('recusa perfil sem experiencia antes de gastar token', () => {
    expect(() => build({ experiences: [] })).toThrow(ProfileNotReadyForResumeError);
  });

  it('recusa perfil sem competencia antes de gastar token', () => {
    expect(() => build({ skills: [] })).toThrow(ProfileNotReadyForResumeError);
  });
});

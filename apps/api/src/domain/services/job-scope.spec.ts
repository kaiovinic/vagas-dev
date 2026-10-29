import { describe, expect, it } from 'vitest';

import {
  JOB_SCOPES,
  classifyJobScope,
  isJobScope,
  type ClassifiableJob,
} from '@/domain/services/job-scope';

function job(overrides: Partial<ClassifiableJob> = {}): ClassifiableJob {
  return {
    title: 'Desenvolvedor Frontend React',
    company: '',
    description: '',
    location: '',
    tags: [],
    ...overrides,
  };
}

/**
 * Titulo em ingles, sem cargo em portugues: e o unico jeito de exercitar os
 * casos indefinidos depois da calibracao, que trata cargo em PT-BR como sinal
 * de mercado nacional.
 */
function neutralJob(overrides: Partial<ClassifiableJob> = {}): ClassifiableJob {
  return job({ title: 'Frontend Engineer', ...overrides });
}

describe('classifyJobScope', () => {
  it('declara os tres escopos', () => {
    expect(JOB_SCOPES).toEqual(['NATIONAL', 'INTERNATIONAL', 'UNKNOWN']);
  });

  describe('internacional', () => {
    it.each([
      ['tag do Remotar', job({ tags: ['✈️ Vaga internacional', '🌍 100% Remoto'] })],
      ['titulo com LATAM', job({ title: 'Senior Engineer - Remote - Latin America' })],
      ['titulo com international', job({ title: 'International Software Engineer' })],
      ['descricao com pagamento em dolar', job({ description: 'Pagamento em dolar mensal' })],
      ['descricao com USD', job({ description: 'Salario de USD 4.000 a 7.000' })],
      ['worldwide', job({ location: 'Remote - Worldwide' })],
    ])('classifica %s como internacional', (_label, entrada) => {
      expect(classifyJobScope(entrada)).toBe('INTERNATIONAL');
    });

    it('vence a mencao generica ao Brasil', () => {
      const entrada = job({
        location: 'Remoto, Brasil',
        description: 'Aberta para todo o Brasil com pagamento em dolar',
      });

      expect(classifyJobScope(entrada)).toBe('INTERNATIONAL');
    });
  });

  describe('nacional', () => {
    it.each([
      ['tag CLT do Remotar', job({ tags: ['💼 CLT', '🌍 100% Remoto'] })],
      ['carteira assinada', job({ description: 'Contratacao em carteira assinada' })],
      ['cidade com estado', job({ location: 'Salvador, BA' })],
      ['Rio de Janeiro', job({ location: 'Rio de Janeiro, RJ' })],
      ['Brasil na localidade', job({ location: 'Brasil' })],
      ['Brazil em ingles', job({ location: 'Sao Paulo, Brazil' })],
    ])('classifica %s como nacional', (_label, entrada) => {
      expect(classifyJobScope(entrada)).toBe('NATIONAL');
    });

    it('CLT vence ate o pagamento em dolar', () => {
      const entrada = job({
        tags: ['💼 CLT'],
        description: 'Bonus anual em dolar',
      });

      // So uma empresa brasileira contrata em CLT.
      expect(classifyJobScope(entrada)).toBe('NATIONAL');
    });
  });

  describe('indefinido', () => {
    it.each([
      ['sem nenhum sinal', neutralJob()],
      ['so remoto, sem pais', neutralJob({ location: 'Remoto', tags: ['🌍 100% Remoto'] })],
    ])('deixa %s como desconhecido', (_label, entrada) => {
      expect(classifyJobScope(entrada)).toBe('UNKNOWN');
    });
  });

  describe('calibracao: sinais brasileiros', () => {
    it.each([
      ['Brasil no titulo', 'Senior GenAI Full-Stack Engineer - Brasil'],
      ['Brazil no titulo', 'Senior GenAI Full-Stack Engineer - Brazil'],
      ['[BR] no titulo', '[BR] Senior Full-Stack Engineer'],
    ])('reconhece %s', (_caso, title) => {
      expect(classifyJobScope(neutralJob({ title }))).toBe('NATIONAL');
    });

    it.each([
      'Desenvolvedor Full Stack Senior',
      'Desenvolvedora Frontend',
      'Pessoa Desenvolvedora Fullstack Senior',
      'Engenheiro de Software Senior',
      'Engenheira de Software',
      'Analista de Sistemas',
      'Estagiario em Desenvolvimento',
      'Programador Backend',
    ])('trata cargo em portugues como nacional: "%s"', (title) => {
      expect(classifyJobScope(neutralJob({ title }))).toBe('NATIONAL');
    });

    it.each(['CLT', 'PJ', 'Pessoa Juridica'])('trata o regime %s como nacional', (regime) => {
      expect(classifyJobScope(neutralJob({ tags: [regime] }))).toBe('NATIONAL');
    });

    it('cargo em portugues so vale no titulo, nao na descricao', () => {
      const entrada = neutralJob({
        description: 'Voce vai trabalhar com desenvolvedores do mundo todo',
      });

      expect(classifyJobScope(entrada)).toBe('UNKNOWN');
    });
  });

  describe('calibracao: excecoes que seguem fora do mercado nacional', () => {
    it.each([
      ['espanhol', neutralJob({ title: 'Desarrollador Fullstack Pleno' })],
      ['espanhol feminino', neutralJob({ title: 'Desarrolladora Frontend' })],
      ['BairesDev', neutralJob({ title: 'Full Stack Engineer (.NET)', company: 'BairesDev' })],
      ['Lemon.io', neutralJob({ title: 'Senior React Full-stack Developer', company: 'Lemon.io' })],
    ])('mantem %s como internacional', (_caso, entrada) => {
      expect(classifyJobScope(entrada)).toBe('INTERNATIONAL');
    });

    it('a intermediaria gringa vence ate o regime CLT no anuncio', () => {
      const entrada = neutralJob({ company: 'BairesDev', tags: ['CLT'] });

      expect(classifyJobScope(entrada)).toBe('INTERNATIONAL');
    });

    it('cargo em portugues nao salva vaga marcada como internacional', () => {
      const entrada = neutralJob({
        title: 'Desenvolvedor Full Stack',
        description: 'Vaga internacional, pagamento em dolar',
      });

      expect(classifyJobScope(entrada)).toBe('INTERNATIONAL');
    });

    it('CLT continua vencendo o pagamento em dolar de empresa brasileira', () => {
      const entrada = neutralJob({ description: 'Regime CLT com bonus em dolar' });

      expect(classifyJobScope(entrada)).toBe('NATIONAL');
    });
  });

  describe('falsos positivos', () => {
    it('nao confunde sigla de estado solta na descricao', () => {
      const entrada = neutralJob({ description: 'Team of BA (Business Analytics)' });

      // Siglas de estado so contam na localidade.
      expect(classifyJobScope(entrada)).toBe('UNKNOWN');
    });

    it('nao casa "internacional" dentro de outra palavra', () => {
      const entrada = neutralJob({ description: 'Internal process of internalization' });

      expect(classifyJobScope(entrada)).toBe('UNKNOWN');
    });

    it('nao casa "usd" dentro de outra palavra', () => {
      const entrada = neutralJob({ description: 'Tool called usdx used by the team' });

      expect(classifyJobScope(entrada)).toBe('UNKNOWN');
    });
  });
});

describe('isJobScope', () => {
  it.each([...JOB_SCOPES])('reconhece %s', (scope) => {
    expect(isJobScope(scope)).toBe(true);
  });

  it.each(['nacional', 'ABROAD', ''])('rejeita %s', (value) => {
    expect(isJobScope(value)).toBe(false);
  });
});

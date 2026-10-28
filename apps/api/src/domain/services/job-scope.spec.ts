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
    description: '',
    location: '',
    tags: [],
    ...overrides,
  };
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
      ['sem nenhum sinal', job()],
      ['so remoto, sem pais', job({ location: 'Remoto', tags: ['🌍 100% Remoto'] })],
    ])('deixa %s como desconhecido', (_label, entrada) => {
      expect(classifyJobScope(entrada)).toBe('UNKNOWN');
    });
  });

  describe('falsos positivos', () => {
    it('nao confunde sigla de estado solta na descricao', () => {
      const entrada = job({ description: 'Pessoa dev para o time de BA (Business Analytics)' });

      // Siglas de estado so contam na localidade.
      expect(classifyJobScope(entrada)).toBe('UNKNOWN');
    });

    it('nao casa "internacional" dentro de outra palavra', () => {
      const entrada = job({ description: 'Processo interno de internalizacao' });

      expect(classifyJobScope(entrada)).toBe('UNKNOWN');
    });

    it('nao casa "usd" dentro de outra palavra', () => {
      const entrada = job({ description: 'Ferramenta chamada usdx usada no time' });

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

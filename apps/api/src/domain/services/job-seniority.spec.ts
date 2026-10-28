import { describe, expect, it } from 'vitest';

import {
  JOB_SENIORITY_LEVELS,
  expandSeniorities,
  isJobSeniorityLevel,
  seniorityKeywords,
  seniorityLabel,
} from '@/domain/services/job-seniority';

describe('job-seniority', () => {
  it('declara os quatro niveis, do estagio ao senior', () => {
    expect(JOB_SENIORITY_LEVELS).toEqual(['INTERN', 'JUNIOR', 'MID', 'SENIOR']);
  });

  it.each([
    ['INTERN', 'Estagio'],
    ['JUNIOR', 'Junior'],
    ['MID', 'Pleno'],
    ['SENIOR', 'Senior'],
  ] as const)('rotula %s como %s', (level, expected) => {
    expect(seniorityLabel(level)).toBe(expected);
  });

  it('inclui a variante com acento, porque a busca do banco nao ignora acento', () => {
    expect(seniorityKeywords('SENIOR')).toContain('senior');
    expect(seniorityKeywords('SENIOR')).toContain('sênior');
    expect(seniorityKeywords('JUNIOR')).toContain('junior');
    expect(seniorityKeywords('JUNIOR')).toContain('júnior');
    expect(seniorityKeywords('INTERN')).toContain('estagi');
    expect(seniorityKeywords('INTERN')).toContain('estági');
  });

  describe('termos que geravam falso positivo', () => {
    it('nao usa "intern" solto, que casava com "Vaga internacional"', () => {
      expect(seniorityKeywords('INTERN')).not.toContain('intern');
      expect(seniorityKeywords('INTERN')).toContain('internship');
    });

    it.each([
      ['Vaga internacional', 'INTERN'],
      ['processo interno', 'INTERN'],
      ['Platform Engineer', 'MID'],
      ['Site Reliability', 'SENIOR'],
    ] as const)('"%s" nao casa com %s', (texto, level) => {
      const alvo = texto.toLowerCase();

      expect(seniorityKeywords(level).some((keyword) => alvo.includes(keyword))).toBe(false);
    });

    it.each([
      ['Desenvolvedor Front End SR', 'SENIOR'],
      ['Desenvolvedor .NET Sênior', 'SENIOR'],
      ['Senior Software Engineer', 'SENIOR'],
      ['Especialista Desenvolvedor Fullstack', 'SENIOR'],
      ['Desenvolvedor Front-end Junior', 'JUNIOR'],
      ['Dev Angular Jr', 'JUNIOR'],
      ['Desenvolvedor(a) Front-End Pleno', 'MID'],
      ['Estagio em Desenvolvimento', 'INTERN'],
      ['Estágio em Front-end', 'INTERN'],
    ] as const)('"%s" casa com %s', (titulo, level) => {
      const alvo = titulo.toLowerCase();

      expect(seniorityKeywords(level).some((keyword) => alvo.includes(keyword))).toBe(true);
    });
  });

  it.each([...JOB_SENIORITY_LEVELS])('reconhece o nivel %s', (level) => {
    expect(isJobSeniorityLevel(level)).toBe(true);
  });

  it.each([
    ['nivel inventado', 'ARQUITETO'],
    ['texto vazio', ''],
    ['caixa errada', 'senior'],
  ])('rejeita %s', (_label, value) => {
    expect(isJobSeniorityLevel(value)).toBe(false);
  });

  describe('expandSeniorities', () => {
    it('expande um nivel nos seus termos de busca', () => {
      expect(expandSeniorities(['MID'])).toEqual([...seniorityKeywords('MID')]);
    });

    it('junta os termos de varios niveis', () => {
      const keywords = expandSeniorities(['JUNIOR', 'SENIOR']);

      expect(keywords).toContain('junior');
      expect(keywords).toContain('sênior');
    });

    it('nao repete termos compartilhados entre niveis', () => {
      expect(new Set(expandSeniorities([...JOB_SENIORITY_LEVELS])).size).toBe(
        expandSeniorities([...JOB_SENIORITY_LEVELS]).length,
      );
    });

    it('ignora niveis desconhecidos', () => {
      expect(expandSeniorities(['ARQUITETO', 'MID'])).toEqual([...seniorityKeywords('MID')]);
    });

    it('devolve lista vazia quando nada e escolhido', () => {
      expect(expandSeniorities([])).toEqual([]);
    });
  });
});

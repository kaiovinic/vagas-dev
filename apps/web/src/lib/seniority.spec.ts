import { describe, expect, it } from 'vitest';

import {
  SENIORITY_LEVEL_IDS,
  daysInMonth,
  monthLabel,
  seniorityColor,
  seniorityLabel,
  yearOptions,
} from '@/lib/seniority';

describe('seniority', () => {
  describe('seniorityLabel', () => {
    it.each([
      ['INTERN', 'Estágio'],
      ['JUNIOR', 'Júnior'],
      ['MID', 'Pleno'],
      ['SENIOR', 'Sênior'],
      ['LEAD', 'Lead/Especialista'],
      ['UNSPECIFIED', 'Não especificado'],
    ])('acentua %s como %s', (id, expected) => {
      expect(seniorityLabel(id, 'ignorado')).toBe(expected);
    });

    /** Nivel novo na API aparece com o rotulo dela, em vez de sumir da tela. */
    it('usa o rotulo da api para nivel que a interface nao conhece', () => {
      expect(seniorityLabel('ARQUITETO', 'Arquiteto')).toBe('Arquiteto');
    });
  });

  describe('seniorityColor', () => {
    it('da uma cor a cada um dos seis niveis', () => {
      const colors = SENIORITY_LEVEL_IDS.map((id) => seniorityColor(id));

      expect(new Set(colors).size).toBe(SENIORITY_LEVEL_IDS.length);
    });

    it('aponta o Pleno para o acento do painel, como a volumetria', () => {
      expect(seniorityColor('MID')).toBe('var(--color-seniority-mid)');
    });

    /** Barra transparente seria pior que barra cinza. */
    it('cai no neutro para nivel sem cor propria', () => {
      expect(seniorityColor('ARQUITETO')).toBe('var(--color-seniority-unspecified)');
    });
  });

  describe('monthLabel', () => {
    it.each([
      [1, 'Janeiro'],
      [3, 'Março'],
      [12, 'Dezembro'],
    ])('nomeia o mes %s como %s', (month, expected) => {
      expect(monthLabel(month)).toBe(expected);
    });

    it('devolve o numero quando o mes esta fora da faixa', () => {
      expect(monthLabel(13)).toBe('13');
    });
  });

  describe('daysInMonth', () => {
    it.each([
      [2026, 2, 28],
      [2024, 2, 29],
      [2026, 4, 30],
      [2026, 12, 31],
    ])('%s/%s tem %s dias', (year, month, expected) => {
      expect(daysInMonth(year, month)).toBe(expected);
    });
  });

  describe('yearOptions', () => {
    it('lista os cinco ultimos anos, do mais recente para o mais antigo', () => {
      expect(yearOptions(2026)).toEqual([2026, 2025, 2024, 2023, 2022]);
    });

    it('aceita outro tamanho de lista', () => {
      expect(yearOptions(2026, 2)).toEqual([2026, 2025]);
    });
  });
});

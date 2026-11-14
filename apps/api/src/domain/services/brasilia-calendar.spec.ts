import { describe, expect, it } from 'vitest';

import {
  BRASILIA_TIME_ZONE,
  brasiliaCalendarRange,
  currentBrasiliaYear,
  daysInMonth,
} from '@/domain/services/brasilia-calendar';

describe('brasilia-calendar', () => {
  it('declara o mesmo fuso usado no resto do radar', () => {
    expect(BRASILIA_TIME_ZONE).toBe('America/Bahia');
  });

  describe('brasiliaCalendarRange', () => {
    it('abre o ano as 03:00 UTC, que e a meia-noite de Brasilia', () => {
      const range = brasiliaCalendarRange({ year: 2026, month: null, day: null });

      expect(range.start.toISOString()).toBe('2026-01-01T03:00:00.000Z');
      expect(range.end.toISOString()).toBe('2027-01-01T03:00:00.000Z');
    });

    it('recorta o mes escolhido ate a virada do mes seguinte', () => {
      const range = brasiliaCalendarRange({ year: 2026, month: 3, day: null });

      expect(range.start.toISOString()).toBe('2026-03-01T03:00:00.000Z');
      expect(range.end.toISOString()).toBe('2026-04-01T03:00:00.000Z');
    });

    it('vira o ano quando o mes escolhido e dezembro', () => {
      const range = brasiliaCalendarRange({ year: 2026, month: 12, day: null });

      expect(range.end.toISOString()).toBe('2027-01-01T03:00:00.000Z');
    });

    it('recorta exatamente 24 horas quando o dia e escolhido', () => {
      const range = brasiliaCalendarRange({ year: 2026, month: 10, day: 26 });

      expect(range.start.toISOString()).toBe('2026-10-26T03:00:00.000Z');
      expect(range.end.toISOString()).toBe('2026-10-27T03:00:00.000Z');
    });

    it('vira o mes quando o dia escolhido e o ultimo', () => {
      const range = brasiliaCalendarRange({ year: 2026, month: 1, day: 31 });

      expect(range.end.toISOString()).toBe('2026-02-01T03:00:00.000Z');
    });

    /**
     * O intervalo e fechado-aberto: a vaga capturada a meia-noite em ponto
     * pertence ao dia que comeca, e a nenhum outro.
     */
    it('nao deixa buraco nem sobreposicao entre dois dias seguidos', () => {
      const primeiro = brasiliaCalendarRange({ year: 2026, month: 10, day: 26 });
      const segundo = brasiliaCalendarRange({ year: 2026, month: 10, day: 27 });

      expect(primeiro.end.getTime()).toBe(segundo.start.getTime());
    });
  });

  describe('currentBrasiliaYear', () => {
    it('le o ano no fuso de Brasilia, nao em UTC', () => {
      // 01/01/2027 as 01:00 UTC ainda e 31/12/2026 em Brasilia.
      expect(currentBrasiliaYear(new Date('2027-01-01T01:00:00.000Z'))).toBe(2026);
    });

    it('devolve o ano corrente depois da virada', () => {
      expect(currentBrasiliaYear(new Date('2027-01-01T03:00:00.000Z'))).toBe(2027);
    });
  });

  describe('daysInMonth', () => {
    it.each([
      [2026, 1, 31],
      [2026, 2, 28],
      [2024, 2, 29],
      [2026, 4, 30],
    ])('%s/%s tem %s dias', (year, month, expected) => {
      expect(daysInMonth(year, month)).toBe(expected);
    });
  });
});

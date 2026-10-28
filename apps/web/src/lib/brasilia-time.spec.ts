import { describe, expect, it } from 'vitest';

import {
  BRASILIA_LABEL,
  formatClock,
  formatDateTime,
  formatDayLabel,
  formatElapsed,
  formatRemaining,
  parseApiDate,
} from '@/lib/brasilia-time';

const NOON_UTC = new Date('2026-10-26T12:00:00.000Z');

describe('brasilia-time', () => {
  it('rotula o fuso no subtitulo', () => {
    expect(BRASILIA_LABEL).toContain('Brasilia');
    expect(BRASILIA_LABEL).toContain('UTC-3');
  });

  describe('formatClock', () => {
    it('converte UTC para o horario de Brasilia', () => {
      // 12:00Z = 09:00 em Brasilia (UTC-3).
      expect(formatClock(NOON_UTC)).toBe('09:00');
    });

    it('atravessa a virada do dia corretamente', () => {
      expect(formatClock(new Date('2026-10-27T01:30:00.000Z'))).toBe('22:30');
    });
  });

  describe('formatDateTime', () => {
    it('inclui dia, mes e hora de Brasilia', () => {
      const formatted = formatDateTime(new Date('2026-10-27T01:30:00.000Z'));

      expect(formatted).toContain('26/10');
      expect(formatted).toContain('22:30');
    });
  });

  describe('formatDayLabel', () => {
    it('converte YYYY-MM-DD em dd/MM sem reinterpretar o fuso', () => {
      expect(formatDayLabel('2026-10-25')).toBe('25/10');
      expect(formatDayLabel('2026-01-01')).toBe('01/01');
    });

    it('devolve o texto original quando o formato nao e reconhecido', () => {
      expect(formatDayLabel('ontem')).toBe('ontem');
    });
  });

  describe('formatElapsed', () => {
    it.each([
      ['menos de um minuto', 30_000, 'ha menos de 1 min'],
      ['minutos', 7 * 60_000, 'ha 7 min'],
      ['horas', 3 * 3_600_000, 'ha 3 h'],
      ['dias', 2 * 86_400_000, 'ha 2 d'],
    ])('formata %s', (_label, elapsedMs, expected) => {
      const from = new Date(NOON_UTC.getTime() - elapsedMs);

      expect(formatElapsed(from, NOON_UTC)).toBe(expected);
    });

    it('trata data no futuro como agora', () => {
      const from = new Date(NOON_UTC.getTime() + 60_000);

      expect(formatElapsed(from, NOON_UTC)).toBe('agora');
    });
  });

  describe('formatRemaining', () => {
    it.each([
      ['minutos', 113 * 60_000, 'em 113 min'],
      ['horas', 2 * 3_600_000, 'em 2 h'],
      ['dias', 3 * 86_400_000, 'em 3 d'],
    ])('formata %s restantes', (_label, remainingMs, expected) => {
      const until = new Date(NOON_UTC.getTime() + remainingMs);

      expect(formatRemaining(until, NOON_UTC)).toBe(expected);
    });

    it('avisa quando a captura ja deveria ter acontecido', () => {
      expect(formatRemaining(new Date(NOON_UTC.getTime() - 1), NOON_UTC)).toBe(
        'a qualquer momento',
      );
    });

    it('arredonda para baixo abaixo de um minuto', () => {
      expect(formatRemaining(new Date(NOON_UTC.getTime() + 30_000), NOON_UTC)).toBe(
        'em menos de 1 min',
      );
    });
  });

  describe('parseApiDate', () => {
    it('converte a data ISO da API', () => {
      expect(parseApiDate('2026-10-26T12:00:00.000Z')).toEqual(NOON_UTC);
    });

    it.each([
      ['nulo', null],
      ['invalida', 'ontem'],
    ])('devolve null para data %s', (_label, value) => {
      expect(parseApiDate(value)).toBeNull();
    });
  });
});

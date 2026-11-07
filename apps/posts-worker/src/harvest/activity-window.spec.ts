import { describe, expect, it } from 'vitest';

import {
  isWithinWindow,
  nextWindowStart,
  type ActivityWindow,
} from '@/harvest/activity-window';

/** A Bahia e UTC-3 fixo: 11:00Z = 08:00 local, 01:00Z = 22:00 do dia anterior. */
const BAHIA: ActivityWindow = { startHour: 8, endHour: 22, timeZone: 'America/Bahia' };

describe('isWithinWindow', () => {
  it.each([
    ['08:00 local, a abertura', '2026-11-07T11:00:00.000Z', true],
    ['meio da tarde', '2026-11-07T18:30:00.000Z', true],
    ['21:59 local, o ultimo minuto', '2026-11-08T00:59:00.000Z', true],
    ['22:00 local, ja fechado', '2026-11-08T01:00:00.000Z', false],
    ['03:00 local, madrugada', '2026-11-07T06:00:00.000Z', false],
    ['07:59 local, um minuto antes', '2026-11-07T10:59:00.000Z', false],
  ])('%s', (_name, iso, expected) => {
    expect(isWithinWindow(new Date(iso), BAHIA)).toBe(expected);
  });

  /**
   * O fuso nao e detalhe: o mesmo instante esta dentro da janela na Bahia e
   * fora dela em Tóquio. Um contêiner com `TZ` errado colheria de madrugada
   * acreditando estar de dia.
   */
  it('o mesmo instante muda de resposta conforme o fuso', () => {
    // 19:00 na Bahia, dentro da janela; 07:00 em Tóquio, uma hora antes dela.
    const at = new Date('2026-11-07T22:00:00.000Z');

    expect(isWithinWindow(at, BAHIA)).toBe(true);
    expect(isWithinWindow(at, { ...BAHIA, timeZone: 'Asia/Tokyo' })).toBe(false);
  });
});

describe('nextWindowStart', () => {
  it('de madrugada, abre hoje mesmo as 08:00 local', () => {
    const opensAt = nextWindowStart(new Date('2026-11-07T06:00:00.000Z'), BAHIA);

    expect(opensAt.toISOString()).toBe('2026-11-07T11:00:00.000Z');
  });

  it('de noite, abre amanha as 08:00 local', () => {
    const opensAt = nextWindowStart(new Date('2026-11-08T01:30:00.000Z'), BAHIA);

    expect(opensAt.toISOString()).toBe('2026-11-08T11:00:00.000Z');
  });

  it('de tarde, a proxima abertura tambem e amanha', () => {
    const opensAt = nextWindowStart(new Date('2026-11-07T18:00:00.000Z'), BAHIA);

    expect(opensAt.toISOString()).toBe('2026-11-08T11:00:00.000Z');
  });

  /** Virada de mes e de ano saem do `Date.UTC`, e nao de aritmetica a mao. */
  it('atravessa a virada de mes', () => {
    const opensAt = nextWindowStart(new Date('2026-12-01T01:00:00.000Z'), BAHIA);

    expect(opensAt.toISOString()).toBe('2026-12-01T11:00:00.000Z');
  });

  it('atravessa a virada de ano', () => {
    const opensAt = nextWindowStart(new Date('2027-01-01T02:00:00.000Z'), BAHIA);

    expect(opensAt.toISOString()).toBe('2027-01-01T11:00:00.000Z');
  });

  it('respeita o horario de abertura configurado', () => {
    const opensAt = nextWindowStart(new Date('2026-11-07T06:00:00.000Z'), {
      ...BAHIA,
      startHour: 10,
    });

    expect(opensAt.toISOString()).toBe('2026-11-07T13:00:00.000Z');
  });

  /** Segundos no instante de entrada nao podem vazar para o horario calculado. */
  it('devolve a hora cheia, mesmo recebendo segundos', () => {
    const opensAt = nextWindowStart(new Date('2026-11-07T06:12:37.418Z'), BAHIA);

    expect(opensAt.toISOString()).toBe('2026-11-07T11:00:00.000Z');
  });

  /**
   * Fuso com horario de verao: a segunda passada do calculo existe para este
   * caso. Em Sao Paulo o DST acabou em 2019, entao uso um fuso que ainda o tem.
   */
  it('acerta a abertura em fuso com horario de verao', () => {
    const window = { startHour: 8, endHour: 22, timeZone: 'Europe/Lisbon' };
    const opensAt = nextWindowStart(new Date('2026-07-10T03:00:00.000Z'), window);

    // Lisboa em julho esta em UTC+1: 08:00 local = 07:00Z.
    expect(opensAt.toISOString()).toBe('2026-07-10T07:00:00.000Z');
  });
});

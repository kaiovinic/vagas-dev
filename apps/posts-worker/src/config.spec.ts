import { describe, expect, it } from 'vitest';

import { DEFAULT_JITTER_IN_MINUTES, DEFAULT_PORT, parseJitter, parsePort } from '@/config';

describe('parsePort', () => {
  it('le a porta do ambiente', () => {
    expect(parsePort('4100')).toBe(4100);
  });

  it('cai no padrao quando a variavel nao existe', () => {
    expect(parsePort(undefined)).toBe(DEFAULT_PORT);
    expect(parsePort('')).toBe(DEFAULT_PORT);
  });

  /**
   * Porta invalida cai no padrao em vez de derrubar o boot: o worker so serve
   * cache, e um servico de pe na porta errada e mais facil de descobrir do que
   * um container em loop de restart.
   */
  it.each(['abc', '0', '-1', '70000', '4100.5'])('cai no padrao com %s', (raw) => {
    expect(parsePort(raw)).toBe(DEFAULT_PORT);
  });

  it('aceita as pontas da faixa valida', () => {
    expect(parsePort('1')).toBe(1);
    expect(parsePort('65535')).toBe(65535);
  });
});

const MINUTE = 60_000;

const HOUR = 60 * MINUTE;

describe('parseJitter', () => {
  it('le os minutos do ambiente', () => {
    expect(parseJitter('30', 8 * HOUR)).toBe(30 * MINUTE);
  });

  it('cai no padrao quando a variavel nao existe ou nao serve', () => {
    expect(parseJitter(undefined, 8 * HOUR)).toBe(DEFAULT_JITTER_IN_MINUTES * MINUTE);
    expect(parseJitter('', 8 * HOUR)).toBe(DEFAULT_JITTER_IN_MINUTES * MINUTE);
    expect(parseJitter('abc', 8 * HOUR)).toBe(DEFAULT_JITTER_IN_MINUTES * MINUTE);
  });

  /**
   * Sem o teto, jitter maior que o intervalo faria o sorteio decidir a cadencia
   * em vez de so disfarca-la: o piso do agendador passaria a definir a
   * frequencia, que e o contrario do que se quer.
   */
  it('nunca passa da metade do intervalo', () => {
    expect(parseJitter('600', 2 * HOUR)).toBe(HOUR);
  });
});

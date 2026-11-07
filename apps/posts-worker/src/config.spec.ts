import { describe, expect, it } from 'vitest';

import { DEFAULT_PORT, parsePort } from '@/config';

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

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_JITTER_IN_MINUTES,
  DEFAULT_PORT,
  DEFAULT_TIME_ZONE,
  DEFAULT_WINDOW_END_HOUR,
  DEFAULT_WINDOW_START_HOUR,
  parseJitter,
  parsePort,
  parseWindow,
} from '@/config';

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

describe('parseWindow', () => {
  it('le as horas e o fuso do ambiente', () => {
    expect(parseWindow('9', '21', 'America/Sao_Paulo')).toEqual({
      startHour: 9,
      endHour: 21,
      timeZone: 'America/Sao_Paulo',
    });
  });

  it('cai no padrao quando as variaveis nao existem', () => {
    expect(parseWindow(undefined, undefined, undefined)).toEqual({
      startHour: DEFAULT_WINDOW_START_HOUR,
      endHour: DEFAULT_WINDOW_END_HOUR,
      timeZone: DEFAULT_TIME_ZONE,
    });
  });

  it.each(['abc', '', '-1', '24', '8.5'])('hora invalida (%s) cai no padrao', (raw) => {
    expect(parseWindow(raw, '22', 'America/Bahia').startHour).toBe(DEFAULT_WINDOW_START_HOUR);
  });

  it('aceita a meia-noite como abertura', () => {
    expect(parseWindow('0', '6', 'America/Bahia').startHour).toBe(0);
  });

  /**
   * Janela invertida nao e configuracao, e erro de digitacao — e interpreta-la
   * de forma criativa daria justamente a colheita de madrugada que a janela
   * existe para impedir.
   */
  it.each([
    ['abertura depois do fechamento', '22', '8'],
    ['abertura igual ao fechamento', '10', '10'],
  ])('%s cai nos dois padroes', (_name, start, end) => {
    expect(parseWindow(start, end, 'America/Bahia')).toEqual({
      startHour: DEFAULT_WINDOW_START_HOUR,
      endHour: DEFAULT_WINDOW_END_HOUR,
      timeZone: 'America/Bahia',
    });
  });

  it('fuso em branco cai no padrao, e nao em fuso vazio', () => {
    expect(parseWindow('8', '22', '   ').timeZone).toBe(DEFAULT_TIME_ZONE);
  });
});

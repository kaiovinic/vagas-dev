import { describe, expect, it } from 'vitest';

import {
  BNE_INTERVAL_IN_HOURS,
  DEFAULT_SOURCE_INTERVAL_IN_HOURS,
  SOCIAL_POSTS_INTERVAL_IN_HOURS,
  nextSourceRunAt,
  sourceIntervalInHours,
} from '@/domain/services/source-cadence';

describe('source-cadence', () => {
  it('visita os portais no ritmo da captura', () => {
    expect(sourceIntervalInHours('gupy')).toBe(DEFAULT_SOURCE_INTERVAL_IN_HOURS);
    expect(DEFAULT_SOURCE_INTERVAL_IN_HOURS).toBe(2);
  });

  it('espaca as publicacoes do LinkedIn, que custam cota de API', () => {
    expect(sourceIntervalInHours('linkedin-posts')).toBe(SOCIAL_POSTS_INTERVAL_IN_HOURS);
    expect(SOCIAL_POSTS_INTERVAL_IN_HOURS).toBe(4);
  });

  it('espaca o BNE, que pede uma requisicao de detalhe por vaga candidata', () => {
    expect(sourceIntervalInHours('bne')).toBe(BNE_INTERVAL_IN_HOURS);
    expect(BNE_INTERVAL_IN_HOURS).toBe(12);
  });

  it('anuncia a proxima colheita do BNE no mesmo ritmo que o coletor respeita', () => {
    expect(nextSourceRunAt('bne', new Date('2026-11-21T10:00:00.000Z'))).toEqual(
      new Date('2026-11-21T22:00:00.000Z'),
    );
  });

  it('cai no ritmo padrao para uma fonte desconhecida', () => {
    expect(sourceIntervalInHours('fonte-nova')).toBe(2);
  });

  it('soma o intervalo da fonte a ultima execucao', () => {
    expect(nextSourceRunAt('gupy', new Date('2026-10-30T10:00:00.000Z'))).toEqual(
      new Date('2026-10-30T12:00:00.000Z'),
    );
    expect(nextSourceRunAt('linkedin-posts', new Date('2026-10-30T10:00:00.000Z'))).toEqual(
      new Date('2026-10-30T14:00:00.000Z'),
    );
  });

  it('nao preve proxima execucao para quem nunca rodou', () => {
    expect(nextSourceRunAt('gupy', null)).toBeNull();
  });
});

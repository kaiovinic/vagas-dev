import { describe, expect, it } from 'vitest';

import {
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

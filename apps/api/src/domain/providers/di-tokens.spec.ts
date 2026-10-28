import { describe, expect, it } from 'vitest';

import { PUBLISHED_AT_SOURCES } from '@/domain/dtos/raw-job-props';
import { HTTP_CLIENT } from '@/domain/providers/http-client';
import { JOB_SCRAPERS } from '@/domain/providers/job-scraper-provider';
import { DASHBOARD_METRICS_REPOSITORY } from '@/domain/repositories/dashboard-metrics-repository';
import { JOB_WRITE_REPOSITORY } from '@/domain/repositories/job-write-repository';

const TOKENS = [
  HTTP_CLIENT,
  JOB_SCRAPERS,
  DASHBOARD_METRICS_REPOSITORY,
  JOB_WRITE_REPOSITORY,
] as const;

describe('tokens de injecao do dominio', () => {
  it('sao simbolos distintos entre si', () => {
    expect(new Set(TOKENS).size).toBe(TOKENS.length);
  });

  it('usam o registro global, para sobreviverem a recarga de modulos', () => {
    expect(JOB_SCRAPERS).toBe(Symbol.for('JOB_SCRAPERS'));
    expect(HTTP_CLIENT).toBe(Symbol.for('HTTP_CLIENT'));
    expect(DASHBOARD_METRICS_REPOSITORY).toBe(Symbol.for('DASHBOARD_METRICS_REPOSITORY'));
    expect(JOB_WRITE_REPOSITORY).toBe(Symbol.for('JOB_WRITE_REPOSITORY'));
  });
});

describe('PUBLISHED_AT_SOURCES', () => {
  it('espelha o enum PublishedAtSource do schema do Prisma', () => {
    expect(PUBLISHED_AT_SOURCES).toEqual(['SOURCE', 'CAPTURE']);
  });
});

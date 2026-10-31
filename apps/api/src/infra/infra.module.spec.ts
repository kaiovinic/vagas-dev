import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { HTTP_CLIENT, type IHttpClient } from '@/domain/providers/http-client';
import {
  JOB_SCRAPERS,
  type IJobScraperProvider,
} from '@/domain/providers/job-scraper-provider';
import { InfraModule } from '@/infra/infra.module';
import { RetryingHttpClient } from '@/infra/http/retrying-http-client';

/**
 * Fiacao do modulo, e nao comportamento: nenhum outro teste compila o
 * `InfraModule`, entao um token trocado ou uma fabrica mal escrita so
 * apareceria no boot em producao.
 *
 * `compile()` monta o grafo sem chamar `onModuleInit`, logo o Prisma nao tenta
 * falar com o banco.
 */
describe('InfraModule', () => {
  it('entrega o cliente http ja embrulhado no retry', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [InfraModule] }).compile();

    const client = moduleRef.get<IHttpClient>(HTTP_CLIENT);

    expect(client).toBeInstanceOf(RetryingHttpClient);
  });

  it('registra os coletores sob o multi-provider, cada um com fonte propria', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [InfraModule] }).compile();

    const scrapers = moduleRef.get<IJobScraperProvider[]>(JOB_SCRAPERS);
    const sources = scrapers.map((scraper) => scraper.source);

    expect(sources).toContain('inhire');
    expect(new Set(sources).size).toBe(sources.length);
  });
});

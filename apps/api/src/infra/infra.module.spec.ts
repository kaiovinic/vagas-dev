import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { HTTP_CLIENT, type IHttpClient } from '@/domain/providers/http-client';
import {
  INHIRE_TENANT_DISCOVERY_READER,
  type IInhireTenantDiscoveryReader,
} from '@/domain/providers/inhire-tenant-discovery-reader';
import {
  JOB_CLOSURE_PROVIDERS,
  type IJobClosureProvider,
} from '@/domain/providers/job-closure-provider';
import {
  JOB_SCRAPERS,
  type IJobScraperProvider,
} from '@/domain/providers/job-scraper-provider';
import { InfraModule } from '@/infra/infra.module';
import { RetryingHttpClient } from '@/infra/http/retrying-http-client';
import { InhireScraperProvider } from '@/infra/scrapers/inhire-scraper-provider';
import { PrismaInhireTenantReader } from '@/infra/prisma/prisma-inhire-tenant-reader';
import { InhireTenantDiscovery } from '@/infra/scrapers/support/inhire-tenant-discovery';

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

  it('liga a descoberta de tenants da InHire ao leitor do banco', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [InfraModule] }).compile();

    const reader = moduleRef.get<IInhireTenantDiscoveryReader>(INHIRE_TENANT_DISCOVERY_READER);

    expect(reader).toBeInstanceOf(PrismaInhireTenantReader);
    expect(moduleRef.get(InhireTenantDiscovery)).toBeInstanceOf(InhireTenantDiscovery);
  });

  it('entrega a descoberta ao coletor da InHire, e nao a instancia vazia padrao', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [InfraModule] }).compile();

    // O coletor tem um padrao sem leitor, para quem o monta na mao no teste:
    // se o parametro nao fosse injetado, a producao cairia nesse padrao e a
    // descoberta nunca consultaria o banco — sem erro nenhum no boot.
    const scraper = moduleRef.get(InhireScraperProvider);
    const { discovery } = scraper as unknown as { discovery: unknown };

    expect(discovery).toBe(moduleRef.get(InhireTenantDiscovery));
  });

  it('registra o coletor do GitHub como fonte de encerramento', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [InfraModule] }).compile();

    const providers = moduleRef.get<IJobClosureProvider[]>(JOB_CLOSURE_PROVIDERS);

    expect(providers.map((provider) => provider.source)).toEqual(['github']);
  });
});

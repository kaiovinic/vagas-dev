import { describe, expect, it, vi } from 'vitest';

import type { IInhireTenantDiscoveryReader } from '@/domain/providers/inhire-tenant-discovery-reader';
import {
  INHIRE_DISCOVERY_TEXT_LIMIT,
  InhireTenantDiscovery,
} from '@/infra/scrapers/support/inhire-tenant-discovery';

function readerOf(texts: readonly string[]): IInhireTenantDiscoveryReader {
  return { findTextsMentioningInhire: vi.fn().mockResolvedValue(texts) };
}

describe('InhireTenantDiscovery', () => {
  it('devolve os tenants citados nos textos gravados', async () => {
    const reader = readerOf([
      'https://novatech.inhire.app/vagas/1',
      'Candidate-se em https://outraempresa.inhire.app/vagas/2',
    ]);

    await expect(new InhireTenantDiscovery(reader).discover()).resolves.toEqual([
      'novatech',
      'outraempresa',
    ]);
  });

  it('pede os textos com o teto configurado', async () => {
    const reader = readerOf([]);

    await new InhireTenantDiscovery(reader).discover();

    expect(reader.findTextsMentioningInhire).toHaveBeenCalledWith(INHIRE_DISCOVERY_TEXT_LIMIT);
  });

  it('respeita um teto diferente', async () => {
    const reader = readerOf([]);

    await new InhireTenantDiscovery(reader, 10).discover();

    expect(reader.findTextsMentioningInhire).toHaveBeenCalledWith(10);
  });

  it('nao descobre nada quando os anuncios nao citam a inhire', async () => {
    const reader = readerOf(['https://portal.gupy.io/job/1']);

    await expect(new InhireTenantDiscovery(reader).discover()).resolves.toEqual([]);
  });

  it('nao derruba a coleta quando o banco falha', async () => {
    const reader: IInhireTenantDiscoveryReader = {
      findTextsMentioningInhire: vi.fn().mockRejectedValue(new Error('connection refused')),
    };

    await expect(new InhireTenantDiscovery(reader).discover()).resolves.toEqual([]);
  });

  it('reporta falha que nao e Error sem quebrar', async () => {
    const reader: IInhireTenantDiscoveryReader = {
      findTextsMentioningInhire: vi.fn().mockRejectedValue('timeout'),
    };

    await expect(new InhireTenantDiscovery(reader).discover()).resolves.toEqual([]);
  });

  it('funciona sem leitor, para quem monta o coletor sem banco', async () => {
    await expect(new InhireTenantDiscovery().discover()).resolves.toEqual([]);
  });
});

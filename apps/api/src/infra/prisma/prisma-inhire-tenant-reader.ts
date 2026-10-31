import { Injectable } from '@nestjs/common';

import type { IInhireTenantDiscoveryReader } from '@/domain/providers/inhire-tenant-discovery-reader';
import { INHIRE_DOMAIN } from '@/infra/scrapers/support/inhire-tenants';
import { PrismaService } from '@/infra/prisma/prisma.service';

/**
 * Le os anuncios gravados em busca de links da InHire.
 *
 * Duas colunas interessam: a `url`, que e onde a Remotar e as outras fontes
 * guardam o link externo de candidatura, e a `description`, onde o link
 * aparece no corpo do texto.
 *
 * Sem recorte de vaga aberta nem de janela: uma vaga encerrada em marco prova
 * que o tenant existe tao bem quanto a de hoje, e o que se procura aqui e a
 * empresa, nao a vaga.
 */
@Injectable()
export class PrismaInhireTenantReader implements IInhireTenantDiscoveryReader {
  constructor(private readonly prisma: PrismaService) {}

  async findTextsMentioningInhire(limit: number): Promise<readonly string[]> {
    const rows = await this.prisma.job.findMany({
      where: {
        OR: [
          { url: { contains: INHIRE_DOMAIN, mode: 'insensitive' } },
          { description: { contains: INHIRE_DOMAIN, mode: 'insensitive' } },
        ],
      },
      select: { url: true, description: true },
      orderBy: { publishedAt: 'desc' },
      take: limit,
    });

    return rows.flatMap((row) => [row.url, row.description]);
  }
}

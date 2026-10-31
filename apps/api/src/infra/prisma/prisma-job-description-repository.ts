import { Injectable } from '@nestjs/common';

import type { IJobDescriptionReader } from '@/domain/repositories/job-description-repository';
import { PrismaService } from '@/infra/prisma/prisma.service';

/**
 * Cache de descricao sobre a propria tabela de vagas: nao existe armazenamento
 * separado, a descricao ja capturada E o cache. Uma vaga vista num ciclo
 * anterior nunca e buscada de novo, e uma vaga nova entra com a descricao que o
 * coletor trouxe.
 */
@Injectable()
export class PrismaJobDescriptionRepository implements IJobDescriptionReader {
  constructor(private readonly prisma: PrismaService) {}

  async findDescriptionsByUrl(urls: readonly string[]): Promise<ReadonlyMap<string, string>> {
    // Sem a guarda, `in: []` viraria um SELECT que varre a tabela para nada.
    if (urls.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.job.findMany({
      // `not: ''` deixa de fora a vaga gravada antes de a captura de descricao
      // existir: ela aparece como desconhecida e e buscada uma vez.
      where: { url: { in: [...urls] }, description: { not: '' } },
      select: { url: true, description: true },
    });

    return new Map(rows.map((row) => [row.url, row.description]));
  }
}

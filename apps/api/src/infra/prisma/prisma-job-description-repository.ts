import { Injectable } from '@nestjs/common';

import type {
  FetchedDescription,
  IJobDescriptionReader,
  IJobDescriptionWriter,
  IMissingDescriptionRepository,
} from '@/domain/repositories/job-description-repository';
import { OPEN_JOBS } from '@/infra/prisma/support/open-jobs';
import { PrismaService } from '@/infra/prisma/prisma.service';

/**
 * Cache de descricao por URL.
 *
 * A leitura olha duas tabelas. `job_descriptions` guarda tudo que o coletor
 * buscou, inclusive de vaga reprovada pelas regras; `jobs` e consultada junto
 * porque ali esta a descricao das vagas gravadas antes de o cache existir — sem
 * isso, a tabela nova faria o radar rebuscar o que ja sabia.
 */
@Injectable()
export class PrismaJobDescriptionRepository
  implements IJobDescriptionReader, IJobDescriptionWriter, IMissingDescriptionRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async findDescriptionsByUrl(urls: readonly string[]): Promise<ReadonlyMap<string, string>> {
    // Sem a guarda, `in: []` viraria um SELECT que varre a tabela para nada.
    if (urls.length === 0) {
      return new Map();
    }

    const wanted = [...urls];
    const [cached, jobs] = await Promise.all([
      this.prisma.jobDescription.findMany({
        where: { url: { in: wanted }, description: { not: '' } },
        select: { url: true, description: true },
      }),
      this.prisma.job.findMany({
        // `not: ''` deixa de fora a vaga gravada sem descricao: ela aparece como
        // desconhecida e e buscada uma vez.
        where: { url: { in: wanted }, description: { not: '' } },
        select: { url: true, description: true },
      }),
    ]);

    return new Map([...jobs, ...cached].map((row) => [row.url, row.description]));
  }

  /**
   * Grava so o que tem texto: descricao vazia nao e resposta, e sinal de que o
   * detalhe falhou ou saiu do ar. Guardada, a vaga nunca seria tentada de novo.
   */
  async saveDescriptions(descriptions: readonly FetchedDescription[]): Promise<number> {
    const entries = dedupeByUrl(descriptions).filter((row) => row.description.length > 0);

    if (entries.length === 0) {
      return 0;
    }

    const fetchedAt = new Date();
    const { count } = await this.prisma.jobDescription.createMany({
      data: entries.map((entry) => ({ ...entry, fetchedAt })),
      // A descricao de um anuncio nao muda; quem ja esta no cache fica como
      // esta, e o ciclo seguinte nem chega a pedir o detalhe dela.
      skipDuplicates: true,
    });

    return count;
  }

  /**
   * So vaga ABERTA e dentro do feed: consertar a descricao de uma vaga
   * encerrada ou fora da janela nao muda nada que alguem va ler.
   */
  async findUrlsMissingDescription(
    source: string,
    publishedAfter: Date,
    limit: number,
  ): Promise<readonly string[]> {
    const rows = await this.prisma.job.findMany({
      where: { ...OPEN_JOBS, source, description: '', publishedAt: { gte: publishedAfter } },
      select: { url: true },
      orderBy: { publishedAt: 'desc' },
      take: limit,
    });

    return rows.map((row) => row.url);
  }

  async fillDescriptionByUrl(url: string, description: string): Promise<number> {
    const { count } = await this.prisma.job.updateMany({
      // `description: ''` aqui tambem: preenche o que falta, nunca sobrescreve.
      where: { url, description: '' },
      data: { description },
    });

    return count;
  }
}

function dedupeByUrl(descriptions: readonly FetchedDescription[]): FetchedDescription[] {
  return [...new Map(descriptions.map((row) => [row.url, row])).values()];
}

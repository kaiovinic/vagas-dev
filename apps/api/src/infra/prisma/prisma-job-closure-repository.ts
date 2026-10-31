import { Injectable } from '@nestjs/common';

import type { IJobClosureWriter } from '@/domain/repositories/job-closure-repository';
import { PrismaService } from '@/infra/prisma/prisma.service';

@Injectable()
export class PrismaJobClosureRepository implements IJobClosureWriter {
  constructor(private readonly prisma: PrismaService) {}

  async closeByUrl(urls: readonly string[], closedAt: Date): Promise<number> {
    if (urls.length === 0) {
      return 0;
    }

    const { count } = await this.prisma.job.updateMany({
      // `closedAt: null` no filtro faz a operacao ser idempotente: a vaga
      // encerrada num ciclo anterior nao e tocada de novo, entao a data
      // registrada e a do encerramento e a contagem devolvida e o que de fato
      // mudou agora.
      where: { url: { in: [...urls] }, closedAt: null },
      data: { closedAt },
    });

    return count;
  }
}

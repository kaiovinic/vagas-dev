import { Inject, Injectable } from '@nestjs/common';

import {
  TELEGRAM_NOTIFIER,
  type ITelegramNotifier,
  type WeeklyDigest,
} from '@/domain/providers/telegram-notifier';
import {
  WEEKLY_DIGEST_REPOSITORY,
  type IWeeklyDigestRepository,
} from '@/domain/repositories/weekly-digest-repository';
import type { BucketCount } from '@/domain/repositories/market-insights-repository';
import { technologyBuckets } from '@/application/use-cases/get-market-insights.use-case';

export const DIGEST_PERIOD_IN_DAYS = 7;
export const TOP_TECHNOLOGIES = 5;

const MILLISECONDS_IN_DAY = 24 * 60 * 60 * 1000;

/**
 * Resumo semanal no Telegram.
 *
 * Mistura duas janelas de proposito: `openJobs` conta o que esta aberto agora
 * (72h, o mesmo numero do dashboard) e `newInPeriod` conta a semana corrida.
 * Sao perguntas diferentes — "o que da para me candidatar hoje" e "quanto o
 * mercado se mexeu" — e o resumo responde as duas.
 */
@Injectable()
export class SendWeeklyDigestUseCase {
  constructor(
    @Inject(WEEKLY_DIGEST_REPOSITORY)
    private readonly digests: IWeeklyDigestRepository,
    @Inject(TELEGRAM_NOTIFIER)
    private readonly notifier: ITelegramNotifier,
  ) {}

  async execute(reference: Date = new Date()): Promise<WeeklyDigest> {
    const snapshot = await this.digests.summarize(
      reference,
      DIGEST_PERIOD_IN_DAYS,
      technologyBuckets(),
    );

    const digest: WeeklyDigest = {
      periodStart: new Date(reference.getTime() - DIGEST_PERIOD_IN_DAYS * MILLISECONDS_IN_DAY),
      periodEnd: reference,
      openJobs: snapshot.openJobs,
      newInPeriod: snapshot.newInPeriod,
      remoteJobs: snapshot.remoteJobs,
      localJobs: snapshot.localJobs,
      topTechnologies: rankTechnologies(snapshot.technologies),
    };

    await this.notifier.notifyWeeklyDigest(digest);

    return digest;
  }
}

/**
 * A ordenacao fica aqui, e nao no SQL: o repositorio conta um grupo por vez e
 * nao tem como ordenar entre eles sem um segundo passo. Tecnologia sem vaga na
 * semana sai fora — listar "C#: 0" nao informa nada.
 */
function rankTechnologies(
  counts: readonly BucketCount[],
): readonly { label: string; total: number }[] {
  return [...counts]
    .filter((bucket) => bucket.total > 0)
    .sort((left, right) => right.total - left.total)
    .slice(0, TOP_TECHNOLOGIES)
    .map((bucket) => ({ label: bucket.label, total: bucket.total }));
}

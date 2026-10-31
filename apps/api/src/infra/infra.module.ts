import { Module } from '@nestjs/common';

import { HTTP_CLIENT } from '@/domain/providers/http-client';
import {
  JOB_SCRAPERS,
  type IJobScraperProvider,
} from '@/domain/providers/job-scraper-provider';
import { TELEGRAM_NOTIFIER } from '@/domain/providers/telegram-notifier';
import { CAPTURE_LOG_REPOSITORY } from '@/domain/repositories/capture-log-repository';
import { DASHBOARD_METRICS_REPOSITORY } from '@/domain/repositories/dashboard-metrics-repository';
import { MARKET_INSIGHTS_REPOSITORY } from '@/domain/repositories/market-insights-repository';
import { WEEKLY_DIGEST_REPOSITORY } from '@/domain/repositories/weekly-digest-repository';
import {
  SOURCE_HEALTH_REPOSITORY,
  SOURCE_HEALTH_WRITER,
  SOURCE_LAST_RUN_READER,
} from '@/domain/repositories/source-health-repository';
import { JOB_QUERY_REPOSITORY } from '@/domain/repositories/job-query-repository';
import { JOB_WRITE_REPOSITORY } from '@/domain/repositories/job-write-repository';
import { AxiosHttpClient } from '@/infra/http/axios-http-client';
import { TelegramHttpNotifier } from '@/infra/notifications/telegram-http-notifier';
import { PrismaCaptureLogRepository } from '@/infra/prisma/prisma-capture-log-repository';
import { PrismaJobQueryRepository } from '@/infra/prisma/prisma-job-query-repository';
import { PrismaMarketInsightsRepository } from '@/infra/prisma/prisma-market-insights-repository';
import { PrismaJobRepository } from '@/infra/prisma/prisma-job-repository';
import { PrismaSourceHealthRepository } from '@/infra/prisma/prisma-source-health-repository';
import { PrismaWeeklyDigestRepository } from '@/infra/prisma/prisma-weekly-digest-repository';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { GithubIssuesScraperProvider } from '@/infra/scrapers/github-issues-scraper-provider';
import { GupyScraperProvider } from '@/infra/scrapers/gupy-scraper-provider';
import { LinkedinGuestScraperProvider } from '@/infra/scrapers/linkedin-guest-scraper-provider';
import { LinkedinPostsScraperProvider } from '@/infra/scrapers/linkedin-posts-scraper-provider';
import { NextCommitScraperProvider } from '@/infra/scrapers/nextcommit-scraper-provider';
import { ProgramathorScraperProvider } from '@/infra/scrapers/programathor-scraper-provider';
import { RemotarScraperProvider } from '@/infra/scrapers/remotar-scraper-provider';

/**
 * Fiacao da infraestrutura. Novos coletores entram apenas nesta lista, sob o
 * multi-provider `JOB_SCRAPERS`, sem tocar no orquestrador (OCP).
 */
const SCRAPERS = [
  GupyScraperProvider,
  GithubIssuesScraperProvider,
  LinkedinGuestScraperProvider,
  RemotarScraperProvider,
  ProgramathorScraperProvider,
  // SolidesScraperProvider e CoodeshScraperProvider: fora do registro. Medido
  // sobre o que cada uma devolve por captura:
  //
  //   Solides | 124 vagas | 7 com nossa stack (6%) | 1 nas 72h | ambos: 0
  //   Coodesh |  22 vagas | 1 com nossa stack (5%) | 14 nas 72h | ambos: 1
  //
  // A area de "tecnologia" da Solides e suporte e infraestrutura, nao
  // desenvolvimento web; o sitemap publico da Coodesh e dominado por vagas de
  // vendas do Google Cloud, e o catalogo real fica atras de api autenticada.
  // Juntas custavam 16 requisicoes por captura para render quase nada.
  //
  // Os coletores e os 39 testes seguem no repositorio; para religar, basta o
  // import e a linha de volta.
  LinkedinPostsScraperProvider,
  NextCommitScraperProvider,
  // JobbolScraperProvider: fora do registro de proposito. O site esta atras do
  // Bot Management da Cloudflare, que responde 403 (`cf-mitigated: challenge`)
  // a qualquer cliente HTTP que nao seja navegador — o bloqueio e por
  // impressao digital de TLS, nao por cabecalho, e nenhuma configuracao daqui
  // resolve. Registrado, o coletor so gastaria quatro requisicoes recusadas e
  // um WARN por captura. O parser e os 18 testes seguem no repositorio; para
  // religar, basta o import e esta linha de volta.
];

@Module({
  providers: [
    PrismaService,
    PrismaJobRepository,
    PrismaJobQueryRepository,
    PrismaCaptureLogRepository,
    PrismaMarketInsightsRepository,
    PrismaWeeklyDigestRepository,
    PrismaSourceHealthRepository,
    { provide: HTTP_CLIENT, useClass: AxiosHttpClient },
    { provide: TELEGRAM_NOTIFIER, useClass: TelegramHttpNotifier },
    ...SCRAPERS,
    {
      provide: JOB_SCRAPERS,
      useFactory: (...scrapers: IJobScraperProvider[]): IJobScraperProvider[] => scrapers,
      inject: SCRAPERS,
    },
    { provide: JOB_WRITE_REPOSITORY, useExisting: PrismaJobRepository },
    { provide: DASHBOARD_METRICS_REPOSITORY, useExisting: PrismaJobRepository },
    { provide: JOB_QUERY_REPOSITORY, useExisting: PrismaJobQueryRepository },
    { provide: CAPTURE_LOG_REPOSITORY, useExisting: PrismaCaptureLogRepository },
    { provide: MARKET_INSIGHTS_REPOSITORY, useExisting: PrismaMarketInsightsRepository },
    { provide: WEEKLY_DIGEST_REPOSITORY, useExisting: PrismaWeeklyDigestRepository },
    { provide: SOURCE_HEALTH_WRITER, useExisting: PrismaSourceHealthRepository },
    { provide: SOURCE_HEALTH_REPOSITORY, useExisting: PrismaSourceHealthRepository },
    { provide: SOURCE_LAST_RUN_READER, useExisting: PrismaSourceHealthRepository },
  ],
  exports: [
    JOB_SCRAPERS,
    JOB_WRITE_REPOSITORY,
    DASHBOARD_METRICS_REPOSITORY,
    JOB_QUERY_REPOSITORY,
    CAPTURE_LOG_REPOSITORY,
    MARKET_INSIGHTS_REPOSITORY,
    WEEKLY_DIGEST_REPOSITORY,
    SOURCE_HEALTH_WRITER,
    SOURCE_HEALTH_REPOSITORY,
    SOURCE_LAST_RUN_READER,
    TELEGRAM_NOTIFIER,
    PrismaService,
  ],
})
export class InfraModule {}

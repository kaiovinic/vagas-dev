import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  TELEGRAM_NOTIFIER,
  type ITelegramNotifier,
} from '@/domain/providers/telegram-notifier';
import {
  PENDING_ALERT_REPOSITORY,
  type IPendingAlertRepository,
  type PendingJobAlert,
} from '@/domain/repositories/job-alert-repository';

/**
 * Teto de alertas por despacho.
 *
 * A 3 segundos por mensagem, 30 levam 90 segundos — o bastante para esvaziar
 * uma captura cheia sem monopolizar o bot por minutos a fio. O que sobrar sai
 * no despacho seguinte, dez minutos depois.
 */
export const MAX_ALERTS_PER_DISPATCH = 30;

export interface AlertDispatchReport {
  readonly totalSent: number;
  readonly totalFailed: number;
}

/**
 * Despacha os alertas das vagas que ainda nao avisaram.
 *
 * Esta separado da captura de proposito. A fila de envio e lenta por desenho
 * (o Telegram limita o ritmo em grupo) e nao pode mais segurar o ciclo nem
 * deixar o `capture_logs` em RUNNING. E, por ler do banco, este caso de uso e
 * retomavel: o que nao saiu — porque o envio falhou ou porque o conteiner foi
 * reiniciado no meio — continua pendente e sai no proximo despacho.
 *
 * A marcacao acontece DEPOIS do envio dar certo. Na duvida entre perder um
 * alerta e repetir um, repetir e o erro barato.
 */
@Injectable()
export class DispatchPendingAlertsUseCase {
  private readonly logger = new Logger(DispatchPendingAlertsUseCase.name);

  /** Um despacho por vez: o cron e o fim da captura chamam o mesmo caso de uso. */
  private running: Promise<AlertDispatchReport> | null = null;

  constructor(
    @Inject(PENDING_ALERT_REPOSITORY) private readonly pending: IPendingAlertRepository,
    @Inject(TELEGRAM_NOTIFIER) private readonly notifier: ITelegramNotifier,
  ) {}

  async execute(
    reference: Date = new Date(),
    limit: number = MAX_ALERTS_PER_DISPATCH,
  ): Promise<AlertDispatchReport> {
    const inFlight = this.running;

    if (inFlight !== null) {
      this.logger.debug('Despacho ja em andamento: aguardando o que esta rodando');

      return inFlight;
    }

    const started = this.dispatch(reference, limit).finally(() => {
      this.running = null;
    });

    this.running = started;

    return started;
  }

  private async dispatch(reference: Date, limit: number): Promise<AlertDispatchReport> {
    const alerts = await this.pending.findPendingAlerts(reference, limit);

    if (alerts.length === 0) {
      return { totalSent: 0, totalFailed: 0 };
    }

    let totalSent = 0;
    let totalFailed = 0;

    // Serial, e nao `Promise.all`: o ritmo e o que mantem o bot fora do 429, e
    // uma falha no meio nao pode impedir as proximas de sair.
    for (const pending of alerts) {
      const sent = await this.send(pending);

      if (sent) {
        totalSent += 1;

        continue;
      }

      totalFailed += 1;
    }

    this.report(totalSent, totalFailed);

    return { totalSent, totalFailed };
  }

  private async send(pending: PendingJobAlert): Promise<boolean> {
    try {
      await this.notifier.notifyNewJob(pending.alert);
      await this.pending.markNotified(pending.jobId, new Date());

      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      // Sem marcar: a vaga continua pendente e volta no proximo despacho.
      this.logger.warn(`Alerta de "${pending.alert.job.title}" falhou: ${message}`);

      return false;
    }
  }

  /** Falha de alerta precisa aparecer: antes, ela morria num warn por mensagem. */
  private report(totalSent: number, totalFailed: number): void {
    if (totalFailed > 0) {
      this.logger.error(
        `${totalSent} alerta(s) enviados e ${totalFailed} pendente(s) apos falha de envio`,
      );

      return;
    }

    this.logger.log(`${totalSent} alerta(s) enviados no Telegram`);
  }
}

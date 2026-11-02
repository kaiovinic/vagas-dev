import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { DispatchPendingAlertsUseCase } from '@/application/use-cases/dispatch-pending-alerts.use-case';
import { BRASILIA_TIME_ZONE } from '@/application/schedulers/job-cron.scheduler';

export const ALERT_DISPATCH_CRON = CronExpression.EVERY_10_MINUTES;
export const ALERT_DISPATCH_JOB_NAME = 'alert-dispatch';

/**
 * Rede de seguranca do despacho.
 *
 * A captura ja manda despachar ao terminar; este cron existe para o que ficou
 * para tras: mensagem que o Telegram recusou, lote maior que o teto de um
 * despacho, reinicio do conteiner no meio da fila. Dez minutos e curto o
 * bastante para o alerta nao envelhecer e longo o bastante para nao insistir em
 * cima de um 429.
 */
@Injectable()
export class AlertDispatchScheduler {
  private readonly logger = new Logger(AlertDispatchScheduler.name);

  constructor(private readonly alerts: DispatchPendingAlertsUseCase) {}

  @Cron(ALERT_DISPATCH_CRON, {
    name: ALERT_DISPATCH_JOB_NAME,
    timeZone: BRASILIA_TIME_ZONE,
  })
  async handleScheduledDispatch(): Promise<void> {
    await this.run();
  }

  /** Falha aqui nao pode derrubar o agendador: o proximo ciclo tenta de novo. */
  async run(): Promise<void> {
    try {
      await this.alerts.execute();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(`Despacho de alertas falhou: ${message}`);
    }
  }
}

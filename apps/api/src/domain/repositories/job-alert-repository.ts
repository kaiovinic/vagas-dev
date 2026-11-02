import type { JobAlert } from '@/domain/providers/telegram-notifier';

export const PENDING_ALERT_REPOSITORY = Symbol.for('PENDING_ALERT_REPOSITORY');

/** A vaga pendente com o `id` da linha, que e por onde o despacho a marca. */
export interface PendingJobAlert {
  readonly jobId: string;
  readonly alert: JobAlert;
}

/**
 * Fila de alertas pendentes (ISP): so o que o despachante precisa — ler as
 * vagas que ainda nao avisaram e marcar a que avisou.
 *
 * Nao se confunde com `IJobWriteRepository`: aquele e da captura, que grava a
 * vaga; este e do despacho, que acontece depois e pode acontecer de novo.
 */
export interface IPendingAlertRepository {
  /**
   * Vagas abertas dentro da janela de publicacao, ainda sem alerta, da mais
   * antiga para a mais nova — a ordem em que o leitor espera recebe-las.
   */
  findPendingAlerts(reference: Date, limit: number): Promise<PendingJobAlert[]>;
  /** Marca a vaga como avisada. Chamado apos o envio dar certo, nunca antes. */
  markNotified(jobId: string, notifiedAt: Date): Promise<void>;
}

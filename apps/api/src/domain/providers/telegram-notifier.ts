import type { Job } from '@/domain/entities/job';
import type { JobScope } from '@/domain/services/job-scope';

export const TELEGRAM_NOTIFIER = Symbol.for('TELEGRAM_NOTIFIER');

/**
 * O que o alerta precisa mostrar. A entidade `Job` nao carrega tags nem mercado
 * — sao metadados da captura —, por isso o alerta e um DTO proprio.
 */
export interface JobAlert {
  readonly job: Job;
  readonly tags: readonly string[];
  readonly scope: JobScope;
}

/**
 * Porta de notificacao. Implementacoes nunca propagam excecao: uma falha no
 * Telegram nao pode derrubar a captura nem impedir a persistencia da vaga.
 *
 * Cabe a implementacao respeitar o limite de envio da plataforma; quem chama
 * pode disparar os alertas de uma vez.
 */
export interface ITelegramNotifier {
  notifyNewJob(alert: JobAlert): Promise<void>;
}

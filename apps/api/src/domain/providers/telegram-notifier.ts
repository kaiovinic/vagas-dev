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

export interface DigestTechnology {
  readonly label: string;
  readonly total: number;
}

/** Numeros consolidados do resumo semanal, prontos para virar mensagem. */
export interface WeeklyDigest {
  readonly periodStart: Date;
  readonly periodEnd: Date;
  /** Vagas abertas agora (janela de 72h). */
  readonly openJobs: number;
  /** Vagas publicadas no periodo do resumo. */
  readonly newInPeriod: number;
  readonly remoteJobs: number;
  readonly localJobs: number;
  readonly topTechnologies: readonly DigestTechnology[];
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
  /** Resumo da semana, disparado pelo cron de segunda-feira. */
  notifyWeeklyDigest(digest: WeeklyDigest): Promise<void>;
}

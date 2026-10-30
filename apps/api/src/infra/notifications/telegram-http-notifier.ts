import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';

import { HTTP_CLIENT, type IHttpClient } from '@/domain/providers/http-client';
import type {
  ITelegramNotifier,
  JobAlert,
  WeeklyDigest,
} from '@/domain/providers/telegram-notifier';
import type { JobScope } from '@/domain/services/job-scope';
import type { JobWorkModel } from '@/domain/entities/job';

const TELEGRAM_API_URL = 'https://api.telegram.org';
const MAX_TAGS = 5;
const MAX_TITLE_LENGTH = 120;

/**
 * A Bot API aceita cerca de 1 mensagem por segundo no mesmo chat (e ~20/minuto
 * em grupo). Uma captura com 18 vagas novas dispararia 18 envios de uma vez e
 * levaria 429 — por isso os envios sao enfileirados com este intervalo.
 */
export const TELEGRAM_MIN_INTERVAL_MS = 1_100;

export interface TelegramConfig {
  readonly botToken: string;
  readonly chatId: string;
}

/**
 * Alerta em tempo real no Telegram.
 *
 * Usa `sendMessage` via GET com query string — a Bot API aceita os dois verbos — para
 * nao ampliar a porta `IHttpClient` so por causa deste adaptador.
 *
 * Sem token ou chat configurados, vira no-op: um ambiente de desenvolvimento sem
 * bot nao deve quebrar a captura.
 */
@Injectable()
export class TelegramHttpNotifier implements ITelegramNotifier, OnModuleInit {
  private readonly logger = new Logger(TelegramHttpNotifier.name);

  /** Fila serial: cada envio espera o anterior mais o intervalo minimo. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    @Inject(HTTP_CLIENT) private readonly http: IHttpClient,
    @Optional() private readonly config: TelegramConfig = readConfigFromEnv(),
    @Optional() private readonly minIntervalMs: number = TELEGRAM_MIN_INTERVAL_MS,
  ) {}

  /**
   * Diz no boot se os alertas estao ligados. Sem isso, um deploy sem token
   * sobe calado e so se descobre a falta quando uma vaga nova nao avisa.
   */
  onModuleInit(): void {
    if (this.isConfigured()) {
      this.logger.log(`Alertas do Telegram ativos (chat ${this.config.chatId})`);

      return;
    }

    this.logger.warn('Alertas do Telegram desativados: defina TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID');
  }

  async notifyNewJob(alert: JobAlert): Promise<void> {
    if (!this.isConfigured()) {
      this.logger.debug('Telegram nao configurado: alerta ignorado');

      return;
    }

    this.queue = this.queue.then(() =>
      this.sendThrottled(buildMessage(alert), `"${alert.job.title}"`),
    );

    return this.queue;
  }

  /**
   * Resumo da semana. Entra na mesma fila dos alertas: se o cron de segunda
   * cair junto de uma captura, os envios continuam espacados.
   */
  async notifyWeeklyDigest(digest: WeeklyDigest): Promise<void> {
    if (!this.isConfigured()) {
      this.logger.debug('Telegram nao configurado: resumo semanal ignorado');

      return;
    }

    this.queue = this.queue.then(() => this.sendThrottled(buildDigestMessage(digest), 'resumo semanal'));

    return this.queue;
  }

  /** Envia uma mensagem avulsa, usada pelo comando de teste. */
  async sendRaw(text: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error(
        'Telegram nao configurado: defina TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env',
      );
    }

    await this.http.get(this.buildUrl(text), { headers: { Accept: 'application/json' } });
  }

  /** `subject` so aparece no log de falha, para dizer o que nao foi enviado. */
  private async sendThrottled(text: string, subject: string): Promise<void> {
    try {
      await this.http.get(this.buildUrl(text), {
        headers: { Accept: 'application/json' },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Falha ao notificar ${subject} no Telegram: ${message}`);
    }

    await delay(this.minIntervalMs);
  }

  private buildUrl(text: string): string {
    const params = new URLSearchParams({
      chat_id: this.config.chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: 'false',
    });

    return `${TELEGRAM_API_URL}/bot${this.config.botToken}/sendMessage?${params.toString()}`;
  }

  private isConfigured(): boolean {
    return this.config.botToken.length > 0 && this.config.chatId.length > 0;
  }
}

const WORK_MODEL_LABELS: Readonly<Record<JobWorkModel, string>> = {
  REMOTE: 'Remoto',
  HYBRID: 'Hibrido',
  ONSITE: 'Presencial',
  UNKNOWN: 'Modalidade nao informada',
};

const SCOPE_LABELS: Readonly<Record<JobScope, string>> = {
  NATIONAL: '🇧🇷 Nacional',
  INTERNATIONAL: '🌎 Internacional',
  UNKNOWN: '',
};

export function buildMessage(alert: JobAlert): string {
  const { job } = alert;
  const lines = [
    `💼 <b>${escapeHtml(truncate(job.title, MAX_TITLE_LENGTH))}</b>`,
    `🏢 ${escapeHtml(job.company)}`,
    `📍 ${escapeHtml(describePlace(alert))}`,
    `🔎 ${escapeHtml(sourceLabel(job.source))}`,
  ];

  const tags = formatTags(alert.tags);

  if (tags.length > 0) {
    lines.push(`🏷️ ${escapeHtml(tags)}`);
  }

  lines.push('', `<a href="${escapeHtml(job.url)}">Ver vaga e se candidatar</a>`);

  return lines.join('\n');
}

const DAY_MONTH = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'America/Bahia',
});

/**
 * Resumo da semana. Numero puro nao diz nada sozinho, entao cada linha traz a
 * comparacao que da sentido a ele: o percentual de remotas sobre as abertas e
 * o periodo coberto no cabecalho.
 */
export function buildDigestMessage(digest: WeeklyDigest): string {
  const inicio = DAY_MONTH.format(digest.periodStart);
  const fim = DAY_MONTH.format(digest.periodEnd);
  const lines = [
    `📊 <b>DevRadar — resumo da semana</b>`,
    `<i>${inicio} a ${fim}</i>`,
    '',
    `💼 <b>${digest.openJobs}</b> vagas abertas no radar`,
    `🆕 <b>${digest.newInPeriod}</b> publicadas nos ultimos 7 dias`,
    `🏠 <b>${digest.remoteJobs}</b> remotas (${percentageOf(digest.remoteJobs, digest.openJobs)})`,
    `📍 <b>${digest.localJobs}</b> em Salvador e regiao`,
  ];

  if (digest.topTechnologies.length > 0) {
    lines.push('', '🏆 <b>Stacks mais pedidas</b>');

    digest.topTechnologies.forEach((technology, index) => {
      lines.push(`${MEDALS[index] ?? '▫️'} ${escapeHtml(technology.label)} — ${technology.total}`);
    });
  }

  return lines.join('\n');
}

const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

/** Percentual sobre o total de vagas abertas; sem vagas, nao ha o que comparar. */
function percentageOf(part: number, total: number): string {
  if (total <= 0) {
    return '0%';
  }

  return `${Math.round((part / total) * 100)}%`;
}

/** "Remoto · 🌎 Internacional" ou "Presencial · Salvador/BA". */
function describePlace(alert: JobAlert): string {
  const parts = [WORK_MODEL_LABELS[alert.job.workModel]];
  const place = alert.job.location.trim();

  if (place.length > 0 && place.toLowerCase() !== 'remoto') {
    parts.push(place);
  }

  const scope = SCOPE_LABELS[alert.scope];

  if (scope.length > 0) {
    parts.push(scope);
  }

  return parts.join(' · ');
}

function formatTags(tags: readonly string[]): string {
  return tags
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .slice(0, MAX_TAGS)
    .join(' · ');
}

function sourceLabel(source: string): string {
  const labels: Readonly<Record<string, string>> = {
    linkedin: 'LinkedIn',
    gupy: 'Gupy',
    github: 'GitHub',
    remotar: 'Remotar',
    programathor: 'ProgramaThor',
    jobbol: 'Jobbol',
    solides: 'Solides',
    coodesh: 'Coodesh',
    'linkedin-posts': 'Publicacao LinkedIn',
    nextcommit: 'Next Commit',
  };

  return labels[source] ?? source;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readConfigFromEnv(): TelegramConfig {
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    chatId: process.env.TELEGRAM_CHAT_ID ?? '',
  };
}

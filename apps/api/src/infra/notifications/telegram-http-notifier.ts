import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';

import { HTTP_CLIENT, type IHttpClient } from '@/domain/providers/http-client';
import type {
  IOperationalAlerter,
  OperationalAlert,
} from '@/domain/providers/operational-alerter';
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
 * O limite que vale aqui e o do GRUPO: ~20 mensagens por minuto. O intervalo
 * antigo de 1,1s dava ~54 por minuto — passava do teto na segunda dezena e o
 * resto voltava 429. Tres segundos dao 20 por minuto, com a margem do proprio
 * tempo de requisicao.
 */
export const TELEGRAM_MIN_INTERVAL_MS = 3_000;

/**
 * Teto da espera entre tentativas DESTE adaptador.
 *
 * O cliente dos coletores corta o `Retry-After` em 30s, e com razao: esperar
 * mais atrasaria as outras fontes dentro do ciclo. Aqui o calculo e o oposto —
 * quando o Telegram diz "volte em 60 segundos", obedecer e o unico jeito de a
 * mensagem sair, e o despacho nao segura mais captura nenhuma.
 */
export const TELEGRAM_MAX_RETRY_DELAY_MS = 180_000;

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
export class TelegramHttpNotifier
  implements ITelegramNotifier, IOperationalAlerter, OnModuleInit
{
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

    return this.enqueue(buildMessage(alert), `"${alert.job.title}"`);
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

    return this.enqueue(buildDigestMessage(digest), 'resumo semanal');
  }

  /**
   * Enfileira o envio e devolve SO o resultado desta mensagem.
   *
   * A fila guarda a versao que nunca rejeita; se ela carregasse a rejeicao, um
   * envio falho quebraria o encadeamento e nenhuma mensagem posterior sairia.
   * Quem chamou recebe a promessa de verdade, com o erro.
   */
  /**
   * Aviso sobre a propria coleta, no mesmo chat dos alertas de vaga.
   *
   * Entra na mesma fila: se a sessao cair no meio de uma captura que tambem
   * tem vagas novas, os envios continuam espacados e nenhum volta 429.
   *
   * Um ambiente sem bot nao fica em silencio: o log de aviso do coletor sai de
   * todo jeito, e e ele o verdadeiro ultimo recurso.
   */
  async notifyOperational(alert: OperationalAlert): Promise<void> {
    if (!this.isConfigured()) {
      this.logger.debug('Telegram nao configurado: alerta operacional ignorado');

      return;
    }

    return this.enqueue(buildOperationalMessage(alert), alert.title);
  }

  private enqueue(text: string, subject: string): Promise<void> {
    const sent = this.queue.then(() => this.sendThrottled(text, subject));

    this.queue = sent.then(
      () => undefined,
      () => undefined,
    );

    return sent;
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

  /**
   * `subject` so aparece no log de falha, para dizer o que nao foi enviado.
   *
   * A falha e registrada E propagada: quem chama precisa saber que a mensagem
   * nao saiu para deixar a vaga pendente. Antes o erro morria aqui, e a captura
   * fechava como sucesso com os alertas perdidos.
   *
   * O intervalo e respeitado nos dois caminhos: depois de um 429, emendar a
   * proxima mensagem seria pedir outro.
   */
  private async sendThrottled(text: string, subject: string): Promise<void> {
    try {
      await this.http.get(this.buildUrl(text), {
        headers: { Accept: 'application/json' },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Falha ao notificar ${subject} no Telegram: ${message}`);

      await delay(this.minIntervalMs);

      throw error;
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
    `📍 <b>${digest.localJobs}</b> na Bahia`,
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

/**
 * Mensagem de aviso operacional.
 *
 * Comeca com o alarme e termina com o comando a rodar: quem le isso no celular
 * precisa saber, em duas linhas, o que quebrou e o que fazer.
 */
function buildOperationalMessage(alert: OperationalAlert): string {
  return [
    `⚠️ <b>${escapeHtml(alert.title)}</b>`,
    '',
    escapeHtml(alert.detail),
    '',
    `<b>O que fazer:</b> ${escapeHtml(alert.action)}`,
    '',
    `<i>fonte: ${escapeHtml(alert.source)}</i>`,
  ].join('\n');
}

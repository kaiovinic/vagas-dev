import type { JobWorkModel } from '@/domain/entities/job';
import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import { normalizeForMatching } from '@/domain/value-objects/text-normalizer';

const REMOTE_HINTS = ['remoto', 'remota', 'remote', 'home office', 'anywhere'];
const HYBRID_HINTS = ['hibrido', 'hybrid', 'semi presencial', 'semipresencial'];
const ONSITE_HINTS = ['presencial', 'on site', 'onsite', 'on-site', 'presential', 'alocado'];

/**
 * Trecho que descreve a vaga, nao a empresa: jornada, faixa salarial, regime.
 *
 * Quem publica anexa isso ao titulo ("... na WeatherWise - 4 dias / 32h"), e
 * parser que corta no ultimo separador acaba gravando a jornada no campo
 * `company`. O DevRadar ja teve esse defeito no coletor do GitHub; o Next
 * Commit tem o mesmo, e entrega o valor errado no `data-job-company`.
 *
 * Importa mais do que parece: o fingerprint e `empresa + titulo`, entao uma
 * empresa errada cria vaga duplicada no painel.
 */
export function looksLikeJobMetadata(value: string): boolean {
  return METADATA_SEGMENT.test(value);
}

const METADATA_SEGMENT =
  /^\s*(?:r\$|us\$|usd|eur)|\d+\s*(?:h|hs|horas?|dias?|semanas?|meses|k|mil)\b|\b(?:clt|pj|home\s*office|remoto|hibrido|presencial|vaga|vagas)\b/i;

export function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Resolve um href relativo contra a origem da fonte e descarta a query de tracking. */
export function toAbsoluteUrl(baseUrl: string, href: string): string | undefined {
  const trimmed = href.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  try {
    const resolved = new URL(trimmed, baseUrl);

    return `${resolved.origin}${resolved.pathname}`;
  } catch {
    return undefined;
  }
}

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Brasilia e UTC-3 o ano inteiro; meio-dia daqui sao 15:00 UTC. */
const BRASILIA_NOON_IN_UTC_HOURS = 15;

/**
 * Converte a data publicada pela fonte.
 *
 * Fontes que informam so o dia (`2026-10-25`, como os cards guest do LinkedIn)
 * viram **meio-dia de Brasilia**, nao meia-noite UTC: meia-noite UTC e 21:00 do
 * dia ANTERIOR aqui, o que jogava a vaga para o dia errado no grafico diario.
 * Meio-dia cai no mesmo dia tanto em UTC quanto em Brasilia.
 *
 * Uma data so-dia de hoje pode cair no futuro (capturamos as 9h, o meio-dia ainda
 * nao chegou), e o motor de regras descarta data futura — por isso o limite em `now`.
 */
export function parseDate(value: unknown, now: Date = new Date()): Date | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const trimmed = value.trim();
  const parsed = new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  if (!DAY_ONLY.test(trimmed)) {
    return parsed;
  }

  const noon = new Date(parsed.getTime() + BRASILIA_NOON_IN_UTC_HOURS * 60 * 60 * 1000);

  return noon.getTime() > now.getTime() ? now : noon;
}

/** Deriva a modalidade a partir de qualquer texto livre da fonte. */
export function workModelFromText(value: string): JobWorkModel {
  const text = normalizeForMatching(value);

  if (REMOTE_HINTS.some((hint) => text.includes(hint))) {
    return 'REMOTE';
  }

  if (HYBRID_HINTS.some((hint) => text.includes(hint))) {
    return 'HYBRID';
  }

  if (ONSITE_HINTS.some((hint) => text.includes(hint))) {
    return 'ONSITE';
  }

  return 'UNKNOWN';
}

/** A mesma vaga pode aparecer em varias buscas da mesma fonte. */
export function dedupeByUrl(jobs: readonly RawJobProps[]): RawJobProps[] {
  const seen = new Set<string>();

  return jobs.filter((job) => {
    if (seen.has(job.url)) {
      return false;
    }

    seen.add(job.url);

    return true;
  });
}

export function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = collapseSpaces(value);

    if (normalized.length > 0) {
      seen.add(normalized);
    }
  }

  return [...seen];
}

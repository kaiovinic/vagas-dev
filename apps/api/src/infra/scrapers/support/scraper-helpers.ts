import * as cheerio from 'cheerio';

import type { JobWorkModel } from '@/domain/entities/job';
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
export function dedupeByUrl<TItem extends { readonly url: string }>(
  jobs: readonly TItem[],
): TItem[] {
  const seen = new Set<string>();

  return jobs.filter((job) => {
    if (seen.has(job.url)) {
      return false;
    }

    seen.add(job.url);

    return true;
  });
}

/**
 * Ritmo de uma fila de requisicoes: espera antes de cada uma, menos a primeira.
 *
 * O estado vive na closure, e nao no coletor, que e singleton — um ciclo nunca
 * herda a contagem do anterior. Quem cria um pacer por ciclo tem a garantia de
 * que a primeira chamada sai na hora e as seguintes respeitam o intervalo.
 */
export function createPacer(
  wait: (ms: number) => Promise<void>,
  delayInMs: number,
): () => Promise<void> {
  let first = true;

  return async () => {
    if (first) {
      first = false;

      return;
    }

    await wait(delayInMs);
  };
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

/** Tags que fecham um bloco: viram quebra de linha antes de o texto ser extraido. */
const BLOCK_TAG = /\s*<\s*(?:br|\/p|\/li|\/ul|\/ol|\/h[1-6]|\/div|\/tr)\s*\/?>/gi;
const BLANK_LINE_RUN = /\n{3,}/g;

/**
 * Texto corrido a partir do HTML que o anunciante escreveu (<p>, <strong>, <ul>).
 *
 * As tags de bloco viram quebra de linha ANTES da extracao: sem isso os itens da
 * lista sairiam grudados numa linha so, e a descricao tambem e exibida no painel.
 * O espaco em branco que vem antes da tag entra na troca, porque e indentacao do
 * HTML e nao conteudo: sem isso "item<br />\n item" sairia com uma linha vazia
 * entre os dois itens.
 * A segunda passada pelo cheerio resolve as entidades (&amp;, &nbsp;, &atilde;).
 */
export function htmlToText(html: string): string {
  const withBreaks = html.replace(BLOCK_TAG, '\n');
  const lines = cheerio
    .load(`<div>${withBreaks}</div>`)
    .root()
    .text()
    .split('\n')
    .map((line) => collapseSpaces(line));

  return lines.join('\n').replace(BLANK_LINE_RUN, '\n\n').trim();
}

/** Elementos HTML nomeados, abrindo ou fechando, com ou sem atributos. */
const KNOWN_HTML_TAG = new RegExp(
  '</?(?:p|br|hr|div|span|strong|b|em|i|u|s|ul|ol|li|dl|dt|dd|h[1-6]|a|img|figure|table|thead' +
    '|tbody|tfoot|tr|td|th|code|pre|blockquote|sub|sup|small|font|center|details|summary|section' +
    '|article|header|footer|nav|aside|main|label|button)\\b[^>]*>',
  'gi',
);

/**
 * Tira as tags HTML de um texto que NAO e HTML.
 *
 * O corpo de uma issue do GitHub e Markdown, e Markdown aceita HTML solto no
 * meio: e de la que vinham os `<p>` e `</a>` crus no painel. Passar o texto
 * pelo cheerio, como faz o `htmlToText`, resolveria as tags e levaria junto o
 * que o Markdown escreve entre sinais de menor e maior — um autolink
 * `<https://empresa.com/vaga>` e um generico `List<String>` desapareceriam,
 * porque o parser os le como tag desconhecida. Por isso aqui a remocao e por
 * nome de elemento conhecido: o que nao for tag de verdade fica no texto.
 */
export function removeHtmlTags(text: string): string {
  const lines = text
    .replace(KNOWN_HTML_TAG, (tag) => (isInlineTag(tag) ? '' : '\n'))
    .split('\n')
    .map((line) => collapseSpaces(line));

  return lines.join('\n').replace(BLANK_LINE_RUN, '\n\n').trim();
}

/** Tag que nao quebra linha: tirada sem deixar marca, para nao picar a frase. */
function isInlineTag(tag: string): boolean {
  return INLINE_TAG.test(tag);
}

const INLINE_TAG =
  /^<\/?(?:span|strong|b|em|i|u|s|a|code|sub|sup|small|font|label|button)\b[^>]*>$/i;

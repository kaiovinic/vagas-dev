import * as cheerio from 'cheerio';

import { htmlToText } from '@/infra/scrapers/support/scraper-helpers';

const JSON_LD = 'script[type="application/ld+json"]';

/**
 * Campos do `JobPosting` que o radar aproveita.
 *
 * Toda string vem normalizada e possivelmente vazia: o bloco e escrito pelo
 * site, nao validado por ninguem, e campo ausente e a regra e nao a excecao.
 */
export interface JobPostingFields {
  readonly title: string;
  readonly company: string;
  /** HTML cru, como o anunciante escreveu; quem exibe passa pelo `htmlToText`. */
  readonly description: string;
  readonly datePosted: string;
  readonly validThrough: string;
  readonly locality: string;
  readonly region: string;
}

type JsonRecord = Record<string, unknown>;

/**
 * Descricao do anuncio a partir do JSON-LD `JobPosting` da pagina.
 *
 * Serve para quem agrega vagas de terceiros: o anuncio final mora em dezenas de
 * sites diferentes e um seletor por site nao escala. O `JobPosting` do
 * schema.org, por outro lado, e o que o Google Jobs exige de quem quer aparecer
 * na busca de vagas, entao site de carreira que depende desse trafego o publica
 * — e o campo e sempre o mesmo, independente do layout.
 *
 * Devolve vazio quando a pagina nao traz o bloco (ou traz invalido), que e o
 * sinal de "esta origem nao da para ler" e nao um erro.
 */
export function jobPostingDescriptionFrom(html: string): string {
  const posting = findJobPosting(html, (node) => readString(node.description).length > 0);

  return posting ? htmlToText(readString(posting.description)) : '';
}

/**
 * O anuncio inteiro, e nao so a descricao.
 *
 * Existe pelo BNE, cuja listagem nao publica data em lugar nenhum: a data de
 * publicacao da vaga so aparece no `datePosted` deste bloco, e sem ela nao ha
 * como honrar a janela de 72h. Como o formato e padronizado, qualquer fonte
 * futura que publique `JobPosting` le os mesmos campos por aqui.
 */
export function jobPostingFrom(html: string): JobPostingFields | undefined {
  const posting = findJobPosting(html, () => true);

  return posting ? toFields(posting) : undefined;
}

function toFields(posting: JsonRecord): JobPostingFields {
  const address = asRecord(asRecord(posting.jobLocation)?.address);

  return {
    title: readString(posting.title),
    company: readString(asRecord(posting.hiringOrganization)?.name),
    description: readString(posting.description),
    datePosted: readString(posting.datePosted),
    validThrough: readString(posting.validThrough),
    locality: readString(address?.addressLocality),
    region: readString(address?.addressRegion),
  };
}

/** Primeiro `JobPosting` da pagina que satisfaz o criterio de quem chamou. */
function findJobPosting(
  html: string,
  accept: (posting: JsonRecord) => boolean,
): JsonRecord | undefined {
  const $ = cheerio.load(html);

  for (const element of $(JSON_LD).toArray()) {
    const posting = postingIn(parse($(element).text()), accept);

    if (posting) {
      return posting;
    }
  }

  return undefined;
}

function parse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Bloco malformado e comum em site que monta o JSON na mao: segue para o
    // proximo em vez de derrubar a leitura.
    return undefined;
  }
}

/**
 * O bloco vem de tres formas no mundo real: o objeto direto, uma lista de
 * objetos e o `@graph` de quem declara varias entidades numa tag so.
 */
function postingIn(
  node: unknown,
  accept: (posting: JsonRecord) => boolean,
): JsonRecord | undefined {
  if (Array.isArray(node)) {
    return firstOf(node, accept);
  }

  const record = asRecord(node);

  if (!record) {
    return undefined;
  }

  if (isJobPosting(record['@type']) && accept(record)) {
    return record;
  }

  return firstOf(Array.isArray(record['@graph']) ? record['@graph'] : [], accept);
}

function firstOf(
  nodes: readonly unknown[],
  accept: (posting: JsonRecord) => boolean,
): JsonRecord | undefined {
  for (const node of nodes) {
    const posting = postingIn(node, accept);

    if (posting) {
      return posting;
    }
  }

  return undefined;
}

/** `@type` pode ser a string ou uma lista com ela dentro. */
function isJobPosting(type: unknown): boolean {
  if (Array.isArray(type)) {
    return type.includes('JobPosting');
  }

  return type === 'JobPosting';
}

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null ? (value as JsonRecord) : undefined;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

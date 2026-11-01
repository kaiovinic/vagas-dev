import * as cheerio from 'cheerio';

import { htmlToText } from '@/infra/scrapers/support/scraper-helpers';

const JSON_LD = 'script[type="application/ld+json"]';

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
  const $ = cheerio.load(html);

  for (const element of $(JSON_LD).toArray()) {
    const description = descriptionIn(parse($(element).text()));

    if (description.length > 0) {
      return htmlToText(description);
    }
  }

  return '';
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
function descriptionIn(node: unknown): string {
  if (Array.isArray(node)) {
    return firstOf(node);
  }

  if (!isRecord(node)) {
    return '';
  }

  if (isJobPosting(node['@type']) && typeof node.description === 'string') {
    return node.description;
  }

  return firstOf(Array.isArray(node['@graph']) ? node['@graph'] : []);
}

function firstOf(nodes: readonly unknown[]): string {
  for (const node of nodes) {
    const description = descriptionIn(node);

    if (description.length > 0) {
      return description;
    }
  }

  return '';
}

/** `@type` pode ser a string ou uma lista com ela dentro. */
function isJobPosting(type: unknown): boolean {
  if (Array.isArray(type)) {
    return type.includes('JobPosting');
  }

  return type === 'JobPosting';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

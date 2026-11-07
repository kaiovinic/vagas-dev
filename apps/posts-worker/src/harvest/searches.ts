import { LINKEDIN_BASE_URL } from '@/session/linkedin-urls';

/** Uma consulta da colheita. */
export interface PostsSearch {
  /** Aparece no relatorio: diz qual consulta secou. */
  readonly label: string;
  readonly keywords: string;
}

/**
 * Duas buscas, e nao uma ampla — a mesma divisao do coletor do Serper.
 *
 * Uma busca so e dominada pelo mercado remoto nacional, que tem muito mais
 * volume, e Salvador nunca aparece. Separando, a regional ganha um piso
 * garantido, que e justamente a lacuna que nenhuma das outras fontes resolveu.
 *
 * As consultas sao mais curtas que as do Serper de proposito: ali o operador
 * `site:` e os parenteses falam com o indice do Google; aqui a busca e a do
 * proprio LinkedIn, que trata a consulta como palavras-chave e nao garante
 * booleano nenhum. Consulta longa, nesse motor, devolve menos e nao mais.
 */
export const POSTS_SEARCHES: readonly PostsSearch[] = [
  { label: 'Bahia', keywords: 'vaga desenvolvedor Salvador Bahia' },
  { label: 'Remoto nacional', keywords: 'vaga desenvolvedor react remoto' },
];

/** Pausa entre duas buscas, como no coletor de referencia. */
export const PAUSE_BETWEEN_SEARCHES_IN_MS = 3_000;

const SEARCH_PATH = '/search/results/content/';

/**
 * A URL da busca de publicacoes.
 *
 * `sortBy` e `datePosted` chegam com as aspas duplas que o proprio LinkedIn
 * usa nos filtros — nao sao erro de codificacao: sem elas o filtro e ignorado
 * em silencio e a busca volta a ordenar por relevancia, trazendo post de um ano
 * atras.
 *
 * O recorte de 24h aqui e do buscador. A janela de 72h e nossa, aplicada na API
 * pelo snowflake da URL: dois cortes diferentes, de proposito, porque o filtro
 * do LinkedIn nao e confiavel o bastante para ser o unico.
 */
export function searchUrl(keywords: string): string {
  const params = new URLSearchParams({
    keywords,
    datePosted: '"past-24h"',
    sortBy: '"date_posted"',
  });

  return `${LINKEDIN_BASE_URL}${SEARCH_PATH}?${params.toString()}`;
}

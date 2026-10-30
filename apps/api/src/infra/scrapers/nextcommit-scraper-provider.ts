import { Inject, Injectable, Optional } from '@nestjs/common';
import * as cheerio from 'cheerio';

import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import { HTTP_CLIENT, type IHttpClient } from '@/domain/providers/http-client';
import { BaseScraperProvider } from '@/infra/scrapers/support/base-scraper-provider';
import {
  collapseSpaces,
  dedupeByUrl,
  looksLikeJobMetadata,
  parseDate,
  toAbsoluteUrl,
  uniqueStrings,
  workModelFromText,
} from '@/infra/scrapers/support/scraper-helpers';

const NEXTCOMMIT_ORIGIN = 'https://www.nextcommit.dev';

/** Areas que batem com a stack monitorada; `dados` e `mobile` ficam de fora. */
export const NEXTCOMMIT_DEFAULT_AREAS: readonly string[] = ['frontend', 'fullstack', 'backend'];

/**
 * Paginas por area. O feed e ordenado por data decrescente e pagina de 24 em
 * 24, entao a pagina 1 ja traz o mais novo; a 2 e margem para dia de volume
 * alto.
 */
export const NEXTCOMMIT_PAGES = 2;

export const NEXTCOMMIT_PAGE_SIZE = 24;

export interface NextCommitQuery {
  readonly area: string;
  readonly pages: number;
}

type HtmlNodes = ReturnType<cheerio.CheerioAPI>;

/**
 * Coletor do Next Commit (HTML renderizado no servidor, lido com cheerio).
 *
 * O site agrega anuncios de Himalayas, Jobicy, Lever e dos repositorios de
 * vagas do GitHub, e o link de candidatura aponta para a origem — e esse link
 * que vai para o radar, nao a pagina do agregador.
 *
 * Os seletores usam os atributos `data-job-*` e a estrutura (`article`,
 * `header`, `h3`, `time`), nunca as classes: elas sao hashes de build
 * (`fL9dtW_card`) e mudam a cada deploy do site.
 *
 * Busca por `/vagas?area=<area>&pagina=<n>`, e nao pelas paginas de trilha
 * (`/vagas/front-end`), que servem uma fatia fixa de 24 sem paginacao util.
 *
 * O nome do parametro e `pagina`, em portugues: `?page=2` e aceito e ignorado,
 * devolvendo a primeira pagina de novo — e por isso parecia, de inicio, que a
 * paginacao nao existia.
 *
 * Medido em 30/10/2026, sobre as vagas unicas que cada desenho devolve:
 *
 *   trilhas fixas    |  72 unicas | 32 com a stack (44%) | 3 aprovaveis
 *   feed geral       |  96 unicas | 21 com a stack (22%) | 3 aprovaveis
 *   area + paginacao | 138 unicas | 67 com a stack (49%) | 3 aprovaveis
 *
 * Os tres rendem o mesmo: o gargalo e a janela de 72h, nao a coleta — o site
 * publica poucas vagas por dia. Este desenho foi escolhido por ter a melhor
 * relevancia e por ser ordenado por data, o que faz diferenca em dia de
 * volume alto, quando o que e novo nao cabe numa pagina so.
 */
@Injectable()
export class NextCommitScraperProvider extends BaseScraperProvider {
  readonly source = 'nextcommit';
  readonly label = 'Next Commit';

  constructor(
    @Inject(HTTP_CLIENT) private readonly http: IHttpClient,
    @Optional() private readonly areas: readonly string[] = NEXTCOMMIT_DEFAULT_AREAS,
    @Optional() private readonly pages: number = NEXTCOMMIT_PAGES,
  ) {
    super();
  }

  protected async collect(): Promise<RawJobProps[]> {
    const requests = this.areas.flatMap((area) =>
      Array.from({ length: this.pages }, (_unused, index) => this.fetchPage(area, index + 1)),
    );

    return dedupeByUrl((await Promise.all(requests)).flat());
  }

  private async fetchPage(area: string, page: number): Promise<RawJobProps[]> {
    const params = new URLSearchParams({ area, pagina: String(page) });

    const { body } = await this.http.get<string>(
      `${NEXTCOMMIT_ORIGIN}/vagas?${params.toString()}`,
      { headers: { Accept: 'text/html' } },
    );

    return this.parseCards(body);
  }

  private parseCards(html: string): RawJobProps[] {
    const $ = cheerio.load(html);

    return $('article')
      .toArray()
      .flatMap((element) => this.toRawJob($, $(element)));
  }

  private toRawJob(nodes: cheerio.CheerioAPI, card: HtmlNodes): RawJobProps[] {
    const apply = card.find('a[data-job-title]').first();
    const title = collapseSpaces(apply.attr('data-job-title') ?? textOf(card.find('h3')));
    const url = toAbsoluteUrl(NEXTCOMMIT_ORIGIN, apply.attr('href') ?? '');
    const publishedAt = parseDate(card.find('time').first().attr('datetime'));

    if (title.length === 0 || !url || !publishedAt) {
      return [];
    }

    const company = readCompany(apply.attr('data-job-company') ?? '', title);

    if (company.length === 0) {
      return [];
    }

    const location = textOf(card.find('header > p').last());

    return [
      {
        title,
        company,
        source: this.source,
        url,
        publishedAt,
        publishedAtSource: 'SOURCE',
        description: '',
        location,
        workModel: workModelFromText(location),
        tags: readStack(nodes, card),
      },
    ];
  }
}

/**
 * O `data-job-company` as vezes traz a jornada em vez do nome, porque o
 * parser do proprio Next Commit corta o titulo no ultimo separador — o mesmo
 * defeito que este projeto ja corrigiu no coletor do GitHub.
 *
 * Quando isso acontece, o nome ainda esta no titulo, depois de " na ".
 */
function readCompany(raw: string, title: string): string {
  const declared = collapseSpaces(raw);

  if (declared.length > 0 && !looksLikeJobMetadata(declared)) {
    return declared;
  }

  const fromTitle = collapseSpaces(title.split(/\s+na\s+/i).slice(1).join(' na '));

  return looksLikeJobMetadata(fromTitle) ? '' : fromTitle;
}

/**
 * As tecnologias ficam num `<p>` com um rotulo so para leitor de tela
 * ("Tecnologias: "), que precisa sair antes de virar etiqueta.
 */
function readStack(nodes: cheerio.CheerioAPI, card: HtmlNodes): string[] {
  const paragraph = card
    .find('p')
    .filter((_index, element) => nodes(element).find('.sr-only').length > 0)
    .first();

  if (paragraph.length === 0) {
    return [];
  }

  const clone = paragraph.clone();

  clone.find('.sr-only').remove();

  return uniqueStrings(collapseSpaces(clone.text()).split(/[,·]/));
}

function textOf(nodes: HtmlNodes): string {
  return collapseSpaces(nodes.text());
}

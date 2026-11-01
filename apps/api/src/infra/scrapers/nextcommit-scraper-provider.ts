import { Inject, Injectable, Optional } from '@nestjs/common';
import * as cheerio from 'cheerio';

import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import { HTTP_CLIENT, type IHttpClient } from '@/domain/providers/http-client';
import type { IJobDescriptionFetcher } from '@/domain/providers/job-description-fetcher';
import { BaseScraperProvider } from '@/infra/scrapers/support/base-scraper-provider';
import { jobPostingDescriptionFrom } from '@/infra/scrapers/support/job-posting-json-ld';
import {
  collapseSpaces,
  dedupeByUrl,
  htmlToText,
  looksLikeJobMetadata,
  parseDate,
  toAbsoluteUrl,
  uniqueStrings,
  workModelFromText,
} from '@/infra/scrapers/support/scraper-helpers';

const NEXTCOMMIT_ORIGIN = 'https://www.nextcommit.dev';

export const NEXTCOMMIT_REQUEST_DELAY_IN_MS = 1_500;

/**
 * Origens que nao dao para ler, e por isso nem sao pedidas.
 *
 * Medido em 01/11/2026, nos 138 cards das tres areas: `himalayas.app` responde
 * 108 deles e serve a pagina atras do desafio do Cloudflare ("Just a moment"),
 * enquanto a API publica dela devolve so as 20 vagas mais recentes — uma janela
 * de oito minutos, inutil para achar um anuncio de ontem. Em `github.com` estao
 * as issues dos repositorios de vagas, que o coletor do GitHub ja traz com o
 * corpo inteiro.
 *
 * Sem esta lista, cada ciclo gastaria uma requisicao por vaga para receber a
 * pagina do desafio e gravar nada.
 */
const WITHOUT_READABLE_DETAIL: readonly string[] = ['himalayas.app', 'github.com'];

const GREENHOUSE_HOST = 'greenhouse.io';
const GREENHOUSE_BOARD_API = 'https://boards-api.greenhouse.io/v1/boards';

/** `/{quadro}/jobs/{id}`: o caminho da pagina e tambem o caminho na API. */
const GREENHOUSE_JOB_PATH = /^\/[^/]+\/jobs\/\d+$/;

interface GreenhouseJob {
  /** HTML do anuncio, com as tags escapadas (`&lt;p&gt;`). */
  readonly content?: string;
}

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
export class NextCommitScraperProvider
  extends BaseScraperProvider
  implements IJobDescriptionFetcher
{
  readonly source = 'nextcommit';
  readonly label = 'Next Commit';

  constructor(
    @Inject(HTTP_CLIENT) private readonly http: IHttpClient,
    @Optional() private readonly areas: readonly string[] = NEXTCOMMIT_DEFAULT_AREAS,
    @Optional() private readonly pages: number = NEXTCOMMIT_PAGES,
    @Optional() private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {
    super();
  }

  /**
   * Descricao da vaga na origem, porque o agregador nao a tem.
   *
   * O card do Next Commit traz titulo, empresa, local, stack e data — nunca o
   * texto do anuncio — e nao existe pagina de detalhe no proprio site: o link e
   * o botao "Ver vaga", que aponta para Himalayas, Greenhouse, Jobicy ou uma
   * issue do GitHub. Entao o detalhe e lido na origem, e por isso aqui tem
   * caminho por origem em vez de um seletor so.
   *
   * Origem que nao da para ler devolve vazio sem gastar requisicao.
   */
  async fetchDescriptionFor(url: string): Promise<string> {
    if (hasNoReadableDetail(url)) {
      return '';
    }

    await this.wait(NEXTCOMMIT_REQUEST_DELAY_IN_MS);

    try {
      return await this.readDetail(url);
    } catch (error: unknown) {
      this.logger.warn(`Detalhe de ${url}: ${describeError(error)}`);

      return '';
    }
  }

  private async readDetail(url: string): Promise<string> {
    const greenhouse = greenhouseApiUrlOf(url);

    if (greenhouse) {
      return this.fromGreenhouse(greenhouse);
    }

    const { body } = await this.http.get<string>(url, { headers: { Accept: 'text/html' } });

    return jobPostingDescriptionFrom(body);
  }

  /** O quadro do Greenhouse nao publica JSON-LD, mas tem API aberta por vaga. */
  private async fromGreenhouse(apiUrl: string): Promise<string> {
    const { body } = await this.http.get<GreenhouseJob>(apiUrl, {
      headers: { Accept: 'application/json' },
    });

    return htmlToText(unescapeMarkup(body.content ?? ''));
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

function hasNoReadableDetail(url: string): boolean {
  const host = hostOf(url);

  // Sem host nao ha nem o que pedir: url guardada torta e origem desconhecida.
  if (host.length === 0) {
    return true;
  }

  return WITHOUT_READABLE_DETAIL.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

/** URL da vaga na API aberta do Greenhouse, ou nada quando a origem e outra. */
function greenhouseApiUrlOf(url: string): string | undefined {
  if (!hostOf(url).endsWith(GREENHOUSE_HOST)) {
    return undefined;
  }

  const { pathname } = new URL(url);

  return GREENHOUSE_JOB_PATH.test(pathname) ? `${GREENHOUSE_BOARD_API}${pathname}` : undefined;
}

/** Url invalida nao e excecao aqui: vira origem desconhecida e segue o fluxo. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * A API do Greenhouse devolve o anuncio com as tags escapadas, entao o texto
 * precisa de uma passada para virar HTML de novo antes de virar texto corrido.
 */
function unescapeMarkup(escaped: string): string {
  return cheerio.load(`<div>${escaped}</div>`).root().text();
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

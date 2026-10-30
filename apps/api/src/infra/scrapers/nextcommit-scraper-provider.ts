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

/**
 * Trilhas que batem com a stack monitorada. As demais do site (java, python,
 * dados, mobile) ficam de fora porque seriam reprovadas na regra de stack, e
 * as de senioridade (junior, pleno, senior) repetiriam estas.
 *
 * Cada trilha devolve 24 vagas distintas: medido, front-end e full-stack nao
 * tem um unico id em comum.
 */
export const NEXTCOMMIT_DEFAULT_TRACKS: readonly string[] = [
  'front-end',
  'full-stack',
  'back-end',
];

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
 * Nao ha paginacao a seguir: `?page=2` devolve exatamente os mesmos 24 cards
 * da primeira pagina, porque a paginacao e feita no cliente.
 */
@Injectable()
export class NextCommitScraperProvider extends BaseScraperProvider {
  readonly source = 'nextcommit';
  readonly label = 'Next Commit';

  constructor(
    @Inject(HTTP_CLIENT) private readonly http: IHttpClient,
    @Optional() private readonly tracks: readonly string[] = NEXTCOMMIT_DEFAULT_TRACKS,
  ) {
    super();
  }

  protected async collect(): Promise<RawJobProps[]> {
    const pages = await Promise.all(this.tracks.map((track) => this.fetchTrack(track)));

    return dedupeByUrl(pages.flat());
  }

  private async fetchTrack(track: string): Promise<RawJobProps[]> {
    const { body } = await this.http.get<string>(`${NEXTCOMMIT_ORIGIN}/vagas/${track}`, {
      headers: { Accept: 'text/html' },
    });

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

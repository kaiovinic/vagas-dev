import { Inject, Injectable, Optional } from '@nestjs/common';
import * as cheerio from 'cheerio';

import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import { HTTP_CLIENT, type IHttpClient } from '@/domain/providers/http-client';
import { BaseScraperProvider } from '@/infra/scrapers/support/base-scraper-provider';
import {
  collapseSpaces,
  dedupeByUrl,
  toAbsoluteUrl,
  uniqueStrings,
  workModelFromText,
} from '@/infra/scrapers/support/scraper-helpers';

const PROGRAMATHOR_ORIGIN = 'https://programathor.com.br';
const EXPIRED_BADGE = 'vencida';

type HtmlNodes = ReturnType<cheerio.CheerioAPI>;

/** Categorias publicas confirmadas no site. Nao existe slug de fullstack. */
export const PROGRAMATHOR_DEFAULT_CATEGORIES: readonly string[] = [
  'jobs-front-end',
  'jobs-react',
  'jobs-node-js',
  'jobs-angular',
  'jobs-net',
];

/**
 * Coletor da ProgramaThor (HTML via cheerio).
 *
 * A listagem nao publica data de publicacao em lugar algum — nem na pagina de
 * detalhe — por isso toda vaga sai sem `publishedAt` e com
 * `publishedAtSource: 'CAPTURE'`: quem decide a data e o orquestrador, usando o
 * instante da captura. Cards marcados como "Vencida" (`.opacity-60p`) sao descartados.
 */
@Injectable()
export class ProgramathorScraperProvider extends BaseScraperProvider {
  readonly source = 'programathor';
  readonly label = 'ProgramaThor';

  constructor(
    @Inject(HTTP_CLIENT) private readonly http: IHttpClient,
    @Optional() private readonly categories: readonly string[] = PROGRAMATHOR_DEFAULT_CATEGORIES,
  ) {
    super();
  }

  protected async collect(): Promise<RawJobProps[]> {
    const pages = await Promise.all(
      this.categories.map((category) => this.fetchCategory(category)),
    );

    return dedupeByUrl(pages.flat());
  }

  private async fetchCategory(category: string): Promise<RawJobProps[]> {
    const { body } = await this.http.get<string>(`${PROGRAMATHOR_ORIGIN}/${category}`, {
      headers: { Accept: 'text/html' },
    });

    return this.parseCards(body);
  }

  private parseCards(html: string): RawJobProps[] {
    const $ = cheerio.load(html);

    return $('div.cell-list')
      .toArray()
      .flatMap((element) => this.toRawJob($, $(element)));
  }

  private toRawJob(nodes: cheerio.CheerioAPI, card: HtmlNodes): RawJobProps[] {
    const heading = card.find('h3').first();

    if (heading.length === 0 || isExpired(card, heading)) {
      return [];
    }

    const title = readTitle(heading);
    const details = textOf(nodes, card, '.cell-list-content-icon span');
    const company = details[0] ?? '';
    const location = details[1] ?? '';
    const url = toAbsoluteUrl(
      PROGRAMATHOR_ORIGIN,
      card.find('a[href*="/jobs/"]').first().attr('href') ?? '',
    );

    if (title.length === 0 || company.length === 0 || !url) {
      return [];
    }

    return [
      {
        title,
        company,
        source: this.source,
        url,
        publishedAtSource: 'CAPTURE',
        description: '',
        location,
        workModel: workModelFromText(location),
        tags: uniqueStrings(textOf(nodes, card, 'span.tag-list')),
      },
    ];
  }
}

function textOf(nodes: cheerio.CheerioAPI, card: HtmlNodes, selector: string): string[] {
  return card
    .find(selector)
    .toArray()
    .map((element) => collapseSpaces(nodes(element).text()));
}

function isExpired(card: HtmlNodes, heading: HtmlNodes): boolean {
  if (card.hasClass('opacity-60p')) {
    return true;
  }

  return heading.find('span').text().toLowerCase().includes(EXPIRED_BADGE);
}

/** O `h3` mistura o cargo com badges ("PRESENCIAL", "Vencida"), que saem fora do titulo. */
function readTitle(heading: HtmlNodes): string {
  const clone = heading.clone();

  clone.find('span').remove();

  return collapseSpaces(clone.text());
}

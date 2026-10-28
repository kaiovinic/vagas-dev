import { Inject, Injectable, Optional } from '@nestjs/common';
import * as cheerio from 'cheerio';

import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import type { JobWorkModel } from '@/domain/entities/job';
import { HTTP_CLIENT, type IHttpClient } from '@/domain/providers/http-client';
import { BaseScraperProvider } from '@/infra/scrapers/support/base-scraper-provider';
import {
  collapseSpaces,
  dedupeByUrl,
  parseDate,
  toAbsoluteUrl,
  workModelFromText,
} from '@/infra/scrapers/support/scraper-helpers';

const GUEST_SEARCH_URL =
  'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const LINKEDIN_ORIGIN = 'https://www.linkedin.com';

/** Vagas publicadas nas ultimas 72h: 259200 segundos. */
export const LINKEDIN_LAST_72H_FILTER = 'r259200';

/** `f_WT=2` restringe a busca a vagas remotas no filtro publico do LinkedIn. */
const REMOTE_WORKPLACE_FILTER = '2';

type HtmlNodes = ReturnType<cheerio.CheerioAPI>;

const KEYWORDS: readonly string[] = [
  'desenvolvedor frontend',
  'desenvolvedor fullstack',
  'react',
  'angular',
];

export interface LinkedinSearch {
  readonly keywords: string;
  readonly location: string;
  readonly remoteOnly: boolean;
}

export const LINKEDIN_DEFAULT_SEARCHES: readonly LinkedinSearch[] = KEYWORDS.flatMap(
  (keywords) => [
    { keywords, location: 'Salvador, Bahia, Brazil', remoteOnly: false },
    { keywords, location: 'Brazil', remoteOnly: true },
  ],
);

/**
 * Coletor da rota guest do LinkedIn (`seeMoreJobPostings`), que devolve os cards
 * de vaga em HTML sem exigir autenticacao. Sempre aplica `f_TPR=r259200`, ou seja,
 * a propria fonte ja limita o resultado as ultimas 72 horas.
 */
@Injectable()
export class LinkedinGuestScraperProvider extends BaseScraperProvider {
  readonly source = 'linkedin';
  readonly label = 'LinkedIn';

  constructor(
    @Inject(HTTP_CLIENT) private readonly http: IHttpClient,
    @Optional() private readonly searches: readonly LinkedinSearch[] = LINKEDIN_DEFAULT_SEARCHES,
  ) {
    super();
  }

  protected async collect(): Promise<RawJobProps[]> {
    const pages = await Promise.all(this.searches.map((search) => this.fetchSearch(search)));

    return dedupeByUrl(pages.flat());
  }

  private async fetchSearch(search: LinkedinSearch): Promise<RawJobProps[]> {
    const { body } = await this.http.get<string>(buildSearchUrl(search), {
      headers: {
        Accept: 'text/html',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    });

    return this.parseCards(body, search);
  }

  private parseCards(html: string, search: LinkedinSearch): RawJobProps[] {
    const $ = cheerio.load(html);

    return $('div.base-card')
      .toArray()
      .flatMap((element) => this.toRawJob($(element), search));
  }

  private toRawJob(card: HtmlNodes, search: LinkedinSearch): RawJobProps[] {
    const title = collapseSpaces(card.find('h3.base-search-card__title').first().text());
    const company = collapseSpaces(card.find('h4.base-search-card__subtitle').first().text());
    const location = collapseSpaces(card.find('.job-search-card__location').first().text());
    const href = card.find('a.base-card__full-link').first().attr('href') ?? '';
    const url = toAbsoluteUrl(LINKEDIN_ORIGIN, href);
    const publishedAt = parseDate(card.find('time').first().attr('datetime'));

    if (title.length === 0 || company.length === 0 || !url || !publishedAt) {
      return [];
    }

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
        workModel: resolveWorkModel(location, search),
      },
    ];
  }
}

function buildSearchUrl(search: LinkedinSearch): string {
  const params = new URLSearchParams({
    keywords: search.keywords,
    location: search.location,
    f_TPR: LINKEDIN_LAST_72H_FILTER,
    start: '0',
  });

  if (search.remoteOnly) {
    params.set('f_WT', REMOTE_WORKPLACE_FILTER);
  }

  return `${GUEST_SEARCH_URL}?${params.toString()}`;
}

/** Os cards guest nao trazem a modalidade; a busca remota ja garante `f_WT=2`. */
function resolveWorkModel(location: string, search: LinkedinSearch): JobWorkModel {
  if (search.remoteOnly) {
    return 'REMOTE';
  }

  return workModelFromText(location);
}

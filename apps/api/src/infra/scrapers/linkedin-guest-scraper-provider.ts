import { Inject, Injectable, Optional } from '@nestjs/common';
import * as cheerio from 'cheerio';

import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import type { JobWorkModel } from '@/domain/entities/job';
import { HTTP_CLIENT, type IHttpClient } from '@/domain/providers/http-client';
import {
  JOB_DESCRIPTION_READER,
  type IJobDescriptionReader,
} from '@/domain/repositories/job-description-repository';
import { BaseScraperProvider } from '@/infra/scrapers/support/base-scraper-provider';
import {
  collapseSpaces,
  dedupeByUrl,
  htmlToText,
  parseDate,
  toAbsoluteUrl,
  workModelFromText,
} from '@/infra/scrapers/support/scraper-helpers';

const GUEST_SEARCH_URL =
  'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
/** Descricao completa de uma vaga, tambem sem login. */
const GUEST_DETAIL_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting';
const LINKEDIN_ORIGIN = 'https://www.linkedin.com';

/**
 * Intervalo entre duas requisicoes de detalhe.
 *
 * O endpoint e publico e sem autenticacao, entao o que esta em jogo nao e conta
 * banida, e sim o IP da VPS levar 429 — e o IP e compartilhado com outro
 * projeto. Um segundo e meio e o ritmo que outros coletores publicos usam
 * contra o mesmo endpoint sem apanhar.
 */
export const LINKEDIN_DETAIL_DELAY_IN_MS = 1_500;

/**
 * Teto de detalhes por ciclo.
 *
 * Sem teto, o primeiro ciclo depois de uma mudanca de busca pediria o detalhe
 * de tudo que voltasse, de uma vez. O que ficar de fora volta sem descricao e e
 * buscado no ciclo seguinte, quando o cache ja cobre os anteriores — a captura
 * roda de 2 em 2 horas, entao a fila se esvazia sozinha.
 */
export const LINKEDIN_MAX_DETAILS_PER_CYCLE = 25;

/** `4482768114` em `.../jobs/view/desenvolvedor-front-end-junior-at-jobbol-4482768114`. */
const JOB_ID_IN_URL = /(\d{6,})\/?$/;

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
    // O estado inteiro, e nao a capital: o LinkedIn aceita a localidade no
    // nivel de UF e passa a trazer tambem Feira de Santana, Vitoria da
    // Conquista e o resto do interior, sem custar uma requisicao a mais.
    { keywords, location: 'Bahia, Brazil', remoteOnly: false },
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
    @Inject(JOB_DESCRIPTION_READER) private readonly descriptions: IJobDescriptionReader,
    @Optional() private readonly searches: readonly LinkedinSearch[] = LINKEDIN_DEFAULT_SEARCHES,
    @Optional() private readonly wait: (ms: number) => Promise<void> = sleep,
    @Optional() private readonly maxDetails: number = LINKEDIN_MAX_DETAILS_PER_CYCLE,
  ) {
    super();
  }

  protected async collect(): Promise<RawJobProps[]> {
    const pages = await Promise.all(this.searches.map((search) => this.fetchSearch(search)));

    return this.withDescriptions(dedupeByUrl(pages.flat()));
  }

  /**
   * O card da busca nao traz a descricao, e e ela que decide stack e municipio
   * citado no corpo do anuncio. Cada vaga e buscada UMA vez na vida: o que ja
   * esta no banco volta do cache, o resto vai a rede em fila, com espera.
   */
  private async withDescriptions(jobs: readonly RawJobProps[]): Promise<RawJobProps[]> {
    const cached = await this.descriptions.findDescriptionsByUrl(jobs.map((job) => job.url));
    const pending = jobs.filter((job) => !cached.has(job.url)).slice(0, this.maxDetails);
    const fetched = await this.fetchDescriptions(pending);

    return jobs.map((job) => ({
      ...job,
      description: cached.get(job.url) ?? fetched.get(job.url) ?? '',
    }));
  }

  private async fetchDescriptions(jobs: readonly RawJobProps[]): Promise<Map<string, string>> {
    const descriptions = new Map<string, string>();

    for (const [index, job] of jobs.entries()) {
      if (index > 0) {
        await this.wait(LINKEDIN_DETAIL_DELAY_IN_MS);
      }

      const description = await this.fetchDescription(job.url);

      if (description.length > 0) {
        descriptions.set(job.url, description);
      }
    }

    return descriptions;
  }

  /**
   * Uma vaga sem detalhe nao derruba o ciclo: ela volta sem descricao, nao
   * entra no cache e e tentada de novo na proxima captura. E o caso de 429 e de
   * vaga retirada do ar entre a busca e o detalhe.
   */
  private async fetchDescription(jobUrl: string): Promise<string> {
    const jobId = JOB_ID_IN_URL.exec(jobUrl)?.[1];

    if (!jobId) {
      return '';
    }

    try {
      const { body } = await this.http.get<string>(`${GUEST_DETAIL_URL}/${jobId}`, {
        headers: { Accept: 'text/html', 'Accept-Language': 'pt-BR,pt;q=0.9' },
      });

      return descriptionFromDetail(body);
    } catch (error: unknown) {
      this.logger.warn(`Detalhe da vaga ${jobId}: ${error instanceof Error ? error.message : error}`);

      return '';
    }
  }

  private async fetchSearch(search: LinkedinSearch): Promise<RawJobProps[]> {
    const { body } = await this.http.get<string>(buildSearchUrl(search), {
      headers: {
        Accept: 'text/html',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    });

    return this.parseCards(body);
  }

  private parseCards(html: string): RawJobProps[] {
    const $ = cheerio.load(html);

    return $('div.base-card')
      .toArray()
      .flatMap((element) => this.toRawJob($(element)));
  }

  private toRawJob(card: HtmlNodes): RawJobProps[] {
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
        workModel: resolveWorkModel(title, location),
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

/**
 * Os cards guest nao trazem a modalidade, e o filtro pedido na busca NAO serve
 * para deduzi-la: o LinkedIn ignora `f_WT` para visitantes. Verificado em
 * 31/10/2026 — a mesma consulta com e sem o parametro devolveu os mesmos ids, e
 * entre eles vinham vagas presenciais em Jaguariuna/SP e Belo Horizonte/MG.
 *
 * Confiar no filtro marcava essas vagas como remotas, e `workModel === 'REMOTE'`
 * adiciona o rotulo "Remoto" no motor de regras antes de qualquer outra
 * verificacao: elas pulavam a regra de localidade inteira e ainda inflavam o KPI
 * de remotas. So o texto da vaga decide.
 *
 * O titulo entra junto da localidade porque e onde a modalidade costuma estar
 * ("Desenvolvedor React Frontend - Trabalho Remoto", com localidade
 * "Salvador, BA"). Sem ele, vaga remota de verdade viraria UNKNOWN.
 */
function resolveWorkModel(title: string, location: string): JobWorkModel {
  return workModelFromText(`${title} ${location}`);
}

/**
 * Texto da descricao na pagina de detalhe.
 *
 * `show-more-less-html__markup` e o unico bloco da pagina com o anuncio; o
 * conteudo dele e HTML do proprio anunciante, e a conversao para texto corrido
 * e a mesma de qualquer outra fonte que devolve descricao em HTML.
 */
function descriptionFromDetail(html: string): string {
  const markup = cheerio.load(html)('.show-more-less-html__markup').first();

  return markup.length === 0 ? '' : htmlToText(markup.html() ?? '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

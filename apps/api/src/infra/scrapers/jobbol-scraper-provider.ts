import { Inject, Injectable, Optional } from '@nestjs/common';
import * as cheerio from 'cheerio';

import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import { HTTP_CLIENT, type IHttpClient } from '@/domain/providers/http-client';
import { BaseScraperProvider } from '@/infra/scrapers/support/base-scraper-provider';
import {
  collapseSpaces,
  dedupeByUrl,
  parseDate,
  toAbsoluteUrl,
  workModelFromText,
} from '@/infra/scrapers/support/scraper-helpers';

const JOBBOL_ORIGIN = 'https://www.jobbol.com.br';

/** Area que agrupa todos os cargos de tecnologia do site. */
const TECH_AREA = 'informatica-ti';

/**
 * O site so devolve o HTML da listagem para navegador; sem este cabecalho a
 * resposta vem sem os cards.
 */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Salvador e os municipios da Regiao Metropolitana com vaga de TI no site. */
export const JOBBOL_DEFAULT_CITIES: readonly string[] = [
  'salvador-ba',
  'lauro-de-freitas-ba',
  'camacari-ba',
  'simoes-filho-ba',
];

type HtmlNodes = ReturnType<cheerio.CheerioAPI>;
type Clock = () => Date;

/**
 * Coletor do Jobbol (HTML renderizado no servidor, lido com cheerio).
 *
 * ATENCAO — a fonte esta inacessivel em producao. O Jobbol fica atras do Bot
 * Management da Cloudflare, que responde 403 com `cf-mitigated: challenge` e a
 * pagina "Just a moment..." a qualquer cliente HTTP que nao seja um navegador
 * de verdade. O bloqueio e por impressao digital de TLS, nao por cabecalho:
 * curl com o mesmo User-Agent recebe 200, o axios recebe 403. Vale para TODAS
 * as rotas, inclusive o sitemap que o proprio robots.txt oferece a
 * rastreadores.
 *
 * Contornar isso (forjar a impressao digital TLS, resolver o desafio em
 * navegador headless) seria burlar um controle de acesso, e por isso nao foi
 * feito. O parser abaixo esta completo e testado contra HTML real: se o site
 * liberar o acesso — por acordo, chave de API ou liberacao de IP — a fonte
 * passa a funcionar sem nenhuma mudanca. Enquanto isso, cada captura registra
 * um WARN e segue com as demais fontes.
 *
 * Usa as paginas de area (`/areas/informatica-ti/<cidade>`) e nao a busca do
 * site: o `robots.txt` do Jobbol tem `Disallow: /busca` para `User-agent: *`,
 * que e o grupo em que este coletor cai. As paginas de area ficam fora de
 * qualquer regra de bloqueio, e uma so cobre todos os cargos de TI da cidade —
 * menos requisicoes do que varrer cargo por cargo.
 *
 * A listagem vem ordenada por data decrescente, entao a primeira pagina ja
 * cobre com folga a janela de 72h do DevRadar; nao ha paginacao a seguir.
 */
@Injectable()
export class JobbolScraperProvider extends BaseScraperProvider {
  readonly source = 'jobbol';
  readonly label = 'Jobbol';

  constructor(
    @Inject(HTTP_CLIENT) private readonly http: IHttpClient,
    @Optional() private readonly cities: readonly string[] = JOBBOL_DEFAULT_CITIES,
    @Optional() private readonly now: Clock = () => new Date(),
  ) {
    super();
  }

  protected async collect(): Promise<RawJobProps[]> {
    const pages = await Promise.all(this.cities.map((city) => this.fetchCity(city)));

    return dedupeByUrl(pages.flat());
  }

  private async fetchCity(city: string): Promise<RawJobProps[]> {
    const { body } = await this.http.get<string>(
      `${JOBBOL_ORIGIN}/areas/${TECH_AREA}/${city}`,
      { headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'text/html' } },
    );

    return this.parseCards(body);
  }

  private parseCards(html: string): RawJobProps[] {
    const $ = cheerio.load(html);

    return $('div.card-vaga')
      .toArray()
      .flatMap((element) => this.toRawJob($(element)));
  }

  private toRawJob(card: HtmlNodes): RawJobProps[] {
    const title = collapseSpaces(card.find('h3').first().text());
    const url = toAbsoluteUrl(JOBBOL_ORIGIN, card.find('a[href*="/vaga/"]').first().attr('href') ?? '');

    // A listagem intercala blocos de publicidade que usam a mesma classe dos
    // cards. Eles nao tem titulo nem link de vaga, e e isso que os separa.
    if (title.length === 0 || !url) {
      return [];
    }

    const summary = collapseSpaces(card.find('.card-resumo').first().text());
    const location = collapseSpaces(card.find('.card-cidade').first().text());
    const company = this.readCompany(card, summary);

    if (company.length === 0) {
      return [];
    }

    const publishedAt = this.readPublishedAt(card, summary);

    return [
      {
        title,
        company,
        source: this.source,
        url,
        publishedAt,
        publishedAtSource: publishedAt ? 'SOURCE' : 'CAPTURE',
        description: summary,
        location,
        workModel: workModelFromText(`${title} ${location} ${summary}`),
      },
    ];
  }

  /**
   * O nome da empresa esta no `alt` do logo. Quando o card nao tem logo, o
   * resumo repete o nome entre "em " e o codigo da vaga.
   */
  private readCompany(card: HtmlNodes, summary: string): string {
    const fromLogo = collapseSpaces(card.find('img.card-logo').first().attr('alt') ?? '');

    if (fromLogo.length > 0) {
      return fromLogo;
    }

    return collapseSpaces(COMPANY_IN_SUMMARY.exec(summary)?.[1] ?? '');
  }

  /**
   * Prefere a idade relativa do resumo ("postada ha 23 horas") a data do card.
   *
   * O card traz so o dia, que viraria meio-dia de Brasilia — uma aproximacao de
   * ate doze horas. Como a janela do DevRadar e de 72h, essa diferenca decide
   * se a vaga entra ou fica de fora, e a idade relativa da precisao de hora.
   */
  private readPublishedAt(card: HtmlNodes, summary: string): Date | undefined {
    const relative = relativeAgeInMinutes(summary);

    if (relative !== undefined) {
      return new Date(this.now().getTime() - relative * 60 * 1000);
    }

    const printed = collapseSpaces(card.find('.card-data').first().text());

    return parseDate(toIsoDay(printed), this.now());
  }
}

const COMPANY_IN_SUMMARY = /\bem\s+(.+?),\s*c[oó]d/i;
const RELATIVE_AGE = /postada\s+h[aá]\s+(\d+)\s+(minuto|hora|dia)/i;
const BRAZILIAN_DAY = /^(\d{2})\/(\d{2})\/(\d{4})$/;

const MINUTES_PER_UNIT: Readonly<Record<string, number>> = {
  minuto: 1,
  hora: 60,
  dia: 60 * 24,
};

function relativeAgeInMinutes(summary: string): number | undefined {
  const match = RELATIVE_AGE.exec(summary);
  const amount = Number(match?.[1]);
  const unit = match?.[2]?.toLowerCase();

  if (!unit || Number.isNaN(amount)) {
    return undefined;
  }

  const minutes = MINUTES_PER_UNIT[unit];

  return minutes === undefined ? undefined : amount * minutes;
}

/** `27/10/2026` -> `2026-10-27`, que e o formato que o `parseDate` entende. */
function toIsoDay(printed: string): string {
  const match = BRAZILIAN_DAY.exec(printed);

  if (!match) {
    return '';
  }

  return `${match[3]}-${match[2]}-${match[1]}`;
}

import { Inject, Injectable, Optional } from '@nestjs/common';

import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import type { JobWorkModel } from '@/domain/entities/job';
import { HTTP_CLIENT, type IHttpClient } from '@/domain/providers/http-client';
import { BaseScraperProvider } from '@/infra/scrapers/support/base-scraper-provider';
import {
  collapseSpaces,
  dedupeByUrl,
  parseDate,
  uniqueStrings,
} from '@/infra/scrapers/support/scraper-helpers';

const SOLIDES_ORIGIN = 'https://vagas.solides.com.br';
const TECH_AREA = 'tecnologia';

/** Maior valor que a api aceita; de 30 para cima ela devolve lista vazia. */
export const SOLIDES_PAGE_SIZE = 24;

export interface SolidesQuery {
  /** Codigo do estado (`BA`) ou vazio, para o feed nacional. */
  readonly locations: string;
  readonly pages: number;
}

/**
 * Duas consultas, por motivos diferentes:
 *
 * - `BA` traz a Bahia inteira (~124 vagas de tecnologia), o que cobre Salvador
 *   e todos os municipios da Regiao Metropolitana sem depender do slug de cada
 *   cidade — testado: `lauro-de-freitas-ba` e `camacari-ba` devolvem zero, mas
 *   as vagas dessas cidades aparecem no filtro do estado.
 * - O feed nacional vem ordenado por data decrescente e pega as vagas remotas
 *   anunciadas fora da Bahia. Poucas paginas bastam: a quarta ja passa de 72h.
 */
export const SOLIDES_DEFAULT_QUERIES: readonly SolidesQuery[] = [
  { locations: 'BA', pages: 6 },
  { locations: '', pages: 4 },
];

const WORK_MODELS: Readonly<Record<string, JobWorkModel>> = {
  remoto: 'REMOTE',
  hibrido: 'HYBRID',
  presencial: 'ONSITE',
};

type Clock = () => Date;

interface SolidesNamed {
  readonly name?: unknown;
}

interface SolidesVacancy {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly companyName?: unknown;
  readonly description?: unknown;
  readonly createdAt?: unknown;
  readonly jobType?: unknown;
  readonly city?: SolidesNamed | null;
  readonly state?: { readonly code?: unknown } | null;
  readonly hardSkills?: readonly SolidesNamed[];
  readonly recruitmentContractType?: readonly SolidesNamed[];
}

/**
 * Coletor da Solides (api JSON publica do portal de vagas).
 *
 * O portal e um Next.js que consome `/api/vacancies`, descoberto observando as
 * requisicoes da pagina. Ler o JSON e mais estavel do que raspar o HTML, que
 * renderiza a lista no cliente. O `robots.txt` do dominio libera tudo para
 * `User-agent: *`.
 */
@Injectable()
export class SolidesScraperProvider extends BaseScraperProvider {
  readonly source = 'solides';
  readonly label = 'Solides';

  constructor(
    @Inject(HTTP_CLIENT) private readonly http: IHttpClient,
    @Optional() private readonly queries: readonly SolidesQuery[] = SOLIDES_DEFAULT_QUERIES,
    @Optional() private readonly now: Clock = () => new Date(),
  ) {
    super();
  }

  protected async collect(): Promise<RawJobProps[]> {
    const pages = await Promise.all(this.queries.flatMap((query) => this.fetchQuery(query)));

    return dedupeByUrl(pages.flat());
  }

  private fetchQuery(query: SolidesQuery): Promise<RawJobProps[]>[] {
    return Array.from({ length: query.pages }, (_unused, index) =>
      this.fetchPage(query.locations, index + 1),
    );
  }

  private async fetchPage(locations: string, page: number): Promise<RawJobProps[]> {
    const params = new URLSearchParams({
      page: String(page),
      take: String(SOLIDES_PAGE_SIZE),
      occupationAreas: TECH_AREA,
      locations,
    });

    const { body } = await this.http.get<unknown>(
      `${SOLIDES_ORIGIN}/api/vacancies?${params.toString()}`,
      { headers: { Accept: 'application/json' } },
    );

    return this.parseVacancies(body);
  }

  private parseVacancies(body: unknown): RawJobProps[] {
    const data = (body as { data?: unknown } | null)?.data;

    if (!Array.isArray(data)) {
      return [];
    }

    return (data as SolidesVacancy[]).flatMap((vacancy) => this.toRawJob(vacancy));
  }

  private toRawJob(vacancy: SolidesVacancy): RawJobProps[] {
    const id = readId(vacancy.id);
    const title = collapseSpaces(readString(vacancy.title));
    const company = collapseSpaces(readString(vacancy.companyName));
    const publishedAt = parseDate(vacancy.createdAt, this.now());

    if (!id || title.length === 0 || company.length === 0 || !publishedAt) {
      return [];
    }

    return [
      {
        title,
        company,
        source: this.source,
        url: `${SOLIDES_ORIGIN}/vaga/${id}`,
        publishedAt,
        publishedAtSource: 'SOURCE',
        description: stripHtml(readString(vacancy.description)),
        location: readPlace(vacancy),
        workModel: WORK_MODELS[readString(vacancy.jobType).toLowerCase()] ?? 'UNKNOWN',
        tags: uniqueStrings([
          ...namesOf(vacancy.hardSkills),
          ...namesOf(vacancy.recruitmentContractType),
        ]),
      },
    ];
  }
}

/** "Salvador - BA". Vaga remota as vezes vem sem endereco nenhum. */
function readPlace(vacancy: SolidesVacancy): string {
  const city = collapseSpaces(readString(vacancy.city?.name));
  const state = collapseSpaces(readString(vacancy.state?.code));

  return [city, state].filter((part) => part.length > 0).join(' - ');
}

function namesOf(items: readonly SolidesNamed[] | undefined): string[] {
  return (items ?? []).map((item) => readString(item.name));
}

/** A descricao vem em HTML; o motor de regras so precisa do texto. */
function stripHtml(value: string): string {
  return collapseSpaces(value.replace(/<[^>]*>/g, ' '));
}

function readId(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

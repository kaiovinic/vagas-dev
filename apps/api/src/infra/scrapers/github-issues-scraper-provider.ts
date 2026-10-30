import { Inject, Injectable, Optional } from '@nestjs/common';

import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import { HTTP_CLIENT, type IHttpClient } from '@/domain/providers/http-client';
import { BaseScraperProvider } from '@/infra/scrapers/support/base-scraper-provider';
import {
  collapseSpaces,
  looksLikeJobMetadata,
  dedupeByUrl,
  parseDate,
  uniqueStrings,
  workModelFromText,
} from '@/infra/scrapers/support/scraper-helpers';

const GITHUB_API_URL = 'https://api.github.com';
const ISSUES_PER_PAGE = 50;
const MODALITY_PATTERN = /^\s*\[([^\]]+)\]\s*/;

/**
 * Separadores entre as partes do titulo: os tracos e o arroba da convencao
 * `[Modalidade] Cargo - Empresa`, a barra vertical usada para anexar
 * informacao extra, e ` na `, a variacao corrente nas issues ("... Full Stack
 * na Google").
 */
const TITLE_SEPARATORS = /\s+[-–—@|]\s+|\s+na\s+/;

/**
 * Trecho que descreve a vaga, nao a empresa. Quem publica costuma anexar
 * jornada ou faixa salarial depois do nome da empresa — e era isso que vinha
 * parar no campo `company`, porque o parser pegava sempre o ULTIMO separador.
 */

export const GITHUB_VACANCY_REPOSITORIES: readonly string[] = [
  'frontendbr/vagas',
  'react-brasil/vagas',
  'backend-br/vagas',
];

interface GithubIssue {
  readonly title?: unknown;
  readonly html_url?: unknown;
  readonly created_at?: unknown;
  readonly body?: unknown;
  readonly state?: unknown;
  readonly pull_request?: unknown;
  readonly user?: { readonly login?: unknown } | null;
  readonly labels?: readonly { readonly name?: unknown }[];
}

/**
 * Coletor dos repositorios de vagas do GitHub. O titulo das issues segue a
 * convencao `[Modalidade] Cargo - Empresa`, usada aqui para separar cargo,
 * empresa e modalidade.
 */
@Injectable()
export class GithubIssuesScraperProvider extends BaseScraperProvider {
  readonly source = 'github';
  readonly label = 'GitHub (repos de vagas)';

  constructor(
    @Inject(HTTP_CLIENT) private readonly http: IHttpClient,
    @Optional() private readonly repositories: readonly string[] = GITHUB_VACANCY_REPOSITORIES,
  ) {
    super();
  }

  protected async collect(): Promise<RawJobProps[]> {
    const pages = await Promise.all(
      this.repositories.map((repository) => this.fetchRepository(repository)),
    );

    return dedupeByUrl(pages.flat());
  }

  private async fetchRepository(repository: string): Promise<RawJobProps[]> {
    const url =
      `${GITHUB_API_URL}/repos/${repository}/issues` +
      `?state=open&sort=created&direction=desc&per_page=${ISSUES_PER_PAGE}`;

    const { body } = await this.http.get<unknown>(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'DevRadar',
      },
    });

    if (!Array.isArray(body)) {
      return [];
    }

    return (body as GithubIssue[]).flatMap((issue) => this.toRawJob(issue));
  }

  private toRawJob(issue: GithubIssue): RawJobProps[] {
    if (issue.pull_request) {
      return [];
    }

    const rawTitle = readString(issue.title);
    const url = readString(issue.html_url);
    const publishedAt = parseDate(issue.created_at);

    if (rawTitle.length === 0 || url.length === 0 || !publishedAt) {
      return [];
    }

    const author = readString(issue.user?.login);
    const { modality, title, company } = parseIssueTitle(rawTitle, author);

    if (company.length === 0) {
      return [];
    }

    const labels = uniqueStrings((issue.labels ?? []).map((label) => readString(label.name)));

    return [
      {
        title,
        company,
        source: this.source,
        url,
        publishedAt,
        publishedAtSource: 'SOURCE',
        description: readString(issue.body),
        location: modality,
        workModel: workModelFromText([modality, ...labels].join(' ')),
        recruiterName: author,
        tags: labels,
      },
    ];
  }
}

interface ParsedIssueTitle {
  readonly modality: string;
  readonly title: string;
  readonly company: string;
}

/**
 * Quebra `[Modalidade] Cargo - Empresa` nas tres partes.
 *
 * O titulo e dividido em segmentos por todos os separadores de uma vez, em vez
 * de cortar no ultimo: na pratica as issues encadeiam mais de dois trechos
 * ("Cargo na Empresa — 4 dias / 32h", "Cargo — Area na Empresa | jornada"), e
 * cortar no ultimo separador gravava a jornada como nome da empresa.
 *
 * O cargo e sempre o primeiro segmento. A empresa e o ultimo que nao parece
 * metadado; nao sobrando nenhum, usa-se o autor da issue, que e quem publicou
 * a vaga.
 */
function parseIssueTitle(rawTitle: string, author: string): ParsedIssueTitle {
  const modalityMatch = MODALITY_PATTERN.exec(rawTitle);
  const modality = collapseSpaces(modalityMatch?.[1] ?? '');
  const withoutModality = collapseSpaces(rawTitle.replace(MODALITY_PATTERN, ''));

  const segments = withoutModality
    .split(TITLE_SEPARATORS)
    .map((segment) => collapseSpaces(segment))
    .filter((segment) => segment.length > 0);

  const [title, ...rest] = segments;

  if (title === undefined || title.length === 0) {
    return { modality, title: withoutModality, company: author };
  }

  const company = [...rest].reverse().find((segment) => !looksLikeJobMetadata(segment));

  return { modality, title, company: company ?? author };
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

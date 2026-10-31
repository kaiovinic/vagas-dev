import { Inject, Injectable, Optional } from '@nestjs/common';

import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import type { JobWorkModel } from '@/domain/entities/job';
import { HTTP_CLIENT, type IHttpClient } from '@/domain/providers/http-client';
import type { IJobClosureProvider } from '@/domain/providers/job-closure-provider';
import { BaseScraperProvider } from '@/infra/scrapers/support/base-scraper-provider';
import {
  collapseSpaces,
  looksLikeJobMetadata,
  dedupeByUrl,
  parseDate,
  removeHtmlTags,
  uniqueStrings,
  workModelFromText,
} from '@/infra/scrapers/support/scraper-helpers';

const GITHUB_API_URL = 'https://api.github.com';

const GITHUB_HEADERS: Readonly<Record<string, string>> = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'DevRadar',
};
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

/**
 * Issues fechadas consultadas por repositorio.
 *
 * Ordenadas pela ultima alteracao, nao pela criacao: interessa o que fechou
 * agora, e vaga fora da janela de 72h ja saiu do feed por idade. Vinte cobrem
 * com folga o que fecha entre duas capturas, que distam duas horas.
 */
const CLOSED_ISSUES_PER_PAGE = 20;

/**
 * Rotulos que descrevem a ISSUE, nao a vaga.
 *
 * Entram na mesma lista de labels que as tecnologias e iam direto para as tags
 * da vaga, aparecendo no painel e nas contagens da aba Mercado como se fossem
 * stack. "Stale" e do bot que marca issue parada; "verificada" e
 * "formato-sugerido" sao controle de qualidade dos mantenedores.
 */
const HOUSEKEEPING_LABELS: readonly string[] = [
  'stale',
  'verificada',
  'formato-sugerido',
  'formato sugerido',
  'duplicate',
  'duplicada',
  'invalid',
  'question',
  'documentation',
  'help wanted',
  'good first issue',
  'wontfix',
  'enhancement',
  'bug',
];

/**
 * Emoji e simbolos no inicio do rotulo.
 *
 * O react-brasil prefixa as labels com icone ("🏢 Remoto", "⚖️ PJ", "👨
 * Pleno"), e os outros dois repositorios escrevem o mesmo termo sem icone. Sem
 * limpar, "Remoto" e "🏢 Remoto" viram duas tags diferentes e a aba Mercado
 * conta a mesma coisa duas vezes.
 */
const LABEL_DECORATION = /^[^\p{L}\p{N}]+/u;

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
export class GithubIssuesScraperProvider
  extends BaseScraperProvider
  implements IJobClosureProvider
{
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

    const { body } = await this.http.get<unknown>(url, { headers: GITHUB_HEADERS });

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

    const labels = readLabels(issue);

    return [
      {
        title,
        company,
        source: this.source,
        url,
        publishedAt,
        publishedAtSource: 'SOURCE',
        description: removeHtmlTags(readString(issue.body)),
        location: modality,
        workModel: resolveWorkModel(modality, labels),
        recruiterName: author,
        tags: labels,
      },
    ];
  }

  /**
   * Urls das vagas cujas issues foram fechadas.
   *
   * Uma requisicao por repositorio, com `state=closed`. Falha de um
   * repositorio nao esconde os encerramentos dos outros, e nenhuma propaga
   * excecao: no pior caso o ciclo nao encerra nada e tenta de novo em duas
   * horas.
   */
  async findClosedJobUrls(): Promise<readonly string[]> {
    const perRepository = await Promise.all(
      this.repositories.map((repository) => this.fetchClosedUrls(repository)),
    );

    return [...new Set(perRepository.flat())];
  }

  private async fetchClosedUrls(repository: string): Promise<string[]> {
    const url =
      `${GITHUB_API_URL}/repos/${repository}/issues` +
      `?state=closed&sort=updated&direction=desc&per_page=${CLOSED_ISSUES_PER_PAGE}`;

    try {
      const { body } = await this.http.get<unknown>(url, { headers: GITHUB_HEADERS });

      if (!Array.isArray(body)) {
        return [];
      }

      return (body as GithubIssue[])
        .filter((issue) => !issue.pull_request)
        .map((issue) => readString(issue.html_url))
        .filter((issueUrl) => issueUrl.length > 0);
    } catch (error: unknown) {
      this.logger.warn(
        `Issues fechadas de ${repository}: ${error instanceof Error ? error.message : error}`,
      );

      return [];
    }
  }
}

/**
 * Modalidade, com o colchete do titulo valendo mais que os rotulos.
 *
 * Os dois eram juntados num texto so, e `workModelFromText` procura "remoto"
 * antes de "hibrido" — entao uma issue com `[Híbrido/Curitiba]` no titulo e as
 * labels "Remoto" e "Híbrido" marcadas (o publicador marca as duas quando
 * aceita negociar) era gravada como REMOTA. Medido em 31/10/2026 nas issues do
 * frontendbr: tres vagas hibridas de Curitiba entravam como remotas, e vaga
 * remota salta a regra de localidade inteira.
 *
 * O colchete e o que o publicador escreveu para AQUELA vaga; o rotulo e
 * classificacao do repositorio e vale como segunda opiniao.
 */
function resolveWorkModel(modality: string, labels: readonly string[]): JobWorkModel {
  const fromTitle = workModelFromText(modality);

  return fromTitle === 'UNKNOWN' ? workModelFromText(labels.join(' ')) : fromTitle;
}

function readLabels(issue: GithubIssue): string[] {
  const names = (issue.labels ?? []).map((label) =>
    collapseSpaces(readString(label.name).replace(LABEL_DECORATION, '')),
  );

  return uniqueStrings(names.filter((name) => !isHousekeeping(name)));
}

function isHousekeeping(label: string): boolean {
  return HOUSEKEEPING_LABELS.includes(label.toLowerCase());
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

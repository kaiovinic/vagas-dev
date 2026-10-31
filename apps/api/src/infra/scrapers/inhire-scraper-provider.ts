import { Inject, Injectable, Optional } from '@nestjs/common';

import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import type { JobWorkModel } from '@/domain/entities/job';
import { HTTP_CLIENT, type IHttpClient } from '@/domain/providers/http-client';
import { normalizeForMatching } from '@/domain/value-objects/text-normalizer';
import { BaseScraperProvider } from '@/infra/scrapers/support/base-scraper-provider';
import { InhireTenantDiscovery } from '@/infra/scrapers/support/inhire-tenant-discovery';
import { mergeTenants, TENANT_SLUG } from '@/infra/scrapers/support/inhire-tenants';
import {
  collapseSpaces,
  createPacer,
  dedupeByUrl,
  htmlToText,
  parseDate,
} from '@/infra/scrapers/support/scraper-helpers';

/**
 * A InHire anuncia cada cliente num subdominio proprio
 * (`sympla.inhire.app`), mas a API publica e UMA so: o cliente viaja no
 * cabecalho `X-Tenant`, nao no host. Entao um unico endpoint atende todos os
 * tenants, e o custo de acompanhar mais um e uma requisicao a mais.
 */
const INHIRE_API_URL = 'https://api.inhire.app/job-posts/public/pages';
const INHIRE_CLIENT_HEADER = 'web-inhire';
const PUBLISHED = 'published';

export const INHIRE_TENANTS_ENV_VAR = 'INHIRE_TENANTS';

/**
 * Tenants semente: empresas de tecnologia que usam a InHire no Brasil.
 *
 * Todos os 17 foram verificados contra a API em 31/10/2026 — os 17 responderam
 * 200, com 410 vagas somadas. Quem quiser outra lista define `INHIRE_TENANTS`
 * sem mexer no codigo.
 */
export const INHIRE_DEFAULT_TENANTS: readonly string[] = [
  'tqi',
  'atlastechnol',
  'clinicaexperts',
  'objective',
  'sympla',
  'db1',
  'zappts',
  'lyncas',
  'bixtecnologia',
  'programmers',
  'jump',
  'orizon',
  'dock',
  'rentbrella',
  'edge',
  'ninecon',
  'mambape',
];

/**
 * Intervalo entre duas requisicoes, de lista ou de detalhe.
 *
 * O mesmo raciocinio do coletor do LinkedIn: endpoint publico, sem conta a
 * perder, o que se protege e o IP da VPS — compartilhado com outro projeto.
 */
export const INHIRE_REQUEST_DELAY_IN_MS = 1_500;

/**
 * Teto de detalhes por ciclo.
 *
 * Com os 17 tenants semente o recorte por cargo devolve 69 vagas, entao o teto
 * nao morde hoje; ele existe para que acrescentar tenants a variavel de
 * ambiente nunca transforme um ciclo numa rajada de centenas de requisicoes.
 */
export const INHIRE_MAX_DETAILS_PER_CYCLE = 80;

/**
 * Cargos que valem uma requisicao de detalhe.
 *
 * Isto NAO e filtro de dominio, e a busca que falta: a API da InHire nao aceita
 * termo de pesquisa, devolve o quadro inteiro da empresa — comercial, logistica,
 * juridico — e e a unica fonte do radar em que a data de publicacao so existe no
 * detalhe. Sem recorte, cada ciclo pediria o detalhe das 410 vagas dos tenants
 * semente para achar as poucas de desenvolvimento.
 *
 * Por isso a lista e deliberadamente mais larga que a regra de stack: ela diz
 * apenas "isto e um cargo de desenvolvimento", e nao se a vaga serve. Quem
 * decide continua sendo o `JobRuleEngine`, que recebe o anuncio completo —
 * inclusive o backend Java e o ADVPL que entram aqui e sao descartados la.
 */
export const INHIRE_ROLE_HINTS: readonly string[] = [
  'desenvolvedor',
  'desenvolvedora',
  'developer',
  'programador',
  'programadora',
  'engenheiro de software',
  'engenheira de software',
  'software engineer',
  'frontend',
  'front-end',
  'front end',
  'fullstack',
  'full stack',
  'full-stack',
  'react',
  'angular',
  'node',
  '.net',
  'dotnet',
  'typescript',
];

/**
 * `, BR` no fim de "Salvador, BA, BR": o pais nao acrescenta nada ao painel.
 *
 * O termo e literal, e nao "duas letras no fim": uma etiqueta sem pais
 * ("Salvador, BA") perderia justamente a UF, que e o que a regra de localidade
 * le.
 */
const COUNTRY_SUFFIX = /,\s*br$/i;

const WORK_MODELS: Readonly<Record<string, JobWorkModel>> = {
  remote: 'REMOTE',
  hybrid: 'HYBRID',
  'on-site': 'ONSITE',
  onsite: 'ONSITE',
};

interface InhireEntry {
  readonly displayName?: unknown;
  readonly jobId?: unknown;
  readonly status?: unknown;
}

interface InhireDetail {
  readonly displayName?: unknown;
  readonly status?: unknown;
  readonly workplaceType?: unknown;
  readonly location?: unknown;
  readonly locationComplement?: unknown;
  readonly description?: unknown;
  readonly publishedAt?: unknown;
  readonly createdAt?: unknown;
}

/** Vaga que passou pelo recorte de cargo e merece uma requisicao de detalhe. */
interface InhireCandidate {
  readonly tenant: string;
  readonly company: string;
  readonly jobId: string;
  readonly url: string;
}

/**
 * Coletor da InHire, o ATS de boa parte das startups de tecnologia brasileiras.
 *
 * Duas requisicoes por vaga util: a lista do tenant, que traz titulo e id, e o
 * detalhe, que traz descricao, modalidade e — so ele — a data de publicacao.
 * Como a data e obrigatoria para a janela de 72h, nao ha o que cachear: toda
 * vaga candidata exige o detalhe, e o ritmo e o que protege o IP.
 */
@Injectable()
export class InhireScraperProvider extends BaseScraperProvider {
  readonly source = 'inhire';
  readonly label = 'InHire';

  constructor(
    @Inject(HTTP_CLIENT) private readonly http: IHttpClient,
    @Optional() private readonly tenants: readonly string[] = inhireTenantsFromEnv(),
    @Optional() private readonly wait: (ms: number) => Promise<void> = sleep,
    @Optional() private readonly maxDetails: number = INHIRE_MAX_DETAILS_PER_CYCLE,
    @Optional() private readonly discovery: InhireTenantDiscovery = new InhireTenantDiscovery(),
  ) {
    super();
  }

  protected async collect(): Promise<RawJobProps[]> {
    const pace = createPacer(this.wait, INHIRE_REQUEST_DELAY_IN_MS);
    const candidates: InhireCandidate[] = [];

    // O tenant descoberto entra na MESMA fila: cada lista sua passa pelo
    // `pace`, com os 1,5s entre requisicoes. Uma lista que dobre de tamanho
    // alonga o ciclo, nunca vira rajada.
    for (const tenant of await this.resolveTenants()) {
      candidates.push(...(await this.fetchTenant(tenant, pace)));
    }

    const jobs: RawJobProps[] = [];

    for (const candidate of dedupeByUrl(candidates).slice(0, this.maxDetails)) {
      jobs.push(...(await this.fetchJob(candidate, pace)));
    }

    return jobs;
  }

  /**
   * Semente configurada mais o que o radar descobriu no proprio banco.
   *
   * A semente vem primeiro de proposito: ela e verificada, e e ela que precisa
   * caber no teto de detalhes do ciclo quando a descoberta trouxer muita gente.
   */
  private async resolveTenants(): Promise<readonly string[]> {
    const discovered = await this.discovery.discover();
    const tenants = mergeTenants(this.tenants, discovered);
    const novos = tenants.length - this.tenants.length;

    if (novos > 0) {
      this.logger.log(`${novos} tenant(s) da InHire descobertos nos anuncios ja gravados`);
    }

    return tenants;
  }

  /**
   * Um tenant renomeado responde 404 e nao pode levar os outros dezesseis
   * embora, por isso a falha morre aqui e nao no `scrape` da base.
   */
  private async fetchTenant(tenant: string, pace: Pace): Promise<InhireCandidate[]> {
    try {
      const body = await this.request<unknown>(INHIRE_API_URL, tenant, pace);

      return toCandidates(tenant, body);
    } catch (error: unknown) {
      this.logger.warn(`Vagas do tenant ${tenant}: ${describeError(error)}`);

      return [];
    }
  }

  /** Detalhe que falha (429, vaga retirada do ar) so tira aquela vaga do ciclo. */
  private async fetchJob(candidate: InhireCandidate, pace: Pace): Promise<RawJobProps[]> {
    try {
      const body = await this.request<InhireDetail>(
        `${INHIRE_API_URL}/${candidate.jobId}`,
        candidate.tenant,
        pace,
      );

      return this.toRawJob(candidate, body);
    } catch (error: unknown) {
      this.logger.warn(`Detalhe da vaga ${candidate.jobId}: ${describeError(error)}`);

      return [];
    }
  }

  private async request<TBody>(url: string, tenant: string, pace: Pace): Promise<TBody> {
    await pace();

    const { body } = await this.http.get<TBody>(url, {
      headers: {
        Accept: 'application/json',
        'X-Tenant': tenant,
        'X-Inhire-Client': INHIRE_CLIENT_HEADER,
      },
    });

    return body;
  }

  private toRawJob(candidate: InhireCandidate, detail: InhireDetail): RawJobProps[] {
    const title = collapseSpaces(readString(detail.displayName));
    const publishedAt = parseDate(readString(detail.publishedAt) || readString(detail.createdAt));

    if (title.length === 0 || !publishedAt || readString(detail.status) !== PUBLISHED) {
      return [];
    }

    const workModel = toWorkModel(readString(detail.workplaceType));

    return [
      {
        title,
        company: candidate.company,
        source: this.source,
        url: candidate.url,
        publishedAt,
        publishedAtSource: 'SOURCE',
        description: htmlToText(readString(detail.description)),
        location: resolveLocation(detail, workModel),
        workModel,
      },
    ];
  }
}

type Pace = () => Promise<void>;

/**
 * Tenants configurados, ou a lista semente.
 *
 * Recebe o ambiente como argumento para o teste nao precisar mexer no
 * `process.env` do processo inteiro.
 */
export function inhireTenantsFromEnv(
  env: Record<string, string | undefined> = process.env,
): readonly string[] {
  const configured = (env[INHIRE_TENANTS_ENV_VAR] ?? '')
    .split(',')
    .map((tenant) => tenant.trim().toLowerCase())
    .filter((tenant) => TENANT_SLUG.test(tenant));

  return configured.length > 0 ? [...new Set(configured)] : INHIRE_DEFAULT_TENANTS;
}

function toCandidates(tenant: string, body: unknown): InhireCandidate[] {
  if (body === null || typeof body !== 'object') {
    return [];
  }

  const { tenantName, jobsPage } = body as { tenantName?: unknown; jobsPage?: unknown };
  const company = readString(tenantName) || tenant;
  const entries = Array.isArray(jobsPage) ? (jobsPage as InhireEntry[]) : [];

  return entries.flatMap((entry) => toCandidate(tenant, company, entry));
}

function toCandidate(
  tenant: string,
  company: string,
  entry: InhireEntry,
): InhireCandidate[] {
  const jobId = readString(entry.jobId);
  const title = readString(entry.displayName);

  if (jobId.length === 0 || readString(entry.status) !== PUBLISHED || !isDevelopmentRole(title)) {
    return [];
  }

  // Sem o slug do titulo de proposito: a pagina responde pelo id, e um titulo
  // editado mudaria o slug e criaria uma segunda url para a mesma vaga — ou
  // seja, uma vaga duplicada, ja que a url e a chave unica no banco.
  return [{ tenant, company, jobId, url: `https://${tenant}.inhire.app/vagas/${jobId}` }];
}

function isDevelopmentRole(title: string): boolean {
  const normalized = normalizeForMatching(title);

  return INHIRE_ROLE_HINTS.some((hint) => normalized.includes(hint));
}

function toWorkModel(workplaceType: string): JobWorkModel {
  return WORK_MODELS[workplaceType.trim().toLowerCase()] ?? 'UNKNOWN';
}

/**
 * Localidade legivel.
 *
 * A fonte manda `location` em formato de etiqueta ("Salvador, BA, BR") e um
 * `locationComplement` livre com o bairro ou o escritorio. Vaga remota vem com
 * o pais sozinho, que nao diz nada: ali o rotulo util e "Remoto".
 */
function resolveLocation(detail: InhireDetail, workModel: JobWorkModel): string {
  const place = readString(detail.location).replace(COUNTRY_SUFFIX, '');
  const parts = [place, readString(detail.locationComplement)].filter(
    (part) => part.length > 0,
  );
  const joined = collapseSpaces(parts.join(' - '));

  if (joined.length > 0 && !isCountryOnly(joined)) {
    return joined;
  }

  return workModel === 'REMOTE' ? 'Remoto' : '';
}

/** `BR` sozinho: a fonte nao informou cidade nem estado. */
function isCountryOnly(location: string): boolean {
  return /^[a-z]{2}$/i.test(location);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

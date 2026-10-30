import type { JobWorkModel } from '@/domain/entities/job';
import type { JobOrigin } from '@/domain/services/job-rule-engine';

/**
 * Origem da data de publicacao de uma vaga capturada: informada pela fonte ou
 * assumida no momento da captura. Espelha o enum `PublishedAtSource` do Prisma.
 */
export const PUBLISHED_AT_SOURCES = ['SOURCE', 'CAPTURE'] as const;

export type PublishedAtSource = (typeof PUBLISHED_AT_SOURCES)[number];

/**
 * Vaga bruta devolvida por um coletor: ja normalizada no formato do DevRadar,
 * mas ainda nao validada pelo dominio nem filtrada pelo `JobRuleEngine`.
 *
 * `publishedAt` e opcional porque algumas fontes (ex.: ProgramaThor) nao publicam
 * data; nesses casos o orquestrador assume o instante da captura e marca
 * `publishedAtSource: 'CAPTURE'`.
 */
export interface RawJobProps {
  readonly title: string;
  readonly company: string;
  readonly source: string;
  readonly url: string;
  readonly publishedAt?: Date | undefined;
  readonly publishedAtSource: PublishedAtSource;
  readonly description?: string | undefined;
  readonly location?: string | undefined;
  readonly workModel?: JobWorkModel | undefined;
  readonly recruiterName?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  /**
   * De onde veio. Quem coleta e quem sabe: uma publicacao de rede social passa
   * por regras que um anuncio de portal nao precisa. O padrao e `PORTAL`.
   */
  readonly origin?: JobOrigin | undefined;
}

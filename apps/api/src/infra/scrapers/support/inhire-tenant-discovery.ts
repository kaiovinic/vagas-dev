import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import {
  INHIRE_TENANT_DISCOVERY_READER,
  type IInhireTenantDiscoveryReader,
} from '@/domain/providers/inhire-tenant-discovery-reader';
import { extractInhireTenants } from '@/infra/scrapers/support/inhire-tenants';

/**
 * Teto de textos lidos por ciclo.
 *
 * Sao duas colunas de texto por linha, uma delas a descricao inteira da vaga:
 * 500 linhas e o bastante para cobrir varias capturas de todas as fontes sem
 * carregar o banco inteiro na memoria do processo.
 */
export const INHIRE_DISCOVERY_TEXT_LIMIT = 500;

/**
 * Descobre tenants da InHire no que o radar ja gravou.
 *
 * Nao guarda cache proprio: a persistencia e o Postgres. O anuncio que citou
 * `empresa.inhire.app` continua gravado, entao o ciclo seguinte redescobre o
 * mesmo tenant de graca — e um tenant que so existia num anuncio apagado
 * deixa de ser varrido, que e o comportamento desejado.
 */
@Injectable()
export class InhireTenantDiscovery {
  private readonly logger = new Logger(InhireTenantDiscovery.name);

  constructor(
    @Optional()
    @Inject(INHIRE_TENANT_DISCOVERY_READER)
    private readonly reader?: IInhireTenantDiscoveryReader,
    @Optional() private readonly limit: number = INHIRE_DISCOVERY_TEXT_LIMIT,
  ) {}

  /** Banco fora do ar nao pode derrubar a coleta: sem leitura, sem descoberta. */
  async discover(): Promise<readonly string[]> {
    if (!this.reader) {
      return [];
    }

    try {
      const texts = await this.reader.findTextsMentioningInhire(this.limit);

      return extractInhireTenants(texts);
    } catch (error: unknown) {
      this.logger.warn(`Descoberta de tenants da InHire: ${describeError(error)}`);

      return [];
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

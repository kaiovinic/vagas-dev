import { Logger } from '@nestjs/common';

import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import type { IJobScraperProvider } from '@/domain/providers/job-scraper-provider';

/**
 * Base dos coletores. Garante o contrato do `IJobScraperProvider` (LSP): uma fonte
 * que muda de layout, bloqueia o acesso ou devolve JSON inesperado nunca propaga
 * excecao, apenas registra o erro e devolve lista vazia, preservando as demais
 * fontes no `Promise.allSettled` do orquestrador.
 */
export abstract class BaseScraperProvider implements IJobScraperProvider {
  abstract readonly source: string;
  abstract readonly label: string;

  protected readonly logger: Logger;

  protected constructor() {
    this.logger = new Logger(this.constructor.name);
  }

  async scrape(): Promise<RawJobProps[]> {
    try {
      return await this.collect();
    } catch (error: unknown) {
      this.logger.warn(`Falha ao coletar vagas: ${describeError(error)}`);

      return [];
    }
  }

  protected abstract collect(): Promise<RawJobProps[]>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

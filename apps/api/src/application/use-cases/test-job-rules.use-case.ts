import { Injectable } from '@nestjs/common';

import { Job, type JobWorkModel } from '@/domain/entities/job';
import { InvalidJobError } from '@/domain/errors/invalid-job-error';
import {
  JobRuleEngine,
  type JobRejectionReason,
  type PublicJobRules,
} from '@/domain/services/job-rule-engine';

/** Placeholder: o teste de transparencia nao exige empresa nem link reais. */
const UNKNOWN_COMPANY = 'Empresa nao informada';
const PLACEHOLDER_URL = 'https://devradar.local/teste-de-regras';
const TITLE_MAX_LENGTH = 180;

export interface TestJobRulesInput {
  /** Texto da vaga: titulo, descricao ou a publicacao colada inteira. */
  readonly text: string;
  readonly company?: string | undefined;
  readonly url?: string | undefined;
  readonly location?: string | undefined;
  readonly workModel?: JobWorkModel | undefined;
  readonly publishedAt?: Date | undefined;
}

export interface TestJobRulesOutput {
  readonly approved: boolean;
  readonly rejectionReasons: readonly JobRejectionReason[];
  readonly matchedStack: readonly string[];
  readonly matchedLocations: readonly string[];
  readonly matchedSpamTerms: readonly string[];
  readonly evaluated: {
    readonly title: string;
    readonly company: string;
    readonly location: string;
    readonly workModel: JobWorkModel;
    readonly publishedAt: Date;
    readonly url: string;
  };
}

/**
 * Aba publica de `Regras`: devolve os criterios e permite colar um texto ou link
 * para ver se ele passaria no filtro, com o motivo de cada reprovacao.
 *
 * Nao faz requisicao ao link informado — ele entra na avaliacao como texto, junto
 * com o conteudo colado.
 */
@Injectable()
export class TestJobRulesUseCase {
  constructor(private readonly ruleEngine: JobRuleEngine) {}

  getPublicRules(): PublicJobRules {
    return this.ruleEngine.getPublicRules();
  }

  execute(input: TestJobRulesInput, reference: Date = new Date()): TestJobRulesOutput {
    const text = input.text.trim();

    if (text.length === 0 && !input.url) {
      throw new InvalidJobError('informe o texto ou o link da vaga para testar as regras');
    }

    const url = input.url?.trim() ?? '';
    const job = Job.create({
      title: toTitle(text, url),
      company: input.company?.trim() ?? UNKNOWN_COMPANY,
      source: 'teste-de-regras',
      url: isHttpUrl(url) ? url : PLACEHOLDER_URL,
      publishedAt: input.publishedAt ?? reference,
      description: [text, url].filter((part) => part.length > 0).join(' '),
      location: input.location?.trim() ?? '',
      workModel: input.workModel ?? 'UNKNOWN',
    });

    const evaluation = this.ruleEngine.evaluate(job, reference);

    return {
      approved: evaluation.approved,
      rejectionReasons: evaluation.rejectionReasons,
      matchedStack: evaluation.matchedStack,
      matchedLocations: evaluation.matchedLocations,
      matchedSpamTerms: evaluation.matchedSpamTerms,
      evaluated: {
        title: job.title,
        company: job.company,
        location: job.location,
        workModel: job.workModel,
        publishedAt: job.publishedAt,
        url: job.url,
      },
    };
  }
}

/** Usa a primeira linha como titulo; sem texto, o proprio link vira o titulo. */
function toTitle(text: string, url: string): string {
  const newlineIndex = text.indexOf('\n');
  const firstLine = (newlineIndex === -1 ? text : text.slice(0, newlineIndex)).trim();
  const candidate = firstLine.length > 0 ? firstLine : url;

  return candidate.slice(0, TITLE_MAX_LENGTH);
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

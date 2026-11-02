import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';

import { ResumeGenerationFailedError } from '@/domain/errors/resume-errors';
import type {
  GeneratedResumeContent,
  IResumeGenerator,
  ResumeRequest,
} from '@/domain/providers/resume-generator';
import {
  ResumePromptBuilder,
  type ResumePrompt,
} from '@/domain/services/resume-prompt-builder';

export const RESUME_MODEL = 'claude-opus-5-5';
export const RESUME_MAX_TOKENS = 16_000;
/**
 * `effort: high` porque a tarefa e de julgamento, nao de formatacao: escolher
 * qual experiencia abre o curriculo e o trabalho inteiro. No `claude-opus-5-5`
 * o raciocinio e sempre ativo, entao `thinking` nao se passa.
 */
export const RESUME_EFFORT = 'high';
/** Geracao com raciocinio leva alguns segundos; o teto padrao do SDK e curto. */
export const RESUME_TIMEOUT_MS = 300_000;

/**
 * O contrato da saida, validado pela propria API.
 *
 * Nao e "me devolva um JSON" no meio do texto: com `output_config.format` o
 * painel nunca recebe um bloco meio escrito.
 */
export const RESUME_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    markdown: { type: 'string' },
    rationale: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['markdown', 'rationale', 'gaps'],
  additionalProperties: false,
} as const;

interface ResumeOutputPayload {
  readonly markdown: string;
  readonly rationale: readonly string[];
  readonly gaps: readonly string[];
}

/** A resposta do SDK reduzida ao que este adaptador le — e o teste dubla. */
export interface ParsedResumeMessage {
  readonly model: string;
  readonly parsed_output: ResumeOutputPayload | null;
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly cache_read_input_tokens?: number | null;
    readonly cache_creation_input_tokens?: number | null;
  };
}

/** So o metodo que este adaptador usa do SDK (ISP vale tambem para fora). */
export type ResumeMessagesClient = Pick<Anthropic['messages'], 'parse'>;

/** O cliente real. A chave sai de `ANTHROPIC_API_KEY`, lida pelo proprio SDK. */
export function createResumeMessagesClient(): ResumeMessagesClient {
  return new Anthropic({ timeout: RESUME_TIMEOUT_MS }).messages;
}

/**
 * Implementacao da porta com o SDK da Anthropic.
 *
 * Dois blocos de sistema com `cache_control`: as regras e o perfil sao
 * identicos em toda geracao, e e esse prefixo estavel que faz a segunda vaga
 * custar uma fracao da primeira. A vaga vai na mensagem do usuario, porque e a
 * unica parte que muda.
 *
 * Como nos coletores, nenhuma excecao do SDK vaza: falha de API vira
 * `ResumeGenerationFailedError`, e o caso de uso decide o que o painel ve.
 */
@Injectable()
export class AnthropicResumeGenerator implements IResumeGenerator {
  private readonly logger = new Logger(AnthropicResumeGenerator.name);

  constructor(
    private readonly messages: ResumeMessagesClient,
    private readonly promptBuilder: ResumePromptBuilder,
  ) {}

  async generate(request: ResumeRequest): Promise<GeneratedResumeContent> {
    const response = await this.ask(this.promptBuilder.build(request));
    const parsed = response.parsed_output;

    if (parsed === null) {
      throw new ResumeGenerationFailedError('A resposta do modelo nao veio no formato pedido');
    }

    return {
      markdown: parsed.markdown,
      rationale: parsed.rationale,
      gaps: parsed.gaps,
      usage: toUsage(response),
    };
  }

  private async ask(prompt: ResumePrompt): Promise<ParsedResumeMessage> {
    try {
      return await this.messages.parse({
        model: RESUME_MODEL,
        max_tokens: RESUME_MAX_TOKENS,
        output_config: {
          effort: RESUME_EFFORT,
          format: jsonSchemaOutputFormat(RESUME_OUTPUT_SCHEMA),
        },
        system: [
          { type: 'text', text: prompt.rules, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: prompt.profile, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: prompt.job }],
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  private translate(error: unknown): ResumeGenerationFailedError {
    if (error instanceof Anthropic.APIError) {
      const status = String(error.status);

      this.logger.error(`Anthropic respondeu ${status}: ${error.message}`);

      return new ResumeGenerationFailedError(`A geracao falhou na Anthropic (HTTP ${status})`);
    }

    this.logger.error(
      `Falha ao gerar curriculo: ${error instanceof Error ? error.message : String(error)}`,
    );

    return new ResumeGenerationFailedError('A geracao do curriculo falhou');
  }
}

function toUsage(response: ParsedResumeMessage): GeneratedResumeContent['usage'] {
  return {
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
  };
}

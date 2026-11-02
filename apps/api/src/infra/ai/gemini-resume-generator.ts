import { Injectable, Logger } from '@nestjs/common';
import { ApiError, GoogleGenAI, Type, type GenerateContentResponse } from '@google/genai';
import { z } from 'zod';

import { ResumeGenerationFailedError } from '@/domain/errors/resume-errors';
import type {
  GeneratedResumeContent,
  IResumeGenerator,
  ResumeRequest,
} from '@/domain/providers/resume-generator';
import { ResumePromptBuilder, type ResumePrompt } from '@/domain/services/resume-prompt-builder';

export const RESUME_MODEL = 'gemini-2.0-flash';
export const RESUME_MAX_TOKENS = 8_192;

/**
 * O contrato da saida, validado pela propria API.
 *
 * Nao e "me devolva um JSON" no meio do texto: com `responseMimeType` e o
 * schema, o painel nunca recebe um bloco meio escrito.
 */
export const RESUME_OUTPUT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    markdown: { type: Type.STRING },
    rationale: { type: Type.ARRAY, items: { type: Type.STRING } },
    gaps: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['markdown', 'rationale', 'gaps'],
  propertyOrdering: ['markdown', 'rationale', 'gaps'],
};

/** Segunda linha de defesa: o schema a API garante, o formato quem le confere. */
const resumePayloadSchema = z.object({
  markdown: z.string().min(1),
  rationale: z.array(z.string()),
  gaps: z.array(z.string()),
});

/** So o metodo que este adaptador usa do SDK (ISP vale tambem para fora). */
export type ResumeModelsClient = Pick<GoogleGenAI['models'], 'generateContent'>;

/** O cliente real. A chave sai de `GEMINI_API_KEY`. */
export function createResumeModelsClient(): ResumeModelsClient {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' }).models;
}

/**
 * Implementacao da porta com o SDK do Gemini.
 *
 * As regras e o perfil vao na instrucao de sistema, e a vaga na mensagem: alem
 * de ser a divisao natural, mantem identico o prefixo de toda geracao, que e o
 * que o cache implicito do Gemini procura para cobrar menos.
 *
 * Como nos coletores, nenhuma excecao do SDK vaza: falha de API vira
 * `ResumeGenerationFailedError`, e o caso de uso decide o que o painel ve.
 */
@Injectable()
export class GeminiResumeGenerator implements IResumeGenerator {
  private readonly logger = new Logger(GeminiResumeGenerator.name);

  constructor(
    private readonly models: ResumeModelsClient,
    private readonly promptBuilder: ResumePromptBuilder,
  ) {}

  async generate(request: ResumeRequest): Promise<GeneratedResumeContent> {
    const response = await this.ask(this.promptBuilder.build(request));
    const parsed = resumePayloadSchema.safeParse(toJson(response.text));

    if (!parsed.success) {
      throw new ResumeGenerationFailedError('A resposta do modelo nao veio no formato pedido');
    }

    return {
      markdown: parsed.data.markdown,
      rationale: parsed.data.rationale,
      gaps: parsed.data.gaps,
      usage: toUsage(response),
    };
  }

  private async ask(prompt: ResumePrompt): Promise<GenerateContentResponse> {
    try {
      return await this.models.generateContent({
        model: RESUME_MODEL,
        contents: prompt.job,
        config: {
          systemInstruction: `${prompt.rules}\n\n${prompt.profile}`,
          responseMimeType: 'application/json',
          responseSchema: RESUME_OUTPUT_SCHEMA,
          maxOutputTokens: RESUME_MAX_TOKENS,
        },
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  private translate(error: unknown): ResumeGenerationFailedError {
    if (error instanceof ApiError) {
      const status = String(error.status);

      this.logger.error(`Gemini respondeu ${status}: ${error.message}`);

      return new ResumeGenerationFailedError(`A geracao falhou no Gemini (HTTP ${status})`);
    }

    this.logger.error(
      `Falha ao gerar curriculo: ${error instanceof Error ? error.message : String(error)}`,
    );

    return new ResumeGenerationFailedError('A geracao do curriculo falhou');
  }
}

/** Texto vazio ou JSON quebrado viram `null`, e `null` nao passa no schema. */
function toJson(text: string | undefined): unknown {
  if (text === undefined || text.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toUsage(response: GenerateContentResponse): GeneratedResumeContent['usage'] {
  const usage = response.usageMetadata;

  return {
    model: response.modelVersion ?? RESUME_MODEL,
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
    // O cache do Gemini e implicito: ele conta o que foi servido, mas nao cobra
    // escrita, entao nao ha o que registrar do outro lado.
    cacheReadTokens: usage?.cachedContentTokenCount ?? 0,
    cacheCreationTokens: 0,
  };
}

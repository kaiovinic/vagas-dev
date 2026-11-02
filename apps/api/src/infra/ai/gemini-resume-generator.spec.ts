import { ApiError } from '@google/genai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ProfileNotReadyForResumeError,
  ResumeGenerationFailedError,
} from '@/domain/errors/resume-errors';
import { ResumePromptBuilder } from '@/domain/services/resume-prompt-builder';
import {
  GeminiResumeGenerator,
  RESUME_MAX_TOKENS,
  RESUME_MODEL,
  type ResumeModelsClient,
} from '@/infra/ai/gemini-resume-generator';
import { makeProfile, makeResumeTargetJob } from '../../../test/factories/make-candidate-profile';

const PAYLOAD = {
  markdown: '# Kaio Vinicius',
  rationale: ['Abri pela Acme porque a vaga pede React.'],
  gaps: ['Sem Angular.'],
};

function reply(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    text: JSON.stringify(PAYLOAD),
    modelVersion: 'gemini-2.0-flash',
    usageMetadata: {
      promptTokenCount: 3_000,
      candidatesTokenCount: 1_800,
      cachedContentTokenCount: 2_600,
    },
    ...overrides,
  };
}

describe('GeminiResumeGenerator', () => {
  let generateContent: ReturnType<typeof vi.fn>;
  let generator: GeminiResumeGenerator;

  beforeEach(() => {
    generateContent = vi.fn().mockResolvedValue(reply());
    generator = new GeminiResumeGenerator(
      { generateContent } as unknown as ResumeModelsClient,
      new ResumePromptBuilder(),
    );
  });

  function generate(): Promise<unknown> {
    return generator.generate({ profile: makeProfile(), job: makeResumeTargetJob() });
  }

  function bodyOf(): Record<string, unknown> {
    return generateContent.mock.calls[0]?.[0] as Record<string, unknown>;
  }

  function configOf(): Record<string, unknown> {
    return bodyOf().config as Record<string, unknown>;
  }

  it('pede ao modelo configurado, com o teto de saida do desenho', async () => {
    await generate();

    expect(bodyOf().model).toBe(RESUME_MODEL);
    expect(configOf().maxOutputTokens).toBe(RESUME_MAX_TOKENS);
  });

  it('pede JSON com schema, em vez de pedir JSON no texto', async () => {
    await generate();

    const config = configOf();
    const schema = config.responseSchema as { required: string[] };

    expect(config.responseMimeType).toBe('application/json');
    expect(schema.required).toEqual(['markdown', 'rationale', 'gaps']);
  });

  it('deixa regras e perfil na instrucao de sistema, nesta ordem', async () => {
    await generate();

    const instruction = String(configOf().systemInstruction);

    expect(instruction).toContain('SOMENTE fatos presentes no perfil');
    expect(instruction).toContain('# Perfil do candidato');
    expect(instruction.indexOf('SOMENTE fatos')).toBeLessThan(
      instruction.indexOf('# Perfil do candidato'),
    );
  });

  /** O prefixo estavel e o que o cache implicito procura: a vaga fica fora dele. */
  it('manda so a vaga no conteudo, a unica parte volatil', async () => {
    await generate();

    const contents = String(bodyOf().contents);

    expect(contents).toContain('Titulo: Desenvolvedor Frontend React');
    expect(contents).not.toContain('# Perfil do candidato');
  });

  it('devolve o curriculo com o consumo, inclusive o que veio do cache', async () => {
    const content = await generator.generate({
      profile: makeProfile(),
      job: makeResumeTargetJob(),
    });

    expect(content).toEqual({
      ...PAYLOAD,
      usage: {
        model: 'gemini-2.0-flash',
        inputTokens: 3_000,
        outputTokens: 1_800,
        cacheReadTokens: 2_600,
        cacheCreationTokens: 0,
      },
    });
  });

  it('resposta sem consumo informado nao vira NaN no historico', async () => {
    generateContent.mockResolvedValue(reply({ usageMetadata: undefined, modelVersion: undefined }));

    const content = await generator.generate({
      profile: makeProfile(),
      job: makeResumeTargetJob(),
    });

    expect(content.usage).toEqual({
      model: RESUME_MODEL,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
  });

  it.each([
    ['vazia', ''],
    ['sem texto', undefined],
    ['com JSON quebrado', '{"markdown":'],
    ['com campo faltando', '{"markdown":"# Kaio"}'],
    ['com markdown vazio', '{"markdown":"","rationale":[],"gaps":[]}'],
  ])('recusa resposta %s', async (_caso, text) => {
    generateContent.mockResolvedValue(reply({ text }));

    await expect(generate()).rejects.toThrow(ResumeGenerationFailedError);
  });

  it('traduz o erro da API em erro de dominio, sem vazar ApiError', async () => {
    generateContent.mockRejectedValue(
      new ApiError({ message: 'quota esgotada', status: 429 }),
    );

    await expect(generate()).rejects.toThrow(ResumeGenerationFailedError);
    await expect(generate()).rejects.toThrow('HTTP 429');
  });

  it('traduz tambem a falha que nao e da API', async () => {
    generateContent.mockRejectedValue('ECONNRESET cru');

    await expect(generate()).rejects.toThrow(ResumeGenerationFailedError);
  });

  it('nao chama a API quando o perfil ainda nao serve', async () => {
    await expect(
      generator.generate({ profile: makeProfile({ skills: [] }), job: makeResumeTargetJob() }),
    ).rejects.toThrow(ProfileNotReadyForResumeError);
    expect(generateContent).not.toHaveBeenCalled();
  });
});

import { ApiError } from '@google/genai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ProfileNotReadyForResumeError,
  ResumeGenerationFailedError,
} from '@/domain/errors/resume-errors';
import { ResumePromptBuilder } from '@/domain/services/resume-prompt-builder';
import {
  GeminiResumeGenerator,
  RESUME_MAX_TOKENS,
  DEFAULT_RESUME_MODEL,
  resumeModel,
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
    modelVersion: 'gemini-3.8-flash',
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

  afterEach(() => {
    vi.unstubAllEnvs();
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

    expect(bodyOf().model).toBe(resumeModel());
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
        model: 'gemini-3.8-flash',
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
      model: resumeModel(),
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

  it('pede o modelo que o ambiente escolheu, quando ha um', async () => {
    vi.stubEnv('GEMINI_MODEL', 'gemini-3.6-flash');

    await generate();

    expect(bodyOf().model).toBe('gemini-3.6-flash');
  });

  it('nao chama a API quando o perfil ainda nao serve', async () => {
    await expect(
      generator.generate({ profile: makeProfile({ skills: [] }), job: makeResumeTargetJob() }),
    ).rejects.toThrow(ProfileNotReadyForResumeError);
    expect(generateContent).not.toHaveBeenCalled();
  });
});

describe('resumeModel', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('usa o padrao do codigo quando o ambiente nao diz nada', () => {
    vi.stubEnv('GEMINI_MODEL', undefined);

    expect(resumeModel()).toBe(DEFAULT_RESUME_MODEL);
  });

  it('troca de modelo sem deploy: o ambiente tem a palavra final', () => {
    vi.stubEnv('GEMINI_MODEL', 'gemini-3.5-flash-lite');

    expect(resumeModel()).toBe('gemini-3.5-flash-lite');
  });

  /** Variavel declarada e vazia no `.env` nao vale como escolha. */
  it('ignora valor em branco e volta ao padrao', () => {
    vi.stubEnv('GEMINI_MODEL', '   ');

    expect(resumeModel()).toBe(DEFAULT_RESUME_MODEL);
  });
});

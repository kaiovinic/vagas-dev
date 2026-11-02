import Anthropic from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileNotReadyForResumeError, ResumeGenerationFailedError } from '@/domain/errors/resume-errors';
import { ResumePromptBuilder } from '@/domain/services/resume-prompt-builder';
import {
  AnthropicResumeGenerator,
  RESUME_EFFORT,
  RESUME_MAX_TOKENS,
  RESUME_MODEL,
  type ResumeMessagesClient,
} from '@/infra/ai/anthropic-resume-generator';
import { makeProfile, makeResumeTargetJob } from '../../../test/factories/make-candidate-profile';

interface SystemBlock {
  readonly text: string;
  readonly cache_control?: { readonly type: string };
}

function reply(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: 'claude-opus-5-5',
    parsed_output: {
      markdown: '# Kaio Vinicius',
      rationale: ['Abri pela Acme porque a vaga pede React.'],
      gaps: ['Sem Angular.'],
    },
    usage: {
      input_tokens: 300,
      output_tokens: 1_800,
      cache_read_input_tokens: 2_600,
      cache_creation_input_tokens: 0,
    },
    ...overrides,
  };
}

describe('AnthropicResumeGenerator', () => {
  let parse: ReturnType<typeof vi.fn>;
  let generator: AnthropicResumeGenerator;

  beforeEach(() => {
    parse = vi.fn().mockResolvedValue(reply());
    generator = new AnthropicResumeGenerator(
      { parse } as unknown as ResumeMessagesClient,
      new ResumePromptBuilder(),
    );
  });

  function generate(): Promise<unknown> {
    return generator.generate({ profile: makeProfile(), job: makeResumeTargetJob() });
  }

  function bodyOf(): Record<string, unknown> {
    return parse.mock.calls[0]?.[0] as Record<string, unknown>;
  }

  it('pede ao modelo configurado, com o teto e a profundidade do desenho', async () => {
    await generate();

    const body = bodyOf();

    expect(body.model).toBe(RESUME_MODEL);
    expect(body.max_tokens).toBe(RESUME_MAX_TOKENS);
    expect(body.output_config).toMatchObject({ effort: RESUME_EFFORT });
  });

  it('manda o schema da saida, em vez de pedir JSON no texto', async () => {
    await generate();

    const { format } = bodyOf().output_config as { format: { type: string; schema: unknown } };

    expect(format.type).toBe('json_schema');
    expect(format.schema).toMatchObject({ required: ['markdown', 'rationale', 'gaps'] });
  });

  it('marca os dois blocos estaveis para cache, nesta ordem', async () => {
    await generate();

    const system = bodyOf().system as SystemBlock[];

    expect(system).toHaveLength(2);
    expect(system[0]?.text).toContain('SOMENTE fatos presentes no perfil');
    expect(system[1]?.text).toContain('# Perfil do candidato');
    expect(system[0]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(system[1]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('deixa a vaga na mensagem do usuario, a unica parte volatil', async () => {
    await generate();

    const messages = bodyOf().messages as Array<{ role: string; content: string }>;

    expect(messages).toEqual([
      { role: 'user', content: expect.stringContaining('Titulo: Desenvolvedor Frontend React') },
    ]);
    expect(messages[0]?.content).not.toContain('# Perfil do candidato');
  });

  it('devolve o curriculo com o consumo, inclusive o que veio do cache', async () => {
    const content = await generator.generate({
      profile: makeProfile(),
      job: makeResumeTargetJob(),
    });

    expect(content).toEqual({
      markdown: '# Kaio Vinicius',
      rationale: ['Abri pela Acme porque a vaga pede React.'],
      gaps: ['Sem Angular.'],
      usage: {
        model: 'claude-opus-5-5',
        inputTokens: 300,
        outputTokens: 1_800,
        cacheReadTokens: 2_600,
        cacheCreationTokens: 0,
      },
    });
  });

  it('trata consumo de cache ausente como zero, e nao como indefinido', async () => {
    parse.mockResolvedValue(reply({ usage: { input_tokens: 3_000, output_tokens: 1_200 } }));

    const content = await generator.generate({
      profile: makeProfile(),
      job: makeResumeTargetJob(),
    });

    expect(content.usage.cacheReadTokens).toBe(0);
    expect(content.usage.cacheCreationTokens).toBe(0);
  });

  it('recusa resposta fora do formato pedido', async () => {
    parse.mockResolvedValue(reply({ parsed_output: null }));

    await expect(generate()).rejects.toThrow(ResumeGenerationFailedError);
  });

  it('traduz o erro da API em erro de dominio, sem vazar APIError', async () => {
    parse.mockRejectedValue(new Anthropic.APIError(429, undefined, 'limite estourado', undefined));

    await expect(generate()).rejects.toThrow(ResumeGenerationFailedError);
    await expect(generate()).rejects.toThrow('HTTP 429');
  });

  it('traduz tambem a falha que nao e da API', async () => {
    parse.mockRejectedValue('ECONNRESET cru');

    await expect(generate()).rejects.toThrow(ResumeGenerationFailedError);
  });

  it('nao chama a API quando o perfil ainda nao serve', async () => {
    await expect(
      generator.generate({ profile: makeProfile({ skills: [] }), job: makeResumeTargetJob() }),
    ).rejects.toThrow(ProfileNotReadyForResumeError);
    expect(parse).not.toHaveBeenCalled();
  });
});

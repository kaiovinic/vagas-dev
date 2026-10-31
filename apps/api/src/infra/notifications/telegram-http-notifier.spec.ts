import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';

import type { JobAlert, WeeklyDigest } from '@/domain/providers/telegram-notifier';
import {
  TELEGRAM_MIN_INTERVAL_MS,
  TelegramHttpNotifier,
  buildDigestMessage,
  buildMessage,
} from '@/infra/notifications/telegram-http-notifier';
import { FakeHttpClient, failingHttpClient } from '../../../test/factories/fake-http-client';
import { makeJob } from '../../../test/factories/make-job';

const CONFIG = { botToken: '123:ABC', chatId: '-100500' };

/** Sem intervalo: os testes nao esperam 1,1s por mensagem. */
function notifier(http: FakeHttpClient): TelegramHttpNotifier {
  return new TelegramHttpNotifier(http, CONFIG, 0);
}

function alert(overrides: Partial<JobAlert> = {}): JobAlert {
  return {
    job: makeJob(),
    tags: [],
    scope: 'UNKNOWN',
    ...overrides,
  };
}

function textOf(http: FakeHttpClient, index = 0): string {
  return new URL(http.requestedUrls[index] ?? '').searchParams.get('text') ?? '';
}

function digest(overrides: Partial<WeeklyDigest> = {}): WeeklyDigest {
  return {
    periodStart: new Date('2026-10-19T12:00:00.000Z'),
    periodEnd: new Date('2026-10-26T12:00:00.000Z'),
    openJobs: 88,
    newInPeriod: 134,
    remoteJobs: 74,
    localJobs: 14,
    topTechnologies: [
      { label: 'React', total: 61 },
      { label: 'Node.js', total: 44 },
    ],
    ...overrides,
  };
}

describe('TelegramHttpNotifier', () => {
  describe('envio', () => {
    it('envia a vaga para o chat configurado', async () => {
      const http = new FakeHttpClient(() => ({ ok: true }));

      await notifier(http).notifyNewJob(alert());

      const url = new URL(http.requestedUrls[0] ?? '');

      expect(url.origin + url.pathname).toBe('https://api.telegram.org/bot123:ABC/sendMessage');
      expect(url.searchParams.get('chat_id')).toBe('-100500');
      expect(url.searchParams.get('parse_mode')).toBe('HTML');
    });

    it.each([
      ['sem token', { botToken: '', chatId: '-100' }],
      ['sem chat', { botToken: '123:ABC', chatId: '' }],
    ])('nao chama a api %s configurado', async (_label, config) => {
      const http = new FakeHttpClient(() => ({ ok: true }));

      await new TelegramHttpNotifier(http, config, 0).notifyNewJob(alert());

      expect(http.requestedUrls).toEqual([]);
    });

    it('nao propaga falha da api do Telegram', async () => {
      const telegram = new TelegramHttpNotifier(failingHttpClient('429'), CONFIG, 0);

      await expect(telegram.notifyNewJob(alert())).resolves.toBeUndefined();
    });

    it('nao propaga falha que nao e Error', async () => {
      const http = new FakeHttpClient(() => {
        throw 'ECONNRESET cru';
      });

      await expect(notifier(http).notifyNewJob(alert())).resolves.toBeUndefined();
    });

    it('le token e chat das variaveis de ambiente por padrao', async () => {
      const previousToken = process.env.TELEGRAM_BOT_TOKEN;
      const previousChat = process.env.TELEGRAM_CHAT_ID;
      process.env.TELEGRAM_BOT_TOKEN = '999:XYZ';
      process.env.TELEGRAM_CHAT_ID = '-42';

      try {
        const http = new FakeHttpClient(() => ({ ok: true }));

        await new TelegramHttpNotifier(http, undefined, 0).notifyNewJob(alert());

        expect(http.requestedUrls[0]).toContain('/bot999:XYZ/sendMessage');
      } finally {
        process.env.TELEGRAM_BOT_TOKEN = previousToken;
        process.env.TELEGRAM_CHAT_ID = previousChat;
      }
    });

    it('vira no-op quando o ambiente nao tem bot configurado', async () => {
      const previousToken = process.env.TELEGRAM_BOT_TOKEN;
      const previousChat = process.env.TELEGRAM_CHAT_ID;
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_CHAT_ID;

      try {
        const http = new FakeHttpClient(() => ({ ok: true }));

        await new TelegramHttpNotifier(http, undefined, 0).notifyNewJob(alert());

        expect(http.requestedUrls).toEqual([]);
      } finally {
        process.env.TELEGRAM_BOT_TOKEN = previousToken;
        process.env.TELEGRAM_CHAT_ID = previousChat;
      }
    });
  });

  describe('aviso de boot', () => {
    it('anuncia que os alertas estao ativos', () => {
      const telegram = notifier(new FakeHttpClient(() => ({ ok: true })));
      const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

      try {
        telegram.onModuleInit();

        expect(log).toHaveBeenCalledWith(expect.stringContaining('-100500'));
      } finally {
        log.mockRestore();
      }
    });

    it('avisa em warn quando falta configuracao', () => {
      const telegram = new TelegramHttpNotifier(
        new FakeHttpClient(() => ({ ok: true })),
        { botToken: '', chatId: '' },
        0,
      );
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      try {
        telegram.onModuleInit();

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('TELEGRAM_BOT_TOKEN'));
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('controle de ritmo', () => {
    it('declara o intervalo compativel com o limite da Bot API', () => {
      expect(TELEGRAM_MIN_INTERVAL_MS).toBeGreaterThanOrEqual(1_000);
    });

    it('serializa os envios mesmo quando disparados em paralelo', async () => {
      const ordem: string[] = [];
      const http = new FakeHttpClient((url) => {
        ordem.push(new URL(url).searchParams.get('text')?.slice(0, 20) ?? '');

        return { ok: true };
      });
      const telegram = notifier(http);

      await Promise.all([
        telegram.notifyNewJob(alert({ job: makeJob({ title: 'Primeira vaga' }) })),
        telegram.notifyNewJob(alert({ job: makeJob({ title: 'Segunda vaga' }) })),
        telegram.notifyNewJob(alert({ job: makeJob({ title: 'Terceira vaga' }) })),
      ]);

      expect(http.requestedUrls).toHaveLength(3);
      expect(ordem[0]).toContain('Primeira');
      expect(ordem[1]).toContain('Segunda');
      expect(ordem[2]).toContain('Terceira');
    });

    it('espera o intervalo entre uma mensagem e a seguinte', async () => {
      vi.useFakeTimers();

      try {
        const http = new FakeHttpClient(() => ({ ok: true }));
        const telegram = new TelegramHttpNotifier(http, CONFIG, 1_100);

        const primeira = telegram.notifyNewJob(alert());
        const segunda = telegram.notifyNewJob(alert({ job: makeJob({ company: 'Globex' }) }));

        await vi.advanceTimersByTimeAsync(0);
        expect(http.requestedUrls).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(1_100);
        expect(http.requestedUrls).toHaveLength(2);

        // Libera tambem o intervalo que a segunda mensagem guarda apos enviar.
        await vi.advanceTimersByTimeAsync(1_100);
        await Promise.all([primeira, segunda]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('uma falha nao trava a fila das proximas', async () => {
      let chamadas = 0;
      const http = new FakeHttpClient(() => {
        chamadas += 1;

        return chamadas === 1 ? new Error('429') : { ok: true };
      });
      const telegram = notifier(http);

      await Promise.all([
        telegram.notifyNewJob(alert()),
        telegram.notifyNewJob(alert({ job: makeJob({ company: 'Globex' }) })),
      ]);

      expect(http.requestedUrls).toHaveLength(2);
    });
  });

  describe('resumo semanal', () => {
    it('envia o resumo para o chat configurado', async () => {
      const http = new FakeHttpClient(() => ({ ok: true }));

      await notifier(http).notifyWeeklyDigest(digest());

      expect(http.requestedUrls).toHaveLength(1);
      expect(textOf(http)).toContain('resumo da semana');
    });

    it('vira no-op quando nao ha bot configurado', async () => {
      const http = new FakeHttpClient(() => ({ ok: true }));

      await new TelegramHttpNotifier(http, { botToken: '', chatId: '' }, 0).notifyWeeklyDigest(
        digest(),
      );

      expect(http.requestedUrls).toEqual([]);
    });

    it('nao propaga falha da api', async () => {
      const telegram = new TelegramHttpNotifier(failingHttpClient('500'), CONFIG, 0);

      await expect(telegram.notifyWeeklyDigest(digest())).resolves.toBeUndefined();
    });

    it('entra na mesma fila dos alertas de vaga', async () => {
      const ordem: string[] = [];
      const http = new FakeHttpClient((url) => {
        ordem.push(new URL(url).searchParams.get('text')?.slice(0, 12) ?? '');

        return { ok: true };
      });
      const telegram = notifier(http);

      await Promise.all([
        telegram.notifyNewJob(alert({ job: makeJob({ title: 'Primeira vaga' }) })),
        telegram.notifyWeeklyDigest(digest()),
      ]);

      expect(ordem).toHaveLength(2);
      expect(ordem[1]).toContain('📊');
    });
  });

  describe('template do resumo', () => {
    it('traz o periodo coberto no horario de Brasilia', () => {
      expect(buildDigestMessage(digest())).toContain('19/10 a 26/10');
    });

    it('traz os quatro numeros da semana', () => {
      const message = buildDigestMessage(digest());

      expect(message).toContain('<b>88</b> vagas abertas');
      expect(message).toContain('<b>134</b> publicadas');
      expect(message).toContain('<b>74</b> remotas');
      expect(message).toContain('<b>14</b> na Bahia');
    });

    it('mostra o percentual de remotas sobre as abertas', () => {
      expect(buildDigestMessage(digest())).toContain('(84%)');
    });

    it('nao divide por zero em semana sem vaga aberta', () => {
      const message = buildDigestMessage(digest({ openJobs: 0, remoteJobs: 0 }));

      expect(message).toContain('(0%)');
      expect(message).not.toContain('NaN');
    });

    it('ranqueia as stacks com medalha', () => {
      const message = buildDigestMessage(digest());

      expect(message).toContain('🥇 React — 61');
      expect(message).toContain('🥈 Node.js — 44');
    });

    it('omite o bloco de stacks quando nao houve nenhuma', () => {
      const message = buildDigestMessage(digest({ topTechnologies: [] }));

      expect(message).not.toContain('Stacks mais pedidas');
    });

    it('escapa html do rotulo da stack', () => {
      const message = buildDigestMessage(digest({ topTechnologies: [{ label: 'C<#>', total: 1 }] }));

      expect(message).toContain('C&lt;#&gt;');
    });
  });

  describe('sendRaw', () => {
    it('envia uma mensagem avulsa para o chat', async () => {
      const http = new FakeHttpClient(() => ({ ok: true }));

      await notifier(http).sendRaw('teste do DevRadar');

      expect(textOf(http)).toBe('teste do DevRadar');
    });

    it('avisa quando falta configuracao, em vez de silenciar', async () => {
      const telegram = new TelegramHttpNotifier(
        new FakeHttpClient(() => ({ ok: true })),
        { botToken: '', chatId: '' },
        0,
      );

      await expect(telegram.sendRaw('oi')).rejects.toThrow(/TELEGRAM_BOT_TOKEN/);
    });
  });

  describe('template da mensagem', () => {
    it('traz cargo, empresa, fonte e link de candidatura', () => {
      const message = buildMessage(
        alert({ job: makeJob({ title: 'Dev React', company: 'Acme Corp', source: 'gupy' }) }),
      );

      expect(message).toContain('<b>Dev React</b>');
      expect(message).toContain('Acme Corp');
      expect(message).toContain('Gupy');
      expect(message).toContain('<a href="https://gupy.io/vagas/1">Ver vaga e se candidatar</a>');
    });

    it('lista as tags principais da stack', () => {
      const message = buildMessage(alert({ tags: ['React', 'TypeScript', 'Node.js'] }));

      expect(message).toContain('React · TypeScript · Node.js');
    });

    it('limita a cinco tags', () => {
      const message = buildMessage(
        alert({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
      );

      expect(message).toContain('a · b · c · d · e');
      expect(message).not.toContain('· f');
    });

    it('omite a linha de tags quando nao ha tag', () => {
      expect(buildMessage(alert())).not.toContain('🏷️');
    });

    it.each([
      ['REMOTE', 'Remoto'],
      ['HYBRID', 'Hibrido'],
      ['ONSITE', 'Presencial'],
      ['UNKNOWN', 'Modalidade nao informada'],
    ] as const)('mostra a modalidade %s como %s', (workModel, esperado) => {
      const message = buildMessage(alert({ job: makeJob({ workModel, location: '' }) }));

      expect(message).toContain(esperado);
    });

    it('junta modalidade e cidade quando a vaga e presencial', () => {
      const message = buildMessage(
        alert({ job: makeJob({ workModel: 'ONSITE', location: 'Salvador/BA' }) }),
      );

      expect(message).toContain('Presencial · Salvador/BA');
    });

    it('nao repete "Remoto" quando a localidade e so isso', () => {
      const message = buildMessage(
        alert({ job: makeJob({ workModel: 'REMOTE', location: 'Remoto' }) }),
      );

      expect(message).not.toContain('Remoto · Remoto');
    });

    it.each([
      ['NATIONAL', '🇧🇷 Nacional'],
      ['INTERNATIONAL', '🌎 Internacional'],
    ] as const)('marca o mercado %s', (scope, esperado) => {
      expect(buildMessage(alert({ scope }))).toContain(esperado);
    });

    it('omite o mercado quando nao foi identificado', () => {
      const message = buildMessage(alert({ scope: 'UNKNOWN' }));

      expect(message).not.toContain('Nacional');
      expect(message).not.toContain('Internacional');
    });

    it('escapa html do titulo e da empresa', () => {
      const message = buildMessage(
        alert({ job: makeJob({ title: 'Dev <script> & cia', company: 'A&B' }) }),
      );

      expect(message).toContain('Dev &lt;script&gt; &amp; cia');
      expect(message).toContain('A&amp;B');
    });

    it('trunca titulo muito longo', () => {
      const message = buildMessage(alert({ job: makeJob({ title: 'React '.repeat(40) }) }));

      expect(message).toContain('…');
      expect(message.split('\n')[0]?.length).toBeLessThan(160);
    });
  });
});

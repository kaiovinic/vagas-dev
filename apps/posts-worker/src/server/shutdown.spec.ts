import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { SHUTDOWN_SIGNALS, installShutdown } from '@/server/shutdown';

interface Scenario {
  readonly source: EventEmitter;
  readonly close: ReturnType<typeof vi.fn>;
  readonly codes: number[];
  readonly logs: string[];
}

function scenario(
  close = vi.fn(() => Promise.resolve()),
  drain?: () => Promise<boolean>,
): Scenario {
  const source = new EventEmitter();
  const codes: number[] = [];
  const logs: string[] = [];

  installShutdown(
    { close },
    {
      source,
      exit: (code) => codes.push(code),
      log: (message) => logs.push(message),
      ...(drain === undefined ? {} : { drain }),
    },
  );

  return { source, close, codes, logs };
}

/** Espera a cadeia de promessas do handler, que o `emit` dispara sem aguardar. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('installShutdown', () => {
  it.each([...SHUTDOWN_SIGNALS])('fecha o servidor com %s', async (signal) => {
    const { source, close, codes } = scenario();

    source.emit(signal);
    await settle();

    expect(close).toHaveBeenCalledTimes(1);
    expect(codes).toEqual([0]);
  });

  it('diz qual sinal chegou, para o log do container', async () => {
    const { source, logs } = scenario();

    source.emit('SIGTERM');
    await settle();

    expect(logs[0]).toContain('SIGTERM');
  });

  /** `Ctrl+C` repetido nao deve comecar um segundo fechamento. */
  it('ignora o segundo sinal enquanto o primeiro fecha', async () => {
    const { source, close, codes } = scenario();

    source.emit('SIGTERM');
    source.emit('SIGINT');
    await settle();

    expect(close).toHaveBeenCalledTimes(1);
    expect(codes).toEqual([0]);
  });

  /**
   * Sai com 1 para o orquestrador saber que o encerramento nao foi limpo — e
   * nao fica pendurado esperando um `close` que nunca termina bem.
   */
  it('sai com falha quando o fechamento da erro', async () => {
    const { source, codes, logs } = scenario(vi.fn(() => Promise.reject(new Error('porta presa'))));

    source.emit('SIGTERM');
    await settle();

    expect(codes).toEqual([1]);
    expect(logs.at(-1)).toContain('porta presa');
  });

  it('descreve falha que nao e Error', async () => {
    const { source, codes, logs } = scenario(vi.fn(() => Promise.reject('texto cru')));

    source.emit('SIGTERM');
    await settle();

    expect(codes).toEqual([1]);
    expect(logs.at(-1)).toContain('texto cru');
  });

  /**
   * A colheita primeiro, o servidor depois: fechar a porta com o Chromium
   * gravando deixaria o `harvest.json` pela metade.
   */
  it('espera a colheita antes de fechar o servidor', async () => {
    const order: string[] = [];
    const close = vi.fn(() => {
      order.push('close');

      return Promise.resolve();
    });
    const { source, codes } = scenario(close, () => {
      order.push('drain');

      return Promise.resolve(true);
    });

    source.emit('SIGTERM');
    await settle();

    expect(order).toEqual(['drain', 'close']);
    expect(codes).toEqual([0]);
  });

  /** Prazo vencido nao impede o encerramento: esperar sem fim e virar SIGKILL. */
  it('colheita que nao termina no prazo e anotada, e o encerramento segue', async () => {
    const { source, close, codes, logs } = scenario(undefined, () => Promise.resolve(false));

    source.emit('SIGTERM');
    await settle();

    expect(logs.at(-1)).toContain('nao terminou no prazo');
    expect(close).toHaveBeenCalledTimes(1);
    expect(codes).toEqual([0]);
  });

  it('falha ao encerrar a colheita nao impede o fechamento', async () => {
    const { source, close, codes, logs } = scenario(undefined, () =>
      Promise.reject(new Error('navegador travado')),
    );

    source.emit('SIGTERM');
    await settle();

    expect(logs.at(-1)).toContain('navegador travado');
    expect(close).toHaveBeenCalledTimes(1);
    expect(codes).toEqual([0]);
  });

  it('cobre os dois sinais que o docker usa', () => {
    expect([...SHUTDOWN_SIGNALS]).toEqual(['SIGTERM', 'SIGINT']);
  });

  /**
   * O caminho de producao, sem `exit` nem `log` injetados: e esta ligacao com o
   * `process.exit` que faz o container sair com codigo, e ela nao aparece em
   * nenhum dos testes acima justamente porque eles a substituem.
   */
  it('por padrao encerra o processo e registra no console', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const source = new EventEmitter();

    installShutdown({ close: () => Promise.resolve() }, { source });
    source.emit('SIGTERM');
    await settle();

    expect(exit).toHaveBeenCalledWith(0);
    expect(info).toHaveBeenCalledOnce();

    vi.restoreAllMocks();
  });
});

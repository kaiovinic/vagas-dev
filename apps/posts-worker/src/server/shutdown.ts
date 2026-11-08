/**
 * Encerramento limpo do servidor.
 *
 * Importa mais aqui que no comum: o `docker stop` manda `SIGTERM` e espera
 * poucos segundos antes do `SIGKILL`. Morrer no `SIGKILL` no meio de uma
 * gravacao deixaria o `harvest.json` pela metade e a trava do `proper-lockfile`
 * para tras — a colheita seguinte encontraria o volume sujo.
 */
export const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

interface Closable {
  close(): Promise<unknown>;
}

interface SignalSource {
  once(signal: string, listener: () => void): unknown;
}

export interface ShutdownDeps {
  readonly source: SignalSource;
  readonly exit: (code: number) => void;
  readonly log: (message: string) => void;
  /**
   * O que fazer antes de fechar o servidor: parar o agendador e esperar a
   * colheita em curso. Devolve `false` quando o prazo venceu com ela ainda
   * rodando — nesse caso o encerramento segue, porque esperar sem prazo e o que
   * faz o `docker stop` virar `SIGKILL`.
   */
  readonly drain: () => Promise<boolean>;
}

/**
 * Fecha o servidor no primeiro sinal e sai com o codigo que o fechamento
 * mereceu.
 *
 * O segundo sinal e ignorado de proposito: `Ctrl+C` repetido durante um
 * fechamento que ja esta em curso nao deve comecar outro.
 */
export function installShutdown(app: Closable, deps: Partial<ShutdownDeps> = {}): void {
  const {
    source = process,
    exit = exitProcess,
    log = logToConsole,
    drain = nothingToDrain,
  } = deps;
  let closing = false;

  for (const signal of SHUTDOWN_SIGNALS) {
    source.once(signal, () => {
      if (closing) {
        return;
      }

      closing = true;
      void closeThen(app, signal, { source, exit, log, drain });
    });
  }
}

async function closeThen(app: Closable, signal: string, deps: ShutdownDeps): Promise<void> {
  deps.log(`${signal} recebido: encerrando o servidor de publicacoes`);

  try {
    await drainQuietly(deps);
    await app.close();
    deps.exit(0);
  } catch (error: unknown) {
    deps.log(`falha ao encerrar: ${error instanceof Error ? error.message : String(error)}`);
    deps.exit(1);
  }
}

/**
 * A colheita que nao termina no prazo nao impede o encerramento, e nem ele
 * falha por causa dela: o pior caso e um Chromium morto junto com o processo, o
 * que a trava de instancia unica resolve na proxima (ela expira sozinha).
 */
async function drainQuietly(deps: ShutdownDeps): Promise<void> {
  try {
    if (!(await deps.drain())) {
      deps.log('A colheita em curso nao terminou no prazo: encerrando de todo jeito');
    }
  } catch (error: unknown) {
    deps.log(`falha ao encerrar a colheita: ${String(error)}`);
  }
}

function nothingToDrain(): Promise<boolean> {
  return Promise.resolve(true);
}

function exitProcess(code: number): void {
  process.exit(code);
}

function logToConsole(message: string): void {
  console.info(message);
}

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
}

/**
 * Fecha o servidor no primeiro sinal e sai com o codigo que o fechamento
 * mereceu.
 *
 * O segundo sinal e ignorado de proposito: `Ctrl+C` repetido durante um
 * fechamento que ja esta em curso nao deve comecar outro.
 */
export function installShutdown(app: Closable, deps: Partial<ShutdownDeps> = {}): void {
  const { source = process, exit = exitProcess, log = logToConsole } = deps;
  let closing = false;

  for (const signal of SHUTDOWN_SIGNALS) {
    source.once(signal, () => {
      if (closing) {
        return;
      }

      closing = true;
      void closeThen(app, signal, exit, log);
    });
  }
}

async function closeThen(
  app: Closable,
  signal: string,
  exit: (code: number) => void,
  log: (message: string) => void,
): Promise<void> {
  log(`${signal} recebido: encerrando o servidor de publicacoes`);

  try {
    await app.close();
    exit(0);
  } catch (error: unknown) {
    log(`falha ao encerrar: ${error instanceof Error ? error.message : String(error)}`);
    exit(1);
  }
}

function exitProcess(code: number): void {
  process.exit(code);
}

function logToConsole(message: string): void {
  console.info(message);
}

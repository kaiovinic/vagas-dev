/**
 * Uma colheita em curso, e no maximo uma.
 *
 * Existe para separar "quem decide quando" (o agendador, a rota) de "quem
 * carrega o Chromium": os dois lados so precisam saber se ja ha colheita
 * rodando, e nenhum deles pode esperar por ela — o agendador tem que voltar ao
 * relogio e a rota tem que responder em milissegundos, com o Fastify livre para
 * atender o `GET /posts` da API enquanto o navegador trabalha.
 *
 * A trava de processo (`single-instance`) continua valendo e protege outra
 * coisa: duas colheitas em processos DIFERENTES, que e o caso do `npm run
 * harvest` rodando a mao enquanto o agendador dispara.
 */

export const HARVEST_STARTS = ['started', 'already-running', 'no-session', 'unavailable'] as const;

/**
 * - `started`         comecou agora, em segundo plano.
 * - `already-running` ja havia uma; a nova nao entra na fila.
 * - `no-session`      sem `state.json` nao ha o que abrir.
 * - `unavailable`     este processo nao colhe (so serve o cache).
 */
export type HarvestStart = (typeof HARVEST_STARTS)[number];

export interface HarvestJobDeps {
  /** Uma colheita inteira: trava, navegador, gravacao. */
  readonly harvest: () => Promise<void>;
  readonly isSessionPresent: () => Promise<boolean>;
  readonly log: (message: string) => void;
  readonly warn: (message: string) => void;
}

export class HarvestJob {
  private busy = false;

  private current: Promise<void> | undefined;

  constructor(private readonly deps: HarvestJobDeps) {}

  get running(): boolean {
    return this.busy;
  }

  /**
   * Dispara e volta na hora, sem esperar a colheita.
   *
   * A sessao e conferida ANTES de abrir qualquer coisa: sem `state.json` o
   * Chromium subiria para ser barrado na parede de login, o que gasta um acesso
   * a conta para descobrir o que um `access()` responde de graca.
   */
  async start(): Promise<HarvestStart> {
    if (this.busy) {
      return 'already-running';
    }

    this.busy = true;

    if (!(await this.sessionPresent())) {
      this.busy = false;
      this.deps.log('Sem sessao gravada (state.json): a colheita espera o login.');

      return 'no-session';
    }

    this.current = this.runAndRelease();

    return 'started';
  }

  /**
   * Espera a colheita em curso, com prazo.
   *
   * Quem chama e o encerramento: o `docker stop` da poucos segundos antes do
   * `SIGKILL`, e esperar sem prazo e a diferenca entre fechar limpo e ser morto
   * no meio da gravacao. `false` significa que o prazo venceu primeiro.
   */
  async settle(timeoutInMs: number): Promise<boolean> {
    const current = this.current;

    if (current === undefined) {
      return true;
    }

    return await finishesWithin(current, timeoutInMs);
  }

  private async sessionPresent(): Promise<boolean> {
    try {
      return await this.deps.isSessionPresent();
    } catch (error: unknown) {
      this.deps.warn(`Nao deu para conferir a sessao: ${String(error)}`);

      return false;
    }
  }

  /** A colheita que falha nao derruba quem a disparou: ela e relatada. */
  private async runAndRelease(): Promise<void> {
    try {
      await this.deps.harvest();
    } catch (error: unknown) {
      this.deps.warn(`A colheita falhou e nada foi gravado: ${String(error)}`);
    } finally {
      this.busy = false;
      this.current = undefined;
    }
  }
}

/** O temporizador e desamarrado: ele nao pode manter o processo vivo. */
async function finishesWithin(work: Promise<void>, timeoutInMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;

  const deadline = new Promise<false>((done) => {
    timer = setTimeout(() => done(false), timeoutInMs);
    timer.unref();
  });

  try {
    return await Promise.race([work.then(() => true), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

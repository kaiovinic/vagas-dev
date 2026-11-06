/**
 * A sessao do LinkedIn: como nasce e como se confere que ainda vale.
 *
 * O desenho esta no RFC 001, secao 6. O resumo: guardamos `storageState` em
 * JSON, e nao a pasta de perfil do Chromium, porque a pasta nao viaja do
 * Windows para a VPS — o Chromium cifra os cookies com o DPAPI do Windows, e no
 * Linux a decifragem falha. O `storageState` sai do Playwright ja decifrado.
 *
 * O login NAO e automatizado. Quem digita e-mail e senha e a pessoa, na janela
 * do navegador. Dois motivos: a conta tem 2FA, e login programatico e
 * justamente o gesto que faz o LinkedIn pedir desafio.
 */
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { FEED_URL, isChallenge, isSignedIn, LOGIN_URL } from '@/session/linkedin-urls';

/**
 * Reduz um sinal obvio de automacao. Nao e disfarce — e nao fingir ser um
 * navegador comum enquanto se anuncia como robo no `navigator.webdriver`.
 */
const LAUNCH_ARGS = ['--disable-blink-features=AutomationControlled'];

const VIEWPORT = { width: 1280, height: 900 } as const;

/** O LinkedIn decide o desvio depois de hidratar a pagina. */
const SETTLE_MS = 3_000;

const POLL_MS = 1_500;

export interface SessionCheck {
  readonly valid: boolean;
  /** Onde o navegador parou: o diagnostico quando `valid` e falso. */
  readonly url: string;
}

export type ProgressReporter = (message: string) => void;

/**
 * Abre a janela do navegador para o login manual e grava a sessao.
 *
 * Fica esperando ate a pessoa chegar ao feed — inclusive atravessando 2FA e
 * desafio, que podem levar minutos. Sem alcancar o feed, nada e gravado: um
 * `state.json` pela metade seria pior que nenhum.
 */
export async function createSession(
  stateFile: string,
  waitMs: number,
  onProgress: ProgressReporter,
): Promise<void> {
  const browser = await chromium.launch({ headless: false, args: LAUNCH_ARGS });

  try {
    const context = await newContext(browser, undefined);
    const page = await context.newPage();

    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    onProgress('Janela aberta. Faca o login e resolva a verificacao, se vier.');

    if (!(await waitForFeed(page, waitMs, onProgress))) {
      const seconds = Math.round(waitMs / 1_000);

      throw new Error(`Feed nao alcancado em ${seconds}s (parou em ${page.url()})`);
    }

    await mkdir(dirname(stateFile), { recursive: true });
    await context.storageState({ path: stateFile });
  } finally {
    await browser.close();
  }
}

/**
 * Confere se a sessao gravada ainda abre o feed, sem janela.
 *
 * E este passo que encerra a Fase 1, e nao o login: o login prova que a pessoa
 * entrou, a conferencia prova que o ARQUIVO serve. Rodar de novo no dia
 * seguinte responde a pergunta que decide o projeto — se a sessao dura.
 */
export async function checkSession(stateFile: string): Promise<SessionCheck> {
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });

  try {
    const context = await newContext(browser, stateFile);
    const page = await context.newPage();

    await page.goto(FEED_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(SETTLE_MS);

    const url = page.url();

    return { valid: isSignedIn(url), url };
  } finally {
    await browser.close();
  }
}

/** `undefined` em `stateFile` abre um contexto limpo, para o primeiro login. */
async function newContext(browser: Browser, stateFile: string | undefined): Promise<BrowserContext> {
  return browser.newContext({
    locale: 'pt-BR',
    timezoneId: 'America/Bahia',
    viewport: VIEWPORT,
    ...(stateFile === undefined ? {} : { storageState: stateFile }),
  });
}

async function waitForFeed(page: Page, waitMs: number, onProgress: ProgressReporter): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  let announced = false;

  while (Date.now() < deadline) {
    await page.waitForTimeout(POLL_MS);

    if (page.url().includes('/feed')) {
      return true;
    }

    announced = announceChallenge(page.url(), announced, onProgress);
  }

  return false;
}

/** Avisa uma vez que o LinkedIn pediu verificacao, para a espera fazer sentido. */
function announceChallenge(url: string, announced: boolean, onProgress: ProgressReporter): boolean {
  if (announced || !isChallenge(url)) {
    return announced;
  }

  onProgress('Verificacao pedida pelo LinkedIn: conclua na janela. Continuo esperando.');

  return true;
}

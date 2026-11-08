/**
 * O lado que abre o navegador de verdade. Sem teste unitario, de proposito.
 *
 * Nao existe jeito honesto de testar um navegador sem um navegador, e navegar
 * contra o LinkedIn a cada CI e o caminho mais curto para derrubar a sessao
 * (RFC 001, secao 12). Por isso este arquivo nao DECIDE nada: ele clica, rola e
 * le atributo, e devolve tudo para o `runHarvest`, que e testado inteiro.
 *
 * A consequencia pratica, dita sem rodeios: os seletores aqui sao os do coletor
 * de referencia e das fixtures reconstruidas, e NAO foram verificados contra o
 * LinkedIn logado. Cada um deles e tolerante a ausencia — seletor que mudou
 * rende colheita menor, nunca colheita interrompida.
 */
import { chromium, type Browser, type Locator, type Page } from 'playwright';

import { NAVIGATION_TIMEOUT_IN_MS, STATE_FILE } from '@/config';
import type { PostsPage, SearchOpening } from '@/harvest/posts-page';
import { canonicalPostUrl } from '@/parser/linkedin-post-card';
import { isSignedIn } from '@/session/linkedin-urls';

/** O mesmo da sessao: nao fingir ser humano, so nao se anunciar como robo. */
const LAUNCH_ARGS = ['--disable-blink-features=AutomationControlled'];

const VIEWPORT = { width: 1280, height: 900 } as const;

/** O LinkedIn decide o desvio para o login depois de hidratar a pagina. */
const SETTLE_IN_MS = 3_000;

/** Entre duas rolagens: menos que isto e rolar antes de a lista crescer. */
const SCROLL_SETTLE_IN_MS = 1_200;

const SCROLL_STEP_IN_PX = 1_800;

/** Prazo curto de clique: botao que nao existe mais nao pode travar a colheita. */
const CLICK_TIMEOUT_IN_MS = 1_500;

const ACTIVITY_URN = /urn:li:(?:activity|share|ugcPost):(\d{10,25})/i;

/** "...mais", que esconde justamente a parte do texto que descreve a vaga. */
const EXPAND_SELECTORS = [
  'button[aria-label*="ver mais" i]',
  'button[aria-label*="see more" i]',
  '[data-testid="expandable-text-box"] button',
  '.feed-shared-inline-show-more-text button',
].join(', ');

/** O botao de menu do card: no layout novo e por ele que se chega ao link. */
const CARD_MENU_SELECTOR = 'button[aria-label*="menu de controle" i], button[aria-label*="control menu" i]';

export interface PostsBrowser {
  readonly page: PostsPage;
  close(): Promise<void>;
}

export interface PostsBrowserOptions {
  readonly stateFile?: string;
  readonly timeoutInMs?: number;
}

/**
 * Abre o Chromium com a sessao gravada e devolve a pagina como porta.
 *
 * `storageState` e nao pasta de perfil: a pasta nao viaja do Windows para a
 * VPS, porque o Chromium cifra os cookies com o DPAPI (RFC 001, secao 6).
 */
export async function openPostsBrowser(
  options: PostsBrowserOptions = {},
): Promise<PostsBrowser> {
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });

  try {
    const context = await browser.newContext({
      locale: 'pt-BR',
      timezoneId: 'America/Bahia',
      viewport: VIEWPORT,
      storageState: options.stateFile ?? STATE_FILE,
    });
    const page = await context.newPage();

    page.setDefaultTimeout(options.timeoutInMs ?? NAVIGATION_TIMEOUT_IN_MS);

    return { page: new PlaywrightPostsPage(page), close: () => closeQuietly(browser) };
  } catch (error) {
    await closeQuietly(browser);

    throw error;
  }
}

/** Fechar o navegador nao pode ser o que derruba uma colheita bem-sucedida. */
async function closeQuietly(browser: Browser): Promise<void> {
  try {
    await browser.close();
  } catch {
    // Processo do Chromium ja morto: nao ha o que fechar nem o que relatar.
  }
}

class PlaywrightPostsPage implements PostsPage {
  constructor(private readonly page: Page) {}

  /**
   * Navega e diz se a sessao sobreviveu — nunca lanca.
   *
   * A pergunta que importa nao e "a pagina carregou", e "continuo logado": o
   * LinkedIn responde 200 na parede de login. Por isso o `SETTLE_IN_MS` antes
   * de olhar a URL, que e o tempo que ele leva para decidir o desvio.
   */
  async open(url: string): Promise<SearchOpening> {
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(SETTLE_IN_MS);

      const current = this.page.url();

      return isSignedIn(current) ? { outcome: 'opened' } : { outcome: 'signed-out', url: current };
    } catch (error) {
      return { outcome: 'failed', reason: String(error) };
    }
  }

  /** Rola e expande o que der; o que nao der fica como estava. */
  async revealMore(maxScrolls: number): Promise<void> {
    for (let scroll = 0; scroll < maxScrolls; scroll += 1) {
      await this.scrollOnce();
    }

    await this.expandTexts();
  }

  async html(): Promise<string> {
    try {
      return await this.page.content();
    } catch {
      return '';
    }
  }

  /**
   * Da `cardKey` ate o link permanente, tentando o mais barato primeiro.
   *
   * No layout classico a chave JA e a urn, e nem se toca na pagina. No novo,
   * procura-se a urn no proprio card e, so se nao houver, abre-se o menu do
   * post — que e onde o LinkedIn monta o link para copiar.
   */
  async postUrl(cardKey: string): Promise<string | undefined> {
    const found =
      activityId(cardKey) ??
      (await this.urnInCard(cardKey)) ??
      (await this.urnFromMenu(cardKey));

    return found === undefined ? undefined : canonicalPostUrl(found);
  }

  private async scrollOnce(): Promise<void> {
    try {
      await this.page.mouse.wheel(0, SCROLL_STEP_IN_PX);
      await this.page.waitForTimeout(SCROLL_SETTLE_IN_MS);
    } catch {
      // Pagina que nao rola mais: colhe-se o que esta visivel.
    }
  }

  private async expandTexts(): Promise<void> {
    const buttons = this.page.locator(EXPAND_SELECTORS);

    for (const button of await all(buttons)) {
      try {
        await button.click({ timeout: CLICK_TIMEOUT_IN_MS });
      } catch {
        // Botao que saiu da tela ou sumiu: o texto fica truncado, e ja serve.
      }
    }
  }

  /** A urn pode estar em qualquer atributo do card: procura-se no HTML dele. */
  private async urnInCard(cardKey: string): Promise<string | undefined> {
    try {
      const card = this.page.locator(cardSelector(cardKey)).first();

      return activityId(await card.innerHTML({ timeout: CLICK_TIMEOUT_IN_MS }));
    } catch {
      return undefined;
    }
  }

  /**
   * Ultimo recurso: abrir o menu do post e ler a urn que ele monta.
   *
   * O menu e fechado em seguida com `Escape` — menu aberto cobre os cards de
   * baixo, e o proximo `innerHTML` viria errado.
   */
  private async urnFromMenu(cardKey: string): Promise<string | undefined> {
    try {
      const menu = this.page.locator(cardSelector(cardKey)).first().locator(CARD_MENU_SELECTOR);

      await menu.first().click({ timeout: CLICK_TIMEOUT_IN_MS });

      const opened = await this.page.content();

      await this.page.keyboard.press('Escape');

      return activityId(opened);
    } catch {
      return undefined;
    }
  }
}

/** Os dois jeitos de endereçar um card, como o parser os produz. */
function cardSelector(cardKey: string): string {
  const escaped = cardKey.replace(/"/g, '\\"');

  return `[componentkey="${escaped}"], [data-urn="${escaped}"], [data-id="${escaped}"]`;
}

function activityId(haystack: string): string | undefined {
  return ACTIVITY_URN.exec(haystack)?.[1];
}

async function all(locator: Locator): Promise<readonly Locator[]> {
  try {
    return await locator.all();
  } catch {
    return [];
  }
}

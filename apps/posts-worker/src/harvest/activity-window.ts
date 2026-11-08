/**
 * A janela de atividade: o horario em que a conta pode navegar.
 *
 * E a politica do RFC 001 (secao 8) que faltava. O motivo nao e tecnico: uma
 * conta nova que abre o LinkedIn as 3h da manha, todos os dias, parece o que e.
 * Com a conta ainda por nascer depois da restricao, navegacao de madrugada e
 * gatilho direto de bloqueio — e colher as 8h em vez das 3h nao custa vaga
 * nenhuma, porque a janela de 72h da API nao se mede em horas de sono.
 *
 * Tudo aqui e puro e sem dependencia: a conversao de fuso sai do `Intl`, que o
 * Node tem embutido, e nao de uma biblioteca de datas a mais.
 */

const HOURS_IN_DAY = 24;

const MINUTE_IN_MS = 60_000;

export interface ActivityWindow {
  /** Primeira hora permitida, no fuso da janela. `8` = a partir das 08:00. */
  readonly startHour: number;
  /** Primeira hora JA proibida. `22` = a ultima colheita sai as 21:59. */
  readonly endHour: number;
  readonly timeZone: string;
}

/** As partes do relogio de parede naquele fuso, naquele instante. */
interface LocalParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export function isWithinWindow(at: Date, window: ActivityWindow): boolean {
  const { hour } = localParts(at, window.timeZone);

  return hour >= window.startHour && hour < window.endHour;
}

/**
 * O proximo instante em que a janela abre, depois de `at`.
 *
 * Antes da abertura, e hoje mesmo; de tarde ou de noite, e amanha. O dia
 * seguinte vem de `day + 1` com o `Date.UTC` normalizando virada de mes e de
 * ano — nao ha aritmetica de calendario escrita a mao aqui.
 */
export function nextWindowStart(at: Date, window: ActivityWindow): Date {
  const parts = localParts(at, window.timeZone);
  const sameDay = parts.hour < window.startHour;

  return instantForLocalHour(
    { ...parts, day: sameDay ? parts.day : parts.day + 1, hour: window.startHour },
    window.timeZone,
  );
}

/**
 * O relogio de parede no fuso pedido.
 *
 * `en-CA` nao e capricho: ele formata a data como `2026-11-07`, que e o unico
 * formato que da para fatiar sem ambiguidade entre dia e mes.
 */
function localParts(at: Date, timeZone: string): LocalParts {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);

  const [date = '', time = ''] = formatted.split(', ');
  const [year = '0', month = '0', day = '0'] = date.split('-');
  const [hour = '0', minute = '0'] = time.split(':');

  // `hour12: false` devolve 24 para a meia-noite em algumas versoes do ICU.
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour) % HOURS_IN_DAY,
    minute: Number(minute),
  };
}

/**
 * De hora local para instante absoluto.
 *
 * O caminho de volta nao e simetrico: `Date.UTC` nao conhece fuso, entao o
 * instante e corrigido pelo deslocamento que o proprio fuso tem NAQUELE
 * momento. A segunda passada existe para o dia de virada de horario de verao,
 * em que o deslocamento do palpite e o do resultado podem ser diferentes — a
 * Bahia nao tem horario de verao desde 2019, mas a funcao aceita qualquer fuso.
 */
function instantForLocalHour(parts: LocalParts, timeZone: string): Date {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour);
  const firstGuess = naive - offsetInMs(new Date(naive), timeZone);

  return new Date(naive - offsetInMs(new Date(firstGuess), timeZone));
}

/**
 * Quanto o fuso esta a frente do UTC naquele instante.
 *
 * Medido no minuto cheio de proposito: o relogio de parede nao traz segundos, e
 * descontar um instante com segundos de um sem eles jogaria esses segundos
 * dentro do deslocamento — e dai para dentro do horario calculado.
 */
function offsetInMs(at: Date, timeZone: string): number {
  const minute = Math.floor(at.getTime() / MINUTE_IN_MS) * MINUTE_IN_MS;
  const parts = localParts(new Date(minute), timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);

  return asUtc - minute;
}

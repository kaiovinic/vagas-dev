export const BRASILIA_TIME_ZONE = 'America/Bahia';

/**
 * Recorte de calendario escolhido no painel: um ano inteiro, um mes ou um dia.
 *
 * `month` e `day` sao `null` de proposito, e nao opcionais: "todos os meses" e
 * uma escolha do usuario, nao um campo esquecido.
 */
export interface CalendarSelection {
  readonly year: number;
  readonly month: number | null;
  readonly day: number | null;
}

/** Intervalo fechado-aberto `[start, end)` em instantes absolutos (UTC). */
export interface CalendarRange {
  readonly start: Date;
  readonly end: Date;
}

/**
 * `sv-SE` formata a data como `2026-10-26 12:00:00`, que vira instante com uma
 * troca de separador. E o unico motivo da escolha da locale: ler o relogio de
 * parede de Brasilia sem montar a data campo a campo.
 */
const wallClockFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: BRASILIA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const yearFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BRASILIA_TIME_ZONE,
  year: 'numeric',
});

/**
 * Converte o recorte do calendario de Brasilia no intervalo absoluto equivalente.
 *
 * A conversao passa pelo fuso em vez de somar tres horas na mao: o dia 1 de
 * marco em Brasilia comeca as 03:00 UTC, e e esse instante que o banco compara.
 * Se o Brasil voltar a ter horario de verao, o deslocamento vem do `Intl` e as
 * bordas continuam certas sem mudanca nenhuma aqui.
 */
export function brasiliaCalendarRange(selection: CalendarSelection): CalendarRange {
  const { year, month, day } = selection;

  if (month === null) {
    return { start: startOfBrasiliaDay(year, 1, 1), end: startOfBrasiliaDay(year + 1, 1, 1) };
  }

  if (day === null) {
    return {
      start: startOfBrasiliaDay(year, month, 1),
      end: startOfBrasiliaDay(year, month + 1, 1),
    };
  }

  return {
    start: startOfBrasiliaDay(year, month, day),
    end: startOfBrasiliaDay(year, month, day + 1),
  };
}

/** Ano corrente no horario de Brasilia, que e o padrao do seletor do painel. */
export function currentBrasiliaYear(reference: Date): number {
  return Number(yearFormatter.format(reference));
}

/** Quantos dias tem o mes: o seletor de dia e a validacao da query usam o mesmo numero. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Meia-noite do dia informado no horario de Brasilia, em instante absoluto.
 *
 * `Date.UTC` absorve o excesso (dia 32, mes 13), que e justamente como a borda
 * superior do intervalo e construida: "o comeco do proximo".
 */
function startOfBrasiliaDay(year: number, month: number, day: number): Date {
  const wallClock = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const firstGuess = new Date(wallClock - offsetAt(new Date(wallClock)));

  // Segunda passada: na virada em que o proprio deslocamento muda, o palpite
  // inicial cai do lado errado da mudanca e so o segundo acerta a meia-noite.
  return new Date(wallClock - offsetAt(firstGuess));
}

/** Deslocamento do fuso naquele instante, em milissegundos. */
function offsetAt(instant: Date): number {
  const wallClock = `${wallClockFormatter.format(instant).replace(' ', 'T')}Z`;

  return Date.parse(wallClock) - instant.getTime();
}

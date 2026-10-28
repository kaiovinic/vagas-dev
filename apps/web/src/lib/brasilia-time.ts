export const BRASILIA_TIME_ZONE = 'America/Bahia';
export const BRASILIA_LABEL = 'Horario de Brasilia (UTC-3)';

const MINUTE_IN_MS = 60_000;
const HOUR_IN_MS = 60 * MINUTE_IN_MS;
const DAY_IN_MS = 24 * HOUR_IN_MS;

const clockFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: BRASILIA_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
});

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: BRASILIA_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const dayFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: BRASILIA_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
});

/** `HH:mm` no fuso de Brasilia, independente do fuso do navegador. */
export function formatClock(value: Date): string {
  return clockFormatter.format(value);
}

/** `dd/MM HH:mm` no fuso de Brasilia. */
export function formatDateTime(value: Date): string {
  return dateTimeFormatter.format(value);
}

/** Converte `YYYY-MM-DD` (ja em Brasilia) em `dd/MM`, sem reinterpretar o fuso. */
export function formatDayLabel(isoDay: string): string {
  const [year, month, day] = isoDay.split('-').map(Number);

  if (year === undefined || month === undefined || day === undefined) {
    return isoDay;
  }

  return dayFormatter.format(new Date(Date.UTC(year, month - 1, day, 12)));
}

/** "ha 7 min", "ha 2 h", "ha 3 d" — tempo decorrido desde a ultima captura. */
export function formatElapsed(from: Date, now: Date): string {
  const elapsed = now.getTime() - from.getTime();

  if (elapsed < 0) {
    return 'agora';
  }

  return `ha ${formatDuration(elapsed)}`;
}

/** "em 113 min", "em 2 h" — tempo restante ate a proxima captura. */
export function formatRemaining(until: Date, now: Date): string {
  const remaining = until.getTime() - now.getTime();

  if (remaining <= 0) {
    return 'a qualquer momento';
  }

  return `em ${formatDuration(remaining)}`;
}

/**
 * Minutos ate 2h, depois horas.
 *
 * A captura roda a cada 2 horas, entao a contagem da proxima quase sempre cai
 * nessa faixa: "em 113 min" diz o que "em 1 h" esconderia (pode ser 60 ou 119).
 */
const MINUTES_CUTOFF_IN_MS = 120 * MINUTE_IN_MS;

function formatDuration(milliseconds: number): string {
  if (milliseconds < MINUTE_IN_MS) {
    return 'menos de 1 min';
  }

  if (milliseconds < MINUTES_CUTOFF_IN_MS) {
    return `${Math.floor(milliseconds / MINUTE_IN_MS)} min`;
  }

  if (milliseconds < DAY_IN_MS) {
    return `${Math.floor(milliseconds / HOUR_IN_MS)} h`;
  }

  return `${Math.floor(milliseconds / DAY_IN_MS)} d`;
}

export function parseApiDate(value: string | null): Date | null {
  if (value === null) {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

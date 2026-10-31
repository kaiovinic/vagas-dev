import type { ReactNode } from 'react';
import { Radio } from 'lucide-react';

/** Recortes oferecidos na barra; o ultimo e a propria janela do radar. */
export const TIME_WINDOWS = [
  { hours: 1, label: '1h' },
  { hours: 6, label: '6h' },
  { hours: 24, label: '24h' },
  { hours: 48, label: '48h' },
  { hours: 72, label: '72h' },
  // Alem das 72h do radar: mostra o que ja foi capturado e envelheceu desde
  // entao. Nada mais antigo existe no banco, porque nunca foi capturado.
  { hours: 168, label: '7d' },
] as const;

export type TimeWindowHours = (typeof TIME_WINDOWS)[number]['hours'];

export const DEFAULT_TIME_WINDOW: TimeWindowHours = 72;

interface JobsControlBarProps {
  readonly window: TimeWindowHours;
  readonly onWindowChange: (hours: TimeWindowHours) => void;
  readonly isLive: boolean;
  readonly onLiveChange: (live: boolean) => void;
  readonly total: number;
}

/**
 * Barra acima do feed: recorte de tempo a esquerda, estado do radar a direita.
 *
 * O recorte e um grupo de radio de verdade, e nao botoes: sao opcoes mutuamente
 * exclusivas, e assim o leitor de tela anuncia "1 de 5 selecionado" e as setas
 * do teclado navegam entre elas de graca.
 */
export function JobsControlBar({
  window,
  onWindowChange,
  isLive,
  onLiveChange,
  total,
}: JobsControlBarProps): ReactNode {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <fieldset
        className="flex items-center gap-1 rounded-full border border-border-subtle bg-surface-base p-1"
        data-testid="time-window"
      >
        <legend className="sr-only">Publicadas nas ultimas</legend>
        {TIME_WINDOWS.map((option) => (
          <label
            key={option.hours}
            className="cursor-pointer rounded-full px-3 py-1 text-sm text-content-secondary transition-colors has-checked:bg-accent has-checked:font-medium has-checked:text-surface-base hover:text-content-primary"
          >
            <input
              type="radio"
              name="time-window"
              className="sr-only"
              value={option.hours}
              checked={window === option.hours}
              onChange={() => onWindowChange(option.hours)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <div className="flex items-center gap-3">
        <span className="text-xs text-content-muted">{total} no recorte</span>

        <label
          className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border-subtle bg-surface-base px-3 py-1.5 text-sm text-content-secondary has-checked:border-accent has-checked:text-accent"
          data-testid="live-radar-toggle"
        >
          <input
            type="checkbox"
            className="sr-only"
            checked={isLive}
            onChange={(event) => onLiveChange(event.target.checked)}
          />
          <PulseDot active={isLive} />
          Radar {isLive ? 'ativo' : 'pausado'}
        </label>
      </div>
    </div>
  );
}

/**
 * O pulso so anima quando o radar esta ligado — um ponto piscando com o
 * polling desligado diria a coisa errada. `motion-safe` respeita quem pediu
 * menos animacao no sistema.
 */
function PulseDot({ active }: { readonly active: boolean }): ReactNode {
  if (!active) {
    return <Radio aria-hidden="true" className="size-3.5 opacity-60" />;
  }

  return (
    <span className="relative grid size-3.5 place-items-center" data-testid="pulse-dot">
      <span className="absolute size-3.5 rounded-full bg-accent/40 motion-safe:animate-ping" />
      <span className="size-2 rounded-full bg-accent" />
    </span>
  );
}

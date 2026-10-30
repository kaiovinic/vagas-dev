import { useCallback, useEffect, useRef, useState } from 'react';

import type { JobListItem } from '@/api/schemas';

/** Intervalo do polling silencioso quando o radar esta ligado. */
export const LIVE_RADAR_INTERVAL_MS = 60_000;

export interface LiveRadar {
  /** Quantas vagas chegaram depois do ultimo reconhecimento do usuario. */
  readonly newCount: number;
  /** Zera o aviso e passa a contar a partir das vagas que estao na tela. */
  readonly acknowledge: () => void;
}

/**
 * Deteccao de vaga nova para o aviso do topo do feed.
 *
 * A contagem usa a data de publicacao da vaga mais recente ja vista, e nao o
 * total da resposta: o total sobe e desce conforme vagas expiram da janela de
 * 72h, e por isso anunciaria "novidade" quando nada chegou.
 *
 * O marcador e reiniciado quando a consulta muda (`resetKey`): trocar o
 * recorte de tempo ou o filtro traz outra lista, e comparar com a anterior nao
 * diz nada ao usuario.
 *
 * O intervalo do polling nao sai daqui: quem consulta precisa dele antes de
 * ter a lista, e a lista e que alimenta este hook. Quem chama usa
 * `LIVE_RADAR_INTERVAL_MS` direto.
 */
export function useLiveRadar(
  items: readonly JobListItem[],
  enabled: boolean,
  resetKey: string,
): LiveRadar {
  const [seenUntil, setSeenUntil] = useState<number | null>(null);
  const lastResetKey = useRef(resetKey);

  const newest = newestPublishedAt(items);

  useEffect(() => {
    if (lastResetKey.current !== resetKey) {
      lastResetKey.current = resetKey;
      setSeenUntil(null);
    }
  }, [resetKey]);

  // A primeira lista carregada e a linha de base: nada nela e "novo".
  useEffect(() => {
    setSeenUntil((current) => (current === null && newest !== null ? newest : current));
  }, [newest]);

  const acknowledge = useCallback(() => {
    setSeenUntil(newestPublishedAt(items));
  }, [items]);

  const newCount =
    seenUntil === null
      ? 0
      : items.filter((item) => Date.parse(item.publishedAt) > seenUntil).length;

  return { newCount: enabled ? newCount : 0, acknowledge };
}

function newestPublishedAt(items: readonly JobListItem[]): number | null {
  const timestamps = items
    .map((item) => Date.parse(item.publishedAt))
    .filter((value) => Number.isFinite(value));

  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

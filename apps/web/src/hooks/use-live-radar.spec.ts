import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import type { JobListItem } from '@/api/schemas';
import { LIVE_RADAR_INTERVAL_MS, useLiveRadar } from '@/hooks/use-live-radar';

function job(id: string, publishedAt: string): JobListItem {
  return {
    id,
    fingerprint: 'a'.repeat(64),
    title: `Vaga ${id}`,
    company: 'Acme Corp',
    recruiterName: null,
    source: 'gupy',
    city: 'Salvador/BA',
    isRemote: true,
    scope: 'NATIONAL',
    workModel: 'REMOTE',
    url: 'https://gupy.io/vagas/1',
    tags: [],
    description: '',
    publishedAt,
  publishedAtSource: 'SOURCE',
  };
}

const ONTEM = job('1', '2026-10-28T12:00:00.000Z');
const HOJE = job('2', '2026-10-29T12:00:00.000Z');

function render(items: readonly JobListItem[], enabled = true, key = 'filtro-a') {
  return renderHook(
    ({ list, on, resetKey }) => useLiveRadar(list, on, resetKey),
    { initialProps: { list: items, on: enabled, resetKey: key } },
  );
}

describe('useLiveRadar', () => {
  it('faz o polling a cada 60 segundos', () => {
    expect(LIVE_RADAR_INTERVAL_MS).toBe(60_000);
  });

  it('nao anuncia novidade na primeira lista carregada', () => {
    const { result } = render([ONTEM]);

    expect(result.current.newCount).toBe(0);
  });

  it('conta a vaga que chegou depois da linha de base', () => {
    const { result, rerender } = render([ONTEM]);

    rerender({ list: [HOJE, ONTEM], on: true, resetKey: 'filtro-a' });

    expect(result.current.newCount).toBe(1);
  });

  it('nao conta vaga mais antiga que a linha de base', () => {
    const { result, rerender } = render([HOJE]);

    rerender({ list: [HOJE, ONTEM], on: true, resetKey: 'filtro-a' });

    expect(result.current.newCount).toBe(0);
  });

  it('zera o aviso quando o usuario reconhece', () => {
    const { result, rerender } = render([ONTEM]);

    rerender({ list: [HOJE, ONTEM], on: true, resetKey: 'filtro-a' });
    expect(result.current.newCount).toBe(1);

    act(() => result.current.acknowledge());

    expect(result.current.newCount).toBe(0);
  });

  it('fica calado com o radar desligado', () => {
    const { result, rerender } = render([ONTEM], false);

    rerender({ list: [HOJE, ONTEM], on: false, resetKey: 'filtro-a' });

    expect(result.current.newCount).toBe(0);
  });

  it('reinicia a linha de base quando o filtro muda', () => {
    const { result, rerender } = render([ONTEM]);

    // Outra consulta traz outra lista; comparar com a anterior nao diria nada.
    rerender({ list: [HOJE, ONTEM], on: true, resetKey: 'filtro-b' });

    expect(result.current.newCount).toBe(0);
  });

  it('aguenta lista vazia sem contar novidade', () => {
    const { result } = render([]);

    expect(result.current.newCount).toBe(0);
  });

  it('ignora data invalida vinda da api', () => {
    const { result } = render([job('3', 'nao e uma data')]);

    expect(result.current.newCount).toBe(0);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CaptureButton } from '@/components/layout/capture-button';
import { createTestQueryClient, jsonResponse, renderWithProviders } from '../../../test/render';

const RESULT = {
  captureId: 'capture-1',
  status: 'SUCCESS',
  startedAt: '2026-10-27T18:32:59.000Z',
  finishedAt: '2026-10-27T18:33:01.000Z',
  nextRunAt: '2026-10-27T20:32:59.000Z',
  totalFound: 280,
  totalApproved: 52,
  totalPersisted: 18,
  totalDuplicated: 34,
  failedSources: [],
  joinedRunning: false,
};

function stubApi(body: unknown = RESULT, status = 200): ReturnType<typeof vi.fn> {
  const spy = vi.fn(() => Promise.resolve(jsonResponse(body, status)));

  vi.stubGlobal('fetch', spy);

  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CaptureButton', () => {
  it('mostra o botao de capturar agora', () => {
    stubApi();

    renderWithProviders(<CaptureButton />);

    expect(screen.getByRole('button', { name: 'Capturar agora' })).toBeInTheDocument();
  });

  it('chama POST /api/capture/run ao clicar', async () => {
    const spy = stubApi();

    renderWithProviders(<CaptureButton />);

    await userEvent.click(screen.getByRole('button', { name: 'Capturar agora' }));

    await waitFor(() => expect(spy).toHaveBeenCalled());

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('/api/capture/run');
    expect(init.method).toBe('POST');
  });

  it('desabilita o botao e avisa enquanto captura', async () => {
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await pending;

        return jsonResponse(RESULT);
      }),
    );

    renderWithProviders(<CaptureButton />);

    await userEvent.click(screen.getByRole('button', { name: 'Capturar agora' }));

    const capturando = await screen.findByRole('button', { name: 'Capturando...' });

    expect(capturando).toBeDisabled();

    release();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Capturar agora' })).toBeEnabled(),
    );
  });

  it('resume o resultado da captura', async () => {
    stubApi();

    renderWithProviders(<CaptureButton />);

    await userEvent.click(screen.getByRole('button', { name: 'Capturar agora' }));

    const resultado = await screen.findByTestId('capture-result');

    expect(resultado).toHaveTextContent('280 publicacoes varridas');
    expect(resultado).toHaveTextContent('18 vaga(s) nova(s)');
  });

  it('avisa quando nenhuma vaga nova entrou', async () => {
    stubApi({ ...RESULT, totalPersisted: 0 });

    renderWithProviders(<CaptureButton />);

    await userEvent.click(screen.getByRole('button', { name: 'Capturar agora' }));

    expect(await screen.findByTestId('capture-result')).toHaveTextContent('nenhuma vaga nova');
  });

  it('destaca as fontes que falharam', async () => {
    stubApi({ ...RESULT, failedSources: ['linkedin', 'gupy'] });

    renderWithProviders(<CaptureButton />);

    await userEvent.click(screen.getByRole('button', { name: 'Capturar agora' }));

    expect(await screen.findByTestId('capture-result')).toHaveTextContent(
      'falhou: linkedin, gupy',
    );
  });

  it('atualiza as telas que dependem das vagas', async () => {
    stubApi();
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    renderWithProviders(<CaptureButton />, { queryClient });

    await userEvent.click(screen.getByRole('button', { name: 'Capturar agora' }));

    await waitFor(() => expect(invalidate).toHaveBeenCalled());

    const chaves = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));

    expect(chaves).toEqual(
      expect.arrayContaining(['["dashboard"]', '["jobs"]', '["market"]']),
    );
  });

  it('mostra o erro quando a captura falha', async () => {
    stubApi({ message: 'banco indisponivel' }, 500);

    renderWithProviders(<CaptureButton />);

    await userEvent.click(screen.getByRole('button', { name: 'Capturar agora' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('banco indisponivel');
    expect(screen.queryByTestId('capture-result')).not.toBeInTheDocument();
  });

  it('cai na mensagem padrao quando o erro nao traz texto', async () => {
    stubApi({}, 503);

    renderWithProviders(<CaptureButton />);

    await userEvent.click(screen.getByRole('button', { name: 'Capturar agora' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Falha ao capturar vagas (503)',
    );
  });
});

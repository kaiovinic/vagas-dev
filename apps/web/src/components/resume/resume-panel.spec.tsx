import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { JobListItem } from '@/api/schemas';
import { ResumePanel } from '@/components/resume/resume-panel';
import { jsonResponse, renderWithProviders } from '../../../test/render';

function job(overrides: Partial<JobListItem> = {}): JobListItem {
  return {
    id: 'job-1',
    fingerprint: 'a'.repeat(64),
    title: 'Pessoa Desenvolvedora React',
    company: 'Acme Corp',
    recruiterName: null,
    source: 'gupy',
    city: 'Salvador/BA',
    isRemote: true,
    scope: 'NATIONAL',
    workModel: 'REMOTE',
    url: 'https://gupy.io/vagas/1',
    tags: ['React'],
    description: 'Vaga de React.',
    publishedAt: new Date('2026-11-01T12:00:00.000Z').toISOString(),
    publishedAtSource: 'SOURCE',
    ...overrides,
  };
}

const RESUME = {
  markdown: '# Kaio Vinicius\n\n## Experiencia\n- Frontend na Acme',
  rationale: ['Abri pela Acme porque a vaga pede React.'],
  gaps: ['Nao tem experiencia com Angular.'],
  model: 'claude-opus-5-5',
  generatedAt: '2026-11-01T18:30:00.000Z',
  generated: true,
};

/** O corpo que o `postJson` montou, para o teste conferir o que foi pedido. */
function sentBody(init: RequestInit): unknown {
  return JSON.parse(typeof init.body === 'string' ? init.body : '{}');
}

function errorResponse(status: number, message: string): Response {
  return jsonResponse({ statusCode: status, error: 'erro', message }, status);
}

describe('ResumePanel', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(RESUME));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup(): void {
    renderWithProviders(<ResumePanel job={job()} />);
  }

  async function generate(): Promise<void> {
    await userEvent.click(screen.getByRole('button', { name: /Gerar curriculo sob medida/ }));
  }

  it('nao chama a API ao montar: geracao custa dinheiro', () => {
    setup();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('resume-result')).not.toBeInTheDocument();
  });

  it('pede a geracao da vaga aberta, sem regerar', async () => {
    setup();
    await generate();

    await waitFor(() => expect(screen.getByTestId('resume-result')).toBeInTheDocument());

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(path).toBe('/api/resume/generate');
    expect(init.method).toBe('POST');
    expect(sentBody(init)).toEqual({ jobId: 'job-1', regenerate: false });
  });

  it('mostra o curriculo renderizado, as lacunas e o modelo que gerou', async () => {
    setup();
    await generate();

    await waitFor(() => expect(screen.getByTestId('resume-result')).toBeInTheDocument());

    expect(screen.getByRole('heading', { name: 'Kaio Vinicius' })).toBeInTheDocument();
    expect(screen.getByText('Frontend na Acme')).toBeInTheDocument();
    expect(screen.getByText('O que ficou de fora')).toBeInTheDocument();
    expect(screen.getByText('Nao tem experiencia com Angular.')).toBeInTheDocument();
    expect(screen.getByText(/claude-opus-5-5/)).toBeInTheDocument();
  });

  it('guarda o porque atras de um clique, que e o detalhe secundario', async () => {
    setup();
    await generate();

    await waitFor(() => expect(screen.getByTestId('resume-result')).toBeInTheDocument());

    const detalhes = screen.getByText('Como foi montado').closest('details');

    expect(detalhes).not.toBeNull();
    expect(detalhes?.open).toBe(false);
    expect(screen.getByText('Abri pela Acme porque a vaga pede React.')).toBeInTheDocument();
  });

  it('diz que o perfil cobre tudo quando nao ha lacuna', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...RESUME, gaps: [] }));
    setup();
    await generate();

    await waitFor(() =>
      expect(screen.getByTestId('resume-gaps')).toHaveTextContent(/cobre todos os requisitos/),
    );
  });

  it('avisa quando a versao veio do historico, e nao da geracao agora', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...RESUME, generated: false }));
    setup();
    await generate();

    await waitFor(() => expect(screen.getByText(/Versao salva/)).toBeInTheDocument());
  });

  it('mostra o esqueleto enquanto a geracao nao volta', async () => {
    let resolve: (response: Response) => void = () => {};

    fetchMock.mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    setup();
    await generate();

    expect(screen.getByTestId('resume-skeleton')).toBeInTheDocument();

    resolve(jsonResponse(RESUME));

    await waitFor(() => expect(screen.getByTestId('resume-result')).toBeInTheDocument());
    expect(screen.queryByTestId('resume-skeleton')).not.toBeInTheDocument();
  });

  it('copia o Markdown e confirma ao usuario', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal('navigator', { clipboard: { writeText } });
    setup();
    await generate();

    await waitFor(() => expect(screen.getByTestId('resume-result')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Copiar Markdown/ }));

    expect(writeText).toHaveBeenCalledWith(RESUME.markdown);
    await waitFor(() => expect(screen.getByTestId('toast')).toBeInTheDocument());
  });

  it('o segundo pedido e explicito: so "gerar outra versao" paga de novo', async () => {
    setup();
    await generate();

    await waitFor(() => expect(screen.getByTestId('resume-result')).toBeInTheDocument());
    expect(
      screen.queryByRole('button', { name: /Gerar curriculo sob medida/ }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Gerar outra versao/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];

    expect(sentBody(init)).toEqual({ jobId: 'job-1', regenerate: true });
  });

  it('404: a vaga saiu do radar', async () => {
    fetchMock.mockResolvedValue(errorResponse(404, 'Vaga job-1 nao encontrada'));
    setup();
    await generate();

    await waitFor(() => expect(screen.getByTestId('resume-error')).toBeInTheDocument());
    expect(screen.getByText('Essa vaga saiu do radar')).toBeInTheDocument();
    expect(screen.getByText('Vaga job-1 nao encontrada')).toBeInTheDocument();
  });

  it('422: leva o usuario para completar o perfil', async () => {
    fetchMock.mockResolvedValue(errorResponse(422, 'Preencha a aba Perfil'));
    setup();
    await generate();

    await waitFor(() => expect(screen.getByText('Perfil incompleto')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Completar o perfil' })).toHaveAttribute(
      'href',
      '/perfil',
    );
  });

  it('502: a falha e do provedor, e o botao segue disponivel', async () => {
    fetchMock.mockResolvedValue(errorResponse(502, 'A geracao falhou na Anthropic (HTTP 401)'));
    setup();
    await generate();

    await waitFor(() =>
      expect(screen.getByText('A geracao falhou no provedor')).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: /Gerar curriculo sob medida/ }),
    ).toBeEnabled();
  });

  it('erro sem status conhecido cai na mensagem generica', async () => {
    fetchMock.mockRejectedValue(new Error('rede fora'));
    setup();
    await generate();

    await waitFor(() =>
      expect(screen.getByText('Nao foi possivel gerar o curriculo')).toBeInTheDocument(),
    );
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PublicationTesterForm } from '@/components/rules/publication-tester-form';
import { jsonResponse, renderWithProviders } from '../../../test/render';

const APPROVED = {
  approved: true,
  rejectionReasons: [],
  matchedStack: ['React', 'Frontend'],
  matchedLocations: ['Remoto'],
  matchedSpamTerms: [],
  evaluated: {
    title: 'Pessoa Desenvolvedora Frontend React',
    company: 'Empresa nao informada',
    location: '',
    workModel: 'UNKNOWN',
    publishedAt: '2026-10-26T12:00:00.000Z',
    url: 'https://devradar.local/teste-de-regras',
  },
};

const REJECTED = {
  ...APPROVED,
  approved: false,
  rejectionReasons: ['SPAM_DETECTED', 'LOCATION_NOT_ALLOWED'],
  matchedStack: ['React'],
  matchedLocations: [],
  matchedSpamTerms: ['Bootcamp', 'Mentoria'],
};

function stubPost(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const spy = vi.fn(() => Promise.resolve(jsonResponse(body, status)));

  vi.stubGlobal('fetch', spy);

  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const VALID_TEXT = 'Vaga para Pessoa Desenvolvedora Frontend React, 100% remota.';

describe('PublicationTesterForm', () => {
  it('renderiza o formulario do testador', () => {
    stubPost(APPROVED);

    renderWithProviders(<PublicationTesterForm />);

    expect(screen.getByRole('form', { name: 'Testador de publicacao' })).toBeInTheDocument();
    expect(screen.getByLabelText('Texto da publicacao')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validar Regra' })).toBeInTheDocument();
  });

  it('envia o texto colado para POST /api/rules/test', async () => {
    const spy = stubPost(APPROVED);

    renderWithProviders(<PublicationTesterForm />);

    await userEvent.type(screen.getByLabelText('Texto da publicacao'), VALID_TEXT);
    await userEvent.click(screen.getByRole('button', { name: 'Validar Regra' }));

    await waitFor(() => expect(spy).toHaveBeenCalled());

    const [url, init] = spy.mock.calls[0] as [string, RequestInit & { body: string }];

    expect(url).toBe('/api/rules/test');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ text: VALID_TEXT });
  });

  it('envia tambem os campos opcionais preenchidos', async () => {
    const spy = stubPost(APPROVED);

    renderWithProviders(<PublicationTesterForm />);

    await userEvent.type(screen.getByLabelText('Texto da publicacao'), VALID_TEXT);
    await userEvent.type(screen.getByLabelText('Empresa (opcional)'), 'Acme Corp');
    await userEvent.type(screen.getByLabelText('Localidade (opcional)'), 'Salvador/BA');
    await userEvent.click(screen.getByRole('button', { name: 'Validar Regra' }));

    await waitFor(() => expect(spy).toHaveBeenCalled());

    const [, init] = spy.mock.calls[0] as [string, RequestInit & { body: string }];

    expect(JSON.parse(String(init.body))).toEqual({
      text: VALID_TEXT,
      company: 'Acme Corp',
      location: 'Salvador/BA',
    });
  });

  it('omite os campos opcionais vazios', async () => {
    const spy = stubPost(APPROVED);

    renderWithProviders(<PublicationTesterForm />);

    await userEvent.type(screen.getByLabelText('Texto da publicacao'), VALID_TEXT);
    await userEvent.click(screen.getByRole('button', { name: 'Validar Regra' }));

    await waitFor(() => expect(spy).toHaveBeenCalled());

    const [, init] = spy.mock.calls[0] as [string, RequestInit & { body: string }];

    expect(Object.keys(JSON.parse(String(init.body)))).toEqual(['text']);
  });

  it('mostra os termos que deram match quando a vaga passa', async () => {
    stubPost(APPROVED);

    renderWithProviders(<PublicationTesterForm />);

    await userEvent.type(screen.getByLabelText('Texto da publicacao'), VALID_TEXT);
    await userEvent.click(screen.getByRole('button', { name: 'Validar Regra' }));

    const result = await screen.findByTestId('tester-result');

    expect(result).toHaveTextContent('Passaria no filtro');
    expect(result).toHaveTextContent('React');
    expect(result).toHaveTextContent('Frontend');
    expect(result).toHaveTextContent('Remoto');
    expect(screen.queryByTestId('rejection-reasons')).not.toBeInTheDocument();
  });

  it('mostra qual regra bloqueou quando a vaga e descartada', async () => {
    stubPost(REJECTED);

    renderWithProviders(<PublicationTesterForm />);

    await userEvent.type(screen.getByLabelText('Texto da publicacao'), 'Bootcamp com mentoria');
    await userEvent.click(screen.getByRole('button', { name: 'Validar Regra' }));

    const result = await screen.findByTestId('tester-result');

    expect(result).toHaveTextContent('Seria descartada');
    expect(screen.getByTestId('rejection-reasons')).toHaveTextContent(
      'Bloqueada pelo filtro anti-spam',
    );
    expect(screen.getByTestId('rejection-reasons')).toHaveTextContent(
      'Nao e remota nem de Salvador/RMS',
    );
  });

  it('lista os termos de spam que bloquearam a publicacao', async () => {
    stubPost(REJECTED);

    renderWithProviders(<PublicationTesterForm />);

    await userEvent.type(screen.getByLabelText('Texto da publicacao'), 'Bootcamp com mentoria');
    await userEvent.click(screen.getByRole('button', { name: 'Validar Regra' }));

    const result = await screen.findByTestId('tester-result');

    expect(result).toHaveTextContent('Termos bloqueados');
    expect(result).toHaveTextContent('Bootcamp');
    expect(result).toHaveTextContent('Mentoria');
  });

  it('avisa quando nao ha localidade aceita', async () => {
    stubPost(REJECTED);

    renderWithProviders(<PublicationTesterForm />);

    await userEvent.type(screen.getByLabelText('Texto da publicacao'), 'Bootcamp com mentoria');
    await userEvent.click(screen.getByRole('button', { name: 'Validar Regra' }));

    const result = await screen.findByTestId('tester-result');

    expect(result).toHaveTextContent('Nenhum');
  });

  it('valida no cliente antes de chamar a api', async () => {
    const spy = stubPost(APPROVED);

    renderWithProviders(<PublicationTesterForm />);

    await userEvent.type(screen.getByLabelText('Texto da publicacao'), 'curto');
    await userEvent.click(screen.getByRole('button', { name: 'Validar Regra' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Cole ao menos 10 caracteres');
    expect(spy).not.toHaveBeenCalled();
  });

  it('aceita apenas o link, sem texto colado', async () => {
    const spy = stubPost(APPROVED);

    renderWithProviders(<PublicationTesterForm />);

    await userEvent.type(
      screen.getByLabelText('Link da vaga (opcional)'),
      'https://gupy.io/vagas/1',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Validar Regra' }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('mostra a mensagem de erro da api', async () => {
    stubPost({ message: 'Parametros invalidos' }, 400);

    renderWithProviders(<PublicationTesterForm />);

    await userEvent.type(screen.getByLabelText('Texto da publicacao'), VALID_TEXT);
    await userEvent.click(screen.getByRole('button', { name: 'Validar Regra' }));

    await waitFor(() =>
      expect(screen.getByText('Nao foi possivel validar a publicacao')).toBeInTheDocument(),
    );
    expect(screen.getByText('Parametros invalidos')).toBeInTheDocument();
    expect(screen.queryByTestId('tester-result')).not.toBeInTheDocument();
  });

  it('cai na mensagem padrao quando o erro nao traz texto', async () => {
    stubPost({}, 500);

    renderWithProviders(<PublicationTesterForm />);

    await userEvent.type(screen.getByLabelText('Texto da publicacao'), VALID_TEXT);
    await userEvent.click(screen.getByRole('button', { name: 'Validar Regra' }));

    await waitFor(() =>
      expect(screen.getByText(/Falha ao validar a publicacao \(500\)/)).toBeInTheDocument(),
    );
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { CandidateProfileResponse } from '@/api/schemas';
import { ProfilePage } from '@/pages/profile-page';
import { jsonResponse, renderWithProviders } from '../../test/render';

const PROFILE: CandidateProfileResponse = {
  isUsableForResume: true,
  profile: {
    fullName: 'Kaio Vinicius',
    headline: 'Desenvolvedor Frontend',
    summary: 'Interfaces em React e TypeScript.',
    email: 'kaio@example.com',
    city: 'Salvador, BA',
    phone: null,
    linkedinUrl: 'https://linkedin.com/in/kaio',
    githubUrl: null,
    portfolioUrl: null,
    experiences: [
      {
        company: 'Acme',
        role: 'Frontend',
        startedAt: '2022-01',
        endedAt: null,
        description: 'Painel de metricas.',
        techs: ['React', 'TypeScript'],
      },
    ],
    education: [
      { institution: 'UFBA', degree: 'Sistemas de Informacao', startedAt: '2016-02', endedAt: '2020-12' },
    ],
    skills: [{ category: 'Frontend', items: ['React', 'Next.js'] }],
    projects: [],
  },
};

const EMPTY: CandidateProfileResponse = { profile: null, isUsableForResume: false };

function stubApi(response: unknown = PROFILE, status = 200): ReturnType<typeof vi.fn> {
  const spy = vi.fn((_url: string, init?: RequestInit) =>
    Promise.resolve(
      init?.method === 'PUT'
        ? jsonResponse({ ...PROFILE, isUsableForResume: true })
        : jsonResponse(response, status),
    ),
  );

  vi.stubGlobal('fetch', spy);

  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProfilePage', () => {
  it('consome /api/profile', async () => {
    const spy = stubApi();

    renderWithProviders(<ProfilePage />);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]?.[0]).toBe('/api/profile');
  });

  it('mostra o skeleton enquanto o perfil nao chega', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));

    renderWithProviders(<ProfilePage />);

    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });

  it('preenche o formulario com o perfil salvo, juntando as techs por virgula', async () => {
    stubApi();

    renderWithProviders(<ProfilePage />);

    expect(await screen.findByDisplayValue('Kaio Vinicius')).toBeInTheDocument();
    expect(screen.getByDisplayValue('React, TypeScript')).toBeInTheDocument();
    expect(screen.getByDisplayValue('React, Next.js')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://linkedin.com/in/kaio')).toBeInTheDocument();
  });

  it('avisa que o perfil ja serve para gerar curriculo', async () => {
    stubApi();

    renderWithProviders(<ProfilePage />);

    await waitFor(() =>
      expect(screen.getByTestId('profile-readiness')).toHaveTextContent(/pronto para gerar/i),
    );
  });

  it('avisa o que falta quando o perfil esta vazio', async () => {
    stubApi(EMPTY);

    renderWithProviders(<ProfilePage />);

    await waitFor(() =>
      expect(screen.getByTestId('profile-readiness')).toHaveTextContent(
        /ao menos uma experiencia/i,
      ),
    );
    expect(screen.getByText(/Nenhuma experiencia informada/i)).toBeInTheDocument();
  });

  it('mostra o erro quando a leitura do perfil falha', async () => {
    stubApi({ message: 'banco indisponivel' }, 500);

    renderWithProviders(<ProfilePage />);

    expect(await screen.findByText('Nao foi possivel carregar o perfil')).toBeInTheDocument();
  });

  it('adiciona e remove experiencia sem recarregar a pagina', async () => {
    stubApi(EMPTY);
    const user = userEvent.setup();

    renderWithProviders(<ProfilePage />);

    await user.click(await screen.findByRole('button', { name: /Adicionar experiencia/i }));

    expect(screen.getByText('Experiencia 1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remover Experiencia 1' }));

    expect(screen.queryByText('Experiencia 1')).not.toBeInTheDocument();
    expect(screen.getByText(/Nenhuma experiencia informada/i)).toBeInTheDocument();
  });

  it('adiciona e remove formacao, grupo de competencia e projeto', async () => {
    stubApi(EMPTY);
    const user = userEvent.setup();

    renderWithProviders(<ProfilePage />);

    await user.click(await screen.findByRole('button', { name: /Adicionar formacao/i }));
    await user.click(screen.getByRole('button', { name: /Adicionar grupo/i }));
    await user.click(screen.getByRole('button', { name: /Adicionar projeto/i }));

    expect(screen.getByText('Formacao 1')).toBeInTheDocument();
    expect(screen.getByText('Grupo 1')).toBeInTheDocument();
    expect(screen.getByText('Projeto 1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remover Grupo 1' }));

    expect(screen.queryByText('Grupo 1')).not.toBeInTheDocument();
  });

  it('barra a submissao e aponta o campo invalido, sem chamar a API', async () => {
    const spy = stubApi(EMPTY);
    const user = userEvent.setup();

    renderWithProviders(<ProfilePage />);

    await user.click(await screen.findByRole('button', { name: 'Salvar perfil' }));

    expect(await screen.findByText('Informe o nome completo')).toBeInTheDocument();
    expect(screen.getByText('Informe um e-mail valido')).toBeInTheDocument();
    expect(spy.mock.calls.filter((call) => call[1]?.method === 'PUT')).toHaveLength(0);
  });

  it('cobra o formato AAAA-MM do periodo da experiencia', async () => {
    stubApi(EMPTY);
    const user = userEvent.setup();

    renderWithProviders(<ProfilePage />);

    await user.click(await screen.findByRole('button', { name: /Adicionar experiencia/i }));
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    expect(await screen.findByText('Use o formato AAAA-MM')).toBeInTheDocument();
  });

  it('salva o perfil inteiro no PUT e confirma com o toast', async () => {
    const spy = stubApi();
    const user = userEvent.setup();

    renderWithProviders(<ProfilePage />);

    await user.clear(await screen.findByDisplayValue('Desenvolvedor Frontend'));
    await user.type(screen.getByLabelText('Titulo profissional'), 'Desenvolvedor Fullstack');
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    expect(await screen.findByTestId('toast')).toHaveTextContent('Perfil salvo');

    const put = spy.mock.calls.find((call) => call[1]?.method === 'PUT');
    const body = JSON.parse(String(put?.[1]?.body)) as Record<string, unknown>;

    expect(put?.[0]).toBe('/api/profile');
    expect(body).toMatchObject({
      headline: 'Desenvolvedor Fullstack',
      phone: null,
      githubUrl: null,
      experiences: [expect.objectContaining({ techs: ['React', 'TypeScript'], endedAt: null })],
      skills: [{ category: 'Frontend', items: ['React', 'Next.js'] }],
    });
  });

  it('mostra o erro quando a gravacao falha', async () => {
    const spy = vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'PUT'
          ? jsonResponse({ message: 'email must be a valid e-mail address' }, 400)
          : jsonResponse(PROFILE),
      ),
    );

    vi.stubGlobal('fetch', spy);

    const user = userEvent.setup();

    renderWithProviders(<ProfilePage />);

    await user.click(await screen.findByRole('button', { name: 'Salvar perfil' }));

    const panel = await screen.findByText('Nao foi possivel salvar o perfil');

    expect(within(panel.parentElement as HTMLElement).getByText(/valid e-mail/)).toBeInTheDocument();
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
  });
});

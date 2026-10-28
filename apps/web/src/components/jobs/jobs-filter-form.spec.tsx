import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  EMPTY_JOBS_FILTER,
  JobsFilterForm,
  toJobsListFilters,
  type JobsFilterValues,
} from '@/components/jobs/jobs-filter-form';

function setup(): { onSubmit: ReturnType<typeof vi.fn> } {
  const onSubmit = vi.fn();

  render(<JobsFilterForm onSubmit={onSubmit} />);

  return { onSubmit };
}

function lastValues(onSubmit: ReturnType<typeof vi.fn>): JobsFilterValues {
  const call = onSubmit.mock.calls.at(-1);

  if (call === undefined) {
    throw new Error('onSubmit nao foi chamado');
  }

  return call[0] as JobsFilterValues;
}

describe('JobsFilterForm', () => {
  it('renderiza todos os campos do filtro avancado', () => {
    setup();

    expect(screen.getByRole('form', { name: 'Filtro avancado de vagas' })).toBeInTheDocument();
    expect(screen.getByLabelText('Busca')).toBeInTheDocument();
    expect(screen.getByLabelText('Fonte')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Tecnologias' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Modalidade' })).toBeInTheDocument();
  });

  it('oferece as cinco tecnologias como selecao multipla', () => {
    setup();

    for (const technology of ['React', 'Next.js', 'Node.js', 'TypeScript', '.NET']) {
      expect(screen.getByRole('checkbox', { name: technology })).toBeInTheDocument();
    }
  });

  it('oferece os quatro niveis de senioridade', () => {
    setup();

    expect(screen.getByRole('group', { name: 'Senioridade' })).toBeInTheDocument();
    for (const level of ['Estagio', 'Junior', 'Pleno', 'Senior']) {
      expect(screen.getByRole('checkbox', { name: level })).toBeInTheDocument();
    }
  });

  it('aplica a senioridade assim que ela e marcada', async () => {
    const { onSubmit } = setup();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Pleno' }));

    await waitFor(() => expect(lastValues(onSubmit).seniorities).toEqual(['MID']));
  });

  it('acumula varios niveis de senioridade', async () => {
    const { onSubmit } = setup();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Junior' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Senior' }));

    await waitFor(() =>
      expect(lastValues(onSubmit).seniorities).toEqual(['JUNIOR', 'SENIOR']),
    );
  });

  it('oferece o filtro de mercado, com Todas marcado por padrao', () => {
    setup();

    expect(screen.getByRole('group', { name: 'Mercado' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Todos' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Nacionais' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Internacionais' })).toBeInTheDocument();
  });

  it('aplica o mercado assim que ele muda', async () => {
    const { onSubmit } = setup();

    await userEvent.click(screen.getByRole('radio', { name: 'Internacionais' }));

    await waitFor(() => expect(lastValues(onSubmit).scope).toBe('INTERNATIONAL'));
  });

  it('oferece as tres modalidades, com Todas marcada por padrao', () => {
    setup();

    expect(screen.getByRole('radio', { name: 'Todas' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Apenas Remoto' })).not.toBeChecked();
    expect(
      screen.getByRole('radio', { name: 'Apenas Salvador/Presencial/Hibrido' }),
    ).toBeInTheDocument();
  });

  it('lista as fontes de captura', () => {
    setup();

    for (const source of ['LinkedIn', 'Gupy', 'GitHub', 'Remotar', 'ProgramaThor']) {
      expect(screen.getByRole('option', { name: source })).toBeInTheDocument();
    }
    expect(screen.getByRole('option', { name: 'Todas as fontes' })).toBeInTheDocument();
  });

  it('submete a busca textual pelo botao Filtrar', async () => {
    const { onSubmit } = setup();

    await userEvent.type(screen.getByLabelText('Busca'), 'react pleno');
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(lastValues(onSubmit).search).toBe('react pleno');
  });

  it('nao submete a cada tecla digitada na busca', async () => {
    const { onSubmit } = setup();

    await userEvent.type(screen.getByLabelText('Busca'), 'react');

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('aplica a tecnologia assim que ela e marcada', async () => {
    const { onSubmit } = setup();

    await userEvent.click(screen.getByRole('checkbox', { name: 'React' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(lastValues(onSubmit).technologies).toEqual(['React']);
  });

  it('acumula varias tecnologias marcadas', async () => {
    const { onSubmit } = setup();

    await userEvent.click(screen.getByRole('checkbox', { name: 'React' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Node.js' }));

    await waitFor(() => expect(lastValues(onSubmit).technologies).toEqual(['React', 'Node.js']));
  });

  it('remove a tecnologia desmarcada', async () => {
    const { onSubmit } = setup();

    const react = screen.getByRole('checkbox', { name: 'React' });

    await userEvent.click(react);
    await userEvent.click(react);

    await waitFor(() => expect(lastValues(onSubmit).technologies).toEqual([]));
  });

  it('aplica a modalidade assim que ela muda', async () => {
    const { onSubmit } = setup();

    await userEvent.click(screen.getByRole('radio', { name: 'Apenas Remoto' }));

    await waitFor(() => expect(lastValues(onSubmit).workMode).toBe('remote'));
  });

  it('aplica a fonte assim que ela muda', async () => {
    const { onSubmit } = setup();

    await userEvent.selectOptions(screen.getByLabelText('Fonte'), 'gupy');

    await waitFor(() => expect(lastValues(onSubmit).source).toBe('gupy'));
  });

  it('recusa busca acima de 120 caracteres', async () => {
    const { onSubmit } = setup();

    await userEvent.type(screen.getByLabelText('Busca'), 'a'.repeat(121));
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('no maximo 120 caracteres');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Busca')).toHaveAttribute('aria-invalid', 'true');
  });

  it('comeca com o botao Limpar desabilitado', () => {
    setup();

    expect(screen.getByRole('button', { name: /Limpar/ })).toBeDisabled();
  });

  it('limpa todos os campos e reaplica o filtro vazio', async () => {
    const { onSubmit } = setup();

    await userEvent.click(screen.getByRole('checkbox', { name: 'React' }));
    await userEvent.type(screen.getByLabelText('Busca'), 'angular');

    await userEvent.click(screen.getByRole('button', { name: /Limpar/ }));

    expect(screen.getByLabelText('Busca')).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: 'React' })).not.toBeChecked();
    expect(lastValues(onSubmit)).toEqual(EMPTY_JOBS_FILTER);
  });

  it('desabilita o botao Filtrar durante o carregamento', () => {
    render(<JobsFilterForm onSubmit={vi.fn()} isLoading />);

    expect(screen.getByRole('button', { name: 'Filtrar' })).toBeDisabled();
  });
});

describe('toJobsListFilters', () => {
  it('converte o filtro vazio em ausencia de query params', () => {
    expect(toJobsListFilters(EMPTY_JOBS_FILTER)).toEqual({
      search: undefined,
      technologies: undefined,
      seniorities: undefined,
      source: undefined,
      isRemote: undefined,
      scope: undefined,
    });
  });

  it.each([
    ['NATIONAL', 'NATIONAL'],
    ['INTERNATIONAL', 'INTERNATIONAL'],
  ] as const)('repassa o mercado %s', (scope, esperado) => {
    expect(toJobsListFilters({ ...EMPTY_JOBS_FILTER, scope }).scope).toBe(esperado);
  });

  it('trata "Todas" como ausencia de filtro de mercado', () => {
    expect(toJobsListFilters(EMPTY_JOBS_FILTER).scope).toBeUndefined();
  });

  it('repassa os niveis de senioridade marcados', () => {
    expect(
      toJobsListFilters({ ...EMPTY_JOBS_FILTER, seniorities: ['MID', 'SENIOR'] }).seniorities,
    ).toEqual(['MID', 'SENIOR']);
  });

  it('limpa espacos da busca', () => {
    expect(toJobsListFilters({ ...EMPTY_JOBS_FILTER, search: '  react  ' }).search).toBe('react');
  });

  it('descarta busca so com espacos', () => {
    expect(toJobsListFilters({ ...EMPTY_JOBS_FILTER, search: '   ' }).search).toBeUndefined();
  });

  it('repassa as tecnologias marcadas', () => {
    expect(
      toJobsListFilters({ ...EMPTY_JOBS_FILTER, technologies: ['React', '.NET'] }).technologies,
    ).toEqual(['React', '.NET']);
  });

  it.each([
    ['all', undefined],
    ['remote', true],
    ['local', false],
  ] as const)('traduz a modalidade %s em isRemote=%s', (workMode, expected) => {
    expect(toJobsListFilters({ ...EMPTY_JOBS_FILTER, workMode }).isRemote).toBe(expected);
  });

  it('repassa a fonte selecionada', () => {
    expect(toJobsListFilters({ ...EMPTY_JOBS_FILTER, source: 'gupy' }).source).toBe('gupy');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { JobListItem } from '@/api/schemas';
import { JobDetail } from '@/components/jobs/job-detail';
import { JobDetailDrawer } from '@/components/jobs/job-detail-drawer';
import { AgeBadge, JobFeedCard } from '@/components/jobs/job-feed-card';
import {
  DEFAULT_TIME_WINDOW,
  JobsControlBar,
  TIME_WINDOWS,
} from '@/components/jobs/jobs-control-bar';

function job(overrides: Partial<JobListItem> = {}): JobListItem {
  return {
    id: 'job-1',
    fingerprint: 'a'.repeat(64),
    title: 'Pessoa Desenvolvedora React',
    company: 'Acme Corp',
    recruiterName: null,
    source: 'gupy',
    city: 'Salvador/BA',
    isRemote: false,
    scope: 'NATIONAL',
    workModel: 'ONSITE',
    url: 'https://gupy.io/vagas/1',
    tags: ['React', 'TypeScript'],
    description: 'Trabalhar com React no time de produto.',
    publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    publishedAtSource: 'SOURCE',
    ...overrides,
  };
}

describe('JobsControlBar', () => {
  function setup(window = DEFAULT_TIME_WINDOW) {
    const onWindowChange = vi.fn();
    const onLiveChange = vi.fn();

    render(
      <JobsControlBar
        window={window}
        onWindowChange={onWindowChange}
        isLive={false}
        onLiveChange={onLiveChange}
        total={12}
      />,
    );

    return { onWindowChange, onLiveChange };
  }

  it('oferece os seis recortes de tempo, incluindo os 7 dias', () => {
    setup();

    expect(TIME_WINDOWS.map((option) => option.label)).toEqual([
      '1h',
      '6h',
      '24h',
      '48h',
      '72h',
      '7d',
    ]);

    for (const option of TIME_WINDOWS) {
      expect(screen.getByRole('radio', { name: option.label })).toBeInTheDocument();
    }
  });

  it('comeca na janela de 72h, a mesma do radar', () => {
    setup();

    expect(DEFAULT_TIME_WINDOW).toBe(72);
    expect(screen.getByRole('radio', { name: '72h' })).toBeChecked();
  });

  it('avisa a troca de recorte', async () => {
    const { onWindowChange } = setup();

    await userEvent.click(screen.getByRole('radio', { name: '24h' }));

    expect(onWindowChange).toHaveBeenCalledWith(24);
  });

  // 7 dias passa das 72h do radar: mostra o que ja foi capturado e envelheceu.
  it('pede as 168h ao escolher 7 dias', async () => {
    const { onWindowChange } = setup();

    await userEvent.click(screen.getByRole('radio', { name: '7d' }));

    expect(onWindowChange).toHaveBeenCalledWith(168);
  });

  it('mostra o total dentro do recorte', () => {
    setup();

    expect(screen.getByText('12 no recorte')).toBeInTheDocument();
  });

  it('liga o radar pelo toggle', async () => {
    const { onLiveChange } = setup();

    await userEvent.click(screen.getByRole('checkbox'));

    expect(onLiveChange).toHaveBeenCalledWith(true);
  });

  it('nao pulsa com o radar pausado', () => {
    setup();

    expect(screen.getByText('Radar pausado')).toBeInTheDocument();
    expect(screen.queryByTestId('pulse-dot')).not.toBeInTheDocument();
  });

  it('pulsa com o radar ativo', () => {
    render(
      <JobsControlBar
        window={72}
        onWindowChange={vi.fn()}
        isLive
        onLiveChange={vi.fn()}
        total={0}
      />,
    );

    expect(screen.getByText('Radar ativo')).toBeInTheDocument();
    expect(screen.getByTestId('pulse-dot')).toBeInTheDocument();
  });
});

describe('JobFeedCard', () => {
  it('mostra o essencial para escanear a lista', () => {
    render(<JobFeedCard job={job()} isActive={false} onSelect={vi.fn()} />);

    const card = screen.getByTestId('job-card-job-1');

    expect(card).toHaveTextContent('Pessoa Desenvolvedora React');
    expect(card).toHaveTextContent('Acme Corp');
    expect(card).toHaveTextContent('Gupy');
    expect(card).toHaveTextContent('ha 2 h');
  });

  it('marca vaga da regiao com a cidade', () => {
    render(<JobFeedCard job={job()} isActive={false} onSelect={vi.fn()} />);

    expect(screen.getByText('Salvador/BA')).toBeInTheDocument();
  });

  it('marca vaga remota como Remoto BR', () => {
    render(<JobFeedCard job={job({ isRemote: true })} isActive={false} onSelect={vi.fn()} />);

    expect(screen.getByText('Remoto BR')).toBeInTheDocument();
  });

  it('cai para Bahia quando a cidade nao veio', () => {
    render(
      <JobFeedCard job={job({ isRemote: false, city: null })} isActive={false} onSelect={vi.fn()} />,
    );

    expect(screen.getByText('Bahia')).toBeInTheDocument();
  });

  it('corta as etiquetas e conta o resto', () => {
    const muitas = job({ tags: ['React', 'Node.js', 'TypeScript', 'Angular', '.NET'] });

    render(<JobFeedCard job={muitas} isActive={false} onSelect={vi.fn()} />);

    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.queryByText('.NET')).not.toBeInTheDocument();
  });

  it('avisa a selecao no clique', async () => {
    const onSelect = vi.fn();

    render(<JobFeedCard job={job()} isActive={false} onSelect={onSelect} />);
    await userEvent.click(screen.getByTestId('job-card-job-1'));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }));
  });

  it('anuncia o card ativo para a tecnologia assistiva', () => {
    render(<JobFeedCard job={job()} isActive onSelect={vi.fn()} />);

    expect(screen.getByTestId('job-card-job-1')).toHaveAttribute('aria-current', 'true');
  });
});

describe('JobDetail', () => {
  it('convida a escolher uma vaga quando nao ha selecao', () => {
    render(<JobDetail job={null} />);

    expect(screen.getByText('Selecione uma vaga')).toBeInTheDocument();
  });

  it('leva o botao de candidatura para a fonte original', () => {
    render(<JobDetail job={job()} />);

    const link = screen.getByRole('link', { name: /Candidatar-se na fonte original/ });

    expect(link).toHaveAttribute('href', 'https://gupy.io/vagas/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('organiza os metadados da vaga', () => {
    render(<JobDetail job={job()} />);

    const detalhe = screen.getByTestId('job-detail');

    expect(detalhe).toHaveTextContent('Gupy');
    expect(detalhe).toHaveTextContent('Nacional');
    expect(detalhe).toHaveTextContent('Presencial');
  });

  it('mostra a descricao da vaga', () => {
    render(<JobDetail job={job()} />);

    expect(screen.getByText('Trabalhar com React no time de produto.')).toBeInTheDocument();
  });

  it('explica a ausencia da descricao em vez de deixar vazio', () => {
    render(<JobDetail job={job({ description: '   ' })} />);

    expect(screen.getByText(/nao publica a descricao na listagem/)).toBeInTheDocument();
  });

  it('avisa quando a data foi estimada na captura', () => {
    render(<JobDetail job={job({ publishedAtSource: 'CAPTURE' })} />);

    expect(screen.getByText(/Estimada na captura/)).toBeInTheDocument();
  });

  it('mostra quem publicou, quando a fonte informa', () => {
    render(<JobDetail job={job({ recruiterName: 'Ana Souza' })} />);

    expect(screen.getByText('Ana Souza')).toBeInTheDocument();
  });
});

describe('JobDetailDrawer', () => {
  it('fica fora do ar quando nao ha vaga selecionada', () => {
    render(<JobDetailDrawer job={null} onClose={vi.fn()} />);

    expect(screen.queryByTestId('job-drawer')).not.toBeInTheDocument();
  });

  it('abre como dialogo com o nome da vaga', () => {
    render(<JobDetailDrawer job={job()} onClose={vi.fn()} />);

    expect(screen.getByRole('dialog')).toHaveAccessibleName(
      /Detalhes da vaga Pessoa Desenvolvedora React/,
    );
  });

  it('fecha pelo botao', async () => {
    const onClose = vi.fn();

    render(<JobDetailDrawer job={job()} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fecha pelo fundo escurecido', async () => {
    const onClose = vi.fn();

    render(<JobDetailDrawer job={job()} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fechar detalhes' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fecha com Esc, que e a saida esperada de um overlay', async () => {
    const onClose = vi.fn();

    render(<JobDetailDrawer job={job()} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('nao escuta o teclado depois de fechado', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<JobDetailDrawer job={job()} onClose={onClose} />);

    rerender(<JobDetailDrawer job={null} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('AgeBadge', () => {
  function hoursAgo(hours: number): string {
    return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  }

  it.each([
    [2, 'nova'],
    [12, 'recente'],
    [48, '1 a 3 dias'],
    // Faixa que o recorte de 7 dias tornou alcancavel.
    [100, '3 a 7 dias'],
  ])('classifica uma vaga de %s h como "%s"', (hours, label) => {
    render(<AgeBadge publishedAt={hoursAgo(hours)} />);

    expect(screen.getByTestId('age-tier')).toHaveTextContent(label);
  });

  it('mostra tambem o tempo decorrido ao lado da faixa', () => {
    render(<AgeBadge publishedAt={hoursAgo(5)} />);

    expect(screen.getByText('ha 5 h')).toBeInTheDocument();
  });

  it('nao deixa a faixa vazia nos limites exatos', () => {
    render(<AgeBadge publishedAt={hoursAgo(72)} />);

    expect(screen.getByTestId('age-tier')).toHaveTextContent('3 a 7 dias');
  });
});

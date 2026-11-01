import { describe, expect, it } from 'vitest';

import { jobPostingDescriptionFrom } from '@/infra/scrapers/support/job-posting-json-ld';
import { readFixture } from '../../../../test/factories/fake-http-client';

const JOBICY = readFixture('jobicy-job.html');

function page(...blocks: string[]): string {
  const scripts = blocks
    .map((block) => `<script type="application/ld+json">${block}</script>`)
    .join('');

  return `<html><head>${scripts}</head><body><p>corpo</p></body></html>`;
}

const JOB_POSTING = JSON.stringify({
  '@type': 'JobPosting',
  description: '<p>Vaga React</p>',
});

describe('jobPostingDescriptionFrom', () => {
  it('le a descricao do JobPosting da pagina real do Jobicy', () => {
    const text = jobPostingDescriptionFrom(JOBICY);

    expect(text).toContain('RevenueCat gives app businesses the infrastructure & tools');
    expect(text).toContain('About you');
    expect(text).toContain('5+ anos com Python');
  });

  it('entrega texto corrido, uma linha por item', () => {
    const text = jobPostingDescriptionFrom(JOBICY);

    expect(text).toContain('5+ anos com Python\nExperiência com PostgreSQL');
    expect(text).not.toContain('<li>');
  });

  it('ignora o bloco que descreve outra coisa', () => {
    const breadcrumb = JSON.stringify({ '@type': 'BreadcrumbList', description: 'trilha' });

    expect(jobPostingDescriptionFrom(page(breadcrumb, JOB_POSTING))).toBe('Vaga React');
  });

  it('acha o JobPosting dentro de uma lista', () => {
    const list = JSON.stringify([{ '@type': 'WebSite' }, JSON.parse(JOB_POSTING)]);

    expect(jobPostingDescriptionFrom(page(list))).toBe('Vaga React');
  });

  it('acha o JobPosting dentro de um @graph', () => {
    const graph = JSON.stringify({ '@graph': [JSON.parse(JOB_POSTING)] });

    expect(jobPostingDescriptionFrom(page(graph))).toBe('Vaga React');
  });

  it('aceita o @type declarado como lista', () => {
    const multiple = JSON.stringify({
      '@type': ['JobPosting', 'WebPage'],
      description: 'Vaga Node',
    });

    expect(jobPostingDescriptionFrom(page(multiple))).toBe('Vaga Node');
  });

  it('passa adiante o bloco malformado em vez de lancar', () => {
    expect(jobPostingDescriptionFrom(page('{ isto nao e json', JOB_POSTING))).toBe('Vaga React');
  });

  it('devolve vazio quando a pagina nao tem JSON-LD', () => {
    expect(jobPostingDescriptionFrom('<html><body><h1>Vaga</h1></body></html>')).toBe('');
  });

  it('devolve vazio quando nenhum bloco e de vaga', () => {
    expect(jobPostingDescriptionFrom(page(JSON.stringify({ '@type': 'Organization' })))).toBe('');
  });

  it('devolve vazio quando o JobPosting nao traz descricao', () => {
    expect(jobPostingDescriptionFrom(page(JSON.stringify({ '@type': 'JobPosting' })))).toBe('');
  });

  it('devolve vazio quando a descricao nao e texto', () => {
    const numeric = JSON.stringify({ '@type': 'JobPosting', description: 42 });

    expect(jobPostingDescriptionFrom(page(numeric))).toBe('');
  });

  it('devolve vazio para bloco nulo', () => {
    expect(jobPostingDescriptionFrom(page('null'))).toBe('');
  });
});

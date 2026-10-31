import { describe, expect, it } from 'vitest';

import {
  extractInhireTenants,
  INHIRE_NOT_TENANTS,
  mergeTenants,
} from '@/infra/scrapers/support/inhire-tenants';

describe('extractInhireTenants', () => {
  it('acha o tenant no link de candidatura externo', () => {
    const urls = ['https://sympla.inhire.app/vagas/8aaac374-e518-4ec2-b3e4-959792fdb7a5'];

    expect(extractInhireTenants(urls)).toEqual(['sympla']);
  });

  it('acha o tenant citado no meio da descricao', () => {
    const texto = [
      'Candidate-se em https://db1.inhire.app/vagas/abc ate sexta.',
      'Processo conduzido pela empresa.',
    ].join('\n');

    expect(extractInhireTenants([texto])).toEqual(['db1']);
  });

  it('acha os dois tenants quando o mesmo texto cita duas empresas', () => {
    const texto = 'Veja zappts.inhire.app e tambem lyncas.inhire.app';

    expect(extractInhireTenants([texto])).toEqual(['zappts', 'lyncas']);
  });

  it('nao repete o tenant citado em varios anuncios', () => {
    const textos = ['https://dock.inhire.app/vagas/1', 'https://dock.inhire.app/vagas/2'];

    expect(extractInhireTenants(textos)).toEqual(['dock']);
  });

  it('ignora diferenca de caixa no link', () => {
    expect(extractInhireTenants(['https://Sympla.InHire.App/vagas/1'])).toEqual(['sympla']);
  });

  it('pega o rotulo mais a direita quando o host tem subdominio a mais', () => {
    expect(extractInhireTenants(['https://www.sympla.inhire.app/vagas/1'])).toEqual(['sympla']);
  });

  it('devolve lista vazia quando nenhum texto cita a inhire', () => {
    const textos = ['https://portal.gupy.io/job/1', 'Vaga para React Pleno, 100% remota'];

    expect(extractInhireTenants(textos)).toEqual([]);
  });

  it('nao confunde outro dominio que termine parecido', () => {
    expect(extractInhireTenants(['https://inhire.app.br/vagas/1'])).toEqual([]);
  });

  it.each(INHIRE_NOT_TENANTS)('descarta o subdominio de servico %s', (servico) => {
    expect(extractInhireTenants([`https://${servico}.inhire.app/algo`])).toEqual([]);
  });

  it('nao se descobre como tenant ao ler o proprio endpoint da api', () => {
    // `api.inhire.app` e o host que o coletor consome: varrido sem filtro, o
    // radar pediria as vagas da InHire a propria InHire.
    const texto = 'GET https://api.inhire.app/job-posts/public/pages';

    expect(extractInhireTenants([texto])).toEqual([]);
  });

  it('descarta subdominio de uma letra, que a inhire nao aceita', () => {
    expect(extractInhireTenants(['https://x.inhire.app/vagas/1'])).toEqual([]);
  });

  it('aceita o tenant com hifen e numero', () => {
    expect(extractInhireTenants(['https://grupo-tech2.inhire.app/vagas/1'])).toEqual([
      'grupo-tech2',
    ]);
  });
});

describe('mergeTenants', () => {
  it('mantem a semente na frente e acrescenta o descoberto', () => {
    expect(mergeTenants(['sympla', 'dock'], ['novatech'])).toEqual([
      'sympla',
      'dock',
      'novatech',
    ]);
  });

  it('nao duplica o tenant que estava nas duas listas', () => {
    expect(mergeTenants(['sympla'], ['sympla', 'novatech'])).toEqual(['sympla', 'novatech']);
  });

  it('deduplica ignorando a caixa', () => {
    expect(mergeTenants(['sympla'], ['Sympla'])).toEqual(['sympla']);
  });

  it('devolve a semente quando nada foi descoberto', () => {
    expect(mergeTenants(['sympla'], [])).toEqual(['sympla']);
  });
});

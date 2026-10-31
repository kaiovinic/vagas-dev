export const INHIRE_TENANT_DISCOVERY_READER = Symbol('IInhireTenantDiscoveryReader');

/**
 * Porta de leitura dos textos ja gravados que citam a InHire.
 *
 * A lista semente de tenants foi levantada a mao, e a cada empresa nova que
 * adota o ATS ela envelhece. Mas o radar ja passa os olhos, toda captura, em
 * centenas de anuncios de outras sete fontes — e e comum um deles apontar para
 * `empresa.inhire.app`, seja no link externo de candidatura (a Remotar publica
 * esse link) seja no corpo da descricao. Esses textos sao o cadastro de
 * tenants que ninguem precisou escrever.
 *
 * Segregada de proposito (ISP): quem descobre tenant nao escreve vaga, nao
 * conta metrica e nao encerra nada.
 */
export interface IInhireTenantDiscoveryReader {
  /**
   * Textos gravados que mencionam a InHire — urls e descricoes de vaga.
   *
   * Devolve o texto cru, e nao o subdominio: extrair e filtrar e decisao de
   * quem chama, nao do banco.
   */
  findTextsMentioningInhire(limit: number): Promise<readonly string[]>;
}

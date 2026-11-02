import type { CandidateProfile } from '@/domain/entities/candidate-profile';

export const CANDIDATE_PROFILE_READER = Symbol.for('CANDIDATE_PROFILE_READER');
export const CANDIDATE_PROFILE_WRITER = Symbol.for('CANDIDATE_PROFILE_WRITER');

/**
 * Enquanto houver um perfil so, e esta linha que o painel edita. O `id` fixo
 * evita que o upsert precise descobrir qual linha procurar, e continua sendo
 * chave de verdade para o dia em que existir mais de um perfil.
 */
export const SOLE_CANDIDATE_PROFILE_ID = 'default';

/**
 * Leitura do perfil. Segregado da escrita (ISP) porque os dois lados tem donos
 * diferentes: quem le e o gerador de curriculo, que nunca escreve; quem escreve
 * e a aba do painel, que nao precisa de nada alem do upsert.
 */
export interface ICandidateProfileReader {
  /** Nulo quando o perfil ainda nao foi preenchido — nao e erro, e o estado inicial. */
  find(): Promise<CandidateProfile | null>;
}

/** Escrita do perfil: upsert, porque a aba sempre envia o perfil inteiro. */
export interface ICandidateProfileWriter {
  save(profile: CandidateProfile): Promise<CandidateProfile>;
}

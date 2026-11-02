import type {
  CandidateProfile,
  ProfileEducation,
  ProfileExperience,
  ProfileProject,
  ProfileSkillGroup,
} from '@/domain/entities/candidate-profile';

export interface CandidateProfileView {
  readonly fullName: string;
  readonly headline: string;
  readonly summary: string;
  readonly email: string;
  readonly city: string;
  readonly phone: string | null;
  readonly linkedinUrl: string | null;
  readonly githubUrl: string | null;
  readonly portfolioUrl: string | null;
  readonly experiences: readonly ProfileExperience[];
  readonly education: readonly ProfileEducation[];
  readonly skills: readonly ProfileSkillGroup[];
  readonly projects: readonly ProfileProject[];
}

export interface CandidateProfileOutput {
  /** Nulo enquanto a aba `Perfil` nunca foi salva. */
  readonly profile: CandidateProfileView | null;
  /**
   * Se o perfil ja basta para gerar curriculo. Vai no mesmo retorno para o
   * painel poder avisar antes de o usuario clicar em gerar, em vez de so
   * descobrir no erro.
   */
  readonly isUsableForResume: boolean;
}

export function toCandidateProfileOutput(profile: CandidateProfile | null): CandidateProfileOutput {
  if (profile === null) {
    return { profile: null, isUsableForResume: false };
  }

  return { profile: profile.toJSON(), isUsableForResume: profile.isUsableForResume };
}

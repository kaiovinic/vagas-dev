import { Inject, Injectable } from '@nestjs/common';

import { CandidateProfile, type CreateCandidateProfileProps } from '@/domain/entities/candidate-profile';
import {
  CANDIDATE_PROFILE_WRITER,
  type ICandidateProfileWriter,
} from '@/domain/repositories/candidate-profile-repository';
import {
  toCandidateProfileOutput,
  type CandidateProfileOutput,
} from '@/application/use-cases/candidate-profile.output';

/**
 * Upsert do perfil: a aba manda o perfil inteiro, sempre.
 *
 * Quem valida e a entidade, nao este caso de uso. O schema HTTP ja barrou a
 * forma (campo faltando, tipo errado); o que chega aqui ainda pode ferir uma
 * invariante de dominio, como um periodo que termina antes de comecar, e e a
 * `CandidateProfile.create` que recusa.
 */
@Injectable()
export class SaveCandidateProfileUseCase {
  constructor(
    @Inject(CANDIDATE_PROFILE_WRITER)
    private readonly profiles: ICandidateProfileWriter,
  ) {}

  async execute(props: CreateCandidateProfileProps): Promise<CandidateProfileOutput> {
    const saved = await this.profiles.save(CandidateProfile.create(props));

    return toCandidateProfileOutput(saved);
  }
}

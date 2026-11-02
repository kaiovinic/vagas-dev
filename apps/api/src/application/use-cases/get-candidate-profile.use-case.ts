import { Inject, Injectable } from '@nestjs/common';

import {
  CANDIDATE_PROFILE_READER,
  type ICandidateProfileReader,
} from '@/domain/repositories/candidate-profile-repository';
import {
  toCandidateProfileOutput,
  type CandidateProfileOutput,
} from '@/application/use-cases/candidate-profile.output';

/** Aba `Perfil`: devolve o perfil salvo, ou o estado vazio da primeira visita. */
@Injectable()
export class GetCandidateProfileUseCase {
  constructor(
    @Inject(CANDIDATE_PROFILE_READER)
    private readonly profiles: ICandidateProfileReader,
  ) {}

  async execute(): Promise<CandidateProfileOutput> {
    return toCandidateProfileOutput(await this.profiles.find());
  }
}

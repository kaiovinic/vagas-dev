import { beforeEach, describe, expect, it } from 'vitest';

import { GetCandidateProfileUseCase } from '@/application/use-cases/get-candidate-profile.use-case';
import { SaveCandidateProfileUseCase } from '@/application/use-cases/save-candidate-profile.use-case';
import {
  CandidateProfile,
  type CreateCandidateProfileProps,
} from '@/domain/entities/candidate-profile';
import { InvalidCandidateProfileError } from '@/domain/errors/invalid-candidate-profile-error';
import type {
  ICandidateProfileReader,
  ICandidateProfileWriter,
} from '@/domain/repositories/candidate-profile-repository';

/** Duplo em memoria dos dois lados do contrato, como o Postgres se comporta. */
class InMemoryCandidateProfileRepository implements ICandidateProfileReader, ICandidateProfileWriter {
  private stored: CandidateProfile | null = null;

  async find(): Promise<CandidateProfile | null> {
    return this.stored;
  }

  async save(profile: CandidateProfile): Promise<CandidateProfile> {
    this.stored = profile;

    return profile;
  }
}

const PROPS: CreateCandidateProfileProps = {
  fullName: 'Kaio Vinicius',
  headline: 'Desenvolvedor Frontend',
  summary: 'Interfaces em React e TypeScript.',
  email: 'kaio@example.com',
  city: 'Salvador, BA',
  experiences: [
    {
      company: 'Acme',
      role: 'Frontend',
      startedAt: '2022-01',
      endedAt: null,
      description: 'Painel de metricas.',
      techs: ['React'],
    },
  ],
  skills: [{ category: 'Frontend', items: ['React'] }],
};

describe('Casos de uso do perfil do candidato', () => {
  let repository: InMemoryCandidateProfileRepository;
  let getProfile: GetCandidateProfileUseCase;
  let saveProfile: SaveCandidateProfileUseCase;

  beforeEach(() => {
    repository = new InMemoryCandidateProfileRepository();
    getProfile = new GetCandidateProfileUseCase(repository);
    saveProfile = new SaveCandidateProfileUseCase(repository);
  });

  it('devolve o estado vazio quando o perfil nunca foi salvo', async () => {
    await expect(getProfile.execute()).resolves.toEqual({ profile: null, isUsableForResume: false });
  });

  it('grava o perfil e devolve que ele ja serve para gerar curriculo', async () => {
    const output = await saveProfile.execute(PROPS);

    expect(output.isUsableForResume).toBe(true);
    expect(output.profile).toMatchObject({ fullName: 'Kaio Vinicius', phone: null });

    const read = await getProfile.execute();

    expect(read.profile?.email).toBe('kaio@example.com');
    expect(read.isUsableForResume).toBe(true);
  });

  it('avisa que o perfil ainda nao serve quando falta competencia', async () => {
    const output = await saveProfile.execute({ ...PROPS, skills: [] });

    expect(output.isUsableForResume).toBe(false);
    expect(output.profile?.skills).toEqual([]);
  });

  it('sobrescreve o perfil inteiro no upsert, sem deixar resto do anterior', async () => {
    await saveProfile.execute(PROPS);
    await saveProfile.execute({ ...PROPS, headline: 'Fullstack', experiences: [] });

    const read = await getProfile.execute();

    expect(read.profile?.headline).toBe('Fullstack');
    expect(read.profile?.experiences).toEqual([]);
  });

  it('recusa a gravacao que fere invariante de dominio, sem tocar no repositorio', async () => {
    await expect(saveProfile.execute({ ...PROPS, email: 'invalido' })).rejects.toThrow(
      InvalidCandidateProfileError,
    );
    await expect(getProfile.execute()).resolves.toMatchObject({ profile: null });
  });
});

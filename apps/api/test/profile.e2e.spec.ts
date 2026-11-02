import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { GetCandidateProfileUseCase } from '@/application/use-cases/get-candidate-profile.use-case';
import { SaveCandidateProfileUseCase } from '@/application/use-cases/save-candidate-profile.use-case';
import { CandidateProfile } from '@/domain/entities/candidate-profile';
import {
  CANDIDATE_PROFILE_READER,
  CANDIDATE_PROFILE_WRITER,
  type ICandidateProfileReader,
  type ICandidateProfileWriter,
} from '@/domain/repositories/candidate-profile-repository';
import { ProfileController } from '@/http/controllers/profile.controller';
import { DomainExceptionFilter } from '@/http/filters/domain-exception.filter';

class InMemoryProfiles implements ICandidateProfileReader, ICandidateProfileWriter {
  private stored: CandidateProfile | null = null;

  async find(): Promise<CandidateProfile | null> {
    return this.stored;
  }

  async save(profile: CandidateProfile): Promise<CandidateProfile> {
    this.stored = profile;

    return profile;
  }
}

const VALID_BODY = {
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
      description: 'Painel de metricas.',
      techs: ['React'],
    },
  ],
  skills: [{ category: 'Frontend', items: ['React'] }],
};

describe('Profile (E2E)', () => {
  let app: INestApplication;
  let profiles: InMemoryProfiles;

  beforeEach(async () => {
    profiles = new InMemoryProfiles();

    const moduleRef = await Test.createTestingModule({
      controllers: [ProfileController],
      providers: [
        GetCandidateProfileUseCase,
        SaveCandidateProfileUseCase,
        { provide: CANDIDATE_PROFILE_READER, useValue: profiles },
        { provide: CANDIDATE_PROFILE_WRITER, useValue: profiles },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  function http(): request.Agent {
    return request(app.getHttpServer());
  }

  it('devolve perfil nulo na primeira visita da aba', async () => {
    const response = await http().get('/api/profile').expect(200);

    expect(response.body).toEqual({ profile: null, isUsableForResume: false });
  });

  it('grava o perfil e devolve o que a aba precisa mostrar', async () => {
    const response = await http().put('/api/profile').send(VALID_BODY).expect(200);

    expect(response.body).toMatchObject({
      isUsableForResume: true,
      profile: {
        fullName: 'Kaio Vinicius',
        phone: null,
        linkedinUrl: null,
        education: [],
        projects: [],
      },
    });

    const read = await http().get('/api/profile').expect(200);

    expect(read.body.profile.email).toBe('kaio@example.com');
  });

  it('aceita formacao com e sem fim informado', async () => {
    const response = await http()
      .put('/api/profile')
      .send({
        ...VALID_BODY,
        education: [
          { institution: 'UFBA', degree: 'Sistemas de Informacao', startedAt: '2016-02', endedAt: '2020-12' },
          { institution: 'Alura', degree: 'Formacao React', startedAt: '2024-01' },
        ],
      })
      .expect(200);

    expect(response.body.profile.education).toEqual([
      { institution: 'UFBA', degree: 'Sistemas de Informacao', startedAt: '2016-02', endedAt: '2020-12' },
      { institution: 'Alura', degree: 'Formacao React', startedAt: '2024-01', endedAt: null },
    ]);
  });

  it('recusa com 400 o corpo fora do schema', async () => {
    const response = await http()
      .put('/api/profile')
      .send({ ...VALID_BODY, email: 'sem-arroba' })
      .expect(400);

    expect(response.body.issues).toContainEqual({
      path: 'email',
      message: 'informe um e-mail valido',
    });
  });

  it('recusa com 400 o mes fora do formato AAAA-MM', async () => {
    await http()
      .put('/api/profile')
      .send({ ...VALID_BODY, experiences: [{ ...VALID_BODY.experiences[0], startedAt: '03/2022' }] })
      .expect(400);
  });

  it('traduz a invariante de dominio em 400, nao em 500', async () => {
    const response = await http()
      .put('/api/profile')
      .send({
        ...VALID_BODY,
        experiences: [{ ...VALID_BODY.experiences[0], startedAt: '2023-05', endedAt: '2022-01' }],
      })
      .expect(400);

    expect(response.body.message).toMatch(/endedAt/);
  });
});

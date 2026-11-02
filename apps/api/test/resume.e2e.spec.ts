import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { GenerateResumeUseCase } from '@/application/use-cases/generate-resume.use-case';
import { CANDIDATE_PROFILE_READER } from '@/domain/repositories/candidate-profile-repository';
import { RESUME_GENERATOR } from '@/domain/providers/resume-generator';
import {
  RESUME_REPOSITORY,
  RESUME_TARGET_JOB_READER,
} from '@/domain/repositories/resume-repository';
import { ResumeController } from '@/http/controllers/resume.controller';
import { ResumeExceptionFilter } from '@/http/filters/resume-exception.filter';
import {
  InMemoryCandidateProfileReader,
  InMemoryResumeRepository,
  InMemoryResumeTargetJobReader,
  StubResumeGenerator,
} from './factories/doubles';
import { makeProfile, makeResumeTargetJob } from './factories/make-candidate-profile';

describe('Resume (E2E)', () => {
  let app: INestApplication;
  let jobs: InMemoryResumeTargetJobReader;
  let profiles: InMemoryCandidateProfileReader;
  let generator: StubResumeGenerator;

  beforeEach(async () => {
    jobs = new InMemoryResumeTargetJobReader();
    jobs.jobs = [makeResumeTargetJob()];
    profiles = new InMemoryCandidateProfileReader();
    profiles.profile = makeProfile();
    generator = new StubResumeGenerator();

    const moduleRef = await Test.createTestingModule({
      controllers: [ResumeController],
      providers: [
        GenerateResumeUseCase,
        { provide: RESUME_TARGET_JOB_READER, useValue: jobs },
        { provide: CANDIDATE_PROFILE_READER, useValue: profiles },
        { provide: RESUME_GENERATOR, useValue: generator },
        { provide: RESUME_REPOSITORY, useValue: new InMemoryResumeRepository() },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new ResumeExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  function http(): request.Agent {
    return request(app.getHttpServer());
  }

  it('devolve o curriculo em Markdown, com as lacunas e o porque', async () => {
    const response = await http()
      .post('/api/resume/generate')
      .send({ jobId: 'job-1' })
      .expect(201);

    expect(response.body).toMatchObject({
      markdown: '# Kaio Vinicius',
      gaps: ['Nao tem experiencia com Angular.'],
      rationale: ['Destaquei React porque a vaga pede React.'],
      model: 'claude-opus-5-5',
      generated: true,
    });
    expect(typeof response.body.generatedAt).toBe('string');
  });

  it('reaproveita a versao salva no segundo pedido da mesma vaga', async () => {
    await http().post('/api/resume/generate').send({ jobId: 'job-1' }).expect(201);

    const response = await http()
      .post('/api/resume/generate')
      .send({ jobId: 'job-1' })
      .expect(201);

    expect(response.body.generated).toBe(false);
    expect(generator.requests).toHaveLength(1);
  });

  it('gera outra versao quando o pedido pede', async () => {
    await http().post('/api/resume/generate').send({ jobId: 'job-1' }).expect(201);
    await http()
      .post('/api/resume/generate')
      .send({ jobId: 'job-1', regenerate: true })
      .expect(201);

    expect(generator.requests).toHaveLength(2);
  });

  it('404 para vaga desconhecida', async () => {
    const response = await http()
      .post('/api/resume/generate')
      .send({ jobId: 'fantasma' })
      .expect(404);

    expect(response.body.error).toBe('ResumeTargetNotFoundError');
  });

  it('422 enquanto o perfil nao esta preenchido', async () => {
    profiles.profile = null;

    const response = await http()
      .post('/api/resume/generate')
      .send({ jobId: 'job-1' })
      .expect(422);

    expect(response.body.error).toBe('ProfileNotReadyForResumeError');
  });

  it('502 quando a geracao falha no provedor', async () => {
    generator.shouldFail = true;

    const response = await http()
      .post('/api/resume/generate')
      .send({ jobId: 'job-1' })
      .expect(502);

    expect(response.body.error).toBe('ResumeGenerationFailedError');
  });

  it('400 para pedido sem vaga', async () => {
    await http().post('/api/resume/generate').send({}).expect(400);
  });
});

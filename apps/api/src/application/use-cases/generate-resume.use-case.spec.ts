import { beforeEach, describe, expect, it } from 'vitest';

import { GenerateResumeUseCase } from '@/application/use-cases/generate-resume.use-case';
import {
  ProfileNotReadyForResumeError,
  ResumeGenerationFailedError,
  ResumeTargetNotFoundError,
} from '@/domain/errors/resume-errors';
import {
  InMemoryCandidateProfileReader,
  InMemoryResumeRepository,
  InMemoryResumeTargetJobReader,
  StubResumeGenerator,
} from '../../../test/factories/doubles';
import { makeProfile, makeResumeTargetJob } from '../../../test/factories/make-candidate-profile';

describe('GenerateResumeUseCase', () => {
  let jobs: InMemoryResumeTargetJobReader;
  let profiles: InMemoryCandidateProfileReader;
  let generator: StubResumeGenerator;
  let resumes: InMemoryResumeRepository;
  let useCase: GenerateResumeUseCase;

  beforeEach(() => {
    jobs = new InMemoryResumeTargetJobReader();
    jobs.jobs = [makeResumeTargetJob()];
    profiles = new InMemoryCandidateProfileReader();
    profiles.profile = makeProfile();
    generator = new StubResumeGenerator();
    resumes = new InMemoryResumeRepository();
    useCase = new GenerateResumeUseCase(jobs, profiles, generator, resumes);
  });

  it('gera o curriculo da vaga e guarda no historico', async () => {
    const { resume, generated } = await useCase.execute({ jobId: 'job-1' });

    expect(generated).toBe(true);
    expect(resume.markdown).toBe('# Kaio Vinicius');
    expect(resume.gaps).toEqual(['Nao tem experiencia com Angular.']);
    expect(resume.model).toBe('claude-opus-5-5');
    expect(resume.inputTokens).toBe(2_900);
    expect(resumes.saved).toHaveLength(1);
  });

  it('entrega a porta o perfil salvo e a vaga pedida', async () => {
    await useCase.execute({ jobId: 'job-1' });

    const [request] = generator.requests;

    expect(request?.profile.fullName).toBe('Kaio Vinicius');
    expect(request?.job.company).toBe('Globex');
  });

  it('recusa vaga que nao existe, sem tocar no gerador', async () => {
    await expect(useCase.execute({ jobId: 'fantasma' })).rejects.toThrow(ResumeTargetNotFoundError);
    expect(generator.requests).toHaveLength(0);
  });

  it('recusa quando o perfil nunca foi preenchido', async () => {
    profiles.profile = null;

    await expect(useCase.execute({ jobId: 'job-1' })).rejects.toThrow(ProfileNotReadyForResumeError);
    expect(generator.requests).toHaveLength(0);
  });

  it('recusa perfil sem experiencia, antes de gastar token', async () => {
    profiles.profile = makeProfile({ experiences: [] });

    await expect(useCase.execute({ jobId: 'job-1' })).rejects.toThrow(ProfileNotReadyForResumeError);
    expect(generator.requests).toHaveLength(0);
  });

  it('deixa a falha do provedor subir tipada, sem gravar historico', async () => {
    generator.shouldFail = true;

    await expect(useCase.execute({ jobId: 'job-1' })).rejects.toThrow(ResumeGenerationFailedError);
    expect(resumes.saved).toHaveLength(0);
  });

  it('reaproveita a ultima versao salva, para nao pagar duas vezes pela mesma vaga', async () => {
    await useCase.execute({ jobId: 'job-1' });

    const { resume, generated } = await useCase.execute({ jobId: 'job-1' });

    expect(generated).toBe(false);
    expect(resume.id).toBe('resume-1');
    expect(generator.requests).toHaveLength(1);
  });

  it('gera de novo quando o usuario pede outra versao', async () => {
    await useCase.execute({ jobId: 'job-1' });

    const { resume, generated } = await useCase.execute({ jobId: 'job-1', regenerate: true });

    expect(generated).toBe(true);
    expect(resume.id).toBe('resume-2');
    expect(generator.requests).toHaveLength(2);
  });

  it('nao confunde o historico de uma vaga com o de outra', async () => {
    jobs.jobs = [makeResumeTargetJob(), makeResumeTargetJob({ id: 'job-2', company: 'Initech' })];
    await useCase.execute({ jobId: 'job-1' });

    const { generated } = await useCase.execute({ jobId: 'job-2' });

    expect(generated).toBe(true);
    expect(resumes.saved.map((resume) => resume.jobId)).toEqual(['job-1', 'job-2']);
  });
});

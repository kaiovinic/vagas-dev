import { Job, type CreateJobProps } from '@/domain/entities/job';

export const FIXED_NOW = new Date('2026-10-26T12:00:00.000Z');

export function hoursAgo(hours: number, reference: Date = FIXED_NOW): Date {
  return new Date(reference.getTime() - hours * 60 * 60 * 1000);
}

export function makeJob(overrides: Partial<CreateJobProps> = {}): Job {
  return Job.create({
    title: 'Desenvolvedor Frontend React',
    company: 'Acme Corp',
    source: 'gupy',
    url: 'https://gupy.io/vagas/1',
    publishedAt: hoursAgo(2),
    description: 'Vaga para atuar com React e TypeScript em squad de produto.',
    location: 'Salvador/BA',
    workModel: 'REMOTE',
    ...overrides,
  });
}

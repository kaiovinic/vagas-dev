import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  CandidateProfile,
  type ProfileEducation,
  type ProfileExperience,
  type ProfileProject,
  type ProfileSkillGroup,
} from '@/domain/entities/candidate-profile';
import {
  SOLE_CANDIDATE_PROFILE_ID,
  type ICandidateProfileReader,
  type ICandidateProfileWriter,
} from '@/domain/repositories/candidate-profile-repository';
import { PrismaService } from '@/infra/prisma/prisma.service';

/** A linha como o Prisma a devolve: as quatro listas chegam como `JsonValue`. */
interface ProfileRow {
  readonly fullName: string;
  readonly headline: string;
  readonly summary: string;
  readonly email: string;
  readonly city: string;
  readonly phone: string | null;
  readonly linkedinUrl: string | null;
  readonly githubUrl: string | null;
  readonly portfolioUrl: string | null;
  readonly experiences: Prisma.JsonValue;
  readonly education: Prisma.JsonValue;
  readonly skills: Prisma.JsonValue;
  readonly projects: Prisma.JsonValue;
}

/**
 * Implementacao Prisma dos dois contratos segregados do perfil. A classe reune
 * os dois porque a linha e a mesma, mas cada caso de uso depende apenas do lado
 * de que precisa (ISP), como ja acontece no `PrismaJobRepository`.
 */
@Injectable()
export class PrismaCandidateProfileRepository
  implements ICandidateProfileReader, ICandidateProfileWriter
{
  constructor(private readonly prisma: PrismaService) {}

  async find(): Promise<CandidateProfile | null> {
    const row = await this.prisma.candidateProfile.findUnique({
      where: { id: SOLE_CANDIDATE_PROFILE_ID },
    });

    return row === null ? null : toEntity(row);
  }

  /**
   * Upsert pelo `id` fixo. O `create` e o `update` levam os mesmos campos de
   * proposito: a aba manda o perfil inteiro, entao gravar parcialmente deixaria
   * para tras exatamente o campo que o usuario acabou de apagar.
   */
  async save(profile: CandidateProfile): Promise<CandidateProfile> {
    const data = toRow(profile);
    const row = await this.prisma.candidateProfile.upsert({
      where: { id: SOLE_CANDIDATE_PROFILE_ID },
      create: { id: SOLE_CANDIDATE_PROFILE_ID, ...data },
      update: data,
    });

    return toEntity(row);
  }
}

/**
 * A linha volta para a entidade pela mesma fabrica que valida a entrada do
 * painel. Dado estragado no banco falha aqui, alto e claro, em vez de chegar
 * meio formado ao gerador de curriculo.
 */
function toEntity(row: ProfileRow): CandidateProfile {
  return CandidateProfile.create({
    fullName: row.fullName,
    headline: row.headline,
    summary: row.summary,
    email: row.email,
    city: row.city,
    phone: row.phone,
    linkedinUrl: row.linkedinUrl,
    githubUrl: row.githubUrl,
    portfolioUrl: row.portfolioUrl,
    experiences: toList<ProfileExperience>(row.experiences),
    education: toList<ProfileEducation>(row.education),
    skills: toList<ProfileSkillGroup>(row.skills),
    projects: toList<ProfileProject>(row.projects),
  });
}

function toRow(profile: CandidateProfile): Omit<ProfileRow, 'experiences' | 'education' | 'skills' | 'projects'> & {
  experiences: Prisma.InputJsonValue;
  education: Prisma.InputJsonValue;
  skills: Prisma.InputJsonValue;
  projects: Prisma.InputJsonValue;
} {
  const props = profile.toJSON();

  return {
    ...props,
    experiences: toJsonList(props.experiences),
    education: toJsonList(props.education),
    skills: toJsonList(props.skills),
    projects: toJsonList(props.projects),
  };
}

/**
 * As listas da entidade sao `readonly` e tem campos opcionais; `InputJsonValue`
 * nao aceita nenhuma das duas formas. A conversao e segura porque sao objetos
 * planos de string, numero e nulo — exatamente o que cabe numa coluna JSONB.
 */
function toJsonList(items: readonly object[]): Prisma.InputJsonValue {
  return items as unknown as Prisma.InputJsonValue;
}

/**
 * `JsonValue` nao tem forma: o que garante a dos itens e a entidade, logo em
 * seguida. Aqui so se estabelece que e uma lista — qualquer outra coisa gravada
 * na coluna vira lista vazia em vez de quebrar a leitura do painel inteiro.
 */
function toList<TItem>(value: Prisma.JsonValue): TItem[] {
  return Array.isArray(value) ? (value as unknown as TItem[]) : [];
}

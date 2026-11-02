import { useEffect, useState, type ReactNode } from 'react';
import { useFieldArray, useForm, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import type { CandidateProfileResponse } from '@/api/schemas';
import { FormField } from '@/components/profile/form-field';
import {
  EMPTY_EDUCATION,
  EMPTY_EXPERIENCE,
  EMPTY_PROJECT,
  EMPTY_SKILL_GROUP,
  profileFormSchema,
  toFormValues,
  toProfilePayload,
  type ProfileFormValues,
} from '@/components/profile/profile-form-values';
import { Panel, StateMessage } from '@/components/ui/panel';
import { Toast } from '@/components/ui/toast';
import { useSaveCandidateProfile } from '@/hooks/use-candidate-profile';

interface ProfileFormProps {
  readonly data: CandidateProfileResponse;
}

/**
 * Formulario do perfil: uma unica submissao envia o perfil inteiro, como a API
 * espera. As listas sao dinamicas porque ninguem tem o mesmo numero de
 * experiencias — e um campo fixo a mais obrigaria a deixar lixo preenchido.
 */
export function ProfileForm({ data }: ProfileFormProps): ReactNode {
  const save = useSaveCandidateProfile();
  const [savedCount, setSavedCount] = useState(0);

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: toFormValues(data.profile),
  });

  // O perfil chega depois do primeiro render (ou volta trocado de outra aba);
  // sem isto o formulario ficaria preso nos valores do primeiro mount.
  useEffect(() => {
    reset(toFormValues(data.profile));
  }, [data.profile, reset]);

  const experiences = useFieldArray({ control, name: 'experiences' });
  const education = useFieldArray({ control, name: 'education' });
  const skills = useFieldArray({ control, name: 'skills' });
  const projects = useFieldArray({ control, name: 'projects' });

  function submit(values: ProfileFormValues): void {
    save.mutate(toProfilePayload(values), {
      onSuccess: () => setSavedCount((count) => count + 1),
    });
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(submit)(event)}
      aria-label="Perfil do candidato"
      className="flex flex-col gap-6"
    >
      <Panel
        title="Dados de contato"
        description="O cabecalho do curriculo: e por aqui que o recrutador responde"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            label="Nome completo"
            field={register('fullName')}
            error={errors.fullName?.message}
          />
          <FormField
            label="Titulo profissional"
            placeholder="Desenvolvedor Frontend"
            field={register('headline')}
            error={errors.headline?.message}
          />
          <FormField
            label="E-mail"
            type="email"
            field={register('email')}
            error={errors.email?.message}
          />
          <FormField
            label="Telefone (opcional)"
            field={register('phone')}
            error={errors.phone?.message}
          />
          <FormField
            label="Cidade"
            placeholder="Salvador, BA"
            field={register('city')}
            error={errors.city?.message}
          />
          <FormField
            label="LinkedIn (opcional)"
            placeholder="https://linkedin.com/in/..."
            field={register('linkedinUrl')}
            error={errors.linkedinUrl?.message}
          />
          <FormField
            label="GitHub (opcional)"
            placeholder="https://github.com/..."
            field={register('githubUrl')}
            error={errors.githubUrl?.message}
          />
          <FormField
            label="Portfolio (opcional)"
            placeholder="https://..."
            field={register('portfolioUrl')}
            error={errors.portfolioUrl?.message}
          />
        </div>

        <div className="mt-3">
          <FormField
            label="Resumo profissional"
            rows={4}
            placeholder="Dois ou tres paragrafos sobre o que voce faz e com o que trabalha"
            field={register('summary')}
            error={errors.summary?.message}
          />
        </div>
      </Panel>

      <ListPanel
        title="Experiencias"
        description="A materia-prima do curriculo: deixe o fim em branco para o emprego atual"
        itemLabel="experiencia"
        count={experiences.fields.length}
        onAdd={() => experiences.append(EMPTY_EXPERIENCE)}
      >
        {experiences.fields.map((item, index) => (
          <ListItem
            key={item.id}
            title={`Experiencia ${index + 1}`}
            onRemove={() => experiences.remove(index)}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                label="Empresa"
                field={register(`experiences.${index}.company`)}
                error={errorAt(errors, 'experiences', index, 'company')}
              />
              <FormField
                label="Cargo"
                field={register(`experiences.${index}.role`)}
                error={errorAt(errors, 'experiences', index, 'role')}
              />
              <FormField
                label="Inicio"
                type="month"
                field={register(`experiences.${index}.startedAt`)}
                error={errorAt(errors, 'experiences', index, 'startedAt')}
              />
              <FormField
                label="Fim (vazio = atual)"
                type="month"
                field={register(`experiences.${index}.endedAt`)}
                error={errorAt(errors, 'experiences', index, 'endedAt')}
              />
            </div>
            <div className="mt-3 flex flex-col gap-3">
              <FormField
                label="O que voce fez"
                rows={3}
                field={register(`experiences.${index}.description`)}
                error={errorAt(errors, 'experiences', index, 'description')}
              />
              <FormField
                label="Tecnologias (separadas por virgula)"
                placeholder="React, TypeScript, Node.js"
                field={register(`experiences.${index}.techs`)}
                error={errorAt(errors, 'experiences', index, 'techs')}
              />
            </div>
          </ListItem>
        ))}
      </ListPanel>

      <ListPanel
        title="Formacao"
        description="Cursos e graduacoes, do mais recente para o mais antigo"
        itemLabel="formacao"
        count={education.fields.length}
        onAdd={() => education.append(EMPTY_EDUCATION)}
      >
        {education.fields.map((item, index) => (
          <ListItem
            key={item.id}
            title={`Formacao ${index + 1}`}
            onRemove={() => education.remove(index)}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                label="Instituicao"
                field={register(`education.${index}.institution`)}
                error={errorAt(errors, 'education', index, 'institution')}
              />
              <FormField
                label="Curso"
                field={register(`education.${index}.degree`)}
                error={errorAt(errors, 'education', index, 'degree')}
              />
              <FormField
                label="Inicio"
                type="month"
                field={register(`education.${index}.startedAt`)}
                error={errorAt(errors, 'education', index, 'startedAt')}
              />
              <FormField
                label="Fim (vazio = em curso)"
                type="month"
                field={register(`education.${index}.endedAt`)}
                error={errorAt(errors, 'education', index, 'endedAt')}
              />
            </div>
          </ListItem>
        ))}
      </ListPanel>

      <ListPanel
        title="Competencias"
        description="Agrupadas por categoria, para o curriculo nao virar uma lista solta"
        itemLabel="grupo"
        count={skills.fields.length}
        onAdd={() => skills.append(EMPTY_SKILL_GROUP)}
      >
        {skills.fields.map((item, index) => (
          <ListItem key={item.id} title={`Grupo ${index + 1}`} onRemove={() => skills.remove(index)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                label="Categoria"
                placeholder="Frontend"
                field={register(`skills.${index}.category`)}
                error={errorAt(errors, 'skills', index, 'category')}
              />
              <FormField
                label="Competencias (separadas por virgula)"
                placeholder="React, Next.js, Tailwind"
                field={register(`skills.${index}.items`)}
                error={errorAt(errors, 'skills', index, 'items')}
              />
            </div>
          </ListItem>
        ))}
      </ListPanel>

      <ListPanel
        title="Projetos (opcional)"
        description="O que mostra codigo seu: projeto proprio, open source, freela"
        itemLabel="projeto"
        count={projects.fields.length}
        onAdd={() => projects.append(EMPTY_PROJECT)}
      >
        {projects.fields.map((item, index) => (
          <ListItem
            key={item.id}
            title={`Projeto ${index + 1}`}
            onRemove={() => projects.remove(index)}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                label="Nome"
                field={register(`projects.${index}.name`)}
                error={errorAt(errors, 'projects', index, 'name')}
              />
              <FormField
                label="Link (opcional)"
                placeholder="https://..."
                field={register(`projects.${index}.url`)}
                error={errorAt(errors, 'projects', index, 'url')}
              />
            </div>
            <div className="mt-3 flex flex-col gap-3">
              <FormField
                label="Descricao"
                rows={2}
                field={register(`projects.${index}.description`)}
                error={errorAt(errors, 'projects', index, 'description')}
              />
              <FormField
                label="Tecnologias (separadas por virgula)"
                field={register(`projects.${index}.techs`)}
                error={errorAt(errors, 'projects', index, 'techs')}
              />
            </div>
          </ListItem>
        ))}
      </ListPanel>

      {save.error !== null && (
        <StateMessage
          title="Nao foi possivel salvar o perfil"
          description={save.error.message}
          tone="negative"
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={save.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface-base disabled:opacity-60"
        >
          {save.isPending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          Salvar perfil
        </button>

        {isDirty && (
          <p className="text-xs text-content-muted">Ha alteracoes ainda nao salvas.</p>
        )}
      </div>

      <Toast token={savedCount} message="Perfil salvo" />
    </form>
  );
}

interface ListPanelProps {
  readonly title: string;
  readonly description: string;
  readonly itemLabel: string;
  readonly count: number;
  readonly onAdd: () => void;
  readonly children: ReactNode;
}

function ListPanel({
  title,
  description,
  itemLabel,
  count,
  onAdd,
  children,
}: ListPanelProps): ReactNode {
  return (
    <Panel
      title={title}
      description={description}
      actions={
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-base px-3 py-1.5 text-xs font-medium text-content-secondary hover:text-content-primary"
        >
          <Plus aria-hidden="true" className="size-3.5" />
          {`Adicionar ${itemLabel}`}
        </button>
      }
    >
      {count === 0 ? (
        <StateMessage title={`Nenhuma ${itemLabel} informada`} description="Use o botao acima para adicionar." />
      ) : (
        <div className="flex flex-col gap-4">{children}</div>
      )}
    </Panel>
  );
}

interface ListItemProps {
  readonly title: string;
  readonly onRemove: () => void;
  readonly children: ReactNode;
}

function ListItem({ title, onRemove, children }: ListItemProps): ReactNode {
  return (
    <fieldset className="rounded-xl border border-border-subtle bg-surface-base/50 p-4">
      <legend className="flex items-center gap-2 px-1 text-xs font-medium text-content-secondary">
        {title}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remover ${title}`}
          className="text-content-muted transition-colors hover:text-negative"
        >
          <Trash2 aria-hidden="true" className="size-3.5" />
        </button>
      </legend>
      {children}
    </fieldset>
  );
}

type ListName = 'experiences' | 'education' | 'skills' | 'projects';

/**
 * Erro de um campo dentro de uma lista. O caminho e dinamico, e o tipo de
 * `FieldErrors` nao acompanha indice: a leitura e feita uma vez aqui, em vez de
 * espalhar casts por cada campo do formulario.
 */
function errorAt(
  errors: FieldErrors<ProfileFormValues>,
  list: ListName,
  index: number,
  field: string,
): string | undefined {
  const entry = errors[list]?.[index] as Record<string, { message?: string }> | undefined;

  return entry?.[field]?.message;
}

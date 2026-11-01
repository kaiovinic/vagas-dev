# Gerador de Currículo Sob Medida

Desenho da feature antes da primeira linha de código. O objetivo é adaptar um
perfil único — o seu — à descrição de uma vaga específica já capturada pelo
radar, devolvendo um currículo em Markdown pronto para revisar, copiar e enviar.

> **Status:** proposta, aguardando aval. Nada implementado.

---

## 1. O problema

O radar já responde *quais* vagas existem. Ele não ajuda no passo seguinte: cada
candidatura pede um currículo que fale a língua daquele anúncio. Reescrever à mão
para 38 vagas abertas é o gargalo real, e é onde a maior parte das candidaturas
morre.

O que a IA faz aqui é **seleção e reescrita**, não invenção: ela recebe o seu
histórico verdadeiro e a descrição da vaga, e decide o que destacar, em que ordem
e com que vocabulário. Isso é o eixo de todo o desenho abaixo — a regra número um
é que o modelo nunca produza experiência que você não viveu.

## 2. Decisões já tomadas

| Decisão | Escolha | Por quê |
|---|---|---|
| Base do perfil | Tabela `CandidateProfile` + aba no painel | Perfil vira dado de primeira classe: editável sem deploy, e reaproveitável por features futuras (carta de apresentação, match score) |
| Saída | Markdown renderizado na tela | Zero dependência nova; o texto fica editável antes do envio, e `Ctrl+P` do navegador já gera PDF |
| Modelo | `claude-opus-5-5` | Padrão atual da API; o raciocínio adaptativo é o que faz a seleção de experiências ficar boa |
| Disparo | Sob demanda, a partir da vaga | Gerar em lote queimaria tokens em vagas que você nunca vai aplicar |

---

## 3. Camadas

A feature respeita a mesma separação do resto do projeto: o domínio não conhece
a Anthropic, o caso de uso depende só de interfaces, e a implementação concreta
fica na infraestrutura.

```
domain/
  entities/candidate-profile.ts         Entidade + Value Objects do perfil
  providers/resume-generator.ts         PORTA: IResumeGenerator (token RESUME_GENERATOR)
  repositories/candidate-profile-repository.ts   ICandidateProfileRepository (leitura + escrita)
  repositories/resume-repository.ts     IResumeRepository (histórico do que foi gerado)
  services/resume-prompt-builder.ts     Monta o prompt a partir de perfil + vaga (SEM I/O)

application/use-cases/
  generate-resume.use-case.ts           Orquestra: carrega perfil, carrega vaga, chama a porta, grava
  get-candidate-profile.use-case.ts
  save-candidate-profile.use-case.ts

infra/
  ai/anthropic-resume-generator.ts      Implementa IResumeGenerator com @anthropic-ai/sdk
  prisma/prisma-candidate-profile-repository.ts
  prisma/prisma-resume-repository.ts

http/controllers/
  resume.controller.ts                  POST /api/resume/generate, GET/PUT /api/profile
```

### A porta

O contrato que isola a Anthropic do resto do sistema. Trocar de provedor — ou
dublar nos testes — é implementar esta interface:

```ts
export const RESUME_GENERATOR = Symbol.for('RESUME_GENERATOR');

export interface ResumeRequest {
  readonly profile: CandidateProfile;
  readonly job: ResumeTargetJob;   // titulo, empresa, descricao, tags, workModel
}

export interface GeneratedResume {
  readonly markdown: string;
  /** Por que o modelo destacou cada bloco: vira a aba "Como foi montado" na UI. */
  readonly rationale: readonly string[];
  /** Requisitos da vaga que o perfil NAO cobre — a parte mais util do retorno. */
  readonly gaps: readonly string[];
  readonly usage: ResumeUsage;     // tokens de entrada, saida e cache
}

export interface IResumeGenerator {
  generate(request: ResumeRequest): Promise<GeneratedResume>;
}
```

Como nos coletores, a implementação **não lança exceção não tratada**: falha de
API vira erro de domínio tipado, e o caso de uso decide o que devolver ao painel.

---

## 4. Dados

```prisma
/// Seu perfil: a materia-prima verdadeira que a IA so reorganiza.
model CandidateProfile {
  id           String   @id @default(uuid())
  fullName     String
  headline     String   /// "Desenvolvedor Frontend React"
  summary      String   /// Resumo base, reescrito por vaga
  email        String
  phone        String?
  city         String
  linkedinUrl  String?
  githubUrl    String?
  portfolioUrl String?
  /// Experiencias, formacao, skills e projetos como JSON estruturado e validado
  /// por Zod na borda. Sao listas aninhadas sem consulta propria: tabela separada
  /// para cada uma so acrescentaria join sem responder nenhuma pergunta nova.
  experiences  Json
  education    Json
  skills       Json
  projects     Json
  updatedAt    DateTime @updatedAt

  @@map("candidate_profiles")
}

/// Historico: cada curriculo gerado, preso a vaga que o originou.
model GeneratedResume {
  id          String   @id @default(uuid())
  jobId       String
  job         Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  markdown    String
  rationale   String[]
  gaps        String[]
  model       String   /// Qual modelo gerou: o historico sobrevive a troca de modelo
  inputTokens Int
  outputTokens Int
  createdAt   DateTime @default(now())

  @@index([jobId, createdAt])
  @@map("generated_resumes")
}
```

Guardar o histórico não é luxo: é o que permite comparar o que foi enviado com o
retorno que a vaga deu, e é a base de qualquer avaliação futura da qualidade da
geração.

---

## 5. O prompt

Três blocos, nesta ordem — e a ordem importa pelo cache:

1. **System (estável, com `cache_control`)** — as regras do jogo: só usar fatos do
   perfil, nunca inflar senioridade, nunca inventar empresa ou tecnologia, escrever
   em português do Brasil, devolver os campos no formato pedido. Esse bloco não muda
   entre gerações.
2. **Perfil (estável, com `cache_control`)** — o seu histórico serializado. Também
   idêntico em toda geração, até você editar a aba de perfil.
3. **Vaga (volátil)** — título, empresa, descrição e tags da vaga alvo.

Os dois primeiros blocos somam algo como 2–3 mil tokens e se repetem em **toda**
geração. Com os dois breakpoints de cache, a partir da segunda geração eles custam
cerca de um décimo. É o mesmo princípio do `generate_series`: a estrutura do pedido
é o que decide o custo, não o volume.

A saída vem por **structured outputs** (`output_config.format`), não por "me
devolva um JSON" no texto: o schema de `{ markdown, rationale, gaps }` é validado
pela própria API, então o painel nunca recebe um bloco meio escrito.

Configuração do pedido, seguindo o guia atual da API:

```ts
const response = await client.messages.create({
  model: 'claude-opus-5-5',
  max_tokens: 16000,
  output_config: { effort: 'high', format: resumeSchema },
  system: [
    { type: 'text', text: RULES, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: profileText, cache_control: { type: 'ephemeral' } },
  ],
  messages: [{ role: 'user', content: jobText }],
});
```

Sem `thinking` explícito e sem `temperature`: no `claude-opus-5-5` o raciocínio é
sempre ativo e os parâmetros de amostragem foram removidos — quem controla a
profundidade é o `effort`. O `high` se justifica aqui porque a tarefa é de
julgamento, não de formatação.

### Custo por currículo

Entrada ~3k tokens (quase toda em cache depois da primeira), saída ~2k. A $4/MTok
de entrada e $20/MTok de saída, dá por volta de **US$ 0,05 por currículo** — e
menos ainda nas gerações seguintes. Cem candidaturas custam menos que um café.

---

## 6. Interface

**Aba `Perfil`** (nova, ao lado de `Regras`): formulário com React Hook Form +
Zod, listas dinâmicas para experiências, formação, skills e projetos. É a única
tela de escrita do painel até hoje, então vale caprichar na validação.

**Na vaga**: botão `Gerar currículo` no `JobDetailDrawer`. Abre um painel com três
seções:

- o Markdown renderizado, com botão de copiar;
- **"O que ficou de fora"** — os `gaps`, os requisitos que o seu perfil não cobre.
  Essa é a parte que mais te ajuda: diz na hora se vale aplicar, e o que estudar;
- **"Como foi montado"** — o `rationale`, recolhido por padrão.

Durante a geração, skeleton — a chamada leva alguns segundos com `effort: high`.
Se o mesmo `jobId` já tiver currículo gerado, a última versão aparece direto, com
um botão de gerar de novo: evita pagar duas vezes pela mesma vaga sem querer.

---

## 7. Testes

A regra do projeto continua valendo — domínio e aplicação com cobertura total:

- **`ResumePromptBuilder`** (domínio, sem I/O): é onde mora a lógica de verdade.
  Testes garantindo que todo o perfil entra, que a vaga entra, que os blocos saem
  na ordem que o cache espera, e que perfil vazio é recusado antes de gastar token.
- **`GenerateResumeUseCase`**: com um `StubResumeGenerator`, nos moldes dos dublês
  que já existem em `test/factories/doubles.ts`. Cobre vaga inexistente, perfil não
  preenchido, falha do provedor e gravação do histórico.
- **`AnthropicResumeGenerator`** (infra): com o SDK dublado, verificando que os
  dois `cache_control` vão no lugar certo, que o schema é enviado, e que erro da
  API vira erro de domínio em vez de vazar `APIError` para o controller.
- **E2E**: `POST /api/resume/generate` devolvendo 404 para vaga desconhecida, 422
  para perfil vazio e 200 com o Markdown.

Nenhum teste chama a API de verdade. A conferência com o modelo real é manual, na
primeira rodada, e é justamente onde o `rationale` serve: ele mostra se o modelo
entendeu a vaga ou só repetiu o perfil.

---

## 8. Fases sugeridas

| Fase | Entrega | Por que nesta ordem |
|---|---|---|
| 1 | Entidade, migration e aba `Perfil` | Sem perfil não há o que gerar; e essa fase não gasta um token |
| 2 | Porta, `ResumePromptBuilder` e caso de uso com dublê | O miolo testável, inteiro, antes de falar com a Anthropic |
| 3 | `AnthropicResumeGenerator` + `ANTHROPIC_API_KEY` | A ponta cara, já com tudo em volta verificado |
| 4 | Botão na vaga, Markdown, gaps e histórico | A tela, com o backend provado |

A fase 1 entrega valor sozinha (seu perfil versionado e editável) e as fases 2 e 3
podem ser verificadas sem UI nenhuma.

---

## 9. Pontos em aberto

- **`ANTHROPIC_API_KEY`** precisa entrar no `.env.example`, no `.env.prod.example`
  e nos secrets do deploy. É a primeira chave paga do projeto: vale um teto de
  gerações por dia para o caso de um bug entrar em laço.
- **Um perfil ou vários?** O desenho assume um. Se um dia você quiser um perfil
  "Frontend" e outro "Fullstack", a tabela já aceita — falta só o seletor na UI.
- **Idioma**: as vagas internacionais já são descartadas pelo filtro, então a saída
  é sempre em português. Se isso mudar, o idioma vira campo do pedido.

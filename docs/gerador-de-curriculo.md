# Gerador de Currículo Sob Medida

Desenho da feature antes da primeira linha de código. O objetivo é adaptar um
perfil único — o seu — à descrição de uma vaga específica já capturada pelo
radar, devolvendo um currículo em Markdown pronto para revisar, copiar e enviar.

> **Status:** implementado, da aba `Perfil` ao botão na vaga. Falta só pôr a
> `GEMINI_API_KEY` no ambiente para a geração sair do 502.

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
| Modelo | `gemini-2.0-flash`, via Google AI Studio | Nível gratuito cobre o uso do painel com folga; a porta `IResumeGenerator` existe justamente para a troca de provedor custar um arquivo |
| Disparo | Sob demanda, a partir da vaga | Gerar em lote queimaria tokens em vagas que você nunca vai aplicar |

---

## 3. Camadas

A feature respeita a mesma separação do resto do projeto: o domínio não conhece
o provedor de IA, o caso de uso depende só de interfaces, e a implementação
concreta fica na infraestrutura.

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
  ai/gemini-resume-generator.ts         Implementa IResumeGenerator com @google/genai
  prisma/prisma-candidate-profile-repository.ts
  prisma/prisma-resume-repository.ts

http/controllers/
  resume.controller.ts                  POST /api/resume/generate, GET/PUT /api/profile
```

### A porta

O contrato que isola o provedor de IA do resto do sistema. Trocar de provedor — ou
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

1. **Regras (estável)** — as regras do jogo: só usar fatos do perfil, nunca inflar
   senioridade, nunca inventar empresa ou tecnologia, escrever em português do
   Brasil, devolver os campos no formato pedido. Esse bloco não muda entre gerações.
2. **Perfil (estável)** — o seu histórico serializado. Também idêntico em toda
   geração, até você editar a aba de perfil.
3. **Vaga (volátil)** — título, empresa, descrição e tags da vaga alvo.

Os dois primeiros blocos somam algo como 2–3 mil tokens e se repetem em **toda**
geração: por isso vão na instrução de sistema, e a vaga vai no conteúdo. Com o
prefixo idêntico, o cache implícito do Gemini reconhece a repetição sozinho. Quem
monta os três blocos é o `ResumePromptBuilder`, no domínio — o adaptador só os
coloca onde o SDK espera, e é essa divisão que faz a troca de provedor não mexer
em nada do conteúdo.

A saída vem por **structured output** (`responseMimeType: 'application/json'` mais
o schema), não por "me devolva um JSON" no texto: o formato de
`{ markdown, rationale, gaps }` é garantido pela própria API, então o painel nunca
recebe um bloco meio escrito. O adaptador ainda valida o payload com Zod antes de
devolvê-lo — a API garante o formato, quem lê confere.

Configuração do pedido:

```ts
const response = await models.generateContent({
  model: 'gemini-2.0-flash',
  contents: jobText,
  config: {
    systemInstruction: `${RULES}

${profileText}`,
    responseMimeType: 'application/json',
    responseSchema: RESUME_OUTPUT_SCHEMA,
    maxOutputTokens: 8192,
  },
});
```

### Custo por currículo

Zero, dentro do nível gratuito do Google AI Studio, que é o motivo da escolha. O
que resta como limite é a cota diária de requisições — e ela é folgada para um
painel usado por uma pessoa.

---

## 6. Interface

**Aba `Perfil`** (nova, ao lado de `Regras`): formulário com React Hook Form +
Zod, listas dinâmicas para experiências, formação, skills e projetos. É a única
tela de escrita do painel até hoje, então vale caprichar na validação.

**Na vaga**: botão `Gerar currículo sob medida` no `JobDetail` — o mesmo
componente serve o painel fixo do desktop e o drawer do celular. Abre um painel com três
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
- **`GeminiResumeGenerator`** (infra): com o SDK dublado, verificando que regras e
  perfil vão para a instrução de sistema e a vaga para o conteúdo, que o schema é
  enviado, que resposta fora do formato é recusada, e que erro da API vira erro de
  domínio em vez de vazar `ApiError` para o controller.
- **E2E**: `POST /api/resume/generate` devolvendo 404 para vaga desconhecida, 422
  para perfil vazio e 200 com o Markdown.

Nenhum teste chama a API de verdade. A conferência com o modelo real é manual, na
primeira rodada, e é justamente onde o `rationale` serve: ele mostra se o modelo
entendeu a vaga ou só repetiu o perfil.

---

## 8. Fases sugeridas

| Fase | Entrega | Por que nesta ordem |
|---|---|---|
| 1 | ✅ Entidade, migration e aba `Perfil` | Sem perfil não há o que gerar; e essa fase não gasta um token |
| 2 | ✅ Porta, `ResumePromptBuilder` e caso de uso com dublê | O miolo testável, inteiro, antes de falar com o provedor |
| 3 | ✅ `GeminiResumeGenerator` + `GEMINI_API_KEY` | A ponta externa, já com tudo em volta verificado |
| 4 | ✅ Botão na vaga, Markdown, gaps e histórico | A tela, com o backend provado |

A fase 1 entrega valor sozinha (seu perfil versionado e editável) e as fases 2 e 3
podem ser verificadas sem UI nenhuma.

---

## 9. Pontos em aberto

- **`GEMINI_API_KEY`** já está no `.env.example`, no `.env.prod.example` e no
  `docker-compose.prod.yml`; falta pôr o valor no `.env` da VPS. Sem ela a API
  sobe igual e só a rota de geração responde 502.
- **Teto diário de gerações**: ainda não existe. Enquanto a geração for gratuita o
  risco é bater na cota do nível gratuito, não na fatura; a proteção de hoje é o
  reaproveitamento da última versão salva por vaga — regerar é sempre um clique
  deliberado.
- **Qualidade por modelo**: a seleção de experiências é tarefa de julgamento, e um
  modelo `flash` é mais fraco nela que um modelo de raciocínio. Se o `rationale`
  mostrar que a adaptação ficou rasa, trocar o id do modelo é uma constante — e
  trocar de provedor é um arquivo, por causa da porta.
- **Um perfil ou vários?** O desenho assume um. Se um dia você quiser um perfil
  "Frontend" e outro "Fullstack", a tabela já aceita — falta só o seletor na UI.
- **Idioma**: as vagas internacionais já são descartadas pelo filtro, então a saída
  é sempre em português. Se isso mudar, o idioma vira campo do pedido.

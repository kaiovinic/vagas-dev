# Especificação do Projeto: Agregador e Dashboard de Vagas (Frontend & Fullstack - Salvador/Remoto)

## 1. Visão Geral do Produto

Sistema automatizado que coleta, filtra, deduplica e notifica vagas para Desenvolvedor Frontend e Fullstack (foco em React, Next.js, TypeScript, Node.js, Angular, C#/.NET) localizadas em Salvador/BA (e Região Metropolitana) ou 100% Remotas.

- Janela de tempo estrita: contam apenas vagas publicadas nas últimas 72 horas.
- Fontes previstas: LinkedIn (vagas e publicações), Gupy, GitHub (repositórios de vagas), Remotar, Programathor, Coodesh, InHire, Catho, Sólides, Nerdin, Recrutei e UpVagas.
- Higienização: Um motor de regras descarta publicações que citam as tecnologias mas não são vagas reais (cursos, bootcamps, listas de grupos, propaganda de currículo ou candidatos buscando recolocação). As regras devem ficar públicas em uma rota/aba específica por transparência.
- Canais de saída: Alertas em tempo real e resumo semanal no Telegram + Dashboard Web analítico.

## 2. Stack Tecnológica (Monorepo)

- **Backend (`/apps/api`):** Node.js, TypeScript (strict mode), NestJS, Prisma ORM, PostgreSQL (via Docker), `@nestjs/schedule` (Cron), `axios`, `cheerio`.
- **Testes Backend:** Vitest (ou Jest) + Supertest. Abordagem estrita de TDD (Red -> Green -> Refactor).
- **Frontend (`/apps/web`):** React + Vite (ou Next.js), TypeScript, Tailwind CSS, TanStack Query (`useQuery`, `useMutation`), React Hook Form (`useForm`) + `@hookform/resolvers/zod`, Recharts (gráficos), Lucide React.
- **Testes Frontend:** Vitest + React Testing Library.

## 3. Diretrizes de Engenharia: Clean Architecture, SOLID e Clean Code

1. **Single Responsibility Principle (SRP):** Classes pequenas e focadas. Um Scraper apenas busca e normaliza o HTML/JSON bruto; quem filtra é o `JobFilterDomainService`; quem gera o hash é o `JobFingerprintService`; quem salva é o `JobRepository`.
2. **Open/Closed Principle (OCP):** Para adicionar uma nova plataforma de vagas (ex: Coodesh ou Programathor), o sistema NÃO deve ter seu orquestrador modificado. Todos os coletores devem implementar a interface `IJobScraperProvider` e ser injetados via multi-provider token (`JOB_SCRAPERS`).
3. **Liskov Substitution Principle (LSP):** Qualquer implementação de `IJobScraperProvider` deve retornar `Promise<RawJobProps[]>` sem lançar exceções não tratadas que quebrem o `Promise.allSettled` do orquestrador.
4. **Interface Segregation Principle (ISP):** Segregar contratos de leitura de métricas (`IDashboardMetricsRepository`) dos contratos de escrita de captura (`IJobWriteRepository`).
5. **Dependency Inversion Principle (DIP):** Casos de uso (Application Layer) dependem exclusivamente de interfaces/abstrações do Domínio, nunca diretamente do Prisma, Axios ou da API do Telegram.
6. **Clean Code:** Proibido o uso de `any`. Nomes reveladores de intenção, funções com no máximo 20 linhas, Early Return para evitar `if/else` aninhados e Value Objects para validação de domínio.

## 4. Requisitos do Dashboard e Interface

- **Abas de Navegação:** `Vagas`, `Dashboard`, `Empresas`, `Recrutadores`, `Mercado` e `Regras`.
- **Cabeçalho de Status:** Exibir o timestamp exato da última captura ("há X min") e a previsão da próxima captura ("em X min") no horário de Brasília.
- **Cards de KPI:**
  1. Vagas abertas (publicadas nas últimas 72h).
  2. Novas nas últimas 24h (com indicador de variação `▲ +X vs. 24h anteriores`).
  3. Remotas (total e percentual sobre as vagas abertas).
  4. Empresas contratando (total de empresas distintas com nome informado nas últimas 72h).
- **Gráficos:**
  1. Gráfico de Rosca/Pizza: "Qual site tem mais vagas (Vagas abertas das últimas 72h, por fonte)" com legenda contendo quantidade e percentual.
  2. Gráfico de Barras Empilhadas: "Vagas novas por dia (Por dia de publicação no horário de Brasília, empilhadas por fonte)" com filtro de período (ex: 14 dias).

# Vagas Dev

Agregador de vagas para **Desenvolvedor Frontend e Fullstack** em Salvador/BA (e Região Metropolitana) ou 100% remotas. Coleta de cinco fontes a cada 2 horas, descarta o que não é vaga de verdade, deduplica entre plataformas, avisa no Telegram e apresenta tudo em um dashboard analítico.

[![CI](https://github.com/kaiovinic/vagas-dev/actions/workflows/ci.yml/badge.svg)](https://github.com/kaiovinic/vagas-dev/actions/workflows/ci.yml)
[![Cobertura](https://img.shields.io/badge/cobertura-99%25-brightgreen)](#qualidade)
[![Domínio e Aplicação](https://img.shields.io/badge/dom%C3%ADnio%20e%20aplica%C3%A7%C3%A3o-100%25-brightgreen)](#qualidade)

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-multi--stage-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)

---

## O problema

Procurar vaga de dev em Salvador significa abrir seis abas por dia, reler os mesmos anúncios e ainda assim perder a vaga publicada às 23h de uma sexta. Pior: boa parte do que uma busca por "React" devolve não é vaga — é curso, bootcamp, divulgação de currículo ou alguém pedindo recolocação.

Este projeto resolve as duas coisas: busca sozinho, e **joga fora o que não é vaga**.

## O produto

### Coletor

Varre seis fontes a cada 2 horas: **Gupy**, **LinkedIn**, **Remotar**, **ProgramaThor**, **Sólides** e repositórios de vagas no **GitHub**.

> Existe também um coletor do **Jobbol**, implementado e testado, mas inativo na prática: o site fica atrás do Bot Management da Cloudflare, que responde `403` a qualquer cliente HTTP que não seja um navegador. O coletor continua registrado e passa a funcionar sem alteração caso o acesso seja liberado. Também dá para disparar na hora, pelo botão `Capturar agora` do dashboard.

O que entra passa por um funil de três etapas:

1. **Regras de negócio** — janela estrita de 72h, match de stack (React, Next.js, TypeScript, Node.js, Angular, C#/.NET), localidade (Remoto ou Salvador + RMS), mercado nacional (vaga declaradamente internacional é descartada) e um filtro anti-ruído que elimina curso, bootcamp, lista de grupo e `#opentowork`. As regras ficam **públicas na aba `Regras`**, com um testador: você cola um texto e vê exatamente qual regra aprovou ou reprovou.
2. **Deduplicação** — um fingerprint SHA-256 de `empresa + título` normalizados. A mesma vaga anunciada no LinkedIn e na Gupy conta uma vez só.
3. **Classificação** — senioridade (pelo título, não pela descrição) e mercado nacional × internacional, gravados em coluna no momento da captura.

Uma captura típica: **309 encontradas → 49 aprovadas → 43 inéditas**.

### Dashboard analítico

Seis abas: `Vagas`, `Dashboard`, `Empresas`, `Recrutadores`, `Mercado` e `Regras`.

- **KPIs** — vagas abertas, novas em 24h com variação contra as 24h anteriores, remotas (total e percentual) e empresas contratando.
- **Gráficos** — rosca de vagas por fonte e barras empilhadas por dia de publicação, com seletor de período.
- **Filtros** — busca textual, tecnologias, modalidade, senioridade e fonte, todos refletidos na URL.
- **Cabeçalho de status** — horário da última captura e previsão da próxima, no fuso de Brasília.

### Alertas no Telegram

Cada vaga inédita vira uma mensagem com cargo, empresa, modalidade, mercado, stack e link direto da candidatura:

```
💼 Pessoa Desenvolvedora Frontend React Senior
🏢 Empresa de Teste
📍 Remoto · Salvador/BA · 🇧🇷 Nacional
🔎 Gupy
🏷️ React · TypeScript · Node.js

Ver vaga e se candidatar
```

A API avisa no boot se os alertas estão ligados ou não — um deploy sem token não sobe calado.

**Toda segunda às 08:00** sai também o resumo da semana: vagas abertas, publicadas nos últimos 7 dias, remotas × Salvador/RMS e as cinco stacks mais pedidas.

---

## Decisões de arquitetura

### Clean Architecture

Quatro camadas, com a dependência sempre apontando para dentro:

```
domain/        regras de negócio puras — nenhum import de Prisma, Axios ou Nest
application/   casos de uso e orquestração; dependem só de interfaces do domínio
infra/         Prisma, Axios, scrapers, Telegram — implementam as portas
http/          controllers; traduzem HTTP para caso de uso e nada mais
```

O domínio não sabe que existe banco. O caso de uso não sabe que existe Prisma.

### SOLID na prática

- **SRP** — o scraper só busca e normaliza; quem filtra é o `JobRuleEngine`; quem gera o hash é o `JobFingerprint`; quem grava é o repositório.
- **OCP + Strategy nos coletores** — todo coletor implementa `IJobScraperProvider` e é injetado pelo multi-provider `JOB_SCRAPERS`. **Adicionar uma sexta fonte não toca o orquestrador**: basta a nova classe e uma linha na lista do módulo.
- **LSP** — nenhuma implementação lança exceção não tratada: o `BaseScraperProvider` garante que uma fonte fora do ar vire lista vazia, não uma captura quebrada.
- **ISP** — contratos de leitura e escrita são separados (`IJobWriteRepository`, `IDashboardMetricsRepository`, `IJobQueryRepository`, `IMarketInsightsRepository`). Quem só lê métrica não enxerga método de escrita.
- **DIP** — casos de uso dependem de tokens do domínio (`JOB_SCRAPERS`, `TELEGRAM_NOTIFIER`, `CAPTURE_SCHEDULE`), nunca de uma classe concreta de infraestrutura.

### TDD

Teste primeiro, em ciclo Red → Green → Refactor. O domínio e a camada de aplicação têm **100% de cobertura obrigatória**, com o limite aplicado no CI — se cair abaixo, o pipeline falha.

Os coletores são testados contra **fixtures reais**, capturados dos endpoints de verdade, e não contra HTML inventado.

### Controle de concorrência

O cron de 2h e o botão `Capturar agora` compartilham um `CaptureCoordinator` com trava de execução única. Clicar no botão durante uma captura em andamento **não dispara uma segunda** — a chamada se junta à que já está rodando e recebe o mesmo relatório. Sem isso, duas varreduras simultâneas disputariam as mesmas inserções.

### Rate limit do Telegram

A API da Bot aceita cerca de 1 mensagem por segundo no mesmo chat. Uma captura com 18 vagas inéditas dispararia 18 envios no mesmo instante e levaria `429`.

O notificador resolve isso **onde o limite é conhecido** — no adaptador, não em quem chama: uma fila serial encadeada, com 1,1s entre mensagens. Quem usa continua disparando tudo de uma vez; os envios se enfileiram sozinhos. Uma falha no meio não trava as seguintes.

### Fuso horário

Tudo é gravado em UTC e convertido para `America/Bahia` na leitura. Fontes que publicam só a data (sem hora) são ancoradas ao meio-dia de Brasília — ancorar à meia-noite UTC jogaria a vaga para o dia anterior nos gráficos.

---

## Como rodar localmente

**Pré-requisitos:** Node.js 22+ e Docker.

```bash
git clone https://github.com/kaiovinic/vagas-dev.git
cd vagas-dev
npm install
```

**1. Suba o banco**

```bash
npm run db:up
```

**2. Configure o ambiente**

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
```

O Telegram é opcional: sem `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` a API sobe normalmente e só avisa em `WARN` que os alertas estão desligados. Para ligar, pegue o token com o [@BotFather](https://t.me/BotFather).

**3. Aplique as migrations**

```bash
npm run db:migrate
```

**4. Rode a API e o frontend** (em dois terminais)

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Dashboard em **http://localhost:5173**, API em **http://localhost:3333**.

A primeira captura roda na próxima hora par — ou clique em `Capturar agora` para não esperar.

### Em produção

```bash
cp .env.prod.example .env.prod
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Sobe PostgreSQL com volume persistente, a API (que aplica as migrations no entrypoint antes de servir), o Nginx com os estáticos e o Caddy como proxy reverso, **com certificado TLS emitido e renovado automaticamente**. Só o proxy publica porta; o banco fica em rede sem saída para a internet.

---

## Comandos úteis

| Comando | O que faz |
|---|---|
| `npm run dev:api` | API em watch mode |
| `npm run dev:web` | Frontend em watch mode |
| `npm test` | Todos os testes |
| `npm run test:cov` | Testes com relatório e limites de cobertura |
| `npm run test:int` | Testes de integração (precisa do banco no ar) |
| `npm run lint` | ESLint nos dois workspaces |
| `npm run typecheck` | `tsc --noEmit` nos dois workspaces |
| `npm run build` | Build de produção |
| `npm run db:up` | Sobe o PostgreSQL no Docker |
| `npm run db:migrate` | Aplica as migrations |
| `npm run db:studio` | Prisma Studio |
| `npm run telegram:test --workspace @devradar/api` | Envia uma mensagem de teste ao chat |
| `npm run telegram:digest --workspace @devradar/api` | Dispara o resumo semanal agora |
| `npm run jobs:purge-international --workspace @devradar/api` | Lista (e com `-- --apply` remove) vagas internacionais antigas |
| `npm run jobs:list-unknown --workspace @devradar/api` | Lista as vagas cujo mercado o classificador nao determinou |
| `npm run jobs:reclassify --workspace @devradar/api` | Recalcula o mercado das vagas ja gravadas (`-- --apply` grava) |

---

## Qualidade

**966 testes**, rodando em seis jobs no CI a cada push: lint, typecheck, testes com cobertura, testes de integração contra um PostgreSQL real, build dos workspaces e build das duas imagens Docker.

| Camada | Cobertura |
|---|---|
| `domain/` | 100% (obrigatório) |
| `application/` | 100% (obrigatório) |
| API, total | 99,9% |
| Frontend | 99,9% |

O ESLint roda com informação de tipo e carrega só regras que pegam o que o compilador não pega — promise solta, `async` usado onde se espera função síncrona, `switch` não exaustivo, dependência faltando em hook. Formatação ficou de fora de propósito.

---

## Stack

**Backend** — Node.js, TypeScript strict, NestJS 11, Prisma, PostgreSQL 16, `@nestjs/schedule`, Axios, Cheerio, Zod
**Frontend** — React 19, Vite, TypeScript, Tailwind CSS 4, TanStack Query, React Hook Form + Zod, Recharts, Lucide
**Testes** — Vitest, Supertest, React Testing Library
**Infra** — Docker multi-stage, Docker Compose, Nginx, Caddy, GitHub Actions

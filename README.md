# DevRadar

Agregador de vagas para **Desenvolvedor Frontend e Fullstack** em qualquer município da Bahia ou 100% remotas. Coleta de oito fontes públicas a cada 2 horas — mais um coletor com sessão autenticada no LinkedIn, em serviço separado —, descarta o que não é vaga de verdade, deduplica entre plataformas, avisa no Telegram e apresenta tudo em um dashboard analítico.

Da vaga até a candidatura: a partir de um perfil único, o DevRadar escreve com o Gemini um **currículo sob medida para cada vaga** e o exporta em PDF A4 direto do navegador.

[![CI](https://github.com/kaiovinic/vagas-dev/actions/workflows/ci.yml/badge.svg)](https://github.com/kaiovinic/vagas-dev/actions/workflows/ci.yml)
[![Cobertura](https://img.shields.io/badge/cobertura-96%25-brightgreen)](#qualidade)
[![Domínio e Aplicação](https://img.shields.io/badge/dom%C3%ADnio%20e%20aplica%C3%A7%C3%A3o-100%25-brightgreen)](#qualidade)

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-multi--stage-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)

![Dashboard do DevRadar: KPIs das últimas 72h, vagas por fonte, novas por dia e a tabela de saúde da coleta](docs/dashboard.png)

---

## O problema

Procurar vaga de dev na Bahia significa abrir seis abas por dia, reler os mesmos anúncios e ainda assim perder a vaga publicada às 23h de uma sexta. Pior: boa parte do que uma busca por "React" devolve não é vaga — é curso, bootcamp, divulgação de currículo ou alguém pedindo recolocação.

Este projeto resolve as duas coisas: busca sozinho, e **joga fora o que não é vaga**.

## O produto

### Coletor

Oito fontes ativas. A coluna **lidas** é o que cada uma trouxe numa varredura real, antes de qualquer filtro:

| fonte | como | intervalo | lidas | observação |
|---|---|---|---|---|
| **Next Commit** | HTML paginado por área | 2h | 131 | 44% dos cards batem com a stack |
| **Remotar** | API JSON | 2h | 100 | |
| **GitHub** | issues de `frontendbr/vagas`, `react-brasil/vagas`, `backend-br/vagas` | 2h | 73 | |
| **Gupy** | `__NEXT_DATA__` da busca | 2h | 59 | |
| **LinkedIn** (vagas) | endpoint guest, sem login, paginado de 10 em 10 | 2h | 49 | teto de 4 páginas por busca remota, 2 na regional |
| **ProgramaThor** | HTML | 2h | 18 | |
| **InHire** | API publica do ATS, um tenant por empresa | 2h | 69 | 410 vagas nos 17 tenants semente, mais os descobertos; 69 sao cargos de desenvolvimento |
| **LinkedIn** (publicações) | índice do Google, via [Serper](https://serper.dev) | **4h** | 5 | catálogo exclusivo; exige `SERP_API_KEY` |
| **LinkedIn** (publicações logadas) | busca do próprio LinkedIn, com sessão autenticada, pelo [`apps/posts-worker`](#o-coletor-com-sessão-autenticada-appsposts-worker) | **8h** | — | ainda não rodou contra a conta; sem o worker de pé vira no-op silencioso |

Toda saída HTTP passa por um decorator de repeticão: 429, timeout e 5xx são tentados de novo com espera exponencial (1s, 2s, 4s), respeitando o `Retry-After` quando a fonte o informa. As requisições de uma mesma fonte saem em fila, com 1,5s entre elas — o IP da VPS é compartilhado com outro projeto.

Volume não é qualidade: o Next Commit lidera as leituras e as publicações do LinkedIn trazem cinco por ciclo, mas são elas que acham a vaga que não está em portal nenhum.

Três coletores existem, são testados e estão **fora do registro**, cada um por um motivo medido:

- **Jobbol** — o site fica atrás do Bot Management da Cloudflare, que responde `403` a qualquer cliente que não seja navegador. O bloqueio é por impressão digital de TLS: `curl` com o mesmo User-Agent recebe 200, o axios recebe 403.
- **Sólides** — a área de "tecnologia" é suporte e infraestrutura. Das 124 vagas da Bahia, 7 citam a stack e nenhuma estava dentro da janela.
- **Coodesh** — o catálogo real fica atrás de API autenticada; o sitemap público é dominado por vagas de vendas do Google Cloud.

Religar qualquer um é devolver o import e uma linha ao módulo.

#### A data das publicações do LinkedIn

Resultado de buscador **não traz data de publicação**. Sem resolver isso, a única saída seria carimbar o instante da captura — e numa janela de 72h isso erra por horas.

A URL de um post carrega a resposta:

```
linkedin.com/posts/vaz10k_vaga-remota-...-activity-7521210450005594113-7u22
                                                  └──────── snowflake ────────┘
```

Os 22 bits baixos são sequência e nó; o resto é o instante em milissegundos. `Number(BigInt(id) >> 22n)` devolve **28/10/2026 14:05:08** — precisão de segundos, sem uma única requisição ao LinkedIn.

#### Controle de cota

O coletor de publicações é o único que custa dinheiro. Ele roda dentro da captura de 2h, mas se recusa em silêncio fora do seu próprio intervalo de 4 horas:

```
3 consultas por execução  ×  6 execuções/dia  =  18 créditos/dia
2.500 créditos gratuitos  ÷  18              ≈  4 meses e meio
```

São duas buscas separadas — uma de remoto nacional (1 página), outra da Bahia (2 páginas). Separar importa: uma busca única e ampla é dominada pelo mercado remoto, que tem muito mais volume, e a região nunca aparece.

### O coletor com sessão autenticada (`apps/posts-worker`)

O coletor acima encontra publicação pelo índice do Google, que indexa pouco e devagar. Quem está logado vê a busca de publicações do próprio LinkedIn — e é lá que está a vaga que o recrutador baiano anuncia num post e nunca publica em portal. O desenho inteiro, com as alternativas descartadas, está em [`docs/rfcs/001-linkedin-auth-playwright-scraper.md`](docs/rfcs/001-linkedin-auth-playwright-scraper.md).

Isso virou um **terceiro workspace**, e não um nono provider dentro da API, por três motivos que não se resolvem no mesmo processo:

- **O Chromium não cabe na imagem da API.** A imagem da API é Alpine, e o Chromium do Playwright precisa de glibc — a base do worker é a oficial do Playwright, em Debian, e tem ~1 GB. Empacotar as duas juntas engordaria a API por uma fonte.
- **Navegador não pode segurar a captura.** Um seletor que trava por trinta segundos não pode atrasar as outras oito fontes, que respondem em menos de um segundo.
- **A sessão é credencial.** O `state.json` do Playwright vive num volume só dele, isolado do resto.

A API não navega: ela faz `GET /posts` no worker e recebe **a última colheita já pronta** — cache, não navegação sob demanda. O worker colhe no seu próprio ritmo, grava `harvest.json` de forma atômica (`.tmp` + `rename`, sob trava de arquivo) e serve esse mesmo documento, sem transformar nada. Duas consequências úteis: a captura da API continua custando um GET, e qualquer suspeita se verifica com um `cat` no volume.

**A data continua saindo do link.** O worker entrega a URL e não opina sobre data — em especial, nunca lê "há 3 h" da tela. Quem decodifica o snowflake é a API, com o mesmo código já testado.

#### O que o worker faz quando o dia é ruim

Nenhuma dessas situações dá para encomendar ao LinkedIn, e todas têm teste porque a decisão fica fora do navegador: `runHarvest` recebe a página como porta e devolve o documento, enquanto o adaptador do Playwright só clica e lê atributo.

| situação | o que acontece |
|---|---|
| Sessão caiu (desvio para `/login`, `/checkpoint`) | grava `status: "session-lost"` **preservando a colheita anterior**, com o `harvestedAt` antigo; a API alerta uma vez no Telegram |
| Uma busca não abriu | `degraded`, com o que a outra trouxe; a busca que falhou aparece no relatório com zero, em vez de desaparecer dele |
| Nenhuma busca abriu | a colheita anterior fica onde está — trocar três dias de vagas por um arquivo vazio porque a rede piscou faria a fonte secar sem motivo |
| Seletor mudou | colhe o que der; card sem link reconhecível é descartado e **contado** por motivo |
| Colheita sendo gravada | o `GET /posts` responde `503` com `Retry-After`, em vez de afirmar "nunca rodou" |

Preservar o `harvestedAt` antigo no `session-lost` é o que mantém a idade honesta no painel: o material é velho, a janela de 72h o derruba sozinha em três dias, e carimbar a hora de agora esconderia exatamente isso.

#### A cadência, e a janela de atividade

O relógio mora **dentro do worker** (um `setTimeout` que se reagenda, no mesmo processo do Fastify), e não num cron do host — cron de fora precisaria de `docker exec`, que é mais uma peça para configurar na VPS e mais um jeito de a colheita silenciar sem ninguém notar.

- **Intervalo de 8 horas**, com **20 minutos de sorteio** para cada lado: colher às 03:00:07 todos os dias é assinatura de robô.
- **Janela de atividade das 08h às 22h**, no fuso configurado (`America/Bahia` por padrão). O disparo que cairia fora dela **anda para a abertura seguinte**, com o sorteio por cima. O motivo não é técnico: conta que abre o LinkedIn às 3h da manhã, todos os dias, parece o que é — e esperar a manhã não custa vaga nenhuma, porque a janela de 72h não se mede em horas de sono.
- **A primeira colheita conta a idade da que já está no volume.** Começar o intervalo do zero a cada boot faria um contêiner reiniciado toda manhã nunca chegar ao fim das 8 h, e a fonte secaria no painel sem um único erro para ver.
- **Depois de uma sessão caída, o disparo agendado é recusado** até o `state.json` ser reescrito. A data de gravação do arquivo é a evidência de que o login foi refeito — um contador precisaria ser mantido em sincronia com o mundo; a data, não.

O `POST /harvest` dispara na hora e **ignora a janela**, de propósito: quem bate nessa rota acabou de refazer o login ou está conferindo um seletor, e sabe mais sobre o estado da conta que qualquer regra do código.

> **Estado atual, sem rodeios:** nenhuma colheita rodou contra o LinkedIn logado. A primeira conta foi restringida no primeiro login automatizado, antes de qualquer raspagem, e os seletores de navegação e as fixtures de HTML (reconstruídas a partir de um coletor de referência, cada arquivo dizendo isso no topo) só passam a valer como garantia depois da primeira colheita de verdade. Qualquer restrição na conta desliga o coletor, e ele fica desligado.

### O funil

O que entra passa por **sete regras**, todas públicas na aba `Regras` com um testador onde você cola um texto e vê qual regra aprovou ou reprovou:

| regra | o que faz |
|---|---|
| Janela de 72h | descarta o que é velho e o que tem data no futuro |
| Stack | exige React, Next.js, TypeScript, Node.js, Angular, C#/.NET ou cargo de desenvolvimento web |
| Localidade | Remoto, ou qualquer município da Bahia |
| Anti-ruído | corta curso, bootcamp, lista de grupo, `#opentowork` |
| Mercado nacional | descarta vaga declaradamente internacional |
| Anúncio de verdade¹ | o texto precisa anunciar uma vaga, não falar sobre vagas |
| Conta agregadora¹ | bloqueia quem republica vaga de terceiros em massa |

¹ valem apenas para publicações de rede social. Um anúncio de portal não precisa dizer "candidate-se" — a página já é o anúncio.

Depois do filtro vêm a **deduplicação**, por fingerprint SHA-256 de `empresa + título` normalizados, e a **classificação** de senioridade e mercado, gravadas em coluna no momento da captura.

Uma captura típica: **439 encontradas → 43 aprovadas**.

### Dashboard analítico

Seis abas: `Vagas`, `Dashboard`, `Empresas`, `Recrutadores`, `Mercado` e `Regras`.

- **KPIs** — vagas abertas, novas em 24h com variação contra as 24h anteriores, remotas (total e percentual) e empresas contratando.
- **Gráficos** — rosca de vagas por fonte e barras empilhadas por dia de publicação, com seletor de período. As oito fontes têm cor fixa, a mesma nos dois gráficos e na tabela de saúde.
- **Filtros** — busca textual, tecnologias, modalidade, senioridade e fonte, mais um recorte temporal de `1h` a `7d`.
- **Saúde da coleta** — uma linha por coletor: estado agora, última execução, próxima, vagas lidas e falhas nas últimas 24h.
- **Split view** — no desktop, feed de cards à esquerda e painel da vaga selecionada à direita; no celular, o mesmo painel abre em drawer.
- **Radar ao vivo** — com o toggle ligado, a lista é reconsultada a cada 60s e um aviso discreto informa quantas vagas chegaram.
- **Cabeçalho de status** — horário da última captura e previsão da próxima, no fuso de Brasília.

#### O recorte de 7 dias

O radar só aceita vaga publicada nas últimas 72h, mas o recorte da lista vai até **168h**. Não é contradição: o chip `7d` mostra o que já foi capturado dentro da janela e envelheceu desde então. Nada mais antigo existe no banco, porque nunca entrou. A badge de idade acompanha — `nova`, `recente`, `1 a 3 dias`, `3 a 7 dias` — com a última faixa apagada de propósito: vaga dessa idade já tem fila de candidatos.

#### Saúde da coleta

O cabeçalho de status responde pelo conjunto, e é aí que ele engana: uma captura `SUCCESS` com 439 vagas encontradas esconde perfeitamente o coletor que não traz nada há um dia. Foi o que aconteceu com o Jobbol, que passou a responder `403` e continuou sendo contado como fonte ativa.

A tabela `capture_source_logs` grava **uma linha por fonte por captura** — `captureId`, `source`, `ranAt`, `totalFound`, `failed` e `errorMessage` — escrita antes do filtro, de modo que `totalFound` é o que a fonte entregou, não o que sobreviveu às regras. A aba `Dashboard` lê dali a última execução, a próxima, as vagas lidas e as falhas das últimas 24h.

O estado tem **três** valores, e não dois:

| estado | significa | quando aparece |
|---|---|---|
| `ok` | a última execução deu certo e a fonte trouxe vagas | caso normal |
| `sem vagas` | respondeu sem erro e voltou de mãos vazias | o caso Jobbol: `200` com catálogo vazio, ou bloqueio silencioso |
| `falha` | a **última** execução falhou | fonte fora do ar, mudança de HTML, timeout |

Dois estados não bastam. Chamar de `ok` quem responde e não traz nada é exatamente o ponto cego que a tabela existe para fechar; chamar de `falha` seria mentira, e um alerta que grita por uma fonte sadia deixa de ser lido. O estado olha a **última** execução, não a média da janela: onze sucessos não salvam a fonte que acabou de quebrar.

#### `source-cadence.ts`, fonte única dos intervalos

Duas camadas precisam saber de quanto em quanto tempo cada fonte é visitada: o coletor de publicações, que se recusa a rodar antes da hora para poupar cota, e a tabela de saúde, que anuncia a próxima execução. Se cada um guardasse o seu número, a tabela mentiria no dia em que o intervalo mudasse.

Por isso o intervalo mora no domínio, em [`source-cadence.ts`](apps/api/src/domain/services/source-cadence.ts):

```ts
sourceIntervalInHours('gupy')            // 2  — ritmo da captura
sourceIntervalInHours('linkedin-posts')  // 4  — espaçado por custo de API
nextSourceRunAt('linkedin-posts', lastRunAt)
```

O provider do LinkedIn deriva seu próprio `LINKEDIN_POSTS_MIN_INTERVAL_HOURS` dessa constante. Mudar a cadência de uma fonte é editar **um** arquivo, e a interface acompanha sozinha.

#### Onde o intervalo é medido

O intervalo diz *quanto* esperar; falta saber *desde quando*. Esse instante vem do banco, não da memória do processo.

A primeira versão guardava o `lastRunAt` num campo do provider, e todo restart da API o zerava: a captura seguinte gastava os 3 créditos por mais recente que tivesse sido a busca anterior. Em desenvolvimento, com a API reiniciando a cada arquivo salvo, isso queimava cota o dia inteiro — e a conta de 4 meses e meio virava ficção.

Hoje o orquestrador pergunta `isDue(reference)` a cada coletor **antes** de visitá-lo, e o de publicações responde comparando o relógio com o último `ranAt` em `capture_source_logs`.

Perguntar antes não é detalhe de implementação: é o que torna a leitura possível. Se a fonte adiada ainda assim fosse registrada no ciclo, o próprio registro do adiamento seria lido como "rodou agora" e a vez dela não chegaria nunca. Fonte adiada não é visitada, não entra na saúde da coleta e não conta para o status da captura — não está falhando nem parada, só não chegou a hora.

### Currículo sob medida

O perfil profissional é cadastrado **uma vez**, na aba `Perfil`: contatos, resumo, experiências com período e tecnologias, competências agrupadas, projetos e formação. A partir dele, cada vaga ganha um botão que escreve o currículo daquela candidatura.

O botão chama `POST /api/resume/generate` com o id da vaga. A geração é um clique deliberado, nunca automática — e a rota devolve a última versão salva quando ela já existe, gravada em `generated_resumes` com o modelo e o consumo de tokens. Pagar de novo pela mesma vaga exige `Gerar outra versão`.

O retorno não é só o texto:

| campo | o que traz |
|---|---|
| `markdown` | o currículo completo, pronto para revisar e copiar |
| `rationale` | por que cada bloco foi destacado ou deixado de lado |
| `gaps` | requisitos da vaga que o perfil **não** cobre, do mais ao menos grave |

Os `gaps` são a parte mais útil do retorno e ficam numa caixa própria, fora do currículo: dizem na hora se vale aplicar e o que estudar. Como são análise sobre a vaga, e não conteúdo a enviar, também não entram no PDF.

A saída vem por **structured output** (`responseMimeType: 'application/json'` mais o JSON Schema), validada de novo com Zod no adaptador: o painel nunca recebe um bloco meio escrito. Regras e perfil vão na instrução de sistema e só a vaga no conteúdo — o prefixo idêntico é o que o cache implícito do Gemini procura para cobrar menos.

Erro do provedor não vira tela branca: a rota responde `404` para vaga que saiu do radar, `422` para perfil incompleto (com link para a aba `Perfil`) e `502` quando a falha é do Gemini.

#### O contrato de Markdown

O prompt não pede "um currículo em Markdown": ele **fixa os níveis**, com um esqueleto exato.

| nível | exigência |
|---|---|
| `# Nome Completo` | um único, no topo, seguido da linha de contatos |
| `## SEÇÃO` | em caixa alta: `RESUMO`, `EXPERIÊNCIA`, `COMPETÊNCIAS`, `PROJETOS`, `FORMAÇÃO` |
| `### Título (período)` | um por cargo, projeto ou curso, com o período entre parênteses no fim |
| `**Tecnologias:** item1, item2` | logo abaixo do `###`, em nenhum outro lugar |

Não é preciosismo de formato. O PDF só sabe engrossar um nome, versalear uma seção, alinhar o período à direita e manter um cargo inteiro na mesma página se eles chegarem nesses níveis. Uma geração saiu em texto plano e virou um PDF com **dois tamanhos de fonte e nenhuma hierarquia** — o layout dependia da forma que o modelo escolhesse no dia. Pedir a estrutura na origem custa alguns tokens no bloco que o cache já cobre; adivinhá-la no frontend custaria heurística sobre heurística.

#### O PDF sem Chromium no servidor

A exportação usa `@media print` e o `window.print()` do navegador. As alternativas foram descartadas por motivo medido:

| opção | por que não |
|---|---|
| `html2pdf.js` (html2canvas) | rasteriza a página: o PDF vira **imagem**, sem texto selecionável — ilegível para o ATS que lê currículo |
| `@react-pdf/renderer` | obrigaria a escrever o currículo duas vezes, em HTML e na linguagem da lib, e somaria ~400 kB ao bundle |
| Puppeteer na API | um Chromium disputando RAM e CPU na VPS por algo que o navegador do candidato faz de graça |

Imprimir a tela também não serve: o painel é escuro, rola dentro de dois contêineres e tem botões em volta. Então o currículo ganha **árvore própria**, montada por portal como irmã do `#root` — invisível na tela, a única visível na impressão, com medidas em `mm` e `pt` porque o destino é papel.

O que a folha de impressão resolve:

- **Paginação por bloco** — cada cargo, projeto ou curso é agrupado com tudo que vem sob ele e marcado com `break-inside: avoid`, para o título não ficar no pé de uma página e as tecnologias no alto da seguinte.
- **Hierarquia tipográfica** — nome em 19 pt, seções em versalete 10 pt com fio sutil, cargos em 10,5 pt, todos em peso 700: `600` em Segoe UI sai quase igual ao corpo no papel.
- **Etiquetas de tecnologia** — a linha `**Tecnologias:**` vira badges, que é o que o recrutador procura primeiro numa leitura de trinta segundos.
- **Nome do arquivo** — o diálogo nativo tira o nome sugerido do título da aba, então ele vira `Curriculo - Nome - Empresa` durante a impressão e volta ao normal depois; sem isso, todo PDF chegaria à pasta de downloads como `DevRadar.pdf`, sobrescrevendo o anterior.

O Chrome imprime cabeçalho e rodapé próprios — com a data e a URL do painel — na faixa de margem da página. Dá para suprimi-los com `@page { margin: 0 }`, mas aí a margem das páginas seguintes depende de uma tabela de paginação, e **dentro de uma célula o Chromium ignora o `break-inside` dos filhos**: o cargo volta a se partir ao meio. Entre o rodapé, que um clique em "Cabeçalhos e rodapés" no diálogo resolve, e o cargo partido, o cargo inteiro vale mais.

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

**Toda segunda às 08:00** sai também o resumo da semana: vagas abertas, publicadas nos últimos 7 dias, remotas × Bahia e as cinco stacks mais pedidas.

---

## Decisões de arquitetura

### Três workspaces

```
apps/api/           NestJS, Prisma, PostgreSQL — coleta, filtra, deduplica, notifica
apps/web/           React + Vite — o dashboard
apps/posts-worker/  Fastify + Playwright — colhe publicações com sessão autenticada
```

Os dois primeiros são o produto. O terceiro existe por incompatibilidade, não por preferência: o Chromium precisa de glibc e não sobe na Alpine da API, e navegador logado não pode segurar uma captura que as outras fontes fecham em segundos. Ele conversa com a API por um contrato HTTP de uma rota (`GET /posts`), com **cópias independentes dos tipos nos dois lados** — o worker não deve nada ao Nest nem ao Prisma, e o preço de manter as duas cópias de acordo é menor que o de acoplar os dois serviços.

### Clean Architecture

Quatro camadas na API, com a dependência sempre apontando para dentro:

```
domain/        regras de negócio puras — nenhum import de Prisma, Axios ou Nest
application/   casos de uso e orquestração; dependem só de interfaces do domínio
infra/         Prisma, Axios, scrapers, Telegram — implementam as portas
http/          controllers; traduzem HTTP para caso de uso e nada mais
```

O domínio não sabe que existe banco. O caso de uso não sabe que existe Prisma.

### SOLID na prática

- **SRP** — o scraper só busca e normaliza; quem filtra é o `JobRuleEngine`; quem gera o hash é o `JobFingerprint`; quem grava é o repositório.
- **OCP + Strategy nos coletores** — todo coletor implementa `IJobScraperProvider` e é injetado pelo multi-provider `JOB_SCRAPERS`. **Adicionar uma nona fonte não toca o orquestrador**: basta a nova classe e uma linha na lista do módulo. Foi exatamente assim que o coletor de publicações logadas entrou, mesmo morando em outro serviço — do ponto de vista da API ele é um provider como os outros, que por dentro faz um GET em vez de abrir HTML.
- **LSP** — nenhuma implementação lança exceção não tratada: o `BaseScraperProvider` garante que uma fonte fora do ar vire lista vazia, não uma captura quebrada.
- **ISP** — contratos de leitura e escrita são separados (`IJobWriteRepository`, `IDashboardMetricsRepository`, `IJobQueryRepository`, `IMarketInsightsRepository`, `ISourceHealthWriter` × `ISourceHealthRepository`). Quem só lê métrica não enxerga método de escrita — e quem monta a tabela de saúde não tem o que gravar.
- **DIP** — casos de uso dependem de tokens do domínio (`JOB_SCRAPERS`, `TELEGRAM_NOTIFIER`, `CAPTURE_SCHEDULE`), nunca de uma classe concreta de infraestrutura.

### TDD

Teste primeiro, em ciclo Red → Green → Refactor. O domínio e a camada de aplicação têm **100% de cobertura obrigatória**, com o limite aplicado no CI — se cair abaixo, o pipeline falha.

Os coletores são testados contra **fixtures reais**, capturados dos endpoints de verdade, e não contra HTML inventado.

### Controle de concorrência

O cron de 2h e o botão `Capturar agora` compartilham um `CaptureCoordinator` com trava de execução única. Clicar no botão durante uma captura em andamento **não dispara uma segunda** — a chamada se junta à que já está rodando e recebe o mesmo relatório. Sem isso, duas varreduras simultâneas disputariam as mesmas inserções.

### O provedor de IA atrás de uma porta

O gerador entra pelo domínio como contrato — `IResumeGenerator`, injetado pelo token `RESUME_GENERATOR` — e o caso de uso não sabe quem responde do outro lado.

A conta veio depressa. A primeira implementação falava com a Anthropic; trocar para o Gemini, por custo, **tocou um arquivo de infraestrutura e o módulo que o injeta**. Domínio, caso de uso, controller, filtro de exceção e todo o frontend ficaram intactos, e os mesmos testes continuaram valendo — o dublê de teste implementa a porta, não o SDK.

O id do modelo sai de `GEMINI_MODEL`, com `gemini-3.8-flash` como padrão do código. A Google aposenta um Flash de tempo em tempo — o `gemini-2.0-flash` foi desligado em junho de 2026 e a rota passou a responder 502 com um 404 da Google no log. Com a variável, a próxima troca é uma linha no `.env` e um restart, em vez de commit, CI e deploy.

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

Nada disso bloqueia o boot — cada variável ausente desliga **só** o seu recurso:

| variável | para quê | sem ela |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | alertas e resumo semanal | a API sobe e avisa em `WARN` que os alertas estão desligados |
| `SERP_API_KEY` | coletor de publicações do LinkedIn | o coletor vira no-op silencioso; as outras sete fontes seguem |
| `SERP_ENDPOINT` | endpoint do Serper | usa o padrão do código, `https://google.serper.dev/search` |
| `LINKEDIN_POSTS_WORKER_URL` | endereço do `apps/posts-worker` | o coletor de publicações logadas vira no-op silencioso |
| `GEMINI_API_KEY` | gerador de currículo | só `POST /api/resume/generate` falha, com `502` |
| `GEMINI_MODEL` | id do modelo do Gemini | usa o padrão do código, `gemini-3.8-flash` |

Um detalhe que custou cinco dias de coleta silenciosa: no Compose, `${VAR:-}` entrega **string vazia**, e não "variável ausente". Um `SERP_ENDPOINT=` em branco passava pelo `??`, reprovava na conferência de configuração e desligava o coletor sem log, sem erro e sem crédito gasto. Hoje toda variável deste tipo é lida com `trim()` e fallback por `||`, e o painel marca a fonte sem credencial como `sem credencial` em vez de verde — a correção de verdade foi a segunda, porque a primeira sozinha só conserta o caso de hoje.

O token do Telegram sai do [@BotFather](https://t.me/BotFather); a chave do Gemini, do [Google AI Studio](https://aistudio.google.com/apikey) — o nível gratuito cobre o uso do painel com folga.

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

**5. O coletor de publicações logadas** (opcional)

As oito fontes públicas não precisam dele: sem `LINKEDIN_POSTS_WORKER_URL` a fonte vira no-op silencioso e o resto segue igual. Para ligá-lo, o primeiro passo é o login — e ele é **manual, de propósito**: a conta tem 2FA, e login programático é justamente o gesto que faz o LinkedIn pedir desafio.

```bash
npm run session:login --workspace @devradar/posts-worker
```

Abre uma janela do Chromium. Você digita e-mail e senha, resolve a verificação se ela vier, e **nada é gravado antes de o feed carregar** — um `state.json` pela metade seria pior que nenhum. O arquivo nasce em `apps/posts-worker/data/state.json`, que está no `.gitignore` e no `.dockerignore`.

> O `state.json` **é credencial**: quem tem o arquivo entra na conta. Ele não vai para o Git, nem para imagem Docker, nem para log, nem para backup que saia da máquina. Para conferir se a sessão de ontem ainda vale: `npm run session:check --workspace @devradar/posts-worker`.

Com a sessão de pé, suba o worker — ele está atrás de um profile, então um `docker compose up` normal não o toca:

```bash
docker compose --profile linkedin up -d --build posts-worker
```

O serviço escuta em `127.0.0.1:4000` (fora da máquina ninguém o alcança) e monta `apps/posts-worker/data` como `/data` — bind mount, e não volume nomeado, justamente porque o login roda no host e a sessão precisa ser visível para o contêiner. Aponte a API para ele no `.env`:

```
LINKEDIN_POSTS_WORKER_URL=http://127.0.0.1:4000
```

A colheita sai no ritmo do agendador (8 h, dentro da janela de 08h–22h), o que em desenvolvimento quase nunca é o que se quer. Para colher agora:

```bash
curl -X POST http://127.0.0.1:4000/harvest   # 202 = começou; 409 = já há uma em curso
curl http://127.0.0.1:4000/health            # estado da colheita e da sessão
```

Também dá para rodar uma colheita sem subir contêiner nenhum, direto no host, usando o mesmo código:

```bash
npm run harvest --workspace @devradar/posts-worker
```

**Variáveis do worker.** Todas opcionais; em branco vale o mesmo que ausente, e valor inválido cai no padrão em vez de derrubar o boot:

| variável | padrão | para quê |
|---|---|---|
| `POSTS_WORKER_PORT` | `4000` | porta do `GET /posts` |
| `POSTS_WORKER_DATA_DIR` | `apps/posts-worker/data` | onde ficam `state.json` e `harvest.json` |
| `HARVEST_INTERVAL_HOURS` | `8` | intervalo entre colheitas |
| `HARVEST_JITTER_MINUTES` | `20` | sorteio para cada lado do intervalo |
| `HARVEST_WINDOW_START_HOUR` | `8` | primeira hora em que a conta pode navegar |
| `HARVEST_WINDOW_END_HOUR` | `22` | primeira hora já proibida — a última colheita sai às 21:59 |
| `HARVEST_TIME_ZONE` | `America/Bahia` | fuso da janela; cai no `TZ` do contêiner quando não é definido |
| `HARVEST_TRIGGER_TOKEN` | — | exige o cabeçalho `x-harvest-token` no `POST /harvest`; vazio deixa a rota protegida só pela rede |
| `LINKEDIN_POSTS_MAX_SCROLLS` | `8` | teto de rolagens por busca |
| `LINKEDIN_POSTS_PER_QUERY` | `15` | teto de publicações por busca |
| `LINKEDIN_POSTS_TIMEOUT_MS` | `30000` | espera por navegação |

Os três últimos são barreira rígida, não afinação: é o que impede uma busca ampla de virar meia hora de navegador logado dentro do LinkedIn. Subir esses números aumenta justamente o que custa a conta.

Abertura depois do fechamento cai nos dois padrões, em vez de virar uma janela que atravessa a meia-noite: janela invertida é erro de digitação, e a leitura criativa dela daria a colheita de madrugada que a janela existe para impedir.

### Em produção

```bash
cp .env.prod.example .env.prod
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Sobe PostgreSQL com volume persistente, a API (que aplica as migrations no entrypoint antes de servir), o Nginx com os estáticos e o Caddy como proxy reverso, **com certificado TLS emitido e renovado automaticamente**. Só o proxy publica porta; o banco fica em rede sem saída para a internet.

O `posts-worker` sobe junto, também sem porta no host — só a API o alcança, pela rede interna. Duas diferenças em relação ao ambiente de desenvolvimento:

- **O `/data` é um volume nomeado** (`devradar-linkedin-session`), e não bind mount: em produção o login acontece **dentro** do contêiner, por noVNC, e o `state.json` nasce no próprio volume. O serviço é descartável; esse volume não — perdê-lo significa refazer o login.
- **`shm_size: 1gb` e `mem_limit: 900m`.** Os 64 MB padrão de `/dev/shm` fazem o Chromium quebrar em página pesada; o limite de memória garante que, se ele vazar, o OOM killer pegue o worker e não o PostgreSQL vizinho na VPS compartilhada.

#### Acesso ao painel

O painel expõe dados de contato do candidato e uma rota que **gasta cota de IA**. Por isso o acesso é fechado na borda, no próprio Caddy, antes de a requisição chegar à API:

| variável | o que é |
|---|---|
| `DEVRADAR_AUTH_USER` | usuário do painel |
| `DEVRADAR_AUTH_HASH` | hash bcrypt gerado por `caddy hash-password`, **com os cifrões dobrados** |

```bash
docker run --rm caddy:2.8-alpine caddy hash-password --plaintext 'sua-senha' | sed 's/[$]/$$/g'
```

O `sed` não é enfeite: o Docker Compose interpola `$` nos valores que vêm do `--env-file`, e um hash sem os cifrões dobrados chega truncado ao contêiner — a autenticação falha com `401` em tudo, sem nenhuma pista no log. As duas variáveis usam `:?` no compose: faltando qualquer uma, o `up` aborta **antes** de tocar nos contêineres, em vez de publicar um painel que recusa todo mundo.

`GET /api/health` fica de fora da proteção, para o monitoramento externo alcançar sem credencial — a resposta não diz mais que "o banco responde".

Para subir numa VPS do zero — Docker, DNS, firewall, TLS e backup — o passo a passo está em [`docs/deploy-vps.md`](docs/deploy-vps.md).

Se a VPS já roda outro projeto nas portas 80 e 443, o Caddy do DevRadar vira a borda compartilhada dos dois: [`docs/deploy-vps-compartilhada.md`](docs/deploy-vps-compartilhada.md). Esse guia também cobre o deploy automático: `.github/workflows/deploy.yml` atualiza a VPS por SSH depois que o CI da `main` fecha em verde.

---

## Comandos úteis

| Comando | O que faz |
|---|---|
| `npm run dev:api` | API em watch mode |
| `npm run dev:web` | Frontend em watch mode |
| `npm test` | Todos os testes |
| `npm run test:cov` | Testes com relatório e limites de cobertura |
| `npm run test:int` | Testes de integração (precisa do banco no ar) |
| `npm run lint` | ESLint nos três workspaces |
| `npm run typecheck` | `tsc --noEmit` nos três workspaces |
| `npm run build` | Build de produção |
| `npm run db:up` | Sobe o PostgreSQL no Docker |
| `npm run db:migrate` | Aplica as migrations |
| `npm run db:studio` | Prisma Studio |
| `npm run telegram:test --workspace @devradar/api` | Envia uma mensagem de teste ao chat |
| `npm run telegram:digest --workspace @devradar/api` | Dispara o resumo semanal agora |
| `npm run jobs:purge-international --workspace @devradar/api` | Lista (e com `-- --apply` remove) vagas internacionais antigas |
| `npm run jobs:list-unknown --workspace @devradar/api` | Lista as vagas cujo mercado o classificador nao determinou |
| `npm run jobs:reclassify --workspace @devradar/api` | Recalcula o mercado das vagas ja gravadas (`-- --apply` grava) |
| `npm run jobs:analyze --workspace @devradar/api` | Mostra por que cada vaga coletada foi reprovada |
| `npm run session:login --workspace @devradar/posts-worker` | Abre a janela do navegador para o login manual e grava o `state.json` |
| `npm run session:check --workspace @devradar/posts-worker` | Confere, sem janela, se a sessão gravada ainda abre o feed |
| `npm run harvest --workspace @devradar/posts-worker` | Roda uma colheita de publicações agora, no host |
| `npm run serve --workspace @devradar/posts-worker` | Sobe o worker fora do Docker, com o agendador ligado |

---

## Qualidade

**1.969 testes** unitários e de E2E — 1.330 na API, 395 no frontend e 244 no worker de publicações — mais **117 de integração** contra um PostgreSQL real, somando 2.086. Tudo roda em seis jobs no CI a cada push: lint, typecheck, testes com cobertura, testes de integração, build dos workspaces e build das três imagens Docker, com a validação dos três arquivos de Compose.

O build da imagem do worker no CI não é zelo: a incompatibilidade entre musl e glibc que criou esse serviço **só aparece em build de verdade**.

O gerador de currículo entrou com a mesma régua: o contrato de Markdown do prompt é testado regra a regra no domínio, o adaptador do Gemini tem caso para cada resposta malformada e para o erro de API, e no frontend o parser de seções e o documento impresso têm specs próprios — período extraído do título, etiquetas a partir da linha `**Tecnologias:**`, e as linhas de competências que **não** podem virar etiqueta.

| Camada | Cobertura | Limite no CI |
|---|---|---|
| `domain/` | 100% | 100% — obrigatório |
| `application/` | 100% | 100% — obrigatório |
| API, total | 96,3% | 95% |
| Frontend | 99,1% | 85% |
| `posts-worker`: parser, servidor e colheita | 100% | 100% — obrigatório |

No worker, o limiar de 100% cobre as três partes que não dependem do navegador: o parser do DOM, o servidor que serve o cache e a colheita que decide o que entra. Ficam declaradamente fora da conta o adaptador do Playwright e a função que o liga ao ambiente — não existe jeito honesto de testar um navegador sem um navegador, e navegar contra o LinkedIn a cada CI é o caminho mais curto para derrubar a sessão. É por isso que o orquestrador recebe a página como porta: a decisão fica toda do lado testável, e o lado não testável só sabe clicar e ler atributo.

O limite não é enfeite: `npm run test:cov` falha abaixo dele, e é esse comando que o CI roda — não o `npm test`. A diferença já custou caro uma vez, quando um controller inteiro passou meses em 0% de cobertura porque o pipeline rodava a versão sem limite.

O ESLint roda com informação de tipo e carrega só regras que pegam o que o compilador não pega — promise solta, `async` usado onde se espera função síncrona, `switch` não exaustivo, dependência faltando em hook. Formatação ficou de fora de propósito.

**Todo coletor é testado contra fixture capturada da fonte real**, nunca contra HTML inventado. A única exceção está marcada no próprio arquivo: `serp-linkedin-posts.json` foi montada a partir do contrato documentado antes de haver chave de API — e depois confirmada contra a resposta de verdade.

Há ainda três comandos de diagnóstico, que existem porque o contador de uma captura não responde o que importa:

| comando | pergunta que responde |
|---|---|
| `jobs:analyze` | por que cada vaga coletada foi reprovada? |
| `jobs:list-unknown` | quais vagas o classificador não conseguiu situar? |
| `posts:probe` | o que a busca do LinkedIn trouxe, e o que o motor achou disso? |

---

## Stack

**Backend** — Node.js, TypeScript strict, NestJS 11, Prisma, PostgreSQL 16, `@nestjs/schedule`, Axios, Cheerio, Zod, `@google/genai`
**Coletor com sessão** — Fastify 5, Playwright (Chromium), Cheerio, `proper-lockfile`
**Frontend** — React 19, Vite, TypeScript, Tailwind CSS 4, TanStack Query, React Hook Form + Zod, Recharts, Lucide
**Testes** — Vitest, Supertest, React Testing Library
**Infra** — Docker multi-stage, Docker Compose, Nginx, Caddy, GitHub Actions

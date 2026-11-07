# RFC 001 — Coletor de publicações do LinkedIn com sessão autenticada

Desenho antes da primeira linha de código. O objetivo é capturar publicações de
recrutador no LinkedIn com uma conta dedicada do DevRadar, fechando a lacuna que
nenhuma das fontes atuais cobre: a vaga que o recrutador baiano anuncia num post
e nunca publica em portal.

> **Status:** aprovado em 05/11/2026. Aprovadas explicitamente: a separação em
> `apps/posts-worker` (§4), o `storageState` com `proper-lockfile` (§6, §7) e a
> resposta por cache no `GET /posts` levando o `harvestedAt` para a tabela de
> saúde (§5).
>
> **Andamento.** Fase 1 feita (workspace, contrato, `session:login`,
> `session:check`). Fase 2a feita: o parser sobre HTML salvo está pronto e com
> cobertura total. Fase 3 feita: o provider lê o worker, decodifica a data do
> snowflake e alerta a sessão caída. Da 2b, a metade que não navega está feita:
> `GET /posts`, `GET /health`, encerramento limpo e a trava da colheita (§5.1,
> §7.1). Da Fase 4, a imagem e o serviço de desenvolvimento estão feitos (§11,
> §13). Falta o passo de navegador que resolve o link (§5.3) — e ele depende da
> conta — e o serviço no compose de produção.
>
> **Bloqueio.** O LinkedIn restringiu a conta no primeiro login automatizado,
> em `/flagship-web/login/login-restriction/` — conta nova entrando por
> navegador automatizado. A restrição será resolvida à mão, pelo navegador
> comum. É a linha "conta restringida" de §14, e ela foi atingida antes de
> qualquer raspagem; ver a releitura ao fim daquela seção.
>
> **Revisões de desenho,** feitas ao implementar e registradas abaixo: §5.3
> (`ParsedCard` separado de `RawPost`, porque a URL não está no DOM), §9.1
> (isolamento da urn em post compartilhado), §5.1 (contrato: `HarvestDiscards`,
> `links`, `hasJobAction`, o filtro de *open to work* no worker, e os códigos de
> resposta do endpoint), §5.2 (a frescura da colheita chega à tabela de saúde
> pelo `isDue`, sem migração) e §7.1 (a segunda trava, a da colheita, consultada
> e nunca adquirida pelo leitor).

---

## 1. O problema, e o que já aprendemos tentando

O coletor atual (`LinkedinPostsScraperProvider`) encontra publicações pelo índice
do Google, via Serper. Ele funciona, mas enxerga só o que o Google indexou — e
post de recrutador de alcance pequeno, que é exatamente o caso da Bahia,
frequentemente não entra no índice, ou entra dias depois.

A tentativa de falar com a API autenticada do LinkedIn direto por HTTP está
registrada no commit `8628b21`, com o script
[test-linkedin-post-scraper.ts](../../apps/api/scripts/test-linkedin-post-scraper.ts).
Ela falhou por dois motivos, e os dois importam para este desenho:

1. **O `queryId` do GraphQL é volátil.** O LinkedIn só aceita consulta
   persistida e aposenta o hash a cada build do cliente web. Toda variante
   testada respondeu 500.
2. **O cookie sozinho não é a sessão.** Com apenas o `li_at` num `axios`, sem
   impressão digital de navegador, o LinkedIn **revogou ativamente** a sessão:
   `set-cookie: li_at=delete me; Max-Age=0`. Não foi expiração — foi reação.

O coletor de referência ([wouerner/vagas-php-coletor](https://github.com/wouerner/vagas-php-coletor),
`collector/vagas/bot.py`) não enfrenta nenhum dos dois porque **não usa a API**.
Ele sobe um Chromium real com Playwright, em perfil persistente, e lê o DOM de
`/search/results/content/`. Sem `queryId` para vencer, e com uma sessão que o
LinkedIn trata como navegador porque ela é um navegador.

É esse o caminho que este RFC propõe — com as proteções de conta que aquele
projeto também carrega, que são a parte mais importante do desenho.

## 2. Decisões já tomadas

| Decisão | Escolha | Por quê |
|---|---|---|
| Onde roda o Chromium | **Serviço separado** (`apps/posts-worker`), não dentro da API | A imagem da API é `node:22-alpine`, e o Chromium do Playwright **não roda em musl**. Não é preferência de arquitetura: é incompatibilidade. Ver §4 |
| Como a API consome | Provider HTTP que lê um endpoint do worker | O coletor continua um `IJobScraperProvider` comum, igual aos outros sete. Orquestrador, motor de regras, impressão digital e alertas ficam intocados (OCP) |
| Quem manda na cadência | O worker, no próprio cron | O custo (navegador, risco de conta) está lá. A API só lê um JSON pronto, de graça, a cada captura |
| Sessão | `storageState` em JSON, **não** a pasta de perfil | A pasta não é portátil entre Windows e Linux: o Chromium cifra cookies com DPAPI no Windows. Ver §6 |
| Data da publicação | Snowflake da URL, via `decodePostTimestamp` | Precisão de minutos, sem depender de ler `"há 3 h"` da tela. Já existe e está testado |
| Papel da fonte | **Complementar.** Serper permanece primário | Se o logado cair, ou a conta for restringida, o radar não perde nada do que tem hoje |
| Trava de instância | `proper-lockfile` | `fcntl` do referencial é POSIX; precisamos de Windows em dev e Linux em produção |

## 3. Topologia

```
┌──────────────────────────────────────────────────────────────────┐
│ rede backend                                                     │
│                                                                  │
│  ┌───────────────┐      GET /posts            ┌───────────────┐  │
│  │  api          │ ───────────────────────────▶│ posts-worker  │  │
│  │  node:alpine  │◀─────────────────────────── │ playwright:   │  │
│  │               │   { harvestedAt, status,    │ noble (Debian)│  │
│  │  LinkedinAuth │     posts[] }               │               │  │
│  │  PostsProvider│                             │  cron 8h      │  │
│  └───────┬───────┘                             │  Chromium     │  │
│          │                                     └───────┬───────┘  │
│          │ rede data                                   │          │
│  ┌───────▼───────┐                        ┌────────────▼───────┐  │
│  │  postgres     │                        │ devradar-linkedin- │  │
│  └───────────────┘                        │ session (volume)   │  │
│                                           │  state.json        │  │
│                                           │  harvest.json      │  │
│                                           │  .lock             │  │
└──────────────────────────────────────────────────────────────────┘
```

O worker **não** fala com o PostgreSQL. Ele não entra na rede `data`. Tudo que
ele faz é devolver publicações cruas por HTTP; quem valida, filtra, deduplica e
grava continua sendo a API, com o código que já existe.

## 4. Por que serviço separado, e não provider interno

A pergunta era se o Playwright deveria morar dentro do NestJS. Três fatos
decidem, em ordem de peso:

1. **Incompatibilidade de base.** `apps/api/Dockerfile` termina em
   `node:22-alpine`. O Chromium do Playwright é distribuído para glibc; em
   Alpine ele não sobe. Colocá-lo na API obrigaria a trocar a base da imagem
   inteira para Debian — o que invalida todo o trabalho de enxugamento
   documentado naquele Dockerfile (remoção de engines do Prisma, camada única de
   install, ausência de `chown -R`).
2. **Tamanho.** A imagem da API hoje é enxuta de propósito. A base do Playwright
   com Chromium passa de 1 GB. Inflar a imagem que serve a API — que precisa
   subir rápido e tem healthcheck de 40s — para hospedar algo que roda a cada 8
   horas é trocar o barato pelo caro.
3. **Memória, numa VPS compartilhada.** A VPS divide recursos com o PrintGest
   (ver `docker-compose.vps.yml`). O Chromium ocupa 300–500 MB de RSS enquanto
   navega. Isolado num serviço, isso ganha `mem_limit` próprio e, se estourar, o
   que morre é o worker — a API e o painel continuam no ar.

O worker fica no monorepo, como `apps/posts-worker`, seguindo a convenção de
`/apps`, e compartilha o `package-lock.json` da raiz.

> **Revisão.** Esta seção perguntava como compartilhar o `decodePostTimestamp`
> entre os dois workspaces — cópia do módulo ou pacote interno. A pergunta se
> dissolveu ao escrever o contrato: **o worker não precisa dele.** O worker
> entrega a URL; quem decodifica o snowflake é a API, que já tem a função
> testada. Logo não há nenhum código comum aos dois, e o worker não deve nada ao
> Nest nem ao Prisma. O que precisa ficar de acordo são as duas cópias
> independentes dos tipos do contrato (§5.1).

## 5. Contrato entre a API e o worker

### 5.1 O endpoint

```
GET http://posts-worker:4000/posts
```

```json
{
  "harvestedAt": "2026-11-05T09:12:44.000Z",
  "status": "ok",
  "searches": [
    {
      "label": "Bahia",
      "query": "vaga desenvolvedor bahia",
      "found": 7,
      "discarded": {
        "promoted": 3,
        "openToWork": 2,
        "unaddressable": 0,
        "withoutContent": 1,
        "withoutUrl": 1
      }
    }
  ],
  "posts": [
    {
      "url": "https://www.linkedin.com/feed/update/urn:li:activity:7521262024920764416/",
      "author": "Maria Silva",
      "authorUrl": "https://www.linkedin.com/in/maria-silva-123abc",
      "headline": "Tech Recruiter",
      "text": "Estamos contratando pessoa desenvolvedora React em Salvador...",
      "links": ["https://portal.gupy.io/job/1234", "https://lnkd.in/dAbCdEf"],
      "hasJobAction": true
    }
  ]
}
```

`status` é um de `ok`, `session-lost`, `degraded` (navegou, mas alguma busca
falhou) ou `never-ran`. Ele é o canal de diagnóstico: a API não tem como saber
que o navegador perdeu o login, e este campo é como ela descobre.

#### Códigos de resposta, e por que `503` existe

| Estado do `harvest.json` | Resposta |
| --- | --- |
| Lido e válido | `200` com o documento, sem transformar nada |
| Não existe | `200` com `EMPTY_HARVEST` (`never-ran`) |
| Ilegível (JSON truncado, ou não é uma colheita) | `200` com `EMPTY_HARVEST`, e `GET /health` em `degraded` com o motivo |
| Travado para gravação | `503` com `Retry-After: 5` |

Nunca `404`: a API precisa de um documento válido dizendo "ainda não há nada"
para tratar isso como fonte sem vagas, e não como falha.

O `503` do arquivo travado é a decisão menos óbvia aqui. A alternativa seria
devolver `EMPTY_HARVEST`, e ela é pior: `never-ran` é uma afirmação forte — a
API a registra, e no painel ela não se distingue de um worker que nunca abriu o
navegador. Dizer isso porque a gravação durou 200 ms seria mentir sobre um
worker que acabou de colher. Com `503`, o lado da API cai no caminho que ele já
tem para worker indisponível: registra em log, não se declara pronto e tenta no
ciclo seguinte.

O arquivo ilegível vai pelo caminho oposto — `200` com a colheita vazia — porque
é uma falha **persistente**: um `503` eterno deixaria a fonte sumir do painel com
a explicação só nos logs da API. Quem conta a verdade nesse caso é o
`GET /health`, que é onde se olha quando a fonte seca.

#### `links` e `hasJobAction`

`links` traz o que o post aponta para fora: página da vaga, formulário,
encurtador `lnkd.in`. Navegação do próprio LinkedIn (perfil, empresa, feed)
fica fora, mas `/jobs/` entra — ali o link **é** o anúncio. Para o motor de
regras isso vale como indício forte de vaga real: curso e propaganda de
currículo raramente apontam para formulário de candidatura.

`hasJobAction` é separado de `links` porque um botão "Candidate-se" pode não ter
`href`. A existência dele já é o sinal, independente de para onde leve.

#### `discarded`: por que o worker filtra e ainda assim conta

O filtro de *open to work* — o selo "buscando emprego" na foto do autor —
**mora no worker**, não na API, e isso é uma mudança em relação à primeira
versão de §5.2. O motivo é que o sinal só existe no DOM, no texto alternativo
da imagem. Encaminhar um booleano à API apenas para o outro lado descartar a
linha é pior que descartar na origem.

A contrapartida é real: descarte no worker é descarte que a aba `Regras`, que
conta o que o motor barrou, não veria. Daí `HarvestDiscards` — um contador por
motivo, por busca. Nada desaparece em silêncio; o que o navegador jogou fora
antes do motor fica mensurável, e uma mudança de critério aparece como mudança
de número em vez de sumiço inexplicado.

Os motivos são `promoted` (anúncio pago), `openToWork` (quem procura
recolocação), `unaddressable` (card que não dá para reencontrar na página),
`withoutContent` (widget do LinkedIn, sem autor ou sem texto) e `withoutUrl`
(reconhecido, mas o link não foi obtido — ver §5.3).

O endpoint **responde na hora**, com a última colheita gravada em
`harvest.json`. Ele nunca abre navegador. A alternativa — a API chamar e o
worker navegar em seguida, de forma síncrona — foi descartada: um Chromium
preso em `wait_for_selector` seguraria a captura por minutos, e a captura roda
de 2 em 2 horas para outras sete fontes.

### 5.2 O provider na API

```
infra/scrapers/linkedin-auth-posts-scraper-provider.ts
  source = 'linkedin-auth-posts'
  label  = 'Publicações do LinkedIn (sessão)'
```

Um `BaseScraperProvider` como os outros, com um `IHttpClient` injetado. Ele:

1. Faz um GET no worker (milissegundos; sem custo e sem risco de conta).
2. Converte cada post em `RawJobProps`, com `origin: 'SOCIAL_POST'`,
   `publishedAtSource: 'SOURCE'` e `publishedAt` vindo do snowflake da URL.
3. Descarta o que não tiver URL de post reconhecível — sem id não há snowflake,
   e sem snowflake não há data. *Open to work* já não chega aqui: o worker
   filtra na origem, pelos motivos em §5.1.
4. Entra no registro `SCRAPERS` do `infra.module.ts`. O orquestrador não muda.

**A janela de 72 h não é reaplicada aqui.** O `JobRuleEngine` já a aplica, e já
conta essa rejeição na aba `Regras`; repetir o corte no provider esconderia o
descarte de quem lê as regras públicas e deixaria duas definições da mesma
janela para divergirem.

**`isDue` é sobrescrito, e é assim que a frescura chega ao painel.** A ideia
original era não sobrescrever — a leitura é gratuita, então que ela ocorra em
toda captura. O problema apareceu na implementação: cada leitura vira uma
execução em `capture_source_logs`, e o painel passaria a anunciar "última
captura: agora" para uma colheita de sete horas atrás. Levar o `harvestedAt`
exato até a tabela exigiria migração no Prisma (uma coluna `observed_at` em
`CaptureSourceLog`, que hoje só tem `ranAt`) **e** um canal lateral na porta
`IJobScraperProvider`, cujo `scrape()` devolve apenas `RawJobProps[]` — mudança
que atinge as oito fontes para resolver uma.

A saída foi inferir a frescura sem migração: a fonte só se declara pronta quando
o `harvestedAt` do worker é mais recente que a última execução registrada. Assim
`lastRunAt` passa a significar "última colheita nova", com no máximo um ciclo de
captura (2 h) de atraso, em vez de mentir. `session-lost` é a exceção: ali a
fonte se declara pronta uma vez, para que o alerta possa sair, e depois para de
insistir.

Nenhuma exceção escapa: o `BaseScraperProvider` já garante que worker fora do ar
devolve lista vazia e as outras fontes seguem (LSP).

### 5.3 `ParsedCard` e `RawPost`: a URL não está no DOM

Esta seção não existia na versão aprovada. Ela registra o achado que mais mudou
a Fase 2.

**No layout novo do LinkedIn, o id da publicação não está no DOM.** O card é
marcado por `componentkey`, as classes são ofuscadas, e em nenhum atributo
aparece a urn. É por isso que o `parseNew` do coletor de referência devolve
`urn: null` e vai buscar o link de outro jeito: abrindo o menu de cada post,
clicando em "Copiar link da publicação" e lendo a área de transferência.

A consequência é que o parser **não pode** produzir `RawPost`, que exige `url`.
Então há dois tipos, em dois estágios:

```
HTML salvo ──parser (puro)──▶ ParsedCard ──passo de navegador──▶ RawPost
                              cardKey                            url
                              activityId?                        (demais campos
                              author, text,                        inalterados)
                              links, hasJobAction
```

- **`ParsedCard`** é a saída pura do parser: `string` entra, cards saem. Sem
  `Page`, sem `evaluate`, sem navegador. É o que torna a fase testável com HTML
  salvo, e é a diferença deliberada em relação ao referencial, que injeta um
  bloco grande de JavaScript na página e só dá para conferir contra o LinkedIn
  de verdade.
- **`cardKey`** é o valor do atributo que identifica o card — `componentkey` no
  layout novo, a urn em `data-urn`/`data-id` no clássico. É com ele, e só com
  ele, que o passo de navegador reencontra o card na página para pedir o link.
- **`activityId`** vem preenchido apenas quando o HTML o traz, isto é, no
  layout clássico. Ali o parser resolve a URL sozinho e o passo de navegador é
  dispensado.
- **`RawPost`** nasce da junção de um `ParsedCard` com a URL resolvida. Card que
  não receba URL é descartado, e contado em `discarded.withoutUrl`: sem link
  não há data, e data aproximada em janela de 72 h é pior que uma vaga a menos.

O preço de parsear HTML em vez de rodar dentro da página: sem `innerText` não
existe "texto visível". O referencial divide o card em linhas e adivinha pela
ordem delas; aqui tudo sai de atributo e de container nomeado — mais chato de
descobrir, muito mais estável, e verificável sem abrir navegador.

Uma limitação conhecida: no layout novo o subtítulo do autor (`headline`) fica
`undefined`, porque os seletores que o expõem são os do layout clássico. Falta
descobrir o equivalente, e isso depende de HTML real.

#### O que isso exige do passo de navegador

Resolver link é caro e visível: é clique em menu, por post. Então ele roda
**depois** do filtro, só sobre os cards que sobraram — nunca sobre os
descartados. Essa ordem não é otimização, é redução de rastro na conta.

## 6. Bootstrap da sessão

Aqui há uma correção de premissa que vale explicitar: **a pasta `.session/` não é
transferível do Windows para a VPS.** O Chromium cifra os valores dos cookies
com o DPAPI do Windows, atrelado à máquina e ao usuário; no Linux a decifragem
falha e o perfil chega sem sessão. O referencial não tropeça nisso porque faz o
login dentro do próprio contêiner Linux — e é justamente por isso que o
`collector/Dockerfile` dele instala `xvfb x11vnc novnc websockify`.

Duas saídas, e proponho adotar as duas, para fins diferentes:

### 6.1 Para produção: login dentro do contêiner, por noVNC

1. O worker ganha um comando `npm run session:login` que sobe o Chromium
   **headed** sob Xvfb, com `x11vnc` + `novnc` expostos **apenas em loopback**.
2. Do Windows, um túnel SSH: `ssh -L 6080:127.0.0.1:6080 vps`.
3. Abre-se `http://127.0.0.1:6080` no navegador local, faz-se o login com e-mail
   e senha da conta do DevRadar e resolve-se a 2FA ou o desafio na janela.
4. Ao detectar `/feed`, o comando grava `storageState` em `state.json` no volume
   e encerra. O noVNC sai do ar com ele.

A sessão nasce no Linux, com o Chromium que vai usá-la. Nenhum segredo trafega
fora do túnel.

### 6.2 Para desenvolvimento no Windows

O mesmo comando, sem Xvfb: abre uma janela de Chromium na máquina, login à mão,
grava `state.json` local. Serve para desenvolver os seletores sem depender da
VPS — e o `state.json` de dev **não vai** para produção, pela razão abaixo.

### 6.3 Por que `storageState`, e não a pasta de perfil

`context.storageState()` devolve cookies e `localStorage` em JSON **já
decifrados pelo Playwright**, e `launchPersistentContext` não é necessário para
carregá-los: `browser.newContext({ storageState })` basta. Isso torna a sessão
portátil e inspecionável, e remove da equação o perfil de Chromium inteiro —
que é grande, cheio de cache e acoplado à versão do navegador.

Contrapartida honesta: perde-se um pouco da impressão digital que um perfil
longamente usado carrega. Como o resto do desenho é conservador (intervalo
longo, poucas páginas), aceito a troca. Se na prática a sessão cair com
frequência, o plano B é `launchPersistentContext` com o perfil criado **e
mantido** na VPS, nunca transferido.

### 6.4 O `state.json` é credencial

- Entra no `.gitignore` antes de existir.
- Nunca em imagem Docker, nunca em log, nunca em mensagem de Telegram.
- Vive só no volume nomeado, com permissão do usuário do contêiner.
- Quem o tem, tem a conta: é equivalente à senha, e não expira com troca de
  senha tão cedo.

## 7. Concorrência: uma instância por vez

O referencial usa `fcntl.flock`. Precisamos do equivalente que funcione nos dois
sistemas, e a escolha é **`proper-lockfile`**: ele implementa a trava com
`mkdir` atômico e renovação periódica (`stale`), o que funciona igual em NTFS e
em overlayfs, e sobrevive a processo morto sem deixar trava órfã eterna.

O arquivo de trava mora **no volume**, ao lado do `state.json`:
`/data/.lock`. Com isso a trava vale também entre o cron do worker e um comando
manual (`session:login`, ou uma colheita forçada) rodando no mesmo volume —
que é exatamente o caso que o `flock` do referencial resolve, e exatamente o que
corrompe um perfil de Chromium quando dois processos o abrem.

Quem não consegue a trava **não enfileira**: registra em log e desiste. Uma
colheita perdida não custa nada; duas instâncias no mesmo perfil custam a
sessão.

### 7.1 A segunda trava: a da colheita

São duas travas, com propósitos diferentes, e confundi-las seria um erro:

| Trava | Protege | Quem a adquire |
| --- | --- | --- |
| `/data/.lock` | O perfil do navegador: instância única | O cron da colheita, o `session:login` |
| `/data/harvest.json.lock` | O arquivo durante a gravação | Só quem grava a colheita |

O leitor do `GET /posts` **consulta** a segunda trava e nunca a adquire. A razão
é que quem chama ali é uma requisição HTTP da API, dentro da captura: esperar o
navegador terminar de escrever penduraria a esteira inteira no tempo de uma
colheita. Consultar e desistir (§5.1, o `503`) custa um ciclo; bloquear custa a
captura.

A trava, porém, é só a precaução barata. A garantia de verdade é a **gravação
atômica** — arquivo temporário e `rename` —, que faz o leitor ver a colheita
antiga inteira ou a nova inteira, nunca metade de cada. É por isso que falha ao
*verificar* a trava vale como "não travado" e a leitura segue: perder a
precaução não pode valer mais que servir a colheita.

O caminho da trava é declarado em código, nos dois lados, em vez de depender do
padrão do `proper-lockfile`. Leitor e escritor precisam apontar para o mesmo
arquivo, e um default implícito nas duas pontas é o tipo de acordo que se quebra
em silêncio no dia em que uma delas passar `realpath` diferente.

## 8. Políticas de coleta

Valores iniciais, todos em variáveis de ambiente para ajuste sem deploy:

| Variável | Padrão | Papel |
|---|---|---|
| `LINKEDIN_POSTS_INTERVAL_HOURS` | `8` | Intervalo entre colheitas. O referencial usa 8, com o comentário "intervalo longo protege a conta" |
| `LINKEDIN_POSTS_ACTIVE_HOURS` | `8-22` | Janela de atividade, horário de Brasília. Conta que navega às 4 da manhã parece o que é |
| `LINKEDIN_POSTS_PER_QUERY` | `15` | Teto de posts por busca |
| `LINKEDIN_POSTS_MAX_SCROLLS` | `8` | Teto de rolagens. Barreira rígida: é o que impede uma busca ampla de virar sessão de meia hora |
| `LINKEDIN_POSTS_QUERIES` | 2 buscas | Mesma divisão do coletor do Serper: uma remota nacional, uma regional da Bahia |
| `LINKEDIN_POSTS_ENABLED` | `false` | Desligado por padrão. Ambiente sem sessão não tenta login |

Entre duas buscas, pausa de 3 s, como no referencial. A busca usa
`sortBy="date_posted"` e `datePosted="past-24h"`; o corte de 72 h é nosso, feito
na API pelo snowflake.

Com 2 buscas, 15 posts e 8 rolagens, três vezes ao dia, o perfil de uso fica
próximo do de uma pessoa que abre o LinkedIn algumas vezes por dia — que é o
objetivo.

## 9. A data vem do link

O referencial lê o texto `"há 3 h"` da tela (`dates.from_relative`) e, para ter
o link, abre o menu de cada post e usa a área de transferência — a parte lenta e
frágil do coletor dele.

Nós precisamos do link de todo jeito (é a URL canônica da vaga), mas dele sai
coisa melhor: `decodePostTimestamp` converte o snowflake do id em instante com
precisão de minutos. Então o worker busca o link, e a **data não é lida da tela
em nenhum momento**. Um post sem URL reconhecível é descartado em vez de
carimbado com o instante da captura: em janela de 72 h, data aproximada é pior
que vaga a menos.

### 9.1 A urn sai do próprio card, nunca do HTML interno

Regra curta, consequência grande, e descoberta como bug ao escrever o teste do
caso.

**Post compartilhado embute outro card dentro de si**, com a urn do post
original — que é de outro autor e de outro dia. A primeira versão do parser
procurava a urn no HTML do card inteiro, descendentes incluídos. Com isso o
card de fora herdava o id do post compartilhado e, pelo snowflake, **a data de
publicação do post original**.

Não é um erro cosmético. A data é o único critério da janela de 72 h: um
compartilhamento de hoje, de um post de duas semanas atrás, seria silenciosamente
excluído da captura — ou, no sentido inverso, um post velho entraria como novo.
E o sintoma seria invisível, porque a data continua parecendo plausível.

Então a urn é lida **apenas dos atributos do próprio card** (`data-urn`,
`data-id`, `componentkey`), nunca do HTML interno. O card aninhado, por sua vez,
já é descartado antes disso pelo filtro de contêineres mais externos — sem ele,
o post de dentro viraria uma publicação própria, com o autor errado. São duas
proteções para o mesmo caso, e as duas têm teste de regressão.

## 10. Queda de sessão

O sintoma é conhecido: o LinkedIn redireciona para `/login`, `/checkpoint` ou
`/challenge`. O worker detecta pela URL após a navegação e então:

1. **Não tenta login automático.** Login programático é o gesto que mais chama
   atenção, e com 2FA ele não se completa de cabeça baixa de qualquer forma.
2. Grava `status: "session-lost"` no `harvest.json`, **preservando os posts da
   última colheita boa** com o `harvestedAt` antigo.
3. Para de tentar até a sessão ser renovada: um contador no arquivo evita que o
   cron bata de 8 em 8 horas numa porta fechada.

A API, ao ler `status: "session-lost"`, dispara **um** alerta no Telegram pelo
`TELEGRAM_NOTIFIER` que já existe ("sessão do LinkedIn caiu; rode o bootstrap"),
sem repetir a cada captura, e segue a esteira normalmente com as outras fontes.
Posts velhos continuam sendo filtrados pela janela de 72 h, então a colheita
antiga simplesmente seca sozinha em três dias em vez de sumir de uma vez.

Nada disso bloqueia a captura: é só mais uma fonte devolvendo menos.

## 11. Volumes e composição

### Desenvolvimento (`docker-compose.yml`)

Hoje o arquivo só tem o PostgreSQL — a API roda no host. O worker entra como
serviço opcional, atrás de um profile, para que `npm run db:up` continue subindo
só o banco:

```yaml
services:
  posts-worker:
    profiles: ['linkedin']
    build:
      context: .
      dockerfile: apps/posts-worker/Dockerfile
    environment:
      TZ: America/Bahia
      POSTS_WORKER_PORT: 4000
      POSTS_WORKER_DATA_DIR: /data
    ports:
      - '127.0.0.1:${POSTS_WORKER_PORT:-4000}:4000'
    volumes:
      - ./apps/posts-worker/data:/data
    shm_size: '1gb'
```

Sobe com `docker compose --profile linkedin up -d --build posts-worker`. A API
no host aponta para `http://127.0.0.1:4000`.

**Bind mount em desenvolvimento, e não volume nomeado** — revisão do desenho
original. O `session:login` roda no host, com janela aberta, porque é lá que
existe uma tela; é lá, portanto, que o `state.json` nasce. Com volume nomeado, a
sessão gerada no Windows ficaria invisível para o container, e cada renovação
exigiria copiá-la à mão para dentro do volume. A pasta está no `.gitignore` e no
`.dockerignore`: o arquivo é a credencial da conta. Em produção o volume
nomeado continua certo, porque lá o login acontece dentro do contêiner (§6.1).

`shm_size` não é cosmético: com os 64 MB padrão do Docker o Chromium quebra em
páginas pesadas. A alternativa é `--disable-dev-shm-usage`, que troca memória
compartilhada por disco e deixa tudo mais lento; com volume de uso tão baixo,
prefiro dar a memória.

### Produção (`docker-compose.prod.yml`)

```yaml
  posts-worker:
    build:
      context: .
      dockerfile: apps/posts-worker/Dockerfile
    image: devradar-posts-worker:latest
    restart: unless-stopped
    environment:
      TZ: America/Bahia
      LINKEDIN_POSTS_ENABLED: ${LINKEDIN_POSTS_ENABLED:-false}
      LINKEDIN_POSTS_INTERVAL_HOURS: ${LINKEDIN_POSTS_INTERVAL_HOURS:-8}
    networks:
      - backend
    shm_size: '1gb'
    mem_limit: 900m
    volumes:
      - devradar-linkedin-session:/data

volumes:
  devradar-linkedin-session:
```

Sem porta no host: só a API o alcança, pela rede `backend`. `mem_limit` protege
o vizinho na VPS compartilhada — se o Chromium vazar, o OOM killer pega o worker
e não o PostgreSQL.

A API ganha `LINKEDIN_POSTS_WORKER_URL: http://posts-worker:4000`, e vazio
desliga o provider — mesmo padrão do `SERP_API_KEY` e da `GEMINI_API_KEY`:
ambiente sem a variável simplesmente não tem a fonte, sem quebrar nada.

A porta 4000 é o padrão do worker, trocável por `POSTS_WORKER_PORT`; porta
inválida cai no padrão em vez de derrubar o boot, porque um serviço de pé na
porta errada aparece no primeiro `GET /health` que falha, e um container em loop
de restart esconde a causa atrás do ruído.

O `healthcheck` do compose aponta para `GET /health`, que responde `200` sempre
que o servidor está de pé e põe o diagnóstico no corpo (`status: degraded` sem
sessão salva ou com colheita ilegível). É deliberado não reprovar o healthcheck
nesses casos: nenhum restart traz de volta uma sessão perdida, e reiniciar em
laço trocaria um problema visível por um invisível.

## 12. Testes

Mantendo o TDD do projeto, com a divisão que o worker permite:

- **Provider da API** (Vitest, puro): dado um JSON de worker, produz os
  `RawJobProps` certos — data do snowflake, descarte de post sem id,
  `status: "session-lost"` alertando uma vez e ainda servindo a colheita
  preservada. Nenhum navegador envolvido, nenhuma rede. As fixtures
  (`test/fixtures/harvest-*.json`) têm data fixa justamente porque o provider
  não aplica a janela de 72 h: teste que envelhece é teste que falha sozinho em
  três dias.
- **Servidor do worker** (Vitest + `fastify.inject()`): as rotas sem abrir
  porta, com o leitor da colheita injetado — colheita boa, ausente, ilegível e
  em gravação. O leitor em si é testado contra o disco de verdade, em pasta
  temporária, inclusive com o arquivo travado pelo `proper-lockfile`: é o único
  jeito de provar que a trava é consultada e não adquirida. Cobertura total em
  `src/server/**`, com limiar no `vitest.config.ts`.
- **Parser do DOM** (Vitest + cheerio, no worker): a função de extração recebe
  HTML de uma busca e devolve os cards. **Fixtures de HTML são o ativo mais
  importante aqui** — quando o LinkedIn mudar o layout, é o teste que falha
  primeiro e diz o que mudou, em vez de a produção emudecer. Cobertura total em
  `src/parser/**`, com limiar no `vitest.config.ts`.

  **As fixtures atuais não são HTML salvo do LinkedIn**, e cada arquivo diz isso
  no topo. Foram reconstruídas a partir dos seletores que o coletor de
  referência usa em produção — evidência de um raspador que funciona — mas a
  marcação em volta é invenção nossa. Logo o parser está correto contra os
  arquivos e **não verificado contra o LinkedIn**: os 100% medem o rigor dos
  testes, não a fidelidade ao DOM real. Substituir por HTML de uma busca de
  verdade (`Ctrl+S` na página de resultados) é o que converte isso em garantia,
  e é esperado que alguns seletores mudem nesse momento.
- **Navegação** (manual, com `--show`): não automatizo contra o LinkedIn de
  verdade. Cada execução custa risco de conta, e um teste que bate na fonte real
  a cada CI é exatamente o que derruba a sessão.

O CI não executa Playwright. O `apps/posts-worker` entra no `typecheck` e no
`lint` da raiz como qualquer workspace.

## 13. Fases

1. **Worker esqueleto.** ✅ `apps/posts-worker`, tipos do contrato, comandos
   `session:login` (headed) e `session:check`. Sem navegação de colheita.
   O `GET /posts`, o Dockerfile e a trava com `proper-lockfile` saíram desta
   fase para a 2b: construir a imagem antes de saber o que entra nela é iterar
   em 1 GB sem motivo, e a trava só passa a proteger algo quando existe colheita
   concorrendo com o login.
2. **Colheita**, em duas metades, porque a URL não está no DOM (§5.3):
   - **2a.** ✅ Parser puro sobre HTML salvo, fixtures, cobertura total.
   - **2b.** Em duas metades também, por causa da conta restringida (§13.1):
     - ✅ O que não navega: `GET /posts` e `GET /health` com Fastify,
       encerramento limpo nos sinais do Docker, trava da colheita (§7.1).
     - Passo de navegador: busca, expansão do texto, resolução de link por
       card, gravação atômica do `harvest.json`. Precisa da conta de pé.
       Rodando só na máquina local.
3. **Provider na API.** ✅ `LinkedinAuthPostsScraperProvider`, registro em
   `SCRAPERS`, frescura da colheita na tabela de saúde pelo `isDue` (§5.2),
   alerta de sessão caída no Telegram. Testes do provider. A fonte já aparece no
   painel, lendo um worker local.
4. **Produção.**
   - ✅ Dockerfile na base oficial do Playwright (`v1.63.0-jammy`, a mesma
     versão do pacote npm) e serviço no compose de desenvolvimento, atrás do
     profile `linkedin`. O build entra no CI: a incompatibilidade entre musl e
     glibc, que criou este serviço, só aparece em build de verdade.
   - Serviço no compose de produção, volume nomeado, bootstrap por noVNC na
     VPS. Observar por uma semana com intervalo de 8 h antes de considerar
     baixar para 6 h.

As fases 1 a 3 não tocam em produção e não usam a conta além do login inicial.
A 2a não usa nem isso: roda inteira sem rede.

### 13.1 A ordem muda enquanto a conta está restringida

A numeração não é a ordem de execução agora. Com a conta barrada (§14.1), o que
depende dela é só a resolução de link e a navegação — o resto segue:

1. ✅ **Fase 3 inteira.** O provider da API recebe um JSON e produz
   `RawJobProps`; os testes dele são escritos sobre `harvest.json` feito à mão.
   Nenhuma linha precisou da conta, e a fonte já aparece no painel.
2. ✅ **A metade de 2b que não navega:** o `GET /posts` com Fastify lendo
   `harvest.json`, o `GET /health` e a trava com `proper-lockfile`.
3. **O que navega**, quando a conta estiver de pé — e junto dele a troca das
   fixtures por HTML real, que é o que dá validade aos testes da 2a.

O que sobrou do caminho sem conta é a Fase 4 (imagem e compose), que faz sentido
só depois que existir colheita para servir.

Fazer a Fase 3 agora tem um ganho a mais: ela consome o contrato de ponta a
ponta e, se algum campo estiver errado, o erro aparece enquanto mexer no
contrato ainda é barato.

## 14. Riscos, e o que me faria recuar

| Risco | Mitigação | Sinal de que não vale a pena |
|---|---|---|
| Conta restringida ou banida | Conta dedicada, intervalo de 8 h, janela de atividade, tetos rígidos, sem login automático | Qualquer restrição na conta. Nesse caso o coletor é desligado e fica desligado |
| Seletores quebram no redesenho | Fixtures de HTML no teste; o `bot.py` do referencial tem comentários datados sobre a caixa virar `<dialog>` em out/2026 | Se a manutenção passar a ser mensal, a fonte não se paga |
| Chromium estoura a VPS | `mem_limit`, `shm_size`, uma instância por trava | OOM recorrente atingindo outros serviços |
| `state.json` vazar | `.gitignore`, só no volume, nunca em log | — |

E o ponto que sustenta tudo: isto contraria o acordo de uso do LinkedIn. A conta
dedicada não muda esse fato, só contém a consequência. O Serper permanece a
fonte primária exatamente para que, no dia em que esta fonte precisar morrer, o
radar não sinta.

### 14.1 A primeira linha da tabela foi atingida no primeiro login

Registrado para não ser esquecido: no primeiro `session:login`, o LinkedIn
barrou a conta em `/flagship-web/login/login-restriction/`. Não foi 2FA — foi
restrição de conta.

O critério de desistência escrito acima é "qualquer restrição na conta". A
leitura que adotamos é que **ainda não é o mesmo caso**: a restrição veio de
conta nova entrando por navegador automatizado, e não de raspagem punida — nada
chegou a ser raspado. Conta recém-criada é o perfil mais vigiado que existe, e o
Chrome for Testing que o Playwright baixa é um binário distinto do Chrome
normal, o que é um sinal a mais.

O que fica combinado, então, e vale como critério revisado:

1. A restrição é resolvida à mão, pelo navegador comum, do IP de sempre.
2. A conta recebe uso humano — foto, cargo, conexões, alguns dias — antes de
   qualquer nova tentativa automatizada.
3. A próxima tentativa usa `channel: 'chrome'`, o Chrome instalado na máquina,
   em vez do Chrome for Testing. Vale também avaliar o inverso do plano: fazer o
   login no navegador real e exportar os cookies de lá.
4. **Se a conta for restringida outra vez num login automatizado, depois de
   aquecida e verificada, o critério se cumpriu e a fonte é desligada.** Não há
   terceira tentativa.

Enquanto isso, a Fase 2 avança sem a conta: o parser é testado sobre HTML salvo,
por desenho (§12).

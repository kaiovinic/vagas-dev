# RFC 001 — Coletor de publicações do LinkedIn com sessão autenticada

Desenho antes da primeira linha de código. O objetivo é capturar publicações de
recrutador no LinkedIn com uma conta dedicada do DevRadar, fechando a lacuna que
nenhuma das fontes atuais cobre: a vaga que o recrutador baiano anuncia num post
e nunca publica em portal.

> **Status:** aprovado em 05/11/2026. Nada implementado ainda; a Fase 1 é o
> próximo passo. Aprovadas explicitamente: a separação em `apps/posts-worker`
> (§4), o `storageState` com `proper-lockfile` (§6, §7) e a resposta por cache
> no `GET /posts` levando o `harvestedAt` para a tabela de saúde (§5).

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
`/apps`. Compartilha o `package-lock.json` da raiz e reaproveita o
`decodePostTimestamp` por cópia do módulo ou por um pacote interno pequeno — a
decidir na implementação, mas a função é pura e sem dependências, então copiar
com um teste de equivalência é aceitável.

## 5. Contrato entre a API e o worker

### 5.1 O endpoint

```
GET http://posts-worker:4000/posts
```

```json
{
  "harvestedAt": "2026-11-05T09:12:44.000Z",
  "status": "ok",
  "searches": [{ "label": "Bahia", "query": "vaga desenvolvedor bahia", "found": 7 }],
  "posts": [
    {
      "url": "https://www.linkedin.com/feed/update/urn:li:activity:7521262024920764416/",
      "author": "Maria Silva",
      "authorUrl": "https://www.linkedin.com/in/maria-silva-123abc",
      "headline": "Tech Recruiter",
      "text": "Estamos contratando pessoa desenvolvedora React em Salvador...",
      "openToWork": false
    }
  ]
}
```

`status` é um de `ok`, `session-lost`, `degraded` (navegou, mas alguma busca
falhou) ou `never-ran`. Ele é o canal de diagnóstico: a API não tem como saber
que o navegador perdeu o login, e este campo é como ela descobre.

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
3. Descarta o que estiver fora da janela de 72 h, o que não tiver URL de post
   reconhecível e o que tiver `openToWork` (quem procura recolocação).
4. Entra no registro `SCRAPERS` do `infra.module.ts`. O orquestrador não muda.

Não há `isDue` sobrescrito: a leitura é gratuita, então ela acontece em toda
captura. A cadência protetora está no worker. Em troca, `harvestedAt` sobe para
a tabela de saúde, para que o painel mostre a idade real da colheita e não a
idade da leitura — sem isso a aba `Mercado` mentiria, dizendo "agora" para dados
de 7 horas atrás.

Nenhuma exceção escapa: o `BaseScraperProvider` já garante que worker fora do ar
devolve lista vazia e as outras fontes seguem (LSP).

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
      LINKEDIN_POSTS_ENABLED: 'true'
      TZ: America/Bahia
    ports:
      - '127.0.0.1:4000:4000'
    shm_size: '1gb'
    volumes:
      - devradar-linkedin-session:/data
```

Sobe com `docker compose --profile linkedin up -d posts-worker`. A API no host
aponta para `http://127.0.0.1:4000`.

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

## 12. Testes

Mantendo o TDD do projeto, com a divisão que o worker permite:

- **Provider da API** (Vitest, puro): dado um JSON de worker, produz os
  `RawJobProps` certos — data do snowflake, descarte de `openToWork`, descarte
  fora de 72 h, `status: "session-lost"` virando lista vazia mais alerta. Nenhum
  navegador envolvido, nenhuma rede.
- **Parser do DOM** (Vitest + JSDOM, no worker): a função de extração recebe
  HTML salvo de uma busca real e devolve os posts. **Fixtures de HTML são o
  ativo mais importante aqui** — quando o LinkedIn mudar o layout, é o teste
  que falha primeiro e diz o que mudou, em vez de a produção emudecer.
- **Navegação** (manual, com `--show`): não automatizo contra o LinkedIn de
  verdade. Cada execução custa risco de conta, e um teste que bate na fonte real
  a cada CI é exatamente o que derruba a sessão.

O CI não executa Playwright. O `apps/posts-worker` entra no `typecheck` e no
`lint` da raiz como qualquer workspace.

## 13. Fases

1. **Worker esqueleto.** `apps/posts-worker` com Fastify, `GET /posts` lendo
   `harvest.json`, Dockerfile na base do Playwright, trava com
   `proper-lockfile`, comando `session:login` headed no Windows. Sem navegação de
   colheita ainda — mas já dá para provar que o login grava `state.json`.
2. **Colheita.** Busca de publicações, extração do DOM, link, `harvest.json`.
   Fixtures de HTML e testes do parser. Rodando só na máquina local.
3. **Provider na API.** `LinkedinAuthPostsScraperProvider`, registro em
   `SCRAPERS`, `harvestedAt` na tabela de saúde, alerta de sessão caída. Testes
   do provider. Aqui a fonte já aparece no painel, lendo um worker local.
4. **Produção.** Serviço no compose de produção, volume, bootstrap por noVNC na
   VPS, `LINKEDIN_POSTS_ENABLED=true`. Observar por uma semana com intervalo de
   8 h antes de considerar baixar para 6 h.

As fases 1 a 3 não tocam em produção e não usam a conta além do login inicial.

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

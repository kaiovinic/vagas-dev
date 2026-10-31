# Deploy em VPS

Checklist de comandos para subir o DevRadar num servidor Ubuntu 22.04 ou 24.04
recém-contratado. Do zero ao ar em cerca de 15 minutos, a maior parte esperando
build.

**Requisitos mínimos:** 2 vCPU, 2 GB de RAM e 20 GB de disco. O build das
imagens é a parte pesada; com 1 GB de RAM o `npm ci` do frontend costuma morrer
por falta de memória.

**Antes de começar, aponte o DNS.** O Caddy só emite o certificado se o domínio
já resolver para o IP do servidor, e a propagação pode levar minutos ou horas.
Crie um registro `A` do seu domínio para o IP da VPS e confirme:

```bash
dig +short devradar.exemplo.com.br
```

A saída tem que ser o IP do servidor. Se vier vazia, espere — não adianta
seguir.

---

## 1. Acesso e atualização

```bash
ssh root@SEU_IP
```

```bash
apt update && apt upgrade -y
```

### Usuário sem privilégio

Rodar a aplicação como `root` é desnecessário. Crie um usuário e dê acesso ao
Docker a ele:

```bash
adduser --gecos "" devradar
```

```bash
usermod -aG sudo devradar
```

Copie sua chave SSH para o novo usuário e reconecte como ele:

```bash
rsync --archive --chown=devradar:devradar ~/.ssh /home/devradar/
```

```bash
exit
```

```bash
ssh devradar@SEU_IP
```

---

## 2. Docker

Instalação oficial, pelo script de conveniência:

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
```

Leia antes de executar — é o mínimo com qualquer script baixado da internet:

```bash
less get-docker.sh
```

```bash
sudo sh get-docker.sh
```

Libere o Docker para o seu usuário, sem `sudo` em todo comando:

```bash
sudo usermod -aG docker $USER
```

O grupo só vale numa sessão nova. Saia e entre de novo:

```bash
exit
```

```bash
ssh devradar@SEU_IP
```

Confirme que o daemon responde e que o plugin `compose` veio junto:

```bash
docker run --rm hello-world && docker compose version
```

---

## 3. Clone do repositório

```bash
git clone https://github.com/kaiovinic/vagas-dev.git
```

```bash
cd vagas-dev
```

---

## 4. Configuração

```bash
cp .env.prod.example .env.prod
```

```bash
nano .env.prod
```

| variável | o que pôr |
|---|---|
| `POSTGRES_PASSWORD` | senha forte e **única** — `openssl rand -base64 24` gera uma |
| `DEVRADAR_DOMAIN` | o domínio que você apontou no DNS, sem `https://` |
| `ACME_EMAIL` | seu e-mail, para o Let's Encrypt avisar de expiração |
| `TELEGRAM_BOT_TOKEN` | token do [@BotFather](https://t.me/BotFather) — opcional |
| `TELEGRAM_CHAT_ID` | de `https://api.telegram.org/bot<TOKEN>/getUpdates` — opcional |
| `SERP_API_KEY` | chave do [Serper](https://serper.dev), para o coletor de publicações — opcional |

Sem os dois do Telegram a aplicação sobe e funciona: ela avisa em `WARN` no
boot e simplesmente não manda alerta de vaga nova. Sem `SERP_API_KEY`, o
coletor de publicações do LinkedIn vira no-op silencioso e as outras seis
fontes continuam normalmente.

Proteja o arquivo — é o único lugar com segredo de produção:

```bash
chmod 600 .env.prod
```

---

## 5. Firewall

Só o proxy publica porta. Postgres e API ficam em redes internas do Docker e
não devem ser alcançáveis de fora:

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw --force enable
```

> O Docker escreve direto no `iptables` e pode furar o UFW ao publicar portas.
> Nesta composição isso não acontece, porque só o Caddy publica 80 e 443 — as
> mesmas que você acabou de liberar. Se um dia publicar outra porta, confira
> com `sudo iptables -L DOCKER-USER -n`.

---

## 6. Subida

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

O primeiro build leva de 5 a 15 minutos: compila API e frontend em estágios
separados e gera o client do Prisma. Os seguintes reaproveitam cache.

Não é preciso rodar migration à mão — a API as aplica no entrypoint, antes de
começar a servir.

Confira que os quatro serviços estão de pé:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

Esperado: `postgres`, `api`, `web` e `proxy` em `running`, com `postgres` e
`api` marcados `(healthy)`.

---

## 7. Verificação do TLS

É aqui que se descobre se o DNS estava mesmo pronto. Acompanhe o Caddy:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f proxy
```

**Deu certo** quando aparecer, para o seu domínio:

```
certificate obtained successfully
```

ou

```
served key authentication   ...   challenge=http-01
```

Saia dos logs com `Ctrl+C` — isso não para o container.

**Deu errado** se repetir alguma destas:

| no log | causa | o que fazer |
|---|---|---|
| `no such host` / `DNS problem` | o domínio não resolve para este IP | conferir o registro `A` e esperar a propagação |
| `connection refused` no desafio | porta 80 fechada | revisar o UFW e o firewall do painel do provedor |
| `too many certificates already issued` | limite semanal do Let's Encrypt | esperar; testar antes com `DEVRADAR_DOMAIN=localhost` |
| `timeout during connect` | firewall do provedor na frente da VPS | liberar 80 e 443 no painel, não só no UFW |

O Let's Encrypt limita **5 certificados por domínio por semana**. Para ensaiar
a pilha sem gastar esse limite, suba uma vez com `DEVRADAR_DOMAIN=localhost`:
o Caddy assina com uma CA local e não chama o Let's Encrypt.

### Checagem fim a fim

```bash
curl -I https://devradar.exemplo.com.br
```

```bash
curl https://devradar.exemplo.com.br/api/health
```

A segunda deve responder `{"status":"ok","database":"up"}`.

A primeira captura roda na próxima hora par. Para não esperar:

```bash
curl -X POST https://devradar.exemplo.com.br/api/capture/run
```

---

## Operação

**Logs de um serviço:**

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api
```

**Atualizar para a versão mais recente:**

```bash
git pull && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

**Backup do banco** — o volume sobrevive a `down`, mas não a um disco perdido:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres pg_dump -U devradar devradar | gzip > devradar-$(date +%F).sql.gz
```

Guarde o arquivo **fora** da VPS. Um backup no mesmo disco que o banco não é
backup.

**Parar tudo, preservando os dados:**

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod down
```

> `down -v` apaga o volume e **o banco junto**. Não existe desfazer.

---

## Como a pilha se encaixa

```
internet → :443 proxy (Caddy, TLS automático)
                 └→ web (Nginx: SPA + repasse de /api)
                          └→ api (NestJS, migrations no entrypoint)
                                   └→ postgres (rede sem saída para a internet)
```

Três redes separadas. `data` é `internal: true`, então o Postgres não alcança a
internet nem é alcançado de fora. A API fica em `data` e `backend` — precisa de
saída para visitar os sites de vaga. Só o Caddy publica porta.

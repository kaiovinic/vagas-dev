# Deploy em VPS compartilhada com o PrintGest

Este guia cobre o caso em que a VPS **já roda outro projeto** que ocupa as
portas 80 e 443 — concretamente a VPS do PrintGest, com o container
`printgest-frontend` publicando `0.0.0.0:80` e `0.0.0.0:443` e terminando TLS
com certificado do Let's Encrypt em `/etc/letsencrypt`.

Para uma VPS dedicada ao DevRadar, use [deploy-vps.md](deploy-vps.md); nada
aqui substitui aquele guia, que continua valendo para os passos de Docker,
clone, `.env.prod` e firewall.

## O desenho

```
Internet :80 / :443
        │
        ▼
  caddy (DevRadar)  ── vagas.printimpressoes.com.br     → web:80 → /api → api:3333 → postgres
        │
        └──────────── printgest.printimpressoes.com.br  → printgest-frontend:80
                      printimpressoes.com.br
                      www.printimpressoes.com.br
```

O Caddy que já vem no `docker-compose.prod.yml` é promovido a **borda
compartilhada**: ele assume as portas do host e passa a emitir e renovar o
certificado dos quatro domínios. O PrintGest deixa de publicar portas e de
terminar TLS; passa a existir só dentro da rede do Docker, como a API do
DevRadar.

Três consequências que valem entender antes de começar:

- **O TLS do PrintGest migra de dono.** O certificado atual em
  `/etc/letsencrypt` para de ser usado, mas continua no disco e válido — é ele
  que torna o rollback possível dentro da sua janela de validade (90 dias).
- **A renovação antiga precisa ser desligada.** Qualquer `certbot` com desafio
  `http-01` no host vai falhar depois da migração, porque a porta 80 agora é do
  Caddy. Veja [Depois da migração](#depois-da-migração).
- **Há indisponibilidade do PrintGest**, de segundos a cerca de um minuto: ele
  tem que liberar as portas antes de o Caddy subir. Não existe troca sem essa
  janela.

## 1. DNS, antes de tudo

O Caddy pede o certificado do `vagas.*` no primeiro acesso, e o desafio do
Let's Encrypt chega pela porta 80 no IP que o DNS aponta. Crie o registro A de
`vagas.printimpressoes.com.br` apontando para o IP da VPS e confirme a
propagação antes de seguir:

```bash
dig +short vagas.printimpressoes.com.br; curl -s https://ifconfig.me; echo
```

Os dois valores precisam ser o mesmo IP. Se o `dig` vier vazio, espere — subir
a pilha antes disso só gasta tentativas no rate limit do Let's Encrypt.

## 2. Backup do estado atual do PrintGest

Este passo é o que faz o rollback do item 6 ser possível. Guarde o compose e a
config do nginx que está **embutida na imagem** do `printgest-frontend`:

```bash
mkdir -p /root/printgest-backup-$(date +%F) && cd /root/printgest-backup-$(date +%F) && cp /root/PrintGest/docker-compose*.yml . && docker exec printgest-frontend sh -c 'ls -1 /etc/nginx/conf.d' | tee conf.d.txt
```

A saída de `conf.d.txt` dá o nome do arquivo de config — normalmente
`default.conf`. Troque `default.conf` pelo nome real nos comandos abaixo e
despeje o original:

```bash
docker exec printgest-frontend cat /etc/nginx/conf.d/default.conf > /root/PrintGest/nginx-frontend.conf.orig && cp /root/PrintGest/nginx-frontend.conf.orig ./ && wc -l /root/PrintGest/nginx-frontend.conf.orig
```

## 3. DevRadar de pé, sem tocar nas portas

O DevRadar sobe inteiro e passa a coletar **enquanto o PrintGest segue dono das
portas 80/443**. O `docker-compose.vps.yml` publica o frontend só em
`127.0.0.1:8080`, e o Caddy fica de fora desta subida:

```bash
cd /root && git clone <url-do-repositorio> DevRadar && cd DevRadar && cp .env.prod.example .env.prod
```

No `.env.prod`, além das senhas e do token do Telegram:

```ini
DEVRADAR_DOMAIN=vagas.printimpressoes.com.br
ACME_EMAIL=seu-email@printimpressoes.com.br
```

`DEVRADAR_DOMAIN` é usado pelo `Caddyfile.edge`; os domínios do PrintGest estão
escritos dentro do arquivo, em `infra/caddy/Caddyfile.edge`. Confira se a lista
está certa antes de subir.

Agora suba tudo **menos o proxy**:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.vps.yml --env-file .env.prod up -d --build postgres api web
```

O build do Vite é o pico de memória da operação. Em 2 vCPUs ele leva alguns
minutos; acompanhe com `free -h` em outra sessão se quiser.

Verifique a pilha do DevRadar pela porta de loopback, ainda sem DNS nem TLS:

```bash
curl -sS -H 'Host: vagas.printimpressoes.com.br' http://127.0.0.1:8080/healthz; curl -sS -H 'Host: vagas.printimpressoes.com.br' http://127.0.0.1:8080/api/health; echo
```

O primeiro responde `ok`; o segundo devolve o JSON de saúde da API, que
consulta o banco. Se os dois passarem, o DevRadar está pronto e nada no
PrintGest foi tocado ainda.

## 4. PrintGest em HTTP puro, sem as portas do host

Daqui em diante começa a janela de indisponibilidade. São duas edições.

**4.1 — A config do nginx.** Edite
`/root/PrintGest/nginx-frontend.conf.orig` (salve como
`/root/PrintGest/nginx-frontend.conf`) aplicando exatamente três mudanças:

1. **Apague** o bloco `server` que escuta na porta 80 e faz
   `return 301 https://$host$request_uri`. Apagar, não esvaziar: um `server`
   sem `root` casando os mesmos `server_name` venceria a correspondência por
   vir antes e devolveria 404 para o site inteiro.
2. Nos dois blocos restantes, troque `listen 443 ssl;` por `listen 80;`
   (e `listen [::]:443 ssl;` por `listen [::]:80;`, se existir).
3. Nos mesmos dois blocos, remova `ssl_certificate`, `ssl_certificate_key` e
   qualquer `include .../options-ssl-nginx.conf` ou `ssl_dhparam`.

Todo `location` fica **idêntico** — inclusive o `proxy_pass
http://backend:8080`. O que mudou foi só onde o TLS termina.
`infra/printgest/frontend-http-only.conf.example` mostra o esqueleto esperado
para você comparar. Confira o diff antes de seguir:

```bash
diff -u /root/PrintGest/nginx-frontend.conf.orig /root/PrintGest/nginx-frontend.conf
```

**4.2 — O compose do PrintGest.** Em `/root/PrintGest/docker-compose.yml`, no
serviço do frontend:

- **remova** o bloco `ports:` com `80:80` e `443:443`;
- **acrescente** o mount da config editada, no caminho que o passo 2 descobriu:

```yaml
    volumes:
      - ./nginx-frontend.conf:/etc/nginx/conf.d/default.conf:ro
```

Remover porta publicada **não é possível por arquivo de override** — listas de
`ports` são somadas, nunca subtraídas. Por isso a edição é no arquivo base, e
por isso o passo 2 guardou uma cópia.

Aplique, validando a config antes de trocar o container:

```bash
cd /root/PrintGest && docker compose run --rm --no-deps -v /root/PrintGest/nginx-frontend.conf:/etc/nginx/conf.d/default.conf:ro frontend nginx -t
```

Troque `frontend` pelo nome do serviço no compose dele, se for outro — o `-v`
do `docker compose run` exige caminho absoluto no host. Com o `nginx -t` em
`syntax is ok`:

```bash
cd /root/PrintGest && docker compose up -d --force-recreate frontend
```

As portas 80 e 443 do host ficam livres neste instante. Confirme:

```bash
sudo ss -tulpn | grep -E ':(80|443)\b' || echo "portas 80 e 443 livres"
```

## 5. O Caddy assume a borda

```bash
cd /root/DevRadar && docker compose -f docker-compose.prod.yml -f docker-compose.vps.yml --env-file .env.prod up -d proxy && docker compose -f docker-compose.prod.yml -f docker-compose.vps.yml --env-file .env.prod logs -f proxy
```

Nos logs, procure uma linha `certificate obtained successfully` por domínio. A
emissão dos quatro leva de segundos a cerca de um minuto. `Ctrl+C` só para de
acompanhar o log; não derruba nada.

Verificação fim a fim, de fora da VPS:

```bash
for h in vagas.printimpressoes.com.br printgest.printimpressoes.com.br printimpressoes.com.br www.printimpressoes.com.br; do echo "== $h"; curl -sSI "https://$h" | head -3; done
```

E o redirecionamento de HTTP para HTTPS, que o Caddy faz sozinho:

```bash
curl -sSI http://printgest.printimpressoes.com.br | head -3
```

Precisa vir `301` com `Location: https://...` — e **uma** vez só. Se o `curl
-L` entrar em loop, o `return 301` do passo 4.1 não saiu.

## 6. Rollback imediato

A ordem importa: o Caddy tem que largar as portas antes de o PrintGest
reivindicá-las.

```bash
cd /root/DevRadar && docker compose -f docker-compose.prod.yml -f docker-compose.vps.yml --env-file .env.prod stop proxy
```

```bash
cd /root/PrintGest && cp /root/printgest-backup-*/docker-compose.yml . && docker compose up -d --force-recreate frontend
```

O certificado em `/etc/letsencrypt` nunca foi apagado e segue válido, então o
PrintGest volta ao estado anterior com o próprio TLS. O DevRadar continua de pé
e coletando, acessível em `127.0.0.1:8080` — só perde o domínio público. Para
acessá-lo nesse estado, um túnel SSH da sua máquina:

```bash
ssh -N -L 8080:127.0.0.1:8080 root@<ip-da-vps>
```

## Depois da migração

**Desligue a renovação antiga.** O `certbot` do host passa a falhar, porque a
porta 80 é do Caddy. Veja o que existe e desative:

```bash
systemctl list-timers --all | grep -i certbot; sudo crontab -l 2>/dev/null | grep -i certbot
```

```bash
sudo systemctl disable --now certbot.timer
```

Não apague `/etc/letsencrypt`: enquanto o certificado de lá estiver válido, ele
é a sua rede de segurança para o rollback.

**Onde ficam os certificados novos.** No volume `devradar-caddy-data`, não em
`/etc/letsencrypt`. É por isso que o volume é persistido no compose: sem ele,
cada `restart` pediria certificado novo e bateria no rate limit.

**Memória.** Em regime permanente os quatro containers do DevRadar somam algo
entre 400 e 600 MB. Com 3.8 GB totais e o PrintGest em ~1.2 GB, sobra folga; o
aperto aparece só durante o `--build`. Se um build futuro for morto por OOM,
rode `docker builder prune` antes de tentar de novo.

**Builds seguintes.** O `--build` recria as imagens do DevRadar sem tocar no
Caddy nem no PrintGest:

```bash
cd /root/DevRadar && docker compose -f docker-compose.prod.yml -f docker-compose.vps.yml --env-file .env.prod up -d --build api web
```

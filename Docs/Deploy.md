# Deploy

Como o Controle de Hábitos sobe no homelab, do clone à notificação chegando no
celular. É a etapa 5 do [Roadmap](Roadmap%20onda%201.md), e o critério dela é
este documento bastar: uma máquina limpa, só o que está escrito aqui.

O comportamento do app está nos [mapas](mapas/); aqui está só a operação.

## Sumário

| Seção | Quando se lê |
|---|---|
| [O que sobe](#o-que-sobe) | para entender o desenho antes de mexer: quatro serviços, e por que o túnel e o nginx **não** estão entre eles |
| [Antes: três coisas que não dão para desfazer](#antes-três-coisas-que-não-dão-para-desfazer) | uma vez, antes da primeira subida. São as decisões que um deploy distraído não desfaz |
| [No host](#no-host) | o que a máquina precisa ter |
| [Subida do zero](#subida-do-zero) | máquina limpa, oito passos até a notificação chegando no celular |
| [As variáveis](#as-variáveis) | ao escrever o `.env`, e sempre que uma versão nova pedir variável nova |
| [Operação](#operação) | o dia a dia: logs, as CLIs de reset, tique à mão, trocar VAPID ou domínio |
| [Atualização](#atualização) | **subir uma versão nova no que já está rodando** — o procedimento, a conferência, e como voltar atrás |
| [Backup](#backup) | o `pg_dump` verificado e a crontab |
| [Restauração](#restauração) | quando o banco precisa voltar, e a restauração de teste que fecha a etapa 5 |
| [Quando algo não sobe](#quando-algo-não-sobe) | a tabela de sintoma → causa provável. É o primeiro lugar a olhar |

---

## O que sobe

```
                                  ┌────────────┐
                                  │ Cloudflare │ ◀── celular, pelo domínio
                                  └─────▲──────┘
 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─ ─ ─ túnel saindo ─ ─ ─ ─ ─ ─ ─ ─ ─
┌────────────────────────┐              │     já de pé no homelab, e NENHUM
│ cloudflared            │ ─────────────┘     dos dois é serviço desta pilha
└───────┬────────────────┘
        │ tudo para o nginx
┌───────▼────────────────┐
│ nginx do host          │  habitos.conf: server_name → proxy_pass
└───────┬────────────────┘
        │ http://127.0.0.1:3000   (loopback do host)
┌───────▼─────┐      ┌────────┐      ┌─────────┐
│     app     │      │ worker │      │ migrate │ (roda uma vez e sai)
└──────┬──────┘      └───┬────┘      └────┬────┘
       └────────────┬────┴────────────────┘
              ┌─────▼────┐    rede `controle-habito-interna`
              │ postgres │    volume nomeado, sem porta no host
              └──────────┘
```

| Serviço | Imagem | O que faz |
|---|---|---|
| `postgres` | `postgres:16-alpine` | o banco. Volume `controle-habito_postgres` |
| `migrate` | `--target worker` | `migrate latest` + `seed`, e sai. Roda antes de app e worker |
| `app` | `--target app` | o Next empacotado (`output: "standalone"`), `node server.js` |
| `worker` | `--target worker` | o tique de 1 minuto: virada das 04:00, notificações, limpeza |

**Nem o túnel nem o nginx estão na lista, e é de propósito.** O homelab já roda
os dois — o cloudflared com o token da conta e todas as rotas num lugar só, e o
nginx distribuindo por domínio para cada aplicação do servidor. Um segundo de
qualquer um seria uma segunda credencial para administrar ou um segundo lugar
onde olhar quando o domínio não responde. O passo 2 liga esta pilha ao nginx que
já existe.

**A única porta publicada é a do app, e só em `127.0.0.1`.** O rate limiting
conta tentativas de login por `CF-Connecting-IP`, header que o Cloudflare
escreve e o nginx repassa intacto (ver
[servidor/pedido.ts](../servidor/pedido.ts)). Um pedido que chegue por outro
caminho não tem esse header, e `ipDoPedido()` devolve `127.0.0.1` para todo
mundo: o bloqueio por IP viraria bloqueio global, e cinco erros de digitação
trancariam o app inclusive para quem sabe a senha.

O `127.0.0.1:` do `ports:` é o que mantém esse caminho alternativo restrito a
processos **deste host** — onde o nginx mora, e onde quem já tem acesso também
tem o volume do Postgres. O que ele impede é a rede local inteira ter uma porta
de entrada sem túnel. Duas coisas valem saber:

- **nunca troque por `"3000:3000"`.** Além de abrir para a rede, portas
  publicadas pelo Docker são tratadas na cadeia `DOCKER-USER` do iptables, que é
  avaliada **antes** das regras do firewall do host: um `ufw deny 3000` não
  protegeria nada, e a sensação de estar fechado seria falsa;
- se precisar alcançar o app de outra máquina da rede, use um túnel SSH
  (`ssh -L 3000:127.0.0.1:3000 servidor`), não um bind mais largo.

O Postgres não publica nada: quem fala com ele está na rede
`controle-habito-interna`, com os quatro serviços.

Duas imagens de um [Dockerfile](../Dockerfile) só, porque as necessidades são
opostas: o app quer o mínimo que o rastreamento do Next provou necessário, e o
worker precisa de `node_modules` de verdade — ele roda TypeScript sob `tsx`, e
`tsc` não reescreveria os aliases `@/*` na saída. É por isso que `tsx` está em
`dependencies` e não em `devDependencies`.

---

## Antes: três coisas que não dão para desfazer

Decida as três **antes** da primeira subida. Nenhuma delas é um `.env` que se
edita depois — as três ficam gravadas em `config_app`, e o seed nunca sobrescreve
o que já está lá.

**1. O domínio.** `RP_ID` é o RP ID das passkeys. O navegador amarra a credencial
a esse hostname, e trocá-lo invalida a biometria cadastrada — ninguém entra, e a
saída é a CLI de reset. Escolha o subdomínio definitivo
(`habitos.seu-dominio.com`), não um temporário.

**2. O par VAPID.** É a identidade do remetente perante o serviço de push. O
navegador assina **para** uma chave pública, e um envio assinado por outra é
recusado. Gere o par uma vez; trocá-lo depois obriga a reassinar no aparelho.

**3. A senha do primeiro acesso.** `APP_SENHA_INICIAL` é semeada na primeira
subida e só nela. Depois do cadastro da biometria ela é desativada e não volta —
é o que faz a porta única do
[Mapa de autenticação](mapas/Mapa%20de%20autentica%C3%A7%C3%A3o.md) ser única.

E a quarta, que não é irreversível mas é a mais fácil de errar: **`APP_MODO` fica
`producao`.** Em `desenvolvimento` a senha continua valendo ao lado da passkey —
na internet, uma porta a mais, para sempre. A tela de login avisa em bloco
visível quando está nesse modo; se o aviso aparecer no celular, o `.env` do
servidor está errado.

---

## No host

Um Linux com:

- **Docker Engine + Compose v2** (`docker compose version` responde);
- **git**;
- um domínio no Cloudflare, com a zona ativa na mesma conta;
- **um cloudflared já rodando**, com um túnel ativo entregando ao nginx;
- **nginx no host**, distribuindo por `server_name`, com um diretório de
  `conf.d`/`sites-enabled` onde cai o `habitos.conf` do passo 2;
- `openssl`, para gerar as senhas (ou qualquer gerador que você confie).

Node, npm e cliente do Postgres **não** são necessários no host: tudo que precisa
deles roda dentro dos contêineres.

---

## Subida do zero

### 1. Clonar

```bash
sudo mkdir -p /opt/controle-habito && sudo chown "$USER" /opt/controle-habito
git clone <url-do-repo> /opt/controle-habito
cd /opt/controle-habito
```

### 2. O domínio no Cloudflare e o `habitos.conf` do nginx

O caminho é **Cloudflare → cloudflared → nginx do host → app**. O túnel entrega
tudo ao nginx, e quem escolhe a aplicação é o `server_name`.

**2a. No painel**, no túnel que já existe, só o hostname novo: um Public Hostname
para `habitos.seu-dominio.com` apontando para o nginx — o mesmo destino que os
outros domínios do servidor já usam. Nada aqui aponta para o app.

O TLS é do Cloudflare e é automático. WebAuthn exige HTTPS, e é daqui que ele vem.

**2b. O `habitos.conf`.** O app é um Node ouvindo em `127.0.0.1:3000` (a porta
que o passo 5 publica), e o nginx é um processo do **host**:

```nginx
server {
    listen 80;
    server_name habitos.seu-dominio.com;

    location / {
        proxy_pass http://127.0.0.1:3000;

        # HTTP/1.1 no upstream: o padrão do proxy_pass é 1.0, que não tem
        # transferência em pedaços — e as telas chegam em streaming
        # (`cacheComponents` + <Suspense>).
        proxy_http_version 1.1;

        # Sem esta linha o nginx manda `Host: 127.0.0.1:3000` — o padrão é o
        # endereço do upstream, não o do cliente. Hoje o app sobrevive a isso
        # (medido: `/`, `/login`, as APIs e o `/sw.js` respondem, e o 307 para
        # `/login` sai relativo), mas é o header que qualquer URL absoluta
        # gerada pelo servidor usaria, e é o que a checagem de origem das Server
        # Actions do Next compara. Barato de pôr, caro de descobrir faltando.
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;

        # `https` literal, não `$scheme`: a perna cloudflared→nginx é http, e
        # `$scheme` diria http — mas o navegador falou https com o Cloudflare.
        proxy_set_header X-Forwarded-Proto https;

        # Para o shell da página aparecer enquanto o resto ainda vem.
        proxy_buffering off;
    }
}
```

`nginx -t && systemctl reload nginx` e pronto. Três coisas que **não** devem
entrar nesse arquivo:

- **nenhum `proxy_set_header` para `CF-Connecting-IP`.** O nginx já repassa os
  headers do cliente que ele não reescreve, e esse é o que o rate limiting lê.
  Declará-lo à mão é o jeito de quebrá-lo: um `$remote_addr` ali poria o IP do
  túnel em todos os pedidos, e o bloqueio por IP viraria global. (Ele sobrevive
  ao padrão do nginx por ter hífens; headers com **underscore** são descartados,
  o que não é o caso aqui);
- **nenhum `root`, `alias` ou `try_files`.** `/_next/static` e `/sw.js` estão
  dentro do contêiner, não no disco do host: um `root` apontando para o
  filesystem devolveria 404 no service worker, e sem service worker a PWA não
  instala — o que mata o push no iOS;
- **nenhuma autenticação do nginx** (`auth_basic`, Access, etc.). Ela responderia
  às chamadas de API do app e impediria o registro do service worker. A
  autenticação deste app é a passkey.

E, do lado do Cloudflare, duas que valem o mesmo:

> **Não** ponha Cloudflare Access na frente desse hostname. Ele injeta uma tela
> de login própria, que responderia HTML às chamadas de API do app e impediria o
> registro do service worker — sem service worker a PWA não instala, e sem PWA
> instalada não há push no iOS.
>
> E não crie regra de "Cache Everything" para o domínio. As rotas de API não têm
> extensão e o Cloudflare não as cacheia por padrão; uma regra ampla cacheando
> `/api/hoje` mostraria o dashboard de ontem.

A perna nginx→app ser `http` não atrapalha o cookie de sessão: ele é `Secure`
porque `NODE_ENV` é `production` ([servidor/sessao.ts](../servidor/sessao.ts)), e
o que o navegador vê é o `https` do Cloudflare.

Até o passo 5 o domínio responde `502` — o upstream ainda não existe. É esperado.

### 3. Preencher o `.env`

```bash
cp .env.producao.example .env
```

Gere os segredos e **preencha o arquivo antes de seguir**:

```bash
openssl rand -hex 32      # POSTGRES_PASSWORD  (hex de propósito: entra numa URL)
openssl rand -base64 18   # APP_SENHA_INICIAL
```

Preencha também `RP_ID` e `APP_USUARIO_NOME`, e confirme `APP_MODO=producao`.
Não há variável de túnel aqui — o token é do cloudflared do homelab e fica na
configuração dele.

**`RP_ID` é a linha para conferir duas vezes** — é o hostname exato, sem
`https://` e sem barra no fim. Ele vem vazio no exemplo justamente para não haver
um valor plausível a ser gravado por distração: vazio, o app recusa o cadastro da
passkey com um erro claro e você preenche e re-semeia; errado, ele grava um
domínio que depois só sai com um `UPDATE` à mão.

A ordem importa: o compose monta a `DATABASE_URL` a partir de
`POSTGRES_PASSWORD` e **recusa qualquer comando** enquanto ela estiver vazia —
inclusive o próximo, que não tem nada a ver com banco.

Agora o par VAPID, de dentro da imagem (nenhum Node no host):

```bash
docker compose run --rm --no-deps worker tsx cli/vapid.ts
```

A primeira execução compila a imagem do worker, o que leva alguns minutos. Cole
as duas chaves que ele imprime no `.env`.

> `DATABASE_URL` **não** vai no `.env`: o compose a monta a partir de
> `POSTGRES_PASSWORD`, para a senha existir num lugar só. É por isso que ela
> precisa ser segura em URL — um `@` ou `/` dentro dela quebraria a conexão.

### 4. Criar o diretório de backup

```bash
sudo mkdir -p /var/backups/controle-habito
sudo chown "$USER" /var/backups/controle-habito
```

O compose o monta em `/backups` dentro do contêiner do Postgres. Se o caminho não
existir, o Docker o cria como root, e aí a retenção do script não consegue apagar
os dumps vencidos.

### 5. Subir

```bash
docker compose up -d --build
```

A primeira vez compila as duas imagens (alguns minutos). A ordem é garantida pelo
compose: `app` e `worker` só sobem depois do `migrate` terminar **com sucesso**,
então ninguém roda sobre schema velho.

Confira:

```bash
docker compose ps                    # app healthy, worker up, migrate exited (0)
docker compose logs migrate          # as 10 migrations e os seeds
docker compose logs -f app worker
```

E confira o caminho até o nginx, em três degraus — é o que separa "o app está
quebrado" de "o nginx não o encontra":

```bash
# 1. a porta está publicada, e só no loopback
ss -ltnp | grep ':3000'
#    127.0.0.1:3000  → certo
#    0.0.0.0:3000    → o `ports:` perdeu o 127.0.0.1

# 2. o app responde nela, do próprio host
curl -s http://127.0.0.1:3000/api/auth/estado
#    {"autenticado":false,...}

# 3. o nginx escolhe o server block certo e repassa
curl -s -H 'Host: habitos.seu-dominio.com' http://127.0.0.1/api/auth/estado
```

O degrau 3 é o que o túnel faz, e por isso ele não precisa do túnel para ser
testado: o `Host` é o que o nginx usa para escolher o `server_name`. Se o 2
responde e o 3 não, o problema é o `habitos.conf` — e `nginx -T | grep -A5
habitos` mostra o que o nginx realmente carregou, que não é sempre o que está no
arquivo que você editou.

### 6. Primeiro acesso — no aparelho que vai guardar a passkey

Abra `https://habitos.seu-dominio.com` **no celular**. Não no desktop: o cadastro
da biometria desativa a senha, e a passkey fica no aparelho onde foi criada.

1. entre com o usuário e a `APP_SENHA_INICIAL`;
2. a tela de biometria aparece sozinha (é a única rota liberada para a sessão do
   primeiro acesso) — cadastre a passkey;
3. saia e entre de novo, agora pela biometria. **Confirme que a senha foi
   recusada**: é o sinal de que o app está em modo produção.

### 7. Instalar a PWA e provar o push

1. **Android (Chrome):** menu › *Instalar aplicativo*.
   **iOS (Safari, 16.4+):** Compartilhar › *Adicionar à Tela de Início*. No iOS o
   push **só** funciona com a PWA instalada — pelo navegador não chega.
2. abra o app pelo ícone da tela inicial;
3. **Ajustes › Notificações › ativar**, e aceite a permissão do sistema;
4. **envie o push de teste** e confirme que chega;
5. **feche o app** (tire da lista de recentes) e envie o teste outra vez. Chegar
   com o app fechado é o item que a etapa 4 deixou pendente, e é o que só se prova
   aqui: em `localhost` o caminho inteiro roda, mas a entrega real não acontece.

### 8. Agendar o backup

Ver [Backup](#backup), abaixo. A etapa 5 só fecha com **uma restauração
testada**.

---

## As variáveis

| Variável | Quem lê | Observação |
|---|---|---|
| `POSTGRES_PASSWORD` | compose, postgres | obrigatória. Só caracteres seguros em URL |
| `POSTGRES_USER`, `POSTGRES_DB` | compose, postgres | opcionais (`habito`, `controle_habito`) |
| `APP_MODO` | app, a cada request | `producao`. Falha fechada: qualquer outro valor também é produção |
| `APP_USUARIO_NOME` | seed → `config_app` | só a saudação do dashboard |
| `APP_SENHA_INICIAL` | seed | primeira subida e só ela |
| `RP_ID`, `RP_NAME` | seed → `config_app` | **gravados uma vez**; editar depois não muda nada |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | seed → `config_app` | idem. O envio lê do banco, não do ambiente |
| `VAPID_SUBJECT` | seed → `config_app` | vazio = `https://<RP_ID>` |
| `HABITO_PORTA_LOCAL` | compose | a porta do host, presa em `127.0.0.1`. O `proxy_pass` do nginx aponta para ela |
| `TZ` | contêineres | só o carimbo do `docker logs` — ver abaixo |
| `HABITO_BACKUP_DIR` | compose, scripts | o mesmo valor nos dois |
| `HABITO_BACKUP_RETENCAO` | `infra/backup.sh` | dias; nunca apaga os 4 mais novos |

**`TZ` não é o fuso do app.** A virada das 04:00 e os horários de lembrete usam
`config_app.timezone` pelo `Intl` ([servidor/relogio.ts](../servidor/relogio.ts)),
justamente para não herdar o fuso do processo. Mudar o fuso do app é na tela de
Ajustes.

**Não há variável de túnel.** O token é do cloudflared do homelab e vive na
configuração dele; o contrato desta pilha com o resto do servidor é a porta em
`127.0.0.1`, não uma credencial copiada. Uma consequência boa: nem este `.env`
nem um dump deste banco carregam credencial de túnel.

**Por que tanta coisa é lida do banco e não do ambiente:** o `.env` muda junto com
o deploy, e a passkey gravada no celular não. `rp_id` e o par VAPID precisam
sobreviver a um deploy distraído, então o seed os grava com `ON CONFLICT DO
NOTHING` e a partir daí o banco manda.

---

## Operação

```bash
docker compose ps                          # estado dos quatro
docker compose logs -f worker              # o tique; silencioso quando não há evento
docker compose logs -f app
docker compose logs --since 24h worker     # a virada das 04:00 de hoje
```

Nem o log do nginx nem o do túnel estão aqui — são do host, e é para lá que se
olha quando o `app` está saudável e o domínio não responde:

```bash
sudo tail -f /var/log/nginx/error.log      # "connect() failed" = upstream caído
```

O worker só escreve linha quando acontece algo — ele roda 1440 vezes por dia, e um
log por tique enterraria o que importa.

Subir uma versão nova tem seção própria: [Atualização](#atualização).

### As CLIs de reset

São o caminho de volta quando o celular se perde. Rodam na imagem do worker, e
`docker compose run` dá o terminal que elas exigem — sem TTY elas se recusam.

```bash
# apaga a passkey, gera senha provisória, revoga sessões
docker compose run --rm worker tsx cli/reset-biometria.ts

# só uma senha provisória nova
docker compose run --rm worker tsx cli/reset-senha.ts
```

As duas exigem a palavra escrita (`RESETAR`, `GERAR`/`REATIVAR`), não `s/n`. A
senha provisória aparece no terminal: use-a para entrar e cadastrar a passkey
nova. `--sim` dispensa a confirmação, e fica registrado no log.

### Forçar um tique, com instante simulado

Para não esperar a virada das 04:00 nem as 20:00 de um `meta_atraso`:

```bash
docker compose run --rm worker tsx worker/tique-manual.ts "2026-11-26 04:01" --seco
docker compose run --rm worker tsx worker/tique-manual.ts "2026-11-26 04:01"
```

Roda o **mesmo** `tique()` do processo de um minuto. `--seco` mostra que instante
e que dia lógico o argumento produz, e para antes de tocar no banco. O instante
sem fuso é lido na parede do app, não na do contêiner.

### Trocar o par VAPID

Só se precisar mesmo: toda assinatura existente para de funcionar, e o aparelho
tem de assinar de novo em Ajustes.

```bash
docker compose run --rm --no-deps worker tsx cli/vapid.ts     # gera e imprime

# cole no .env, apague as linhas antigas do banco e re-semeie:
docker compose exec -T postgres psql -U habito -d controle_habito \
  -c "DELETE FROM config_app WHERE chave IN ('vapid_public_key','vapid_private_key')"
docker compose run --rm worker tsx db/cli.ts seed
docker compose restart app worker
```

### Trocar de domínio

Isto **invalida a biometria**. O navegador amarra a passkey ao hostname, e não há
como migrá-la.

1. backup (`./infra/backup.sh`);
2. no Cloudflare, um Public Hostname novo para o nginx, e o `server_name` do
   `habitos.conf` trocado para o domínio novo (`nginx -t && systemctl reload nginx`);
3. `RP_ID` novo no `.env`;
4. grave o novo valor no banco — o seed não sobrescreve:
   ```bash
   docker compose exec -T postgres psql -U habito -d controle_habito \
     -c "UPDATE config_app SET valor = 'novo.dominio.com', atualizada_em = now() WHERE chave = 'rp_id'"
   ```
5. `docker compose run --rm worker tsx cli/reset-biometria.ts` — apaga a passkey
   velha e devolve uma senha provisória;
6. `docker compose up -d`, entre pelo domínio novo com a provisória e cadastre a
   passkey outra vez.

---

## Atualização

Subir uma versão nova no que já está rodando. É um procedimento diferente da
[subida do zero](#subida-do-zero): aqui existe um banco com histórico, uma passkey
gravada num celular, e nenhum dos dois pode ser arrastado pela mudança.

### Antes

```bash
cd /opt/controle-habito
./infra/backup.sh
```

**O backup não é cortesia, é a única volta.** Migration não tem rollback
automático nesta pilha, e vários `down` são **lossy por construção** — a `0009`
converteu minutos em segundos e a volta arredonda para cima; a `0010` normalizou
a meta da cadência diária e a volta não restaura o valor antigo. Reverter o
schema devolve as colunas, **não** os dados. Quem devolve dado é
[Restauração](#restauração).

Se a versão nova pedir variável nova, ela entra no `.env` **antes** do build — e
a hora em que a falta aparece depende de quem lê a variável:

- **o compose** interrompe na hora, porque as obrigatórias usam `:?` (é o caso de
  `POSTGRES_PASSWORD`). Falha alta e barata;
- **o app**, que lê no momento da requisição, sobe saudável e só falha quando
  alguém toca a rota que precisa dela. Essa é a que morde: o `docker compose ps`
  diz que está tudo bem.

A lista está em [As variáveis](#as-variáveis), e `.env.producao.example` é a
referência do que deveria existir.

E vale olhar o que a migration vai fazer, antes de ela rodar:

```bash
git fetch && git log --oneline HEAD..@{u}        # o que vem
git diff --stat HEAD..@{u} -- db/migrations      # se vem migration
docker compose run --rm worker tsx db/cli.ts status
```

### O procedimento

```bash
git pull
docker compose up -d --build
docker compose ps
```

O que acontece nessa ordem, e por que basta um comando:

1. as duas imagens são reconstruídas — `app` (standalone do Next) e `worker`
   (TypeScript cru sob `tsx`), do mesmo Dockerfile;
2. o serviço **`migrate` roda até o fim antes de app e worker voltarem**, porque
   os dois têm `service_completed_successfully` nele. Ninguém sobe sobre schema
   velho, e não há duas instâncias disputando a trava do Knex;
3. `migrate` também roda o seed — que nesta pilha é só `config_app` e a senha do
   primeiro acesso, ambos com `ON CONFLICT DO NOTHING`. Ele **nunca** sobrescreve
   `rp_id` nem o par VAPID, que é o que faz a passkey do celular sobreviver a um
   deploy distraído;
4. app e worker reiniciam com as imagens novas. O **volume do Postgres não é
   tocado**.

Duas coisas que parecem problema e não são:

- **o comando demora no worker.** O `stop_grace_period` dele é de 90 s: o SIGTERM
  marca o laço para parar **depois** do tique em curso, porque matar no meio de
  uma materialização é o que a transação protege mas o processo precisa do tempo
  de terminá-la;
- **alguns segundos de `502` no domínio**, enquanto o contêiner do `app` reinicia
  e o healthcheck volta a passar. O nginx do host não tem o que fazer nesse
  intervalo, e não há nada a configurar: um app só, um usuário só.

**Nada a fazer no celular.** O service worker é pass-through com `skipWaiting` —
ele não guarda cache de nada ([public/sw.js](../public/sw.js)), existe para a PWA
ser instalável e para o push. Então não há versão velha presa no aparelho: a
próxima abertura já é a nova. O que **quebra** a PWA é `/sw.js` dar 404, e isso é
`habitos.conf` com `root`/`alias`/`try_files` — ver
[Quando algo não sobe](#quando-algo-não-sobe).

### Quando a migration falha

Vale saber antes de acontecer, porque o `migrate` é a **porta** de app e worker:
os dois dependem dele com `service_completed_successfully`, então uma migration
que estoura aborta o `up` e as imagens novas não entram em serviço.

```bash
docker compose logs migrate      # o erro, e em qual migration parou
docker compose ps                # quem ficou de pé, e quem não
```

O que **não** acontece: schema pela metade. As migrations rodam cada uma em sua
transação (o padrão do Knex, e o `knexfile` não desliga), então a que falha se
desfaz sozinha e o lote simplesmente para ali — `db/cli.ts status` mostra
exatamente onde.

O que **pode** acontecer é o app ficar fora do ar, e não há como prever se o
contêiner antigo ainda está rodando quando o `up` aborta: isso depende de até onde
o compose chegou antes de parar. Por isso a conferência é `docker compose ps`, e
não suposição. Corrigida a causa, `docker compose up -d --build` de novo retoma do
ponto em que parou.

### A conferência

```bash
docker compose ps                                        # app healthy, migrate Exited (0)
docker compose run --rm worker tsx db/cli.ts status      # pendentes (0)
curl -s http://127.0.0.1:3000/api/auth/estado        # a porta do HABITO_PORTA_LOCAL
docker compose logs --since 10m app
```

No `curl`, duas coisas de uma vez: se ele responde JSON, o app está de pé **e**
falando com o banco (é a rota do healthcheck). E
`"modoDesenvolvimento": false` é a confirmação de que o `APP_MODO` do servidor
continua `producao` — um `.env` que perdeu a variável abre uma porta a mais, em
silêncio, e este é o lugar onde isso aparece.

Depois, pelo domínio, no celular: abrir o app e entrar com a biometria. É o que
prova que `rp_id` não foi tocado. O worker não precisa de conferência ativa —
`docker compose logs --since 10m worker` em silêncio é o comportamento normal,
porque ele só escreve linha quando acontece algo.

E a limpeza, de vez em quando: as duas tags são reusadas (`:local`), então cada
rebuild deixa a imagem anterior pendurada.

```bash
docker image prune        # só as dangling; não mexe nas duas em uso
```

### Voltar atrás

Não há registro de imagens nem tag de versão: as imagens são construídas no
próprio host como `controle-habito-app:local` e `controle-habito-worker:local`.
Então "voltar à imagem anterior" é reconstruir do commit anterior:

```bash
git log --oneline -5
git checkout <commit>
docker compose up -d --build
```

Isso basta **se a versão nova não trouxe migration**. Se trouxe, o banco já está
no schema novo e a imagem velha não o entende. Duas saídas, nesta ordem:

```bash
# 1. reverter o último lote de migrations — devolve o SCHEMA, não o dado
docker compose run --rm worker tsx db/cli.ts rollback

# 2. se a volta era lossy (0009, 0010) ou o rollback falhar: o dump
./infra/restaurar.sh <o dump de antes da atualização>
```

> **`tsx db/cli.ts reset` não tem guarda e apaga tudo.** Ele é
> `rollback --all` + `latest` + `seed`, pensado para desenvolvimento, e nada no
> código impede que rode em produção. Em produção o comando é `rollback`, que
> reverte **um** lote. Ver [db/cli.ts](../db/cli.ts).

---

## Backup

`infra/backup.sh` roda no host e faz o dump pelo contêiner do Postgres, no
diretório montado em `/backups`. Assim o host não precisa de cliente Postgres
instalado, e nunca há cliente de versão diferente da do servidor.

```bash
./infra/backup.sh
```

O que ele faz, e por quê:

- **formato custom** (`-Fc`), comprimido — `pg_restore` restaura dele
  seletivamente; de um `.sql` só dá para restaurar tudo;
- escreve em `.parcial` e **renomeia no fim**, para um dump interrompido nunca
  parecer um backup bom;
- **confere o resultado** com `pg_restore --list`, exigindo as tabelas `habito`,
  `registro` e `config_app`. Um arquivo truncado por disco cheio tem tamanho,
  data e nada dentro: sem essa conferência o cron registraria sucesso por um mês,
  e a descoberta viria na restauração. Backup não verificado não é backup;
- **retenção** de `HABITO_BACKUP_RETENCAO` dias, que **nunca** apaga os 4 dumps
  mais novos — se o backup falhou por semanas sem ninguém ler o log, a retenção
  não pode ser o que apaga a última cópia.

### Agendar

Na crontab do usuário que roda o compose (`crontab -e`):

```cron
15 4 * * * cd /opt/controle-habito && ./infra/backup.sh >> "$HOME/habito-backup.log" 2>&1
```

O log no `$HOME` e não em `/var/log`: a crontab aqui é a do usuário que roda o
compose, e um `>>` em `/var/log` falharia por permissão — sem saída nenhuma, o
que faz o backup parecer que não rodou.

**04:15** e não 03:00: a virada do dia lógico é às 04:00, e é nela que o worker
fecha os períodos. Um dump quinze minutos depois pega o dia já assentado.

### O que o dump contém

Tudo que mora no Postgres: hábitos, config versionada, registros, períodos
materializados, sessões, a passkey, o par VAPID e o `rp_id`. **Não** contém o
`.env` nem nada do túnel.

Vale lembrar que metade disso é derivado: período, ocorrência, congelamento e
sequência são `simular()` gravado, e o app os reconstrói dos registros. A parte
insubstituível do dump é `habito_config` + `registro`.

> O botão **Ajustes › Dados › exportar** ainda devolve uma fixture — a rota
> `GET /api/exportar` não foi ligada ao banco. O backup de verdade é este
> `pg_dump`; o JSON da tela não serve como cópia hoje.

---

## Restauração

É destrutivo: o banco atual é derrubado e reconstruído a partir do arquivo.

```bash
./infra/restaurar.sh                                # lista os dumps disponíveis
./infra/restaurar.sh habito-20261126-0415.dump      # exige escrever RESTAURAR
```

Na ordem: confere o arquivo **antes** de derrubar o que está de pé (descobrir que
o dump não abre depois de apagar o banco é a única forma de transformar uma
restauração em perda de dados), para `app` e `worker`, recria o banco com
`DROP DATABASE ... WITH (FORCE)`, restaura com `--exit-on-error` e sobe tudo de
novo com `docker compose up -d` — o que faz o `migrate` aplicar as migrations que
a imagem atual tenha a mais que o dump.

A passkey volta junto, **mas** só continua valendo se o `rp_id` do dump for o
domínio pelo qual o app é acessado agora. Restaurar um dump de antes de uma troca
de domínio devolve a passkey do domínio antigo, que o navegador recusa: aí é
`cli:reset-biometria`.

### A restauração de teste que fecha a etapa 5

Faça uma vez, de verdade, enquanto o histórico ainda é pequeno:

1. `./infra/backup.sh`;
2. anote o estado atual: quantos hábitos, a sequência de um deles, o último
   registro do dia;
3. crie um hábito descartável e marque-o, para haver algo que o dump **não**
   tenha;
4. `./infra/restaurar.sh <o dump do passo 1>`;
5. abra o app pelo domínio e confira: os hábitos e as sequências do passo 2 de
   volta, o hábito descartável do passo 3 sumido, a biometria ainda entrando.

Se os cinco passos fecharem, o backup é um backup.

---

## Quando algo não sobe

| Sintoma | Causa provável |
|---|---|
| `migrate` sai com erro de conexão | `POSTGRES_PASSWORD` com caractere que quebra a URL (`@`, `:`, `/`, `#`) |
| depois de um `git pull`, app e worker não sobem | o `migrate` falhou, e os dois dependem dele com `service_completed_successfully`. `docker compose logs migrate` diz em qual migration parou — ver [Atualização](#atualização) |
| a versão nova sobe e uma rota responde 500 | variável nova no `.env` do repositório que não foi para o `.env` do servidor: o contêiner sobe sem ela e falha na primeira requisição que a leia |
| `migrate` reclama de `APP_SENHA_INICIAL` | primeira subida com a variável vazia |
| `app` fica `unhealthy` | o healthcheck chama `/api/auth/estado`, que consulta o banco; `docker compose logs app` mostra o erro por trás |
| `502` no domínio | o `app` não está saudável, ou o `proxy_pass` aponta para porta errada. Os três degraus do passo 5 dizem qual |
| `nginx: host not found in upstream "app"` | `proxy_pass http://app:3000` num nginx do **host**: `app` é nome na rede do Docker, e um processo do host não resolve. Tem de ser `http://127.0.0.1:3000` |
| nginx recusa recarregar, `bind() to 0.0.0.0:80 failed` | outro `server` já ocupa a 80 sem `server_name` distinto, ou um `listen 80 default_server` duplicado |
| o app responde no `curl` do host mas não pelo domínio | o `server_name` não casa com o hostname do Public Hostname, ou outro `server` block o pegou antes. `nginx -T` mostra o que está carregado de verdade |
| tudo funciona menos a PWA, `/sw.js` dá 404 | algum `root`, `alias` ou `try_files` no `habitos.conf`: os estáticos estão dentro do contêiner, não no disco do host |
| app sem CSS, PWA não instala | `.next/static` ou `public/` não foram para a imagem — rebuild sem cache |
| a tela de login mostra o aviso de modo desenvolvimento | `APP_MODO` no `.env` do servidor não é `producao` |
| biometria recusada depois de ter funcionado | o `rp_id` em `config_app` não é o domínio em uso |
| login trancado para todo mundo | rate limiting contando todos como um IP só: alguma porta publicada contornando o túnel |
| push não chega no iOS | a PWA não está instalada, ou o aviso foi disparado antes de assinar |
| push parou de chegar em tudo | o par VAPID mudou; reassine em Ajustes |

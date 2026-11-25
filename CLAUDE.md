# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev     # dev server (Turbopack) on http://localhost:3000
npm run build   # production build
npm run start   # serve the production build
npm run lint    # eslint (flat config; takes no args by default)
npm test        # jest (586 casos; exige o db:up rodando)

npm run db:up        # sobe o Postgres de desenvolvimento (docker-compose.dev.yml)
npm run db:migrate   # aplica as migrations pendentes
npm run db:seed      # semeia config, senha e 6 hábitos com 30 dias de histórico
npm run db:reset     # rollback total + migrate + seed
npm run db:status    # o que já rodou e o que falta

npm run worker       # o processo do tique de 1 minuto (etapa 3.5)
npm run worker:tique # um tique à mão, com instante simulado (--seco só resolve o instante)
npm run push:chaves  # gera um par VAPID e imprime para colar no .env

npm run cli:reset-biometria  # apaga a passkey, gera senha provisória, revoga sessões
npm run cli:reset-senha      # só uma senha provisória nova
```

No servidor nada disso é npm — o host não tem Node. É `docker compose`, e os
equivalentes estão em [Docs/Deploy.md](Docs/Deploy.md):

```bash
docker compose up -d --build                                   # os cinco serviços
docker compose run --rm worker tsx cli/reset-biometria.ts       # a CLI de reset
docker compose run --rm worker tsx worker/tique-manual.ts "2026-11-26 04:01"
./infra/backup.sh                                              # no host, pela crontab
./infra/restaurar.sh habito-20261126-0415.dump
```

`npm test` exige o Postgres de desenvolvimento rodando e nada mais: cada worker do Jest cria e migra o próprio database (`controle_habito_test_<n>`). O SWC do `next/jest` transforma TypeScript **sem checar tipos**, então `npx tsc --noEmit` roda ao lado — e `npm run build` também, porque `cacheComponents` recusa ler `params` fora de `<Suspense>` e só o build diz isso.

As duas CLIs de reset são destrutivas e exigem a palavra escrita (`RESETAR`, `GERAR`/`REATIVAR`). Sem terminal interativo elas recusam; `--sim` dispensa a confirmação e fica registrado no log.

## Read the bundled Next.js docs first

`AGENTS.md` (auto-generated and re-added by `next dev`) warns that this Next.js version has breaking changes relative to training data. The authoritative docs ship with the package:

- `node_modules/next/dist/docs/01-app/` — App Router getting started, guides, API reference
- `node_modules/next/dist/docs/03-architecture/`

Consult the relevant page before writing Next.js code. If `AGENTS.md` reappears as an uncommitted change, commit it with your work rather than deleting it.

## Stack and non-obvious wiring

- **Next.js 16.4.5 / React 19.3 / TypeScript strict**, App Router only (`app/`). No `src/` directory; `@/*` resolves to the repo root.
- **Tailwind CSS v4 is wired through Turbopack, not PostCSS.** [next.config.ts](next.config.ts) registers `@tailwindcss/turbopack` as a loader for `*.css`. There is no `postcss.config.*` and adding one is not how this project is configured. Design tokens live in `@theme inline` inside [app/globals.css](app/globals.css), which is imported once by [app/layout.tsx](app/layout.tsx).
- **`cacheComponents` and `partialPrefetching` are enabled** in [next.config.ts](next.config.ts). These change the default caching/streaming semantics of server components, so data fetching and dynamic APIs need to follow the Next 16 cache-component rules (see the caching and `use cache` pages under the bundled docs).
- **Route prop types are generated globally.** Components use `LayoutProps<"/">` / `PageProps<...>` with no import — these come from `.next/dev/types` and `.next/types` (included via `tsconfig.json`). They only exist after a `dev`/`build` run, so run one before trusting a type error about them.
- Fonts come from `next/font/google` (Geist, Geist Mono) exposed as the CSS variables `--font-geist-sans` / `--font-geist-mono` on `<html>`.

## What this project is

A personal habit tracker for a single user — no multi-tenancy, no signup, no `user_id` on domain tables. Self-hosted on the owner's homelab: Next.js in Docker alongside a Postgres container, reachable through a Cloudflare Tunnel on a fixed domain. **Not** deployed to Vercel, so serverless-only patterns (Vercel Cron, edge runtime assumptions) don't apply — scheduled work is a long-running worker process in the compose stack.

Authentication is a single gate: first access with user + password, then a WebAuthn passkey is registered and the password is deactivated. One device only; recovery is a CLI that resets the passkey directly in Postgres. The domain is part of the auth contract — the passkey's RP ID is the hostname, so changing it invalidates the biometric credential.

**`APP_MODO` (`desenvolvimento` | `producao`) is the one switch that loosens that gate**, read in `servidor/modo.ts`. In `desenvolvimento` the password stays active alongside the passkey and opens a complete session — the only way into a desktop with no authenticator. It is **not** `NODE_ENV`: a security key must not be a side effect of which npm script ran, and validating the PWA on the phone needs a production build over HTTPS from a machine that still has no authenticator — so the two must be separable. It fails closed (only the exact word enables the loose mode, read at request time, not inlined at build), the client learns it from `estadoAuth.modoDesenvolvimento` rather than a `NEXT_PUBLIC_*` (one source, no divergence), and the login screen says so in a visible block — the key leaking into the deploy would mean an extra door, permanently.

UI language is pt-BR. The design docs are also in Portuguese, and the domain vocabulary (`habito`, `periodo`, `ocorrencia`, `congelamento`, `cadencia`) is Portuguese in the schema and code.

## Design docs — read before touching domain code

The domain rules are non-trivial and were decided deliberately; [Docs/mapas/](Docs/mapas/) is the source of truth, not the code:

- **[Mapa de regras.md](Docs/mapas/Mapa%20de%20regras.md)** — the one to read first. Logical day boundary (04:00), the cadence + exclusive-mode model that replaced the ambiguous "período externo/interno", period state machine, how the per-habit streak counts, and the freeze mechanic (consumed automatically at period close).
- **[Mapa do banco.md](Docs/mapas/Mapa%20do%20banco.md)** — schema and Knex setup, including the versioned `habito_config` (never updated in place) and the materialized `habito_periodo`.
- **[Mapa de telas.md](Docs/mapas/Mapa%20de%20telas.md)** — screens, flows, per-type interactions, and the wave 1 / wave 2 split.
- **[Mapa de autenticação.md](Docs/mapas/Mapa%20de%20autentica%C3%A7%C3%A3o.md)** — WebAuthn flows, the reset CLI, rate limiting, and the accepted limits.

Each map ends with a "Pendências" section listing what is still undecided — check it before inventing an answer to one of those questions. **[Docs/Roadmap onda 1.md](Docs/Roadmap%20onda%201.md)** has the execution order, per-stage exit criteria, the API route inventory, and the known risks. **[Docs/Deploy.md](Docs/Deploy.md)** is the server runbook — what comes up, the variables, first access, the reset CLIs inside the container, the verified backup and the restore. Any change to the Dockerfile, the compose file or `infra/` has to show up there.

Four traps worth stating up front:

- **A timestamp is not a logical day.** `data_logica` subtracts 4h before casting to date, and a retroactive entry's `data_logica` differs from its `criado_em`.
- **Habit configuration is versioned.** Past periods must be evaluated by the rule in force then, never by the current config.
- **`cada_n_dias` is anchored on the last completion**, so its periods cannot be pre-generated, its `fim` is mutable, and a retroactive edit re-chains every later period. The other cadences behave conventionally.
- **Freezes are consumed automatically** when a period closes short of its goal. There is no `em_risco` state and no redemption deadline — the 7-day retroactive window is the only correction path.
- **`duracao` is measured in whole seconds**, not minutes — `habito_config.meta_segundos` and `registro.valor`. Fractional minutes are not an option: the goal is met by *summing registros*, and three 20 s sessions would add up to `0.99999…` against a 1 min goal. `contracts/duracao.ts` is the only place that decomposes and writes the unit.

Schema and queries both go through **Knex** (migrations + seeds in `db/`), with the table types in `db/tipos.ts` wired into `knex/types/tables`. In development the Knex instance must be a `globalThis` singleton, or Next's hot reload will open a new pool per recompile and exhaust Postgres connections. `next.config.ts` lists `knex` in `serverExternalPackages`: it resolves dialects with a dynamic require, and without that Turbopack tries to bundle `sqlite3`, `mysql2`, `oracledb` and `tedious`, failing the build. Joins are the one place the typed rows give up — `Knex.TableType` describes tables, not junctions, so a `join` types as `never` and the few queries that need one carry a hand-written row type with the reason written next to it.

## Current state

**Etapas 1 a 4 estão completas, e a 5 está escrita mas não executada.** Nada no app roda sobre fixture exceto `GET /api/exportar` (ver abaixo): toda rota de domínio fala com o Postgres.

O que a etapa 5 deixou pronto no repositório: [Dockerfile](Dockerfile) com os dois alvos, [docker-compose.yml](docker-compose.yml) de produção, `infra/` (backup verificado e restauração) e **[Docs/Deploy.md](Docs/Deploy.md)**, que é o runbook — leia-o antes de mexer em qualquer coisa de infra.

O que falta é execução no servidor, e três itens dependem dela:

- validar a PWA **instalada** no celular (último item da etapa 2);
- provar o push chegando com o app fechado (etapa 4). O caminho inteiro está de pé e testado; o que não se prova em `localhost` é a entrega real;
- a **restauração testada** que fecha a etapa 5 — o roteiro está em [Docs/Deploy.md](Docs/Deploy.md).

E uma dívida que o deploy tornou visível: **`GET /api/exportar` ainda devolve fixture.** O botão de exportar em Ajustes foi escrito quando não havia backup e se descrevia como "a única cópia fora do Postgres"; agora a cópia de verdade é o `pg_dump` de `infra/backup.sh`, mas a tela continua prometendo um arquivo que não é o histórico real.

### O que a etapa 5 fixou

**Duas imagens de um Dockerfile só**, porque as necessidades são opostas. `--target app` é o `output: "standalone"` do Next: servidor mínimo, sem npm dentro. `--target worker` é TypeScript cru sob `tsx`, e atende as três coisas que não passam pelo Next — o tique de um minuto, as migrations da subida e as CLIs de reset.

É por isso que **`tsx` está em `dependencies`**, não em devDependencies: `next build` compila só o grafo do app, e `tsc` não reescreveria os aliases `@/*` na saída — um `require("@/db/knex")` emitido não resolve. Mover o `tsx` de volta quebraria a imagem do worker, não um script de conveniência.

Cinco armadilhas de infra, todas verificadas construindo as imagens e subindo a pilha:

- **`next build` exige `DATABASE_URL`.** Ele avalia o grafo de cada rota para coletar a configuração dela, e nesse grafo está o `knexfile.ts`, que lança quando a variável falta: o build morre em "Failed to collect page data for /api/auth/logout". O Dockerfile passa um valor descartável na etapa de build. Nada é inlinado — o projeto não tem nenhuma `NEXT_PUBLIC_*` —, então a mesma imagem sobe em qualquer máquina.
- **O `standalone` copia o `.env` da raiz** para dentro de `.next/standalone/`. Com o arquivo no contexto do build, o segredo acabaria embutido na imagem; `.env` é o primeiro item do `.dockerignore` por isso.
- **`.next/static` e `public/` ficam fora do standalone** por decisão do Next (ele assume CDN). O Dockerfile os copia à mão: sem o primeiro o app sobe sem CSS, sem o segundo não há `/sw.js` — e sem service worker a PWA não instala, o que mata o push no iOS.
- **Migrations num serviço de passagem, não num entrypoint.** App e worker sobem juntos, e os dois rodando `migrate latest` ao mesmo tempo disputariam a trava do Knex num banco que ainda não tem a tabela de trava. O serviço `migrate` roda antes dos dois, com `service_completed_successfully`.
- **No `.dockerignore` o `*` não cruza `/`.** `*.test.ts` casa só a raiz: os testes entravam na imagem e o `apoio-de-teste.ts` deles não, e o build morria em oito `TS2307`. Precisa ser `**/*.test.ts`. É uma classe de erro que só o build dentro do contêiner mostra — na máquina de desenvolvimento os dois arquivos existem e `npm run build` passa.

E a regra que o compose documenta onde o `ports:` não está: **nenhuma porta é publicada no host.** O rate limiting conta tentativas por `CF-Connecting-IP`, que só o Cloudflare escreve; um caminho sem esse header faria `ipDoPedido()` devolver `127.0.0.1` para todo mundo, e o bloqueio por IP viraria bloqueio global.

### A arquitetura que a etapa 3 fixou

**Materialização é replay, não acumulação.** `habito_periodo`, `habito_ocorrencia`, `congelamento` e `habito_streak` **não são fonte de verdade** — são `simular()` gravado para ser lido rápido. A fonte são `habito_config` (versionada), `registro` e a pausa. `servidor/materializar.ts` reescreve tudo a partir dos registros que existem agora, dentro de uma transação.

Isso torna um conjunto grande de operações a **mesma** operação: criar, editar, pausar, retomar, arquivar, marcar, desmarcar, preencher retroativamente e virar o dia são todas "mudou a entrada, replay". O re-encadeamento de `cada_n_dias` e o estorno de congelamento caem de graça em vez de serem conserto caso a caso.

Três consequências que não são óbvias e que o código documenta no lugar:

- **`registro.periodo_id` é `NOT NULL ON DELETE CASCADE`**, então apagar períodos para recalculá-los levaria os registros junto. Eles são lidos antes e reinseridos **com os mesmos ids** — `ultimoRegistro.id` e `registroIds` viajam até a tela, e um id que muda transformaria o desfazer em 404.
- **Idempotência não é opcional.** O worker re-materializa na virada de cada dia e o usuário a cada marcação; um replay que não fosse idempotente faria o estoque de congelamento crescer a cada tique. Tem teste (`servidor/fechamento.test.ts`).
- **Chave de evento, nunca de linha.** `notificacao_enviada.referencia` descreve `<habito>|<dia>|<momento>` em texto, porque períodos e ocorrências trocam de id a cada replay: uma chave de id faria o lembrete já enviado ser reenviado a cada minuto.

### O que existe

- `db/` — 9 migrations. A `0009` trocou `habito_config.meta_minutos` por `meta_segundos` e converteu o `registro.valor` dos hábitos de duração junto. A `0007` removeu `congelamento.estornado_em` (estorno é a diferença entre dois recálculos, não um evento numa linha) e a `0008` trocou `notificacao_enviada.referencia_id` por `referencia` em texto. `db/teste.ts` cria **um database por worker** do Jest; `db/teste-url.ts` calcula a URL sem arrastar o driver, porque `pg` quebra em `jsdom`.
- `dominio/` — o núcleo puro, com relógio injetado. `simulacao.ts` é o replay.
- `contracts/` — Zod como fonte única, com `cadencia`/`meta` em uniões discriminadas aninhadas. `contracts/resumo.ts` é a **única** implementação da regra do hábito como frase.
- `servidor/` — autenticação (Argon2id, sessão de token opaco com SHA-256 no banco, rate limiting em tabela por `CF-Connecting-IP`, WebAuthn com trava de `rp_id`), hábitos, dashboard, registro, retroativo, push e o relógio lógico. `relogio.ts` tem o único `horaDeParede` do projeto.
- `worker/` — processo separado (`npm run worker`), tique de 1 minuto: virada do dia, notificações e limpeza, cada etapa capturada em separado para que uma falha de rede não impeça o fechamento. **Não sabe fechar período** — fechar é re-materializar.
- `cli/` — `push:chaves` (gera o par VAPID e imprime para colar à mão), `cli:reset-biometria` e `cli:reset-senha`. As duas últimas são transacionais e exigem a palavra escrita, não `s/n`.
- `cliente/` — o espelho de `servidor/` no navegador: `api.ts` (um formato de erro para toda falha, rede incluída, e o desvio 401→`/login` / 409→`/biometria` num lugar só), `push.ts`, `webauthn.ts`, `formato.ts`.
- `componentes/` — as sete telas, mais os módulos React-free e testados onde um erro de conta seria silencioso: `rascunho-de-habito.ts`, `duracao.ts` e `efeitos-de-hoje.ts`.
- `public/sw.js` — service worker com `push` e `notificationclick`.

### Duas horas de notificação decididas na 3.5

Não estavam no mapa de regras, e estão em `worker/notificacoes.ts`:

- `congelamento_usado` e `sequencia_perdida` nascem na virada das **04:00** e esperam as **08:00** para serem entregues. Acordar alguém às quatro para contar que a sequência acabou é o oposto do que o aviso serve, e o dashboard mostra os mesmos dois por dois dias.
- `meta_atraso` cai às **20:00** quando o hábito não tem `notificar_em` — é o único aviso antes de perder o período e não podia depender de um campo opcional. No último dia ele **substitui** o lembrete: duas notificações do mesmo hábito no mesmo minuto treinam a pessoa a ignorar as duas.

### Testes

`npm test` roda 586 casos em 28 arquivos (Jest 30 via `next/jest`). Exige o `db:up` rodando e nada mais — cada worker cria e migra o próprio database.

Quatro coisas que valem saber antes de escrever um teste aqui:

- **O SWC transforma sem checar tipos**, então rode `npx tsc --noEmit` ao lado. E `npm run build` também: `cacheComponents` recusa ler `params` fora de `<Suspense>`, e só o build diz isso.
- **`next/jest` carrega o `.env`**, então quem lê `APP_MODO` tem de pinar o valor no teste. `jest.setup.ts` fixa `producao`.
- **`jest.useFakeTimers` só pode falsear `Date`** (`doNotFake` para o resto): o driver do Postgres usa `setTimeout` internamente, e congelá-lo faz a consulta nunca voltar.
- **Nos testes de tela, o mock de `useRouter` precisa devolver referência estável.** `useRecurso` tem `router` entre as dependências do efeito que busca; um objeto novo a cada render refaz o `GET` sem parar e atropela a atualização otimista.

### Armadilhas que já morderam

Além das quatro do topo deste arquivo, estas apareceram em uso e têm teste:

- **Período que cobre hoje ≠ período aberto.** Cumprir a meta de um hábito diário **fecha** o período de hoje; o próximo só começa amanhã. Buscar `status = 'aberto'` fazia o hábito desaparecer do dashboard no instante em que era marcado.
- **Pausa vencida não é "está pausado".** `pausado_de`/`pausado_ate` guardam o intervalo e não são limpos quando a pausa expira sozinha. A condição `pausado_de IS NOT NULL` fazia um hábito que voltou de férias nunca mais materializar — sumia do dashboard no dia seguinte, sem erro em lugar nenhum.
- **Duas escalas de progresso.** `binario` e `negativo` mostram o **período**; `quantificado` e `duracao` mostram a **interação de hoje**. Somar o incremento nas duas linhas de um hábito fixo mostraria 700 ml em cada dose quando foram 700 numa.
- **`novoVencimento` vem preenchido em toda resposta de hábito ancorado**, não só quando a âncora se move. A tela compara com o `periodoAtual.fim` que já tem, senão pede confirmação de uma mudança que não houve — e um aviso que aparece sempre deixa de ser aviso.
- **`web-push` fica no 3.x.** O 4.0 é só-ESM e não publica tipos, enquanto `@types/web-push` descreve o 3.x com default export: a combinação compila e quebra em execução.

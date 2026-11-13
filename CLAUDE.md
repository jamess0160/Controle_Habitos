# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev     # dev server (Turbopack) on http://localhost:3000
npm run build   # production build
npm run start   # serve the production build
npm run lint    # eslint (flat config; takes no args by default)
```

There is no test setup in this repo yet — no test runner, config, or test files. Add one before claiming tests exist.

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

**`APP_MODO` (`desenvolvimento` | `producao`) is the one switch that loosens that gate**, read in `servidor/modo.ts`. In `desenvolvimento` the password stays active alongside the passkey and opens a complete session — the only way into a desktop with no authenticator. It is **not** `NODE_ENV`: validating the PWA on the phone needs a production build over HTTPS while the app is still running on fixtures, so the two must be separable. It fails closed (only the exact word enables the loose mode, read at request time, not inlined at build), the client learns it from `estadoAuth.modoDesenvolvimento` rather than a `NEXT_PUBLIC_*` (one source, no divergence), and the login screen says so in a visible block — the key leaking into the deploy would mean an extra door, permanently.

UI language is pt-BR. The design docs are also in Portuguese, and the domain vocabulary (`habito`, `periodo`, `ocorrencia`, `congelamento`, `cadencia`) is Portuguese in the schema and code.

## Design docs — read before touching domain code

The domain rules are non-trivial and were decided deliberately; [Docs/mapas/](Docs/mapas/) is the source of truth, not the code:

- **[Mapa de regras.md](Docs/mapas/Mapa%20de%20regras.md)** — the one to read first. Logical day boundary (04:00), the cadence + exclusive-mode model that replaced the ambiguous "período externo/interno", period state machine, how the per-habit streak counts, and the freeze mechanic (consumed automatically at period close).
- **[Mapa do banco.md](Docs/mapas/Mapa%20do%20banco.md)** — schema and Knex setup, including the versioned `habito_config` (never updated in place) and the materialized `habito_periodo`.
- **[Mapa de telas.md](Docs/mapas/Mapa%20de%20telas.md)** — screens, flows, per-type interactions, and the wave 1 / wave 2 split.
- **[Mapa de autenticação.md](Docs/mapas/Mapa%20de%20autentica%C3%A7%C3%A3o.md)** — WebAuthn flows, the reset CLI, rate limiting, and the accepted limits.

Each map ends with a "Pendências" section listing what is still undecided — check it before inventing an answer to one of those questions. **[Docs/Roadmap onda 1.md](Docs/Roadmap%20onda%201.md)** has the execution order, per-stage exit criteria, the API route inventory, and the known risks.

Four traps worth stating up front:

- **A timestamp is not a logical day.** `data_logica` subtracts 4h before casting to date, and a retroactive entry's `data_logica` differs from its `criado_em`.
- **Habit configuration is versioned.** Past periods must be evaluated by the rule in force then, never by the current config.
- **`cada_n_dias` is anchored on the last completion**, so its periods cannot be pre-generated, its `fim` is mutable, and a retroactive edit re-chains every later period. The other cadences behave conventionally.
- **Freezes are consumed automatically** when a period closes short of its goal. There is no `em_risco` state and no redemption deadline — the 7-day retroactive window is the only correction path.

Schema is managed with **Knex** (migrations + seeds in `db/`), which is also the likely query layer. In development the Knex instance must be a `globalThis` singleton, or Next's hot reload will open a new pool per recompile and exhaust Postgres connections.

## Current state

Etapa 1 is done. In etapa 2, the palette, the PWA shell, the seven screens and the review of the pendências they opened are done; what remains is validating the installed PWA on the phone, which needs HTTPS on a stable domain (etapa 5's tunnel, or a temporary one).

What exists:

- `db/` — 6 Knex migrations covering the whole schema, the `globalThis` pool singleton, `db/pg-types.ts` (parses Postgres `date` as a raw string so the driver can't shift a logical day), `db/cli.ts` (wraps the Knex API rather than the `knex` binary), `db/mapa-dominio.ts` (the only place the config table's nullables are faced), and a development seed with 6 habits over 30 days.
- `dominio/` — the rule core. `dominio/simulacao.ts` **replays** a habit's whole history from the registros that exist now and returns periods, streak and freeze stock; the tables are the materialization of that result, not its source. Retroactive edits and `cada_n_dias` re-chaining fall out of the replay.
- `contracts/` — Zod schemas for every route, with `cadencia`/`meta` as nested discriminated unions so invalid combinations don't compile, pt-BR error messages (Zod's `pt` locale is European Portuguese), `validar()` for route handlers, `contracts/fixtures.ts`, and `contracts/resumo.ts` — the **single** implementation of the habit's rule as a sentence, used by the form's preview now and by `habito.resumo` on the server in etapa 3.2.
- `app/api/` — 21 route handlers, all **stubs**: real input validation, fixture output. Three of them deliberately don't return a raw fixture, because a canned value would make a screen look broken: `GET /api/auth/estado` computes from the session and the mode, and `POST /api/registros` / `PATCH /api/config` echo the identity of what was sent while keeping the *derived* parts (streak, freeze stock, period status) canned. `servidor/` has the plumbing (`exigirAcesso`, `corpo`, the session cookie, `modo.ts`) and `proxy.ts` the navigation guard. Nothing here touches the database yet, and the session cookie is a stub that believes its own value — etapa 3.1 replaces it.
- `cliente/` — the mirror of `servidor/` on the browser side: `api.ts` (one error shape for every failure, network included, and the 401→`/login` / 409→`/biometria` redirect in one place), `formato.ts` (pt-BR formatting that never parses a logical day through `new Date(string)`), `relogio.ts`, `ambiente.ts`, `webauthn.ts`.
- `componentes/` — the screens, as client components (`tela-*.tsx`), plus the shared pieces: `marca.tsx` (state is form, not colour), `ui.tsx` (touch targets decided in one place), and the two React-free, tested modules where a silent miscalculation would be worst: `rascunho-de-habito.ts` (the draft ⇆ config translation — a lossy round-trip would make editing a habit delete configuration) and `efeitos-de-hoje.ts` (the dashboard's optimistic mark/unmark — a wrong formula shows a streak that diverges from the server with no sign of failure).
- `app/` — eight routes for the seven screens, in two groups: `(app)/` has the bottom bar, `(tela-cheia)/` doesn't (cadastro, edição and retroativo open over the navigation). `/login` and `/biometria` sit outside both. `app/manifest.ts`, `app/tema.ts` and `public/sw.js` are the PWA shell.

Two etapa-2 scaffolds, now gated by `APP_MODO=desenvolvimento` instead of `NODE_ENV`, to delete in etapa 3.1: `/login?simular=…` (three of the four login states can't be reached while the stub can't know whether a passkey exists; simulating forces `senhaAtiva: false`, since the point is to look at the production state) and the "pular a biometria (dev)" button — a separate, visible button rather than a `catch` that fakes success, because the fixtures' WebAuthn challenge is invented and a real `credentials.create()` must fail.

Two more traps the screens found, worth knowing before touching the dashboard:

- **A dashboard line's `concluida` follows a per-type rule**, in `concluidaDe`: `binario` asks whether the interaction has a registro today, `quantificado`/`duracao` compare accumulated against the meta, `negativo` checks the tolerance. Treating the first interaction as completion drew a full disc with 1750 ml still missing.
- **The dashboard's unmark needs the registro's `valor` before deleting**, which is why `linhaDeHoje.ultimoRegistro` carries `{ id, valor }` and not just an id: `DELETE /api/registros/:id` returns only `efeitos`, so the screen could not otherwise know how much to subtract.

Tests run with `npm test` (Jest 30 via `next/jest`). The SWC transform strips types without checking them, so run `npx tsc --noEmit` alongside. Note that `next/jest` loads `.env`, so anything reading `APP_MODO` must pin it in the test rather than inherit the local file — `servidor/rotas.test.ts` does it in a `beforeEach`. `npm run build` is worth running too: `cacheComponents` rejects reading `params` or `useParams` outside `<Suspense>`, and only the build says so.

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

The app itself is still the unmodified `create-next-app` scaffold — `app/page.tsx` is the template landing page and `metadata` in the layout still says "Create Next App". No database, schema, migrations, auth, or domain code exists yet; the maps above describe what is to be built.

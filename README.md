# Controle de Hábitos

Acompanhamento diário de hábitos, sequências e congelamentos. App pessoal de um
usuário só, auto-hospedado: Next.js e Postgres em contêineres no homelab,
alcançáveis por um Cloudflare Tunnel num domínio fixo. Entrada por passkey, um
aparelho. **Não** vai para a Vercel.

Interface, documentação e vocabulário de domínio em pt-BR.

## Documentação

Os mapas são a fonte de verdade do comportamento — não o código.

| Documento | O que tem |
|---|---|
| [Mapa de regras](Docs/mapas/Mapa%20de%20regras.md) | o primeiro a ler: dia lógico das 04:00, cadência, estados de período, sequência, congelamento |
| [Mapa do banco](Docs/mapas/Mapa%20do%20banco.md) | schema, Knex, a `habito_config` versionada, a `habito_periodo` materializada |
| [Mapa de telas](Docs/mapas/Mapa%20de%20telas.md) | as sete telas, fluxos e interações por tipo |
| [Mapa de autenticação](Docs/mapas/Mapa%20de%20autentica%C3%A7%C3%A3o.md) | WebAuthn, CLI de reset, rate limiting |
| [Roadmap onda 1](Docs/Roadmap%20onda%201.md) | ordem de execução, critério de saída de cada etapa, riscos |
| [Roteiro de testes](Docs/Roteiro%20de%20testes.md) | os testes manuais, com a armadilha de cada seção |
| **[Deploy](Docs/Deploy.md)** | **subida do zero no servidor, variáveis, backup e restauração** |

[CLAUDE.md](CLAUDE.md) resume o estado atual e as armadilhas que já morderam.

## Desenvolvimento

```bash
cp .env.example .env     # e ajuste
npm install
npm run db:up            # Postgres de desenvolvimento, em Docker
npm run db:migrate
npm run db:seed          # 6 hábitos cobrindo os 4 tipos, com 30 dias de histórico
npm run dev              # http://localhost:3000
npm run worker           # noutro terminal: o tique de 1 minuto
```

Testes: `npm test` (exige o `db:up` rodando; cada worker do Jest cria e migra o
próprio database). O SWC transforma TypeScript **sem checar tipos**, então
`npx tsc --noEmit` roda ao lado — e `npm run build` também, porque só o build
reclama de `params` lido fora de `<Suspense>`.

A lista completa de scripts está em [CLAUDE.md](CLAUDE.md).

## Produção

```bash
cp .env.producao.example .env     # no servidor
docker compose up -d --build
```

Quatro serviços: `postgres`, `migrate` (de passagem), `app` e `worker`. O túnel
**não** está na pilha — é o cloudflared que já roda no homelab, ligado à rede
`controle-habito-borda`, onde o `app` é o único serviço. Nenhuma porta publicada
no host: o único caminho de entrada é o túnel, e o rate limiting depende disso.
O passo a passo, incluindo a ligação do túnel, o primeiro acesso e o backup
verificado, está em **[Docs/Deploy.md](Docs/Deploy.md)**.

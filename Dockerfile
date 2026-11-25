# syntax=docker/dockerfile:1

###############################################################################
# Imagem do Controle de Hábitos — duas saídas de um arquivo só.
#
# `--target app` é o Next empacotado por `output: "standalone"`: o servidor
# mínimo, sem npm e sem dependência de desenvolvimento dentro.
#
# `--target worker` é a imagem de TypeScript cru, e atende três coisas que não
# passam pelo Next: o tique de um minuto (`worker/index.ts`), as migrations da
# subida (`db/cli.ts`) e as CLIs de reset (`cli/`).
#
# São duas porque as necessidades são opostas. O app quer só o que o
# rastreamento do Next provou necessário; o worker precisa de `node_modules` de
# verdade, porque roda sob `tsx` e resolve os `@/*` do tsconfig em tempo de
# execução. Uma imagem só seria a soma das duas, com o custo da maior.
#
# Por que o worker roda TypeScript em produção: `next build` compila só o grafo
# do app, e `tsc` não reescreve os aliases `@/*` na saída — um `require("@/db/knex")`
# emitido não resolve. Compilar exigiria um segundo bundler para três entradas
# que não são o app. Daí o `tsx` em `dependencies`, e não em devDependencies.
###############################################################################

FROM node:22-alpine AS base
# musl: o `sharp` (otimização de imagem do Next, que o rastreamento traz para o
# standalone) e os binários `@node-rs` esperam encontrar isto.
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# --- dependências ------------------------------------------------------------
# Duas instalações, em camadas que só mudam quando o package-lock muda.

FROM base AS dependencias
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS dependencias-producao
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- build do Next -----------------------------------------------------------

FROM dependencias AS construtor
COPY . .

# `next build` avalia o grafo de cada rota para coletar a configuração dela, e
# nesse grafo está o `knexfile.ts`, que lança quando `DATABASE_URL` falta. Sem
# esta linha o build morre em "Failed to collect page data for /api/auth/logout"
# — verificado, não suposto.
#
# O valor é descartável e não chega à imagem final: o projeto não tem nenhuma
# `NEXT_PUBLIC_*`, então nada de ambiente é inlinado no bundle, e o banco de
# verdade entra por ambiente em tempo de execução. É o que deixa a mesma imagem
# subir em qualquer máquina.
ENV DATABASE_URL=postgres://construcao:construcao@127.0.0.1:5432/construcao
RUN npm run build

# --- imagem do app -----------------------------------------------------------

FROM base AS app
ENV NODE_ENV=production
ENV PORT=3000
# Sem `HOSTNAME` o `server.js` escuta em localhost e o resto do compose não o
# alcança — o contêiner sobe saudável e inacessível.
ENV HOSTNAME=0.0.0.0

# Três cópias, e as duas últimas não são detalhe: o Next deixa `static` e
# `public` fora do standalone de propósito (ele assume um CDN na frente). Sem a
# primeira o app sobe sem CSS; sem a segunda não há `/sw.js`, e sem service
# worker o Android não oferece a instalação da PWA — que é o que o push no
# celular exige.
COPY --from=construtor --chown=node:node /app/.next/standalone ./
COPY --from=construtor --chown=node:node /app/.next/static ./.next/static
COPY --from=construtor --chown=node:node /app/public ./public

# O cache de componentes é escrito em tempo de execução, e o processo não roda
# como root.
RUN mkdir -p .next/cache && chown -R node:node .next

USER node
EXPOSE 3000
CMD ["node", "server.js"]

# --- imagem do worker, das migrations e das CLIs ------------------------------

FROM base AS worker
ENV NODE_ENV=production

COPY --from=dependencias-producao --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json knexfile.ts ./
COPY --chown=node:node db ./db
COPY --chown=node:node dominio ./dominio
COPY --chown=node:node contracts ./contracts
COPY --chown=node:node servidor ./servidor
COPY --chown=node:node worker ./worker
COPY --chown=node:node cli ./cli
COPY --chown=node:node infra/migrar.sh ./infra/migrar.sh

# `tsx` em vez de `npx tsx`: o npx sai para a rede quando não encontra o pacote
# onde espera, e um contêiner que baixa dependência na subida é um contêiner que
# falha quando a rede falha.
ENV PATH=/app/node_modules/.bin:$PATH

USER node
CMD ["tsx", "worker/index.ts"]

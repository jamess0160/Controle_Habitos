import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * Build empacotado para contêiner.
   *
   * `standalone` escreve `.next/standalone/` com o servidor mínimo (`server.js`)
   * e só os arquivos de `node_modules` que o rastreamento provou necessários —
   * é o que deixa a imagem do app sem `npm install` e sem as dependências de
   * desenvolvimento. `public/` e `.next/static` **não** vão junto por decisão do
   * Next (ele assume CDN); o [Dockerfile](Dockerfile) os copia à mão, senão o app
   * sobe sem CSS e sem o service worker — e sem service worker a PWA não instala.
   *
   * O rastreamento não alcança o `require` dinâmico do Knex (a mesma causa do
   * `serverExternalPackages` abaixo), então o dialeto `pg` entra por
   * `outputFileTracingIncludes`.
   */
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/knex/**/*", "./node_modules/pg/**/*"],
  },
  cacheComponents: true,
  partialPrefetching: true,
  /*
   * O Knex fica fora do bundle.
   *
   * Ele resolve o dialeto em tempo de execução com um `require` dinâmico sobre o
   * nome do cliente, então o bundler tenta resolver **todos** — `sqlite3`,
   * `mysql2`, `oracledb`, `tedious` — e o build falha com oito módulos não
   * encontrados. Não é um aviso: a 3.1 foi a primeira etapa a importar o Knex num
   * route handler, e foi onde isto apareceu.
   *
   * `pg` e `@node-rs/argon2` já estão na lista que o Next externaliza sozinho
   * (são nativos), então só o Knex precisa ser declarado.
   */
  serverExternalPackages: ["knex"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

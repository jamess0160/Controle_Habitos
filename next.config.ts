import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
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

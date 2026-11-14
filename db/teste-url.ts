import "dotenv/config";

/**
 * A URL do database de teste — e **só** isso.
 *
 * Separado de [teste.ts](teste.ts) porque `jest.setup.ts` precisa deste cálculo
 * antes de qualquer módulo carregar, e `teste.ts` arrasta o driver do Postgres
 * junto. Nos testes de componente, que rodam em `jsdom`, importar `pg` quebra na
 * hora: ele usa `TextEncoder`, que o jsdom não define. Uma tela não tem nada que
 * ver com o driver do banco, e agora não o carrega.
 */

/** Nome base do database de teste, sem o sufixo do worker. */
function urlBase(): URL {
  const explicita = process.env.DATABASE_URL_TEST;
  const base = explicita !== undefined && explicita.trim() !== "" ? explicita : process.env.DATABASE_URL;

  if (base === undefined || base.trim() === "") {
    throw new Error(
      "DATABASE_URL não definida. Copie .env.example para .env antes de rodar os testes.",
    );
  }

  const url = new URL(base);
  if (explicita === undefined || explicita.trim() === "") {
    url.pathname = `${url.pathname.replace(/^\//, "")}_test`;
  }
  return url;
}

/**
 * A URL do database **deste** worker.
 *
 * `JEST_WORKER_ID` existe em cada processo de worker e vale 1 no modo serial
 * (`--runInBand`), então a conta é a mesma nos dois casos.
 */
export function urlDeTeste(worker = process.env.JEST_WORKER_ID ?? "1"): string {
  const url = urlBase();
  url.pathname = `${url.pathname.replace(/^\//, "")}_${worker}`;
  return url.toString();
}

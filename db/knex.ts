import knexLib, { type Knex } from "knex";
import config from "../knexfile";
// Registra os tipos das linhas no módulo do Knex (declare module em db/tipos.ts).
import "./tipos";

declare global {
  var __habitoKnex: Knex | undefined;
}

/**
 * Instância única por processo.
 *
 * O hot reload do Next reavalia módulos a cada recompilação. Sem o cache em
 * `globalThis`, cada recarga abriria uma pool nova e as conexões do Postgres
 * acabariam em poucos minutos de desenvolvimento.
 */
export const db: Knex = globalThis.__habitoKnex ?? knexLib(config);

if (process.env.NODE_ENV !== "production") {
  globalThis.__habitoKnex = db;
}

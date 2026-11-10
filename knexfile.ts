import "dotenv/config";
import type { Knex } from "knex";
import { aplicarParsersPg } from "./db/pg-types";

aplicarParsersPg();

const connection = process.env.DATABASE_URL;

if (!connection) {
  throw new Error(
    "DATABASE_URL não definida. Copie .env.example para .env antes de rodar os comandos de banco.",
  );
}

const config: Knex.Config = {
  client: "pg",
  connection,
  pool: { min: 0, max: 10 },
  migrations: {
    directory: "./db/migrations",
    extension: "ts",
    loadExtensions: [".ts"],
    tableName: "knex_migrations",
  },
  seeds: {
    directory: "./db/seeds",
    extension: "ts",
    loadExtensions: [".ts"],
  },
};

export default config;

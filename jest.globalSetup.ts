import type { Config } from "@jest/types";
import { loadEnvConfig } from "@next/env";
import { prepararBancosDeTeste } from "./db/teste";

/**
 * Roda uma vez antes da suíte: garante o database de teste criado e migrado.
 *
 * `loadEnvConfig` à mão porque `globalSetup` roda **fora** do ambiente que o
 * `next/jest` monta — ele não vê o `.env` sem isto, e a primeira coisa que falta
 * é justamente `DATABASE_URL`.
 *
 * Criar e migrar aqui, e não num script separado do `package.json`, tira do
 * caminho um passo que se esquece: `npm test` num repositório recém-clonado
 * funciona desde que o `db:up` esteja de pé.
 *
 * É **um database por worker**, e é por isso que o `globalConfig` importa: este é
 * o único lugar que sabe quantos workers o Jest vai abrir. Ver a nota em
 * [db/teste.ts](db/teste.ts) sobre por que compartilhar um database entre
 * workers não funciona.
 */
export default async function setup(config: Config.GlobalConfig): Promise<void> {
  loadEnvConfig(process.cwd());
  await prepararBancosDeTeste(config.maxWorkers);
}

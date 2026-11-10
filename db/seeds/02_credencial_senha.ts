import "dotenv/config";
import { hash } from "@node-rs/argon2";
import type { Knex } from "knex";

/** Parâmetros Argon2id alinhados à recomendação da OWASP (m=19 MiB, t=2, p=1). */
export const PARAMETROS_ARGON2 = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Semeia a senha do primeiro acesso a partir de APP_SENHA_INICIAL.
 *
 * Nunca sobrescreve uma credencial existente: depois do cadastro da biometria a
 * senha fica desativada, e re-semear reativaria o único caminho de entrada que o
 * app desliga de propósito.
 */
export async function seed(knex: Knex): Promise<void> {
  const existente = await knex("credencial_senha").first("id", "ativa");

  if (existente) {
    console.log(`  credencial_senha: já existe (ativa=${existente.ativa}), mantida`);
    return;
  }

  const senha = process.env.APP_SENHA_INICIAL;

  if (!senha || senha.trim() === "") {
    throw new Error("APP_SENHA_INICIAL não definida — necessária para semear a senha do primeiro acesso.");
  }

  await knex("credencial_senha").insert({
    hash: await hash(senha, PARAMETROS_ARGON2),
    ativa: true,
  });

  console.log("  credencial_senha: senha do primeiro acesso semeada");
}

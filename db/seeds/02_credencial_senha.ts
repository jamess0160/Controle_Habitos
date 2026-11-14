import "dotenv/config";
import type { Knex } from "knex";
/*
 * Os parâmetros do Argon2id vêm de `servidor/senha.ts`, e não de uma cópia aqui:
 * semear com parâmetros diferentes dos que a rota de login usa para conferir é a
 * forma mais silenciosa de quebrar a autenticação. Aquele módulo não importa
 * Next nem banco, exatamente para poder ser usado daqui.
 */
import { gerarHash } from "../../servidor/senha";

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
    hash: await gerarHash(senha),
    ativa: true,
  });

  console.log("  credencial_senha: senha do primeiro acesso semeada");
}

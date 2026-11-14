import type { Knex } from "knex";
import { db } from "@/db/knex";
import { gerarHash, senhaProvisoria } from "./senha";

/**
 * `credencial_senha`: leitura, desativação e reset.
 *
 * Separado de [senha.ts](senha.ts) de propósito — aquele arquivo não conhece
 * banco, porque o seed do Knex e a CLI de reset importam a função de hash sem
 * querer arrastar a pool de conexões junto. Aqui é o lado que escreve.
 */

export type EstadoDaSenha = { existe: boolean; ativa: boolean };

export async function estadoDaSenha(conexao: Knex = db): Promise<EstadoDaSenha> {
  const linha = await conexao("credencial_senha").first("ativa");
  return { existe: linha !== undefined, ativa: linha?.ativa ?? false };
}

export async function hashDaSenhaAtiva(conexao: Knex = db): Promise<string | null> {
  const linha = await conexao("credencial_senha").where({ ativa: true }).first("hash");
  return linha?.hash ?? null;
}

/**
 * Desativa a senha. É o que o cadastro da passkey faz, e o ponto exato em que a
 * porta única fecha.
 *
 * O `CHECK` da tabela exige que `desativada_em` seja preenchida junto com
 * `ativa = false` — é a restrição que impede uma linha dizendo "inativa desde
 * nunca". Por isso as duas colunas andam no mesmo `update`.
 */
export async function desativarSenha(conexao: Knex = db): Promise<void> {
  await conexao("credencial_senha")
    .where({ ativa: true })
    .update({ ativa: false, desativada_em: new Date(), atualizada_em: new Date() });
}

/**
 * Define uma senha provisória aleatória e a reativa. Devolve a senha em claro —
 * a **única** vez em que ela existe fora de um hash.
 *
 * Recebe a conexão por parâmetro para a CLI poder rodar isto dentro da mesma
 * transação em que apaga as passkeys e revoga as sessões: o reset é tudo ou
 * nada, e um reset parcial deixaria o app sem nenhuma porta.
 */
export async function definirSenhaProvisoria(conexao: Knex = db): Promise<string> {
  const senha = senhaProvisoria();
  const hash = await gerarHash(senha);

  const atualizadas = await conexao("credencial_senha").update({
    hash,
    ativa: true,
    desativada_em: null,
    atualizada_em: new Date(),
  });

  /* Primeiro acesso sem seed, ou banco recém-criado: não havia linha para atualizar. */
  if (atualizadas === 0) {
    await conexao("credencial_senha").insert({ hash, ativa: true });
  }

  return senha;
}

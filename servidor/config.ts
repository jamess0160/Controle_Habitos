import { db } from "@/db/knex";

/**
 * `config_app`: a configuração global, em chave/valor.
 *
 * Tabela e não arquivo porque parte dela é editável pela tela de Ajustes
 * (`hora_virada`, `timezone`) e parte é **trava**: `rp_id` é o domínio das
 * passkeys, e o app precisa comparar o domínio de onde a requisição veio com o
 * que estava valendo quando a biometria foi cadastrada. Essa comparação exige um
 * valor persistido — uma variável de ambiente mudaria junto com o deploy e a
 * trava nunca dispararia.
 */

export const CHAVES_DE_CONFIG = [
  "usuario_nome",
  "hora_virada",
  "timezone",
  "semana_inicia_em",
  "rp_id",
  "rp_name",
  "vapid_public_key",
  "vapid_private_key",
  "vapid_subject",
] as const;

export type ChaveDeConfig = (typeof CHAVES_DE_CONFIG)[number];

/**
 * O que vale quando a linha não existe.
 *
 * `rp_id` e `rp_name` caem no ambiente, e só no primeiro acesso: o seed grava os
 * dois com `ON CONFLICT DO NOTHING`, então a partir daí o banco manda. É o
 * comportamento certo para a trava — antes de existir passkey não há nada a
 * travar, e depois de existir o valor gravado é o único que importa.
 */
function padraoDe(chave: ChaveDeConfig): string | null {
  switch (chave) {
    case "hora_virada":
      return "04:00";
    case "timezone":
      return "America/Sao_Paulo";
    case "semana_inicia_em":
      return "domingo";
    case "usuario_nome":
      return process.env.APP_USUARIO_NOME ?? "você";
    case "rp_id":
      return process.env.RP_ID ?? null;
    case "rp_name":
      return process.env.RP_NAME ?? "Controle de Hábitos";
    default:
      return null;
  }
}

export type Config = Record<ChaveDeConfig, string | null>;

/** Lê a configuração inteira numa consulta — são nove linhas, não vale paginar. */
export async function lerConfig(): Promise<Config> {
  const linhas = await db("config_app").select("chave", "valor");
  const gravado = new Map(linhas.map((l) => [l.chave, l.valor]));

  return Object.fromEntries(
    CHAVES_DE_CONFIG.map((chave) => [chave, gravado.get(chave) ?? padraoDe(chave)]),
  ) as Config;
}

export async function valorDeConfig(chave: ChaveDeConfig): Promise<string | null> {
  const linha = await db("config_app").where({ chave }).first("valor");
  return linha?.valor ?? padraoDe(chave);
}

/**
 * Grava chaves de configuração.
 *
 * `merge` e não `ignore`: aqui o chamador está mudando a configuração de
 * propósito, ao contrário do seed, que estabelece valores iniciais e nunca
 * sobrescreve.
 */
export async function gravarConfig(valores: Partial<Record<ChaveDeConfig, string>>): Promise<void> {
  const linhas = Object.entries(valores)
    .filter(([, valor]) => valor !== undefined)
    .map(([chave, valor]) => ({ chave, valor: valor as string, atualizada_em: new Date() }));

  if (linhas.length === 0) return;

  await db("config_app").insert(linhas).onConflict("chave").merge();
}

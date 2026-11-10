import "dotenv/config";
import type { Knex } from "knex";

/**
 * Semeia a configuração global. Usa ON CONFLICT DO NOTHING de propósito: o seed
 * estabelece os valores iniciais e nunca sobrescreve o que já está no banco.
 *
 * Isso importa principalmente para `rp_id`, que é o domínio das passkeys — se um
 * seed acidental trocasse esse valor, a biometria cadastrada seria invalidada sem
 * aviso. Mudança de configuração é feita pela tela de Ajustes, não por re-seed.
 */
export async function seed(knex: Knex): Promise<void> {
  const valores: Record<string, string | undefined> = {
    usuario_nome: process.env.APP_USUARIO_NOME,
    hora_virada: "04:00",
    timezone: "America/Sao_Paulo",
    semana_inicia_em: "domingo",
    rp_id: process.env.RP_ID,
    rp_name: process.env.RP_NAME,
    vapid_public_key: process.env.VAPID_PUBLIC_KEY,
    vapid_private_key: process.env.VAPID_PRIVATE_KEY,
    vapid_subject: process.env.VAPID_SUBJECT,
  };

  const linhas = Object.entries(valores)
    .filter(([, valor]) => valor !== undefined && valor.trim() !== "")
    .map(([chave, valor]) => ({ chave, valor: valor as string }));

  if (linhas.length === 0) return;

  await knex("config_app").insert(linhas).onConflict("chave").ignore();

  const faltando = Object.entries(valores)
    .filter(([, valor]) => valor === undefined || valor.trim() === "")
    .map(([chave]) => chave);

  if (faltando.length > 0) {
    console.log(`  config_app: sem valor ainda (preencher depois): ${faltando.join(", ")}`);
  }
}

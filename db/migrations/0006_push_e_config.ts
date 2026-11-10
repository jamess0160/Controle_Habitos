import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE push_subscription (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      endpoint    text NOT NULL UNIQUE,
      p256dh      text NOT NULL,
      auth        text NOT NULL,
      criada_em   timestamptz NOT NULL DEFAULT now(),
      invalida_em timestamptz
    )
  `);
  await knex.raw(`
    COMMENT ON COLUMN push_subscription.invalida_em IS
      'Marcada quando o push service responde 404/410. Assinatura morta não é apagada na hora para dar rastro.'
  `);

  await knex.raw(`
    CREATE TABLE notificacao_enviada (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tipo          text NOT NULL,
      referencia_id uuid NOT NULL,
      enviada_em    timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT notificacao_enviada_tipo CHECK (
        tipo IN ('lembrete', 'meta_atraso', 'congelamento_usado', 'sequencia_perdida')
      ),
      CONSTRAINT notificacao_enviada_unica UNIQUE (tipo, referencia_id)
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE notificacao_enviada IS
      'Guarda de idempotência: o worker roda a cada minuto e não pode notificar o mesmo evento duas vezes.'
  `);

  await knex.raw(`
    CREATE TABLE config_app (
      chave         text PRIMARY KEY,
      valor         text NOT NULL,
      atualizada_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE config_app IS
      'Configuração global chave/valor. rp_id é trava de segurança: se o domínio mudar, o app detecta e explica que as passkeys foram invalidadas.'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP TABLE IF EXISTS config_app`);
  await knex.raw(`DROP TABLE IF EXISTS notificacao_enviada`);
  await knex.raw(`DROP TABLE IF EXISTS push_subscription`);
}

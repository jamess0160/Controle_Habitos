import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE congelamento (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      habito_id             uuid NOT NULL REFERENCES habito (id) ON DELETE CASCADE,
      status                congelamento_status NOT NULL DEFAULT 'disponivel',
      ganho_em              timestamptz NOT NULL DEFAULT now(),
      ganho_por_periodo_id  uuid NOT NULL REFERENCES habito_periodo (id) ON DELETE CASCADE,
      consumido_em          timestamptz,
      consumido_periodo_id  uuid REFERENCES habito_periodo (id) ON DELETE CASCADE,
      estornado_em          timestamptz,

      CONSTRAINT congelamento_consumo CHECK (
        (status = 'consumido') = (consumido_em IS NOT NULL AND consumido_periodo_id IS NOT NULL)
      )
    )
  `);

  await knex.raw(`
    COMMENT ON TABLE congelamento IS
      'Estoque unitário: uma linha por congelamento, não um contador. Consumo automático e FIFO por ganho_em.'
  `);

  await knex.raw(`
    CREATE INDEX congelamento_estoque_idx
      ON congelamento (habito_id, ganho_em) WHERE status = 'disponivel'
  `);

  await knex.raw(`
    CREATE TABLE habito_streak (
      habito_id         uuid PRIMARY KEY REFERENCES habito (id) ON DELETE CASCADE,
      sequencia_atual   integer NOT NULL DEFAULT 0,
      sequencia_recorde integer NOT NULL DEFAULT 0,
      total_no_prazo    integer NOT NULL DEFAULT 0,
      desde             date,
      atualizado_em     timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT habito_streak_nao_negativo CHECK (
        sequencia_atual >= 0 AND sequencia_recorde >= 0 AND total_no_prazo >= 0
      ),
      CONSTRAINT habito_streak_recorde CHECK (sequencia_recorde >= sequencia_atual)
    )
  `);

  await knex.raw(`
    COMMENT ON TABLE habito_streak IS
      'Resumo materializado, sempre recalculável a partir de habito_periodo. Existe para o dashboard não varrer histórico.'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP TABLE IF EXISTS habito_streak`);
  await knex.raw(`DROP TABLE IF EXISTS congelamento`);
}

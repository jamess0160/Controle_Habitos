import type { Knex } from "knex";

/**
 * `habito_config.meta_minutos` (minutos) → `meta_segundos` (segundos).
 *
 * A meta de duração era um inteiro de minutos, então a meta mais curta
 * expressável era 1 min: "respirar 30 s" e "prancha de 45 s" simplesmente não
 * eram configuráveis, e o cronômetro arredondava a sessão para o minuto mais
 * próximo com piso de 1 — uma sessão de 40 s era gravada como 1 min, e uma de
 * 1 min 30 s como 2 min.
 *
 * A saída aparentemente menor seria trocar o tipo para `numeric` e aceitar
 * minuto fracionário. Ela está errada por aritmética, não por gosto: a meta é
 * cumprida por **soma de registros** (`dominio/meta.ts`), 20 s viraria
 * `0.3333…`, e três sessões de 20 s somariam `0.99999…` contra uma meta de
 * 1 min — o período fecharia **perdido** com o tempo cumprido. Em segundo
 * inteiro a soma é exata.
 *
 * `registro.valor` carrega a duração nos hábitos de duração, então ele é
 * convertido junto. A coluna é `numeric` e continua sendo: o tipo `quantificado`
 * usa a mesma coluna para litros e km, onde a fração é legítima.
 *
 * O `down` divide de volta e **arredonda para cima**: metas e registros de menos
 * de um minuto não existem na escala antiga, e truncar transformaria uma meta de
 * 30 s em `0`, que o CHECK recusaria. A volta é lossy por construção — era o
 * motivo de a ida existir.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE habito_config DROP CONSTRAINT habito_config_meta_duracao
  `);
  await knex.raw(`
    ALTER TABLE habito_config RENAME COLUMN meta_minutos TO meta_segundos
  `);
  await knex.raw(`
    UPDATE habito_config SET meta_segundos = meta_segundos * 60 WHERE tipo = 'duracao'
  `);
  await knex.raw(`
    ALTER TABLE habito_config
      ADD CONSTRAINT habito_config_meta_duracao CHECK (
        (tipo = 'duracao' AND meta_segundos IS NOT NULL AND meta_segundos > 0)
        OR (tipo <> 'duracao' AND meta_segundos IS NULL)
      )
  `);
  await knex.raw(`
    COMMENT ON COLUMN habito_config.meta_segundos IS
      'Meta do tipo duracao, em segundos inteiros. Minuto fracionário não serve: a meta é soma de registros e 3 × 20 s daria 0.99999 min.'
  `);

  /*
   * `registro` não guarda `habito_id` — ele aponta para o período, que aponta
   * para o hábito. É um join e não uma coluna porque o dono do registro é o
   * período: ver `Mapa do banco.md`.
   */
  await knex.raw(`
    UPDATE registro r SET valor = r.valor * 60
      FROM habito_periodo p
      JOIN habito h ON h.id = p.habito_id
      WHERE r.periodo_id = p.id AND h.tipo = 'duracao'
  `);
  await knex.raw(`
    COMMENT ON COLUMN registro.valor IS
      'Quantidade no quantificado, segundos na duração, 1 no binário e no negativo.'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    UPDATE registro r SET valor = ceil(r.valor / 60.0)
      FROM habito_periodo p
      JOIN habito h ON h.id = p.habito_id
      WHERE r.periodo_id = p.id AND h.tipo = 'duracao'
  `);

  await knex.raw(`
    ALTER TABLE habito_config DROP CONSTRAINT habito_config_meta_duracao
  `);
  await knex.raw(`
    UPDATE habito_config SET meta_segundos = ceil(meta_segundos / 60.0) WHERE tipo = 'duracao'
  `);
  await knex.raw(`
    ALTER TABLE habito_config RENAME COLUMN meta_segundos TO meta_minutos
  `);
  await knex.raw(`
    ALTER TABLE habito_config
      ADD CONSTRAINT habito_config_meta_duracao CHECK (
        (tipo = 'duracao' AND meta_minutos IS NOT NULL AND meta_minutos > 0)
        OR (tipo <> 'duracao' AND meta_minutos IS NULL)
      )
  `);
}

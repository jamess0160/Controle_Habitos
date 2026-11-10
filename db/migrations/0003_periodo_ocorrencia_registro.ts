import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE habito_periodo (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      habito_id        uuid NOT NULL REFERENCES habito (id) ON DELETE CASCADE,
      config_id        uuid NOT NULL REFERENCES habito_config (id) ON DELETE CASCADE,
      inicio           date NOT NULL,
      fim              date NOT NULL,
      meta_ocorrencias integer NOT NULL,
      concluidas       integer NOT NULL DEFAULT 0,
      status           periodo_status NOT NULL DEFAULT 'aberto',
      fechado_em       timestamptz,
      criado_em        timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT habito_periodo_janela CHECK (fim >= inicio),
      CONSTRAINT habito_periodo_meta CHECK (meta_ocorrencias >= 1),
      CONSTRAINT habito_periodo_concluidas CHECK (concluidas >= 0),
      CONSTRAINT habito_periodo_fechamento CHECK ((status = 'aberto') = (fechado_em IS NULL))
    )
  `);

  await knex.raw(`
    COMMENT ON COLUMN habito_periodo.fim IS
      'Mutável em cadência cada_n_dias: concluir a meta encerra o período naquela data.'
  `);
  await knex.raw(`
    COMMENT ON COLUMN habito_periodo.meta_ocorrencias IS
      'Snapshot da meta vigente. Nunca ler da config em runtime — a regra é versionada.'
  `);

  await knex.raw(`CREATE UNIQUE INDEX habito_periodo_inicio_unico ON habito_periodo (habito_id, inicio)`);
  await knex.raw(`CREATE INDEX habito_periodo_fechamento_idx ON habito_periodo (status, fim)`);
  await knex.raw(`CREATE INDEX habito_periodo_historico_idx ON habito_periodo (habito_id, fim DESC)`);

  // Os períodos são gerados sob demanda, nunca com antecedência: cada_n_dias não
  // permite (o próximo início depende da conclusão do atual) e, uniformizando,
  // ganhamos este invariante — que também evita período futuro nascer preso a uma
  // versão de config que você ainda vai editar.
  await knex.raw(`
    CREATE UNIQUE INDEX habito_periodo_aberto_unico
      ON habito_periodo (habito_id) WHERE status = 'aberto'
  `);

  await knex.raw(`
    CREATE TABLE habito_ocorrencia (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      periodo_id    uuid NOT NULL REFERENCES habito_periodo (id) ON DELETE CASCADE,
      previsto_para timestamptz NOT NULL,
      status        ocorrencia_status NOT NULL DEFAULT 'pendente',
      cumprida_em   timestamptz,

      CONSTRAINT habito_ocorrencia_cumprimento CHECK ((status = 'cumprida') = (cumprida_em IS NOT NULL))
    )
  `);

  await knex.raw(`
    COMMENT ON TABLE habito_ocorrencia IS
      'Unidade marcável do modo fixo. No modo flexível a tabela fica vazia e o registro aponta só para o período.'
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX habito_ocorrencia_prevista_unica
      ON habito_ocorrencia (periodo_id, previsto_para)
  `);
  await knex.raw(`CREATE INDEX habito_ocorrencia_lembrete_idx ON habito_ocorrencia (status, previsto_para)`);

  await knex.raw(`
    CREATE TABLE registro (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      periodo_id    uuid NOT NULL REFERENCES habito_periodo (id) ON DELETE CASCADE,
      ocorrencia_id uuid REFERENCES habito_ocorrencia (id) ON DELETE CASCADE,
      data_logica   date NOT NULL,
      valor         numeric NOT NULL DEFAULT 1,
      origem        registro_origem NOT NULL,
      criado_em     timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT registro_valor CHECK (valor > 0)
    )
  `);

  await knex.raw(`
    COMMENT ON COLUMN registro.data_logica IS
      'Dia a que o registro pertence, já com a virada das 04:00 aplicada. Difere de criado_em::date em registro retroativo e de madrugada.'
  `);

  await knex.raw(`CREATE INDEX registro_periodo_idx ON registro (periodo_id)`);
  await knex.raw(`CREATE INDEX registro_data_idx ON registro (data_logica)`);
  await knex.raw(`
    CREATE INDEX registro_ocorrencia_idx ON registro (ocorrencia_id) WHERE ocorrencia_id IS NOT NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP TABLE IF EXISTS registro`);
  await knex.raw(`DROP TABLE IF EXISTS habito_ocorrencia`);
  await knex.raw(`DROP TABLE IF EXISTS habito_periodo`);
}

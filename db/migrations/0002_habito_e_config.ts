import type { Knex } from "knex";

/** 1..31, escrito à mão porque CHECK não aceita subconsulta (generate_series). */
const DIAS_DO_MES = Array.from({ length: 31 }, (_, i) => i + 1).join(", ");

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE habito (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      nome         text NOT NULL,
      cor          text NOT NULL,
      tipo         habito_tipo NOT NULL,
      inicio_em    date NOT NULL,
      ordem        integer NOT NULL,
      pausado_de   date,
      pausado_ate  date,
      arquivado_em timestamptz,
      criado_em    timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT habito_nome_nao_vazio CHECK (btrim(nome) <> ''),
      CONSTRAINT habito_pausa_coerente CHECK (pausado_ate IS NULL OR pausado_de IS NOT NULL),
      CONSTRAINT habito_pausa_ordenada CHECK (pausado_ate IS NULL OR pausado_ate >= pausado_de),

      -- Existe para permitir a FK composta de habito_config. Sem ela não há como
      -- validar os campos de meta contra o tipo do hábito dentro do banco, porque
      -- CHECK não pode referenciar outra tabela.
      CONSTRAINT habito_id_tipo_unico UNIQUE (id, tipo)
    )
  `);

  await knex.raw(`
    COMMENT ON COLUMN habito.nome IS
      'O emoji de sinalização faz parte do nome (ex.: "💧 Água"). Não há campo de ícone.'
  `);

  await knex.raw(`CREATE INDEX habito_ordem_idx ON habito (ordem) WHERE arquivado_em IS NULL`);

  await knex.raw(`
    CREATE TABLE habito_config (
      id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      habito_id           uuid NOT NULL,
      tipo                habito_tipo NOT NULL,
      versao              integer NOT NULL,
      vigente_de          date NOT NULL,
      vigente_ate         date,

      cadencia            cadencia_tipo NOT NULL,
      cadencia_intervalo  integer,
      modo                modo_tipo NOT NULL,
      meta_ocorrencias    integer,
      dias_semana         integer[],
      dias_mes            integer[],
      horarios            time[],
      notificar_em        time,

      meta_valor          numeric,
      unidade             text,
      meta_minutos        integer,
      tolerancia_recaidas integer,

      congelamento_ativo  boolean NOT NULL,
      congelamento_a_cada integer,
      congelamento_max    integer,

      criado_em           timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT habito_config_habito_fk
        FOREIGN KEY (habito_id, tipo) REFERENCES habito (id, tipo)
        ON UPDATE CASCADE ON DELETE CASCADE,

      CONSTRAINT habito_config_versao CHECK (versao >= 1),
      CONSTRAINT habito_config_vigencia CHECK (vigente_ate IS NULL OR vigente_ate >= vigente_de),

      -- Modo flexível: meta por período, sem momentos determinados.
      CONSTRAINT habito_config_modo_flexivel CHECK (
        modo <> 'flexivel' OR (
          meta_ocorrencias IS NOT NULL AND meta_ocorrencias >= 1
          AND dias_semana IS NULL AND dias_mes IS NULL AND horarios IS NULL
        )
      ),

      -- Modo fixo: momentos determinados, sem meta por soma.
      CONSTRAINT habito_config_modo_fixo CHECK (
        modo <> 'fixo' OR (
          meta_ocorrencias IS NULL
          AND (dias_semana IS NOT NULL OR dias_mes IS NOT NULL OR horarios IS NOT NULL)
        )
      ),

      -- cada_n_dias tem a janela ancorada na última conclusão, então ela anda no
      -- calendário e momentos fixos dentro dela não descrevem nada: só modo flexível.
      CONSTRAINT habito_config_cada_n_dias CHECK (
        (cadencia = 'cada_n_dias' AND cadencia_intervalo >= 2 AND modo = 'flexivel')
        OR (cadencia <> 'cada_n_dias' AND cadencia_intervalo IS NULL)
      ),

      CONSTRAINT habito_config_dias_semana_cadencia CHECK (dias_semana IS NULL OR cadencia = 'semanal'),
      CONSTRAINT habito_config_dias_mes_cadencia CHECK (dias_mes IS NULL OR cadencia = 'mensal'),

      -- 1 = domingo … 7 = sábado. COALESCE porque array_length de '{}' é NULL,
      -- e CHECK com resultado NULL passa.
      CONSTRAINT habito_config_dias_semana_dominio CHECK (
        dias_semana IS NULL OR (
          COALESCE(array_length(dias_semana, 1), 0) >= 1
          AND dias_semana <@ ARRAY[1, 2, 3, 4, 5, 6, 7]
        )
      ),
      CONSTRAINT habito_config_dias_mes_dominio CHECK (
        dias_mes IS NULL OR (
          COALESCE(array_length(dias_mes, 1), 0) >= 1
          AND dias_mes <@ ARRAY[${DIAS_DO_MES}]
        )
      ),
      CONSTRAINT habito_config_horarios_dominio CHECK (
        horarios IS NULL OR COALESCE(array_length(horarios, 1), 0) >= 1
      ),
      CONSTRAINT habito_config_notificar_em_modo CHECK (notificar_em IS NULL OR modo = 'flexivel'),

      -- Campos de meta coerentes com o tipo do hábito.
      CONSTRAINT habito_config_meta_quantificado CHECK (
        (tipo = 'quantificado' AND meta_valor IS NOT NULL AND meta_valor > 0
          AND unidade IS NOT NULL AND btrim(unidade) <> '')
        OR (tipo <> 'quantificado' AND meta_valor IS NULL AND unidade IS NULL)
      ),
      CONSTRAINT habito_config_meta_duracao CHECK (
        (tipo = 'duracao' AND meta_minutos IS NOT NULL AND meta_minutos > 0)
        OR (tipo <> 'duracao' AND meta_minutos IS NULL)
      ),
      CONSTRAINT habito_config_meta_negativo CHECK (
        (tipo = 'negativo' AND tolerancia_recaidas IS NOT NULL AND tolerancia_recaidas >= 0)
        OR (tipo <> 'negativo' AND tolerancia_recaidas IS NULL)
      ),

      CONSTRAINT habito_config_congelamento CHECK (
        (congelamento_ativo AND congelamento_a_cada >= 1 AND congelamento_max >= 1)
        OR (NOT congelamento_ativo AND congelamento_a_cada IS NULL AND congelamento_max IS NULL)
      )
    )
  `);

  await knex.raw(`
    COMMENT ON TABLE habito_config IS
      'Versionada: nunca sofre UPDATE. Editar um hábito fecha vigente_ate e insere nova versão.'
  `);

  await knex.raw(`CREATE UNIQUE INDEX habito_config_versao_unica ON habito_config (habito_id, versao)`);
  await knex.raw(`
    CREATE UNIQUE INDEX habito_config_vigente_unica
      ON habito_config (habito_id) WHERE vigente_ate IS NULL
  `);
  await knex.raw(`CREATE INDEX habito_config_vigencia_idx ON habito_config (habito_id, vigente_de)`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP TABLE IF EXISTS habito_config`);
  await knex.raw(`DROP TABLE IF EXISTS habito`);
}

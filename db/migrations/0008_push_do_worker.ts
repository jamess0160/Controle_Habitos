import type { Knex } from "knex";

/**
 * Dois ajustes que a escrita do worker (etapa 3.5) exigiu.
 *
 * ## `push_subscription.ultimo_envio_em`
 *
 * O contrato de `statusPush` promete "última vez que o endpoint aceitou um
 * envio" desde a etapa 1, e a tela de Ajustes mostra isso — mas a coluna não
 * existia. É o único sinal de que o push está realmente funcionando: a
 * assinatura pode estar gravada, válida e mesmo assim nunca ter entregue nada.
 *
 * ## `notificacao_enviada.referencia_id` (uuid) → `referencia` (text)
 *
 * A guarda de idempotência apontava para a **linha** do evento — a ocorrência, o
 * período. Isso não sobrevive à materialização: o replay apaga e recria
 * `habito_periodo` e `habito_ocorrencia` com ids novos a cada escrita, então o
 * lembrete das 08:00 já enviado deixaria de ser reconhecido no minuto seguinte a
 * qualquer marcação, e o worker notificaria de novo. A cada minuto.
 *
 * A chave passa a descrever o **evento**, não a linha: `<habito>|<dia>|<momento>`
 * em texto. É estável por construção, porque o dia lógico e o horário não mudam
 * quando a materialização refaz as tabelas.
 *
 * Texto em vez de um uuid determinístico (v5 sobre os mesmos campos) porque a
 * pergunta que se faz a esta tabela é sempre "por que não notificou?", e um
 * `SELECT` legível responde; um hash obriga a reproduzir a derivação para
 * descobrir a qual evento a linha se referia.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE push_subscription ADD COLUMN ultimo_envio_em timestamptz`);
  await knex.raw(`
    COMMENT ON COLUMN push_subscription.ultimo_envio_em IS
      'Último envio aceito pelo push service. Nulo com assinatura válida = nunca entregou nada.'
  `);

  /*
   * A tabela nunca teve escrita — o worker que a usaria é desta etapa —, então
   * trocar o tipo não precisa converter dado. O TRUNCATE é por garantia: um uuid
   * aproveitado como texto seria uma chave que não corresponde a evento nenhum.
   */
  await knex.raw(`TRUNCATE notificacao_enviada`);
  await knex.raw(`ALTER TABLE notificacao_enviada DROP COLUMN referencia_id`);
  await knex.raw(`ALTER TABLE notificacao_enviada ADD COLUMN referencia text NOT NULL`);
  await knex.raw(`
    ALTER TABLE notificacao_enviada
      ADD CONSTRAINT notificacao_enviada_unica UNIQUE (tipo, referencia)
  `);

  await knex.raw(`
    COMMENT ON COLUMN notificacao_enviada.referencia IS
      'Identidade do EVENTO (habito|dia|momento), não da linha: períodos e ocorrências trocam de id a cada materialização.'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE push_subscription DROP COLUMN ultimo_envio_em`);

  await knex.raw(`TRUNCATE notificacao_enviada`);
  await knex.raw(`ALTER TABLE notificacao_enviada DROP COLUMN referencia`);
  await knex.raw(`ALTER TABLE notificacao_enviada ADD COLUMN referencia_id uuid NOT NULL`);
  await knex.raw(`
    ALTER TABLE notificacao_enviada
      ADD CONSTRAINT notificacao_enviada_unica UNIQUE (tipo, referencia_id)
  `);
}

import type { Knex } from "knex";

/**
 * Remove `congelamento.estornado_em`.
 *
 * A coluna foi desenhada supondo que estorno fosse um **evento numa linha**:
 * o congelamento tinha sido gasto, o preenchimento retroativo resgatava o
 * período, e a linha era carimbada de volta como disponível.
 *
 * A materialização como replay (ver [materializar.ts](../../servidor/materializar.ts))
 * tornou isso impossível de escrever, e desnecessário de guardar. A cada escrita
 * o estoque inteiro do hábito é apagado e recriado a partir de `simular()`, com
 * **ids novos** — não existe a linha de antes para carimbar. E o estorno deixou
 * de ser um evento: ele é a diferença entre dois recálculos, "o total consumido
 * diminuiu", que é como `efeitos.congelamentoEstornado` chega à tela.
 *
 * Enquanto ela existiu, nunca recebeu outro valor senão `null`, e os
 * `whereNull("estornado_em")` espalhados pelas consultas de estoque eram filtros
 * que não filtravam nada. Manter uma coluna sempre nula com três no-ops em volta
 * é pior que não tê-la: a próxima pessoa a ler a tabela conclui que existe um
 * rastro de estorno em algum lugar, e não existe.
 *
 * O rastro do que o estoque contém continua: `ganho_em`/`ganho_por_periodo_id` e
 * `consumido_em`/`consumido_periodo_id` dizem de qual período cada unidade
 * nasceu e em qual foi gasta. O que se perde é só o histórico de um resgate, que
 * nunca foi gravado.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE congelamento DROP COLUMN estornado_em`);

  await knex.raw(`
    COMMENT ON TABLE congelamento IS
      'Estoque unitário: uma linha por congelamento, não um contador. Consumo automático e FIFO por ganho_em. Recriado inteiro a cada materialização — estorno é diferença entre dois recálculos, não evento.'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE congelamento ADD COLUMN estornado_em timestamptz`);

  await knex.raw(`
    COMMENT ON TABLE congelamento IS
      'Estoque unitário: uma linha por congelamento, não um contador. Consumo automático e FIFO por ganho_em.'
  `);
}

import type { Knex } from "knex";

/**
 * `cadencia = 'diario'` no modo flexível aceita **só** `meta_ocorrencias = 1`.
 *
 * No modo flexível a unidade contável é o **dia lógico**: `agrupar()` em
 * `dominio/simulacao.ts` faz um grupo por `data_logica`, e `unidadeCumprida` de
 * um hábito binário se basta com um registro. A cadência diária tem exatamente
 * um dia dentro da janela, então `meta_ocorrencias` satura em 1 e qualquer valor
 * acima disso é **inalcançável por construção**.
 *
 * O estrago era silencioso e inteiro: o formulário aceitava "diário, flexível,
 * 2 vezes", o dashboard mostrava `1/2` com a marca cheia, o toque na marca
 * desmarcava em vez de somar a segunda, o retroativo recusava com "este dia já
 * está cumprido" — e às 04:00 o período fechava `falhou` num dia cumprido,
 * gastando congelamento ou derrubando a sequência.
 *
 * O CHECK existe porque o contrato não é o único caminho até esta tabela: seeds
 * e `UPDATE` à mão escrevem direto, e esta é a regra que, violada, produz um
 * hábito que não dá para marcar. Ver `Docs/fixes/01 - Diario flexivel limitado
 * a 1.md` e a tabela de combinações válidas do `Mapa de regras.md`.
 *
 * O `UPDATE` que vem antes é obrigatório, não cortesia: `habito_config` é
 * versionada e nunca atualizada no lugar, mas uma versão antiga com `2` aqui
 * impediria o CHECK de ser criado. É a única reescrita de versão do projeto, e
 * ela se justifica porque a regra que aquela versão guardava não era avaliável —
 * o histórico que ela produziu é artefato de bug, não registro de decisão.
 *
 * **Os hábitos tocados precisam ser re-materializados** para que os períodos
 * voltem a refletir a regra corrigida (os dias marcados passam de `falhou` a
 * `cumprido`, e o congelamento gasto à toa é estornado). Isso não acontece
 * aqui: materializar é `servidor/`, depende do relógio lógico e roda em
 * transação própria. Qualquer edição do hábito já dispara o replay; sem
 * edição, `materializar()` por hábito não arquivado resolve.
 *
 * O `down` derruba o CHECK e **não** restaura os valores: a ida é lossy por
 * construção, igual à da `0009`. Era o motivo de ela existir.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    UPDATE habito_config SET meta_ocorrencias = 1
      WHERE cadencia = 'diario' AND meta_ocorrencias > 1
  `);

  /*
   * `meta_ocorrencias IS NULL` passa porque é o modo **fixo**: lá a meta não
   * existe (`habito_config_modo_fixo` já exige o NULL), e um CHECK que não
   * tolerasse o NULL recusaria todo hábito fixo diário — que é justamente o
   * caminho recomendado para "duas vezes por dia".
   */
  await knex.raw(`
    ALTER TABLE habito_config
      ADD CONSTRAINT habito_config_meta_diaria CHECK (
        cadencia <> 'diario' OR meta_ocorrencias IS NULL OR meta_ocorrencias = 1
      )
  `);

  await knex.raw(`
    COMMENT ON COLUMN habito_config.meta_ocorrencias IS
      'Conclusões exigidas no período, no modo flexível. A unidade é o dia lógico, então na cadência diária só 1 é cumprível: para N vezes por dia, modo fixo com horários.'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE habito_config DROP CONSTRAINT habito_config_meta_diaria
  `);
  await knex.raw(`
    COMMENT ON COLUMN habito_config.meta_ocorrencias IS NULL
  `);
}

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

  await knex.raw(`CREATE TYPE habito_tipo AS ENUM ('binario', 'quantificado', 'duracao', 'negativo')`);
  await knex.raw(`CREATE TYPE cadencia_tipo AS ENUM ('diario', 'cada_n_dias', 'semanal', 'mensal')`);
  await knex.raw(`CREATE TYPE modo_tipo AS ENUM ('flexivel', 'fixo')`);
  await knex.raw(`CREATE TYPE periodo_status AS ENUM ('aberto', 'cumprido', 'congelado', 'falhou')`);
  await knex.raw(`CREATE TYPE ocorrencia_status AS ENUM ('pendente', 'cumprida', 'perdida')`);
  await knex.raw(`CREATE TYPE registro_origem AS ENUM ('app', 'retroativo', 'cronometro')`);
  await knex.raw(`CREATE TYPE congelamento_status AS ENUM ('disponivel', 'consumido')`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP TYPE IF EXISTS congelamento_status`);
  await knex.raw(`DROP TYPE IF EXISTS registro_origem`);
  await knex.raw(`DROP TYPE IF EXISTS ocorrencia_status`);
  await knex.raw(`DROP TYPE IF EXISTS periodo_status`);
  await knex.raw(`DROP TYPE IF EXISTS modo_tipo`);
  await knex.raw(`DROP TYPE IF EXISTS cadencia_tipo`);
  await knex.raw(`DROP TYPE IF EXISTS habito_tipo`);
}

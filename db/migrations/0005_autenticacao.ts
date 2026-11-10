import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE credencial_senha (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      hash          text NOT NULL,
      ativa         boolean NOT NULL,
      desativada_em timestamptz,
      atualizada_em timestamptz NOT NULL DEFAULT now(),

      -- App de usuário único: o par UNIQUE + CHECK garante no banco que existe
      -- no máximo uma linha nesta tabela.
      unico         boolean NOT NULL DEFAULT true,

      CONSTRAINT credencial_senha_linha_unica UNIQUE (unico),
      CONSTRAINT credencial_senha_singleton CHECK (unico),
      CONSTRAINT credencial_senha_desativacao CHECK (
        (ativa AND desativada_em IS NULL) OR (NOT ativa AND desativada_em IS NOT NULL)
      )
    )
  `);

  await knex.raw(`
    CREATE TABLE credencial_passkey (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      credential_id bytea NOT NULL UNIQUE,
      public_key    bytea NOT NULL,
      counter       bigint NOT NULL DEFAULT 0,
      transports    text[],
      aaguid        uuid,
      apelido       text,
      criada_em     timestamptz NOT NULL DEFAULT now(),
      ultimo_uso_em timestamptz,

      CONSTRAINT credencial_passkey_counter CHECK (counter >= 0)
    )
  `);

  await knex.raw(`
    CREATE TABLE webauthn_desafio (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      desafio      bytea NOT NULL,
      tipo         text NOT NULL,
      expira_em    timestamptz NOT NULL,
      consumido_em timestamptz,

      CONSTRAINT webauthn_desafio_tipo CHECK (tipo IN ('registro', 'autenticacao'))
    )
  `);
  await knex.raw(`CREATE INDEX webauthn_desafio_expiracao_idx ON webauthn_desafio (expira_em)`);

  await knex.raw(`
    CREATE TABLE sessao (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      token_hash  text NOT NULL UNIQUE,
      criada_em   timestamptz NOT NULL DEFAULT now(),
      expira_em   timestamptz NOT NULL,
      user_agent  text,
      revogada_em timestamptz
    )
  `);
  await knex.raw(`
    COMMENT ON COLUMN sessao.token_hash IS
      'Só o hash do token. O token em claro vive apenas no cookie httpOnly.'
  `);
  await knex.raw(`CREATE INDEX sessao_expiracao_idx ON sessao (expira_em) WHERE revogada_em IS NULL`);

  await knex.raw(`
    CREATE TABLE tentativa_login (
      id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      ip        inet NOT NULL,
      sucesso   boolean NOT NULL,
      criada_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await knex.raw(`
    COMMENT ON COLUMN tentativa_login.ip IS
      'Vem do header CF-Connecting-IP, nunca do socket: atrás do Cloudflare Tunnel o socket é sempre o do túnel, e bloquear por ele trancaria o app inteiro.'
  `);
  await knex.raw(`CREATE INDEX tentativa_login_ip_idx ON tentativa_login (ip, criada_em DESC)`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP TABLE IF EXISTS tentativa_login`);
  await knex.raw(`DROP TABLE IF EXISTS sessao`);
  await knex.raw(`DROP TABLE IF EXISTS webauthn_desafio`);
  await knex.raw(`DROP TABLE IF EXISTS credencial_passkey`);
  await knex.raw(`DROP TABLE IF EXISTS credencial_senha`);
}

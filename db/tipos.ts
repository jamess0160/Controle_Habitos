import type { Knex } from "knex";

/**
 * Tipos das linhas do banco, registrados no módulo do Knex para que
 * `db("habito")` devolva linhas tipadas sem ORM no meio.
 *
 * Estes tipos descrevem a linha **como o Postgres a entrega**: largos, com
 * nullables, do jeito que a tabela é. A forma estreita e segura por variante
 * (união discriminada em `modo` e em `tipo`) é responsabilidade dos contratos
 * Zod em `contracts/` — ver etapa 1.4 do roadmap. Não confundir os dois papéis.
 *
 * Convenções de conversão do driver:
 * - `date` chega como string `YYYY-MM-DD` (ver `db/pg-types.ts`)
 * - `timestamptz` chega como `Date`
 * - `numeric` chega como `number` (ver `db/pg-types.ts`)
 * - `bigint` chega como string, para não perder precisão
 * - `time` chega como string `HH:MM:SS`
 */

export type HabitoTipo = "binario" | "quantificado" | "duracao" | "negativo";
export type CadenciaTipo = "diario" | "cada_n_dias" | "semanal" | "mensal";
export type ModoTipo = "flexivel" | "fixo";
export type PeriodoStatus = "aberto" | "cumprido" | "congelado" | "falhou";
export type OcorrenciaStatus = "pendente" | "cumprida" | "perdida";
export type RegistroOrigem = "app" | "retroativo" | "cronometro";
export type CongelamentoStatus = "disponivel" | "consumido";

/** Torna opcionais, na inserção, as colunas que têm DEFAULT no banco. */
type ComDefault<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export interface Habito {
  id: string;
  /** O emoji de sinalização faz parte do nome (ex.: "💧 Água"). */
  nome: string;
  cor: string;
  tipo: HabitoTipo;
  inicio_em: string;
  ordem: number;
  pausado_de: string | null;
  pausado_ate: string | null;
  arquivado_em: Date | null;
  criado_em: Date;
}
export type HabitoInsert = ComDefault<Habito, "id" | "criado_em">;

export interface HabitoConfig {
  id: string;
  habito_id: string;
  /** Cópia de `habito.tipo`, mantida em sincronia pela FK composta. */
  tipo: HabitoTipo;
  versao: number;
  vigente_de: string;
  vigente_ate: string | null;

  cadencia: CadenciaTipo;
  cadencia_intervalo: number | null;
  modo: ModoTipo;
  meta_ocorrencias: number | null;
  /** 1 = domingo … 7 = sábado. */
  dias_semana: number[] | null;
  dias_mes: number[] | null;
  horarios: string[] | null;
  notificar_em: string | null;

  meta_valor: number | null;
  unidade: string | null;
  meta_minutos: number | null;
  tolerancia_recaidas: number | null;

  congelamento_ativo: boolean;
  congelamento_a_cada: number | null;
  congelamento_max: number | null;

  criado_em: Date;
}
export type HabitoConfigInsert = ComDefault<HabitoConfig, "id" | "criado_em">;

export interface HabitoPeriodo {
  id: string;
  habito_id: string;
  config_id: string;
  inicio: string;
  /** Mutável em `cada_n_dias`: concluir a meta encerra o período naquela data. */
  fim: string;
  /** Snapshot da meta vigente — nunca ler da config em runtime. */
  meta_ocorrencias: number;
  concluidas: number;
  status: PeriodoStatus;
  fechado_em: Date | null;
  criado_em: Date;
}
export type HabitoPeriodoInsert = ComDefault<
  HabitoPeriodo,
  "id" | "concluidas" | "status" | "fechado_em" | "criado_em"
>;

export interface HabitoOcorrencia {
  id: string;
  periodo_id: string;
  previsto_para: Date;
  status: OcorrenciaStatus;
  cumprida_em: Date | null;
}
export type HabitoOcorrenciaInsert = ComDefault<
  HabitoOcorrencia,
  "id" | "status" | "cumprida_em"
>;

export interface Registro {
  id: string;
  periodo_id: string;
  ocorrencia_id: string | null;
  /** Dia a que o registro pertence, com a virada das 04:00 já aplicada. */
  data_logica: string;
  valor: number;
  origem: RegistroOrigem;
  criado_em: Date;
}
export type RegistroInsert = ComDefault<Registro, "id" | "valor" | "criado_em">;

export interface Congelamento {
  id: string;
  habito_id: string;
  status: CongelamentoStatus;
  ganho_em: Date;
  ganho_por_periodo_id: string;
  consumido_em: Date | null;
  consumido_periodo_id: string | null;
  estornado_em: Date | null;
}
export type CongelamentoInsert = ComDefault<
  Congelamento,
  "id" | "status" | "ganho_em" | "consumido_em" | "consumido_periodo_id" | "estornado_em"
>;

export interface HabitoStreak {
  habito_id: string;
  sequencia_atual: number;
  sequencia_recorde: number;
  total_no_prazo: number;
  desde: string | null;
  atualizado_em: Date;
}
export type HabitoStreakInsert = ComDefault<
  HabitoStreak,
  "sequencia_atual" | "sequencia_recorde" | "total_no_prazo" | "desde" | "atualizado_em"
>;

export interface CredencialSenha {
  id: string;
  hash: string;
  ativa: boolean;
  desativada_em: Date | null;
  atualizada_em: Date;
  /** Sempre true — existe só para o par UNIQUE + CHECK garantir linha única. */
  unico: boolean;
}
export type CredencialSenhaInsert = ComDefault<
  CredencialSenha,
  "id" | "desativada_em" | "atualizada_em" | "unico"
>;

export interface CredencialPasskey {
  id: string;
  credential_id: Buffer;
  public_key: Buffer;
  /** bigint: chega como string do driver. */
  counter: string;
  transports: string[] | null;
  aaguid: string | null;
  apelido: string | null;
  criada_em: Date;
  ultimo_uso_em: Date | null;
}
export type CredencialPasskeyInsert = ComDefault<
  CredencialPasskey,
  "id" | "counter" | "criada_em" | "ultimo_uso_em"
>;

export interface WebauthnDesafio {
  id: string;
  desafio: Buffer;
  tipo: "registro" | "autenticacao";
  expira_em: Date;
  consumido_em: Date | null;
}
export type WebauthnDesafioInsert = ComDefault<WebauthnDesafio, "id" | "consumido_em">;

export interface Sessao {
  id: string;
  /** Só o hash. O token em claro vive apenas no cookie httpOnly. */
  token_hash: string;
  criada_em: Date;
  expira_em: Date;
  user_agent: string | null;
  revogada_em: Date | null;
}
export type SessaoInsert = ComDefault<Sessao, "id" | "criada_em" | "revogada_em">;

export interface TentativaLogin {
  id: string;
  /** Vem de `CF-Connecting-IP`, nunca do socket. */
  ip: string;
  sucesso: boolean;
  criada_em: Date;
}
export type TentativaLoginInsert = ComDefault<TentativaLogin, "id" | "criada_em">;

export interface PushSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  criada_em: Date;
  invalida_em: Date | null;
}
export type PushSubscriptionInsert = ComDefault<
  PushSubscription,
  "id" | "criada_em" | "invalida_em"
>;

export type NotificacaoTipo =
  | "lembrete"
  | "meta_atraso"
  | "congelamento_usado"
  | "sequencia_perdida";

export interface NotificacaoEnviada {
  id: string;
  tipo: NotificacaoTipo;
  referencia_id: string;
  enviada_em: Date;
}
export type NotificacaoEnviadaInsert = ComDefault<NotificacaoEnviada, "id" | "enviada_em">;

export interface ConfigApp {
  chave: string;
  valor: string;
  atualizada_em: Date;
}
export type ConfigAppInsert = ComDefault<ConfigApp, "atualizada_em">;

declare module "knex/types/tables" {
  interface Tables {
    habito: Knex.CompositeTableType<Habito, HabitoInsert, Partial<HabitoInsert>>;
    habito_config: Knex.CompositeTableType<
      HabitoConfig,
      HabitoConfigInsert,
      // Versionada: a linha nunca sofre UPDATE, exceto fechar a vigência.
      Pick<HabitoConfig, "vigente_ate">
    >;
    habito_periodo: Knex.CompositeTableType<
      HabitoPeriodo,
      HabitoPeriodoInsert,
      Partial<HabitoPeriodoInsert>
    >;
    habito_ocorrencia: Knex.CompositeTableType<
      HabitoOcorrencia,
      HabitoOcorrenciaInsert,
      Partial<HabitoOcorrenciaInsert>
    >;
    registro: Knex.CompositeTableType<Registro, RegistroInsert, Partial<RegistroInsert>>;
    congelamento: Knex.CompositeTableType<
      Congelamento,
      CongelamentoInsert,
      Partial<CongelamentoInsert>
    >;
    habito_streak: Knex.CompositeTableType<
      HabitoStreak,
      HabitoStreakInsert,
      Partial<HabitoStreakInsert>
    >;
    credencial_senha: Knex.CompositeTableType<
      CredencialSenha,
      CredencialSenhaInsert,
      Partial<CredencialSenhaInsert>
    >;
    credencial_passkey: Knex.CompositeTableType<
      CredencialPasskey,
      CredencialPasskeyInsert,
      Partial<CredencialPasskeyInsert>
    >;
    webauthn_desafio: Knex.CompositeTableType<
      WebauthnDesafio,
      WebauthnDesafioInsert,
      Partial<WebauthnDesafioInsert>
    >;
    sessao: Knex.CompositeTableType<Sessao, SessaoInsert, Partial<SessaoInsert>>;
    tentativa_login: Knex.CompositeTableType<
      TentativaLogin,
      TentativaLoginInsert,
      Partial<TentativaLoginInsert>
    >;
    push_subscription: Knex.CompositeTableType<
      PushSubscription,
      PushSubscriptionInsert,
      Partial<PushSubscriptionInsert>
    >;
    notificacao_enviada: Knex.CompositeTableType<
      NotificacaoEnviada,
      NotificacaoEnviadaInsert,
      Partial<NotificacaoEnviadaInsert>
    >;
    config_app: Knex.CompositeTableType<ConfigApp, ConfigAppInsert, Partial<ConfigAppInsert>>;
  }
}

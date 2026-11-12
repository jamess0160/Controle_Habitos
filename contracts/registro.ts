import * as z from "zod";
import { dataLogica, diaDaSemana, horario, instante, sequencia, uuid } from "./comum";

/**
 * Contrato de registro e de preenchimento retroativo.
 *
 * Registro é o evento bruto — o que foi feito, ou a recaída no hábito negativo.
 * O período, a ocorrência e a sequência são derivados dele pelo domínio, então
 * nenhum deles é enviado pelo cliente: mandar `periodoId` abriria a porta para o
 * cliente escolher o período errado de um registro de madrugada.
 */

export const ORIGEM = ["app", "retroativo", "cronometro"] as const;
export const origem = z.enum(ORIGEM);

/**
 * POST /api/registros
 *
 * `dataLogica` é opcional: ausente significa agora, e o servidor aplica a virada
 * das 04:00. O cliente **não** calcula o dia lógico — é a armadilha nº 1 do
 * projeto, e o relógio do celular não é fonte confiável para isso.
 */
export const criarRegistro = z.strictObject({
  habitoId: uuid,
  /** Só no modo fixo: qual momento está sendo marcado. */
  ocorrenciaId: uuid.nullable().optional(),
  /** Quantidade no quantificado, minutos na duração; 1 nos demais. */
  valor: z.number().positive().optional(),
  dataLogica: dataLogica.optional(),
  origem: origem.default("app"),
});
export type CriarRegistro = z.infer<typeof criarRegistro>;

/**
 * O que mudou por causa de uma marcação ou desmarcação.
 *
 * A tela precisa comunicar isso na hora: a sequência foi recalculada, um
 * congelamento voltou ao estoque, e — em `cada_n_dias` — o próximo vencimento
 * mudou de lugar. Sem o payload dizer, a interface teria de deduzir comparando
 * estados, que é justamente onde divergiria do servidor.
 */
export const efeitos = z.object({
  sequencia,
  congelamentosDisponiveis: z.int().min(0),
  congelamentoEstornado: z.boolean(),
  periodoStatus: z.enum(["aberto", "cumprido", "congelado", "falhou"]),
  /**
   * Preenchido só em `cada_n_dias`: alterar uma data move a âncora e
   * re-encadeia todos os períodos seguintes.
   */
  novoVencimento: dataLogica.nullable(),
});
export type Efeitos = z.infer<typeof efeitos>;

export const registroCriado = z.object({
  id: uuid,
  habitoId: uuid,
  periodoId: uuid,
  ocorrenciaId: uuid.nullable(),
  dataLogica,
  valor: z.number(),
  origem,
  criadoEm: instante,
  /** Como o fechamento ficou depois deste registro. */
  efeitos,
});
export type RegistroCriado = z.infer<typeof registroCriado>;

// ─── Retroativo ──────────────────────────────────────────────────────────────

export const MOTIVO_BLOQUEIO = ["antes_do_inicio", "em_pausa", "fora_da_janela"] as const;
export const motivoBloqueio = z.enum(MOTIVO_BLOQUEIO);

/**
 * Um dia da janela de 7 dias.
 *
 * Dias bloqueados aparecem com o motivo visível em vez de simplesmente ausentes
 * — some o dia e a tela fica ambígua entre "não pode" e "não aconteceu".
 */
export const diaRetroativo = z.object({
  dataLogica,
  diaDaSemana,
  hoje: z.boolean(),
  estado: z.enum(["cumprido", "nao_cumprido", "congelado", "bloqueado"]),
  motivoBloqueio: motivoBloqueio.nullable(),
  /** Soma registrada no dia, nos tipos quantificado e duração. */
  valor: z.number().nullable(),
  /** Para desmarcar: `DELETE /api/registros/:id`. */
  registroIds: z.array(uuid),
});
export type DiaRetroativo = z.infer<typeof diaRetroativo>;

export const retroativo = z.object({
  habitoId: uuid,
  nome: z.string(),
  /** Progresso do período corrente, como aparece no cabeçalho da tela. */
  periodoAtual: z
    .object({ concluidas: z.int().min(0), meta: z.int().min(1), fim: dataLogica })
    .nullable(),
  sequencia,
  congelamentosDisponiveis: z.int().min(0),
  /** Do mais recente para o mais antigo, 7 dias. */
  dias: z.array(diaRetroativo).length(7),
});
export type Retroativo = z.infer<typeof retroativo>;

/**
 * POST /api/habitos/:id/retroativo
 *
 * `previa: true` calcula os efeitos **sem persistir**. É o que a tela usa para
 * mostrar o novo vencimento antes de confirmar num hábito `cada_n_dias`, onde o
 * efeito vai muito além do dia tocado.
 */
export const preencherRetroativo = z.strictObject({
  dataLogica,
  horario: horario.nullable().optional(),
  valor: z.number().positive().optional(),
  previa: z.boolean().default(false),
});
export type PreencherRetroativo = z.infer<typeof preencherRetroativo>;

export const retroativoAplicado = z.object({
  /** `false` quando era prévia. */
  persistido: z.boolean(),
  efeitos,
  dias: z.array(diaRetroativo).length(7),
});
export type RetroativoAplicado = z.infer<typeof retroativoAplicado>;

/**
 * DELETE /api/registros/:id
 *
 * A desmarcação devolve os mesmos efeitos de uma marcação, não um `ok: true`:
 * apagar um registro recalcula a sequência, pode estornar um congelamento e, em
 * `cada_n_dias`, mover o vencimento. Sem o payload dizer, a tela teria de
 * recarregar tudo para descobrir o que mudou.
 */
export const registroRemovido = z.object({ efeitos });
export type RegistroRemovido = z.infer<typeof registroRemovido>;

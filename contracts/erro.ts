import * as z from "zod";
import { mensagensPtBr } from "./mensagens";

/**
 * Erro padronizado e o helper de validação usado por todo route handler.
 *
 * Uma única forma de erro para toda a API: o cliente trata um shape, não um por
 * rota. `campos` só aparece em erro de validação, e é o que o formulário usa
 * para marcar o campo errado em vez de mostrar um toast genérico.
 */

export const CODIGO_ERRO = [
  "validacao", // payload malformado — 422
  "nao_autenticado", // sem sessão válida — 401
  "bloqueado", // rate limiting ativo — 429
  "nao_encontrado", // 404
  "conflito", // estado incompatível, ex.: passkey já cadastrada — 409
  "regra_violada", // pedido válido no formato, proibido pela regra — 422
  "interno", // 500
] as const;

export type CodigoErro = (typeof CODIGO_ERRO)[number];

export const STATUS_DE: Record<CodigoErro, number> = {
  validacao: 422,
  nao_autenticado: 401,
  bloqueado: 429,
  nao_encontrado: 404,
  conflito: 409,
  regra_violada: 422,
  interno: 500,
};

export const campoInvalido = z.object({
  /** Caminho no payload, ex.: `cadencia.diasSemana` ou `horarios[1]`. */
  campo: z.string(),
  mensagem: z.string(),
});

export const respostaErro = z.object({
  erro: z.object({
    codigo: z.enum(CODIGO_ERRO),
    mensagem: z.string(),
    campos: z.array(campoInvalido).optional(),
  }),
});

export type RespostaErro = z.infer<typeof respostaErro>;
export type CampoInvalido = z.infer<typeof campoInvalido>;

export function erroDe(
  codigo: CodigoErro,
  mensagem: string,
  campos?: CampoInvalido[],
): RespostaErro {
  return { erro: { codigo, mensagem, ...(campos && campos.length > 0 ? { campos } : {}) } };
}

/** `["cadencia", "diasSemana"]` → `cadencia.diasSemana`; índice vira `[n]`. */
export function caminhoDe(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, parte) => {
    if (typeof parte === "number") return `${acc}[${parte}]`;
    return acc === "" ? String(parte) : `${acc}.${String(parte)}`;
  }, "");
}

export type Validado<T> =
  | { ok: true; dados: T }
  | { ok: false; status: number; resposta: RespostaErro };

/**
 * Valida um payload contra o schema do contrato.
 *
 * Devolve resultado em vez de lançar: o route handler escreve
 * `if (!r.ok) return Response.json(r.resposta, { status: r.status })` e segue com
 * `r.dados` já estreitado. Lançar obrigaria try/catch em toda rota e perderia a
 * distinção entre payload inválido e falha de verdade.
 */
export function validar<S extends z.ZodType>(schema: S, payload: unknown): Validado<z.infer<S>> {
  const resultado = schema.safeParse(payload, { error: mensagensPtBr });

  if (resultado.success) {
    return { ok: true, dados: resultado.data };
  }

  const campos = resultado.error.issues.map((issue) => ({
    campo: caminhoDe(issue.path),
    mensagem: issue.message,
  }));

  return {
    ok: false,
    status: STATUS_DE.validacao,
    resposta: erroDe("validacao", "Não foi possível salvar: confira os campos.", campos),
  };
}

/**
 * Mesma validação, para quando o payload vem de dentro de casa (fixture, seed,
 * resposta própria). Aqui payload inválido é bug, não entrada do usuário, então
 * lançar é o comportamento correto.
 */
export function exigirValido<S extends z.ZodType>(
  schema: S,
  payload: unknown,
  contexto: string,
): z.infer<S> {
  const resultado = schema.safeParse(payload, { error: mensagensPtBr });
  if (!resultado.success) {
    throw new Error(`${contexto} não bate com o contrato:\n${z.prettifyError(resultado.error)}`);
  }
  return resultado.data;
}

import { pausarHabito } from "@/contracts";
import { corpo, exigirAcesso, falha, json } from "@/servidor/http";
import { pausarHabitoNoBanco, retomarHabitoNoBanco } from "@/servidor/habitos";

/**
 * POST e DELETE da pausa.
 *
 * `ate: null` é pausa aberta, sem data de retorno. Dentro da pausa não se gera
 * período, e é por isso que a pausa aparece como bloqueio na tela de retroativo
 * em vez de dia simplesmente ausente.
 *
 * As duas respostas devolvem o **hábito** e não `ok: true`: a lista precisa
 * redesenhar a linha com o estado novo, e um `ok` a obrigaria a recarregar tudo.
 *
 * Pausar re-materializa, e tem de re-materializar: os períodos do intervalo
 * deixam de existir, e a sequência exibida mudaria sem isso.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/habitos/[id]/pausa">) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const r = await corpo(req, pausarHabito);
  if (!r.ok) return json(r.resposta, r.status);

  const { id } = await ctx.params;
  const habito = await pausarHabitoNoBanco(id, r.dados);

  if (habito === null) return falha("nao_encontrado", "Hábito não encontrado.");

  return json(habito);
}

/** DELETE /api/habitos/:id/pausa — retomar antes da data marcada. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/habitos/[id]/pausa">) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const { id } = await ctx.params;
  const habito = await retomarHabitoNoBanco(id);

  if (habito === null) return falha("nao_encontrado", "Hábito não encontrado.");

  return json(habito);
}

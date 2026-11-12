import { pausarHabito } from "@/contracts";
import { habitoAgua, habitoPausado } from "@/contracts/fixtures";
import { corpo, exigirAcesso, json } from "@/servidor/http";

/**
 * POST e DELETE da pausa.
 *
 * `ate: null` é pausa aberta, sem data de retorno. Dentro da pausa não se gera
 * período, e é por isso que a pausa aparece como bloqueio na tela de retroativo
 * em vez de dia simplesmente ausente.
 *
 * As duas respostas devolvem o **hábito** e não `ok: true`: a lista precisa
 * redesenhar a linha com o estado novo, e um `ok` a obrigaria a recarregar tudo.
 */
export async function POST(req: Request, _ctx: RouteContext<"/api/habitos/[id]/pausa">) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const r = await corpo(req, pausarHabito);
  if (!r.ok) return json(r.resposta, r.status);

  return json(habitoPausado);
}

/** DELETE /api/habitos/:id/pausa — retomar antes da data marcada. */
export async function DELETE(_req: Request, _ctx: RouteContext<"/api/habitos/[id]/pausa">) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  return json(habitoAgua);
}

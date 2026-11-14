import { exigirAcesso, falha, json } from "@/servidor/http";
import { arquivarHabitoNoBanco } from "@/servidor/habitos";

/**
 * POST e DELETE do arquivamento.
 *
 * Arquivar não apaga: o hábito sai da lista ativa e do dashboard, mantendo
 * histórico e sequência intactos. Nenhum dos dois leva corpo — a ação é o
 * próprio método, e não há nada a configurar.
 *
 * Desarquivar devolve o hábito ao **fim** da ordem, porque a `ordem` que ele
 * tinha antes provavelmente colide com a de quem ficou na lista.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/habitos/[id]/arquivo">) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const { id } = await ctx.params;
  const habito = await arquivarHabitoNoBanco(id, true);

  if (habito === null) return falha("nao_encontrado", "Hábito não encontrado.");

  return json(habito);
}

/** DELETE /api/habitos/:id/arquivo — desarquivar. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/habitos/[id]/arquivo">) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const { id } = await ctx.params;
  const habito = await arquivarHabitoNoBanco(id, false);

  if (habito === null) return falha("nao_encontrado", "Hábito não encontrado.");

  return json(habito);
}

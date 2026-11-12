import { habitoAgua, habitoArquivado } from "@/contracts/fixtures";
import { exigirAcesso, json } from "@/servidor/http";

/**
 * POST e DELETE do arquivamento.
 *
 * Arquivar não apaga: o hábito sai da lista ativa e do dashboard, mantendo
 * histórico e sequência intactos. Nenhum dos dois leva corpo — a ação é o
 * próprio método, e não há nada a configurar.
 */
export async function POST(_req: Request, _ctx: RouteContext<"/api/habitos/[id]/arquivo">) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  return json(habitoArquivado);
}

/** DELETE /api/habitos/:id/arquivo — desarquivar. */
export async function DELETE(_req: Request, _ctx: RouteContext<"/api/habitos/[id]/arquivo">) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  return json(habitoAgua);
}

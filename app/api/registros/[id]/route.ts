import { registroRemovidoFixture } from "@/contracts/fixtures";
import { exigirAcesso, json } from "@/servidor/http";

/**
 * DELETE /api/registros/:id — desmarcar.
 *
 * Devolve os mesmos efeitos de uma marcação porque apagar um registro recalcula
 * a sequência, pode estornar um congelamento e, em `cada_n_dias`, mover o
 * vencimento. O estorno com a escrita de `estornado_em` é a etapa 3.4.
 */
export async function DELETE(_req: Request, _ctx: RouteContext<"/api/registros/[id]">) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  return json(registroRemovidoFixture);
}

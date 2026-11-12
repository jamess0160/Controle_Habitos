import { reordenarHabitos } from "@/contracts";
import { listaDeHabitosFixture } from "@/contracts/fixtures";
import { corpo, exigirAcesso, json } from "@/servidor/http";

/**
 * PUT /api/habitos/ordem
 *
 * Recebe a lista completa na ordem desejada, não um par (id, posição): com o
 * arraste da lista o cliente já conhece a ordem final, e mandá-la inteira torna
 * a operação idempotente — repetir a chamada não embaralha nada.
 *
 * Devolve a lista como ficou, para a tela confirmar contra o servidor em vez de
 * confiar no estado otimista que acabou de aplicar.
 *
 * O segmento estático `ordem` vence `[id]` no roteamento do Next, então esta
 * rota não colide com `GET /api/habitos/:id`.
 */
export async function PUT(req: Request) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const r = await corpo(req, reordenarHabitos);
  if (!r.ok) return json(r.resposta, r.status);

  return json(listaDeHabitosFixture);
}

import { editarHabito } from "@/contracts";
import { habitoAgua } from "@/contracts/fixtures";
import { corpo, exigirAcesso, json } from "@/servidor/http";

/**
 * GET e PATCH de um hábito.
 *
 * O stub ignora o `:id` e devolve sempre a mesma fixture — não há banco para
 * consultar, e inventar um 404 para ids desconhecidos travaria a navegação da
 * etapa 2 com as fixtures de outros hábitos.
 */
export async function GET(_req: Request, _ctx: RouteContext<"/api/habitos/[id]">) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  return json(habitoAgua);
}

/**
 * PATCH /api/habitos/:id — cria uma **nova versão** da configuração.
 *
 * `editarHabito` precisa do tipo do hábito porque o tipo é imutável, e o tipo
 * vem do hábito gravado, nunca do payload. A implementação real carrega o hábito
 * pelo `:id` e passa o tipo dele; o stub tira da fixture, o que mantém a mesma
 * forma de chamada — e deixa visível que um PATCH com meta de outro tipo é
 * recusado por contrato, não por CHECK do Postgres.
 */
export async function PATCH(req: Request, _ctx: RouteContext<"/api/habitos/[id]">) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const r = await corpo(req, editarHabito(habitoAgua.config.meta.tipo));
  if (!r.ok) return json(r.resposta, r.status);

  return json(habitoAgua);
}

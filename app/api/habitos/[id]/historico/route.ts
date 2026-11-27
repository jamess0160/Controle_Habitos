import { exigirAcesso, falha, json } from "@/servidor/http";
import { historicoDoHabitoNoBanco } from "@/servidor/habitos";

/**
 * GET /api/habitos/:id/historico — quantas marcações e quantos dias o hábito tem.
 *
 * Serve à confirmação de exclusão, que precisa dizer **em números** o que vai
 * embora: apagar é a única operação irreversível do app, e um "tem certeza?"
 * genérico não informa a decisão.
 *
 * Rota própria, e não um campo no payload de `habito`: a contagem exige um join
 * de `registro` com `habito_periodo` (registro não guarda `habito_id`), e
 * pagá-la em toda abertura da lista para um dado usado só na exclusão seria caro
 * no lugar errado.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/habitos/[id]/historico">) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const { id } = await ctx.params;
  const historico = await historicoDoHabitoNoBanco(id);

  if (historico === null) return falha("nao_encontrado", "Hábito não encontrado.");

  return json(historico);
}

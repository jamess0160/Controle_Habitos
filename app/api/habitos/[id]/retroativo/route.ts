import { preencherRetroativo } from "@/contracts";
import { corpo, exigirAcesso, falha, json } from "@/servidor/http";
import { mensagemDeFalhaDeRegistro } from "@/servidor/registros";
import { aplicarRetroativo, montarRetroativo } from "@/servidor/retroativo";

/**
 * GET /api/habitos/:id/retroativo — a janela de 7 dias com os bloqueios visíveis.
 *
 * Dias bloqueados vêm na lista **com motivo**, e não ausentes: sumir com o dia
 * deixaria a tela ambígua entre "não pode" e "não aconteceu".
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/habitos/[id]/retroativo">) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const { id } = await ctx.params;
  const resultado = await montarRetroativo(id);

  if (!resultado.ok) {
    return falha("nao_encontrado", mensagemDeFalhaDeRegistro(resultado.falha));
  }

  return json(resultado.dados);
}

/**
 * POST /api/habitos/:id/retroativo
 *
 * `previa: true` calcula sem persistir, e é o que permite mostrar o novo
 * vencimento de um `cada_n_dias` **antes** de confirmar: ali o efeito vai muito
 * além do dia tocado, porque mover a âncora re-encadeia todos os períodos
 * seguintes. Foi o acréscimo que o [contrato](../../../../../contracts/registro.ts)
 * fez ao inventário de rotas, para a tela não precisar de um endpoint de
 * simulação separado.
 *
 * As duas respostas têm o mesmo shape, mudando só `persistido` — e não só o
 * shape: a prévia é a **mesma escrita**, numa transação desfeita no fim. A tela
 * usa o mesmo código para as duas porque o servidor faz a mesma coisa nas duas.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/habitos/[id]/retroativo">) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const r = await corpo(req, preencherRetroativo);
  if (!r.ok) return json(r.resposta, r.status);

  const { id } = await ctx.params;
  const resultado = await aplicarRetroativo(id, r.dados);

  if (!resultado.ok) {
    const codigo =
      resultado.falha.tipo === "habito_inexistente" ? "nao_encontrado" : "regra_violada";
    return falha(codigo, mensagemDeFalhaDeRegistro(resultado.falha));
  }

  return json(resultado.dados);
}

import type { RegistroRemovido } from "@/contracts";
import { exigirAcesso, falha, json } from "@/servidor/http";
import { apagarRegistroNoBanco, mensagemDeFalhaDeRegistro } from "@/servidor/registros";

/**
 * DELETE /api/registros/:id — desmarcar.
 *
 * Devolve os mesmos efeitos de uma marcação porque apagar um registro recalcula
 * a sequência, pode estornar um congelamento e, em `cada_n_dias`, mover o
 * vencimento. Sem o payload dizer, a tela teria de recarregar tudo.
 *
 * Dois chamadores: o retroativo e o próprio dashboard, que desfaz o último
 * registro do dia pelo id que vem em `linha.ultimoRegistro`.
 */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/registros/[id]">) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const { id } = await ctx.params;
  const resultado = await apagarRegistroNoBanco(id);

  if (!resultado.ok) {
    return falha("nao_encontrado", mensagemDeFalhaDeRegistro(resultado.falha));
  }

  const removido: RegistroRemovido = { efeitos: resultado.dados.efeitos };
  return json(removido);
}

import { registroRemovidoFixture } from "@/contracts/fixtures";
import { exigirAcesso, json } from "@/servidor/http";

/**
 * DELETE /api/registros/:id — desmarcar.
 *
 * Devolve os mesmos efeitos de uma marcação porque apagar um registro recalcula
 * a sequência, pode estornar um congelamento e, em `cada_n_dias`, mover o
 * vencimento. O estorno com a escrita de `estornado_em` é a etapa 3.4.
 *
 * Esta rota tem agora dois chamadores: o retroativo e o próprio dashboard, que
 * desfaz o último registro do dia pelo id que vem em `linha.ultimoRegistro`.
 *
 * O stub continua devolvendo a fixture inteira, e aqui isso **não** faz a tela
 * parecer quebrada: o quanto desfazer o dashboard já sabe — é o `valor` que ele
 * tinha em mãos antes de chamar —, e o que vem daqui são só os `efeitos`, que
 * são justamente a parte derivada que a etapa 3.4 vai calcular.
 */
export async function DELETE(_req: Request, _ctx: RouteContext<"/api/registros/[id]">) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  return json(registroRemovidoFixture);
}

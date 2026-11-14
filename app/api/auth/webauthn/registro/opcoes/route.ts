import { exigirSessao, falha, json } from "@/servidor/http";
import { origemDoPedido } from "@/servidor/pedido";
import {
  ambienteDeWebauthn,
  codigoDaFalha,
  desafiosDemais,
  mensagemDeFalha,
  opcoesDeRegistro,
} from "@/servidor/webauthn";

/**
 * POST /api/auth/webauthn/registro/opcoes
 *
 * Exige sessão mas **não** exige passkey — é exatamente a rota que a sessão do
 * primeiro acesso precisa alcançar, então usa `exigirSessao` e não
 * `exigirAcesso`.
 *
 * Grava `webauthn_desafio` antes de responder, e o desafio é conferido no POST
 * seguinte. O teto de desafios é a limitação que o mapa pede: não há segredo a
 * adivinhar aqui, mas sem teto a rota seria uma torneira de escrita naquela
 * tabela.
 */
export async function POST(req: Request) {
  const acesso = await exigirSessao();
  if (!acesso.liberado) return acesso.resposta;

  const ambiente = await ambienteDeWebauthn(origemDoPedido(req));
  if (!ambiente.ok) {
    return falha(codigoDaFalha(ambiente.falha), mensagemDeFalha(ambiente.falha));
  }

  if (await desafiosDemais()) {
    return falha("bloqueado", "Muitos pedidos de biometria seguidos. Aguarde um momento.");
  }

  return json(await opcoesDeRegistro(ambiente.ambiente));
}

import { falha, json } from "@/servidor/http";
import { origemDoPedido } from "@/servidor/pedido";
import {
  ambienteDeWebauthn,
  codigoDaFalha,
  desafiosDemais,
  mensagemDeFalha,
  opcoesDeLogin,
  temPasskeyCadastrada,
} from "@/servidor/webauthn";

/**
 * POST /api/auth/webauthn/login/opcoes
 *
 * Rota pública por necessidade: é o começo da reentrada, quando não há sessão
 * nenhuma. O desafio é gerado aqui e conferido no POST seguinte.
 *
 * Sem passkey cadastrada ela recusa em vez de devolver opções vazias: um desafio
 * que nenhum autenticador pode responder só renderia um `NotAllowedError` opaco
 * no navegador, e a tela não teria como explicar o que fazer.
 */
export async function POST(req: Request) {
  if (!(await temPasskeyCadastrada())) {
    return falha("conflito", "Nenhuma biometria cadastrada neste app. Entre com a senha.");
  }

  const ambiente = await ambienteDeWebauthn(origemDoPedido(req));
  if (!ambiente.ok) {
    return falha(codigoDaFalha(ambiente.falha), mensagemDeFalha(ambiente.falha));
  }

  if (await desafiosDemais()) {
    return falha("bloqueado", "Muitos pedidos de biometria seguidos. Aguarde um momento.");
  }

  return json(await opcoesDeLogin(ambiente.ambiente));
}

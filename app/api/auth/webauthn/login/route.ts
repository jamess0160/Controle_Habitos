import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { credencialWebauthn, type LoginConcluido } from "@/contracts";
import { corpo, falha, json } from "@/servidor/http";
import { ipDoPedido, origemDoPedido } from "@/servidor/pedido";
import { abrirSessao } from "@/servidor/sessao";
import { registrarTentativa } from "@/servidor/tentativas";
import {
  ambienteDeWebauthn,
  autenticarPasskey,
  codigoDaFalha,
  mensagemDeFalha,
} from "@/servidor/webauthn";

/**
 * POST /api/auth/webauthn/login — acesso recorrente.
 *
 * **Sem rate limiting**, e isso é escolha do mapa: não há segredo a adivinhar.
 * Quem não tem a chave privada não produz assinatura válida, então repetir a
 * chamada não aproxima ninguém de entrar — e limitar por IP aqui trancaria o
 * dono do app depois de algumas biometrias canceladas. A emissão de desafios é
 * que tem teto, porque aquela sim escreve no banco.
 *
 * O **sucesso** é registrado em `tentativa_login`, a falha não. `tentativa_login`
 * é a mesma tabela que conta o bloqueio da senha, e ela não tem coluna de tipo:
 * gravar falha de biometria ali faria cinco biometrias canceladas bloquearem a
 * senha do dono do app — o oposto do que o bloqueio existe para fazer. O
 * histórico de acesso fica com os sucessos, que é o que ele precisa mostrar.
 */
export async function POST(req: Request) {
  const r = await corpo(req, credencialWebauthn);
  if (!r.ok) return json(r.resposta, r.status);

  const ambiente = await ambienteDeWebauthn(origemDoPedido(req));
  if (!ambiente.ok) {
    return falha(codigoDaFalha(ambiente.falha), mensagemDeFalha(ambiente.falha));
  }

  const ip = ipDoPedido(req);

  const autenticado = await autenticarPasskey(
    ambiente.ambiente,
    r.dados.credencial as unknown as AuthenticationResponseJSON,
  );

  if (!autenticado.ok) {
    return falha(codigoDaFalha(autenticado.falha), mensagemDeFalha(autenticado.falha));
  }

  await registrarTentativa(ip, true);
  await abrirSessao(req);

  const concluido: LoginConcluido = { proximoPasso: "dashboard" };
  return json(concluido);
}

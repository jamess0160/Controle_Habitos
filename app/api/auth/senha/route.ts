import { loginComSenha, type LoginConcluido } from "@/contracts";
import { corpo, json } from "@/servidor/http";
import { emDesenvolvimento } from "@/servidor/modo";
import { abrirSessao } from "@/servidor/sessao";

/**
 * POST /api/auth/senha — entrada por senha.
 *
 * O stub aceita qualquer senha. Nada de Argon2id, rate limiting ou recusa de
 * senha desativada aqui — isso é a etapa 3.1 inteira; o que já vale é o shape do
 * request, do response e o efeito no cookie.
 *
 * **O modo do app decide onde a senha leva.** Em produção ela abre uma sessão
 * *sem* passkey, que é o estado que só dá acesso ao cadastro de biometria: é o
 * pedágio do primeiro acesso, e depois dele a senha não serve mais. Em
 * desenvolvimento ela abre uma sessão **completa** e cai no dashboard, porque a
 * senha é o único acesso possível num desktop sem autenticador — e passar pelo
 * cadastro de biometria a cada entrada, num fluxo que a etapa 2 ainda não
 * consegue completar de verdade, tornaria o app impossível de usar na máquina de
 * desenvolvimento.
 *
 * Na etapa 3.1 isto passa a ser uma consulta: a senha é recusada quando
 * `credencial_senha.ativa` é `false`, e em produção o cadastro da passkey é o
 * que escreve esse `false`.
 */
export async function POST(req: Request) {
  const r = await corpo(req, loginComSenha);
  if (!r.ok) return json(r.resposta, r.status);

  const completa = emDesenvolvimento();
  await abrirSessao(completa);

  const concluido: LoginConcluido = {
    proximoPasso: completa ? "dashboard" : "cadastrar_biometria",
  };
  return json(concluido);
}

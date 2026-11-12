import { loginComSenha, type LoginConcluido } from "@/contracts";
import { corpo, json } from "@/servidor/http";
import { abrirSessao } from "@/servidor/sessao";

/**
 * POST /api/auth/senha — primeiro acesso.
 *
 * O stub aceita qualquer senha e abre uma sessão **sem passkey**, que é o estado
 * que só dá acesso ao cadastro de biometria. Nada de Argon2id, rate limiting ou
 * recusa de senha desativada aqui — isso é a etapa 3.1 inteira; o que já vale é
 * o shape do request, do response e o efeito no cookie.
 */
export async function POST(req: Request) {
  const r = await corpo(req, loginComSenha);
  if (!r.ok) return json(r.resposta, r.status);

  await abrirSessao(false);

  const concluido: LoginConcluido = { proximoPasso: "cadastrar_biometria" };
  return json(concluido);
}

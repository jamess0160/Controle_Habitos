import { credencialWebauthn, type LoginConcluido } from "@/contracts";
import { corpo, json } from "@/servidor/http";
import { abrirSessao } from "@/servidor/sessao";

/**
 * POST /api/auth/webauthn/login — acesso recorrente.
 *
 * O stub abre uma sessão completa contra qualquer payload bem formado. O que
 * falta é tudo o que importa: verificação da assinatura, conferência do
 * `counter` anti-clonagem e atualização de `ultimo_uso_em` (etapa 3.1).
 */
export async function POST(req: Request) {
  const r = await corpo(req, credencialWebauthn);
  if (!r.ok) return json(r.resposta, r.status);

  await abrirSessao(true);

  const concluido: LoginConcluido = { proximoPasso: "dashboard" };
  return json(concluido);
}

import type { Ok } from "@/contracts";
import { json } from "@/servidor/http";
import { fecharSessao } from "@/servidor/sessao";

/**
 * POST /api/auth/logout
 *
 * Não exige sessão: sair sem estar dentro é idempotente, e devolver 401 aqui só
 * atrapalharia a tela que tenta limpar o estado depois de um cookie expirado.
 */
export async function POST() {
  await fecharSessao();

  const ok: Ok = { ok: true };
  return json(ok);
}

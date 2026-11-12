import { opcoesLoginFixture } from "@/contracts/fixtures";
import { json } from "@/servidor/http";

/**
 * POST /api/auth/webauthn/login/opcoes
 *
 * Rota pública por necessidade: é o começo da reentrada, quando não há sessão
 * nenhuma. O desafio é gerado no servidor e verificado no POST seguinte.
 */
export async function POST() {
  return json(opcoesLoginFixture);
}

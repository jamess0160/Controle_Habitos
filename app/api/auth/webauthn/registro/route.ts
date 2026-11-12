import { credencialWebauthn } from "@/contracts";
import { passkeyCadastradaFixture } from "@/contracts/fixtures";
import { corpo, exigirSessao, json } from "@/servidor/http";
import { abrirSessao } from "@/servidor/sessao";

/**
 * POST /api/auth/webauthn/registro
 *
 * Promove a sessão do primeiro acesso a sessão completa — é o ponto em que a
 * guarda do proxy solta o usuário do `/biometria`. Na etapa 3.1 o mesmo ponto
 * grava `credencial_passkey`, desativa `credencial_senha` e revoga as sessões
 * anteriores; aqui só o cookie muda de valor.
 */
export async function POST(req: Request) {
  const acesso = await exigirSessao();
  if (!acesso.liberado) return acesso.resposta;

  const r = await corpo(req, credencialWebauthn);
  if (!r.ok) return json(r.resposta, r.status);

  await abrirSessao(true);

  return json(passkeyCadastradaFixture, 201);
}

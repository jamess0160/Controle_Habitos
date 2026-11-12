import { editarConfig } from "@/contracts";
import { configAppFixture } from "@/contracts/fixtures";
import { corpo, exigirAcesso, json } from "@/servidor/http";

/** GET /api/config — o que a tela de Ajustes mostra. */
export async function GET() {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  return json(configAppFixture);
}

/**
 * PATCH /api/config
 *
 * Só `horaVirada` e `timezone`. `usuarioNome` vem do `.env` pelo seed, e `rpId`
 * é o domínio das passkeys — editá-lo invalidaria a biometria cadastrada, então
 * não existe campo para ele nem aqui nem na tela.
 */
export async function PATCH(req: Request) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const r = await corpo(req, editarConfig);
  if (!r.ok) return json(r.resposta, r.status);

  return json(configAppFixture);
}

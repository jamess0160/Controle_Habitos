import { resetarBiometria } from "@/contracts";
import { biometriaResetadaFixture } from "@/contracts/fixtures";
import { corpo, exigirAcesso, json } from "@/servidor/http";
import { fecharSessao } from "@/servidor/sessao";

/**
 * POST /api/auth/biometria/reset
 *
 * O reset pela interface, de Ajustes, com sessão válida. Apaga a passkey,
 * reativa a senha, revoga as sessões e devolve ao login — por isso o handler
 * fecha a própria sessão: deixar o cookie de pé contradiria a revogação em
 * massa que acabou de acontecer.
 *
 * A senha provisória trafega uma única vez, no corpo desta resposta, e não é
 * recuperável depois. A fixture devolve um texto que não serve para nada, para
 * um teste manual não deixar senha de fixture funcionando em lugar algum.
 */
export async function POST(req: Request) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const r = await corpo(req, resetarBiometria);
  if (!r.ok) return json(r.resposta, r.status);

  await fecharSessao();

  return json(biometriaResetadaFixture);
}

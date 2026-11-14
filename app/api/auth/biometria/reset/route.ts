import { resetarBiometria, type BiometriaResetada } from "@/contracts";
import { definirSenhaProvisoria } from "@/servidor/credencial";
import { corpo, exigirAcesso, json } from "@/servidor/http";
import { apagarPasskeys } from "@/servidor/webauthn";
import { db } from "@/db/knex";
import { cookies } from "next/headers";
import { COOKIE_SESSAO } from "@/servidor/sessao";

/**
 * POST /api/auth/biometria/reset — o reset pela interface.
 *
 * Serve para trocar de dispositivo de forma planejada: resetar no aparelho
 * antigo, entrar com senha no novo, cadastrar a biometria dele. Exige sessão
 * válida — quem não tem é atendido pela CLI.
 *
 * Tudo numa transação, porque um reset parcial é o pior resultado possível:
 * passkey apagada sem senha reativada deixa o app **sem nenhuma porta**, e o
 * conserto exige acesso ao Postgres.
 *
 * Três coisas fora da transação, de propósito:
 *
 * - **o cookie**, que não é banco e não participa de rollback;
 * - **`tentativa_login`**, limpa junto porque um bloqueio herdado trancaria a
 *   senha nova — o bloqueio existe contra quem adivinha, não contra quem acabou
 *   de provar que tem sessão;
 * - **a senha provisória em claro**, que trafega uma vez nesta resposta e não é
 *   recuperável depois. Não há lugar onde ela possa ser lida de novo.
 */
export async function POST(req: Request) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const r = await corpo(req, resetarBiometria);
  if (!r.ok) return json(r.resposta, r.status);

  const resultado = await db.transaction(async (trx) => {
    await apagarPasskeys(trx);
    const senhaProvisoria = await definirSenhaProvisoria(trx);

    const sessoesRevogadas = await trx("sessao")
      .whereNull("revogada_em")
      .update({ revogada_em: new Date() });

    await trx("tentativa_login").delete();
    /* Desafios pendentes referenciam passkeys que acabaram de deixar de existir. */
    await trx("webauthn_desafio").delete();

    return { senhaProvisoria, sessoesRevogadas };
  });

  /*
   * O cookie cai depois do commit: deixá-lo de pé contradiria a revogação que
   * acabou de acontecer, e apagá-lo antes deixaria o usuário sem sessão se a
   * transação rolasse atrás.
   */
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_SESSAO);

  const resetada: BiometriaResetada = resultado;
  return json(resetada);
}

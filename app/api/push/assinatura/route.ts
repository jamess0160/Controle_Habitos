import { assinarPush } from "@/contracts";
import { corpo, exigirAcesso, json } from "@/servidor/http";
import { assinarPushNoBanco, desassinarPush } from "@/servidor/push";

/**
 * POST e DELETE da assinatura de push.
 *
 * O corpo é o `PushSubscription` que o navegador entrega depois do consentimento
 * — endpoint mais as duas chaves. Quem envia de verdade é o worker; esta rota só
 * guarda a assinatura e devolve o status que a tela de Ajustes mostra.
 *
 * A baixa automática em 404/410 é do envio, não daqui: só quem tenta entregar
 * descobre que o endpoint morreu.
 */
export async function POST(req: Request) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const r = await corpo(req, assinarPush);
  if (!r.ok) return json(r.resposta, r.status);

  return json(await assinarPushNoBanco(r.dados), 201);
}

/**
 * DELETE /api/push/assinatura — desligar as notificações.
 *
 * Apaga todas as assinaturas, sem distinguir aparelho: o app é de um usuário com
 * um dispositivo, a mesma premissa do cadastro de biometria. Ver a nota em
 * [push.ts](../../../../servidor/push.ts).
 */
export async function DELETE() {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  return json(await desassinarPush());
}

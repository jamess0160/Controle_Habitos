import { assinarPush, type StatusPush } from "@/contracts";
import { statusPushFixture } from "@/contracts/fixtures";
import { corpo, exigirAcesso, json } from "@/servidor/http";

/**
 * POST e DELETE da assinatura de push.
 *
 * O corpo é o `PushSubscription` que o navegador entrega depois do consentimento
 * — endpoint mais as duas chaves. Quem envia de verdade é o worker do compose,
 * com VAPID; esta rota só guarda a assinatura. A baixa automática em 404/410
 * também é do worker (etapa 3.5).
 */
export async function POST(req: Request) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const r = await corpo(req, assinarPush);
  if (!r.ok) return json(r.resposta, r.status);

  return json(statusPushFixture, 201);
}

/** DELETE /api/push/assinatura — desligar as notificações neste dispositivo. */
export async function DELETE() {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const desassinado: StatusPush = { assinado: false, ultimoEnvioEm: null, invalidaEm: null };
  return json(desassinado);
}

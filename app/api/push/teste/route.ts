import type { Ok } from "@/contracts";
import { exigirAcesso, json } from "@/servidor/http";

/**
 * POST /api/push/teste
 *
 * Existe para a etapa 4: push só se prova no celular, com a PWA instalada e
 * fechada, e sem um disparo sob demanda o teste manual dependeria de esperar o
 * horário de um lembrete real.
 */
export async function POST() {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const ok: Ok = { ok: true };
  return json(ok);
}

import { exigirAcesso, json } from "@/servidor/http";
import { montarHoje } from "@/servidor/hoje";

/**
 * GET /api/hoje — o dashboard.
 *
 * Uma linha por **interação devida**: um hábito fixo de dois horários rende duas
 * linhas marcáveis, ambas com a mesma sequência, porque a sequência é do hábito.
 *
 * A saudação vem daqui, pela hora de parede, e não do cliente: à 01:00 é "boa
 * noite" ainda que o dia lógico seja o anterior, e o relógio do celular não é
 * fonte confiável para a virada das 04:00.
 */
export async function GET() {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  return json(await montarHoje());
}

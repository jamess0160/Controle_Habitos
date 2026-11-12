import { hojeFixture } from "@/contracts/fixtures";
import { exigirAcesso, json } from "@/servidor/http";

/**
 * GET /api/hoje — o dashboard.
 *
 * A fixture é uma terça-feira à tarde com as quatro formas de progresso e as
 * duas linhas que um hábito fixo de dois horários gera. É o payload que fecha a
 * etapa 1 pelo critério do roadmap, e o que a etapa 2 desenha.
 */
export async function GET() {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  return json(hojeFixture);
}

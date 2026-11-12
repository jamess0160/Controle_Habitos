import { criarHabito } from "@/contracts";
import { habitoAgua, listaDeHabitosFixture } from "@/contracts/fixtures";
import { corpo, exigirAcesso, json } from "@/servidor/http";

/** GET /api/habitos — ativos e arquivados, na ordem de `habito.ordem`. */
export async function GET() {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  return json(listaDeHabitosFixture);
}

/**
 * POST /api/habitos
 *
 * Aqui a validação é o conteúdo do stub: `criarHabito` recusa toda combinação
 * que os CHECKs de `habito_config` recusariam — modo fixo com `cada_n_dias`,
 * `metaOcorrencias` no modo fixo, quantificado sem unidade — e o formulário de
 * 6 passos da etapa 2 pode ser construído contra essas respostas de erro em vez
 * de contra uma lista de regras copiada à mão.
 */
export async function POST(req: Request) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const r = await corpo(req, criarHabito);
  if (!r.ok) return json(r.resposta, r.status);

  return json(habitoAgua, 201);
}

import { opcoesRegistroFixture } from "@/contracts/fixtures";
import { exigirSessao, json } from "@/servidor/http";

/**
 * POST /api/auth/webauthn/registro/opcoes
 *
 * Exige sessão mas **não** exige passkey — é exatamente a rota que a sessão do
 * primeiro acesso precisa alcançar, então usa `exigirSessao` e não
 * `exigirAcesso`.
 *
 * Na etapa 3.1 esta rota grava `webauthn_desafio` antes de responder, e o
 * desafio é conferido no POST seguinte. É também a rota a limitar por taxa — não
 * por haver segredo a adivinhar, mas para não servir de torneira de escrita
 * naquela tabela.
 */
export async function POST() {
  const acesso = await exigirSessao();
  if (!acesso.liberado) return acesso.resposta;

  return json(opcoesRegistroFixture);
}

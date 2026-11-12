import { exportacaoFixture } from "@/contracts/fixtures";
import { exigirAcesso, json } from "@/servidor/http";

/**
 * GET /api/exportar
 *
 * Enquanto não houver backup automatizado e **restauração testada** (etapa 5),
 * este arquivo é a única cópia dos dados fora do Postgres do homelab. Por isso o
 * formato é cru de propósito: hábitos com a configuração vigente e todos os
 * registros, sem derivados — período, sequência e congelamento o domínio
 * reconstrói, e um backup que guarda o derivado envelhece junto com as regras.
 *
 * O `Content-Disposition` é o que faz o navegador salvar em vez de renderizar
 * JSON na tela.
 */
export async function GET() {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  return json(exportacaoFixture, 200, {
    "Content-Disposition": `attachment; filename="habitos-${exportacaoFixture.geradoEm.slice(0, 10)}.json"`,
  });
}

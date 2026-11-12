import { preencherRetroativo, type RetroativoAplicado } from "@/contracts";
import { retroativoFixture, retroativoPreviaFixture } from "@/contracts/fixtures";
import { corpo, exigirAcesso, json } from "@/servidor/http";

/** GET /api/habitos/:id/retroativo — a janela de 7 dias com os bloqueios visíveis. */
export async function GET(_req: Request, _ctx: RouteContext<"/api/habitos/[id]/retroativo">) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  return json(retroativoFixture);
}

/**
 * POST /api/habitos/:id/retroativo
 *
 * `previa: true` calcula sem persistir, e é o que permite mostrar o novo
 * vencimento de um `cada_n_dias` **antes** de confirmar: ali o efeito vai muito
 * além do dia tocado, porque mover a âncora re-encadeia todos os períodos
 * seguintes. Foi o acréscimo que o [contrato](../../../../../contracts/registro.ts)
 * fez ao inventário de rotas, para a tela não precisar de um endpoint de
 * simulação separado.
 *
 * As duas respostas têm o mesmo shape, mudando só `persistido` — a tela usa o
 * mesmo código para a prévia e para a confirmação.
 */
export async function POST(req: Request, _ctx: RouteContext<"/api/habitos/[id]/retroativo">) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const r = await corpo(req, preencherRetroativo);
  if (!r.ok) return json(r.resposta, r.status);

  const aplicado: RetroativoAplicado = {
    ...retroativoPreviaFixture,
    persistido: !r.dados.previa,
  };

  return json(aplicado);
}

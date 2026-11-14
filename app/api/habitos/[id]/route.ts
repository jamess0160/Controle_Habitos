import { editarHabito } from "@/contracts";
import { corpo, exigirAcesso, falha, json } from "@/servidor/http";
import { buscarHabito, editarHabitoNoBanco } from "@/servidor/habitos";

/** GET /api/habitos/:id */
export async function GET(_req: Request, ctx: RouteContext<"/api/habitos/[id]">) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const { id } = await ctx.params;
  const habito = await buscarHabito(id);

  if (habito === null) return falha("nao_encontrado", "Hábito não encontrado.");

  return json(habito);
}

/**
 * PATCH /api/habitos/:id — cria uma **nova versão** da configuração.
 *
 * O tipo do hábito vem do **banco**, nunca do payload, e é o que escolhe o
 * schema: `editarHabito(tipo)` só aceita meta daquele tipo. O tipo é imutável
 * porque trocá-lo reinterpretaria todo o histórico pela régua errada — e no
 * banco a FK composta `(habito_id, tipo)` com `ON UPDATE CASCADE` propagaria a
 * troca para as versões antigas, que então quebrariam os CHECKs de meta.
 *
 * Ler o tipo antes de validar custa uma consulta e é o que faz o 422 ser
 * honesto: um PATCH de `duracao` num hábito `quantificado` é recusado pelo
 * contrato, com o campo apontado, e não por um erro de CHECK do Postgres.
 */
export async function PATCH(req: Request, ctx: RouteContext<"/api/habitos/[id]">) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const { id } = await ctx.params;
  const atual = await buscarHabito(id);

  if (atual === null) return falha("nao_encontrado", "Hábito não encontrado.");

  const r = await corpo(req, editarHabito(atual.config.meta.tipo));
  if (!r.ok) return json(r.resposta, r.status);

  const habito = await editarHabitoNoBanco(id, r.dados);

  if (habito === null) return falha("nao_encontrado", "Hábito não encontrado.");

  return json(habito);
}

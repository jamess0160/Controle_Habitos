import { editarHabito } from "@/contracts";
import { corpo, exigirAcesso, falha, json } from "@/servidor/http";
import { apagarHabitoNoBanco, buscarHabito, editarHabitoNoBanco } from "@/servidor/habitos";

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

/**
 * DELETE /api/habitos/:id — apaga o hábito e todo o histórico dele.
 *
 * **Cuidado com o vizinho:** `DELETE /api/habitos/:id/arquivo` significa
 * *desarquivar*, que é o oposto disto. Dois `DELETE` com sentidos contrários a
 * um segmento de distância é fácil de confundir numa chamada escrita à mão, e a
 * diferença é um hábito restaurado contra um hábito destruído.
 *
 * Só apaga hábito **arquivado**. Arquivar já é a saída reversível e vira o
 * primeiro de dois passos, para a ação irreversível não ficar a um toque. Hábito
 * ativo é recusado com `regra_violada` — ele existe, e a mensagem manda arquivar
 * primeiro.
 */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/habitos/[id]">) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const { id } = await ctx.params;
  const r = await apagarHabitoNoBanco(id);

  if (!r.ok) {
    return r.falha === "nao_encontrado"
      ? falha("nao_encontrado", "Hábito não encontrado.")
      : falha("regra_violada", "Arquive o hábito antes de apagá-lo.");
  }

  return json(r.dados);
}

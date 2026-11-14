import type { Knex } from "knex";
import type { CriarRegistro, Efeitos, RegistroCriado } from "@/contracts";
import { db } from "@/db/knex";
import { type DataLogica, comoDataLogica } from "@/dominio/calendario";
import { janelaSeguinte } from "@/dominio/periodo";
import { type ResultadoSimulacao, type VersaoConfig } from "@/dominio/simulacao";
import { materializar, versoesDe } from "./materializar";
import { hojeLogico, relogioAtual } from "./relogio";

/**
 * Registro: criar e apagar.
 *
 * As duas operações têm a mesma forma — escreve em `registro`, re-materializa o
 * hábito, devolve os `efeitos`. Apagar não é o inverso aproximado de criar: é a
 * **mesma** conta com uma entrada a menos, o que é o ganho inteiro de a
 * materialização ser um replay.
 *
 * Nada aqui calcula sequência ou congelamento à mão. O que a rota devolve sai de
 * `simular()`, pela materialização, e é por isso que o retroativo e a marcação
 * de hoje não têm duas implementações do fechamento.
 */

export type FalhaDeRegistro =
  | { tipo: "habito_inexistente" }
  | { tipo: "habito_arquivado" }
  | { tipo: "habito_pausado" }
  | { tipo: "fora_da_janela"; dias: number }
  | { tipo: "sem_periodo"; dataLogica: DataLogica }
  | { tipo: "ocorrencia_invalida" }
  | { tipo: "registro_inexistente" }
  /* As duas do retroativo: dia sem momento devido, e dia que já está fechado. */
  | { tipo: "dia_nao_previsto" }
  | { tipo: "dia_ja_cumprido" };

/** Janela retroativa do mapa de regras: 7 dias, incluindo hoje. */
export const JANELA_RETROATIVA = 7;

export function mensagemDeFalhaDeRegistro(falha: FalhaDeRegistro): string {
  switch (falha.tipo) {
    case "habito_inexistente":
      return "Hábito não encontrado.";
    case "habito_arquivado":
      return "Este hábito está arquivado.";
    case "habito_pausado":
      return "Este hábito está pausado. Retome antes de marcar.";
    case "fora_da_janela":
      return `Só é possível preencher os últimos ${falha.dias} dias.`;
    case "sem_periodo":
      return `Nenhum período do hábito cobre ${falha.dataLogica}.`;
    case "ocorrencia_invalida":
      return "O momento informado não pertence a este hábito.";
    case "registro_inexistente":
      return "Registro não encontrado.";
    case "dia_nao_previsto":
      return "Este dia não é dia deste hábito.";
    case "dia_ja_cumprido":
      return "Este dia já está cumprido.";
  }
}

export type Resultado<T> = { ok: true; dados: T } | { ok: false; falha: FalhaDeRegistro };

// ─── Criar ───────────────────────────────────────────────────────────────────

/**
 * Cria um registro e devolve o que mudou.
 *
 * `dataLogica` ausente significa **agora**, e quem aplica a virada das 04:00 é o
 * servidor: o relógio do celular não é fonte confiável para isso, e deixar o
 * cliente escolher o período erraria justamente a marcação de madrugada. É a
 * armadilha nº 1 do projeto no ponto em que ela mais custa.
 */
export async function criarRegistroNoBanco(
  pedido: CriarRegistro,
): Promise<Resultado<RegistroCriado>> {
  const relogio = await relogioAtual();
  const agora = new Date();
  const hoje = await hojeLogico(agora);
  /*
   * O contrato entrega `dataLogica` como string; o domínio trabalha com o tipo
   * marcado. `comoDataLogica` é a fronteira, e valida o formato de passagem — é
   * o que impede uma data do cliente entrar no cálculo sem ser conferida.
   */
  const dataLogica =
    pedido.dataLogica === undefined ? hoje : comoDataLogica(pedido.dataLogica);

  const guarda = await conferirHabito(db, pedido.habitoId, dataLogica, hoje);
  if (!guarda.ok) return guarda;

  return db.transaction(async (trx) => {
    const consumidosAntes = await consumidosDe(trx, pedido.habitoId);

    const periodo = await periodoDe(trx, pedido.habitoId, dataLogica);
    if (periodo === undefined) return falhar({ tipo: "sem_periodo", dataLogica });

    const ocorrenciaId = await resolverOcorrencia(trx, periodo.id, pedido.ocorrenciaId ?? null);
    if (ocorrenciaId === "invalida") return falhar({ tipo: "ocorrencia_invalida" });

    /* Sem valor é marcação binária, que vale 1 — a regra do contrato. */
    const valor = pedido.valor ?? 1;

    const [criado] = await trx("registro")
      .insert({
        periodo_id: periodo.id,
        ocorrencia_id: ocorrenciaId,
        data_logica: dataLogica,
        valor,
        origem: pedido.origem,
        criado_em: agora,
      })
      .returning(["id", "criado_em"]);

    const resultado = await materializar(trx, pedido.habitoId, {
      hoje,
      timezone: relogio.timezone,
      agora,
    });

    /*
     * O período é relido **depois** da materialização: ela apagou e recriou as
     * linhas, então o `periodo.id` de antes não existe mais. O que a tela precisa
     * é o período em que o registro caiu agora.
     */
    const depois = await periodoDe(trx, pedido.habitoId, dataLogica);

    const registro: RegistroCriado = {
      id: criado.id,
      habitoId: pedido.habitoId,
      periodoId: depois?.id ?? periodo.id,
      ocorrenciaId: await ocorrenciaDoRegistro(trx, criado.id),
      dataLogica,
      valor,
      origem: pedido.origem,
      criadoEm: criado.criado_em.toISOString(),
      efeitos: efeitosDe(
        resultado,
        await versoesDe(trx, pedido.habitoId),
        dataLogica,
        consumidosAntes,
      ),
    };

    return { ok: true as const, dados: registro };
  });
}

// ─── Apagar ──────────────────────────────────────────────────────────────────

/**
 * Apaga um registro e devolve os efeitos.
 *
 * Devolve os mesmos `efeitos` de uma marcação, e não `ok: true`: apagar
 * recalcula a sequência, pode estornar um congelamento e, em `cada_n_dias`, mover
 * o vencimento. Sem o payload dizer, a tela teria de recarregar tudo para
 * descobrir o que mudou.
 */
export async function apagarRegistroNoBanco(
  registroId: string,
): Promise<Resultado<{ efeitos: Efeitos; habitoId: string; valor: number; dataLogica: DataLogica }>> {
  const relogio = await relogioAtual();
  const agora = new Date();
  const hoje = await hojeLogico(agora);

  return db.transaction(async (trx) => {
    const linha = (await trx("registro")
      .join("habito_periodo", "habito_periodo.id", "registro.periodo_id")
      .where("registro.id", registroId)
      .first(
        "registro.data_logica",
        "registro.valor",
        "habito_periodo.habito_id",
      )) as unknown as { data_logica: string; valor: number; habito_id: string } | undefined;

    if (linha === undefined) return falhar({ tipo: "registro_inexistente" });

    const consumidosAntes = await consumidosDe(trx, linha.habito_id);

    await trx("registro").where({ id: registroId }).delete();

    const resultado = await materializar(trx, linha.habito_id, {
      hoje,
      timezone: relogio.timezone,
      agora,
    });

    const dataLogica = comoDataLogica(linha.data_logica);

    return {
      ok: true as const,
      dados: {
        efeitos: efeitosDe(
          resultado,
          await versoesDe(trx, linha.habito_id),
          dataLogica,
          consumidosAntes,
        ),
        habitoId: linha.habito_id,
        valor: Number(linha.valor),
        dataLogica,
      },
    };
  });
}

// ─── Guardas ─────────────────────────────────────────────────────────────────

export function falhar(falha: FalhaDeRegistro) {
  return { ok: false as const, falha };
}

/**
 * As recusas que valem para marcar e para preencher retroativamente.
 *
 * A janela de 7 dias é a **única** forma de corrigir o passado no app, segundo o
 * mapa de regras — não há prazo de resgate nem estado `em_risco`. Fora dela, a
 * resposta é recusa com motivo, não silêncio.
 */
export async function conferirHabito(
  conexao: Knex,
  habitoId: string,
  dataLogica: DataLogica,
  hoje: DataLogica,
): Promise<Resultado<null>> {
  const habito = await conexao("habito")
    .where({ id: habitoId })
    .first("arquivado_em", "pausado_de", "pausado_ate");

  if (habito === undefined) return falhar({ tipo: "habito_inexistente" });
  if (habito.arquivado_em !== null) return falhar({ tipo: "habito_arquivado" });

  if (dataLogica > hoje) {
    return falhar({ tipo: "fora_da_janela", dias: JANELA_RETROATIVA });
  }

  const diferenca = diasEntre(dataLogica, hoje);
  if (diferenca >= JANELA_RETROATIVA) {
    return falhar({ tipo: "fora_da_janela", dias: JANELA_RETROATIVA });
  }

  if (habito.pausado_de !== null) {
    const dentroDaPausa =
      habito.pausado_de <= dataLogica &&
      (habito.pausado_ate === null || dataLogica <= habito.pausado_ate);

    if (dentroDaPausa) return falhar({ tipo: "habito_pausado" });
  }

  return { ok: true, dados: null };
}

function diasEntre(de: string, ate: string): number {
  const ms = Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export async function periodoDe(conexao: Knex, habitoId: string, dataLogica: DataLogica) {
  return conexao("habito_periodo")
    .where({ habito_id: habitoId })
    .where("inicio", "<=", dataLogica)
    .where("fim", ">=", dataLogica)
    .orderBy("inicio", "desc")
    .first("id", "config_id");
}

/**
 * Resolve a ocorrência do registro.
 *
 * No modo fixo o cliente manda `ocorrenciaId`; no flexível manda `null` e a
 * tabela fica vazia. Um id que não pertence ao período é recusado em vez de
 * ignorado: aceitá-lo gravaria o registro no slot de outro dia, e o dashboard
 * mostraria a dose da manhã cumprida pela marcação da noite.
 */
async function resolverOcorrencia(
  conexao: Knex,
  periodoId: string,
  ocorrenciaId: string | null,
): Promise<string | null | "invalida"> {
  if (ocorrenciaId === null) return null;

  const existe = await conexao("habito_ocorrencia")
    .where({ id: ocorrenciaId, periodo_id: periodoId })
    .first("id");

  return existe === undefined ? "invalida" : ocorrenciaId;
}

/**
 * A ocorrência em que o registro ficou **depois** da materialização.
 *
 * Pode diferir da enviada: a materialização recria as ocorrências, então o id
 * muda. O registro preserva o dele, e é por ele que se encontra onde ele caiu.
 */
async function ocorrenciaDoRegistro(conexao: Knex, registroId: string): Promise<string | null> {
  const linha = await conexao("registro").where({ id: registroId }).first("ocorrencia_id");
  return linha?.ocorrencia_id ?? null;
}

/**
 * Traduz o resultado da simulação nos `efeitos` do contrato.
 *
 * `novoVencimento` só é preenchido em `cada_n_dias`, e é o ponto em que a
 * cadência ancorada aparece na interface: concluir a meta encerra o período
 * naquela data e re-encadeia os seguintes, então o próximo vencimento mudou de
 * lugar. Nas outras cadências o vencimento é do calendário e não há o que contar.
 */
export function efeitosDe(
  resultado: ResultadoSimulacao,
  configs: VersaoConfig[],
  dataLogica: DataLogica,
  consumidosAntes: number,
): Efeitos {
  const periodo =
    resultado.periodos.find((p) => p.inicio <= dataLogica && dataLogica <= p.fim) ??
    resultado.periodos.at(-1);

  /*
   * `novoVencimento` só existe em `cada_n_dias`, e é onde a cadência ancorada
   * aparece na interface: concluir a meta encerra o período naquela data e
   * re-encadeia os seguintes, então o próximo vencimento mudou de lugar. Nas
   * outras cadências o vencimento é do calendário e não há nada a contar —
   * mandar a data ali faria a tela pedir confirmação de uma mudança que não houve.
   */
  const cadencia = configs.find((c) => c.id === periodo?.configId)?.cadencia;

  return {
    sequencia: resultado.sequencia,
    congelamentosDisponiveis: resultado.congelamentos.disponiveis,
    /*
     * Estorno é **comparação**, não evento: a materialização recalcula o estoque
     * do zero, então o que diz que um congelamento voltou é o total consumido ter
     * diminuído. É o mesmo sinal para marcar e para desmarcar, e não depende de
     * a simulação ter um conceito de estorno — ela não tem, e não precisa.
     */
    congelamentoEstornado: resultado.congelamentos.consumidos < consumidosAntes,
    periodoStatus: periodo?.status ?? "aberto",
    novoVencimento:
      cadencia?.tipo === "cada_n_dias" ? proximoVencimento(resultado, cadencia) : null,
  };
}

/**
 * O próximo vencimento de uma cadência ancorada.
 *
 * Normalmente é o `fim` do período aberto. Mas quando a meta acaba de ser
 * cumprida **não existe** período aberto: a simulação para em hoje, e o próximo
 * só nasce amanhã. Nesse caso o vencimento é calculado com a mesma função que a
 * simulação usaria — `janelaSeguinte` a partir do fim efetivo —, e não com uma
 * soma à mão, que seria uma segunda definição da regra de encadeamento.
 */
function proximoVencimento(
  resultado: ResultadoSimulacao,
  cadencia: { tipo: "cada_n_dias"; intervalo: number },
): string | null {
  const aberto = resultado.periodos.find((p) => p.status === "aberto");
  if (aberto !== undefined) return aberto.fim;

  const ultimo = resultado.periodos.at(-1);
  if (ultimo === undefined) return null;

  return janelaSeguinte(cadencia, ultimo.fim).fim;
}

/** Congelamentos já gastos, antes da escrita — a referência do estorno. */
export async function consumidosDe(conexao: Knex, habitoId: string): Promise<number> {
  const [{ total }] = await conexao("congelamento")
    .where({ habito_id: habitoId, status: "consumido" })
    .count({ total: "*" });

  return Number(total);
}

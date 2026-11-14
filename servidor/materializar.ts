import type { Knex } from "knex";
import { type DataLogica, comoDataLogica, somarDias } from "@/dominio/calendario";
import { unidadeCumprida } from "@/dominio/meta";
import { slotsDaJanela } from "@/dominio/periodo";
import {
  type EntradaSimulacao,
  type PeriodoSimulado,
  type ResultadoSimulacao,
  type VersaoConfig,
  simular,
} from "@/dominio/simulacao";
import { instanteDe, versaoDeConfig } from "@/db/mapa-dominio";
import { hojeLogico, horaDeParede } from "./relogio";

/**
 * Materialização: reescreve as tabelas derivadas de um hábito a partir dos
 * registros que existem agora.
 *
 * É o coração das etapas 3.2 a 3.4, e o motivo de existir está no
 * [Mapa de regras](../Docs/mapas/Mapa%20de%20regras.md): `habito_periodo`,
 * `habito_ocorrencia`, `congelamento` e `habito_streak` **não são fonte de
 * verdade** — são o resultado de `simular()` gravado para poder ser lido rápido.
 * A fonte são `habito_config` (versionada), `registro` e a pausa.
 *
 * Isso torna um conjunto grande de operações a mesma operação: criar hábito,
 * editar a configuração, pausar, retomar, marcar, desmarcar e preencher
 * retroativamente são todas "mudou a entrada, replay". O re-encadeamento de
 * `cada_n_dias` e o estorno de congelamento caem de graça, em vez de serem
 * conserto incremental caso a caso — que é onde esse tipo de código erra.
 *
 * ## Por que os registros são relidos e reinseridos
 *
 * `registro.periodo_id` é `NOT NULL` com `ON DELETE CASCADE` para
 * `habito_periodo`. Apagar os períodos para recalculá-los **apagaria os
 * registros junto** — a fonte de verdade iria embora com a materialização. Então
 * os registros são lidos antes, os períodos apagados, e os registros reinseridos
 * **com os mesmos ids**.
 *
 * Preservar o id não é detalhe: `linhaDeHoje.ultimoRegistro.id` e
 * `diaRetroativo.registroIds` viajam até a tela, e um id que muda a cada
 * materialização transformaria o botão de desfazer em 404.
 */

export type RegistroPreservado = {
  id: string;
  dataLogica: DataLogica;
  valor: number;
  origem: "app" | "retroativo" | "cronometro";
  criadoEm: Date;
  /** Horário do slot que ele cumpria, no modo fixo. */
  horario: string | null;
};

/**
 * Lê os registros de um hábito junto com o horário do slot que cada um cumpria.
 *
 * O horário não é coluna de `registro`: ele vem de `habito_ocorrencia.previsto_para`,
 * que será apagado na materialização. Por isso é capturado aqui, antes.
 */
export async function registrosDe(
  conexao: Knex,
  habitoId: string,
  timezone: string,
): Promise<RegistroPreservado[]> {
  /*
   * O tipo do resultado é declarado à mão porque `Knex.TableType` descreve
   * tabelas, não junções: num `join` o Knex não tem como compor as duas e o
   * retorno vira `never`. A anotação aqui é a única forma de manter a linha
   * tipada sem abandonar o `TableType` do resto do arquivo.
   */
  const linhas = (await conexao("registro")
    .join("habito_periodo", "habito_periodo.id", "registro.periodo_id")
    .leftJoin("habito_ocorrencia", "habito_ocorrencia.id", "registro.ocorrencia_id")
    .where("habito_periodo.habito_id", habitoId)
    .orderBy("registro.criado_em", "asc")
    .select(
      "registro.id",
      "registro.data_logica",
      "registro.valor",
      "registro.origem",
      "registro.criado_em",
      "habito_ocorrencia.previsto_para",
    )) as unknown as Array<{
    id: string;
    data_logica: string;
    valor: number;
    origem: RegistroPreservado["origem"];
    criado_em: Date;
    previsto_para: Date | null;
  }>;

  return linhas.map((l) => ({
    id: l.id,
    dataLogica: comoDataLogica(l.data_logica),
    valor: Number(l.valor),
    origem: l.origem,
    criadoEm: l.criado_em,
    horario: l.previsto_para === null ? null : horaDeParede(l.previsto_para, timezone),
  }));
}

export async function versoesDe(conexao: Knex, habitoId: string): Promise<VersaoConfig[]> {
  const linhas = await conexao("habito_config")
    .where({ habito_id: habitoId })
    .orderBy("versao", "asc");

  return linhas.map(versaoDeConfig);
}

/** Instante de fechamento do período, conforme o status. */
function fechamentoDe(periodo: PeriodoSimulado): Date | null {
  if (periodo.status === "aberto") return null;
  /* Cumprido fecha na conclusão; perdido e congelado só na virada seguinte. */
  return periodo.status === "cumprido"
    ? instanteDe(periodo.fim, "21:00:00")
    : instanteDe(somarDias(periodo.fim, 1), "04:00:00");
}

function chaveSlot(data: DataLogica, horario: string | null): string {
  return `${data}|${horario ?? ""}`;
}

/**
 * Replay completo de um hábito. Devolve o resultado da simulação.
 *
 * Tem de rodar **dentro de uma transação** — por um instante o hábito fica sem
 * períodos, e uma leitura concorrente veria um hábito sem histórico. O parâmetro
 * `conexao` é a transação, nunca a pool.
 */
export async function materializar(
  conexao: Knex,
  habitoId: string,
  opcoes: { hoje?: DataLogica; timezone?: string; agora?: Date } = {},
): Promise<ResultadoSimulacao> {
  const habito = await conexao("habito")
    .where({ id: habitoId })
    .first("inicio_em", "pausado_de", "pausado_ate");

  if (habito === undefined) throw new Error(`Hábito ${habitoId} não existe.`);

  const timezone = opcoes.timezone ?? "America/Sao_Paulo";
  const hoje = opcoes.hoje ?? (await hojeLogico());
  const agora = opcoes.agora ?? new Date();

  const configs = await versoesDe(conexao, habitoId);
  if (configs.length === 0) throw new Error(`Hábito ${habitoId} não tem configuração.`);

  const registros = await registrosDe(conexao, habitoId, timezone);

  const entrada: EntradaSimulacao = {
    inicioEm: comoDataLogica(habito.inicio_em),
    configs,
    registros: registros.map((r) => ({
      dataLogica: r.dataLogica,
      valor: r.valor,
      horario: r.horario,
    })),
    pausas:
      habito.pausado_de === null
        ? []
        : [
            {
              de: comoDataLogica(habito.pausado_de),
              ate: habito.pausado_ate === null ? null : comoDataLogica(habito.pausado_ate),
            },
          ],
    hoje,
  };

  const resultado = simular(entrada);

  /*
   * A ordem importa: apagar os períodos leva ocorrências e registros em cascata,
   * então os registros já foram lidos acima. `congelamento` e `habito_streak`
   * saem antes porque referenciam períodos.
   */
  await conexao("congelamento").where({ habito_id: habitoId }).delete();
  await conexao("habito_streak").where({ habito_id: habitoId }).delete();
  await conexao("habito_periodo").where({ habito_id: habitoId }).delete();

  const porConfigId = new Map(configs.map((c) => [c.id, c]));
  const inseridos: Array<{ id: string; periodo: PeriodoSimulado }> = [];

  for (const periodo of resultado.periodos) {
    const [linha] = await conexao("habito_periodo")
      .insert({
        habito_id: habitoId,
        config_id: periodo.configId,
        inicio: periodo.inicio,
        fim: periodo.fim,
        meta_ocorrencias: periodo.metaOcorrencias,
        concluidas: periodo.concluidas,
        status: periodo.status,
        fechado_em: fechamentoDe(periodo),
      })
      .returning("id");

    inseridos.push({ id: linha.id, periodo });
  }

  let repostos = 0;

  for (const { id: periodoId, periodo } of inseridos) {
    const config = porConfigId.get(periodo.configId);
    if (config === undefined) throw new Error(`Config ${periodo.configId} ausente.`);

    const doPeriodo = registros.filter(
      (r) => r.dataLogica >= periodo.inicio && r.dataLogica <= periodo.fim,
    );

    /* Modo fixo materializa as ocorrências; no flexível a tabela fica vazia. */
    const ocorrenciaDoSlot = new Map<string, string>();

    if (config.modo.tipo === "fixo") {
      const slots = slotsDaJanela(
        { inicio: periodo.inicio, fim: periodo.fim },
        config.modoFixo ?? {},
      );

      for (const slot of slots) {
        const doSlot = doPeriodo.filter(
          (r) => r.dataLogica === slot.data && (slot.horario === null || r.horario === slot.horario),
        );
        const cumprida = config.meta.tipo !== "negativo" && unidadeCumprida(config.meta, doSlot);
        const ultimo = doSlot.at(-1);
        const previstoPara = instanteDe(slot.data, slot.horario ?? "08:00:00");

        /*
         * A ocorrência é um ponto no tempo, não o período: assim que o momento
         * passa sem marcação, ela está perdida — mesmo que o período continue
         * aberto. É o que deixa o dashboard distinguir a dose de segunda que
         * ficou para trás da dose de sexta que ainda vai acontecer.
         */
        const [linha] = await conexao("habito_ocorrencia")
          .insert({
            periodo_id: periodoId,
            previsto_para: previstoPara,
            status: cumprida ? "cumprida" : previstoPara < agora ? "perdida" : "pendente",
            cumprida_em: cumprida && ultimo !== undefined ? ultimo.criadoEm : null,
          })
          .returning("id");

        ocorrenciaDoSlot.set(chaveSlot(slot.data, slot.horario), linha.id);
      }
    }

    for (const r of doPeriodo) {
      await conexao("registro").insert({
        /* O id original: ele viaja até a tela e não pode mudar no replay. */
        id: r.id,
        periodo_id: periodoId,
        ocorrencia_id: ocorrenciaDoSlot.get(chaveSlot(r.dataLogica, r.horario)) ?? null,
        data_logica: r.dataLogica,
        valor: r.valor,
        origem: r.origem,
        criado_em: r.criadoEm,
      });
      repostos += 1;
    }
  }

  /*
   * Todo registro tem de voltar a cair em exatamente um período. Não voltar
   * significa registro em dia que a simulação não cobriu — o caso típico é
   * marcação dentro de uma pausa, que a materialização descartaria **em
   * silêncio**, apagando dado do usuário. Falha alto, e a transação desfaz.
   */
  if (repostos !== registros.length) {
    throw new Error(
      `Materialização perderia ${registros.length - repostos} registro(s) do hábito ${habitoId}: ` +
        "há marcação em dia que a simulação não cobre (pausa?).",
    );
  }

  /*
   * Estoque de congelamento: uma linha por unidade, pareando ganho e consumo em
   * FIFO — o mais antigo é o primeiro a ser gasto, e é a mesma ordem que o
   * estorno da etapa 3.4 desfaz.
   */
  const ganhos = inseridos.flatMap(({ id, periodo }) =>
    Array.from({ length: periodo.congelamentosGanhos }, () => ({ id, periodo })),
  );
  const consumidores = inseridos.filter(({ periodo }) => periodo.congelamentoConsumido);

  if (consumidores.length > ganhos.length) {
    throw new Error(`Consumo de congelamento sem lastro no estoque (hábito ${habitoId}).`);
  }

  for (const [i, ganho] of ganhos.entries()) {
    const consumidor = consumidores[i];

    await conexao("congelamento").insert({
      habito_id: habitoId,
      status: consumidor ? "consumido" : "disponivel",
      ganho_em: instanteDe(ganho.periodo.fim, "21:00:00"),
      ganho_por_periodo_id: ganho.id,
      consumido_em: consumidor
        ? instanteDe(somarDias(consumidor.periodo.fim, 1), "04:00:00")
        : null,
      consumido_periodo_id: consumidor?.id ?? null,
    });
  }

  await conexao("habito_streak").insert({
    habito_id: habitoId,
    sequencia_atual: resultado.sequencia.atual,
    sequencia_recorde: resultado.sequencia.recorde,
    total_no_prazo: resultado.sequencia.totalNoPrazo,
    desde: resultado.sequencia.desde,
  });

  return resultado;
}

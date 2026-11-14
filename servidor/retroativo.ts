import type { Knex } from "knex";
import type {
  DiaRetroativo,
  PreencherRetroativo,
  Retroativo,
  RetroativoAplicado,
} from "@/contracts";
import { db } from "@/db/knex";
import { configDoContrato } from "@/db/mapa-dominio";
import {
  type DataLogica,
  comoDataLogica,
  diaDaSemana,
  somarDias,
} from "@/dominio/calendario";
import { type RelogioLogico, dataLogicaDe } from "@/dominio/dia-logico";
import { type Meta, unidadeCumprida } from "@/dominio/meta";
import { garantirPeriodoDeHoje } from "./hoje";
import { materializar, versoesDe } from "./materializar";
import {
  JANELA_RETROATIVA,
  type Resultado,
  conferirHabito,
  consumidosDe,
  efeitosDe,
  falhar,
  periodoDe,
} from "./registros";
import { hojeLogico, horaDeParede, relogioAtual } from "./relogio";

/**
 * Preenchimento retroativo — a janela de 7 dias.
 *
 * Esta é a **única** forma de corrigir o passado no app: o mapa de regras não
 * tem prazo de resgate de sequência nem estado `em_risco`, e o congelamento é
 * consumido automaticamente no fechamento. O que sobra é esta janela, e ela não
 * anda para trás.
 *
 * Nada aqui recalcula sequência, congelamento ou vencimento. Marcar um dia é
 * inserir um registro e re-materializar — a mesma operação de marcar hoje, com
 * `data_logica` diferente. O re-encadeamento de `cada_n_dias` e o estorno de
 * congelamento caem do replay, não de um conserto por caso.
 *
 * ## A prévia é a escrita, desfeita
 *
 * `previa: true` roda **exatamente** o mesmo caminho dentro de uma transação que
 * termina em rollback. Era possível calcular a prévia com uma simulação à parte,
 * sem tocar o banco; seria uma segunda implementação do efeito, e a tela estaria
 * confirmando um número que o caminho real não produz. Aqui o que a tela mostra
 * antes de confirmar é o resultado medido do que vai acontecer.
 */

/** Hábito, na forma que a montagem da janela precisa. */
type HabitoDaJanela = {
  id: string;
  nome: string;
  cor: string;
  inicio_em: string;
  pausado_de: string | null;
  pausado_ate: string | null;
  arquivado_em: Date | null;
};

async function buscarHabitoDaJanela(
  conexao: Knex,
  habitoId: string,
): Promise<HabitoDaJanela | undefined> {
  return conexao("habito")
    .where({ id: habitoId })
    .first("id", "nome", "cor", "inicio_em", "pausado_de", "pausado_ate", "arquivado_em");
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function montarRetroativo(habitoId: string): Promise<Resultado<Retroativo>> {
  const relogio = await relogioAtual();
  const agora = new Date();
  const hoje = await hojeLogico(agora);

  const habito = await buscarHabitoDaJanela(db, habitoId);
  if (habito === undefined) return falhar({ tipo: "habito_inexistente" });

  /*
   * A mesma muleta do dashboard, e pelo mesmo motivo: sem o worker da etapa 3.5,
   * um hábito cujo último acesso foi anteontem tem o período aberto com `fim` no
   * passado, e a janela mostraria os dias recentes sem período — bloqueados, sem
   * motivo que o usuário reconheça. Reaproveitada de `hoje.ts` em vez de copiada
   * para as duas telas não divergirem na virada do dia.
   */
  await garantirPeriodoDeHoje(habitoId, hoje, relogio.timezone, agora);

  const config = await configVigenteDe(db, habitoId);
  const streak = await db("habito_streak").where({ habito_id: habitoId }).first();
  const [{ disponiveis }] = await db("congelamento")
    .where({ habito_id: habitoId, status: "disponivel" })
    .count({ disponiveis: "*" });

  const periodoAtual = await periodoDe(db, habitoId, hoje);

  return {
    ok: true,
    dados: {
      habitoId,
      nome: habito.nome,
      cor: habito.cor as Retroativo["cor"],
      meta: config.meta,
      periodoAtual: await progressoDoPeriodoAtual(db, periodoAtual?.id),
      sequencia: {
        atual: streak?.sequencia_atual ?? 0,
        recorde: streak?.sequencia_recorde ?? 0,
        totalNoPrazo: streak?.total_no_prazo ?? 0,
        desde: streak?.desde ?? null,
      },
      congelamentosDisponiveis: Number(disponiveis),
      dias: await janelaDe(db, habito, hoje, relogio),
    },
  };
}

/** A meta exibida é a **vigente**, não a do período: ela governa o que será escrito. */
async function configVigenteDe(conexao: Knex, habitoId: string) {
  const linha = await conexao("habito_config")
    .where({ habito_id: habitoId })
    .whereNull("vigente_ate")
    .first();

  if (linha === undefined) throw new Error(`Hábito ${habitoId} sem configuração vigente.`);

  return configDoContrato(linha);
}

async function progressoDoPeriodoAtual(
  conexao: Knex,
  periodoId: string | undefined,
): Promise<Retroativo["periodoAtual"]> {
  if (periodoId === undefined) return null;

  const periodo = await conexao("habito_periodo")
    .where({ id: periodoId })
    .first("concluidas", "meta_ocorrencias", "fim");

  if (periodo === undefined) return null;

  return {
    concluidas: periodo.concluidas,
    meta: periodo.meta_ocorrencias,
    fim: comoDataLogica(periodo.fim),
  };
}

// ─── POST ────────────────────────────────────────────────────────────────────

/**
 * Sentinela de rollback da prévia.
 *
 * Carrega a resposta já montada: o trabalho foi feito dentro da transação, e o
 * que o `throw` desfaz é só a escrita. Fora ela é desembrulhada como sucesso.
 */
class Previa extends Error {
  constructor(readonly dados: RetroativoAplicado) {
    super("prévia: transação desfeita de propósito");
  }
}

export async function aplicarRetroativo(
  habitoId: string,
  pedido: PreencherRetroativo,
): Promise<Resultado<RetroativoAplicado>> {
  const relogio = await relogioAtual();
  const agora = new Date();
  const hoje = await hojeLogico(agora);
  const dataLogica = comoDataLogica(pedido.dataLogica);

  const habito = await buscarHabitoDaJanela(db, habitoId);
  if (habito === undefined) return falhar({ tipo: "habito_inexistente" });

  const guarda = await conferirHabito(db, habitoId, dataLogica, hoje);
  if (!guarda.ok) return guarda;

  try {
    return await db.transaction(async (trx) => {
      const consumidosAntes = await consumidosDe(trx, habitoId);

      const periodo = await periodoDe(trx, habitoId, dataLogica);
      if (periodo === undefined) return falhar({ tipo: "sem_periodo", dataLogica });

      const versoes = await versoesDe(trx, habitoId);
      const config = versoes.find((v) => v.id === periodo.config_id);
      if (config === undefined) throw new Error(`Período ${periodo.id} sem configuração.`);

      const alvos = await alvosDoDia(trx, {
        periodoId: periodo.id,
        dataLogica,
        horario: pedido.horario ?? null,
        fixo: config.modo.tipo === "fixo",
        meta: config.meta,
        relogio,
      });

      if (!alvos.ok) return alvos;

      for (const ocorrenciaId of alvos.dados) {
        await trx("registro").insert({
          periodo_id: periodo.id,
          ocorrencia_id: ocorrenciaId,
          data_logica: dataLogica,
          valor: pedido.valor ?? 1,
          /* `retroativo` e não `app`: é o que distingue a correção do ato. */
          origem: "retroativo",
          /*
           * `criado_em` é **agora**, `data_logica` é o dia corrigido. As duas
           * divergem de propósito — é a armadilha nº 1 do projeto no caso em que
           * ela foi desenhada para aparecer.
           */
          criado_em: agora,
        });
      }

      const resultado = await materializar(trx, habitoId, {
        hoje,
        timezone: relogio.timezone,
        agora,
      });

      const aplicado: RetroativoAplicado = {
        persistido: !pedido.previa,
        efeitos: efeitosDe(resultado, versoes, dataLogica, consumidosAntes),
        dias: await janelaDe(trx, habito, hoje, relogio),
      };

      if (pedido.previa) throw new Previa(aplicado);

      return { ok: true as const, dados: aplicado };
    });
  } catch (erro) {
    if (erro instanceof Previa) return { ok: true, dados: erro.dados };
    throw erro;
  }
}

/**
 * Quais ocorrências recebem registro — `null` no modo flexível.
 *
 * No modo fixo um dia pode ter mais de um momento, e a tela é por **dia**: ela
 * manda a data e nada mais. A leitura é a que o usuário quis dizer ao tocar a
 * linha do dia: preenche os momentos daquele dia que ainda não estão cumpridos.
 * Preencher só o primeiro deixaria um dia de duas doses eternamente a meio sem
 * que a tela tivesse como dizer qual falta; preencher todos, inclusive os já
 * cumpridos, duplicaria registro.
 *
 * `horario` continua aceito no contrato e tem precedência quando vem — é o que
 * permitirá, sem mudar o servidor, uma tela futura que abra o dia em momentos.
 */
async function alvosDoDia(
  conexao: Knex,
  opcoes: {
    periodoId: string;
    dataLogica: DataLogica;
    horario: string | null;
    fixo: boolean;
    meta: Meta;
    relogio: RelogioLogico;
  },
): Promise<Resultado<Array<string | null>>> {
  const negativo = opcoes.meta.tipo === "negativo";

  if (!opcoes.fixo) {
    /*
     * A recusa existe só onde um segundo registro não mudaria nada: hábito
     * binário com o dia já marcado. Em `quantificado` e `duracao` outro registro
     * **soma** — é assim que um dia a meio se completa —, e em `negativo` ele é
     * outra escorregada no mesmo dia, que o contador de recaídas conta.
     */
    if (opcoes.meta.tipo === "binario" && (await temRegistro(conexao, opcoes))) {
      return falhar({ tipo: "dia_ja_cumprido" });
    }

    return { ok: true, dados: [null] };
  }

  const doDia = await ocorrenciasDoDia(
    conexao,
    opcoes.periodoId,
    opcoes.dataLogica,
    opcoes.relogio,
  );

  if (doDia.length === 0) return falhar({ tipo: "dia_nao_previsto" });

  const escolhidas =
    opcoes.horario === null
      ? doDia
      : doDia.filter(
          (o) => horaDeParede(o.previsto_para, opcoes.relogio.timezone) === opcoes.horario,
        );

  if (escolhidas.length === 0) return falhar({ tipo: "ocorrencia_invalida" });

  /*
   * Recaída é um evento, não um por momento: um dia de duas doses em que houve
   * escorregada teve **uma** escorregada. E `ocorrencia.status` nunca é
   * `cumprida` em hábito negativo — ele não tem unidade cumprida —, então o
   * filtro abaixo pegaria todos os momentos do dia.
   */
  if (negativo) return { ok: true, dados: [escolhidas[0].id] };

  const pendentes = escolhidas.filter((o) => o.status !== "cumprida");
  if (pendentes.length === 0) return falhar({ tipo: "dia_ja_cumprido" });

  return { ok: true, dados: pendentes.map((o) => o.id) };
}

async function temRegistro(
  conexao: Knex,
  opcoes: { periodoId: string; dataLogica: DataLogica },
): Promise<boolean> {
  const linha = await conexao("registro")
    .where({ periodo_id: opcoes.periodoId, data_logica: opcoes.dataLogica })
    .first("id");

  return linha !== undefined;
}

// ─── A janela de 7 dias ──────────────────────────────────────────────────────

type OcorrenciaDoDia = { id: string; previsto_para: Date; status: string };

async function ocorrenciasDoDia(
  conexao: Knex,
  periodoId: string,
  dataLogica: DataLogica,
  relogio: RelogioLogico,
): Promise<OcorrenciaDoDia[]> {
  const todas = await conexao("habito_ocorrencia")
    .where({ periodo_id: periodoId })
    .orderBy("previsto_para", "asc")
    .select("id", "previsto_para", "status");

  /*
   * O dia de uma ocorrência é o **dia lógico** de `previsto_para`, não a data de
   * parede: a dose das 02:00 pertence ao dia anterior, e comparar a data direto a
   * colocaria no dia errado da janela.
   */
  return todas.filter((o) => dataLogicaDe(o.previsto_para, relogio) === dataLogica);
}

type RegistroDoDia = { id: string; dataLogica: DataLogica; valor: number };

/**
 * Os 7 dias, do mais recente para o mais antigo.
 *
 * Dias bloqueados aparecem **com motivo**, e não ausentes: sumir com o dia
 * deixaria a tela ambígua entre "não pode" e "não aconteceu".
 *
 * `fora_da_janela` existe no contrato e não é produzido aqui, de propósito: a
 * lista **é** a janela, então nenhum dia dela está fora. O motivo serve à recusa
 * do POST, que é onde uma data fora dos 7 dias pode chegar.
 */
async function janelaDe(
  conexao: Knex,
  habito: HabitoDaJanela,
  hoje: DataLogica,
  relogio: RelogioLogico,
): Promise<DiaRetroativo[]> {
  const inicio = somarDias(hoje, -(JANELA_RETROATIVA - 1));
  const inicioEm = comoDataLogica(habito.inicio_em);

  const periodos = await conexao("habito_periodo")
    .where({ habito_id: habito.id })
    .where("fim", ">=", inicio)
    .where("inicio", "<=", hoje)
    .orderBy("inicio", "asc")
    .select("id", "config_id", "inicio", "fim", "status");

  const versoes = await versoesDe(conexao, habito.id);

  const registros: RegistroDoDia[] =
    periodos.length === 0
      ? []
      : (
          await conexao("registro")
            .whereIn(
              "periodo_id",
              periodos.map((p) => p.id),
            )
            .where("data_logica", ">=", inicio)
            .where("data_logica", "<=", hoje)
            .orderBy("criado_em", "asc")
            .select("id", "data_logica", "valor")
        ).map((r) => ({
          id: r.id,
          dataLogica: comoDataLogica(r.data_logica),
          valor: Number(r.valor),
        }));

  const dias: DiaRetroativo[] = [];

  for (let i = 0; i < JANELA_RETROATIVA; i += 1) {
    const data = somarDias(hoje, -i);
    const doDia = registros.filter((r) => r.dataLogica === data);
    const periodo = periodos.find((p) => p.inicio <= data && data <= p.fim);
    const config = versoes.find((v) => v.id === periodo?.config_id);

    const comum = {
      dataLogica: data,
      diaDaSemana: diaDaSemana(data),
      hoje: data === hoje,
      valor: valorDoDia(config?.meta, doDia),
      registroIds: doDia.map((r) => r.id),
    };

    const bloqueado = (motivoBloqueio: DiaRetroativo["motivoBloqueio"]) =>
      dias.push({ ...comum, estado: "bloqueado" as const, motivoBloqueio });

    if (data < inicioEm) {
      bloqueado("antes_do_inicio");
      continue;
    }

    if (dentroDaPausa(habito, data)) {
      bloqueado("em_pausa");
      continue;
    }

    /*
     * Sem período o dia não tem onde pendurar um registro. Na prática isso só
     * sobra para resíduo de pausa — as cadências de calendário encadeiam sem
     * buraco —, e `nao_previsto` é a descrição honesta: não havia momento devido
     * ali. É também o que mantém `periodo` e `config` definidos daqui para baixo,
     * sem asserção.
     */
    if (periodo === undefined || config === undefined) {
      bloqueado("nao_previsto");
      continue;
    }

    const fixo = config.modo.tipo === "fixo";

    if (fixo && (await ocorrenciasDoDia(conexao, periodo.id, data, relogio)).length === 0) {
      bloqueado("nao_previsto");
      continue;
    }

    dias.push({
      ...comum,
      estado: await estadoDoDia(conexao, {
        data,
        registros: doDia,
        periodo,
        meta: config.meta,
        fixo,
        relogio,
      }),
      motivoBloqueio: null,
    });
  }

  return dias;
}

/**
 * A pausa cobre o dia?
 *
 * `pausado_ate` nulo é pausa aberta, sem retomada marcada — ela se estende até
 * hoje, e um dia dentro dela não aceita marcação.
 */
function dentroDaPausa(habito: HabitoDaJanela, data: DataLogica): boolean {
  if (habito.pausado_de === null) return false;

  return (
    habito.pausado_de <= data && (habito.pausado_ate === null || data <= habito.pausado_ate)
  );
}

/**
 * O estado de um dia liberado.
 *
 * A ordem é deliberada: **cumprido vence congelado**. Num hábito semanal, o
 * congelamento é do período inteiro, e um dia que foi efetivamente feito dentro
 * de uma semana congelada continua sendo um dia feito — mostrá-lo como congelado
 * apagaria o esforço de quem marcou.
 */
async function estadoDoDia(
  conexao: Knex,
  opcoes: {
    data: DataLogica;
    registros: RegistroDoDia[];
    periodo: { id: string; status: string };
    meta: Meta;
    fixo: boolean;
    relogio: RelogioLogico;
  },
): Promise<DiaRetroativo["estado"]> {
  if (await diaCumprido(conexao, opcoes)) return "cumprido";
  if (opcoes.periodo.status === "congelado") return "congelado";
  return "nao_cumprido";
}

async function diaCumprido(
  conexao: Knex,
  opcoes: {
    data: DataLogica;
    registros: RegistroDoDia[];
    periodo: { id: string };
    meta: Meta;
    fixo: boolean;
    relogio: RelogioLogico;
  },
): Promise<boolean> {
  /*
   * O hábito negativo não tem unidade cumprida, tem recaída — `unidadeCumprida`
   * lança nele de propósito. O dia limpo é o dia bom, e é ele que aparece com a
   * marca cheia; o dia com registro é a escorregada.
   */
  if (opcoes.meta.tipo === "negativo") return opcoes.registros.length === 0;

  if (!opcoes.fixo) return unidadeCumprida(opcoes.meta, opcoes.registros);

  /*
   * No modo fixo a unidade é o momento, não o dia, e quem já decidiu isso foi a
   * materialização: `habito_ocorrencia.status` saiu do mesmo `unidadeCumprida`
   * sobre os registros daquele slot. Reavaliar aqui seria uma segunda conta da
   * mesma regra, com a diferença de não saber a qual slot cada registro pertence.
   */
  const doDia = await ocorrenciasDoDia(conexao, opcoes.periodo.id, opcoes.data, opcoes.relogio);
  return doDia.length > 0 && doDia.every((o) => o.status === "cumprida");
}

/**
 * A soma do dia, só onde ela quer dizer alguma coisa.
 *
 * `binario` e `negativo` não têm quantidade — o `1` que o registro guarda é
 * convenção de armazenamento, e exibi-lo na linha do dia seria ruído.
 */
function valorDoDia(meta: Meta | undefined, registros: RegistroDoDia[]): number | null {
  if (meta === undefined || registros.length === 0) return null;
  if (meta.tipo !== "quantificado" && meta.tipo !== "duracao") return null;

  return registros.reduce((total, r) => total + r.valor, 0);
}

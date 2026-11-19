import "dotenv/config";
import type { Knex } from "knex";
import {
  type DataLogica,
  type Janela,
  diaDaSemana,
  diasDaJanela,
  somarDias,
} from "../../dominio/calendario";
import { dataLogicaDe } from "../../dominio/dia-logico";
import { unidadeCumprida } from "../../dominio/meta";
import { slotsDaJanela } from "../../dominio/periodo";
import {
  type EntradaSimulacao,
  type PeriodoSimulado,
  type VersaoConfig,
  simular,
} from "../../dominio/simulacao";
import { instanteDe, versaoDeConfig } from "../mapa-dominio";
import type {
  HabitoConfig,
  HabitoConfigInsert,
  HabitoInsert,
  HabitoTipo,
  RegistroOrigem,
} from "../tipos";

/**
 * Seed de desenvolvimento: 6 hábitos cobrindo os 4 tipos e as 4 cadências, com
 * 30 dias de histórico, para a interface ter o que mostrar antes de existir
 * backend de verdade.
 *
 * O histórico **não** é escrito à mão. O seed monta apenas os registros (o que o
 * usuário teria tocado) e deixa `simular()` derivar períodos, ocorrências,
 * sequência e congelamentos. Escrever o histórico à mão seria reimplementar o
 * domínio num segundo lugar, com outro resultado — e este seed também vale como
 * primeira prova de que a saída do domínio assenta no schema sem atrito: cada
 * CHECK da migration é exercitado por dados reais aqui.
 *
 * Idempotente por UUID fixo: re-semear apaga só estes 6 hábitos (o CASCADE leva
 * períodos, registros e congelamentos) e reconstrói. Hábitos criados à mão no
 * banco de desenvolvimento não são tocados.
 */

const HOJE_OFFSET_INICIO = -29; // 30 dias de histórico, contando hoje

/** Placeholder: a paleta fecha na etapa 2 (pendência do Mapa de telas). */
type Cor = "azul" | "verde" | "roxo" | "vermelho" | "ambar" | "ciano";

type ConfigSemente = HabitoConfigInsert & { id: string };

interface PlanoRegistro {
  dataLogica: DataLogica;
  valor: number;
  /** Horário do slot no modo fixo; `null` no flexível. */
  horario: string | null;
  origem: RegistroOrigem;
  /** Instante real da marcação — difere do dia lógico na madrugada. */
  criadoEm: Date;
}

interface Semente {
  id: string;
  nome: string;
  cor: Cor;
  tipo: HabitoTipo;
  ordem: number;
  pausa?: Janela;
  configs: ConfigSemente[];
  registros: PlanoRegistro[];
}

/**
 * Gerador pseudoaleatório próprio, com semente fixa por hábito.
 *
 * `Math.random()` daria um banco diferente a cada execução, e um histórico que
 * muda de forma a cada seed é inútil para comparar telas.
 */
function sorteador(semente: number): () => number {
  let estado = semente;
  return () => {
    estado = (estado * 1103515245 + 12345) % 2147483648;
    return estado / 2147483648;
  };
}

function paraDominio(config: ConfigSemente): VersaoConfig {
  return versaoDeConfig({ ...config, criado_em: new Date() } as HabitoConfig);
}

/** Instante de fechamento do período, conforme o status. */
function fechamentoDe(periodo: PeriodoSimulado): Date | null {
  if (periodo.status === "aberto") return null;
  // Cumprido fecha na conclusão; perdido e congelado só na virada seguinte.
  return periodo.status === "cumprido"
    ? instanteDe(periodo.fim, "21:00:00")
    : instanteDe(somarDias(periodo.fim, 1), "04:00:00");
}

function chaveSlot(data: DataLogica, horario: string | null): string {
  return `${data}|${horario ?? ""}`;
}

function sementes(hoje: DataLogica): Semente[] {
  const inicio = somarDias(hoje, HOJE_OFFSET_INICIO);
  const dias = diasDaJanela({ inicio, fim: hoje });

  return [
    agua(inicio, dias),
    correr(inicio, hoje, dias),
    meditar(inicio, hoje, dias),
    semRefrigerante(inicio, dias),
    ler(inicio, dias),
    vitamina(inicio, dias),
  ];
}

/** 💧 quantificado · diário · flexível — com um registro de madrugada. */
function agua(inicio: DataLogica, dias: DataLogica[]): Semente {
  const sortear = sorteador(101);
  const registros: PlanoRegistro[] = [];
  // Dia com marcação à 01:30: o dia lógico é o anterior ao dia civil do relógio.
  const madrugada = dias[dias.length - 5];

  for (const dia of dias) {
    const chance = sortear();
    if (chance < 0.8) {
      const horas = ["09:30:00", "14:00:00", "19:30:00"];
      horas.forEach((hora, i) => {
        const viraNoite = dia === madrugada && i === horas.length - 1;
        registros.push({
          dataLogica: dia,
          valor: 700,
          horario: null,
          origem: "app",
          criadoEm: viraNoite
            ? instanteDe(somarDias(dia, 1), "01:30:00")
            : instanteDe(dia, hora),
        });
      });
    } else if (chance < 0.92) {
      // Dois copos: fica abaixo da meta e o dia fecha perdido.
      for (const hora of ["10:00:00", "16:00:00"]) {
        registros.push({
          dataLogica: dia,
          valor: 600,
          horario: null,
          origem: "app",
          criadoEm: instanteDe(dia, hora),
        });
      }
    }
  }

  return {
    id: "5eed0001-0000-4000-8000-000000000001",
    nome: "💧 Água",
    cor: "ciano",
    tipo: "quantificado",
    ordem: 1,
    configs: [
      {
        id: "5eedc001-0000-4000-8000-000000000001",
        habito_id: "5eed0001-0000-4000-8000-000000000001",
        tipo: "quantificado",
        versao: 1,
        vigente_de: inicio,
        vigente_ate: null,
        cadencia: "diario",
        cadencia_intervalo: null,
        modo: "flexivel",
        meta_ocorrencias: 1,
        dias_semana: null,
        dias_mes: null,
        horarios: null,
        notificar_em: "09:00:00",
        meta_valor: 2000,
        unidade: "ml",
        meta_segundos: null,
        tolerancia_recaidas: null,
        congelamento_ativo: true,
        congelamento_a_cada: 3,
        congelamento_max: 3,
      },
    ],
    registros,
  };
}

/** 🏃 binário · semanal · flexível — com **duas versões** de configuração. */
function correr(inicio: DataLogica, hoje: DataLogica, dias: DataLogica[]): Semente {
  const sortear = sorteador(202);
  const registros: PlanoRegistro[] = dias
    .filter(() => sortear() < 0.45)
    .map((dia) => ({
      dataLogica: dia,
      valor: 1,
      horario: null,
      origem: "app" as RegistroOrigem,
      criadoEm: instanteDe(dia, "18:30:00"),
    }));

  const habitoId = "5eed0001-0000-4000-8000-000000000002";
  const comum = {
    habito_id: habitoId,
    tipo: "binario" as HabitoTipo,
    cadencia: "semanal" as const,
    cadencia_intervalo: null,
    modo: "flexivel" as const,
    dias_semana: null,
    dias_mes: null,
    horarios: null,
    notificar_em: "18:00:00",
    meta_valor: null,
    unidade: null,
    meta_segundos: null,
    tolerancia_recaidas: null,
    congelamento_ativo: true,
    congelamento_a_cada: 2,
    congelamento_max: 2,
  };

  return {
    id: habitoId,
    nome: "🏃 Correr",
    cor: "vermelho",
    tipo: "binario",
    ordem: 2,
    configs: [
      // A meta subiu de 2x para 3x por semana há duas semanas. As semanas
      // anteriores continuam avaliadas por 2x — é o versionamento em ação, e o
      // histórico tem de provar isso na tela.
      {
        ...comum,
        id: "5eedc001-0000-4000-8000-000000000002",
        versao: 1,
        vigente_de: inicio,
        vigente_ate: somarDias(hoje, -15),
        meta_ocorrencias: 2,
      },
      {
        ...comum,
        id: "5eedc001-0000-4000-8000-000000000003",
        versao: 2,
        vigente_de: somarDias(hoje, -14),
        vigente_ate: null,
        meta_ocorrencias: 3,
      },
    ],
    registros,
  };
}

/** 🧘 duração · diário · flexível — com uma pausa de 5 dias no histórico. */
function meditar(inicio: DataLogica, hoje: DataLogica, dias: DataLogica[]): Semente {
  const sortear = sorteador(303);
  const pausa: Janela = { inicio: somarDias(hoje, -20), fim: somarDias(hoje, -16) };
  const registros: PlanoRegistro[] = [];

  for (const dia of dias) {
    // Durante a pausa não existe período, logo não pode existir registro.
    if (dia >= pausa.inicio && dia <= pausa.fim) continue;

    const chance = sortear();
    if (chance < 0.75) {
      registros.push({
        dataLogica: dia,
        // Em segundos: 12 a 25 minutos de sessão.
        valor: (12 + Math.floor(sortear() * 14)) * 60,
        horario: null,
        origem: "cronometro",
        criadoEm: instanteDe(dia, "06:45:00"),
      });
    } else if (chance < 0.85) {
      // Sessão curta: não alcança os 10 minutos e o dia fecha perdido.
      registros.push({
        dataLogica: dia,
        valor: 6 * 60,
        horario: null,
        origem: "cronometro",
        criadoEm: instanteDe(dia, "07:10:00"),
      });
    }
  }

  return {
    id: "5eed0001-0000-4000-8000-000000000003",
    nome: "🧘 Meditar",
    cor: "roxo",
    tipo: "duracao",
    ordem: 3,
    pausa,
    configs: [
      {
        id: "5eedc001-0000-4000-8000-000000000004",
        habito_id: "5eed0001-0000-4000-8000-000000000003",
        tipo: "duracao",
        versao: 1,
        vigente_de: inicio,
        vigente_ate: null,
        cadencia: "diario",
        cadencia_intervalo: null,
        modo: "flexivel",
        meta_ocorrencias: 1,
        dias_semana: null,
        dias_mes: null,
        horarios: null,
        notificar_em: "06:30:00",
        meta_valor: null,
        unidade: null,
        meta_segundos: 600,
        tolerancia_recaidas: null,
        congelamento_ativo: false,
        congelamento_a_cada: null,
        congelamento_max: null,
      },
    ],
    registros,
  };
}

/** 🥤 negativo · mensal · flexível — registro é recaída, não conquista. */
function semRefrigerante(inicio: DataLogica, dias: DataLogica[]): Semente {
  const sortear = sorteador(404);
  const registros: PlanoRegistro[] = dias
    .filter(() => sortear() < 0.08)
    .map((dia) => ({
      dataLogica: dia,
      valor: 1,
      horario: null,
      origem: "app" as RegistroOrigem,
      criadoEm: instanteDe(dia, "20:00:00"),
    }));

  return {
    id: "5eed0001-0000-4000-8000-000000000004",
    nome: "🥤 Sem refrigerante",
    cor: "ambar",
    tipo: "negativo",
    ordem: 4,
    configs: [
      {
        id: "5eedc001-0000-4000-8000-000000000005",
        habito_id: "5eed0001-0000-4000-8000-000000000004",
        tipo: "negativo",
        versao: 1,
        vigente_de: inicio,
        vigente_ate: null,
        cadencia: "mensal",
        cadencia_intervalo: null,
        modo: "flexivel",
        meta_ocorrencias: 1,
        dias_semana: null,
        dias_mes: null,
        horarios: null,
        notificar_em: null,
        meta_valor: null,
        unidade: null,
        meta_segundos: null,
        tolerancia_recaidas: 2,
        congelamento_ativo: false,
        congelamento_a_cada: null,
        congelamento_max: null,
      },
    ],
    registros,
  };
}

/** 📚 binário · cada 3 dias · flexível — a cadência que reencadeia. */
function ler(inicio: DataLogica, dias: DataLogica[]): Semente {
  const sortear = sorteador(505);
  const registros: PlanoRegistro[] = [];

  dias.forEach((dia, i) => {
    if (sortear() >= 0.5) return;
    registros.push({
      dataLogica: dia,
      valor: 1,
      horario: null,
      // Alguns dias foram preenchidos depois, pela tela de retroativo.
      origem: i % 9 === 4 ? "retroativo" : "app",
      criadoEm: instanteDe(dia, "22:15:00"),
    });
  });

  return {
    id: "5eed0001-0000-4000-8000-000000000005",
    nome: "📚 Ler",
    cor: "verde",
    tipo: "binario",
    ordem: 5,
    configs: [
      {
        id: "5eedc001-0000-4000-8000-000000000006",
        habito_id: "5eed0001-0000-4000-8000-000000000005",
        tipo: "binario",
        versao: 1,
        vigente_de: inicio,
        vigente_ate: null,
        cadencia: "cada_n_dias",
        cadencia_intervalo: 3,
        modo: "flexivel",
        meta_ocorrencias: 1,
        dias_semana: null,
        dias_mes: null,
        horarios: null,
        notificar_em: "21:00:00",
        meta_valor: null,
        unidade: null,
        meta_segundos: null,
        tolerancia_recaidas: null,
        congelamento_ativo: true,
        congelamento_a_cada: 4,
        congelamento_max: 3,
      },
    ],
    registros,
  };
}

/** 💊 binário · semanal · **fixo** — seg/qua/sex às 08:00, com ocorrências. */
function vitamina(inicio: DataLogica, dias: DataLogica[]): Semente {
  const sortear = sorteador(606);
  const diasDevidos = [2, 4, 6]; // 1 = domingo, logo seg/qua/sex
  const horario = "08:00:00";
  const registros: PlanoRegistro[] = [];

  for (const dia of dias) {
    if (!diasDevidos.includes(diaDaSemana(dia))) continue;
    if (sortear() >= 0.85) continue;
    registros.push({
      dataLogica: dia,
      valor: 1,
      horario,
      origem: "app",
      criadoEm: instanteDe(dia, "08:05:00"),
    });
  }

  return {
    id: "5eed0001-0000-4000-8000-000000000006",
    nome: "💊 Vitamina D",
    cor: "azul",
    tipo: "binario",
    ordem: 6,
    configs: [
      {
        id: "5eedc001-0000-4000-8000-000000000007",
        habito_id: "5eed0001-0000-4000-8000-000000000006",
        tipo: "binario",
        versao: 1,
        vigente_de: inicio,
        vigente_ate: null,
        cadencia: "semanal",
        cadencia_intervalo: null,
        modo: "fixo",
        meta_ocorrencias: null,
        dias_semana: diasDevidos,
        dias_mes: null,
        horarios: [horario],
        notificar_em: null, // só o modo flexível aceita (CHECK da migration)
        meta_valor: null,
        unidade: null,
        meta_segundos: null,
        tolerancia_recaidas: null,
        congelamento_ativo: true,
        congelamento_a_cada: 3,
        congelamento_max: 2,
      },
    ],
    registros,
  };
}

async function semear(
  trx: Knex.Transaction,
  s: Semente,
  hoje: DataLogica,
  agora: Date,
): Promise<void> {
  const inicio = somarDias(hoje, HOJE_OFFSET_INICIO);

  const habito: HabitoInsert = {
    id: s.id,
    nome: s.nome,
    cor: s.cor,
    tipo: s.tipo,
    inicio_em: inicio,
    ordem: s.ordem,
    pausado_de: s.pausa?.inicio ?? null,
    pausado_ate: s.pausa?.fim ?? null,
    arquivado_em: null,
  };

  await trx("habito").insert(habito);
  await trx("habito_config").insert(s.configs);

  const porConfigId = new Map(s.configs.map((c) => [c.id, paraDominio(c)]));

  const entrada: EntradaSimulacao = {
    inicioEm: inicio,
    configs: [...porConfigId.values()],
    registros: s.registros.map((r) => ({
      dataLogica: r.dataLogica,
      valor: r.valor,
      horario: r.horario,
    })),
    pausas: s.pausa ? [{ de: s.pausa.inicio, ate: s.pausa.fim }] : [],
    hoje,
  };

  const resultado = simular(entrada);

  const inseridos: Array<{ id: string; periodo: PeriodoSimulado }> = [];
  for (const periodo of resultado.periodos) {
    const [linha] = await trx("habito_periodo")
      .insert({
        habito_id: s.id,
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

  let persistidos = 0;
  for (const { id: periodoId, periodo } of inseridos) {
    const config = porConfigId.get(periodo.configId);
    if (!config) throw new Error(`Config ${periodo.configId} ausente no mapa.`);

    const doPeriodo = s.registros.filter(
      (r) => r.dataLogica >= periodo.inicio && r.dataLogica <= periodo.fim,
    );

    // Modo fixo materializa as ocorrências; no flexível a tabela fica vazia.
    const ocorrenciaDoSlot = new Map<string, string>();
    if (config.modo.tipo === "fixo") {
      const slots = slotsDaJanela(
        { inicio: periodo.inicio, fim: periodo.fim },
        config.modoFixo ?? {},
      );

      for (const slot of slots) {
        const doSlot = doPeriodo.filter(
          (r) =>
            r.dataLogica === slot.data &&
            (slot.horario === null || r.horario === slot.horario),
        );
        const cumprida =
          config.meta.tipo !== "negativo" && unidadeCumprida(config.meta, doSlot);
        const ultimo = doSlot.at(-1);
        const previstoPara = instanteDe(slot.data, slot.horario ?? "08:00:00");

        /*
         * A ocorrência é um ponto no tempo, não o período: assim que o momento
         * passa sem marcação, ela está perdida — mesmo que o período continue
         * aberto. É o que deixa o dashboard distinguir a dose de segunda que
         * ficou para trás da dose de sexta que ainda vai acontecer. Preencher
         * pelo retroativo devolve `cumprida`.
         */
        const [linha] = await trx("habito_ocorrencia")
          .insert({
            periodo_id: periodoId,
            previsto_para: previstoPara,
            status: cumprida ? "cumprida" : previstoPara < agora ? "perdida" : "pendente",
            cumprida_em: cumprida && ultimo ? ultimo.criadoEm : null,
          })
          .returning("id");

        ocorrenciaDoSlot.set(chaveSlot(slot.data, slot.horario), linha.id);
      }
    }

    for (const r of doPeriodo) {
      await trx("registro").insert({
        periodo_id: periodoId,
        ocorrencia_id: ocorrenciaDoSlot.get(chaveSlot(r.dataLogica, r.horario)) ?? null,
        data_logica: r.dataLogica,
        valor: r.valor,
        origem: r.origem,
        criado_em: r.criadoEm,
      });
      persistidos += 1;
    }
  }

  /*
   * Todo registro tem de cair em exatamente um período: `registro.periodo_id` é
   * NOT NULL. Se esta conta não fechar, há registro em dia que a simulação não
   * cobriu — o caso típico é marcação dentro de uma pausa. É erro do seed, mas
   * seria erro de produção também, então falha alto em vez de sumir.
   */
  if (persistidos !== s.registros.length) {
    throw new Error(
      `${s.nome}: ${s.registros.length - persistidos} registro(s) sem período correspondente.`,
    );
  }

  // Estoque de congelamento: uma linha por unidade, pareando ganho e consumo em
  // FIFO — a ordem é a mesma que o repositório vai usar na etapa 3.4.
  const ganhos = inseridos.flatMap(({ id, periodo }) =>
    Array.from({ length: periodo.congelamentosGanhos }, () => ({ id, periodo })),
  );
  const consumidores = inseridos.filter(({ periodo }) => periodo.congelamentoConsumido);

  if (consumidores.length > ganhos.length) {
    throw new Error(`${s.nome}: consumo de congelamento sem lastro no estoque.`);
  }

  for (const [i, ganho] of ganhos.entries()) {
    const consumidor = consumidores[i];
    await trx("congelamento").insert({
      habito_id: s.id,
      status: consumidor ? "consumido" : "disponivel",
      ganho_em: instanteDe(ganho.periodo.fim, "21:00:00"),
      ganho_por_periodo_id: ganho.id,
      consumido_em: consumidor
        ? instanteDe(somarDias(consumidor.periodo.fim, 1), "04:00:00")
        : null,
      consumido_periodo_id: consumidor?.id ?? null,
    });
  }

  await trx("habito_streak").insert({
    habito_id: s.id,
    sequencia_atual: resultado.sequencia.atual,
    sequencia_recorde: resultado.sequencia.recorde,
    total_no_prazo: resultado.sequencia.totalNoPrazo,
    desde: resultado.sequencia.desde,
  });

  console.log(
    `  ${s.nome}: ${resultado.periodos.length} períodos, ${s.registros.length} registros, ` +
      `🔥 ${resultado.sequencia.atual} (recorde ${resultado.sequencia.recorde}), ` +
      `❄ ${resultado.congelamentos.disponiveis} ` +
      `(ganhos ${resultado.congelamentos.ganhos}, usados ${resultado.congelamentos.consumidos})`,
  );
}

export async function seed(knex: Knex): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    console.log("  seed de desenvolvimento ignorado (NODE_ENV=production)");
    return;
  }

  const agora = new Date();
  const hoje = dataLogicaDe(agora);
  const lista = sementes(hoje);

  await knex.transaction(async (trx) => {
    await trx("habito")
      .whereIn(
        "id",
        lista.map((s) => s.id),
      )
      .delete();

    for (const s of lista) {
      await semear(trx, s, hoje, agora);
    }
  });
}

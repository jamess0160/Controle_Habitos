import { type DataLogica, type Janela, somarDias } from "./calendario";
import { type RegraCongelamento, ganhosAoAvancar } from "./congelamento";
import { type StatusFechado, decidirFechamento } from "./fechamento";
import {
  type Meta,
  type Modo,
  type RegistroDoDominio,
  avaliarPeriodo,
  unidadeCumprida,
} from "./meta";
import {
  type Cadencia,
  type ModoFixo,
  janelaAposRetomada,
  janelaSeguinte,
  primeiraJanela,
  slotsDaJanela,
} from "./periodo";
import {
  type EstadoSequencia,
  SEQUENCIA_INICIAL,
  aplicarFechamento,
} from "./sequencia";

/**
 * Replay do histórico de um hábito.
 *
 * Esta é a função de onde tudo deriva: períodos, sequência e estoque de
 * congelamento são o resultado de reexecutar a história do hábito desde o
 * começo, sobre os registros que existem agora. As tabelas no banco são a
 * materialização deste resultado, não a fonte dele.
 *
 * Isso resolve de graça a parte mais delicada do domínio: como `cada_n_dias` é
 * ancorado na última conclusão, um preenchimento retroativo move o início de
 * todos os períodos seguintes. Não existe "corrigir o período afetado" — existe
 * reencadear. Um replay puro reencadeia por construção.
 *
 * Nenhuma função aqui lê o relógio: `hoje` entra por parâmetro.
 */

export interface VersaoConfig {
  id: string;
  vigenteDe: DataLogica;
  /** `null` = versão atual. */
  vigenteAte: DataLogica | null;
  cadencia: Cadencia;
  modo: Modo;
  /** Momentos determinados, obrigatório quando `modo.tipo === "fixo"`. */
  modoFixo?: ModoFixo;
  meta: Meta;
  /** `null` = congelamento desativado nesta versão. */
  congelamento: RegraCongelamento | null;
}

export interface RegistroEntrada extends RegistroDoDominio {
  /** Horário do slot, no modo fixo com horários. */
  horario?: string | null;
}

export interface Pausa {
  de: DataLogica;
  /** `null` = pausa aberta, sem retomada marcada. */
  ate: DataLogica | null;
}

export interface EntradaSimulacao {
  inicioEm: DataLogica;
  /** Versões da configuração; a vigente em cada período é a usada nele. */
  configs: VersaoConfig[];
  registros: RegistroEntrada[];
  pausas?: Pausa[];
  hoje: DataLogica;
}

export type StatusPeriodo = StatusFechado | "aberto";

export interface PeriodoSimulado {
  configId: string;
  inicio: DataLogica;
  /** Em `cada_n_dias`, é a data da conclusão quando a meta foi atingida. */
  fim: DataLogica;
  metaOcorrencias: number;
  concluidas: number;
  status: StatusPeriodo;
  /** Quanto o período somou na sequência. */
  interacoes: number;
  congelamentoConsumido: boolean;
}

export interface ResultadoSimulacao {
  periodos: PeriodoSimulado[];
  sequencia: EstadoSequencia;
  congelamentos: { disponiveis: number; ganhos: number; consumidos: number };
}

/** Teto de segurança: ~130 anos de períodos diários. */
const LIMITE_ITERACOES = 50_000;

export function simular(entrada: EntradaSimulacao): ResultadoSimulacao {
  const pausas = entrada.pausas ?? [];
  const periodos: PeriodoSimulado[] = [];

  let sequencia = SEQUENCIA_INICIAL;
  let disponiveis = 0;
  let ganhos = 0;
  let consumidos = 0;

  let janela = primeiraJanela(
    configVigenteEm(entrada.configs, entrada.inicioEm).cadencia,
    entrada.inicioEm,
  );

  for (let i = 0; janela.inicio <= entrada.hoje; i++) {
    if (i >= LIMITE_ITERACOES) {
      throw new Error("Simulação não convergiu: verifique a cadência e as pausas.");
    }

    // Pausa suspende sem punição: nenhum período é gerado no intervalo.
    const pausa = pausaEm(pausas, janela.inicio);
    if (pausa) {
      if (pausa.ate === null) break;
      const retomada = somarDias(pausa.ate, 1);
      if (retomada > entrada.hoje) break;
      janela = janelaAposRetomada(
        configVigenteEm(entrada.configs, retomada).cadencia,
        retomada,
      );
      continue;
    }

    const config = configVigenteEm(entrada.configs, janela.inicio);
    const agrupado = agrupar(config, janela, entrada.registros);
    const avaliacao = avaliarPeriodo(config.meta, config.modo, agrupado.unidades);

    // Em cada_n_dias a conclusão encerra o período naquela data, e é dela que a
    // próxima janela parte. Nas outras cadências o fim é imutável.
    const fim =
      config.cadencia.tipo === "cada_n_dias" && avaliacao.cumprido
        ? (dataDeConclusao(config, agrupado.datasCumpridas) ?? janela.fim)
        : janela.fim;

    const janelaEncerrada = fim < entrada.hoje;

    /*
     * Hábito positivo conta na hora: marcar hoje já soma na sequência, porque o
     * retorno imediato é o ponto do app. Hábito negativo é o oposto — ele nasce
     * cumprido, e fechá-lo antes do fim da janela afirmaria "não houve recaída"
     * num dia que ainda está correndo. Então só fecha quando a janela termina.
     */
    const cumprido =
      avaliacao.cumprido && (config.meta.tipo !== "negativo" || janelaEncerrada);

    if (!cumprido && !janelaEncerrada) {
      periodos.push({
        configId: config.id,
        inicio: janela.inicio,
        fim,
        metaOcorrencias: avaliacao.unidadesTotais,
        concluidas: avaliacao.unidadesCumpridas,
        status: "aberto",
        interacoes: 0,
        congelamentoConsumido: false,
      });
      break;
    }

    const status = decidirFechamento({
      cumprido,
      congelamentoAtivo: config.congelamento !== null,
      congelamentosDisponiveis: disponiveis,
    });

    if (status === "congelado") {
      disponiveis -= 1;
      consumidos += 1;
    }

    const sequenciaAnterior = sequencia.atual;
    sequencia = aplicarFechamento(sequencia, {
      status,
      interacoes: avaliacao.interacoes,
      inicio: janela.inicio,
    });

    if (status === "cumprido" && config.congelamento) {
      const novos = ganhosAoAvancar(
        sequenciaAnterior,
        avaliacao.interacoes,
        config.congelamento,
        disponiveis,
      );
      disponiveis += novos;
      ganhos += novos;
    }

    periodos.push({
      configId: config.id,
      inicio: janela.inicio,
      fim,
      metaOcorrencias: avaliacao.unidadesTotais,
      concluidas: avaliacao.unidadesCumpridas,
      status,
      interacoes: status === "cumprido" ? avaliacao.interacoes : 0,
      congelamentoConsumido: status === "congelado",
    });

    janela = janelaSeguinte(config.cadencia, fim);
  }

  return {
    periodos,
    sequencia,
    congelamentos: { disponiveis, ganhos, consumidos },
  };
}

export function configVigenteEm(configs: VersaoConfig[], data: DataLogica): VersaoConfig {
  const vigente = configs.find(
    (c) => c.vigenteDe <= data && (c.vigenteAte === null || data <= c.vigenteAte),
  );

  if (!vigente) {
    throw new Error(`Nenhuma versão de configuração vigente em ${data}.`);
  }

  return vigente;
}

function pausaEm(pausas: Pausa[], data: DataLogica): Pausa | undefined {
  return pausas.find((p) => p.de <= data && (p.ate === null || data <= p.ate));
}

interface Agrupamento {
  /** Um grupo por unidade marcável: um dia no flexível, um slot no fixo. */
  unidades: RegistroDoDominio[][];
  /** Datas das unidades cumpridas, em ordem cronológica. */
  datasCumpridas: DataLogica[];
}

/**
 * Agrupa os registros do período na unidade marcável correspondente.
 *
 * No modo fixo com horários, o registro precisa trazer o horário do slot — é o
 * que o app sempre faz, porque lá a marcação é contra uma ocorrência concreta.
 * Slot sem horário (modo fixo que só determina dias) recebe todos os registros
 * do dia.
 */
function agrupar(
  config: VersaoConfig,
  janela: Janela,
  registros: RegistroEntrada[],
): Agrupamento {
  const noPeriodo = registros.filter(
    (r) => r.dataLogica >= janela.inicio && r.dataLogica <= janela.fim,
  );

  if (config.modo.tipo === "fixo") {
    const slots = slotsDaJanela(janela, config.modoFixo ?? {});
    const unidades = slots.map((slot) =>
      noPeriodo.filter(
        (r) =>
          r.dataLogica === slot.data &&
          (slot.horario === null || (r.horario ?? null) === slot.horario),
      ),
    );

    return {
      unidades,
      datasCumpridas: slots
        .filter((_, i) => cumpriu(config.meta, unidades[i]))
        .map((slot) => slot.data),
    };
  }

  const porDia = new Map<string, RegistroDoDominio[]>();
  for (const registro of noPeriodo) {
    const grupo = porDia.get(registro.dataLogica) ?? [];
    grupo.push(registro);
    porDia.set(registro.dataLogica, grupo);
  }

  const dias = [...porDia.keys()].sort() as DataLogica[];
  const unidades = dias.map((dia) => porDia.get(dia)!);

  return {
    unidades,
    datasCumpridas: dias.filter((_, i) => cumpriu(config.meta, unidades[i])),
  };
}

function cumpriu(meta: Meta, registros: RegistroDoDominio[]): boolean {
  // Hábito negativo não tem unidade cumprida: ele é avaliado no período inteiro.
  return meta.tipo !== "negativo" && unidadeCumprida(meta, registros);
}

/** Data em que a meta do período foi alcançada, para encurtar `cada_n_dias`. */
function dataDeConclusao(
  config: VersaoConfig,
  datasCumpridas: DataLogica[],
): DataLogica | null {
  if (config.meta.tipo === "negativo") return null;
  if (config.modo.tipo !== "flexivel") return null;
  return datasCumpridas[config.modo.metaOcorrencias - 1] ?? null;
}

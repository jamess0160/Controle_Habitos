import {
  type DataLogica,
  type DiaDaSemana,
  type Janela,
  diaDaSemana,
  diaDoMes,
  diasDaJanela,
  fimDoMes,
  inicioDaSemana,
  inicioDoMes,
  maior,
  somarDias,
} from "./calendario";

/**
 * Geração das janelas de avaliação.
 *
 * Períodos nascem sob demanda em todas as cadências: existe no máximo um aberto
 * por hábito. `cada_n_dias` obriga a isso, porque a janela é ancorada na última
 * conclusão e o próximo início só é conhecido quando o atual fecha.
 */

export type Cadencia =
  | { tipo: "diario" }
  | { tipo: "cada_n_dias"; intervalo: number }
  | { tipo: "semanal" }
  | { tipo: "mensal" };

/** Janela de calendário que contém a data, sem considerar o início do hábito. */
function janelaDeCalendario(cadencia: Cadencia, data: DataLogica): Janela {
  switch (cadencia.tipo) {
    case "diario":
      return { inicio: data, fim: data };
    case "cada_n_dias":
      return { inicio: data, fim: somarDias(data, cadencia.intervalo - 1) };
    case "semanal": {
      const inicio = inicioDaSemana(data);
      return { inicio, fim: somarDias(inicio, 6) };
    }
    case "mensal":
      return { inicio: inicioDoMes(data), fim: fimDoMes(data) };
  }
}

/**
 * Primeira janela do hábito.
 *
 * Nas cadências de calendário a janela é recortada no início do hábito: criar um
 * hábito semanal numa quarta dá um primeiro período de quarta a sábado, não uma
 * semana inteira que começou antes do hábito existir. A meta não é reduzida
 * proporcionalmente — o primeiro período pode ser mais apertado, e o
 * preenchimento retroativo existe para o caso de isso incomodar.
 */
export function primeiraJanela(cadencia: Cadencia, inicioEm: DataLogica): Janela {
  const janela = janelaDeCalendario(cadencia, inicioEm);
  return { inicio: maior(janela.inicio, inicioEm), fim: janela.fim };
}

/**
 * Janela seguinte, a partir do fim efetivo da anterior.
 *
 * Em `cada_n_dias`, `fimAnterior` é o fim **efetivo**: se a meta foi atingida no
 * 3º dia de uma janela de 15, o período foi encerrado naquele dia e é dele que a
 * próxima janela parte. Quando o período é perdido, o fim efetivo é o fim
 * original, e o encadeamento continua a partir dele.
 */
export function janelaSeguinte(cadencia: Cadencia, fimAnterior: DataLogica): Janela {
  return janelaDeCalendario(cadencia, somarDias(fimAnterior, 1));
}

/**
 * Janela após o fim de uma pausa.
 *
 * A pausa congela o relógio: em `cada_n_dias` a contagem recomeça na retomada,
 * para voltar de 20 dias de férias não produzir um vencimento já estourado.
 */
export function janelaAposRetomada(cadencia: Cadencia, retomadaEm: DataLogica): Janela {
  const janela = janelaDeCalendario(cadencia, retomadaEm);
  return { inicio: maior(janela.inicio, retomadaEm), fim: janela.fim };
}

/** Configuração de momentos determinados do modo `fixo`. */
export interface ModoFixo {
  diasSemana?: DiaDaSemana[];
  diasMes?: number[];
  horarios?: string[];
}

export interface Slot {
  data: DataLogica;
  /** `null` quando o modo fixo só determina dias, sem horário. */
  horario: string | null;
}

/**
 * Momentos marcáveis de uma janela no modo `fixo`.
 *
 * Dia do mês inexistente é ignorado: `dias_mes: [31]` simplesmente não gera slot
 * em fevereiro, em vez de escorregar para 1º de março.
 */
export function slotsDaJanela(janela: Janela, modo: ModoFixo): Slot[] {
  const dias = diasDaJanela(janela).filter((data) => {
    if (modo.diasSemana && modo.diasSemana.length > 0) {
      return modo.diasSemana.includes(diaDaSemana(data));
    }
    if (modo.diasMes && modo.diasMes.length > 0) {
      return modo.diasMes.includes(diaDoMes(data));
    }
    return true;
  });

  const horarios = modo.horarios && modo.horarios.length > 0 ? modo.horarios : [null];

  return dias.flatMap((data) => horarios.map((horario) => ({ data, horario })));
}

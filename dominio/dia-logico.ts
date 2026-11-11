import { type DataLogica, comoDataLogica, somarDias } from "./calendario";

/**
 * Conversão de instante para dia lógico.
 *
 * O dia vira às 04:00 (decisão do mapa de regras), então um registro feito à
 * 01:30 pertence ao dia anterior. A conta é feita sobre a hora de parede no fuso
 * configurado, via `Intl`, e não somando horas ao instante — assim o resultado
 * continua correto em qualquer fuso, com ou sem horário de verão.
 */

export interface RelogioLogico {
  timezone: string;
  /** Hora de parede em que o dia lógico vira. Padrão 4. */
  horaVirada: number;
}

export const RELOGIO_PADRAO: RelogioLogico = {
  timezone: "America/Sao_Paulo",
  horaVirada: 4,
};

interface ParedeLocal {
  data: string;
  hora: number;
  minuto: number;
}

function paredeLocal(instante: Date, timezone: string): ParedeLocal {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    // h23 evita o "24" que alguns runtimes devolvem para a meia-noite.
    hourCycle: "h23",
  }).formatToParts(instante);

  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)!.value;

  return {
    data: `${valor("year")}-${valor("month")}-${valor("day")}`,
    hora: Number(valor("hour")),
    minuto: Number(valor("minute")),
  };
}

/** O dia lógico a que um instante pertence. */
export function dataLogicaDe(
  instante: Date,
  relogio: RelogioLogico = RELOGIO_PADRAO,
): DataLogica {
  const parede = paredeLocal(instante, relogio.timezone);
  const data = comoDataLogica(parede.data);
  return parede.hora < relogio.horaVirada ? somarDias(data, -1) : data;
}

/**
 * Faixa de saudação do dashboard.
 *
 * Usa a hora de parede, não o dia lógico: à 01:00 a saudação é "boa noite"
 * mesmo que o dia lógico ainda seja o anterior.
 */
export type Saudacao = "bom_dia" | "boa_tarde" | "boa_noite";

export function saudacaoDe(
  instante: Date,
  timezone: string = RELOGIO_PADRAO.timezone,
): Saudacao {
  const { hora } = paredeLocal(instante, timezone);
  if (hora >= 5 && hora < 12) return "bom_dia";
  if (hora >= 12 && hora < 18) return "boa_tarde";
  return "boa_noite";
}

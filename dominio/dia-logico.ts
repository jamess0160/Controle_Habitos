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

/** Componentes de parede num fuso, já separados — nada de string para parsear. */
export interface ParedeNoFuso {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

function paredeNoFuso(instante: Date, timezone: string): ParedeNoFuso {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    // h23 evita o "24" que alguns runtimes devolvem para a meia-noite.
    hourCycle: "h23",
  }).formatToParts(instante);

  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    Number(partes.find((p) => p.type === tipo)!.value);

  return {
    ano: valor("year"),
    mes: valor("month"),
    dia: valor("day"),
    hora: valor("hour"),
    minuto: valor("minute"),
    segundo: valor("second"),
  };
}

interface ParedeLocal {
  data: string;
  hora: number;
  minuto: number;
}

function paredeLocal(instante: Date, timezone: string): ParedeLocal {
  const { ano, mes, dia, hora, minuto } = paredeNoFuso(instante, timezone);
  const dois = (n: number) => String(n).padStart(2, "0");

  return { data: `${ano}-${dois(mes)}-${dois(dia)}`, hora, minuto };
}

/** Quanto o fuso está à frente do UTC naquele instante, em milissegundos. */
function deslocamento(instante: Date, timezone: string): number {
  const p = paredeNoFuso(instante, timezone);
  const comoSeFosseUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);

  /* Os componentes não têm milissegundo; o instante precisa ser comparado na
     mesma resolução, senão o deslocamento sai com um resto de até 999 ms. */
  return comoSeFosseUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

/**
 * A volta de `paredeLocal`: hora de parede num fuso → instante absoluto.
 *
 * Existe para o modo manual do worker (`npm run worker:tique`) aceitar
 * `2026-11-19 04:01` e simular a virada **do app**, não a do processo. Sem ela o
 * argumento seria lido no fuso de quem roda: num contêiner com `TZ=UTC`, as
 * `04:01` pedidas seriam `01:01` em São Paulo, a virada não aconteceria, e o
 * teste manual concluiria que o worker está quebrado quando o errado era o
 * instante.
 *
 * O método é chutar e corrigir — trata os componentes como se fossem UTC, mede
 * o quanto a parede desse chute se afastou do que foi pedido, e desloca pelo
 * tanto. A segunda passada só muda algo em transição de horário de verão, onde o
 * deslocamento do chute é o do lado errado da mudança; com ela, o resultado é o
 * instante certo mesmo nas duas horas do ano em que isso importa.
 *
 Perto da transição, a parede pedida é a parede obtida.
 *
 * As duas horas ambíguas do ano resolvem para um instante real e determinado, e
 * nunca para `Invalid Date`: a hora **repetida** pelo atraso cai na primeira
 * passagem, e a hora que o adiantamento **pula** cai uma hora antes do salto
 * (02:30 pedida → 01:30). Nenhuma das duas acontece no Brasil desde 2019; valem
 * porque o fuso vem de `config_app` e nada impede configurar um que as tenha.
 */
export function instanteDeParede(
  parede: Omit<ParedeNoFuso, "segundo"> & { segundo?: number },
  timezone: string = RELOGIO_PADRAO.timezone,
): Date {
  const alvo = Date.UTC(
    parede.ano,
    parede.mes - 1,
    parede.dia,
    parede.hora,
    parede.minuto,
    parede.segundo ?? 0,
  );

  let instante = alvo;
  for (let passada = 0; passada < 2; passada += 1) {
    instante = alvo - deslocamento(new Date(instante), timezone);
  }

  return new Date(instante);
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

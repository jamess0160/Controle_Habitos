import { type DataLogica, comoDataLogica } from "@/dominio/calendario";
import { type RelogioLogico, RELOGIO_PADRAO, dataLogicaDe, saudacaoDe } from "@/dominio/dia-logico";
import { lerConfig } from "./config";

/**
 * O relógio lógico do servidor.
 *
 * A virada das 04:00 e o fuso são **configuração**, editável em Ajustes, e
 * `dominio/dia-logico.ts` recebe os dois por parâmetro em vez de assumi-los. Este
 * módulo é quem lê o par de `config_app` e o entrega ao domínio.
 *
 * Existe porque a armadilha nº 1 do projeto precisa de um lugar só: nenhuma rota
 * deve chamar `new Date().toISOString().slice(0, 10)`. Todo "que dia é hoje" do
 * servidor passa por aqui.
 */

export async function relogioAtual(): Promise<RelogioLogico> {
  const config = await lerConfig();

  return {
    timezone: config.timezone ?? RELOGIO_PADRAO.timezone,
    horaVirada: horaDe(config.hora_virada),
  };
}

/**
 * Converte `"04:00"` ou `"04:00:00"` em 4.
 *
 * Tolera os dois formatos porque o seed grava `"04:00"` e `PATCH /api/config`
 * recebe `horario`, que o contrato normaliza em `HH:MM:SS`. Valor ilegível cai no
 * padrão em vez de virar `NaN` — um `NaN` aqui faria todo dia lógico sair errado,
 * silenciosamente.
 */
function horaDe(valor: string | null): number {
  if (valor === null) return RELOGIO_PADRAO.horaVirada;

  const hora = Number(valor.slice(0, 2));
  return Number.isInteger(hora) && hora >= 0 && hora <= 23 ? hora : RELOGIO_PADRAO.horaVirada;
}

/** O dia lógico de agora. */
export async function hojeLogico(agora = new Date()): Promise<DataLogica> {
  return dataLogicaDe(agora, await relogioAtual());
}

/**
 * `HH:MM:SS` na parede do fuso configurado.
 *
 * Pelo `Intl` e não por `getHours()`, que usaria o fuso do **processo** — num
 * contêiner com `TZ=UTC` as 20:00 de São Paulo virariam 23:00, e nenhum registro
 * casaria com o slot dele nem nenhum lembrete com o horário dele.
 *
 * Mora aqui porque três módulos precisavam da mesma conversão (materialização,
 * dashboard e worker) e três cópias de uma conta de fuso é um erro esperando
 * divergir.
 */
export function horaDeParede(instante: Date, timezone: string): string {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instante);

  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? "00";

  return `${valor("hour")}:${valor("minute")}:${valor("second")}`;
}

/** A saudação do dashboard, pela hora de parede — à 01:00 é "boa noite". */
export async function saudacaoAtual(agora = new Date()) {
  const { timezone } = await relogioAtual();
  return saudacaoDe(agora, timezone);
}

export { comoDataLogica, type DataLogica };

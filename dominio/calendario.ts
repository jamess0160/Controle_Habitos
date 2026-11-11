/**
 * Aritmética de data lógica.
 *
 * Toda conta é feita em UTC sobre o par ano/mês/dia, nunca sobre um instante no
 * fuso local. Isso elimina de saída qualquer deslocamento por horário de verão
 * ou por fuso da máquina: somar 1 dia a `2026-11-09` sempre dá `2026-11-10`.
 *
 * `DataLogica` é um tipo nominal de propósito. O erro que esta marcação impede é
 * o descrito no mapa de regras: passar um timestamp onde se espera um dia
 * lógico. Um `string` cru não é aceito sem passar por `comoDataLogica`.
 */

export type DataLogica = string & { readonly __marca__: "data-logica" };

/** 1 = domingo … 7 = sábado. A semana começa no domingo (decisão do mapa de regras). */
export type DiaDaSemana = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Janela {
  inicio: DataLogica;
  /** Inclusivo. */
  fim: DataLogica;
}

const FORMATO = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_POR_DIA = 86_400_000;

export function comoDataLogica(valor: string): DataLogica {
  const partes = FORMATO.exec(valor);
  if (!partes) {
    throw new Error(`Data lógica inválida: "${valor}" (esperado YYYY-MM-DD)`);
  }

  const [, ano, mes, dia] = partes;
  const instante = Date.UTC(Number(ano), Number(mes) - 1, Number(dia));

  // Rejeita data que "existe" no formato mas não no calendário (2026-02-30).
  if (formatar(instante) !== valor) {
    throw new Error(`Data lógica inexistente no calendário: "${valor}"`);
  }

  return valor as DataLogica;
}

function paraUtc(data: DataLogica): number {
  const partes = FORMATO.exec(data)!;
  return Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
}

function formatar(instanteUtc: number): string {
  const d = new Date(instanteUtc);
  const ano = String(d.getUTCFullYear()).padStart(4, "0");
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(d.getUTCDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

export function somarDias(data: DataLogica, dias: number): DataLogica {
  return formatar(paraUtc(data) + dias * MS_POR_DIA) as DataLogica;
}

/** Dias de `de` até `ate`. Negativo se `ate` for anterior. */
export function diferencaEmDias(de: DataLogica, ate: DataLogica): number {
  return Math.round((paraUtc(ate) - paraUtc(de)) / MS_POR_DIA);
}

export function diaDaSemana(data: DataLogica): DiaDaSemana {
  return (new Date(paraUtc(data)).getUTCDay() + 1) as DiaDaSemana;
}

export function diaDoMes(data: DataLogica): number {
  return new Date(paraUtc(data)).getUTCDate();
}

export function inicioDaSemana(data: DataLogica): DataLogica {
  return somarDias(data, -(diaDaSemana(data) - 1));
}

export function inicioDoMes(data: DataLogica): DataLogica {
  const d = new Date(paraUtc(data));
  return formatar(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)) as DataLogica;
}

export function fimDoMes(data: DataLogica): DataLogica {
  const d = new Date(paraUtc(data));
  // Dia 0 do mês seguinte é o último dia deste mês.
  return formatar(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)) as DataLogica;
}

/** Comparação funciona por ordem lexicográfica porque o formato é ISO. */
export function ehAntesDe(a: DataLogica, b: DataLogica): boolean {
  return a < b;
}

export function ehDepoisDe(a: DataLogica, b: DataLogica): boolean {
  return a > b;
}

export function estaNaJanela(data: DataLogica, janela: Janela): boolean {
  return data >= janela.inicio && data <= janela.fim;
}

export function menor(a: DataLogica, b: DataLogica): DataLogica {
  return a <= b ? a : b;
}

export function maior(a: DataLogica, b: DataLogica): DataLogica {
  return a >= b ? a : b;
}

/** Todos os dias da janela, início e fim inclusos. */
export function diasDaJanela(janela: Janela): DataLogica[] {
  const dias: DataLogica[] = [];
  for (let d = janela.inicio; d <= janela.fim; d = somarDias(d, 1)) {
    dias.push(d);
  }
  return dias;
}

import type { DataLogica } from "./calendario";

/**
 * Avaliação de meta.
 *
 * Duas camadas que o mapa de regras define separadamente:
 *
 * - a **unidade marcável** (um dia no modo flexível, um slot no modo fixo) é
 *   cumprida conforme o tipo do hábito;
 * - o **período** é cumprido quando reúne unidades cumpridas suficientes.
 *
 * O hábito `negativo` é a exceção: ele não tem unidade cumprida, tem recaída. A
 * avaliação é do período inteiro e ele nasce cumprido.
 */

export type Meta =
  | { tipo: "binario" }
  | { tipo: "quantificado"; valor: number }
  | { tipo: "duracao"; minutos: number }
  | { tipo: "negativo"; tolerancia: number };

export type Modo =
  | { tipo: "flexivel"; metaOcorrencias: number }
  | { tipo: "fixo" };

export interface RegistroDoDominio {
  dataLogica: DataLogica;
  valor: number;
}

export interface ResultadoAvaliacao {
  cumprido: boolean;
  /** Unidades que atingiram a meta individual. */
  unidadesCumpridas: number;
  /** Total de unidades avaliadas. */
  unidadesTotais: number;
  /**
   * Quanto o período vale para a sequência, se fechar cumprido: a quantidade de
   * unidades no modo fixo, 1 no modo flexível (decisão do mapa de regras).
   */
  interacoes: number;
}

/** Uma unidade marcável está cumprida? Não se aplica a hábito `negativo`. */
export function unidadeCumprida(meta: Meta, registros: RegistroDoDominio[]): boolean {
  switch (meta.tipo) {
    case "binario":
      return registros.length >= 1;
    case "quantificado":
      return somar(registros) >= meta.valor;
    case "duracao":
      return somar(registros) >= meta.minutos;
    case "negativo":
      throw new Error(
        "Hábito negativo não tem unidade cumprida — avalie o período com avaliarPeriodo.",
      );
  }
}

/**
 * Avalia um período.
 *
 * `unidades` vem agrupada pelo chamador: um grupo por dia no modo flexível, um
 * grupo por slot no modo fixo. Agrupar é responsabilidade de quem conhece a
 * ligação entre registro e ocorrência, não desta função.
 */
export function avaliarPeriodo(
  meta: Meta,
  modo: Modo,
  unidades: RegistroDoDominio[][],
): ResultadoAvaliacao {
  if (meta.tipo === "negativo") {
    const recaidas = unidades.reduce((total, grupo) => total + grupo.length, 0);
    const cumprido = recaidas <= meta.tolerancia;
    return {
      cumprido,
      unidadesCumpridas: cumprido ? 1 : 0,
      unidadesTotais: 1,
      interacoes: 1,
    };
  }

  const cumpridas = unidades.filter((grupo) => unidadeCumprida(meta, grupo)).length;

  if (modo.tipo === "flexivel") {
    const cumprido = cumpridas >= modo.metaOcorrencias;
    return {
      cumprido,
      unidadesCumpridas: cumpridas,
      unidadesTotais: modo.metaOcorrencias,
      interacoes: 1,
    };
  }

  // Modo fixo: o período só está cumprido quando nenhum slot ficou para trás, e
  // cada slot cumprido conta uma interação na sequência.
  return {
    cumprido: unidades.length > 0 && cumpridas === unidades.length,
    unidadesCumpridas: cumpridas,
    unidadesTotais: unidades.length,
    interacoes: cumpridas,
  };
}

function somar(registros: RegistroDoDominio[]): number {
  return registros.reduce((total, registro) => total + registro.valor, 0);
}

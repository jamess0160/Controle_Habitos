/**
 * Regras de estoque de congelamento.
 *
 * Ganho a cada N interações consecutivas no prazo, consumo automático no
 * fechamento de período que ficou abaixo da meta, teto fixo de estoque.
 */

export interface RegraCongelamento {
  /** Interações consecutivas no prazo por congelamento ganho. */
  aCada: number;
  /** Teto do estoque. */
  max: number;
}

/**
 * Quantos congelamentos o avanço da sequência gera.
 *
 * O ganho acompanha a sequência atual, então com `aCada: 3` as interações 3, 6 e
 * 9 geram um congelamento cada. Como a sequência zera ao falhar, a contagem de
 * ganhos zera com ela.
 *
 * Com o estoque cheio, o excedente é **descartado** e não fica numa fila
 * esperando espaço.
 */
export function ganhosAoAvancar(
  sequenciaAnterior: number,
  interacoes: number,
  regra: RegraCongelamento,
  estoqueAtual: number,
): number {
  if (interacoes <= 0) return 0;

  const antes = Math.floor(sequenciaAnterior / regra.aCada);
  const depois = Math.floor((sequenciaAnterior + interacoes) / regra.aCada);
  const espaco = Math.max(0, regra.max - estoqueAtual);

  return Math.min(depois - antes, espaco);
}

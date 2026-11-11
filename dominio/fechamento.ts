/**
 * Decisão de fechamento de período.
 *
 * Não existe estado de espera: quando o período fecha abaixo da meta, o
 * congelamento é consumido automaticamente se houver estoque, e a alternativa é
 * falhar na mesma transação. A correção posterior é o preenchimento retroativo,
 * limitado a 7 dias.
 */

export type StatusFechado = "cumprido" | "congelado" | "falhou";

export interface EntradaFechamento {
  cumprido: boolean;
  congelamentoAtivo: boolean;
  congelamentosDisponiveis: number;
}

export function decidirFechamento(entrada: EntradaFechamento): StatusFechado {
  if (entrada.cumprido) return "cumprido";
  if (entrada.congelamentoAtivo && entrada.congelamentosDisponiveis > 0) return "congelado";
  return "falhou";
}

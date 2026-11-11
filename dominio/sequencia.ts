import type { DataLogica } from "./calendario";
import type { StatusFechado } from "./fechamento";

/**
 * Sequência por hábito, contada em **interações concluídas no prazo**.
 *
 * "No prazo" significa dentro do período correto, independentemente de quando o
 * registro foi criado — por isso o preenchimento retroativo conta normalmente.
 *
 * Período congelado preserva a sequência mas não soma, o que também impede que
 * nunca fazer o hábito gere congelamentos novos.
 */

export interface EstadoSequencia {
  atual: number;
  recorde: number;
  totalNoPrazo: number;
  /** Primeiro período da sequência atual. */
  desde: DataLogica | null;
}

export const SEQUENCIA_INICIAL: EstadoSequencia = {
  atual: 0,
  recorde: 0,
  totalNoPrazo: 0,
  desde: null,
};

export interface FechamentoParaSequencia {
  status: StatusFechado;
  /** Interações que o período vale: slots cumpridos no fixo, 1 no flexível. */
  interacoes: number;
  inicio: DataLogica;
}

export function aplicarFechamento(
  estado: EstadoSequencia,
  fechamento: FechamentoParaSequencia,
): EstadoSequencia {
  switch (fechamento.status) {
    case "cumprido": {
      const atual = estado.atual + fechamento.interacoes;
      return {
        atual,
        recorde: Math.max(estado.recorde, atual),
        totalNoPrazo: estado.totalNoPrazo + fechamento.interacoes,
        desde: estado.desde ?? fechamento.inicio,
      };
    }
    case "congelado":
      // Preserva tudo: não soma, não zera, não conta para ganhar congelamento.
      return estado;
    case "falhou":
      return { ...estado, atual: 0, desde: null };
  }
}

import * as z from "zod";

/**
 * Primitivos compartilhados pelos contratos.
 *
 * Tudo que aparece em mais de um recurso mora aqui, para o formato não divergir
 * entre o request que escreve e o response que lê.
 */

export const uuid = z.uuid();

/**
 * Dia lógico no formato `AAAA-MM-DD`.
 *
 * `z.iso.date()` valida o calendário de verdade — `2026-02-30` é recusado —, o
 * que uma regex de formato não faria. O tipo nominal `DataLogica` do domínio não
 * é usado aqui de propósito: o contrato descreve o que trafega no JSON, e a
 * conversão para o tipo do domínio é feita na borda.
 */
export const dataLogica = z.iso.date();

/** Horário de parede, sempre com segundos — é o formato que o Postgres devolve. */
export const horario = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d:00$/, "Use o formato HH:MM:00.");

/** Instante absoluto em ISO 8601 com fuso. */
export const instante = z.iso.datetime({ offset: true });

/**
 * Paleta fechada. Os tokens definitivos saem na etapa 2, junto do design — até
 * lá a lista existe para o contrato recusar cor arbitrária desde já.
 */
export const COR = ["azul", "ciano", "verde", "ambar", "vermelho", "roxo"] as const;
export const cor = z.enum(COR);
export type Cor = z.infer<typeof cor>;

/** 1 = domingo … 7 = sábado, como no banco e no domínio. */
export const diaDaSemana = z.int().min(1).max(7);
export const diaDoMes = z.int().min(1).max(31);

export const nomeDeHabito = z
  .string()
  .trim()
  .min(1, "O nome não pode ficar vazio.")
  .max(80, "O nome aceita no máximo 80 caracteres.");

/**
 * Sequência de um hábito, como o dashboard e a lista a consomem.
 *
 * `atual` é a contagem de interações consecutivas concluídas no prazo; `recorde`
 * e `totalNoPrazo` só aparecem na tela de detalhe (onda 2), mas trafegam desde
 * já para o schema não mudar depois.
 */
export const sequencia = z.object({
  atual: z.int().min(0),
  recorde: z.int().min(0),
  totalNoPrazo: z.int().min(0),
  desde: dataLogica.nullable(),
});
export type Sequencia = z.infer<typeof sequencia>;

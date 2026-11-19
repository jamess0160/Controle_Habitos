import * as z from "zod";
import { cor, dataLogica, horario, instante, uuid } from "./comum";

/**
 * Contrato do dashboard — `GET /api/hoje`.
 *
 * O payload é montado por **interação devida**, não por hábito: um hábito fixo
 * com dois horários rende duas linhas marcáveis, ambas exibindo a mesma
 * sequência. É o que o [Mapa de telas](../Docs/mapas/Mapa%20de%20telas.md)
 * descreve, e evita a tela ter de explodir hábito em linhas por conta própria.
 */

export const SAUDACAO = ["bom_dia", "boa_tarde", "boa_noite"] as const;
export const saudacao = z.enum(SAUDACAO);
export type Saudacao = z.infer<typeof saudacao>;

/**
 * Progresso na forma própria de cada tipo, para a linha do dashboard.
 *
 * Uma união por tipo em vez de um objeto largo com `acumulado`, `meta`,
 * `unidade` e `recaidas` todos opcionais: assim a tela não precisa testar null
 * para descobrir o que mostrar, e "0/2 L" nunca pode ser renderizado sem unidade.
 */
export const progresso = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("binario"),
    concluidas: z.int().min(0),
    meta: z.int().min(1),
  }),
  z.object({
    tipo: z.literal("quantificado"),
    acumulado: z.number().min(0),
    meta: z.number().positive(),
    unidade: z.string(),
  }),
  z.object({
    tipo: z.literal("duracao"),
    /** Os dois em **segundos** inteiros — ver `contracts/duracao.ts`. */
    acumulado: z.int().min(0),
    meta: z.int().positive(),
  }),
  z.object({
    tipo: z.literal("negativo"),
    recaidas: z.int().min(0),
    tolerancia: z.int().min(0),
  }),
]);
export type Progresso = z.infer<typeof progresso>;

export const linhaDeHoje = z.object({
  habitoId: uuid,
  nome: z.string(),
  cor,
  periodoId: uuid,
  /** Preenchidos só no modo fixo, onde a marcação é contra um momento concreto. */
  ocorrenciaId: uuid.nullable(),
  horario: horario.nullable(),
  concluida: z.boolean(),
  /**
   * O último registro do dia lógico nesta interação — o que o dashboard desfaz.
   *
   * Acréscimo da etapa 2.4: sem ele, uma marcação por engano só se corrigia
   * abrindo o retroativo do hábito, e `DELETE /api/registros/:id` precisa de um
   * id que a linha não carregava.
   *
   * **Vai o último, não a lista toda, e com o `valor` dentro.** O id sozinho
   * deixaria a tela sem saber *quanto* desfazer — apagar um incremento de 250 ml
   * precisa subtrair 250, e só o servidor sabe quanto valia aquele registro.
   * Mandar o valor aqui evita que a tela tenha de esperar a resposta do DELETE
   * para redesenhar a linha.
   *
   * `null` quando não há nada a desfazer hoje nesta interação. Correção mais
   * profunda que o último toque continua sendo trabalho do retroativo, que é
   * onde a janela de 7 dias inteira está à vista.
   */
  ultimoRegistro: z.object({ id: uuid, valor: z.number() }).nullable(),
  progresso,
  /** 🔥 interações consecutivas no prazo deste hábito. */
  sequencia: z.int().min(0),
  /** ❄ congelamentos em estoque. */
  congelamentos: z.int().min(0),
});
export type LinhaDeHoje = z.infer<typeof linhaDeHoje>;

/**
 * Bloco de avisos: informativo, comunica o que já aconteceu.
 *
 * Com o consumo automático de congelamento não existe mais nada a decidir no
 * prazo, então o antigo aviso de "sequência em risco" não tem equivalente aqui.
 */
export const aviso = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("congelamento_usado"),
    habitoId: uuid,
    habitoNome: z.string(),
    /** Período que foi salvo pelo congelamento. */
    periodoFim: dataLogica,
    restantes: z.int().min(0),
  }),
  z.object({
    tipo: z.literal("sequencia_perdida"),
    habitoId: uuid,
    habitoNome: z.string(),
    periodoFim: dataLogica,
    sequenciaPerdida: z.int().min(1),
  }),
]);
export type Aviso = z.infer<typeof aviso>;

export const hoje = z.object({
  /** Pela hora de parede, não pelo dia lógico: à 01:00 é "boa noite". */
  saudacao,
  usuarioNome: z.string(),
  dataLogica,
  /** Instante da montagem — a tela usa para saber se o payload envelheceu. */
  geradoEm: instante,
  /** Na ordem de `habito.ordem`. */
  linhas: z.array(linhaDeHoje),
  avisos: z.array(aviso),
});
export type Hoje = z.infer<typeof hoje>;

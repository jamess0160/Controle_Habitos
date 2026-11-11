import * as z from "zod";
import {
  cor,
  dataLogica,
  diaDaSemana,
  diaDoMes,
  horario,
  instante,
  nomeDeHabito,
  sequencia,
  uuid,
} from "./comum";

/**
 * Contrato do hábito e da sua configuração.
 *
 * A configuração é o ponto mais escorregadio do app: a tabela `habito_config` é
 * larga e cheia de nullables porque uma única linha guarda as 4 cadências, os 2
 * modos e os 4 tipos de meta. Aqui ela é o oposto — **uniões discriminadas em
 * que cada variante carrega só os campos que fazem sentido nela**, espelhando
 * `dominio/periodo.ts` e `dominio/meta.ts`. `db/mapa-dominio.ts` é a ponte.
 *
 * A exclusividade é **estrutural**, não checada por refinamento: a cadência
 * `cada_n_dias` não existe no modo `fixo`, então `metaOcorrencias` com
 * `modo: "fixo"` nem compila. É a tabela de CHECKs da migration existindo
 * também no tipo, que era o objetivo da etapa 1.4.
 *
 * Por que a cadência e a meta são objetos aninhados em vez de campos irmãos:
 * `z.discriminatedUnion` não aceita intersecção como opção (testado na v4.6) e
 * não há como discriminar por duas chaves irmãs ao mesmo tempo. Aninhar resolve
 * e, de bônus, deixa o contrato idêntico às uniões do domínio.
 */

export const TIPO_HABITO = ["binario", "quantificado", "duracao", "negativo"] as const;
export type TipoHabito = (typeof TIPO_HABITO)[number];

export const CADENCIA = ["diario", "cada_n_dias", "semanal", "mensal"] as const;

// ─── Cadência ────────────────────────────────────────────────────────────────

/**
 * Cadências do modo flexível. `cada_n_dias` só existe aqui: com a janela
 * ancorada na última conclusão ela anda no calendário, e momentos fixos dentro
 * de uma janela móvel não descrevem nada.
 */
export const cadenciaFlexivel = z.discriminatedUnion("tipo", [
  z.strictObject({ tipo: z.literal("diario") }),
  z.strictObject({
    tipo: z.literal("cada_n_dias"),
    intervalo: z.int().min(2, "O intervalo precisa ser de ao menos 2 dias."),
  }),
  z.strictObject({ tipo: z.literal("semanal") }),
  z.strictObject({ tipo: z.literal("mensal") }),
]);

/**
 * Cadências do modo fixo, cada uma carregando os momentos que fazem sentido
 * nela: `dias_semana` só na semanal, `dias_mes` só na mensal — igual aos CHECKs
 * `habito_config_dias_semana_cadencia` e `..._dias_mes_cadencia`.
 *
 * `horarios` é opcional na semanal e na mensal: sem ele o dia inteiro é uma
 * ocorrência só. Na diária ele é obrigatório, senão a configuração não
 * determinaria momento nenhum.
 */
export const cadenciaFixa = z.discriminatedUnion("tipo", [
  z.strictObject({
    tipo: z.literal("diario"),
    horarios: z.array(horario).min(1).max(8),
  }),
  z.strictObject({
    tipo: z.literal("semanal"),
    diasSemana: z.array(diaDaSemana).min(1).max(7),
    horarios: z.array(horario).min(1).max(8).optional(),
  }),
  z.strictObject({
    tipo: z.literal("mensal"),
    diasMes: z.array(diaDoMes).min(1).max(31),
    horarios: z.array(horario).min(1).max(8).optional(),
  }),
]);

// ─── Meta por tipo ───────────────────────────────────────────────────────────

const metaBinario = z.strictObject({ tipo: z.literal("binario") });

const metaQuantificado = z.strictObject({
  tipo: z.literal("quantificado"),
  valor: z.number().positive("A meta precisa ser maior que zero."),
  unidade: z.string().trim().min(1, "Informe a unidade (ml, páginas, km…).").max(16),
});

const metaDuracao = z.strictObject({
  tipo: z.literal("duracao"),
  minutos: z.int().positive("A meta precisa ser maior que zero."),
});

const metaNegativo = z.strictObject({
  tipo: z.literal("negativo"),
  /** 0 = nenhuma recaída tolerada no período. */
  tolerancia: z.int().min(0),
});

/**
 * Indexado por tipo, e não descoberto com `.options.find()`, para o estreitamento
 * acontecer de verdade: `META_POR_TIPO["duracao"]` tem tipo próprio, enquanto o
 * resultado de um `find` seria a união dos quatro e não estreitaria nada.
 */
export const META_POR_TIPO = {
  binario: metaBinario,
  quantificado: metaQuantificado,
  duracao: metaDuracao,
  negativo: metaNegativo,
} as const;

export const meta = z.discriminatedUnion("tipo", [
  metaBinario,
  metaQuantificado,
  metaDuracao,
  metaNegativo,
]);

export type Meta = z.infer<typeof meta>;

// ─── Congelamento ────────────────────────────────────────────────────────────

export const congelamento = z
  .strictObject({
    aCada: z.int().min(1, "Precisa de ao menos 1 interação por congelamento."),
    max: z.int().min(1).max(10),
  })
  .nullable();

// ─── Configuração ────────────────────────────────────────────────────────────

const configFlexivel = z.strictObject({
  modo: z.literal("flexivel"),
  cadencia: cadenciaFlexivel,
  metaOcorrencias: z.int().min(1, "A meta do período precisa ser de ao menos 1."),
  /** Horário do lembrete. No modo fixo ele é derivado dos `horarios`. */
  notificarEm: horario.nullable(),
  meta,
  congelamento,
});

const configFixo = z.strictObject({
  modo: z.literal("fixo"),
  cadencia: cadenciaFixa,
  meta,
  congelamento,
});

export const configHabito = z.discriminatedUnion("modo", [configFlexivel, configFixo]);

export type ConfigHabito = z.infer<typeof configHabito>;

// ─── Requests ────────────────────────────────────────────────────────────────

/**
 * POST /api/habitos
 *
 * Sem `inicioEm`: o hábito começa hoje, sempre. O formulário não pergunta data
 * de início e o retroativo de 7 dias cobre o caso de ter começado antes.
 */
export const criarHabito = z.strictObject({
  nome: nomeDeHabito,
  cor,
  config: configHabito,
});
export type CriarHabito = z.infer<typeof criarHabito>;

/**
 * PATCH /api/habitos/:id — cria uma **nova versão** da configuração.
 *
 * O schema é construído a partir do tipo atual do hábito porque o tipo é
 * imutável: trocá-lo reinterpretaria todo o histórico pela régua errada, e no
 * banco a FK composta `(habito_id, tipo)` com ON UPDATE CASCADE propagaria a
 * troca para as versões antigas, que então quebrariam os CHECKs de meta. O
 * cliente já conhece o tipo do hábito que está editando, então estreitar aqui
 * não custa nada e faz o erro aparecer em tempo de compilação.
 */
export function editarHabito<T extends TipoHabito>(tipo: T) {
  const metaDoTipo = META_POR_TIPO[tipo];

  const configDoTipo = z.discriminatedUnion("modo", [
    configFlexivel.extend({ meta: metaDoTipo }),
    configFixo.extend({ meta: metaDoTipo }),
  ]);

  return z.strictObject({
    nome: nomeDeHabito.optional(),
    cor: cor.optional(),
    config: configDoTipo.optional(),
  });
}

/** PUT /api/habitos/ordem — a lista completa, na ordem desejada. */
export const reordenarHabitos = z.strictObject({
  ordem: z.array(uuid).min(1),
});
export type ReordenarHabitos = z.infer<typeof reordenarHabitos>;

/** POST /api/habitos/:id/pausa — `ate: null` é pausa aberta. */
export const pausarHabito = z.strictObject({
  de: dataLogica,
  ate: dataLogica.nullable(),
});
export type PausarHabito = z.infer<typeof pausarHabito>;

// ─── Responses ───────────────────────────────────────────────────────────────

export const pausa = z.object({ de: dataLogica, ate: dataLogica.nullable() });

export const habito = z.object({
  id: uuid,
  nome: z.string(),
  cor,
  inicioEm: dataLogica,
  ordem: z.int(),
  config: configHabito,
  /**
   * A regra em linguagem natural ("3x por semana", "a cada 15 dias"), montada no
   * servidor. Fica no payload para a frase não ser remontada em cada tela, com
   * risco de divergir entre a lista e o resumo do formulário.
   */
  resumo: z.string(),
  sequencia,
  congelamentosDisponiveis: z.int().min(0),
  pausa: pausa.nullable(),
  arquivadoEm: instante.nullable(),
});
export type Habito = z.infer<typeof habito>;

export const listaDeHabitos = z.object({
  habitos: z.array(habito),
  arquivados: z.array(habito),
});
export type ListaDeHabitos = z.infer<typeof listaDeHabitos>;

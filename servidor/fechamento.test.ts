/**
 * O fechamento de período, contra o Postgres (etapa 3.7).
 *
 * `dominio/simulacao.test.ts` já prova as **decisões** do fechamento — quando
 * ganha congelamento, quando consome, quando falha. O que falta é a outra
 * metade: que essas decisões cheguem às tabelas. Entre a decisão e a linha no
 * banco está a materialização, que escolhe **qual** congelamento é consumido
 * (FIFO), pareia ganho e consumo, e grava a sequência — e nenhuma dessas três
 * coisas o domínio faz.
 *
 * O cenário que dá nome a este arquivo é o do roadmap: **congelamento esgotado**.
 * É o pior de errar, porque o efeito é silencioso nos dois sentidos — um
 * congelamento consumido que não existia salvaria uma sequência que devia ter
 * caído, e um estoque que não é gasto derruba uma que devia ter sido salva.
 */

import type { ConfigHabito, CriarHabito } from "@/contracts";
import { criarHabito as schemaCriar, exigirValido } from "@/contracts";
import { db } from "@/db/knex";
import { comoDataLogica, somarDias } from "@/dominio/calendario";
import { encerrarBanco, limpar, semearConfig } from "./apoio-de-teste";
import { criarHabitoNoBanco } from "./habitos";
import { materializar } from "./materializar";
import { criarRegistroNoBanco } from "./registros";
import { hojeLogico } from "./relogio";

beforeEach(async () => {
  await limpar(db);
  await semearConfig();
});

afterAll(encerrarBanco);

// ─── Utilidades ──────────────────────────────────────────────────────────────

function diario(congelamento: { aCada: number; max: number } | null): ConfigHabito {
  return {
    modo: "flexivel",
    cadencia: { tipo: "diario" },
    metaOcorrencias: 1,
    notificarEm: null,
    meta: { tipo: "binario" },
    congelamento,
  };
}

async function hoje() {
  return comoDataLogica(await hojeLogico());
}

/**
 * Um hábito diário que começou `dias` atrás, com marcação nos dias pedidos.
 *
 * `diasMarcados` são deslocamentos para trás a partir de hoje, e a ordem não
 * importa: a materialização é um replay do conjunto, não um acúmulo incremental.
 */
async function comHistorico(
  dias: number,
  diasMarcados: number[],
  congelamento: { aCada: number; max: number } | null,
) {
  const entrada: CriarHabito = exigirValido(
    schemaCriar,
    { nome: "🏃 Correr", cor: "ciano", config: diario(congelamento) },
    "hábito de teste",
  );
  const habito = await criarHabitoNoBanco(entrada);

  const inicio = somarDias(await hoje(), -dias);
  await db("habito").where({ id: habito.id }).update({ inicio_em: inicio });
  await db("habito_config").where({ habito_id: habito.id }).update("vigente_de", inicio);
  await db.transaction((trx) => materializar(trx, habito.id));

  for (const atras of diasMarcados) {
    await criarRegistroNoBanco({
      habitoId: habito.id,
      dataLogica: somarDias(await hoje(), -atras),
      origem: "retroativo",
    });
  }

  return habito.id;
}

async function estoque(habitoId: string) {
  const linhas = await db("congelamento").where({ habito_id: habitoId }).select("status");

  return {
    disponiveis: linhas.filter((l) => l.status === "disponivel").length,
    consumidos: linhas.filter((l) => l.status === "consumido").length,
  };
}

async function sequencia(habitoId: string) {
  const linha = await db("habito_streak").where({ habito_id: habitoId }).first();
  return { atual: linha?.sequencia_atual ?? 0, recorde: linha?.sequencia_recorde ?? 0 };
}

async function statusDoDia(habitoId: string, atras: number): Promise<string | undefined> {
  const data = somarDias(await hoje(), -atras);
  const periodo = await db("habito_periodo")
    .where({ habito_id: habitoId })
    .where("inicio", "<=", data)
    .where("fim", ">=", data)
    .first("status");

  return periodo?.status;
}

// ─── Ganho ───────────────────────────────────────────────────────────────────

describe("ganho de congelamento", () => {
  it("nasce uma linha por unidade, com o período que a gerou", async () => {
    /* `aCada: 2` com 4 dias cumpridos: as interações 2 e 4 geram um cada. */
    const id = await comHistorico(5, [5, 4, 3, 2, 1], { aCada: 2, max: 3 });

    expect(await estoque(id)).toEqual({ disponiveis: 2, consumidos: 0 });

    /* Estoque unitário e não contador: cada linha tem rastro de onde veio. */
    const linhas = await db("congelamento").where({ habito_id: id }).select("ganho_por_periodo_id");
    expect(linhas.every((l) => l.ganho_por_periodo_id !== null)).toBe(true);
  });

  it("o teto descarta o excedente em vez de enfileirá-lo", async () => {
    const id = await comHistorico(6, [6, 5, 4, 3, 2, 1], { aCada: 1, max: 2 });

    /* Seis dias cumpridos dariam seis; o teto é 2. */
    expect((await estoque(id)).disponiveis).toBe(2);
  });

  it("sem regra de congelamento, o estoque não existe", async () => {
    const id = await comHistorico(4, [4, 3, 2, 1], null);

    expect(await estoque(id)).toEqual({ disponiveis: 0, consumidos: 0 });
  });
});

// ─── Consumo ─────────────────────────────────────────────────────────────────

describe("consumo automático", () => {
  it("o dia perdido fecha como `congelado` e gasta uma unidade do estoque", async () => {
    /* Marcado em d-5..d-2, buraco em d-1. */
    const id = await comHistorico(5, [5, 4, 3, 2], { aCada: 2, max: 3 });

    expect(await statusDoDia(id, 1)).toBe("congelado");
    expect(await estoque(id)).toEqual({ disponiveis: 1, consumidos: 1 });
  });

  it("o congelamento preserva a sequência: ela conta os dias cumpridos", async () => {
    const id = await comHistorico(5, [5, 4, 3, 2], { aCada: 2, max: 3 });

    /*
     * Quatro dias cumpridos e um congelado: `congelado` não soma e não
     * interrompe, que é a decisão de `aplicarFechamento`.
     */
    expect(await sequencia(id)).toMatchObject({ atual: 4 });
  });

  it("a unidade consumida aponta o período que a gastou", async () => {
    const id = await comHistorico(5, [5, 4, 3, 2], { aCada: 2, max: 3 });

    const consumida = await db("congelamento")
      .where({ habito_id: id, status: "consumido" })
      .first("consumido_em", "consumido_periodo_id");

    /* O `CHECK congelamento_consumo` exige os dois juntos — ou nenhum. */
    expect(consumida?.consumido_em).not.toBeNull();
    expect(consumida?.consumido_periodo_id).not.toBeNull();
  });
});

// ─── Esgotamento ─────────────────────────────────────────────────────────────

describe("congelamento esgotado", () => {
  it("o estoque vazio deixa o período falhar e zera a sequência", async () => {
    /*
     * O cenário obrigatório do roadmap. `aCada: 3` com apenas dois dias
     * cumpridos nunca gera estoque, então o buraco em d-1 não tem o que gastar.
     */
    const id = await comHistorico(3, [3, 2], { aCada: 3, max: 3 });

    expect(await estoque(id)).toEqual({ disponiveis: 0, consumidos: 0 });
    expect(await statusDoDia(id, 1)).toBe("falhou");
    expect(await sequencia(id)).toMatchObject({ atual: 0 });
  });

  it("o recorde sobrevive à queda — é o que dá sentido a ter um", async () => {
    const id = await comHistorico(3, [3, 2], { aCada: 3, max: 3 });

    const { atual, recorde } = await sequencia(id);
    expect(atual).toBe(0);
    expect(recorde).toBe(2);
  });

  it("gasta o estoque e só então falha: dois buracos com um congelamento só", async () => {
    /*
     * d-6..d-3 cumpridos (um congelamento em `aCada: 4`), buracos em d-2 e d-1.
     * O primeiro buraco consome; o segundo não tem com o que se salvar.
     */
    const id = await comHistorico(6, [6, 5, 4, 3], { aCada: 4, max: 3 });

    expect(await estoque(id)).toEqual({ disponiveis: 0, consumidos: 1 });
    expect(await statusDoDia(id, 2)).toBe("congelado");
    expect(await statusDoDia(id, 1)).toBe("falhou");
    expect(await sequencia(id)).toMatchObject({ atual: 0 });
  });

  it("preencher o buraco retroativamente recupera a sequência inteira", async () => {
    const id = await comHistorico(3, [3, 2], { aCada: 3, max: 3 });
    expect(await sequencia(id)).toMatchObject({ atual: 0 });

    await criarRegistroNoBanco({
      habitoId: id,
      dataLogica: somarDias(await hoje(), -1),
      origem: "retroativo",
    });

    /*
     * Não é "desfazer a falha": é o replay inteiro rodando de novo sobre um
     * conjunto de registros diferente. A falha simplesmente não acontece nesta
     * execução, e é isso que torna o retroativo possível sem um conceito de
     * estorno no domínio.
     */
    expect(await statusDoDia(id, 1)).toBe("cumprido");
    expect(await sequencia(id)).toMatchObject({ atual: 3 });
  });
});

// ─── A materialização é idempotente ──────────────────────────────────────────

describe("replay repetido", () => {
  it("materializar duas vezes dá o mesmo resultado", async () => {
    const id = await comHistorico(5, [5, 4, 3, 2], { aCada: 2, max: 3 });

    const antes = { estoque: await estoque(id), sequencia: await sequencia(id) };
    await db.transaction((trx) => materializar(trx, id));
    const depois = { estoque: await estoque(id), sequencia: await sequencia(id) };

    /*
     * O worker re-materializa na virada de cada dia, e o usuário a cada
     * marcação. Se o replay não fosse idempotente, o estoque de congelamento
     * cresceria a cada tique — e ninguém notaria até a sequência não cair quando
     * devia.
     */
    expect(depois).toEqual(antes);
  });

  it("o id do registro não muda entre materializações", async () => {
    const id = await comHistorico(3, [3, 2], null);

    const antes = await db("registro")
      .join("habito_periodo", "habito_periodo.id", "registro.periodo_id")
      .where("habito_periodo.habito_id", id)
      .orderBy("registro.data_logica", "asc")
      .pluck("registro.id");

    await db.transaction((trx) => materializar(trx, id));

    const depois = await db("registro")
      .join("habito_periodo", "habito_periodo.id", "registro.periodo_id")
      .where("habito_periodo.habito_id", id)
      .orderBy("registro.data_logica", "asc")
      .pluck("registro.id");

    /* `ultimoRegistro.id` e `registroIds` viajam até a tela: um id que muda
       transformaria o botão de desfazer em 404. */
    expect(depois).toEqual(antes);
  });
});

/**
 * Dashboard e registro contra o Postgres de verdade (etapa 3.3).
 *
 * Dois grupos de risco aqui. O primeiro é a **virada das 04:00**: um registro
 * feito à 01:30 pertence ao dia anterior, e errar isso move a marcação de
 * período — o tipo de erro que só aparece semanas depois, numa sequência que não
 * fecha. O segundo é o par marcar/desmarcar: como a materialização é replay,
 * desmarcar tem de devolver o estado exatamente ao que era.
 */

import { hoje as schemaHoje, exigirValido } from "@/contracts";
import type { ConfigHabito, CriarHabito } from "@/contracts";
import { criarHabito as schemaCriar } from "@/contracts";
import { db } from "@/db/knex";
import { comoDataLogica, somarDias } from "@/dominio/calendario";
import { encerrarBanco, limpar, semearConfig } from "./apoio-de-teste";
import { criarHabitoNoBanco, pausarHabitoNoBanco, arquivarHabitoNoBanco } from "./habitos";
import { montarHoje } from "./hoje";
import { apagarRegistroNoBanco, criarRegistroNoBanco } from "./registros";
import { hojeLogico } from "./relogio";

beforeEach(async () => {
  await limpar(db);
  await semearConfig();
});

afterEach(() => {
  jest.useRealTimers();
});

afterAll(encerrarBanco);

// ─── Utilidades ──────────────────────────────────────────────────────────────

function config(sobre: Partial<Extract<ConfigHabito, { modo: "flexivel" }>> = {}): ConfigHabito {
  return {
    modo: "flexivel",
    cadencia: { tipo: "diario" },
    metaOcorrencias: 1,
    notificarEm: null,
    meta: { tipo: "binario" },
    congelamento: null,
    ...sobre,
  } as ConfigHabito;
}

function fixa(horarios: string[]): ConfigHabito {
  return {
    modo: "fixo",
    cadencia: { tipo: "diario", horarios },
    meta: { tipo: "binario" },
    congelamento: null,
  };
}

async function criar(nome: string, c: ConfigHabito) {
  const entrada: CriarHabito = exigirValido(
    schemaCriar,
    { nome, cor: "ciano", config: c },
    "hábito de teste",
  );
  return criarHabitoNoBanco(entrada);
}

/**
 * Congela o relógio só para `Date`.
 *
 * `doNotFake` mantém os temporizadores reais: o driver do Postgres usa
 * `setTimeout` internamente, e congelá-lo faz a consulta nunca voltar.
 */
function congelarRelogio(instante: string): void {
  jest.useFakeTimers({
    doNotFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "setImmediate",
      "clearImmediate",
      "nextTick",
      "queueMicrotask",
      "performance",
      "hrtime",
    ],
  });
  jest.setSystemTime(new Date(instante));
}

// ─── GET /api/hoje ───────────────────────────────────────────────────────────

describe("montarHoje", () => {
  it("bate com o contrato e traz a data lógica", async () => {
    await criar("💧 Água", config());

    const resultado = await montarHoje();

    exigirValido(schemaHoje, resultado, "dashboard");
    expect(resultado.dataLogica).toBe(await hojeLogico());
    expect(resultado.usuarioNome).toBe("Tiago");
  });

  it("uma linha por interação devida: o hábito fixo de dois horários rende duas", async () => {
    await criar("💊 Dose", fixa(["08:00:00", "20:00:00"]));

    const { linhas } = await montarHoje();

    expect(linhas).toHaveLength(2);
    expect(linhas.map((l) => l.horario)).toEqual(["08:00:00", "20:00:00"]);
    /* A sequência é do hábito, não da ocorrência: as duas linhas repetem. */
    expect(linhas[0].sequencia).toBe(linhas[1].sequencia);
    expect(linhas[0].ocorrenciaId).not.toBe(linhas[1].ocorrenciaId);
  });

  it("o hábito flexível rende uma linha, sem ocorrência", async () => {
    await criar("💧 Água", config());

    const { linhas } = await montarHoje();

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ ocorrenciaId: null, horario: null });
  });

  it("pausado e arquivado não aparecem", async () => {
    const pausado = await criar("🧘 Meditar", config());
    const arquivado = await criar("📚 Ler", config());
    await criar("💧 Água", config());

    const hoje = await hojeLogico();
    await pausarHabitoNoBanco(pausado.id, { de: comoDataLogica(hoje), ate: null });
    await arquivarHabitoNoBanco(arquivado.id, true);

    const { linhas } = await montarHoje();

    expect(linhas.map((l) => l.nome)).toEqual(["💧 Água"]);
  });

  it("segue a ordem de `habito.ordem`", async () => {
    await criar("A 1", config());
    await criar("B 2", config());

    const { linhas } = await montarHoje();
    expect(linhas.map((l) => l.nome)).toEqual(["A 1", "B 2"]);
  });

  describe("progresso", () => {
    it("binário mostra o período, porque a interação é binária", async () => {
      /*
       * Semanal, não diário: a unidade do modo flexível é o dia, então
       * `metaOcorrencias: 3` numa cadência diária é inalcançável e o contrato a
       * recusa. Este teste já afirmou `1/3` num hábito diário — descrevendo
       * como correto o bug do `Docs/fixes/01`. Na semana, 3x é legítimo e o
       * ponto do teste (o binário mostra o **período**) é o mesmo.
       */
      const habito = await criar(
        "🏃 Correr",
        config({ cadencia: { tipo: "semanal" }, metaOcorrencias: 3 }),
      );

      let { linhas } = await montarHoje();
      expect(linhas[0].progresso).toEqual({ tipo: "binario", concluidas: 0, meta: 3 });

      await criarRegistroNoBanco({ habitoId: habito.id, origem: "app" });

      ({ linhas } = await montarHoje());
      expect(linhas[0].progresso).toEqual({ tipo: "binario", concluidas: 1, meta: 3 });
    });

    it("quantificado mostra a interação de hoje contra a meta de uma unidade", async () => {
      const habito = await criar(
        "💧 Água",
        config({ meta: { tipo: "quantificado", valor: 2000, unidade: "ml" } }),
      );

      await criarRegistroNoBanco({ habitoId: habito.id, valor: 250, origem: "app" });
      await criarRegistroNoBanco({ habitoId: habito.id, valor: 400, origem: "app" });

      const { linhas } = await montarHoje();

      expect(linhas[0].progresso).toEqual({
        tipo: "quantificado",
        acumulado: 650,
        meta: 2000,
        unidade: "ml",
      });
      /* 650 de 2000: a marca continua aberta. */
      expect(linhas[0].concluida).toBe(false);
    });

    it("quantificado fecha ao alcançar a meta", async () => {
      const habito = await criar(
        "💧 Água",
        config({ meta: { tipo: "quantificado", valor: 500, unidade: "ml" } }),
      );

      await criarRegistroNoBanco({ habitoId: habito.id, valor: 500, origem: "app" });

      const { linhas } = await montarHoje();
      expect(linhas[0].concluida).toBe(true);
    });

    it("duração conta segundos e aceita o cronômetro como origem", async () => {
      const habito = await criar("🤸 Alongar", config({ meta: { tipo: "duracao", segundos: 90 } }));

      await criarRegistroNoBanco({ habitoId: habito.id, valor: 45, origem: "cronometro" });

      const { linhas } = await montarHoje();
      expect(linhas[0].progresso).toEqual({ tipo: "duracao", acumulado: 45, meta: 90 });
      expect(linhas[0].concluida).toBe(false);

      const linha = await db("registro").first("origem");
      expect(linha?.origem).toBe("cronometro");
    });

    it("negativo nasce cumprido e conta recaídas do período", async () => {
      const habito = await criar(
        "🥤 Sem refrigerante",
        config({ meta: { tipo: "negativo", tolerancia: 1 } }),
      );

      let { linhas } = await montarHoje();
      expect(linhas[0].progresso).toEqual({ tipo: "negativo", recaidas: 0, tolerancia: 1 });
      expect(linhas[0].concluida).toBe(true);

      await criarRegistroNoBanco({ habitoId: habito.id, origem: "app" });
      ({ linhas } = await montarHoje());
      expect(linhas[0].concluida).toBe(true);

      await criarRegistroNoBanco({ habitoId: habito.id, origem: "app" });
      ({ linhas } = await montarHoje());
      expect(linhas[0].progresso).toMatchObject({ recaidas: 2 });
      /* Passou da tolerância: a marca cai. */
      expect(linhas[0].concluida).toBe(false);
    });
  });

  describe("ultimoRegistro", () => {
    it("é null quando nada foi marcado hoje", async () => {
      await criar("💧 Água", config());
      const { linhas } = await montarHoje();
      expect(linhas[0].ultimoRegistro).toBeNull();
    });

    it("carrega o id e o valor do último, que é o que o desfazer precisa", async () => {
      const habito = await criar(
        "💧 Água",
        config({ meta: { tipo: "quantificado", valor: 2000, unidade: "ml" } }),
      );

      await criarRegistroNoBanco({ habitoId: habito.id, valor: 250, origem: "app" });
      const segundo = await criarRegistroNoBanco({
        habitoId: habito.id,
        valor: 400,
        origem: "app",
      });

      const { linhas } = await montarHoje();

      expect(segundo.ok).toBe(true);
      expect(linhas[0].ultimoRegistro).toEqual({
        id: segundo.ok ? segundo.dados.id : "",
        valor: 400,
      });
    });

    it("no modo fixo é por ocorrência, não por hábito", async () => {
      const habito = await criar("💊 Dose", fixa(["08:00:00", "20:00:00"]));
      const { linhas } = await montarHoje();

      await criarRegistroNoBanco({
        habitoId: habito.id,
        ocorrenciaId: linhas[0].ocorrenciaId,
        origem: "app",
      });

      const depois = await montarHoje();

      expect(depois.linhas[0].ultimoRegistro).not.toBeNull();
      expect(depois.linhas[0].concluida).toBe(true);
      /* A da noite não foi marcada: desfazer ali não pode apagar a da manhã. */
      expect(depois.linhas[1].ultimoRegistro).toBeNull();
      expect(depois.linhas[1].concluida).toBe(false);
    });
  });
});

// ─── A virada das 04:00 ──────────────────────────────────────────────────────

describe("virada das 04:00", () => {
  it("marcação à 01:30 pertence ao dia anterior", async () => {
    /*
     * A armadilha nº 1 do projeto. Se `data_logica` saísse da data de parede, o
     * registro cairia no dia errado e o período de ontem ficaria aberto para
     * sempre no cálculo.
     */
    congelarRelogio("2026-11-14T01:30:00-03:00");

    const habito = await criar("💧 Água", config());
    const resultado = await criarRegistroNoBanco({ habitoId: habito.id, origem: "app" });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.dados.dataLogica).toBe("2026-11-13");
    expect(await hojeLogico()).toBe("2026-11-13");
  });

  it("marcação às 04:30 já é o dia novo", async () => {
    congelarRelogio("2026-11-14T04:30:00-03:00");

    const habito = await criar("💧 Água", config());
    const resultado = await criarRegistroNoBanco({ habitoId: habito.id, origem: "app" });

    expect(resultado.ok && resultado.dados.dataLogica).toBe("2026-11-14");
  });

  it("`criado_em` e `data_logica` divergem num registro de madrugada", async () => {
    congelarRelogio("2026-11-14T02:00:00-03:00");

    const habito = await criar("💧 Água", config());
    await criarRegistroNoBanco({ habitoId: habito.id, origem: "app" });

    const linha = await db("registro").first("data_logica", "criado_em");

    expect(linha?.data_logica).toBe("2026-11-13");
    expect(linha?.criado_em.toISOString().slice(0, 10)).toBe("2026-11-14");
  });
});

// ─── Marcar e desmarcar ──────────────────────────────────────────────────────

describe("criar registro", () => {
  it("devolve os efeitos vindos da simulação", async () => {
    const habito = await criar("💧 Água", config());

    const resultado = await criarRegistroNoBanco({ habitoId: habito.id, origem: "app" });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.dados.efeitos.periodoStatus).toBe("cumprido");
    expect(resultado.dados.efeitos.sequencia.atual).toBe(1);
    expect(resultado.dados.valor).toBe(1);
  });

  it("sem valor vale 1 — a regra do contrato", async () => {
    const habito = await criar("🏃 Correr", config());
    await criarRegistroNoBanco({ habitoId: habito.id, origem: "app" });

    const linha = await db("registro").first("valor");
    expect(Number(linha?.valor)).toBe(1);
  });

  it("recusa hábito inexistente, arquivado e pausado — com motivo", async () => {
    const arquivado = await criar("📚 Ler", config());
    await arquivarHabitoNoBanco(arquivado.id, true);

    const pausado = await criar("🧘 Meditar", config());
    const hoje = await hojeLogico();
    await pausarHabitoNoBanco(pausado.id, { de: comoDataLogica(hoje), ate: null });

    const ausente = await criarRegistroNoBanco({
      habitoId: "5eed0001-0000-4000-8000-00000000ffff",
      origem: "app",
    });
    expect(ausente.ok || ausente.falha.tipo).toBe("habito_inexistente");

    const noArquivado = await criarRegistroNoBanco({ habitoId: arquivado.id, origem: "app" });
    expect(noArquivado.ok || noArquivado.falha.tipo).toBe("habito_arquivado");

    const noPausado = await criarRegistroNoBanco({ habitoId: pausado.id, origem: "app" });
    expect(noPausado.ok || noPausado.falha.tipo).toBe("habito_pausado");
  });

  it("recusa data futura e data fora da janela de 7 dias", async () => {
    const habito = await criar("💧 Água", config());
    const hoje = await hojeLogico();

    const futuro = await criarRegistroNoBanco({
      habitoId: habito.id,
      dataLogica: somarDias(hoje, 1),
      origem: "retroativo",
    });
    expect(futuro.ok || futuro.falha.tipo).toBe("fora_da_janela");

    const antigo = await criarRegistroNoBanco({
      habitoId: habito.id,
      dataLogica: somarDias(hoje, -7),
      origem: "retroativo",
    });
    expect(antigo.ok || antigo.falha.tipo).toBe("fora_da_janela");
  });

  it("recusa ocorrência que não é do período", async () => {
    const a = await criar("💊 Dose A", fixa(["08:00:00"]));
    const b = await criar("💊 Dose B", fixa(["08:00:00"]));

    const { linhas } = await montarHoje();
    const deB = linhas.find((l) => l.habitoId === b.id);

    const resultado = await criarRegistroNoBanco({
      habitoId: a.id,
      ocorrenciaId: deB?.ocorrenciaId,
      origem: "app",
    });

    expect(resultado.ok || resultado.falha.tipo).toBe("ocorrencia_invalida");
  });

  it("o id do registro sobrevive à materialização", async () => {
    /*
     * A materialização apaga e recria os períodos, e os registros voltam com os
     * mesmos ids. Se não voltassem, o `ultimoRegistro.id` que a tela acabou de
     * receber apontaria para nada e o desfazer daria 404.
     */
    const habito = await criar("💧 Água", config());
    const criado = await criarRegistroNoBanco({ habitoId: habito.id, origem: "app" });

    expect(criado.ok).toBe(true);
    if (!criado.ok) return;

    const { linhas } = await montarHoje();
    expect(linhas[0].ultimoRegistro?.id).toBe(criado.dados.id);
    expect(await db("registro").where({ id: criado.dados.id }).first("id")).toBeDefined();
  });
});

describe("apagar registro", () => {
  it("desfazer devolve o estado exatamente ao que era", async () => {
    const habito = await criar("💧 Água", config());

    const antes = await montarHoje();

    const criado = await criarRegistroNoBanco({ habitoId: habito.id, origem: "app" });
    expect(criado.ok).toBe(true);
    if (!criado.ok) return;

    const removido = await apagarRegistroNoBanco(criado.dados.id);
    expect(removido.ok).toBe(true);

    const depois = await montarHoje();

    /* `periodoId` muda (a materialização recria), o resto tem de voltar igual. */
    expect(depois.linhas[0]).toMatchObject({
      progresso: antes.linhas[0].progresso,
      concluida: antes.linhas[0].concluida,
      sequencia: antes.linhas[0].sequencia,
      congelamentos: antes.linhas[0].congelamentos,
      ultimoRegistro: null,
    });
  });

  it("devolve os efeitos recalculados, não um ok", async () => {
    const habito = await criar("💧 Água", config());
    const criado = await criarRegistroNoBanco({ habitoId: habito.id, origem: "app" });
    if (!criado.ok) throw new Error("não criou");

    expect(criado.dados.efeitos.sequencia.atual).toBe(1);

    const removido = await apagarRegistroNoBanco(criado.dados.id);
    if (!removido.ok) throw new Error("não removeu");

    expect(removido.dados.efeitos.sequencia.atual).toBe(0);
    expect(removido.dados.efeitos.periodoStatus).toBe("aberto");
    /* O valor volta no payload: o dashboard precisa dele para subtrair. */
    expect(removido.dados.valor).toBe(1);
  });

  it("registro inexistente é recusa, não erro", async () => {
    const resultado = await apagarRegistroNoBanco("5eed0004-0000-4000-8000-00000000ffff");
    expect(resultado.ok || resultado.falha.tipo).toBe("registro_inexistente");
  });

  it("apagar não leva os outros registros do período com ele", async () => {
    /*
     * A materialização apaga os períodos em cascata, e os registros voltam
     * reinseridos. Um erro ali apagaria o histórico inteiro do hábito num
     * desfazer — por isso o teste conta o que sobrou.
     */
    const habito = await criar(
      "💧 Água",
      config({ meta: { tipo: "quantificado", valor: 2000, unidade: "ml" } }),
    );

    const um = await criarRegistroNoBanco({ habitoId: habito.id, valor: 250, origem: "app" });
    await criarRegistroNoBanco({ habitoId: habito.id, valor: 400, origem: "app" });
    await criarRegistroNoBanco({ habitoId: habito.id, valor: 100, origem: "app" });

    if (!um.ok) throw new Error("não criou");
    await apagarRegistroNoBanco(um.dados.id);

    const restantes = await db("registro").select("valor");
    expect(restantes.map((r) => Number(r.valor)).sort((a, b) => a - b)).toEqual([100, 400]);

    const { linhas } = await montarHoje();
    expect(linhas[0].progresso).toMatchObject({ acumulado: 500 });
  });
});

// ─── cada_n_dias ─────────────────────────────────────────────────────────────

describe("cada_n_dias", () => {
  it("`novoVencimento` só vem na cadência ancorada", async () => {
    const ancorado = await criar(
      "📚 Ler",
      config({ cadencia: { tipo: "cada_n_dias", intervalo: 3 } }),
    );
    const diario = await criar("💧 Água", config());

    const comAncora = await criarRegistroNoBanco({ habitoId: ancorado.id, origem: "app" });
    const semAncora = await criarRegistroNoBanco({ habitoId: diario.id, origem: "app" });

    if (!comAncora.ok || !semAncora.ok) throw new Error("não criou");

    expect(comAncora.dados.efeitos.novoVencimento).not.toBeNull();
    /*
     * Na cadência do calendário o vencimento não se move, e mandar a data faria a
     * tela pedir confirmação de uma mudança que não houve.
     */
    expect(semAncora.dados.efeitos.novoVencimento).toBeNull();
  });
});

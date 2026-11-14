/**
 * Preenchimento retroativo contra o Postgres de verdade (etapa 3.4).
 *
 * Três riscos concentrados aqui, e os três são silenciosos:
 *
 * 1. **A prévia mentir.** Ela existe para o usuário confirmar o que vai
 *    acontecer num `cada_n_dias`; se o número que ela mostra não for o que a
 *    confirmação produz, a tela pede autorização para uma coisa e faz outra. Os
 *    testes comparam prévia e confirmação campo a campo, e conferem que a prévia
 *    não deixou registro no banco.
 * 2. **O estorno de congelamento.** Ele não é escrito em lugar nenhum: é a
 *    diferença entre o consumo de duas materializações. Um erro aqui devolve
 *    congelamento que não existe, ou engole o que deveria voltar.
 * 3. **Os bloqueios.** Dia antes do início, dia em pausa e dia sem momento
 *    devido têm de chegar à tela **com motivo**. Sem motivo, o dia some ou vira
 *    "não cumprido", que diz que o dia foi perdido quando ele nunca foi cobrado.
 */

import { retroativo as schemaRetroativo, retroativoAplicado as schemaAplicado } from "@/contracts";
import type { ConfigHabito, CriarHabito, DiaRetroativo } from "@/contracts";
import { criarHabito as schemaCriar, exigirValido } from "@/contracts";
import { db } from "@/db/knex";
import { comoDataLogica, diaDaSemana, somarDias } from "@/dominio/calendario";
import { encerrarBanco, limpar, semearConfig } from "./apoio-de-teste";
import { arquivarHabitoNoBanco, criarHabitoNoBanco, pausarHabitoNoBanco } from "./habitos";
import { materializar } from "./materializar";
import { criarRegistroNoBanco } from "./registros";
import { hojeLogico } from "./relogio";
import { aplicarRetroativo, montarRetroativo } from "./retroativo";

beforeEach(async () => {
  await limpar(db);
  await semearConfig();
});

afterAll(encerrarBanco);

// ─── Utilidades ──────────────────────────────────────────────────────────────

function flexivel(sobre: Partial<Extract<ConfigHabito, { modo: "flexivel" }>> = {}): ConfigHabito {
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

function fixaDiaria(horarios: string[]): ConfigHabito {
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
 * Faz o hábito ter começado há `dias` dias, e **re-materializa**.
 *
 * O replay é o que cria os períodos do passado: sem ele o hábito continuaria com
 * o único período nascido na criação, e a janela de 7 dias mostraria os dias
 * anteriores como `nao_previsto` — bloqueados por falta de período, não por
 * regra. O teste estaria medindo o esquecimento do setup.
 */
async function envelhecer(habitoId: string, dias: number): Promise<void> {
  const antes = somarDias(await hoje(), -dias);

  await db("habito").where({ id: habitoId }).update({ inicio_em: antes });
  await db("habito_config").where({ habito_id: habitoId }).update("vigente_de", antes);
  await db.transaction((trx) => materializar(trx, habitoId));
}

async function hoje() {
  return comoDataLogica(await hojeLogico());
}

/** Um hábito que já existe há 6 dias — a janela inteira é preenchível. */
async function comHistorico(c: ConfigHabito = flexivel()) {
  const habito = await criar("🏃 Correr", c);
  await envelhecer(habito.id, 6);
  return habito.id;
}

async function janela(habitoId: string): Promise<DiaRetroativo[]> {
  const r = await montarRetroativo(habitoId);
  if (!r.ok) throw new Error(`retroativo falhou: ${r.falha.tipo}`);
  return r.dados.dias;
}

function diaDe(dias: DiaRetroativo[], data: string): DiaRetroativo {
  const achado = dias.find((d) => d.dataLogica === data);
  if (achado === undefined) throw new Error(`dia fora da janela: ${data}`);
  return achado;
}

async function aplicar(
  habitoId: string,
  dataLogica: string,
  sobre: { valor?: number; previa?: boolean } = {},
) {
  const r = await aplicarRetroativo(habitoId, {
    dataLogica,
    previa: sobre.previa ?? false,
    ...(sobre.valor === undefined ? {} : { valor: sobre.valor }),
  });

  if (!r.ok) throw new Error(`aplicar falhou: ${r.falha.tipo}`);
  return r.dados;
}

async function registrosDe(habitoId: string): Promise<number> {
  const [{ total }] = await db("registro")
    .join("habito_periodo", "habito_periodo.id", "registro.periodo_id")
    .where("habito_periodo.habito_id", habitoId)
    .count({ total: "*" });

  return Number(total);
}

// ─── A janela ────────────────────────────────────────────────────────────────

describe("montarRetroativo", () => {
  it("bate com o contrato: 7 dias, do mais recente para o mais antigo", async () => {
    const id = await comHistorico();
    const r = await montarRetroativo(id);

    if (!r.ok) throw new Error(r.falha.tipo);
    exigirValido(schemaRetroativo, r.dados, "retroativo");

    const hojeLogico = await hoje();
    expect(r.dados.dias).toHaveLength(7);
    expect(r.dados.dias[0].dataLogica).toBe(hojeLogico);
    expect(r.dados.dias[0].hoje).toBe(true);
    expect(r.dados.dias[6].dataLogica).toBe(somarDias(hojeLogico, -6));
    expect(r.dados.dias.filter((d) => d.hoje)).toHaveLength(1);
  });

  it("o dia da semana acompanha a data, não a posição na lista", async () => {
    const id = await comHistorico();
    const dias = await janela(id);

    for (const dia of dias) {
      expect(dia.diaDaSemana).toBe(diaDaSemana(comoDataLogica(dia.dataLogica)));
    }
  });

  it("hábito inexistente é recusa, não exceção", async () => {
    const r = await montarRetroativo("00000000-0000-4000-8000-000000000000");

    expect(r).toMatchObject({ ok: false, falha: { tipo: "habito_inexistente" } });
  });
});

describe("bloqueios vêm com motivo", () => {
  it("antes do início do hábito", async () => {
    /* Criado hoje: os seis dias anteriores são anteriores ao hábito. */
    const habito = await criar("🏃 Correr", flexivel());
    const dias = await janela(habito.id);

    expect(diaDe(dias, await hoje()).estado).not.toBe("bloqueado");

    for (const dia of dias.slice(1)) {
      expect(dia).toMatchObject({ estado: "bloqueado", motivoBloqueio: "antes_do_inicio" });
    }
  });

  it("dentro de uma pausa", async () => {
    const id = await comHistorico();
    const inicio = somarDias(await hoje(), -4);
    const fim = somarDias(await hoje(), -3);

    await pausarHabitoNoBanco(id, { de: inicio, ate: fim });

    const dias = await janela(id);

    expect(diaDe(dias, inicio)).toMatchObject({
      estado: "bloqueado",
      motivoBloqueio: "em_pausa",
    });
    expect(diaDe(dias, fim).motivoBloqueio).toBe("em_pausa");
    expect(diaDe(dias, somarDias(await hoje(), -5)).estado).not.toBe("bloqueado");
  });

  it("dia que não é dia do hábito, no modo fixo", async () => {
    /*
     * Semanal fixo marcado só no dia da semana de hoje: os outros seis dias da
     * janela não têm momento devido. Sem o motivo `nao_previsto` eles chegariam
     * como `nao_cumprido`, dizendo que o dia foi perdido quando ele nunca foi
     * cobrado — foi o buraco que esta tela encontrou no contrato.
     */
    const hojeLogico = await hoje();
    const habito = await criar("🏃 Correr", {
      modo: "fixo",
      cadencia: { tipo: "semanal", diasSemana: [diaDaSemana(hojeLogico)] },
      meta: { tipo: "binario" },
      congelamento: null,
    });
    await envelhecer(habito.id, 6);

    const dias = await janela(habito.id);

    expect(diaDe(dias, hojeLogico).estado).not.toBe("bloqueado");
    for (const dia of dias.slice(1)) {
      expect(dia).toMatchObject({ estado: "bloqueado", motivoBloqueio: "nao_previsto" });
    }
  });

  it("`fora_da_janela` não aparece na lista — a lista é a janela", async () => {
    const dias = await janela(await comHistorico());

    expect(dias.map((d) => d.motivoBloqueio)).not.toContain("fora_da_janela");
  });
});

// ─── Marcar e desmarcar ──────────────────────────────────────────────────────

describe("preencher um dia", () => {
  it("o dia vira cumprido e carrega o que desfazer", async () => {
    const id = await comHistorico();
    const ontem = somarDias(await hoje(), -1);

    const aplicado = await aplicar(id, ontem);

    exigirValido(schemaAplicado, aplicado, "retroativo aplicado");
    expect(aplicado.persistido).toBe(true);

    const dia = diaDe(aplicado.dias, ontem);
    expect(dia.estado).toBe("cumprido");
    expect(dia.registroIds).toHaveLength(1);
    expect(aplicado.efeitos.sequencia.atual).toBe(1);
  });

  it("o registro nasce com `origem: retroativo` e a data de parede de hoje", async () => {
    const id = await comHistorico();
    const ontem = somarDias(await hoje(), -1);

    await aplicar(id, ontem);

    const registro = await db("registro")
      .join("habito_periodo", "habito_periodo.id", "registro.periodo_id")
      .where("habito_periodo.habito_id", id)
      .first("registro.origem", "registro.data_logica", "registro.criado_em");

    /*
     * `data_logica` é o dia corrigido e `criado_em` é agora: as duas divergem de
     * propósito, e é exatamente o caso para o qual as duas colunas existem.
     */
    expect(registro).toMatchObject({ origem: "retroativo", data_logica: ontem });
    expect(registro?.criado_em.toISOString().slice(0, 10)).not.toBe(ontem);
  });

  it("desmarcar devolve o dia ao estado anterior", async () => {
    const id = await comHistorico();
    const ontem = somarDias(await hoje(), -1);

    const antes = diaDe(await janela(id), ontem);
    const aplicado = await aplicar(id, ontem);

    const { apagarRegistroNoBanco } = await import("./registros");
    for (const registroId of diaDe(aplicado.dias, ontem).registroIds) {
      await apagarRegistroNoBanco(registroId);
    }

    expect(diaDe(await janela(id), ontem)).toEqual(antes);
  });

  it("no modo fixo preenche todos os momentos do dia que faltavam", async () => {
    const id = (await criar("💊 Dose", fixaDiaria(["08:00:00", "20:00:00"]))).id;
    await envelhecer(id, 6);
    const ontem = somarDias(await hoje(), -1);

    const aplicado = await aplicar(id, ontem);

    /* O dia é a unidade da tela; cumprir o dia é cumprir as duas doses. */
    expect(diaDe(aplicado.dias, ontem)).toMatchObject({
      estado: "cumprido",
      registroIds: expect.arrayContaining([expect.any(String), expect.any(String)]),
    });
    expect(diaDe(aplicado.dias, ontem).registroIds).toHaveLength(2);
  });

  it("preencher o que já está cumprido é recusa, não duplicata", async () => {
    const id = await comHistorico();
    const ontem = somarDias(await hoje(), -1);
    await aplicar(id, ontem);

    const r = await aplicarRetroativo(id, { dataLogica: ontem, previa: false });

    expect(r).toMatchObject({ ok: false, falha: { tipo: "dia_ja_cumprido" } });
    expect(await registrosDe(id)).toBe(1);
  });

  it("num hábito somável o dia a meio aceita mais, e mostra o acumulado", async () => {
    const id = await comHistorico(
      flexivel({ meta: { tipo: "quantificado", valor: 2000, unidade: "ml" } }),
    );
    const ontem = somarDias(await hoje(), -1);

    const parcial = await aplicar(id, ontem, { valor: 250 });
    expect(diaDe(parcial.dias, ontem)).toMatchObject({ estado: "nao_cumprido", valor: 250 });

    const completo = await aplicar(id, ontem, { valor: 1750 });
    expect(diaDe(completo.dias, ontem)).toMatchObject({ estado: "cumprido", valor: 2000 });
  });

  it("no hábito negativo o dia limpo é o cumprido, e a recaída é um evento só", async () => {
    const habito = await criar("🥤 Sem refrigerante", {
      modo: "fixo",
      cadencia: { tipo: "diario", horarios: ["08:00:00", "20:00:00"] },
      meta: { tipo: "negativo", tolerancia: 2 },
      congelamento: null,
    });
    const id = habito.id;
    await envelhecer(id, 6);

    const ontem = somarDias(await hoje(), -1);
    expect(diaDe(await janela(id), ontem).estado).toBe("cumprido");

    const aplicado = await aplicar(id, ontem);

    const dia = diaDe(aplicado.dias, ontem);
    expect(dia.estado).toBe("nao_cumprido");
    /* Um dia de duas doses em que houve escorregada teve **uma** escorregada. */
    expect(dia.registroIds).toHaveLength(1);
    /* `valor` é nulo: o `1` do registro é convenção de armazenamento. */
    expect(dia.valor).toBeNull();
  });
});

// ─── Recusas ─────────────────────────────────────────────────────────────────

describe("recusas têm motivo", () => {
  it("fora da janela de 7 dias", async () => {
    const habito = await criar("🏃 Correr", flexivel());
    await envelhecer(habito.id, 20);

    const r = await aplicarRetroativo(habito.id, {
      dataLogica: somarDias(await hoje(), -7),
      previa: false,
    });

    expect(r).toMatchObject({ ok: false, falha: { tipo: "fora_da_janela", dias: 7 } });
  });

  it("dia futuro", async () => {
    const id = await comHistorico();

    const r = await aplicarRetroativo(id, {
      dataLogica: somarDias(await hoje(), 1),
      previa: false,
    });

    expect(r).toMatchObject({ ok: false, falha: { tipo: "fora_da_janela" } });
  });

  it("dia dentro de uma pausa", async () => {
    const id = await comHistorico();
    const dia = somarDias(await hoje(), -3);
    await pausarHabitoNoBanco(id, { de: dia, ate: dia });

    const r = await aplicarRetroativo(id, { dataLogica: dia, previa: false });

    expect(r).toMatchObject({ ok: false, falha: { tipo: "habito_pausado" } });
  });

  it("hábito arquivado", async () => {
    const id = await comHistorico();
    await arquivarHabitoNoBanco(id, true);

    const r = await aplicarRetroativo(id, {
      dataLogica: somarDias(await hoje(), -1),
      previa: false,
    });

    expect(r).toMatchObject({ ok: false, falha: { tipo: "habito_arquivado" } });
  });
});

// ─── A prévia ────────────────────────────────────────────────────────────────

describe("prévia", () => {
  it("não deixa registro no banco", async () => {
    const id = await comHistorico();
    const ontem = somarDias(await hoje(), -1);

    const previa = await aplicar(id, ontem, { previa: true });

    expect(previa.persistido).toBe(false);
    expect(await registrosDe(id)).toBe(0);
    /* E a janela real continua como estava, apesar do que a prévia mostrou. */
    expect(diaDe(await janela(id), ontem).estado).toBe("nao_cumprido");
  });

  it("mostra o dia como ficaria — não é a janela de agora", async () => {
    const id = await comHistorico();
    const ontem = somarDias(await hoje(), -1);

    const previa = await aplicar(id, ontem, { previa: true });

    expect(diaDe(previa.dias, ontem).estado).toBe("cumprido");
    expect(previa.efeitos.sequencia.atual).toBe(1);
  });

  it("é idêntica à confirmação, que é o motivo de ela ser a mesma escrita", async () => {
    const id = await comHistorico();
    const ontem = somarDias(await hoje(), -1);

    const previa = await aplicar(id, ontem, { previa: true });
    const confirmado = await aplicar(id, ontem);

    expect(confirmado.efeitos).toEqual(previa.efeitos);
    /*
     * Os `registroIds` são os únicos campos que podem divergir: a prévia mostra
     * os ids que a transação desfeita criou. O resto do dia tem de bater.
     */
    expect(semIds(confirmado.dias)).toEqual(semIds(previa.dias));
  });
});

function semIds(dias: DiaRetroativo[]) {
  return dias.map(({ registroIds, ...resto }) => ({ ...resto, registros: registroIds.length }));
}

// ─── Os dois efeitos que a tela precisa anunciar ─────────────────────────────

describe("cada_n_dias re-encadeia, e o vencimento é anunciado antes", () => {
  const ancorado = () =>
    flexivel({ cadencia: { tipo: "cada_n_dias", intervalo: 3 }, metaOcorrencias: 1 });

  it("a prévia promete o vencimento que a confirmação entrega", async () => {
    const id = await comHistorico(ancorado());
    const alvo = somarDias(await hoje(), -5);

    const previa = await aplicar(id, alvo, { previa: true });
    expect(previa.efeitos.novoVencimento).not.toBeNull();

    const confirmado = await aplicar(id, alvo);
    expect(confirmado.efeitos.novoVencimento).toBe(previa.efeitos.novoVencimento);

    /*
     * E o que está no banco depois do commit é o que foi prometido: a cadeia
     * inteira foi refeita a partir da conclusão em `alvo`, não remendada.
     */
    const aberto = await db("habito_periodo")
      .where({ habito_id: id, status: "aberto" })
      .first("fim");

    expect(aberto?.fim).toBe(confirmado.efeitos.novoVencimento);
  });

  it("nas outras cadências não há vencimento a mover", async () => {
    const id = await comHistorico();

    const aplicado = await aplicar(id, somarDias(await hoje(), -1));

    /* Mandar a data ali faria a tela pedir confirmação de uma mudança que não houve. */
    expect(aplicado.efeitos.novoVencimento).toBeNull();
  });
});

describe("estorno de congelamento", () => {
  /**
   * O cenário inteiro, montado por marcações reais.
   *
   * Seis dias de história, um congelamento ganho a cada dois dias cumpridos, e um
   * buraco em d-2 que o fechamento resgata consumindo um congelamento. Preencher
   * o buraco faz o replay **não** consumir — e é só comparando o consumo de antes
   * com o de depois que se sabe que ele voltou. Não há coluna dizendo isso.
   */
  async function comBuraco() {
    const id = await comHistorico(flexivel({ congelamento: { aCada: 2, max: 3 } }));
    const hojeLogico = await hoje();

    for (const atras of [6, 5, 4, 3, 1]) {
      await criarRegistroNoBanco({
        habitoId: id,
        dataLogica: somarDias(hojeLogico, -atras),
        origem: "retroativo",
      });
    }

    return { id, buraco: somarDias(hojeLogico, -2) };
  }

  it("o dia resgatado some com o consumo, e o congelamento volta ao estoque", async () => {
    const { id, buraco } = await comBuraco();

    const antes = await montarRetroativo(id);
    if (!antes.ok) throw new Error(antes.falha.tipo);

    expect(diaDe(antes.dados.dias, buraco).estado).toBe("congelado");
    const [{ gastos }] = await db("congelamento")
      .where({ habito_id: id, status: "consumido" })
      .count({ gastos: "*" });
    expect(Number(gastos)).toBe(1);

    const aplicado = await aplicar(id, buraco);

    expect(aplicado.efeitos.congelamentoEstornado).toBe(true);
    expect(aplicado.efeitos.congelamentosDisponiveis).toBeGreaterThan(
      antes.dados.congelamentosDisponiveis,
    );
    expect(diaDe(aplicado.dias, buraco).estado).toBe("cumprido");
  });

  it("preencher um dia que não resgatava nada não inventa estorno", async () => {
    const id = await comHistorico(flexivel({ congelamento: { aCada: 2, max: 3 } }));

    const aplicado = await aplicar(id, somarDias(await hoje(), -1));

    expect(aplicado.efeitos.congelamentoEstornado).toBe(false);
  });

  it("a sequência é recalculada, não incrementada", async () => {
    const { id, buraco } = await comBuraco();

    const aplicado = await aplicar(id, buraco);

    /*
     * Seis dias cumpridos em sequência: o número sai do replay inteiro, e é por
     * isso que ele fecha o buraco em vez de somar 1 ao que havia.
     */
    expect(aplicado.efeitos.sequencia.atual).toBe(6);
  });
});

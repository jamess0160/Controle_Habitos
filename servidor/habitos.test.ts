/**
 * Hábitos contra o Postgres de verdade (etapa 3.2).
 *
 * O foco é o versionamento de `habito_config` e a materialização, porque são as
 * duas coisas que erram em silêncio: uma versão a mais ou a menos não quebra
 * nada visível **hoje** — quebra a avaliação de um período que já fechou, e isso
 * só aparece quando a sequência muda sozinha.
 */

import * as z from "zod";
import { criarHabito as schemaCriar, habito as schemaHabito, exigirValido } from "@/contracts";
import { habitoAgua, habitoCorrer } from "@/contracts/fixtures";
import type { ConfigHabito, CriarHabito } from "@/contracts";
import { db } from "@/db/knex";
import { comoDataLogica, somarDias } from "@/dominio/calendario";
import { encerrarBanco, limpar, semearConfig } from "./apoio-de-teste";
import {
  arquivarHabitoNoBanco,
  buscarHabito,
  criarHabitoNoBanco,
  editarHabitoNoBanco,
  listarHabitos,
  pausarHabitoNoBanco,
  reordenarHabitosNoBanco,
  retomarHabitoNoBanco,
} from "./habitos";
import { hojeLogico } from "./relogio";

beforeEach(async () => {
  await limpar(db);
  await semearConfig();
});

afterAll(encerrarBanco);

// ─── Utilidades ──────────────────────────────────────────────────────────────

function novo(sobre: Partial<CriarHabito> = {}): CriarHabito {
  return exigirValido(
    schemaCriar,
    { nome: habitoAgua.nome, cor: habitoAgua.cor, config: habitoAgua.config, ...sobre },
    "entrada de teste",
  );
}

/**
 * Configurações montadas aqui, e não espalhadas a partir das fixtures.
 *
 * `{...habitoAgua.config, metaOcorrencias: 2}` não compila: `ConfigHabito` é
 * união discriminada em `modo`, e espalhar uma união não a estreita — o
 * resultado pode ter `metaOcorrencias` com `modo: "fixo"`, que é justamente a
 * combinação que o contrato existe para proibir. Escrever a variante inteira é o
 * preço da exclusividade estrutural, e é um preço pequeno.
 */
function diaria(
  sobre: { notificarEm?: string | null; meta?: ConfigHabito["meta"] } = {},
): ConfigHabito {
  return {
    modo: "flexivel",
    cadencia: { tipo: "diario" },
    /*
     * Fixo em 1, e não um parâmetro: na cadência diária o período é um dia, a
     * unidade do modo flexível é o dia, e o contrato recusa qualquer valor
     * acima — ver `Docs/fixes/01`. Estes testes usavam `metaOcorrencias: 2 | 3`
     * só como "outra versão de config"; quem precisa disso varia `notificarEm`,
     * que não muda a avaliação de período nenhum.
     */
    metaOcorrencias: 1,
    notificarEm: sobre.notificarEm ?? null,
    meta: sobre.meta ?? { tipo: "binario" },
    congelamento: null,
  };
}

/** Modo fixo com horário todos os dias: garante slot devido hoje, qualquer dia que seja. */
function fixaDiaria(): ConfigHabito {
  return {
    modo: "fixo",
    cadencia: { tipo: "diario", horarios: ["08:00:00", "20:00:00"] },
    meta: { tipo: "binario" },
    congelamento: null,
  };
}

/**
 * Finge que o hábito existe desde N dias atrás.
 *
 * Recuar `inicio_em` e `vigente_de` é a única forma de exercitar o
 * versionamento: ele depende de a versão vigente ter nascido **antes** de hoje, e
 * um teste não pode esperar um dia. Mexe só nas duas colunas de data e deixa a
 * materialização refazer o resto.
 */
async function envelhecer(habitoId: string, dias: number): Promise<void> {
  const hoje = await hojeLogico();
  const antes = somarDias(hoje, -dias);

  await db("habito").where({ id: habitoId }).update({ inicio_em: antes });
  await db("habito_config").where({ habito_id: habitoId }).update("vigente_de", antes);
}

async function versoes(habitoId: string) {
  return db("habito_config").where({ habito_id: habitoId }).orderBy("versao", "asc");
}

// ─── Criação ─────────────────────────────────────────────────────────────────

describe("criar hábito", () => {
  it("nasce com a versão 1, começando hoje, e bate com o contrato", async () => {
    const habito = await criarHabitoNoBanco(novo());

    exigirValido(schemaHabito, habito, "hábito criado");

    const hoje = await hojeLogico();
    expect(habito.inicioEm).toBe(hoje);
    expect(habito.ordem).toBe(1);
    expect(await versoes(habito.id)).toEqual([
      expect.objectContaining({ versao: 1, vigente_de: hoje, vigente_ate: null }),
    ]);
  });

  it("nasce materializado, com o período aberto já no banco", async () => {
    /*
     * Sem isto o hábito existiria sem histórico até a próxima escrita, e o
     * dashboard não teria o que mostrar no dia da criação.
     */
    const habito = await criarHabitoNoBanco(novo());

    const periodos = await db("habito_periodo").where({ habito_id: habito.id });
    expect(periodos).toHaveLength(1);
    expect(periodos[0]).toMatchObject({ status: "aberto", meta_ocorrencias: 1 });
    expect(await db("habito_streak").where({ habito_id: habito.id })).toHaveLength(1);
  });

  it("o tipo da linha vem da meta, e é o que trava a FK composta", async () => {
    const habito = await criarHabitoNoBanco(novo({ config: habitoCorrer.config }));

    const linha = await db("habito").where({ id: habito.id }).first("tipo");
    expect(linha?.tipo).toBe(habitoCorrer.config.meta.tipo);
  });

  it("o resumo é a mesma frase do contrato, não uma segunda implementação", async () => {
    const habito = await criarHabitoNoBanco(novo({ config: habitoAgua.config }));
    expect(habito.resumo).toBe(habitoAgua.resumo);
  });

  it("o modo fixo materializa ocorrências; o flexível não", async () => {
    /*
     * Cadência **diária** com horários, e não a fixture semanal: um hábito fixo
     * semanal criado num dia que não está em `diasSemana` não tem momento devido
     * na primeira janela, e a simulação então não gera período nenhum — por
     * decisão própria, documentada nela. O teste não quer exercitar esse recorte.
     */
    const fixo = await criarHabitoNoBanco(novo({ nome: "💊 Dose", config: fixaDiaria() }));
    const flexivel = await criarHabitoNoBanco(novo({ nome: "💧 Água" }));

    const doFixo = await db("habito_ocorrencia")
      .join("habito_periodo", "habito_periodo.id", "habito_ocorrencia.periodo_id")
      .where("habito_periodo.habito_id", fixo.id);
    const doFlexivel = await db("habito_ocorrencia")
      .join("habito_periodo", "habito_periodo.id", "habito_ocorrencia.periodo_id")
      .where("habito_periodo.habito_id", flexivel.id);

    expect(doFixo.length).toBeGreaterThan(0);
    expect(doFlexivel).toHaveLength(0);
  });

  it("a ordem vai para o fim da lista", async () => {
    const a = await criarHabitoNoBanco(novo({ nome: "A 1" }));
    const b = await criarHabitoNoBanco(novo({ nome: "B 2" }));
    const c = await criarHabitoNoBanco(novo({ nome: "C 3" }));

    expect([a.ordem, b.ordem, c.ordem]).toEqual([1, 2, 3]);
  });

  it("a configuração inválida é recusada pelo contrato, antes do banco", () => {
    /* Modo fixo com `cada_n_dias`: o CHECK do banco recusaria, o schema recusa primeiro. */
    const resultado = schemaCriar.safeParse({
      nome: "📚 Ler",
      cor: "roxo",
      config: {
        modo: "fixo",
        cadencia: { tipo: "cada_n_dias", intervalo: 3 },
        meta: { tipo: "binario" },
        congelamento: null,
      },
    });

    expect(resultado.success).toBe(false);
  });
});

// ─── Versionamento ───────────────────────────────────────────────────────────

describe("versionamento de habito_config", () => {
  it("nome e cor mudam na linha e não criam versão", async () => {
    const habito = await criarHabitoNoBanco(novo());
    await envelhecer(habito.id, 5);

    const editado = await editarHabitoNoBanco(habito.id, { nome: "💧 Filtrada", cor: "azul" });

    expect(editado).toMatchObject({ nome: "💧 Filtrada", cor: "azul" });
    expect(await versoes(habito.id)).toHaveLength(1);
  });

  it("editar a configuração abre a versão 2 e fecha a anterior em ontem", async () => {
    const habito = await criarHabitoNoBanco(novo());
    await envelhecer(habito.id, 5);

    const hoje = await hojeLogico();

    await editarHabitoNoBanco(habito.id, {
      config: diaria({ meta: { tipo: "quantificado", valor: 3000, unidade: "ml" } }),
    });

    expect(await versoes(habito.id)).toEqual([
      expect.objectContaining({
        versao: 1,
        vigente_de: somarDias(hoje, -5),
        vigente_ate: somarDias(hoje, -1),
        meta_valor: 2000,
      }),
      expect.objectContaining({ versao: 2, vigente_de: hoje, vigente_ate: null, meta_valor: 3000 }),
    ]);
  });

  it("as faixas de vigência não se sobrepõem — é o que `configVigenteEm` assume", async () => {
    const habito = await criarHabitoNoBanco(novo({ config: diaria() }));
    await envelhecer(habito.id, 10);
    await editarHabitoNoBanco(habito.id, { config: diaria({ notificarEm: "20:00:00" }) });

    const lista = await versoes(habito.id);
    for (let i = 0; i + 1 < lista.length; i += 1) {
      expect(lista[i].vigente_ate).not.toBeNull();
      expect(lista[i].vigente_ate! < lista[i + 1].vigente_de).toBe(true);
    }
  });

  it("editar no mesmo dia da criação atualiza no lugar, sem versão nova", async () => {
    /*
     * Uma versão criada hoje não governou período fechado nenhum. Fechá-la em
     * ontem produziria `vigente_ate < vigente_de` e o CHECK recusaria; abrir a
     * nova na mesma data produziria faixas sobrepostas. E uma tarde ajustando a
     * meta deixaria uma dúzia de versões sem nenhum período para explicá-las.
     */
    const habito = await criarHabitoNoBanco(novo({ config: diaria() }));

    await editarHabitoNoBanco(habito.id, { config: diaria({ notificarEm: "20:00:00" }) });
    await editarHabitoNoBanco(habito.id, { config: diaria({ notificarEm: "21:30:00" }) });

    expect(await versoes(habito.id)).toEqual([
      expect.objectContaining({ versao: 1, vigente_ate: null, notificar_em: "21:30:00" }),
    ]);
  });

  it("o período passado continua avaliado pela regra que valia nele", async () => {
    /*
     * A armadilha nº 2 do projeto. O hábito acumula uma semana sob a versão 1 e
     * então a meta muda. Os períodos já fechados têm de continuar apontando para
     * a **versão que os governou** — reavaliá-los pela régua nova transformaria
     * uma semana cumprida em uma semana falhada, e a sequência mudaria sozinha.
     *
     * O sinal é o `config_id`, e não `meta_ocorrencias`: numa cadência diária a
     * meta de ocorrências é sempre 1 (a unidade do flexível é o dia — ver
     * `Docs/fixes/01`), então ela não distingue versão nenhuma. O que varia aqui
     * é a meta do tipo, que é a mesma "régua nova" com outro nome.
     */
    const habito = await criarHabitoNoBanco(
      novo({ config: diaria({ meta: { tipo: "quantificado", valor: 2_000, unidade: "ml" } }) }),
    );
    await envelhecer(habito.id, 7);

    /* Materializa o histórico antigo antes de mexer na regra. */
    await editarHabitoNoBanco(habito.id, { nome: "🏃 Correr" });

    const [v1] = await versoes(habito.id);

    const fechadosAntes = await db("habito_periodo")
      .where({ habito_id: habito.id })
      .whereNot({ status: "aberto" })
      .orderBy("inicio", "asc")
      .select("inicio", "config_id", "meta_ocorrencias", "status");

    expect(fechadosAntes.length).toBeGreaterThan(0);
    expect(fechadosAntes.every((p) => p.config_id === v1.id)).toBe(true);

    await editarHabitoNoBanco(habito.id, {
      config: diaria({ meta: { tipo: "quantificado", valor: 3_000, unidade: "ml" } }),
    });

    const fechadosDepois = await db("habito_periodo")
      .where({ habito_id: habito.id })
      .whereNot({ status: "aberto" })
      .orderBy("inicio", "asc")
      .select("inicio", "config_id", "meta_ocorrencias", "status");

    expect(fechadosDepois).toEqual(fechadosAntes);

    /*
     * E a regra nova governa de hoje em diante. Numa cadência diária o período
     * aberto **começa** hoje, então ele já nasce sob a versão nova; numa cadência
     * semanal o período corrente teria começado sob a regra antiga e a manteria
     * até fechar, que é o comportamento certo e o motivo de a asserção ser sobre
     * a cadência diária.
     */
    const versoesDepois = await versoes(habito.id);
    const v2 = versoesDepois.at(-1)!;
    expect(v2.versao).toBe(2);
    expect(v2.meta_valor).toBe(3_000);

    const aberto = await db("habito_periodo")
      .where({ habito_id: habito.id, status: "aberto" })
      .first("config_id");

    expect(aberto?.config_id).toBe(v2.id);
  });

  it("o tipo é imutável: o schema de edição só aceita meta do tipo gravado", async () => {
    const habito = await criarHabitoNoBanco(novo({ config: habitoAgua.config }));

    const { editarHabito } = await import("@/contracts");
    const resultado = editarHabito(habito.config.meta.tipo).safeParse({
      config: diaria({ meta: { tipo: "duracao", segundos: 1_200 } }),
    });

    expect(resultado.success).toBe(false);
  });

  it("trocar o tipo é recusado com erro legível, não com violação de FK", async () => {
    /*
     * A FK composta `(habito_id, tipo)` recusaria de todo jeito, mas como 500.
     * A rota nem chega aqui — o schema `editarHabito(tipo)` barra antes; isto
     * protege quem chamar o repositório direto.
     */
    const habito = await criarHabitoNoBanco(novo({ config: diaria() }));

    await expect(
      editarHabitoNoBanco(habito.id, {
        config: diaria({ meta: { tipo: "duracao", segundos: 1_200 } }),
      }),
    ).rejects.toThrow(/imutável/);
  });

  it("editar hábito inexistente devolve null, não explode", async () => {
    expect(await editarHabitoNoBanco(z.uuid().parse(habitoAgua.id), { nome: "x" })).toBeNull();
  });
});

// ─── Ordem ───────────────────────────────────────────────────────────────────

describe("reordenar", () => {
  async function tres() {
    return [
      await criarHabitoNoBanco(novo({ nome: "A 1" })),
      await criarHabitoNoBanco(novo({ nome: "B 2" })),
      await criarHabitoNoBanco(novo({ nome: "C 3" })),
    ];
  }

  it("a lista completa define a ordem", async () => {
    const [a, b, c] = await tres();

    const lista = await reordenarHabitosNoBanco([c.id, a.id, b.id]);

    expect(lista.habitos.map((h) => h.nome)).toEqual(["C 3", "A 1", "B 2"]);
    expect(lista.habitos.map((h) => h.ordem)).toEqual([1, 2, 3]);
  });

  it("é idempotente: repetir não embaralha", async () => {
    const [a, b, c] = await tres();
    const ordem = [b.id, c.id, a.id];

    const uma = await reordenarHabitosNoBanco(ordem);
    const outra = await reordenarHabitosNoBanco(ordem);

    expect(outra.habitos.map((h) => h.id)).toEqual(uma.habitos.map((h) => h.id));
  });

  it("id ausente do pedido fica depois dos enviados, em vez de desaparecer", async () => {
    /* Um hábito criado em outra aba não pode cair fora da ordenação. */
    const [a, b, c] = await tres();

    const lista = await reordenarHabitosNoBanco([c.id, a.id]);

    expect(lista.habitos.slice(0, 2).map((h) => h.id)).toEqual([c.id, a.id]);
    expect(lista.habitos[2].id).toBe(b.id);
  });

  it("id desconhecido é ignorado, e não derruba o arraste", async () => {
    const [a, b] = await tres();

    const lista = await reordenarHabitosNoBanco([habitoAgua.id, b.id, a.id]);

    expect(lista.habitos.slice(0, 2).map((h) => h.id)).toEqual([b.id, a.id]);
  });

  it("arquivado não entra na ordem dos ativos", async () => {
    const [a, b, c] = await tres();
    await arquivarHabitoNoBanco(b.id, true);

    const lista = await reordenarHabitosNoBanco([c.id, a.id]);

    expect(lista.habitos.map((h) => h.ordem)).toEqual([1, 2]);
    expect(lista.arquivados.map((h) => h.id)).toEqual([b.id]);
  });
});

// ─── Pausa ───────────────────────────────────────────────────────────────────

describe("pausa", () => {
  it("suspende sem punição: nenhum período é gerado no intervalo", async () => {
    /*
     * Cadência diária de propósito: numa semanal a pausa poderia cair toda dentro
     * de uma janela sem conter nenhum **início** de janela, e a contagem de
     * períodos não mudaria — o teste passaria a medir o calendário em vez da
     * pausa.
     */
    const habito = await criarHabitoNoBanco(novo({ config: diaria() }));
    await envelhecer(habito.id, 20);
    await editarHabitoNoBanco(habito.id, { nome: "🏃 Correr" });

    const antes = await db("habito_periodo").where({ habito_id: habito.id }).count({ c: "*" });

    const hoje = await hojeLogico();
    const pausado = await pausarHabitoNoBanco(habito.id, {
      de: comoDataLogica(somarDias(hoje, -10)),
      ate: comoDataLogica(somarDias(hoje, -3)),
    });

    const depois = await db("habito_periodo").where({ habito_id: habito.id }).count({ c: "*" });

    /* Oito dias pausados: oito janelas diárias deixaram de existir. */
    expect(Number(antes[0].c) - Number(depois[0].c)).toBe(8);

    const dentro = await db("habito_periodo")
      .where({ habito_id: habito.id })
      .where("inicio", ">=", somarDias(hoje, -10))
      .where("inicio", "<=", somarDias(hoje, -3));

    expect(dentro).toHaveLength(0);
    expect(pausado?.sequencia.atual).toBe(0);
  });

  it("pausa aberta para a simulação ali: não há período depois dela", async () => {
    const habito = await criarHabitoNoBanco(novo({ config: diaria() }));
    await envelhecer(habito.id, 20);

    const hoje = await hojeLogico();
    const de = somarDias(hoje, -5);

    const pausado = await pausarHabitoNoBanco(habito.id, { de: comoDataLogica(de), ate: null });

    expect(pausado?.pausa).toEqual({ de, ate: null });

    const depois = await db("habito_periodo")
      .where({ habito_id: habito.id })
      .where("inicio", ">=", de);

    expect(depois).toHaveLength(0);
  });

  it("retomar limpa a pausa e volta a gerar período", async () => {
    const habito = await criarHabitoNoBanco(novo({ config: diaria() }));
    await envelhecer(habito.id, 20);

    const hoje = await hojeLogico();
    await pausarHabitoNoBanco(habito.id, { de: comoDataLogica(somarDias(hoje, -5)), ate: null });

    const retomado = await retomarHabitoNoBanco(habito.id);

    expect(retomado?.pausa).toBeNull();
    expect(
      await db("habito_periodo").where({ habito_id: habito.id, status: "aberto" }).first("id"),
    ).toBeDefined();
  });

  it("pausar hábito inexistente devolve null", async () => {
    const hoje = await hojeLogico();
    expect(
      await pausarHabitoNoBanco(habitoAgua.id, { de: comoDataLogica(hoje), ate: null }),
    ).toBeNull();
  });
});

// ─── Arquivo ─────────────────────────────────────────────────────────────────

describe("arquivar", () => {
  it("sai dos ativos, mantém histórico e sequência", async () => {
    const habito = await criarHabitoNoBanco(novo({ config: diaria() }));
    await envelhecer(habito.id, 10);
    await editarHabitoNoBanco(habito.id, { nome: "🏃 Correr" });

    const periodosAntes = await db("habito_periodo").where({ habito_id: habito.id }).count({ c: "*" });

    const arquivado = await arquivarHabitoNoBanco(habito.id, true);

    expect(arquivado?.arquivadoEm).not.toBeNull();

    const lista = await listarHabitos();
    expect(lista.habitos).toHaveLength(0);
    expect(lista.arquivados.map((h) => h.id)).toEqual([habito.id]);

    const periodosDepois = await db("habito_periodo").where({ habito_id: habito.id }).count({ c: "*" });
    expect(periodosDepois).toEqual(periodosAntes);
  });

  it("desarquivar devolve ao fim da ordem", async () => {
    const a = await criarHabitoNoBanco(novo({ nome: "A 1" }));
    await arquivarHabitoNoBanco(a.id, true);
    const b = await criarHabitoNoBanco(novo({ nome: "B 2" }));
    const c = await criarHabitoNoBanco(novo({ nome: "C 3" }));

    const voltou = await arquivarHabitoNoBanco(a.id, false);

    expect(voltou?.ordem).toBeGreaterThan(Math.max(b.ordem, c.ordem));
    expect((await listarHabitos()).habitos.at(-1)?.id).toBe(a.id);
  });
});

// ─── Leitura ─────────────────────────────────────────────────────────────────

describe("leitura", () => {
  it("hábito inexistente é null, para a rota virar 404", async () => {
    expect(await buscarHabito(habitoAgua.id)).toBeNull();
  });

  it("a lista bate com o contrato nos dois grupos", async () => {
    const a = await criarHabitoNoBanco(novo({ nome: "A 1" }));
    await criarHabitoNoBanco(novo({ nome: "B 2", config: fixaDiaria() }));
    await arquivarHabitoNoBanco(a.id, true);

    const lista = await listarHabitos();

    for (const h of [...lista.habitos, ...lista.arquivados]) {
      exigirValido(schemaHabito, h, `hábito ${h.nome}`);
    }
  });
});

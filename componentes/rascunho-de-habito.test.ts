import { configHabito, exigirValido, type Habito } from "@/contracts";
import * as f from "@/contracts/fixtures";
import {
  HORARIO_PADRAO_DO_LEMBRETE,
  montarConfig,
  passoDoCampo,
  rascunhoDe,
} from "./rascunho-de-habito";

/**
 * O round-trip é o teste que importa.
 *
 * Abrir a edição de um hábito desmonta a configuração em campos de formulário, e
 * salvar remonta a união discriminada. Se a volta perder um campo, a edição
 * **apaga parte da configuração em silêncio** — o pior defeito possível aqui,
 * porque o formulário continuaria parecendo funcionar. Cada fixture é um caminho
 * diferente pelas uniões: flexível e fixo, as quatro cadências, os quatro tipos,
 * com e sem congelamento.
 */

const TODOS: Habito[] = [...f.listaDeHabitosFixture.habitos, ...f.listaDeHabitosFixture.arquivados];

describe("rascunho → config → rascunho não perde nada", () => {
  for (const habito of TODOS) {
    it(habito.nome, () => {
      const montado = montarConfig(rascunhoDe(habito));

      /* Primeiro passa no schema: o formulário manda isto para a rota. */
      const validado = exigirValido(configHabito, montado, `config de ${habito.nome}`);

      expect(validado).toEqual(habito.config);
    });
  }
});

describe("montagem de combinações que as fixtures não cobrem", () => {
  const base = rascunhoDe(null);

  it("modo fixo mensal sem horário não manda a chave `horarios`", () => {
    const config = montarConfig({
      ...base,
      modo: "fixo",
      cadencia: "mensal",
      diasMes: [1, 15],
      horarios: [],
    });

    expect(exigirValido(configHabito, config, "fixo mensal")).toEqual({
      modo: "fixo",
      cadencia: { tipo: "mensal", diasMes: [1, 15] },
      meta: { tipo: "binario" },
      congelamento: null,
    });
  });

  it("horário em branco é descartado em vez de virar `:00` solto", () => {
    const config = montarConfig({
      ...base,
      modo: "fixo",
      cadencia: "diario",
      horarios: ["08:00", "", "20:00"],
    });

    expect(exigirValido(configHabito, config, "fixo diário")).toMatchObject({
      cadencia: { tipo: "diario", horarios: ["08:00:00", "20:00:00"] },
    });
  });

  /*
   * O passo 4 esconde o campo na cadência diária, e esconder sem coagir deixaria
   * um valor digitado em outra cadência viajar para dentro do payload: o
   * contrato recusaria e o erro apontaria para um campo que não está mais na
   * tela. Ver `Docs/fixes/01`.
   */
  it("na cadência diária a meta de ocorrências é 1, seja o que o rascunho disser", () => {
    const config = montarConfig({
      ...base,
      modo: "flexivel",
      cadencia: "diario",
      metaOcorrencias: "3",
    });

    expect(exigirValido(configHabito, config, "flexível diário")).toMatchObject({
      modo: "flexivel",
      cadencia: { tipo: "diario" },
      metaOcorrencias: 1,
    });
  });

  it("nas outras cadências a meta de ocorrências é respeitada", () => {
    const config = montarConfig({
      ...base,
      modo: "flexivel",
      cadencia: "semanal",
      metaOcorrencias: "3",
    });

    expect(exigirValido(configHabito, config, "flexível semanal")).toMatchObject({
      cadencia: { tipo: "semanal" },
      metaOcorrencias: 3,
    });
  });

  it("a duração é somada das três partes do relógio", () => {
    const config = montarConfig({
      ...base,
      tipo: "duracao",
      duracao: { horas: "1", minutos: "", segundos: "30" },
    });

    expect(exigirValido(configHabito, config, "duração")).toMatchObject({
      meta: { tipo: "duracao", segundos: 3_630 },
    });
  });

  it("meta de 30 s existe — era o que o campo de minutos não deixava pedir", () => {
    const config = montarConfig({
      ...base,
      tipo: "duracao",
      duracao: { horas: "", minutos: "", segundos: "30" },
    });

    expect(exigirValido(configHabito, config, "30 s")).toMatchObject({
      meta: { tipo: "duracao", segundos: 30 },
    });
  });

  it("relógio inteiro em branco recusa, em vez de mandar uma meta de zero", () => {
    const config = montarConfig({ ...base, tipo: "duracao" });

    expect(configHabito.safeParse(config).success).toBe(false);
  });

  it("lembrete desativado manda `notificarEm: null`, mesmo com horário no rascunho", () => {
    const config = montarConfig({ ...base, lembreteAtivo: false, notificarEm: "07:30" });

    expect(exigirValido(configHabito, config, "sem lembrete")).toMatchObject({
      notificarEm: null,
    });
  });

  it("lembrete ativo manda o horário com os segundos que o contrato pede", () => {
    const config = montarConfig({ ...base, lembreteAtivo: true, notificarEm: "07:30" });

    expect(exigirValido(configHabito, config, "com lembrete")).toMatchObject({
      notificarEm: "07:30:00",
    });
  });

  /*
   * Ativo e em branco é erro, e não `null` silencioso: a pessoa pediu lembrete,
   * e salvar sem nenhum teria parecido que ela conseguiu.
   */
  it("lembrete ativo com horário em branco é recusado pelo schema", () => {
    const config = montarConfig({ ...base, lembreteAtivo: true, notificarEm: "" });

    expect(configHabito.safeParse(config).success).toBe(false);
  });

  it("campo numérico vazio vira NaN e o schema recusa, em vez de virar zero", () => {
    const config = montarConfig({ ...base, tipo: "quantificado", valor: "", unidade: "ml" });

    expect(configHabito.safeParse(config).success).toBe(false);
  });

  it("`cada_n_dias` só existe no flexível, e o rascunho não oferece outro caminho", () => {
    const config = montarConfig({ ...base, cadencia: "cada_n_dias", intervalo: "15" });

    expect(exigirValido(configHabito, config, "cada 15 dias")).toMatchObject({
      modo: "flexivel",
      cadencia: { tipo: "cada_n_dias", intervalo: 15 },
    });
  });
});

describe("o rascunho de um hábito salvo reabre com o lembrete do jeito que estava", () => {
  it("sem `notificarEm` o botão nasce desligado, com o horário padrão à espera", () => {
    const rascunho = rascunhoDe(f.habitoRefrigerante);

    expect(rascunho.lembreteAtivo).toBe(false);
    expect(rascunho.notificarEm).toBe(HORARIO_PADRAO_DO_LEMBRETE);
  });

  it("com `notificarEm` o botão nasce ligado, no horário salvo", () => {
    const rascunho = rascunhoDe(f.habitoAlongar);

    expect(rascunho.lembreteAtivo).toBe(true);
    expect(rascunho.notificarEm).toBe("19:00");
  });
});

describe("o erro de validação leva ao passo certo", () => {
  /* Os caminhos são os que `validar()` devolveu de verdade na rota. */
  const casos: Array<[string, number]> = [
    ["nome", 0],
    ["cor", 0],
    ["config.meta.valor", 1],
    ["config.meta.unidade", 1],
    ["config.meta.tolerancia", 1],
    ["config.cadencia.intervalo", 2],
    ["config.metaOcorrencias", 3],
    ["config.cadencia.diasSemana", 3],
    ["config.cadencia.horarios[1]", 3],
    ["config.notificarEm", 4],
    ["config.congelamento.max", 5],
  ];

  for (const [caminho, passo] of casos) {
    it(`${caminho} → passo ${passo + 1}`, () => {
      expect(passoDoCampo(caminho)).toBe(passo);
    });
  }
});

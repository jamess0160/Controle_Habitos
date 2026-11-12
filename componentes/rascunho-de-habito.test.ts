import { configHabito, exigirValido, type Habito } from "@/contracts";
import * as f from "@/contracts/fixtures";
import { montarConfig, passoDoCampo, rascunhoDe } from "./rascunho-de-habito";

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

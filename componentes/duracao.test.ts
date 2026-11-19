import { DURACAO_VAZIA, partesDeSegundos, segundosDePartes } from "./duracao";

/**
 * O relógio `h : min : s` do formulário, ida e volta.
 *
 * O que se protege aqui é a distinção entre **vazio e zero**. Ela não é
 * decorativa: com as três partes em branco o total tem de ser `NaN` para o
 * schema do contrato recusar e a tela mostrar a mensagem em pt-BR — se virasse
 * `0`, o payload seguiria para a rota e só o CHECK do Postgres o barraria, como
 * erro 500 em vez de campo destacado.
 */

describe("segundosDePartes", () => {
  it("soma as três partes", () => {
    expect(segundosDePartes({ horas: "1", minutos: "30", segundos: "30" })).toBe(5_430);
  });

  it("parte em branco entre partes preenchidas vale zero", () => {
    expect(segundosDePartes({ horas: "", minutos: "10", segundos: "" })).toBe(600);
    expect(segundosDePartes({ horas: "1", minutos: "", segundos: "" })).toBe(3_600);
  });

  it("aceita a meta curta que a escala de minutos não tinha como expressar", () => {
    expect(segundosDePartes({ horas: "", minutos: "", segundos: "30" })).toBe(30);
  });

  it("tudo em branco é NaN, e não zero — é o schema que explica o erro", () => {
    expect(segundosDePartes(DURACAO_VAZIA)).toBeNaN();
    expect(segundosDePartes({ horas: " ", minutos: "", segundos: " " })).toBeNaN();
  });

  it("parte que não é número também é NaN", () => {
    expect(segundosDePartes({ horas: "", minutos: "dez", segundos: "" })).toBeNaN();
  });
});

describe("partesDeSegundos", () => {
  it("é a volta de segundosDePartes", () => {
    for (const total of [30, 90, 600, 3_600, 5_430]) {
      expect(segundosDePartes(partesDeSegundos(total))).toBe(total);
    }
  });

  it("deixa em branco a parte que é zero, em vez de abrir `0 h 10 min 0 s`", () => {
    expect(partesDeSegundos(600)).toEqual({ horas: "", minutos: "10", segundos: "" });
    expect(partesDeSegundos(3_600)).toEqual({ horas: "1", minutos: "", segundos: "" });
  });

  it("zero e lixo não produzem campo que o round-trip leria como vazio", () => {
    expect(partesDeSegundos(0)).toEqual({ horas: "", minutos: "", segundos: "0" });
    expect(partesDeSegundos(NaN)).toEqual(DURACAO_VAZIA);
  });
});

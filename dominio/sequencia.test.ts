import { comoDataLogica } from "./calendario";
import { SEQUENCIA_INICIAL, aplicarFechamento } from "./sequencia";

const d = comoDataLogica;
const inicio = d("2026-11-09");

describe("aplicarFechamento", () => {
  it("cumprido soma interações e marca o começo da sequência", () => {
    const estado = aplicarFechamento(SEQUENCIA_INICIAL, {
      status: "cumprido",
      interacoes: 1,
      inicio,
    });

    expect(estado).toEqual({
      atual: 1,
      recorde: 1,
      totalNoPrazo: 1,
      desde: "2026-11-09",
    });
  });

  it("soma a quantidade de interações do modo fixo", () => {
    const estado = aplicarFechamento(SEQUENCIA_INICIAL, {
      status: "cumprido",
      interacoes: 2,
      inicio,
    });

    expect(estado.atual).toBe(2);
    expect(estado.totalNoPrazo).toBe(2);
  });

  it("preserva o início da sequência nos períodos seguintes", () => {
    const primeiro = aplicarFechamento(SEQUENCIA_INICIAL, {
      status: "cumprido",
      interacoes: 1,
      inicio,
    });
    const segundo = aplicarFechamento(primeiro, {
      status: "cumprido",
      interacoes: 1,
      inicio: d("2026-11-10"),
    });

    expect(segundo.desde).toBe("2026-11-09");
    expect(segundo.atual).toBe(2);
  });

  it("congelado preserva a sequência sem somar", () => {
    const antes = { atual: 5, recorde: 7, totalNoPrazo: 20, desde: inicio };
    const depois = aplicarFechamento(antes, {
      status: "congelado",
      interacoes: 1,
      inicio: d("2026-11-10"),
    });

    expect(depois).toEqual(antes);
  });

  it("falhou zera a sequência atual e preserva recorde e total", () => {
    const antes = { atual: 5, recorde: 7, totalNoPrazo: 20, desde: inicio };
    const depois = aplicarFechamento(antes, {
      status: "falhou",
      interacoes: 1,
      inicio: d("2026-11-10"),
    });

    expect(depois).toEqual({ atual: 0, recorde: 7, totalNoPrazo: 20, desde: null });
  });

  it("recorde só sobe quando a sequência atual o supera", () => {
    const antes = { atual: 2, recorde: 7, totalNoPrazo: 20, desde: inicio };
    const depois = aplicarFechamento(antes, {
      status: "cumprido",
      interacoes: 1,
      inicio: d("2026-11-10"),
    });

    expect(depois.recorde).toBe(7);
    expect(depois.atual).toBe(3);
  });
});

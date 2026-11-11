import { comoDataLogica } from "./calendario";
import { type Meta, type RegistroDoDominio, avaliarPeriodo, unidadeCumprida } from "./meta";

const d = comoDataLogica;
const reg = (valor = 1, data = "2026-11-09"): RegistroDoDominio => ({
  dataLogica: d(data),
  valor,
});

const binario: Meta = { tipo: "binario" };
const agua: Meta = { tipo: "quantificado", valor: 2 };
const meditar: Meta = { tipo: "duracao", minutos: 10 };
const naoFumar: Meta = { tipo: "negativo", tolerancia: 0 };

describe("unidadeCumprida", () => {
  it("binário basta um registro", () => {
    expect(unidadeCumprida(binario, [])).toBe(false);
    expect(unidadeCumprida(binario, [reg()])).toBe(true);
  });

  it("quantificado soma os registros até a meta", () => {
    expect(unidadeCumprida(agua, [reg(0.5), reg(1)])).toBe(false);
    expect(unidadeCumprida(agua, [reg(0.5), reg(1), reg(0.5)])).toBe(true);
    expect(unidadeCumprida(agua, [reg(3)])).toBe(true);
  });

  it("duração soma minutos", () => {
    expect(unidadeCumprida(meditar, [reg(4), reg(5)])).toBe(false);
    expect(unidadeCumprida(meditar, [reg(4), reg(6)])).toBe(true);
  });

  it("recusa avaliar hábito negativo por unidade", () => {
    expect(() => unidadeCumprida(naoFumar, [])).toThrow(/negativo/);
  });
});

describe("avaliarPeriodo no modo flexível", () => {
  const flexivel3 = { tipo: "flexivel" as const, metaOcorrencias: 3 };

  it("cumpre quando alcança a meta de ocorrências", () => {
    const unidades = [[reg()], [reg()], [reg()]];
    expect(avaliarPeriodo(binario, flexivel3, unidades)).toEqual({
      cumprido: true,
      unidadesCumpridas: 3,
      unidadesTotais: 3,
      interacoes: 1,
    });
  });

  it("não cumpre com unidades insuficientes", () => {
    const resultado = avaliarPeriodo(binario, flexivel3, [[reg()], [reg()]]);
    expect(resultado.cumprido).toBe(false);
    expect(resultado.unidadesCumpridas).toBe(2);
  });

  it("conta só as unidades que bateram a meta individual", () => {
    // Três dias com registro, mas só dois alcançaram os 2 L.
    const unidades = [[reg(2)], [reg(0.5)], [reg(2)]];
    const resultado = avaliarPeriodo(agua, flexivel3, unidades);
    expect(resultado.unidadesCumpridas).toBe(2);
    expect(resultado.cumprido).toBe(false);
  });

  it("vale uma interação para a sequência, não a quantidade de unidades", () => {
    const resultado = avaliarPeriodo(binario, flexivel3, [[reg()], [reg()], [reg()]]);
    expect(resultado.interacoes).toBe(1);
  });
});

describe("avaliarPeriodo no modo fixo", () => {
  const fixo = { tipo: "fixo" as const };

  it("só cumpre quando nenhum slot fica para trás", () => {
    expect(avaliarPeriodo(binario, fixo, [[reg()], [reg()]])).toEqual({
      cumprido: true,
      unidadesCumpridas: 2,
      unidadesTotais: 2,
      interacoes: 2,
    });
  });

  it("slot perdido derruba o período mas preserva a contagem de interações", () => {
    const resultado = avaliarPeriodo(binario, fixo, [[reg()], []]);
    expect(resultado.cumprido).toBe(false);
    expect(resultado.unidadesCumpridas).toBe(1);
    expect(resultado.interacoes).toBe(1);
  });

  it("cada slot cumprido vale uma interação", () => {
    const resultado = avaliarPeriodo(binario, fixo, [[reg()], [reg()], [reg()]]);
    expect(resultado.interacoes).toBe(3);
  });

  it("período sem slot nenhum não conta como cumprido", () => {
    expect(avaliarPeriodo(binario, fixo, []).cumprido).toBe(false);
  });
});

describe("avaliarPeriodo em hábito negativo", () => {
  const flexivel1 = { tipo: "flexivel" as const, metaOcorrencias: 1 };

  it("nasce cumprido: ausência de registro é sucesso", () => {
    expect(avaliarPeriodo(naoFumar, flexivel1, [[]])).toEqual({
      cumprido: true,
      unidadesCumpridas: 1,
      unidadesTotais: 1,
      interacoes: 1,
    });
  });

  it("uma recaída com tolerância zero derruba o período", () => {
    expect(avaliarPeriodo(naoFumar, flexivel1, [[reg()]]).cumprido).toBe(false);
  });

  it("respeita a tolerância configurada", () => {
    const comTolerancia: Meta = { tipo: "negativo", tolerancia: 2 };
    expect(avaliarPeriodo(comTolerancia, flexivel1, [[reg(), reg()]]).cumprido).toBe(true);
    expect(avaliarPeriodo(comTolerancia, flexivel1, [[reg(), reg(), reg()]]).cumprido).toBe(
      false,
    );
  });

  it("soma recaídas de todos os dias do período", () => {
    const unidades = [[reg(1, "2026-11-09")], [reg(1, "2026-11-10")]];
    expect(avaliarPeriodo(naoFumar, flexivel1, unidades).cumprido).toBe(false);
  });
});

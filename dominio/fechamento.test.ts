import { decidirFechamento } from "./fechamento";

describe("decidirFechamento", () => {
  it("cumprido ignora o estoque de congelamento", () => {
    expect(
      decidirFechamento({
        cumprido: true,
        congelamentoAtivo: true,
        congelamentosDisponiveis: 0,
      }),
    ).toBe("cumprido");
  });

  it("consome congelamento automaticamente antes de falhar", () => {
    expect(
      decidirFechamento({
        cumprido: false,
        congelamentoAtivo: true,
        congelamentosDisponiveis: 1,
      }),
    ).toBe("congelado");
  });

  it("falha quando o estoque acabou", () => {
    expect(
      decidirFechamento({
        cumprido: false,
        congelamentoAtivo: true,
        congelamentosDisponiveis: 0,
      }),
    ).toBe("falhou");
  });

  it("falha quando o congelamento está desativado, mesmo com estoque", () => {
    expect(
      decidirFechamento({
        cumprido: false,
        congelamentoAtivo: false,
        congelamentosDisponiveis: 3,
      }),
    ).toBe("falhou");
  });
});

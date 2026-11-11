import {
  comoDataLogica,
  diaDaSemana,
  diasDaJanela,
  diferencaEmDias,
  estaNaJanela,
  fimDoMes,
  inicioDaSemana,
  inicioDoMes,
  somarDias,
} from "./calendario";

const d = comoDataLogica;

describe("comoDataLogica", () => {
  it("aceita data válida", () => {
    expect(d("2026-11-09")).toBe("2026-11-09");
  });

  it("rejeita formato inválido", () => {
    expect(() => d("09/11/2026")).toThrow(/esperado YYYY-MM-DD/);
    expect(() => d("2026-11-9")).toThrow(/esperado YYYY-MM-DD/);
  });

  it("rejeita data inexistente no calendário", () => {
    expect(() => d("2026-02-30")).toThrow(/inexistente/);
    expect(() => d("2026-13-01")).toThrow(/inexistente/);
  });

  it("aceita 29 de fevereiro em ano bissexto e rejeita fora dele", () => {
    expect(d("2024-02-29")).toBe("2024-02-29");
    expect(() => d("2026-02-29")).toThrow(/inexistente/);
  });
});

describe("somarDias", () => {
  it("soma e subtrai dentro do mês", () => {
    expect(somarDias(d("2026-11-09"), 1)).toBe("2026-11-10");
    expect(somarDias(d("2026-11-09"), -1)).toBe("2026-11-08");
  });

  it("atravessa a virada do mês e do ano", () => {
    expect(somarDias(d("2026-11-30"), 1)).toBe("2026-12-01");
    expect(somarDias(d("2026-12-31"), 1)).toBe("2027-01-01");
    expect(somarDias(d("2027-01-01"), -1)).toBe("2026-12-31");
  });

  it("atravessa fevereiro respeitando ano bissexto", () => {
    expect(somarDias(d("2024-02-28"), 1)).toBe("2024-02-29");
    expect(somarDias(d("2026-02-28"), 1)).toBe("2026-03-01");
  });
});

describe("diferencaEmDias", () => {
  it("conta dias entre datas", () => {
    expect(diferencaEmDias(d("2026-11-01"), d("2026-11-09"))).toBe(8);
    expect(diferencaEmDias(d("2026-11-09"), d("2026-11-09"))).toBe(0);
    expect(diferencaEmDias(d("2026-11-09"), d("2026-11-01"))).toBe(-8);
  });
});

describe("diaDaSemana", () => {
  it("usa 1 = domingo … 7 = sábado", () => {
    expect(diaDaSemana(d("2026-11-08"))).toBe(1); // domingo
    expect(diaDaSemana(d("2026-11-09"))).toBe(2); // segunda
    expect(diaDaSemana(d("2026-11-07"))).toBe(7); // sábado
  });
});

describe("inicioDaSemana", () => {
  it("volta ao domingo da semana", () => {
    expect(inicioDaSemana(d("2026-11-09"))).toBe("2026-11-08");
    expect(inicioDaSemana(d("2026-11-14"))).toBe("2026-11-08");
  });

  it("é idempotente num domingo", () => {
    expect(inicioDaSemana(d("2026-11-08"))).toBe("2026-11-08");
  });
});

describe("inicioDoMes / fimDoMes", () => {
  it("delimita o mês", () => {
    expect(inicioDoMes(d("2026-11-09"))).toBe("2026-11-01");
    expect(fimDoMes(d("2026-11-09"))).toBe("2026-11-30");
  });

  it("acerta fevereiro em ano comum e bissexto", () => {
    expect(fimDoMes(d("2026-02-10"))).toBe("2026-02-28");
    expect(fimDoMes(d("2024-02-10"))).toBe("2024-02-29");
  });
});

describe("janela", () => {
  const janela = { inicio: d("2026-11-08"), fim: d("2026-11-14") };

  it("estaNaJanela inclui as bordas", () => {
    expect(estaNaJanela(d("2026-11-08"), janela)).toBe(true);
    expect(estaNaJanela(d("2026-11-14"), janela)).toBe(true);
    expect(estaNaJanela(d("2026-11-07"), janela)).toBe(false);
    expect(estaNaJanela(d("2026-11-15"), janela)).toBe(false);
  });

  it("diasDaJanela enumera início e fim inclusos", () => {
    expect(diasDaJanela(janela)).toHaveLength(7);
    expect(diasDaJanela({ inicio: d("2026-11-09"), fim: d("2026-11-09") })).toEqual([
      "2026-11-09",
    ]);
  });
});

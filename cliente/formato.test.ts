import {
  cronometroEmTexto,
  dataCurta,
  dataLonga,
  diaCurtoDe,
  diaDaSemanaCurto,
  fracaoDeProgresso,
  passoDe,
  restanteAte,
  textoDeProgresso,
} from "./formato";

/**
 * O que estes testes protegem é a armadilha nº 1 do projeto chegando na camada
 * de apresentação: `new Date("2026-11-10")` é meia-noite **UTC**, que em São
 * Paulo é 21:00 do dia 9. Formatar um dia lógico por esse caminho mostra a data
 * errada — e erra um dia inteiro, não um detalhe.
 *
 * `TZ=UTC` no ambiente do Jest não provaria nada; é justamente num fuso negativo
 * que o deslocamento aparece. Por isso os casos abaixo fixam o fuso do app.
 */

const fusoOriginal = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "America/Sao_Paulo";
});

afterAll(() => {
  process.env.TZ = fusoOriginal;
});

describe("dia lógico não desloca", () => {
  it("formata o dia que está escrito, não o anterior", () => {
    expect(dataLonga("2026-11-10")).toBe("Terça, 10 de novembro");
    expect(dataCurta("2026-11-10")).toBe("10/11");
    expect(diaCurtoDe("2026-11-10")).toBe("ter");
  });

  it("vale no primeiro dia do mês, onde o deslocamento mudaria o mês também", () => {
    expect(dataLonga("2026-11-01")).toBe("Domingo, 1 de novembro");
    expect(dataCurta("2026-11-01")).toBe("01/11");
  });

  it("vale no primeiro dia do ano, onde mudaria o ano", () => {
    expect(dataLonga("2027-01-01")).toBe("Sexta, 1 de janeiro");
  });

  it("atravessa 29 de fevereiro de ano bissexto", () => {
    expect(dataCurta("2028-02-29")).toBe("29/02");
    expect(diaCurtoDe("2028-02-29")).toBe("ter");
  });
});

describe("dia da semana segue o índice do contrato (1 = domingo)", () => {
  it("1 é domingo e 7 é sábado", () => {
    expect(diaDaSemanaCurto(1)).toBe("dom");
    expect(diaDaSemanaCurto(7)).toBe("sáb");
  });

  it("os dias de `diasSemana: [2, 4, 6]` são segunda, quarta e sexta", () => {
    expect([2, 4, 6].map(diaDaSemanaCurto)).toEqual(["seg", "qua", "sex"]);
  });
});

describe("progresso na forma própria de cada tipo", () => {
  it("quantificado nunca aparece sem unidade", () => {
    expect(
      textoDeProgresso({ tipo: "quantificado", acumulado: 1400, meta: 2000, unidade: "ml" }),
    ).toBe("1.400/2.000 ml");
  });

  it("negativo fala de recaída, não de progresso", () => {
    expect(textoDeProgresso({ tipo: "negativo", recaidas: 0, tolerancia: 2 })).toBe("sem recaída");
    expect(textoDeProgresso({ tipo: "negativo", recaidas: 1, tolerancia: 2 })).toBe(
      "1 de 2 recaídas",
    );
  });

  it("negativo não tem barra: ela subiria quanto pior o resultado", () => {
    expect(fracaoDeProgresso({ tipo: "negativo", recaidas: 1, tolerancia: 2 })).toBeNull();
  });

  it("duração conta minutos", () => {
    expect(textoDeProgresso({ tipo: "duracao", acumulado: 0, meta: 15 })).toBe("0/15 min");
    expect(fracaoDeProgresso({ tipo: "duracao", acumulado: 3, meta: 15 })).toBeCloseTo(0.2);
  });
});

describe("passo do incremento rápido", () => {
  it("dá um botão usável em cada ordem de grandeza", () => {
    expect(passoDe(2000)).toBe(300);
    expect(passoDe(100)).toBe(10);
    expect(passoDe(8)).toBe(1);
    expect(passoDe(3)).toBe(1);
  });

  it("nunca é zero, que travaria os botões de mais e menos", () => {
    for (const meta of [1, 2, 7, 11, 40, 999, 100_000]) {
      expect(passoDe(meta)).toBeGreaterThan(0);
    }
  });
});

describe("cronômetro e contagem de bloqueio", () => {
  it("mostra mm:ss antes de uma hora e h:mm:ss depois", () => {
    expect(cronometroEmTexto(0)).toBe("00:00");
    expect(cronometroEmTexto(65)).toBe("01:05");
    expect(cronometroEmTexto(3_605)).toBe("1:00:05");
  });

  it("não conta tempo negativo — é o que acontece antes de hidratar, com `agora = 0`", () => {
    expect(cronometroEmTexto(-30)).toBe("00:00");
    expect(restanteAte("2026-11-10T15:00:00.000-03:00", 0)).not.toBe("");
  });

  it("bloqueio já vencido devolve vazio, e é isso que libera o formulário", () => {
    const fim = "2026-11-10T15:00:00.000-03:00";
    expect(restanteAte(fim, new Date(fim).getTime() + 1_000)).toBe("");
  });

  it("conta o que falta em minutos e segundos", () => {
    const fim = "2026-11-10T15:00:00.000-03:00";
    expect(restanteAte(fim, new Date(fim).getTime() - 125_000)).toBe("2 min 05 s");
    expect(restanteAte(fim, new Date(fim).getTime() - 9_000)).toBe("9 s");
  });
});

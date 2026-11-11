import { comoDataLogica } from "./calendario";
import {
  type Cadencia,
  janelaAposRetomada,
  janelaSeguinte,
  primeiraJanela,
  slotsDaJanela,
} from "./periodo";

const d = comoDataLogica;

const diario: Cadencia = { tipo: "diario" };
const semanal: Cadencia = { tipo: "semanal" };
const mensal: Cadencia = { tipo: "mensal" };
const cada15: Cadencia = { tipo: "cada_n_dias", intervalo: 15 };

describe("primeiraJanela", () => {
  it("diária é um único dia", () => {
    expect(primeiraJanela(diario, d("2026-11-09"))).toEqual({
      inicio: "2026-11-09",
      fim: "2026-11-09",
    });
  });

  it("semanal começando num domingo cobre a semana inteira", () => {
    expect(primeiraJanela(semanal, d("2026-11-08"))).toEqual({
      inicio: "2026-11-08",
      fim: "2026-11-14",
    });
  });

  it("semanal começando no meio da semana é recortada no início do hábito", () => {
    // Segunda-feira: o período não pode começar no domingo anterior, quando o
    // hábito ainda não existia.
    expect(primeiraJanela(semanal, d("2026-11-09"))).toEqual({
      inicio: "2026-11-09",
      fim: "2026-11-14",
    });
  });

  it("mensal é recortada no início do hábito", () => {
    expect(primeiraJanela(mensal, d("2026-11-09"))).toEqual({
      inicio: "2026-11-09",
      fim: "2026-11-30",
    });
  });

  it("cada_n_dias conta N dias a partir do início", () => {
    expect(primeiraJanela(cada15, d("2026-11-01"))).toEqual({
      inicio: "2026-11-01",
      fim: "2026-11-15",
    });
  });
});

describe("janelaSeguinte", () => {
  it("diária avança um dia", () => {
    expect(janelaSeguinte(diario, d("2026-11-09"))).toEqual({
      inicio: "2026-11-10",
      fim: "2026-11-10",
    });
  });

  it("semanal avança para o domingo seguinte", () => {
    expect(janelaSeguinte(semanal, d("2026-11-07"))).toEqual({
      inicio: "2026-11-08",
      fim: "2026-11-14",
    });
  });

  it("mensal avança para o mês seguinte inteiro", () => {
    expect(janelaSeguinte(mensal, d("2026-11-30"))).toEqual({
      inicio: "2026-12-01",
      fim: "2026-12-31",
    });
  });

  it("cada_n_dias parte do fim efetivo, que é a data da conclusão", () => {
    // Janela era 01→15, mas a meta foi atingida no dia 3 e o período fechou ali.
    // O próximo vencimento é 15 dias depois da conclusão, não do início da janela.
    expect(janelaSeguinte(cada15, d("2026-11-03"))).toEqual({
      inicio: "2026-11-04",
      fim: "2026-11-18",
    });
  });

  it("cada_n_dias perdido encadeia a partir do fim original", () => {
    expect(janelaSeguinte(cada15, d("2026-11-15"))).toEqual({
      inicio: "2026-11-16",
      fim: "2026-11-30",
    });
  });
});

describe("janelaAposRetomada", () => {
  it("cada_n_dias recomeça a contagem na retomada", () => {
    // 20 dias de férias não podem produzir um vencimento já estourado.
    expect(janelaAposRetomada(cada15, d("2026-12-01"))).toEqual({
      inicio: "2026-12-01",
      fim: "2026-12-15",
    });
  });

  it("semanal retoma no dia, recortando a semana corrente", () => {
    expect(janelaAposRetomada(semanal, d("2026-11-09"))).toEqual({
      inicio: "2026-11-09",
      fim: "2026-11-14",
    });
  });
});

describe("slotsDaJanela", () => {
  const semana = { inicio: d("2026-11-08"), fim: d("2026-11-14") };

  it("gera um slot por horário no modo diário", () => {
    const slots = slotsDaJanela({ inicio: d("2026-11-09"), fim: d("2026-11-09") }, {
      horarios: ["08:00", "20:00"],
    });
    expect(slots).toEqual([
      { data: "2026-11-09", horario: "08:00" },
      { data: "2026-11-09", horario: "20:00" },
    ]);
  });

  it("filtra por dias da semana, com 1 = domingo", () => {
    // Segunda, quarta e sexta.
    const slots = slotsDaJanela(semana, { diasSemana: [2, 4, 6] });
    expect(slots.map((s) => s.data)).toEqual(["2026-11-09", "2026-11-11", "2026-11-13"]);
    expect(slots.every((s) => s.horario === null)).toBe(true);
  });

  it("combina dias da semana com horários", () => {
    const slots = slotsDaJanela(semana, { diasSemana: [2], horarios: ["07:00", "19:00"] });
    expect(slots).toEqual([
      { data: "2026-11-09", horario: "07:00" },
      { data: "2026-11-09", horario: "19:00" },
    ]);
  });

  it("ignora dia do mês que não existe na janela", () => {
    // Dia 31 não existe em fevereiro: não gera slot, e não escorrega para março.
    const fevereiro = { inicio: d("2026-02-01"), fim: d("2026-02-28") };
    expect(slotsDaJanela(fevereiro, { diasMes: [15, 31] })).toEqual([
      { data: "2026-02-15", horario: null },
    ]);
  });

  it("sem filtro, gera um slot por dia da janela", () => {
    expect(slotsDaJanela(semana, {})).toHaveLength(7);
  });
});

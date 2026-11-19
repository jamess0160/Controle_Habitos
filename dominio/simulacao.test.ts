import { comoDataLogica } from "./calendario";
import { dataLogicaDe } from "./dia-logico";
import {
  type EntradaSimulacao,
  type RegistroEntrada,
  type VersaoConfig,
  simular,
} from "./simulacao";

const d = comoDataLogica;

function config(ajustes: Partial<VersaoConfig> = {}): VersaoConfig {
  return {
    id: "v1",
    vigenteDe: d("2026-11-01"),
    vigenteAte: null,
    cadencia: { tipo: "diario" },
    modo: { tipo: "flexivel", metaOcorrencias: 1 },
    meta: { tipo: "binario" },
    congelamento: null,
    ...ajustes,
  };
}

function reg(data: string, valor = 1, horario?: string): RegistroEntrada {
  return { dataLogica: d(data), valor, horario };
}

function rodar(ajustes: Omit<Partial<EntradaSimulacao>, "hoje"> & { hoje: string }) {
  const { hoje, ...resto } = ajustes;
  return simular({
    inicioEm: d("2026-11-01"),
    configs: [config()],
    registros: [],
    hoje: d(hoje),
    ...resto,
  });
}

describe("cadência diária", () => {
  it("fecha os dias passados e deixa hoje aberto", () => {
    const resultado = rodar({
      registros: [reg("2026-11-01"), reg("2026-11-02"), reg("2026-11-04")],
      hoje: "2026-11-05",
    });

    expect(resultado.periodos.map((p) => [p.inicio, p.status])).toEqual([
      ["2026-11-01", "cumprido"],
      ["2026-11-02", "cumprido"],
      ["2026-11-03", "falhou"],
      ["2026-11-04", "cumprido"],
      ["2026-11-05", "aberto"],
    ]);
  });

  it("zera a sequência na falha e preserva o recorde", () => {
    const resultado = rodar({
      registros: [reg("2026-11-01"), reg("2026-11-02"), reg("2026-11-04")],
      hoje: "2026-11-05",
    });

    expect(resultado.sequencia).toEqual({
      atual: 1,
      recorde: 2,
      totalNoPrazo: 3,
      desde: "2026-11-04",
    });
  });

  it("marcar hoje já conta na sequência, sem esperar o dia fechar", () => {
    const resultado = rodar({ registros: [reg("2026-11-01")], hoje: "2026-11-01" });

    expect(resultado.periodos).toHaveLength(1);
    expect(resultado.periodos[0].status).toBe("cumprido");
    expect(resultado.sequencia.atual).toBe(1);
  });

  it("registro de madrugada cai no período do dia lógico anterior", () => {
    // 2026-11-03 01:30 em São Paulo pertence ao dia lógico 2026-11-02.
    const madrugada = dataLogicaDe(new Date("2026-11-03T04:30:00Z"));
    expect(madrugada).toBe("2026-11-02");

    const resultado = rodar({
      registros: [{ dataLogica: madrugada, valor: 1 }],
      hoje: "2026-11-03",
    });

    const doDia2 = resultado.periodos.find((p) => p.inicio === "2026-11-02");
    expect(doDia2?.status).toBe("cumprido");
  });
});

describe("cadência semanal flexível", () => {
  const semanal3 = config({
    cadencia: { tipo: "semanal" },
    modo: { tipo: "flexivel", metaOcorrencias: 3 },
  });

  it("cumpre a semana ao atingir a meta, em qualquer dia", () => {
    const resultado = rodar({
      inicioEm: d("2026-11-08"), // domingo
      configs: [semanal3],
      registros: [reg("2026-11-09"), reg("2026-11-11"), reg("2026-11-13")],
      hoje: "2026-11-14",
    });

    expect(resultado.periodos[0]).toMatchObject({
      inicio: "2026-11-08",
      fim: "2026-11-14",
      status: "cumprido",
      concluidas: 3,
      metaOcorrencias: 3,
      interacoes: 1,
    });
  });

  it("vale uma interação por período, não uma por dia", () => {
    const resultado = rodar({
      inicioEm: d("2026-11-08"),
      configs: [semanal3],
      registros: [reg("2026-11-09"), reg("2026-11-11"), reg("2026-11-13")],
      hoje: "2026-11-14",
    });

    expect(resultado.sequencia.atual).toBe(1);
  });

  it("meta não atingida derruba a semana quando ela termina", () => {
    const resultado = rodar({
      inicioEm: d("2026-11-08"),
      configs: [semanal3],
      registros: [reg("2026-11-09"), reg("2026-11-11")],
      hoje: "2026-11-16",
    });

    expect(resultado.periodos[0]).toMatchObject({ status: "falhou", concluidas: 2 });
    expect(resultado.sequencia.atual).toBe(0);
  });
});

describe("cadência cada_n_dias", () => {
  const cada15 = config({
    cadencia: { tipo: "cada_n_dias", intervalo: 15 },
    modo: { tipo: "flexivel", metaOcorrencias: 1 },
  });

  it("conclusão antecipada encurta o período e desloca o vencimento", () => {
    const resultado = rodar({
      configs: [cada15],
      registros: [reg("2026-11-03")],
      hoje: "2026-11-10",
    });

    // A janela era 01→15, mas a conclusão no dia 3 fechou o período ali, e o
    // próximo vencimento passou a ser 15 dias depois da conclusão.
    expect(resultado.periodos).toEqual([
      expect.objectContaining({ inicio: "2026-11-01", fim: "2026-11-03", status: "cumprido" }),
      expect.objectContaining({ inicio: "2026-11-04", fim: "2026-11-18", status: "aberto" }),
    ]);
  });

  it("período perdido encadeia a partir do fim original", () => {
    const resultado = rodar({
      configs: [cada15],
      registros: [],
      hoje: "2026-11-20",
    });

    expect(resultado.periodos).toEqual([
      expect.objectContaining({ inicio: "2026-11-01", fim: "2026-11-15", status: "falhou" }),
      expect.objectContaining({ inicio: "2026-11-16", fim: "2026-11-30", status: "aberto" }),
    ]);
  });

  it("preenchimento retroativo reencadeia todos os períodos seguintes", () => {
    const antes = rodar({
      configs: [cada15],
      registros: [reg("2026-11-03")],
      hoje: "2026-11-10",
    });

    // O mesmo hábito depois de marcar retroativamente o dia 6.
    const depois = rodar({
      configs: [cada15],
      registros: [reg("2026-11-03"), reg("2026-11-06")],
      hoje: "2026-11-10",
    });

    expect(antes.periodos).toHaveLength(2);
    expect(antes.periodos[1]).toMatchObject({ fim: "2026-11-18", status: "aberto" });

    // O período 2 fechou na nova conclusão e abriu um terceiro com outro
    // vencimento: a cadeia inteira andou, não só o dia tocado.
    expect(depois.periodos).toHaveLength(3);
    expect(depois.periodos[1]).toMatchObject({ fim: "2026-11-06", status: "cumprido" });
    expect(depois.periodos[2]).toMatchObject({ inicio: "2026-11-07", fim: "2026-11-21" });
    expect(depois.sequencia.atual).toBe(2);
  });

  it("usa a enésima conclusão quando a meta é maior que 1", () => {
    const cada10meta3 = config({
      cadencia: { tipo: "cada_n_dias", intervalo: 10 },
      modo: { tipo: "flexivel", metaOcorrencias: 3 },
    });

    const resultado = rodar({
      configs: [cada10meta3],
      registros: [reg("2026-11-02"), reg("2026-11-04"), reg("2026-11-07")],
      hoje: "2026-11-20",
    });

    expect(resultado.periodos[0]).toMatchObject({
      inicio: "2026-11-01",
      fim: "2026-11-07",
      status: "cumprido",
    });
    expect(resultado.periodos[1]).toMatchObject({ inicio: "2026-11-08" });
  });
});

describe("congelamento", () => {
  const comCongelamento = config({ congelamento: { aCada: 3, max: 2 } });

  it("ganha a cada 3 interações, consome sozinho na falha e falha quando esgota", () => {
    const resultado = rodar({
      configs: [comCongelamento],
      registros: [
        reg("2026-11-01"),
        reg("2026-11-02"),
        reg("2026-11-03"),
        // 04 perdido: consome o congelamento ganho no dia 3
        reg("2026-11-05"),
        reg("2026-11-06"),
        reg("2026-11-07"),
        // 08 perdido: consome o ganho no dia 7
        // 09 perdido: estoque vazio, falha de verdade
      ],
      hoje: "2026-11-10",
    });

    expect(resultado.periodos.map((p) => p.status)).toEqual([
      "cumprido",
      "cumprido",
      "cumprido",
      "congelado",
      "cumprido",
      "cumprido",
      "cumprido",
      "congelado",
      "falhou",
      "aberto",
    ]);

    expect(resultado.congelamentos).toEqual({ disponiveis: 0, ganhos: 2, consumidos: 2 });
  });

  it("congelado preserva a sequência sem somar", () => {
    const resultado = rodar({
      configs: [comCongelamento],
      registros: [reg("2026-11-01"), reg("2026-11-02"), reg("2026-11-03")],
      hoje: "2026-11-05",
    });

    // 04 foi congelado: a sequência continua em 3, não em 4.
    expect(resultado.periodos[3].status).toBe("congelado");
    expect(resultado.sequencia.atual).toBe(3);
    expect(resultado.sequencia.totalNoPrazo).toBe(3);
  });

  it("período congelado não conta para ganhar congelamento novo", () => {
    const resultado = rodar({
      configs: [config({ congelamento: { aCada: 3, max: 5 } })],
      // 01, 02, 03 cumpridos ganham 1 congelamento; 04 perdido consome ele;
      // 05 cumprido.
      registros: [
        reg("2026-11-01"),
        reg("2026-11-02"),
        reg("2026-11-03"),
        reg("2026-11-05"),
      ],
      hoje: "2026-11-06",
    });

    expect(resultado.periodos[3].status).toBe("congelado");

    // Se o congelado contasse, a sequência estaria em 5 e um segundo
    // congelamento já teria sido ganho. Ele preserva, mas não soma.
    expect(resultado.sequencia.atual).toBe(4);
    expect(resultado.congelamentos).toEqual({
      disponiveis: 0,
      ganhos: 1,
      consumidos: 1,
    });
  });

  it("respeita o teto do estoque", () => {
    const resultado = rodar({
      configs: [config({ congelamento: { aCada: 1, max: 2 } })],
      registros: [
        reg("2026-11-01"),
        reg("2026-11-02"),
        reg("2026-11-03"),
        reg("2026-11-04"),
      ],
      hoje: "2026-11-05",
    });

    expect(resultado.congelamentos.disponiveis).toBe(2);
    expect(resultado.congelamentos.ganhos).toBe(2);
  });
});

describe("pausa", () => {
  it("não gera período no intervalo e preserva a sequência", () => {
    const resultado = rodar({
      registros: [
        reg("2026-11-01"),
        reg("2026-11-02"),
        reg("2026-11-23"),
        reg("2026-11-24"),
      ],
      pausas: [{ de: d("2026-11-03"), ate: d("2026-11-22") }],
      hoje: "2026-11-25",
    });

    expect(resultado.periodos.map((p) => p.inicio)).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
    ]);
    expect(resultado.sequencia.atual).toBe(4);
  });

  it("congela o relógio do cada_n_dias: a contagem recomeça na retomada", () => {
    const resultado = rodar({
      configs: [
        config({
          cadencia: { tipo: "cada_n_dias", intervalo: 15 },
          modo: { tipo: "flexivel", metaOcorrencias: 1 },
        }),
      ],
      pausas: [{ de: d("2026-11-01"), ate: d("2026-11-20") }],
      hoje: "2026-11-25",
    });

    // Voltar de 20 dias de férias não produz vencimento já estourado.
    expect(resultado.periodos).toEqual([
      expect.objectContaining({ inicio: "2026-11-21", fim: "2026-12-05", status: "aberto" }),
    ]);
  });

  it("pausa aberta interrompe a geração de períodos", () => {
    const resultado = rodar({
      registros: [reg("2026-11-01")],
      pausas: [{ de: d("2026-11-02"), ate: null }],
      hoje: "2026-11-25",
    });

    expect(resultado.periodos).toHaveLength(1);
    expect(resultado.sequencia.atual).toBe(1);
  });
});

describe("configuração versionada", () => {
  it("avalia cada período pela regra vigente na época", () => {
    const antiga = config({
      id: "v1",
      vigenteDe: d("2026-11-01"),
      vigenteAte: d("2026-11-02"),
      modo: { tipo: "flexivel", metaOcorrencias: 1 },
    });
    const nova = config({
      id: "v2",
      vigenteDe: d("2026-11-03"),
      vigenteAte: null,
      modo: { tipo: "flexivel", metaOcorrencias: 2 },
    });

    const resultado = rodar({
      configs: [antiga, nova],
      registros: [reg("2026-11-01"), reg("2026-11-02"), reg("2026-11-03")],
      hoje: "2026-11-04",
    });

    // Um registro por dia: bastava na regra antiga, não basta na nova.
    expect(resultado.periodos.map((p) => [p.configId, p.status])).toEqual([
      ["v1", "cumprido"],
      ["v1", "cumprido"],
      ["v2", "falhou"],
      ["v2", "aberto"],
    ]);
  });

  it("falha claramente quando não há versão vigente", () => {
    expect(() =>
      rodar({
        configs: [config({ vigenteDe: d("2026-11-10") })],
        hoje: "2026-11-05",
      }),
    ).toThrow(/Nenhuma versão de configuração vigente/);
  });
});

describe("modo fixo", () => {
  const remedio = config({
    modo: { tipo: "fixo" },
    modoFixo: { horarios: ["08:00", "20:00"] },
  });

  it("cada slot cumprido vale uma interação", () => {
    const resultado = rodar({
      configs: [remedio],
      registros: [reg("2026-11-01", 1, "08:00"), reg("2026-11-01", 1, "20:00")],
      hoje: "2026-11-02",
    });

    expect(resultado.periodos[0]).toMatchObject({
      status: "cumprido",
      concluidas: 2,
      metaOcorrencias: 2,
      interacoes: 2,
    });
    expect(resultado.sequencia.atual).toBe(2);
  });

  it("slot perdido derruba o período inteiro", () => {
    const resultado = rodar({
      configs: [remedio],
      registros: [reg("2026-11-01", 1, "08:00")],
      hoje: "2026-11-02",
    });

    expect(resultado.periodos[0]).toMatchObject({ status: "falhou", concluidas: 1 });
    expect(resultado.sequencia.atual).toBe(0);
  });

  it("registro casa com o slot pelo horário", () => {
    const resultado = rodar({
      configs: [remedio],
      // Dois registros no mesmo horário não cobrem o outro slot.
      registros: [reg("2026-11-01", 1, "08:00"), reg("2026-11-01", 1, "08:00")],
      hoje: "2026-11-02",
    });

    expect(resultado.periodos[0]).toMatchObject({ status: "falhou", concluidas: 1 });
  });
});

describe("tipos de hábito", () => {
  it("quantificado só cumpre ao somar a meta no dia", () => {
    const agua = config({ meta: { tipo: "quantificado", valor: 2 } });

    const resultado = rodar({
      configs: [agua],
      registros: [reg("2026-11-01", 0.5), reg("2026-11-01", 1.5), reg("2026-11-02", 1)],
      hoje: "2026-11-03",
    });

    expect(resultado.periodos.map((p) => p.status)).toEqual([
      "cumprido",
      "falhou",
      "aberto",
    ]);
  });

  it("duração acumula segundos de várias sessões", () => {
    const meditar = config({ meta: { tipo: "duracao", segundos: 600 } });

    const resultado = rodar({
      configs: [meditar],
      registros: [reg("2026-11-01", 240), reg("2026-11-01", 360)],
      hoje: "2026-11-02",
    });

    expect(resultado.periodos[0].status).toBe("cumprido");
  });

  it("negativo fecha cumprido pela ausência de recaída", () => {
    const naoFumar = config({ meta: { tipo: "negativo", tolerancia: 0 } });

    const resultado = rodar({
      configs: [naoFumar],
      registros: [reg("2026-11-02")], // recaída
      hoje: "2026-11-04",
    });

    expect(resultado.periodos.map((p) => p.status)).toEqual([
      "cumprido",
      "falhou",
      "cumprido",
      "aberto",
    ]);
  });

  it("negativo não fecha o dia que ainda está correndo", () => {
    const naoFumar = config({ meta: { tipo: "negativo", tolerancia: 0 } });

    const resultado = rodar({ configs: [naoFumar], hoje: "2026-11-01" });

    // "Não houve recaída" não pode ser afirmado às 10 da manhã.
    expect(resultado.periodos).toEqual([
      expect.objectContaining({ inicio: "2026-11-01", status: "aberto" }),
    ]);
    expect(resultado.sequencia.atual).toBe(0);
  });

  it("negativo respeita a tolerância", () => {
    const doce = config({ meta: { tipo: "negativo", tolerancia: 1 } });

    const resultado = rodar({
      configs: [doce],
      registros: [reg("2026-11-01"), reg("2026-11-02"), reg("2026-11-02")],
      hoje: "2026-11-03",
    });

    expect(resultado.periodos.map((p) => p.status)).toEqual([
      "cumprido", // 1 recaída, dentro da tolerância
      "falhou", // 2 recaídas
      "aberto",
    ]);
  });
});

describe("idempotência", () => {
  it("rodar duas vezes com a mesma entrada dá o mesmo resultado", () => {
    const entrada = {
      configs: [config({ congelamento: { aCada: 3, max: 2 } })],
      registros: [reg("2026-11-01"), reg("2026-11-02"), reg("2026-11-03")],
      hoje: "2026-11-06" as const,
    };

    expect(rodar(entrada)).toEqual(rodar(entrada));
  });
});

describe("janela do modo fixo sem momento devido", () => {
  it("não gera período quando nenhum slot cai na janela", () => {
    // Hábito seg/qua/sex criado num sábado: a primeira janela, recortada no
    // início, não contém nenhum dia devido.
    const vitamina = config({
      cadencia: { tipo: "semanal" },
      modo: { tipo: "fixo" },
      modoFixo: { diasSemana: [2, 4, 6] },
      vigenteDe: d("2026-11-07"),
    });

    const resultado = rodar({
      inicioEm: d("2026-11-07"), // sábado
      configs: [vitamina],
      registros: [reg("2026-11-09")],
      hoje: "2026-11-09",
    });

    expect(resultado.periodos.map((p) => p.inicio)).toEqual(["2026-11-08"]);
    expect(resultado.periodos[0].metaOcorrencias).toBe(3);
  });

  it("mês sem o dia marcado não quebra a sequência", () => {
    // dias_mes [31]: fevereiro não tem o dia, e não deve custar a sequência.
    const mensal = config({
      cadencia: { tipo: "mensal" },
      modo: { tipo: "fixo" },
      modoFixo: { diasMes: [31] },
      vigenteDe: d("2026-01-31"),
    });

    const resultado = rodar({
      inicioEm: d("2026-01-31"),
      configs: [mensal],
      registros: [reg("2026-01-31")],
      hoje: "2026-03-05",
    });

    expect(resultado.periodos.map((p) => [p.inicio, p.status])).toEqual([
      ["2026-01-31", "cumprido"],
      ["2026-03-01", "aberto"],
    ]);
    expect(resultado.sequencia.atual).toBe(1);
  });
});

describe("origem do congelamento ganho", () => {
  it("aponta o período que gerou cada congelamento do estoque", () => {
    const resultado = rodar({
      configs: [config({ congelamento: { aCada: 3, max: 2 } })],
      registros: [reg("2026-11-01"), reg("2026-11-02"), reg("2026-11-03"), reg("2026-11-04")],
      hoje: "2026-11-06",
    });

    expect(resultado.periodos.map((p) => [p.inicio, p.congelamentosGanhos])).toEqual([
      ["2026-11-01", 0],
      ["2026-11-02", 0],
      ["2026-11-03", 1], // 3ª interação seguida
      ["2026-11-04", 0],
      ["2026-11-05", 0], // congelado: consumo não ganha
      ["2026-11-06", 0],
    ]);

    const soma = resultado.periodos.reduce((t, p) => t + p.congelamentosGanhos, 0);
    expect(soma).toBe(resultado.congelamentos.ganhos);
    expect(resultado.periodos[4].congelamentoConsumido).toBe(true);
  });
});

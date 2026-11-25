import { RELOGIO_PADRAO, dataLogicaDe, instanteDeParede, saudacaoDe } from "./dia-logico";

/**
 * São Paulo é UTC-3 e não tem mais horário de verão, então a hora de parede
 * local é a hora UTC menos 3. Os instantes abaixo são escritos em UTC, com
 * comentário dizendo que hora de parede representam.
 */
const utc = (iso: string) => new Date(iso);

describe("dataLogicaDe", () => {
  it("usa o próprio dia depois da virada das 04:00", () => {
    // 2026-11-09 04:00 em São Paulo
    expect(dataLogicaDe(utc("2026-11-09T07:00:00Z"))).toBe("2026-11-09");
    // 2026-11-09 12:00 em São Paulo
    expect(dataLogicaDe(utc("2026-11-09T15:00:00Z"))).toBe("2026-11-09");
    // 2026-11-09 23:30 em São Paulo
    expect(dataLogicaDe(utc("2026-11-10T02:30:00Z"))).toBe("2026-11-09");
  });

  it("joga a madrugada para o dia anterior", () => {
    // 2026-11-09 01:30 em São Paulo — o caso do mapa de regras
    expect(dataLogicaDe(utc("2026-11-09T04:30:00Z"))).toBe("2026-11-08");
    // 2026-11-09 00:00 em São Paulo
    expect(dataLogicaDe(utc("2026-11-09T03:00:00Z"))).toBe("2026-11-08");
    // 2026-11-09 03:59 em São Paulo — último minuto do dia lógico anterior
    expect(dataLogicaDe(utc("2026-11-09T06:59:00Z"))).toBe("2026-11-08");
  });

  it("vira o mês junto com o dia lógico", () => {
    // 2026-12-01 02:00 em São Paulo ainda é 30 de novembro
    expect(dataLogicaDe(utc("2026-12-01T05:00:00Z"))).toBe("2026-11-30");
  });

  it("depende do fuso configurado, não do fuso da máquina", () => {
    const instante = utc("2026-11-09T04:30:00Z");
    expect(dataLogicaDe(instante, { timezone: "America/Sao_Paulo", horaVirada: 4 })).toBe(
      "2026-11-08",
    );
    // O mesmo instante é 04:30 em UTC, já depois da virada.
    expect(dataLogicaDe(instante, { timezone: "UTC", horaVirada: 4 })).toBe("2026-11-09");
  });

  it("respeita uma hora de virada diferente", () => {
    const instante = utc("2026-11-09T05:00:00Z"); // 02:00 em São Paulo
    expect(dataLogicaDe(instante, { ...RELOGIO_PADRAO, horaVirada: 0 })).toBe("2026-11-09");
    expect(dataLogicaDe(instante, { ...RELOGIO_PADRAO, horaVirada: 4 })).toBe("2026-11-08");
  });
});

describe("saudacaoDe", () => {
  it("usa a hora de parede, não o dia lógico", () => {
    // 01:00 em São Paulo: o dia lógico é o anterior, mas a saudação é de noite
    expect(saudacaoDe(utc("2026-11-09T04:00:00Z"))).toBe("boa_noite");
    expect(dataLogicaDe(utc("2026-11-09T04:00:00Z"))).toBe("2026-11-08");
  });

  it("separa as faixas do dia", () => {
    expect(saudacaoDe(utc("2026-11-09T08:00:00Z"))).toBe("bom_dia"); // 05:00
    expect(saudacaoDe(utc("2026-11-09T14:00:00Z"))).toBe("bom_dia"); // 11:00
    expect(saudacaoDe(utc("2026-11-09T15:00:00Z"))).toBe("boa_tarde"); // 12:00
    expect(saudacaoDe(utc("2026-11-09T20:00:00Z"))).toBe("boa_tarde"); // 17:00
    expect(saudacaoDe(utc("2026-11-09T21:00:00Z"))).toBe("boa_noite"); // 18:00
  });
});

/**
 * A volta: o que o modo manual do worker usa para transformar `2026-11-19 04:01`
 * no instante em que o app realmente vira o dia.
 *
 * O teste que importa é o do **fuso do processo**: o contêiner do homelab roda
 * com `TZ=UTC`, e se o argumento fosse lido ali as `04:01` pedidas seriam
 * `01:01` em São Paulo — nenhuma virada aconteceria, e o teste manual acusaria o
 * worker de um defeito que é do instante.
 */
describe("instanteDeParede", () => {
  const parede = { ano: 2026, mes: 11, dia: 19, hora: 4, minuto: 1 };

  it("é a inversa de dataLogicaDe: a parede pedida é a parede obtida", () => {
    const instante = instanteDeParede(parede, "America/Sao_Paulo");

    expect(instante.toISOString()).toBe("2026-11-19T07:01:00.000Z");
    expect(dataLogicaDe(instante)).toBe("2026-11-19");
  });

  it("o mesmo pedido em outro fuso dá outro instante", () => {
    expect(instanteDeParede(parede, "UTC").toISOString()).toBe("2026-11-19T04:01:00.000Z");
    expect(instanteDeParede(parede, "Asia/Tokyo").toISOString()).toBe(
      "2026-11-18T19:01:00.000Z",
    );
  });

  it("acerta o minuto exato antes e depois da virada", () => {
    const antes = instanteDeParede({ ...parede, hora: 3, minuto: 59 });
    const depois = instanteDeParede({ ...parede, hora: 4, minuto: 0 });

    expect(dataLogicaDe(antes)).toBe("2026-11-18");
    expect(dataLogicaDe(depois)).toBe("2026-11-19");
  });

  it("leva o segundo quando ele é dado, e zera quando não é", () => {
    expect(instanteDeParede({ ...parede, segundo: 30 }).toISOString()).toBe(
      "2026-11-19T07:01:30.000Z",
    );
    expect(instanteDeParede(parede).toISOString()).toBe("2026-11-19T07:01:00.000Z");
  });

  /*
   * O Brasil não tem mais horário de verão, mas o fuso vem de `config_app` e
   * nada impede configurar um que tenha. Nova York adianta em 2026-03-08 às
   * 02:00 e atrasa em 2026-11-01 às 02:00, então aquele dia tem uma hora que não
   * existe e o outro uma que acontece duas vezes. O que se exige das duas é
   * instante real e determinado — nunca `Invalid Date`, nunca um dia de erro.
   */
  it("hora que o horário de verão pula resolve para a hora antes do salto", () => {
    const pulada = instanteDeParede(
      { ano: 2026, mes: 3, dia: 8, hora: 2, minuto: 30 },
      "America/New_York",
    );

    expect(Number.isNaN(pulada.getTime())).toBe(false);
    // 01:30 EST: as 02:30 pedidas não existem naquele dia.
    expect(pulada.toISOString()).toBe("2026-03-08T06:30:00.000Z");
  });

  it("hora repetida pelo atraso cai na primeira passagem", () => {
    const repetida = instanteDeParede(
      { ano: 2026, mes: 11, dia: 1, hora: 1, minuto: 30 },
      "America/New_York",
    );

    // 01:30 EDT, e não as 01:30 EST que vêm uma hora depois.
    expect(repetida.toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("os instantes vizinhos de uma transição continuam exatos", () => {
    expect(
      instanteDeParede({ ano: 2026, mes: 3, dia: 7, hora: 23, minuto: 0 }, "America/New_York")
        .toISOString(),
    ).toBe("2026-03-08T04:00:00.000Z");
    expect(
      instanteDeParede({ ano: 2026, mes: 3, dia: 8, hora: 5, minuto: 0 }, "America/New_York")
        .toISOString(),
    ).toBe("2026-03-08T09:00:00.000Z");
  });
});

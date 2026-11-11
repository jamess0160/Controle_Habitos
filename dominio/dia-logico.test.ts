import { RELOGIO_PADRAO, dataLogicaDe, saudacaoDe } from "./dia-logico";

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

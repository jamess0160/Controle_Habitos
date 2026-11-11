import { type RegraCongelamento, ganhosAoAvancar } from "./congelamento";

const aCada3: RegraCongelamento = { aCada: 3, max: 2 };

describe("ganhosAoAvancar", () => {
  it("não ganha nada antes de fechar o múltiplo", () => {
    expect(ganhosAoAvancar(0, 1, aCada3, 0)).toBe(0);
    expect(ganhosAoAvancar(1, 1, aCada3, 0)).toBe(0);
  });

  it("ganha ao completar o múltiplo", () => {
    expect(ganhosAoAvancar(2, 1, aCada3, 0)).toBe(1);
  });

  it("ganha de novo nos múltiplos seguintes", () => {
    expect(ganhosAoAvancar(5, 1, aCada3, 0)).toBe(1); // sequência 6
    expect(ganhosAoAvancar(8, 1, aCada3, 0)).toBe(1); // sequência 9
  });

  it("um avanço de várias interações pode cruzar mais de um múltiplo", () => {
    // Modo fixo com 6 slots cumpridos de uma vez: cruza 3 e 6.
    expect(ganhosAoAvancar(0, 6, aCada3, 0)).toBe(2);
  });

  it("descarta o excedente quando o estoque está cheio", () => {
    expect(ganhosAoAvancar(2, 1, aCada3, 2)).toBe(0);
    expect(ganhosAoAvancar(0, 6, aCada3, 1)).toBe(1);
  });

  it("não ganha com avanço zero", () => {
    expect(ganhosAoAvancar(3, 0, aCada3, 0)).toBe(0);
  });

  it("recomeça do zero depois de a sequência zerar", () => {
    // Sequência zerada: as próximas 2 interações não geram congelamento.
    expect(ganhosAoAvancar(0, 1, aCada3, 0)).toBe(0);
    expect(ganhosAoAvancar(1, 1, aCada3, 0)).toBe(0);
    expect(ganhosAoAvancar(2, 1, aCada3, 0)).toBe(1);
  });
});

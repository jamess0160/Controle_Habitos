import { duracaoEmRelogio, duracaoEmTexto, partirDuracao } from "./duracao";

/**
 * A unidade do tipo `duracao` é o **segundo inteiro**, e estes testes existem
 * porque a escala antiga (minuto inteiro) deixava a meta mais curta do app
 * inexprimível: "respirar 30 s" não cabia em `z.int().positive()` de minutos.
 *
 * O caso que justifica a escolha de inteiro, e não de minuto fracionário, está
 * em `dominio/meta.test.ts`: três sessões de 20 s têm de somar exatamente uma
 * meta de 1 min, e em minuto fracionário somariam `0.99999…`.
 */

describe("partirDuracao", () => {
  it("decompõe em h, min e s", () => {
    expect(partirDuracao(30)).toEqual({ horas: 0, minutos: 0, segundos: 30 });
    expect(partirDuracao(90)).toEqual({ horas: 0, minutos: 1, segundos: 30 });
    expect(partirDuracao(5_430)).toEqual({ horas: 1, minutos: 30, segundos: 30 });
  });

  it("não devolve parte negativa — o cronômetro chega a zerar antes de hidratar", () => {
    expect(partirDuracao(-30)).toEqual({ horas: 0, minutos: 0, segundos: 0 });
  });
});

describe("duracaoEmTexto, a forma que entra na frase da regra", () => {
  it("omite as partes em zero", () => {
    expect(duracaoEmTexto(30)).toBe("30 s");
    expect(duracaoEmTexto(600)).toBe("10 min");
    expect(duracaoEmTexto(3_600)).toBe("1 h");
    expect(duracaoEmTexto(5_400)).toBe("1 h 30 min");
  });

  it("junta o que sobrou", () => {
    expect(duracaoEmTexto(90)).toBe("1 min 30 s");
    expect(duracaoEmTexto(5_430)).toBe("1 h 30 min 30 s");
  });

  it("zero tem texto, para a função nunca devolver vazio", () => {
    expect(duracaoEmTexto(0)).toBe("0 s");
  });
});

describe("duracaoEmRelogio, a forma do progresso e do cronômetro", () => {
  it("mostra mm:ss antes de uma hora e h:mm:ss depois", () => {
    expect(duracaoEmRelogio(0)).toBe("00:00");
    expect(duracaoEmRelogio(65)).toBe("01:05");
    expect(duracaoEmRelogio(3_605)).toBe("1:00:05");
  });
});

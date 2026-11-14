import { indiceSobre, mover, ordemDe } from "./reordenar";

/**
 * O que estes testes protegem: a lista do usuário não pode ser embaralhada de um
 * jeito que **pareça** proposital. Um erro de um índice aqui não quebra nada
 * visível — muda a ordem dos hábitos e fica assim.
 */

const lista = ["a", "b", "c", "d"];

describe("mover", () => {
  it("atravessa os vizinhos em vez de trocar de lugar com o destino", () => {
    /*
     * Trocar daria ["d","b","c","a"]. O gesto que o usuário fez foi arrastar "a"
     * até o fim, e o que ele espera é ver "b","c","d" subirem um.
     */
    expect(mover(lista, 0, 3)).toEqual(["b", "c", "d", "a"]);
  });

  it("move para trás deslocando na outra direção", () => {
    expect(mover(lista, 3, 0)).toEqual(["d", "a", "b", "c"]);
  });

  it("move um passo", () => {
    expect(mover(lista, 1, 2)).toEqual(["a", "c", "b", "d"]);
    expect(mover(lista, 2, 1)).toEqual(["a", "c", "b", "d"]);
  });

  it("origem igual ao destino não muda nada", () => {
    expect(mover(lista, 2, 2)).toEqual(lista);
  });

  it("índice fora da lista devolve a lista intacta", () => {
    // O `pointermove` dispara nas bordas; lançar ali derrubaria a tela no gesto.
    expect(mover(lista, -1, 2)).toEqual(lista);
    expect(mover(lista, 0, 9)).toEqual(lista);
    expect(mover([], 0, 0)).toEqual([]);
  });

  it("não altera a lista recebida", () => {
    const original = [...lista];
    mover(lista, 0, 3);
    expect(lista).toEqual(original);
  });

  it("qualquer movimento preserva todos os itens", () => {
    for (let de = 0; de < lista.length; de += 1) {
      for (let para = 0; para < lista.length; para += 1) {
        expect([...mover(lista, de, para)].sort()).toEqual([...lista].sort());
      }
    }
  });
});

describe("indiceSobre", () => {
  /* Quatro linhas de 60 px começando em 100: centros em 130, 190, 250, 310. */
  const centros = [130, 190, 250, 310];

  it("acima do primeiro centro é o primeiro índice", () => {
    expect(indiceSobre(centros, 0)).toBe(0);
    expect(indiceSobre(centros, 129)).toBe(0);
  });

  it("passar do centro é o que troca de linha, não encostar na borda", () => {
    // Com a borda, a troca moveria a linha sob o dedo e oscilaria a cada quadro.
    expect(indiceSobre(centros, 131)).toBe(1);
    expect(indiceSobre(centros, 189)).toBe(1);
  });

  it("abaixo do último centro é o último índice", () => {
    expect(indiceSobre(centros, 311)).toBe(3);
    expect(indiceSobre(centros, 9999)).toBe(3);
  });

  it("lista vazia não produz índice negativo", () => {
    expect(indiceSobre([], 100)).toBe(0);
  });
});

describe("ordemDe", () => {
  it("é só a sequência de ids, que é o que o contrato pede", () => {
    expect(ordemDe([{ id: "x" }, { id: "y" }])).toEqual(["x", "y"]);
  });
});

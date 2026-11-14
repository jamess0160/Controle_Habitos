import { hoje as schemaDeHoje } from "@/contracts";
import { hojeFixture, registroCriadoFixture } from "@/contracts/fixtures";
import type { Efeitos, Hoje, LinhaDeHoje, RegistroCriado } from "@/contracts";
import { comRegistro, concluidaDe, semRegistro } from "./efeitos-de-hoje";

/**
 * O dashboard aplica os efeitos **sem** recarregar o payload, então estes testes
 * são a única coisa que impede a tela de divergir do servidor em silêncio.
 *
 * O caso que mais importa é o par marcar/desmarcar: desfazer tem de ser a
 * inversa exata de marcar, senão o número na tela fica errado até a próxima
 * visita — e ninguém tem como saber que ficou.
 */

function linha(hoje: Hoje, horario: string | null, habito?: string): LinhaDeHoje {
  const achada = hoje.linhas.find(
    (l) => l.horario === horario && (habito === undefined || l.nome === habito),
  );
  if (achada === undefined) throw new Error(`linha não encontrada: ${habito} ${horario}`);
  return achada;
}

const agua = () => linha(hojeFixture, null, "💧 Água");
const correr = () => linha(hojeFixture, null, "🏃 Correr");
const alongar = () => linha(hojeFixture, null, "🤸 Alongar");
const refrigerante = () => linha(hojeFixture, null, "🥤 Sem refrigerante");
const vitaminaManha = () => linha(hojeFixture, "08:00:00");
const vitaminaNoite = () => linha(hojeFixture, "20:00:00");

const efeitos: Efeitos = registroCriadoFixture.efeitos;

function criado(sobre: Partial<RegistroCriado>): RegistroCriado {
  return { ...registroCriadoFixture, ...sobre };
}

function depoisDe(hoje: Hoje, nome: string, horario: string | null = null): LinhaDeHoje {
  return linha(hoje, horario, nome);
}

describe("concluidaDe muda de regra com o tipo", () => {
  it("binário olha a interação, não o período", () => {
    // 1/3 na semana e o dia de hoje feito: a linha fala da interação devida.
    expect(concluidaDe({ tipo: "binario", concluidas: 1, meta: 3 }, true)).toBe(true);
    expect(concluidaDe({ tipo: "binario", concluidas: 1, meta: 3 }, false)).toBe(false);
  });

  it("quantificado só fecha na meta — um incremento não basta", () => {
    const parcial = { tipo: "quantificado", acumulado: 250, meta: 2000, unidade: "ml" } as const;
    expect(concluidaDe(parcial, true)).toBe(false);
    expect(concluidaDe({ ...parcial, acumulado: 2000 }, false)).toBe(true);
  });

  it("duração fecha ao alcançar os minutos", () => {
    expect(concluidaDe({ tipo: "duracao", acumulado: 14, meta: 15 }, true)).toBe(false);
    expect(concluidaDe({ tipo: "duracao", acumulado: 15, meta: 15 }, true)).toBe(true);
  });

  it("negativo nasce cumprido e cai ao passar da tolerância", () => {
    expect(concluidaDe({ tipo: "negativo", recaidas: 0, tolerancia: 2 }, false)).toBe(true);
    expect(concluidaDe({ tipo: "negativo", recaidas: 2, tolerancia: 2 }, true)).toBe(true);
    expect(concluidaDe({ tipo: "negativo", recaidas: 3, tolerancia: 2 }, true)).toBe(false);
  });
});

describe("marcar", () => {
  it("soma o valor registrado e guarda o que desfazer", () => {
    const tocada = agua();
    const depois = depoisDe(
      comRegistro(hojeFixture, tocada, criado({ habitoId: tocada.habitoId, id: "r1", valor: 250 })),
      "💧 Água",
    );

    expect(depois.progresso).toMatchObject({ acumulado: 1650 });
    expect(depois.ultimoRegistro).toEqual({ id: "r1", valor: 250 });
    // 1650 de 2000: a marca continua aberta, com 350 faltando.
    expect(depois.concluida).toBe(false);
  });

  it("fecha a linha quando o incremento alcança a meta", () => {
    const tocada = agua();
    const depois = depoisDe(
      comRegistro(hojeFixture, tocada, criado({ habitoId: tocada.habitoId, valor: 600 })),
      "💧 Água",
    );

    expect(depois.progresso).toMatchObject({ acumulado: 2000 });
    expect(depois.concluida).toBe(true);
  });

  it("no hábito fixo fecha só a ocorrência tocada, mas a sequência vale para as duas", () => {
    const tocada = vitaminaNoite();
    const resultado = comRegistro(
      hojeFixture,
      tocada,
      criado({ habitoId: tocada.habitoId, ocorrenciaId: tocada.ocorrenciaId, id: "r2", valor: 1 }),
    );

    const noite = depoisDe(resultado, "💊 Vitamina D", "20:00:00");
    const manha = depoisDe(resultado, "💊 Vitamina D", "08:00:00");

    expect(noite.concluida).toBe(true);
    expect(noite.ultimoRegistro).toEqual({ id: "r2", valor: 1 });
    // A da manhã já estava cumprida e tem o registro **dela**, não o novo.
    expect(manha.concluida).toBe(true);
    expect(manha.ultimoRegistro).toEqual(vitaminaManha().ultimoRegistro);

    expect(noite.sequencia).toBe(efeitos.sequencia.atual);
    expect(manha.sequencia).toBe(efeitos.sequencia.atual);
    expect(manha.congelamentos).toBe(efeitos.congelamentosDisponiveis);
  });

  it("a recaída derruba todas as linhas do hábito negativo quando passa da tolerância", () => {
    const tolerancia = 2;

    let estado: Hoje = hojeFixture;
    for (let i = 0; i <= tolerancia; i += 1) {
      const atual = depoisDe(estado, "🥤 Sem refrigerante");
      estado = comRegistro(estado, atual, criado({ habitoId: atual.habitoId, valor: 1 }));
    }

    const depois = depoisDe(estado, "🥤 Sem refrigerante");
    expect(depois.progresso).toMatchObject({ recaidas: 3 });
    expect(depois.concluida).toBe(false);
  });

  it("no fixo com meta somável o incremento fica só na ocorrência tocada", () => {
    /*
     * O único caso em que a distinção entre progresso de período e de interação
     * aparece — e o caso em que errar some: somar nas duas linhas mostraria
     * 700 ml em cada dose quando foram 700 em uma. O servidor acumula por
     * interação (`servidor/hoje.ts`), e as duas contas têm de concordar.
     */
    const somavel = (base: LinhaDeHoje): LinhaDeHoje => ({
      ...base,
      concluida: false,
      ultimoRegistro: null,
      progresso: { tipo: "quantificado", acumulado: 0, meta: 1000, unidade: "ml" },
    });

    const duas: Hoje = {
      ...hojeFixture,
      linhas: [somavel(vitaminaManha()), somavel(vitaminaNoite())],
    };

    const tocada = duas.linhas[0];
    const resultado = comRegistro(
      duas,
      tocada,
      criado({ habitoId: tocada.habitoId, ocorrenciaId: tocada.ocorrenciaId, valor: 700 }),
    );

    expect(resultado.linhas[0].progresso).toMatchObject({ acumulado: 700 });
    expect(resultado.linhas[1].progresso).toMatchObject({ acumulado: 0 });
    /* Mas a sequência, que é do hábito, move nas duas. */
    expect(resultado.linhas[1].sequencia).toBe(efeitos.sequencia.atual);
  });

  it("não encosta nas linhas dos outros hábitos", () => {
    const tocada = agua();
    const resultado = comRegistro(hojeFixture, tocada, criado({ habitoId: tocada.habitoId }));

    expect(depoisDe(resultado, "🏃 Correr")).toEqual(correr());
    expect(depoisDe(resultado, "🤸 Alongar")).toEqual(alongar());
  });

  it("o resultado continua válido contra o schema do contrato", () => {
    const tocada = alongar();
    const resultado = comRegistro(
      hojeFixture,
      tocada,
      criado({ habitoId: tocada.habitoId, valor: 20 }),
    );

    expect(schemaDeHoje.safeParse(resultado).success).toBe(true);
  });
});

describe("desmarcar", () => {
  it("é a inversa exata de marcar", () => {
    const tocada = agua();
    const registro = { id: "r1", valor: 250 };
    const marcado = comRegistro(
      hojeFixture,
      tocada,
      criado({ habitoId: tocada.habitoId, ...registro }),
    );

    const desmarcado = semRegistro(marcado, tocada, registro, efeitos);

    expect(depoisDe(desmarcado, "💧 Água")).toMatchObject({
      progresso: tocada.progresso,
      concluida: tocada.concluida,
    });
  });

  it("apaga o que desfazer: só há um desfazer por carregamento", () => {
    const tocada = agua();
    const registro = tocada.ultimoRegistro;
    if (registro === null) throw new Error("a fixture precisa de um registro para desfazer");

    const depois = depoisDe(semRegistro(hojeFixture, tocada, registro, efeitos), "💧 Água");

    expect(depois.ultimoRegistro).toBeNull();
    expect(depois.progresso).toMatchObject({ acumulado: 1400 - registro.valor });
  });

  it("no hábito fixo esvazia só a marca da ocorrência desfeita", () => {
    const tocada = vitaminaManha();
    const registro = tocada.ultimoRegistro;
    if (registro === null) throw new Error("a fixture precisa de um registro para desfazer");

    const resultado = semRegistro(hojeFixture, tocada, registro, efeitos);

    expect(depoisDe(resultado, "💊 Vitamina D", "08:00:00")).toMatchObject({
      concluida: false,
      ultimoRegistro: null,
      progresso: { concluidas: 2 },
    });
    // A da noite nunca foi marcada hoje; desfazer a manhã não a inventa.
    expect(depoisDe(resultado, "💊 Vitamina D", "20:00:00").concluida).toBe(false);
  });

  it("desfazer a recaída devolve o hábito negativo para dentro da tolerância", () => {
    const tocada = refrigerante();
    const marcado = comRegistro(
      hojeFixture,
      tocada,
      criado({ habitoId: tocada.habitoId, id: "r9", valor: 1 }),
    );
    const comRecaida = depoisDe(marcado, "🥤 Sem refrigerante");
    expect(comRecaida.progresso).toMatchObject({ recaidas: 1 });

    const resultado = semRegistro(marcado, tocada, { id: "r9", valor: 1 }, efeitos);

    expect(depoisDe(resultado, "🥤 Sem refrigerante")).toMatchObject({
      progresso: { recaidas: 0 },
      concluida: true,
    });
  });

  it("nunca produz progresso negativo, mesmo com valor maior que o acumulado", () => {
    const tocada = agua();
    const resultado = semRegistro(hojeFixture, tocada, { id: "r1", valor: 99_999 }, efeitos);

    expect(depoisDe(resultado, "💧 Água").progresso).toMatchObject({ acumulado: 0 });
    expect(schemaDeHoje.safeParse(resultado).success).toBe(true);
  });
});

import { estadoAuth, loginComSenha, passkeyCadastrada, resetarBiometria } from "./auth";
import { dataLogica, horario } from "./comum";
import { caminhoDe, exigirValido, validar } from "./erro";
import * as f from "./fixtures";
import { configHabito, criarHabito, editarHabito, listaDeHabitos } from "./habito";
import { hoje } from "./hoje";
import { configApp, exportacao, statusPush } from "./infra";
import { resumoDeConfig, textoDeCongelamento } from "./resumo";
import { criarRegistro, preencherRetroativo, registroCriado, retroativo, retroativoAplicado } from "./registro";

/**
 * Testes de contrato.
 *
 * Duas perguntas: toda fixture de response passa no próprio schema (senão a
 * etapa 2 constrói tela sobre promessa falsa), e toda combinação de configuração
 * sem sentido é recusada (senão os CHECKs do banco são a primeira linha de
 * defesa, com erro de Postgres chegando na cara do usuário).
 */

describe("fixtures validam contra o próprio schema", () => {
  const casos: Array<[string, Parameters<typeof exigirValido>[0], unknown]> = [
    ["hoje", hoje, f.hojeFixture],
    ["lista de hábitos", listaDeHabitos, f.listaDeHabitosFixture],
    ["hábito flexível quantificado", configHabito, f.habitoAgua.config],
    ["hábito fixo semanal", configHabito, f.habitoVitamina.config],
    ["hábito negativo mensal", configHabito, f.habitoArquivado.config],
    ["registro criado", registroCriado, f.registroCriadoFixture],
    ["retroativo", retroativo, f.retroativoFixture],
    ["retroativo (prévia)", retroativoAplicado, f.retroativoPreviaFixture],
    ["estado de auth", estadoAuth, f.estadoAuthFixture],
    ["estado de auth (primeiro acesso)", estadoAuth, f.estadoAuthPrimeiroAcessoFixture],
    ["estado de auth (bloqueado)", estadoAuth, f.estadoAuthBloqueadoFixture],
    ["passkey cadastrada", passkeyCadastrada, f.passkeyCadastradaFixture],
    ["status do push", statusPush, f.statusPushFixture],
    ["config do app", configApp, f.configAppFixture],
    ["exportação", exportacao, f.exportacaoFixture],
  ];

  it.each(casos)("%s", (nome, schema, fixture) => {
    expect(() => exigirValido(schema, fixture, nome)).not.toThrow();
  });
});

describe("combinações de configuração que não existem", () => {
  const base = { meta: { tipo: "binario" }, congelamento: null };

  it("recusa modo fixo com cadência cada_n_dias", () => {
    // A janela anda no calendário; momento fixo dentro dela não descreve nada.
    const r = configHabito.safeParse({
      ...base,
      modo: "fixo",
      cadencia: { tipo: "cada_n_dias", intervalo: 3 },
    });
    expect(r.success).toBe(false);
  });

  it("recusa modo fixo semanal sem dias da semana", () => {
    const r = configHabito.safeParse({
      ...base,
      modo: "fixo",
      cadencia: { tipo: "semanal", horarios: ["08:00:00"] },
    });
    expect(r.success).toBe(false);
  });

  it("recusa dias da semana em cadência mensal", () => {
    const r = configHabito.safeParse({
      ...base,
      modo: "fixo",
      cadencia: { tipo: "mensal", diasMes: [1], diasSemana: [2] },
    });
    expect(r.success).toBe(false);
  });

  it("recusa modo fixo diário sem horários", () => {
    const r = configHabito.safeParse({ ...base, modo: "fixo", cadencia: { tipo: "diario" } });
    expect(r.success).toBe(false);
  });

  it("recusa modo flexível sem meta de ocorrências", () => {
    const r = configHabito.safeParse({
      ...base,
      modo: "flexivel",
      cadencia: { tipo: "semanal" },
      notificarEm: null,
    });
    expect(r.success).toBe(false);
  });

  it("recusa meta de ocorrências no modo fixo (campo que não existe lá)", () => {
    const r = configHabito.safeParse({
      ...base,
      modo: "fixo",
      cadencia: { tipo: "semanal", diasSemana: [2] },
      metaOcorrencias: 3,
    });
    expect(r.success).toBe(false);
  });

  /*
   * A unidade do modo flexível é o dia lógico, então o período diário tem uma
   * unidade só e `metaOcorrencias` satura em 1. Pedir 2 era aceito e
   * inalcançável: `1/2` na tela, marca cheia, toque desmarcando, e o período
   * fechando `falhou` num dia cumprido. Ver `Docs/fixes/01`.
   */
  it("recusa meta acima de 1 na cadência diária (o dia não cabe duas)", () => {
    const r = configHabito.safeParse({
      ...base,
      modo: "flexivel",
      cadencia: { tipo: "diario" },
      metaOcorrencias: 2,
      notificarEm: null,
    });

    expect(r.success).toBe(false);
    /* No campo, não na raiz: é o que leva o formulário ao passo 4. */
    expect(r.error?.issues.map((i) => i.path.join("."))).toContain("metaOcorrencias");
  });

  it("aceita meta 1 na cadência diária", () => {
    const r = configHabito.safeParse({
      ...base,
      modo: "flexivel",
      cadencia: { tipo: "diario" },
      metaOcorrencias: 1,
      notificarEm: null,
    });
    expect(r.success).toBe(true);
  });

  it("duas vezes por dia é modo fixo com dois horários, e isso passa", () => {
    const r = configHabito.safeParse({
      ...base,
      modo: "fixo",
      cadencia: { tipo: "diario", horarios: ["08:00:00", "21:00:00"] },
    });
    expect(r.success).toBe(true);
  });

  it("recusa cada_n_dias com intervalo de 1 dia (isso é diário)", () => {
    const r = configHabito.safeParse({
      ...base,
      modo: "flexivel",
      cadencia: { tipo: "cada_n_dias", intervalo: 1 },
      metaOcorrencias: 1,
      notificarEm: null,
    });
    expect(r.success).toBe(false);
  });

  it("recusa quantificado sem unidade", () => {
    const r = configHabito.safeParse({
      modo: "flexivel",
      cadencia: { tipo: "diario" },
      metaOcorrencias: 1,
      notificarEm: null,
      meta: { tipo: "quantificado", valor: 2000 },
      congelamento: null,
    });
    expect(r.success).toBe(false);
  });

  it("recusa congelamento ativo com estoque máximo zero", () => {
    const r = configHabito.safeParse({
      modo: "flexivel",
      cadencia: { tipo: "diario" },
      metaOcorrencias: 1,
      notificarEm: null,
      meta: { tipo: "binario" },
      congelamento: { aCada: 3, max: 0 },
    });
    expect(r.success).toBe(false);
  });

  it("aceita tolerância zero no negativo — nenhuma recaída permitida", () => {
    const r = configHabito.safeParse({
      modo: "flexivel",
      cadencia: { tipo: "mensal" },
      metaOcorrencias: 1,
      notificarEm: null,
      meta: { tipo: "negativo", tolerancia: 0 },
      congelamento: null,
    });
    expect(r.success).toBe(true);
  });
});

describe("edição não troca o tipo do hábito", () => {
  it("aceita nova configuração do mesmo tipo", () => {
    const schema = editarHabito("duracao");
    const r = schema.safeParse({
      config: {
        modo: "flexivel",
        cadencia: { tipo: "diario" },
        metaOcorrencias: 1,
        notificarEm: "07:00:00",
        meta: { tipo: "duracao", segundos: 1_200 },
        congelamento: null,
      },
    });
    expect(r.success).toBe(true);
  });

  it("recusa configuração de outro tipo", () => {
    // Trocar o tipo reinterpretaria todo o histórico pela régua errada.
    const schema = editarHabito("duracao");
    const r = schema.safeParse({
      config: {
        modo: "flexivel",
        cadencia: { tipo: "diario" },
        metaOcorrencias: 1,
        notificarEm: null,
        meta: { tipo: "quantificado", valor: 10, unidade: "km" },
        congelamento: null,
      },
    });
    expect(r.success).toBe(false);
  });

  it("aceita edição só do nome", () => {
    expect(editarHabito("binario").safeParse({ nome: "🏃 Correr de manhã" }).success).toBe(true);
  });
});

describe("campos extras são recusados nos requests", () => {
  it("recusa chave desconhecida em criarHabito", () => {
    const r = criarHabito.safeParse({
      nome: "💧 Água",
      cor: "ciano",
      icone: "💧", // o emoji vai no nome; campo de ícone não existe
      config: f.habitoAgua.config,
    });
    expect(r.success).toBe(false);
  });

  it("recusa cor fora da paleta", () => {
    const r = criarHabito.safeParse({
      nome: "💧 Água",
      cor: "#00aaff",
      config: f.habitoAgua.config,
    });
    expect(r.success).toBe(false);
  });
});

describe("validar", () => {
  it("devolve dados estreitados quando passa", () => {
    const r = validar(criarHabito, {
      nome: "💧 Água",
      cor: "ciano",
      config: f.habitoAgua.config,
    });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dados.config.modo).toBe("flexivel");
  });

  it("devolve 422 com mensagem em pt-BR e o caminho do campo", () => {
    const r = validar(criarHabito, { nome: "", cor: "ciano", config: f.habitoAgua.config });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(422);
    expect(r.resposta.erro.codigo).toBe("validacao");
    expect(r.resposta.erro.campos).toEqual([
      { campo: "nome", mensagem: "O nome não pode ficar vazio." },
    ]);
  });

  it("traduz o erro de tipo sem cair no inglês do Zod", () => {
    const r = validar(criarHabito, { nome: 42, cor: "ciano", config: f.habitoAgua.config });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.resposta.erro.campos?.[0]).toEqual({
      campo: "nome",
      mensagem: "Esperava texto, mas veio número.",
    });
  });

  it("aponta o caminho dentro da cadência aninhada", () => {
    const r = validar(criarHabito, {
      nome: "💊 Vitamina",
      cor: "azul",
      config: {
        modo: "fixo",
        cadencia: { tipo: "semanal", diasSemana: [] },
        meta: { tipo: "binario" },
        congelamento: null,
      },
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.resposta.erro.campos?.[0]?.campo).toBe("config.cadencia.diasSemana");
    expect(r.resposta.erro.campos?.[0]?.mensagem).toBe("Informe pelo menos um item.");
  });

  it("não inclui campos quando não há erro de campo", () => {
    const r = validar(loginComSenha, { senha: "x" });
    expect(r.ok).toBe(true);
  });
});

describe("caminhoDe", () => {
  it("junta chaves com ponto e índices com colchete", () => {
    expect(caminhoDe([])).toBe("");
    expect(caminhoDe(["nome"])).toBe("nome");
    expect(caminhoDe(["config", "cadencia", "horarios", 1])).toBe("config.cadencia.horarios[1]");
    expect(caminhoDe(["linhas", 0, "progresso"])).toBe("linhas[0].progresso");
  });
});

describe("primitivos", () => {
  it("dia lógico valida o calendário, não só o formato", () => {
    expect(dataLogica.safeParse("2026-11-10").success).toBe(true);
    expect(dataLogica.safeParse("2026-02-30").success).toBe(false);
    expect(dataLogica.safeParse("10/11/2026").success).toBe(false);
    expect(dataLogica.safeParse("2026-11-10T00:00:00Z").success).toBe(false);
  });

  it("horário exige segundos, como o Postgres devolve", () => {
    expect(horario.safeParse("08:00:00").success).toBe(true);
    expect(horario.safeParse("08:00").success).toBe(false);
    expect(horario.safeParse("24:00:00").success).toBe(false);
  });
});

describe("registro", () => {
  it("origem padrão é app, e o dia lógico é opcional", () => {
    const r = criarRegistro.safeParse({ habitoId: f.habitoAgua.id, valor: 700 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.origem).toBe("app");
      expect(r.data.dataLogica).toBeUndefined();
    }
  });

  it("recusa valor zero ou negativo", () => {
    expect(criarRegistro.safeParse({ habitoId: f.habitoAgua.id, valor: 0 }).success).toBe(false);
    expect(criarRegistro.safeParse({ habitoId: f.habitoAgua.id, valor: -1 }).success).toBe(false);
  });

  it("prévia do retroativo é falsa por padrão", () => {
    const r = preencherRetroativo.safeParse({ dataLogica: "2026-11-08" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.previa).toBe(false);
  });

  it("a janela do retroativo tem exatamente 7 dias", () => {
    const curta = { ...f.retroativoFixture, dias: f.retroativoFixture.dias.slice(0, 6) };
    expect(retroativo.safeParse(curta).success).toBe(false);
  });
});

describe("auth", () => {
  it("reset de biometria exige a confirmação exata", () => {
    expect(resetarBiometria.safeParse({ confirmacao: "RESETAR BIOMETRIA" }).success).toBe(true);
    expect(resetarBiometria.safeParse({ confirmacao: "resetar biometria" }).success).toBe(false);
    expect(resetarBiometria.safeParse({}).success).toBe(false);
  });

  it("login não aceita campo de usuário", () => {
    expect(loginComSenha.safeParse({ senha: "x", usuario: "tiago" }).success).toBe(false);
  });
});

/**
 * O schema valida cada linha isoladamente, então ele não tem como reclamar de
 * uma fixture que simplesmente **não contém** o caso difícil. Estes testes são o
 * que impede o dashboard de ser desenhado sobre um payload mais fácil do que o
 * real — foi exatamente o que aconteceu: a primeira versão da fixture não tinha
 * linha de `duracao`, dava uma linha só ao hábito de dois horários, e usava um
 * hábito arquivado como a única linha de tipo negativo.
 */
describe("o dashboard carrega os casos difíceis", () => {
  it("cobre as quatro formas de progresso", () => {
    const tipos = new Set(f.hojeFixture.linhas.map((l) => l.progresso.tipo));
    expect(tipos).toEqual(new Set(["binario", "quantificado", "duracao", "negativo"]));
  });

  it("o hábito fixo de dois horários rende duas linhas, uma por ocorrência", () => {
    const doFixo = f.hojeFixture.linhas.filter((l) => l.habitoId === f.habitoVitamina.id);

    expect(doFixo).toHaveLength(2);
    expect(doFixo.map((l) => l.horario)).toEqual(["08:00:00", "20:00:00"]);
    expect(new Set(doFixo.map((l) => l.ocorrenciaId)).size).toBe(2);
    // Uma cumprida e uma pendente: é a distinção que o estado da ocorrência
    // existe para permitir, e a linha não pode ser indexada por `habitoId`.
    expect(doFixo.map((l) => l.concluida)).toEqual([true, false]);
  });

  it("a sequência é do hábito, então as duas linhas dele mostram a mesma", () => {
    const doFixo = f.hojeFixture.linhas.filter((l) => l.habitoId === f.habitoVitamina.id);
    expect(doFixo[0]?.sequencia).toBe(doFixo[1]?.sequencia);
  });

  it("não lista hábito arquivado nem pausado", () => {
    const ids = f.hojeFixture.linhas.map((l) => l.habitoId);
    expect(ids).not.toContain(f.habitoArquivado.id);
    expect(ids).not.toContain(f.habitoPausado.id);
  });

  it("toda linha corresponde a um hábito ativo da lista", () => {
    const ativos = new Set(f.listaDeHabitosFixture.habitos.map((h) => h.id));
    for (const linha of f.hojeFixture.linhas) {
      expect(ativos).toContain(linha.habitoId);
    }
  });

  it("a lista separa arquivado de ativo", () => {
    expect(f.listaDeHabitosFixture.habitos.every((h) => h.arquivadoEm === null)).toBe(true);
    expect(f.listaDeHabitosFixture.arquivados.every((h) => h.arquivadoEm !== null)).toBe(true);
  });
});

describe("o resumo reproduz a frase escrita à mão em cada fixture", () => {
  /*
   * As fixtures nasceram com `resumo` digitado por fora, antes de
   * `resumoDeConfig` existir — então elas são referência independente, e não o
   * próprio resultado da função dando a volta. Se um ajuste de texto mudar a
   * frase, estes casos apontam qual.
   */
  const todos = [...f.listaDeHabitosFixture.habitos, ...f.listaDeHabitosFixture.arquivados];

  for (const habito of todos) {
    it(`${habito.nome}: "${habito.resumo}"`, () => {
      expect(resumoDeConfig(habito.config)).toBe(habito.resumo);
    });
  }

  it("meta 1 não vira contagem", () => {
    expect(
      resumoDeConfig({
        modo: "flexivel",
        cadencia: { tipo: "semanal" },
        metaOcorrencias: 1,
        notificarEm: null,
        meta: { tipo: "binario" },
        congelamento: null,
      }),
    ).toBe("Por semana");
  });

  it("diário flexível é sempre 'Todo dia' — não existe '2x por dia'", () => {
    expect(
      resumoDeConfig({
        modo: "flexivel",
        cadencia: { tipo: "diario" },
        metaOcorrencias: 1,
        notificarEm: null,
        meta: { tipo: "binario" },
        congelamento: null,
      }),
    ).toBe("Todo dia");
  });

  it("cada_n_dias com meta acima de 1 mantém a janela na frase", () => {
    expect(
      resumoDeConfig({
        modo: "flexivel",
        cadencia: { tipo: "cada_n_dias", intervalo: 15 },
        metaOcorrencias: 2,
        notificarEm: null,
        meta: { tipo: "binario" },
        congelamento: null,
      }),
    ).toBe("2x a cada 15 dias");
  });

  it("modo fixo nos sete dias é 'todo dia', não a enumeração", () => {
    expect(
      resumoDeConfig({
        modo: "fixo",
        cadencia: { tipo: "semanal", diasSemana: [1, 2, 3, 4, 5, 6, 7], horarios: ["07:00:00"] },
        meta: { tipo: "binario" },
        congelamento: null,
      }),
    ).toBe("Todo dia às 07:00");
  });

  it("modo fixo mensal sem horário não inventa 'às'", () => {
    expect(
      resumoDeConfig({
        modo: "fixo",
        cadencia: { tipo: "mensal", diasMes: [15, 1] },
        meta: { tipo: "quantificado", valor: 30, unidade: "páginas" },
        congelamento: null,
      }),
    ).toBe("Dias 1 e 15 do mês, 30 páginas");
  });

  it("tolerância zero é 'sem recaídas'", () => {
    expect(
      resumoDeConfig({
        modo: "flexivel",
        cadencia: { tipo: "diario" },
        metaOcorrencias: 1,
        notificarEm: null,
        meta: { tipo: "negativo", tolerancia: 0 },
        congelamento: null,
      }),
    ).toBe("Todo dia, sem recaídas");
  });

  it("o texto do congelamento diz o automatismo, que é o ponto dele", () => {
    const texto = textoDeCongelamento({ aCada: 3, max: 2 });

    expect(texto).toContain("A cada 3 interações no prazo");
    expect(texto).toContain("até 2 guardados");
    expect(texto).toContain("automaticamente");
  });

  it("sem congelamento, o texto diz o que acontece ao perder", () => {
    expect(textoDeCongelamento(null)).toContain("zera a sequência");
  });
});

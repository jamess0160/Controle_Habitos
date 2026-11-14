/**
 * O worker (etapa 3.5): virada, notificações e limpeza.
 *
 * O que está sob teste é **quando** notificar, não como enviar — o envio tem
 * suíte própria em [push.test.ts](../servidor/push.test.ts) e aqui ele é
 * mockado. A decisão é a parte que a tabela do Mapa de regras define, e errá-la
 * é silencioso nos dois sentidos: um lembrete que nunca chega não avisa
 * ninguém, e um que chega a cada minuto faz a pessoa desligar o push.
 *
 * O relógio entra por parâmetro em todos os casos. Um teste de notificação com
 * o relógio real seria uma aposta no minuto em que a suíte rodou — passaria de
 * manhã e falharia à noite.
 */

const enviarMock = jest.fn();

jest.mock("web-push", () => ({
  __esModule: true,
  default: {
    sendNotification: (...args: unknown[]) => enviarMock(...args),
    WebPushError: class extends Error {
      statusCode = 500;
    },
    generateVAPIDKeys: () => ({ publicKey: "pub", privateKey: "priv" }),
  },
}));

import type { ConfigHabito, CriarHabito } from "@/contracts";
import { criarHabito as schemaCriar, exigirValido } from "@/contracts";
import { db } from "@/db/knex";
import { comoDataLogica, somarDias } from "@/dominio/calendario";
import { encerrarBanco, limpar, semearConfig } from "@/servidor/apoio-de-teste";
import { gravarConfig } from "@/servidor/config";
import {
  arquivarHabitoNoBanco,
  criarHabitoNoBanco,
  pausarHabitoNoBanco,
} from "@/servidor/habitos";
import { materializar } from "@/servidor/materializar";
import { assinarPushNoBanco } from "@/servidor/push";
import { criarRegistroNoBanco } from "@/servidor/registros";
import { hojeLogico, relogioAtual } from "@/servidor/relogio";
import { HORA_DO_RESUMO, pendentes } from "./notificacoes";
import { tique } from "./tique";

beforeEach(async () => {
  enviarMock.mockReset();
  enviarMock.mockResolvedValue(undefined);
  await limpar(db);
  await semearConfig();
  await gravarConfig({ vapid_public_key: "pub", vapid_private_key: "priv" });
});

afterAll(encerrarBanco);

// ─── Utilidades ──────────────────────────────────────────────────────────────

function flexivel(sobre: Partial<Extract<ConfigHabito, { modo: "flexivel" }>> = {}): ConfigHabito {
  return {
    modo: "flexivel",
    cadencia: { tipo: "diario" },
    metaOcorrencias: 1,
    notificarEm: null,
    meta: { tipo: "binario" },
    congelamento: null,
    ...sobre,
  } as ConfigHabito;
}

async function criar(nome: string, c: ConfigHabito) {
  const entrada: CriarHabito = exigirValido(
    schemaCriar,
    { nome, cor: "ciano", config: c },
    "hábito de teste",
  );
  return criarHabitoNoBanco(entrada);
}

async function hoje() {
  return comoDataLogica(await hojeLogico());
}

/**
 * Um instante de hoje, na hora de parede pedida.
 *
 * Construído a partir do dia lógico e não de `new Date()` com `setHours`: o
 * processo de teste pode estar em UTC, e `setHours` usaria o fuso dele.
 */
function hojeAs(dataLogica: string, hora: string): Date {
  /* -03:00 é o fuso de `semearConfig`; fixá-lo aqui é o que torna o caso legível. */
  return new Date(`${dataLogica}T${hora}:00.000-03:00`);
}

async function pendentesAs(hora: string) {
  const agora = hojeAs(await hoje(), hora);
  return pendentes({ agora, hoje: await hojeLogico(agora), relogio: await relogioAtual() });
}

async function tipos(hora: string) {
  return (await pendentesAs(hora)).map((n) => n.tipo);
}

async function envelhecer(habitoId: string, dias: number): Promise<void> {
  const antes = somarDias(await hoje(), -dias);
  await db("habito").where({ id: habitoId }).update({ inicio_em: antes });
  await db("habito_config").where({ habito_id: habitoId }).update("vigente_de", antes);
  await db.transaction((trx) => materializar(trx, habitoId));
}

// ─── Lembrete ────────────────────────────────────────────────────────────────

describe("lembrete", () => {
  it("espera a hora configurada", async () => {
    await criar("🧘 Meditar", flexivel({ notificarEm: "09:00:00" }));

    expect(await tipos("08:59")).toEqual([]);
    expect(await tipos("09:00")).toEqual(["lembrete"]);
  });

  it("continua pendente depois da hora — worker fora do ar não perde o dia", async () => {
    await criar("🧘 Meditar", flexivel({ notificarEm: "09:00:00" }));

    /*
     * Um lembrete de 09:00 entregue às 11:00 ainda serve. O que o impede de
     * virar arqueologia é o dia lógico: passou da virada, o momento morreu.
     */
    expect(await tipos("11:00")).toEqual(["lembrete"]);
  });

  it("some assim que o hábito é cumprido", async () => {
    const habito = await criar("🧘 Meditar", flexivel({ notificarEm: "09:00:00" }));
    expect(await tipos("10:00")).toEqual(["lembrete"]);

    await criarRegistroNoBanco({ habitoId: habito.id, origem: "app" });

    expect(await tipos("10:00")).toEqual([]);
  });

  it("sem `notificarEm` o hábito flexível não lembra nada", async () => {
    await criar("🧘 Meditar", flexivel());

    expect(await tipos("23:00")).toEqual([]);
  });

  it("diz quanto falta quando a meta é de várias ocorrências", async () => {
    await criar(
      "🏃 Correr",
      flexivel({ cadencia: { tipo: "semanal" }, metaOcorrencias: 3, notificarEm: "09:00:00" }),
    );

    const [lembrete] = await pendentesAs("09:30");

    expect(lembrete.conteudo.corpo).toContain("Faltam 3");
  });
});

describe("lembrete no modo fixo", () => {
  const duasDoses = (): ConfigHabito => ({
    modo: "fixo",
    cadencia: { tipo: "diario", horarios: ["08:00:00", "20:00:00"] },
    meta: { tipo: "binario" },
    congelamento: null,
  });

  it("um por momento devido, e só depois de o momento passar", async () => {
    await criar("💊 Dose", duasDoses());

    expect(await tipos("07:00")).toEqual([]);
    expect(await tipos("09:00")).toEqual(["lembrete"]);
    expect(await tipos("21:00")).toEqual(["lembrete", "lembrete"]);
  });

  it("a referência inclui o horário: as duas doses são dois avisos distintos", async () => {
    await criar("💊 Dose", duasDoses());

    const lista = await pendentesAs("21:00");
    const referencias = new Set(lista.map((n) => n.referencia));

    expect(referencias.size).toBe(2);
    /* E a tag também, senão a segunda substituiria a primeira na tela. */
    expect(new Set(lista.map((n) => n.conteudo.tag)).size).toBe(2);
  });

  it("o momento cumprido não lembra; o outro continua", async () => {
    const habito = await criar("💊 Dose", duasDoses());

    const ocorrencia = await db("habito_ocorrencia")
      .join("habito_periodo", "habito_periodo.id", "habito_ocorrencia.periodo_id")
      .where("habito_periodo.habito_id", habito.id)
      .orderBy("habito_ocorrencia.previsto_para", "asc")
      .first("habito_ocorrencia.id");

    await criarRegistroNoBanco({
      habitoId: habito.id,
      ocorrenciaId: (ocorrencia as unknown as { id: string }).id,
      origem: "app",
    });

    const lista = await pendentesAs("21:00");

    expect(lista).toHaveLength(1);
    expect(lista[0].conteudo.corpo).toContain("20:00");
  });
});

describe("lembrete em cada_n_dias", () => {
  it("só no dia do vencimento — a janela inteira seria ruído diário", async () => {
    const habito = await criar(
      "📚 Ler",
      flexivel({
        cadencia: { tipo: "cada_n_dias", intervalo: 3 },
        metaOcorrencias: 1,
        notificarEm: "09:00:00",
      }),
    );

    /* Dia 1 de uma janela de 3: ainda não vence. */
    expect(await tipos("10:00")).toEqual([]);

    await envelhecer(habito.id, 2);

    expect(await tipos("10:00")).toEqual(["lembrete"]);
  });
});

// ─── Meta em atraso ──────────────────────────────────────────────────────────

describe("meta_atraso", () => {
  const semanal = (notificarEm: string | null = null) =>
    flexivel({ cadencia: { tipo: "semanal" }, metaOcorrencias: 3, notificarEm });

  /**
   * Um hábito semanal cujo período termina hoje, no status pedido.
   *
   * As duas colunas são forçadas, e isso é deliberado: a decisão de `meta_atraso`
   * lê `fim` e `status` do período, e um cenário "natural" não dá para montar sem
   * depender do dia da semana em que a suíte roda — a janela semanal termina no
   * sábado, e um teste que só passa no sábado é pior que um teste explícito.
   *
   * Que a materialização preencha essas colunas certo é assunto de
   * [habitos.test.ts](../servidor/habitos.test.ts) e
   * [registros.test.ts](../servidor/registros.test.ts), onde o fechamento é o
   * objeto. Aqui o objeto é o que o worker faz **diante** delas.
   */
  async function terminandoHoje(
    sobre: { notificarEm?: string | null; status?: "aberto" | "cumprido" } = {},
  ) {
    const habito = await criar("🏃 Correr", semanal(sobre.notificarEm ?? null));

    const status = sobre.status ?? "aberto";

    await db("habito_periodo")
      .where({ habito_id: habito.id })
      /* `fechado_em` acompanha o status: o CHECK `habito_periodo_fechamento`
         recusa período fechado sem instante de fechamento. */
      .update({
        fim: await hoje(),
        status,
        fechado_em: status === "aberto" ? null : new Date(),
      });

    return habito;
  }

  it("avisa no último dia, mesmo sem lembrete configurado", async () => {
    await terminandoHoje();

    /*
     * É o único aviso antes de perder o período, então não pode depender de um
     * campo opcional: um hábito semanal sem lembrete perderia a semana calado.
     */
    expect(await tipos("19:59")).toEqual([]);
    expect(await tipos("20:00")).toEqual(["meta_atraso"]);
  });

  it("substitui o lembrete em vez de somar-se a ele", async () => {
    await terminandoHoje({ notificarEm: "09:00:00" });

    /* Duas notificações do mesmo hábito no mesmo minuto treinam a ignorar as duas. */
    expect(await tipos("10:00")).toEqual(["meta_atraso"]);
  });

  it("não avisa quando a meta já foi batida", async () => {
    await terminandoHoje({ status: "cumprido" });

    expect(await tipos("21:00")).toEqual([]);
  });

  it("não existe em cadência diária — o período acaba hoje todo dia", async () => {
    await criar("🧘 Meditar", flexivel({ notificarEm: "09:00:00" }));

    expect(await tipos("21:00")).toEqual(["lembrete"]);
  });
});

// ─── O que já aconteceu ──────────────────────────────────────────────────────

describe("congelamento_usado e sequencia_perdida", () => {
  /** Um hábito diário com um buraco ontem. */
  async function comBuraco(congelamento: { aCada: number; max: number } | null) {
    const habito = await criar("🏃 Correr", flexivel({ congelamento }));
    await envelhecer(habito.id, 4);

    for (const atras of [4, 3, 2]) {
      await criarRegistroNoBanco({
        habitoId: habito.id,
        dataLogica: somarDias(await hoje(), -atras),
        origem: "retroativo",
      });
    }

    return habito;
  }

  it("o congelamento gasto é anunciado, com quantos restam", async () => {
    await comBuraco({ aCada: 2, max: 3 });

    const [aviso] = await pendentesAs("09:00");

    expect(aviso.tipo).toBe("congelamento_usado");
    expect(aviso.conteudo.corpo).toMatch(/Resta[m]? \d|Não resta nenhum/);
  });

  it("a sequência perdida é anunciada com o número que caiu", async () => {
    await comBuraco(null);

    const [aviso] = await pendentesAs("09:00");

    expect(aviso.tipo).toBe("sequencia_perdida");
    expect(aviso.conteudo.corpo).toContain("3");
  });

  it("espera o dia começar: ninguém é acordado às 04:00 para saber disso", async () => {
    await comBuraco(null);

    /* A virada é às 04:00 e é nela que o período fecha — o aviso não vai junto. */
    expect(await tipos("05:00")).toEqual([]);
    expect(HORA_DO_RESUMO).toBe("08:00:00");
    expect(await tipos("08:00")).toEqual(["sequencia_perdida"]);
  });
});

// ─── Quem não recebe ─────────────────────────────────────────────────────────

describe("pausado e arquivado ficam fora", () => {
  it("hábito pausado hoje não notifica nada", async () => {
    const habito = await criar("🧘 Meditar", flexivel({ notificarEm: "09:00:00" }));
    await pausarHabitoNoBanco(habito.id, { de: await hoje(), ate: null });

    expect(await tipos("10:00")).toEqual([]);
  });

  it("hábito arquivado não notifica nada", async () => {
    const habito = await criar("🧘 Meditar", flexivel({ notificarEm: "09:00:00" }));
    await arquivarHabitoNoBanco(habito.id, true);

    expect(await tipos("10:00")).toEqual([]);
  });
});

// ─── O tique ─────────────────────────────────────────────────────────────────

describe("a virada", () => {
  it("abre o período do dia quando nenhum o cobre", async () => {
    const habito = await criar("🧘 Meditar", flexivel());
    await db("habito_periodo").where({ habito_id: habito.id }).delete();

    const relatorio = await tique();

    expect(relatorio.materializados).toBe(1);
    expect(relatorio.erros).toEqual([]);
    expect(await cobreHoje(habito.id)).toBe(true);
  });

  it("não faz nada quando o período já cobre hoje", async () => {
    await criar("🧘 Meditar", flexivel());

    expect((await tique()).materializados).toBe(0);
  });

  it("o hábito com pausa VENCIDA volta a ganhar período", async () => {
    /*
     * O defeito que o worker encontrou, e ele morde o caminho mais comum de
     * pausa: a que tem data de fim e **expira sozinha**. Ninguém chama "retomar"
     * nesse caso — `retomarHabitoNoBanco` é que limpa as colunas, e ele não roda.
     * As datas ficam no passado, e a condição antiga ("já foi pausado alguma
     * vez") fazia o hábito nunca mais materializar: ele sumia do dashboard no dia
     * seguinte ao último período, sem erro em lugar nenhum.
     */
    const habito = await criar("🧘 Meditar", flexivel());
    const ontem = somarDias(await hoje(), -1);

    await pausarHabitoNoBanco(habito.id, { de: somarDias(ontem, -5), ate: ontem });
    await db("habito_periodo").where({ habito_id: habito.id }).delete();

    expect((await tique()).materializados).toBe(1);
    expect(await cobreHoje(habito.id)).toBe(true);
  });

  it("o hábito pausado HOJE continua sem período, que é a regra da simulação", async () => {
    const habito = await criar("🧘 Meditar", flexivel());
    await pausarHabitoNoBanco(habito.id, { de: await hoje(), ate: null });
    await db("habito_periodo").where({ habito_id: habito.id }).delete();

    expect((await tique()).materializados).toBe(0);
    expect(await cobreHoje(habito.id)).toBe(false);
  });
});

async function cobreHoje(habitoId: string): Promise<boolean> {
  const hojeLogicoAtual = await hoje();
  const linha = await db("habito_periodo")
    .where({ habito_id: habitoId })
    .where("inicio", "<=", hojeLogicoAtual)
    .where("fim", ">=", hojeLogicoAtual)
    .first("id");

  return linha !== undefined;
}

describe("idempotência", () => {
  it("o mesmo evento não é notificado duas vezes", async () => {
    await criar("🧘 Meditar", flexivel({ notificarEm: "00:01:00" }));
    await assinarPushNoBanco({
      endpoint: "https://push.exemplo.dev/abc",
      chaves: { p256dh: "p", auth: "a" },
    });

    const primeiro = await tique();
    const segundo = await tique();

    expect(primeiro.notificacoes.novas).toBe(1);
    expect(primeiro.notificacoes.enviadas).toBe(1);
    expect(segundo.notificacoes.novas).toBe(0);
    expect(enviarMock).toHaveBeenCalledTimes(1);
  });

  it("a reserva é gravada antes do envio, então uma falha não vira enxurrada", async () => {
    await criar("🧘 Meditar", flexivel({ notificarEm: "00:01:00" }));
    await assinarPushNoBanco({
      endpoint: "https://push.exemplo.dev/abc",
      chaves: { p256dh: "p", auth: "a" },
    });
    enviarMock.mockRejectedValue(new Error("rede caiu"));

    const primeiro = await tique();
    const segundo = await tique();

    expect(primeiro.notificacoes).toMatchObject({ novas: 1, enviadas: 0, falhas: 1 });
    /*
     * O preço assumido: o envio falho não é tentado de novo. É a troca certa num
     * app onde a mesma informação está no dashboard — reenviar até conseguir é o
     * modo de uma queda de rede virar dez notificações iguais quando ela volta.
     */
    expect(segundo.notificacoes.novas).toBe(0);
  });

  it("sem par VAPID o tique não quebra — é estado esperado antes do deploy", async () => {
    await db("config_app").whereIn("chave", ["vapid_public_key", "vapid_private_key"]).delete();
    await criar("🧘 Meditar", flexivel({ notificarEm: "00:01:00" }));

    const relatorio = await tique();

    expect(relatorio.erros).toEqual([]);
    expect(relatorio.notificacoes.enviadas).toBe(0);
  });
});

// ─── Limpeza ─────────────────────────────────────────────────────────────────

describe("limpeza", () => {
  it("apaga tentativa de login velha e preserva a recente", async () => {
    const agora = new Date();
    const velha = new Date(agora.getTime() - 48 * 60 * 60_000);

    await db("tentativa_login").insert([
      { ip: "10.0.0.1", sucesso: false, criada_em: velha },
      { ip: "10.0.0.1", sucesso: false, criada_em: agora },
    ]);

    const relatorio = await tique(agora);

    expect(relatorio.limpezas.tentativas).toBe(1);
    expect(await db("tentativa_login").select()).toHaveLength(1);
  });

  it("apaga desafio WebAuthn vencido há muito e preserva o que ainda vale", async () => {
    const agora = new Date();

    await db("webauthn_desafio").insert([
      {
        tipo: "registro",
        desafio: Buffer.from("velho"),
        expira_em: new Date(agora.getTime() - 48 * 60 * 60_000),
      },
      {
        tipo: "registro",
        desafio: Buffer.from("novo"),
        expira_em: new Date(agora.getTime() + 5 * 60_000),
      },
    ]);

    const relatorio = await tique(agora);

    expect(relatorio.limpezas.desafios).toBe(1);
    const restantes = await db("webauthn_desafio").select("desafio");
    expect(restantes.map((l) => l.desafio.toString())).toEqual(["novo"]);
  });

  it("a folga sobre a janela de bloqueio é larga: 15 minutos não são apagados", async () => {
    const agora = new Date();

    await db("tentativa_login").insert({
      ip: "10.0.0.1",
      sucesso: false,
      criada_em: new Date(agora.getTime() - 20 * 60_000),
    });

    /* Apagar perto do limite liberaria um bloqueio antes da hora. */
    expect((await tique(agora)).limpezas.tentativas).toBe(0);
  });
});

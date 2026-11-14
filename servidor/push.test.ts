/**
 * Web Push: assinatura, envio e baixa (etapa 3.5).
 *
 * O envio é mockado — o que está sob teste é a **reação** ao que o serviço de
 * push responde, e é aí que mora o risco: um 410 tratado como falha comum faria
 * o worker insistir para sempre num endpoint morto, e um 500 tratado como morte
 * desligaria o push por causa de uma instabilidade de dez segundos.
 */

const enviarMock = jest.fn();

/*
 * A classe de erro é definida dentro da factory: `jest.mock` é içado acima das
 * declarações do módulo, e uma referência a um `const` de fora cairia em TDZ.
 */
jest.mock("web-push", () => {
  class WebPushError extends Error {
    constructor(
      mensagem: string,
      readonly statusCode: number,
    ) {
      super(mensagem);
    }
  }

  return {
    __esModule: true,
    default: {
      sendNotification: (...args: unknown[]) => enviarMock(...args),
      WebPushError,
      generateVAPIDKeys: () => ({ publicKey: "pub", privateKey: "priv" }),
    },
  };
});

import webpush from "web-push";
import { db } from "@/db/knex";
import { gravarConfig } from "./config";
import { encerrarBanco, limpar, semearConfig } from "./apoio-de-teste";
import {
  SemVapid,
  assinarPushNoBanco,
  credenciaisDe,
  desassinarPush,
  enviarPush,
  statusDePush,
} from "./push";

const { WebPushError } = webpush as unknown as {
  WebPushError: new (mensagem: string, statusCode: number) => Error & { statusCode: number };
};

const ASSINATURA = {
  endpoint: "https://push.exemplo.dev/abc",
  chaves: { p256dh: "chave-p256dh", auth: "chave-auth" },
};

beforeEach(async () => {
  enviarMock.mockReset();
  enviarMock.mockResolvedValue(undefined);
  await limpar(db);
  await semearConfig();
  await gravarConfig({ vapid_public_key: "chave-publica", vapid_private_key: "chave-privada" });
});

afterAll(encerrarBanco);

// ─── Assinatura ──────────────────────────────────────────────────────────────

describe("assinar", () => {
  it("grava e o status passa a dizer que está assinado", async () => {
    const status = await assinarPushNoBanco(ASSINATURA);

    expect(status).toMatchObject({
      assinado: true,
      ultimoEnvioEm: null,
      invalidaEm: null,
      chavePublica: "chave-publica",
    });
  });

  it("reassinar o mesmo endpoint atualiza as chaves em vez de duplicar", async () => {
    await assinarPushNoBanco(ASSINATURA);
    await assinarPushNoBanco({
      ...ASSINATURA,
      chaves: { p256dh: "nova-p256dh", auth: "nova-auth" },
    });

    const linhas = await db("push_subscription").select("p256dh", "auth");

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ p256dh: "nova-p256dh", auth: "nova-auth" });
  });

  it("reassinar ressuscita uma assinatura que tinha sido baixada", async () => {
    await assinarPushNoBanco(ASSINATURA);
    await db("push_subscription").update({ invalida_em: new Date() });
    expect((await statusDePush()).assinado).toBe(false);

    const status = await assinarPushNoBanco(ASSINATURA);

    /* É o que o usuário quis dizer ao tocar "Assinar" depois de uma baixa. */
    expect(status).toMatchObject({ assinado: true, invalidaEm: null });
  });

  it("desassinar apaga", async () => {
    await assinarPushNoBanco(ASSINATURA);

    const status = await desassinarPush();

    expect(status.assinado).toBe(false);
    expect(await db("push_subscription").select()).toHaveLength(0);
  });

  it("o status traz a chave pública mesmo sem assinatura — é o que destrava o botão", async () => {
    expect(await statusDePush()).toMatchObject({ assinado: false, chavePublica: "chave-publica" });
  });
});

// ─── Credenciais ─────────────────────────────────────────────────────────────

describe("credenciais", () => {
  it("sem par VAPID é condição esperada, com erro próprio", async () => {
    await db("config_app").whereIn("chave", ["vapid_public_key", "vapid_private_key"]).delete();

    await expect(enviarPush(conteudo())).rejects.toThrow(SemVapid);
  });

  it("sem `vapid_subject` o contato é o domínio do app, nunca um e-mail inventado", () => {
    const credenciais = credenciaisDe({
      vapid_public_key: "pub",
      vapid_private_key: "priv",
      vapid_subject: null,
      rp_id: "habitos.exemplo.dev",
    } as never);

    expect(credenciais.subject).toBe("https://habitos.exemplo.dev");
  });

  it("`vapid_subject` configurado tem precedência", () => {
    const credenciais = credenciaisDe({
      vapid_public_key: "pub",
      vapid_private_key: "priv",
      vapid_subject: "mailto:eu@exemplo.dev",
      rp_id: "habitos.exemplo.dev",
    } as never);

    expect(credenciais.subject).toBe("mailto:eu@exemplo.dev");
  });
});

// ─── Envio ───────────────────────────────────────────────────────────────────

describe("enviar", () => {
  it("entrega e marca o último envio — o sinal de que o push funciona de verdade", async () => {
    await assinarPushNoBanco(ASSINATURA);

    const resultado = await enviarPush(conteudo());

    expect(resultado).toEqual({ enviadas: 1, baixadas: 0, falhas: 0 });
    expect((await statusDePush()).ultimoEnvioEm).not.toBeNull();

    const [assinatura, payload] = enviarMock.mock.calls[0];
    expect(assinatura).toMatchObject({ endpoint: ASSINATURA.endpoint });
    expect(JSON.parse(payload as string)).toMatchObject({ titulo: "Título", url: "/" });
  });

  it("410 dá baixa na assinatura, e ela para de receber", async () => {
    await assinarPushNoBanco(ASSINATURA);
    enviarMock.mockRejectedValue(new WebPushError("gone", 410));

    const primeiro = await enviarPush(conteudo());
    expect(primeiro).toEqual({ enviadas: 0, baixadas: 1, falhas: 0 });

    /* Baixada, não apagada: a tela precisa distinguir desligado de quebrado. */
    const status = await statusDePush();
    expect(status.assinado).toBe(false);
    expect(status.invalidaEm).not.toBeNull();

    enviarMock.mockClear();
    const segundo = await enviarPush(conteudo());

    expect(segundo).toEqual({ enviadas: 0, baixadas: 0, falhas: 0 });
    expect(enviarMock).not.toHaveBeenCalled();
  });

  it("404 também é endpoint morto", async () => {
    await assinarPushNoBanco(ASSINATURA);
    enviarMock.mockRejectedValue(new WebPushError("not found", 404));

    expect(await enviarPush(conteudo())).toEqual({ enviadas: 0, baixadas: 1, falhas: 0 });
  });

  it("500 é falha passageira: conta como falha e a assinatura continua viva", async () => {
    await assinarPushNoBanco(ASSINATURA);
    enviarMock.mockRejectedValue(new WebPushError("indisponível", 500));

    expect(await enviarPush(conteudo())).toEqual({ enviadas: 0, baixadas: 0, falhas: 1 });
    expect((await statusDePush()).assinado).toBe(true);
  });

  it("erro de rede não derruba o envio nem a assinatura", async () => {
    await assinarPushNoBanco(ASSINATURA);
    enviarMock.mockRejectedValue(new Error("ECONNRESET"));

    /*
     * Lançar aqui derrubaria o tique inteiro do worker — o fechamento de período
     * iria junto, e ele é a parte que não pode parar por causa da rede.
     */
    expect(await enviarPush(conteudo())).toEqual({ enviadas: 0, baixadas: 0, falhas: 1 });
    expect((await statusDePush()).assinado).toBe(true);
  });

  it("uma assinatura morta não impede a entrega nas outras", async () => {
    await assinarPushNoBanco(ASSINATURA);
    await assinarPushNoBanco({ ...ASSINATURA, endpoint: "https://push.exemplo.dev/xyz" });

    enviarMock
      .mockRejectedValueOnce(new WebPushError("gone", 410))
      .mockResolvedValueOnce(undefined);

    expect(await enviarPush(conteudo())).toEqual({ enviadas: 1, baixadas: 1, falhas: 0 });
  });
});

function conteudo() {
  return { titulo: "Título", corpo: "Corpo", url: "/", tag: "teste" };
}

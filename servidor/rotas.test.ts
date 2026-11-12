/**
 * Testes de fiação dos stubs.
 *
 * Não testam lógica — não há nenhuma. Testam as três coisas que um stub pode
 * errar e que só apareceriam na etapa 2, depois de a tela já estar construída
 * em cima: a resposta bate com o schema do contrato, o portão fecha, e a
 * validação de entrada está realmente ligada em cada rota que escreve.
 */

import { NextRequest } from "next/server";

/*
 * O jar fica dentro da factory porque `jest.mock` é hoisted acima das
 * declarações do módulo: uma referência a um `const` de fora cairia em TDZ
 * quando o primeiro import de `next/headers` disparasse a factory.
 */
jest.mock("next/headers", () => {
  const jar = new Map<string, string>();
  return {
    jar,
    cookies: async () => ({
      get: (nome: string) =>
        jar.has(nome) ? { name: nome, value: jar.get(nome) as string } : undefined,
      set: (opcoes: { name: string; value: string }) => jar.set(opcoes.name, opcoes.value),
      delete: (nome: string) => jar.delete(nome),
    }),
  };
});

const { jar } = jest.requireMock<{ jar: Map<string, string> }>("next/headers");

import {
  configApp,
  estadoAuth,
  exigirValido,
  exportacao,
  habito,
  hoje,
  listaDeHabitos,
  loginConcluido,
  passkeyCadastrada,
  registroCriado,
  registroRemovido,
  retroativo,
  retroativoAplicado,
  statusPush,
  type RespostaErro,
} from "@/contracts";
import * as f from "@/contracts/fixtures";
import { proxy } from "@/proxy";
import { COOKIE_SESSAO, lerSessao } from "./cookie-sessao";

import { GET as authEstado } from "@/app/api/auth/estado/route";
import { POST as authLogout } from "@/app/api/auth/logout/route";
import { POST as authSenha } from "@/app/api/auth/senha/route";
import { POST as authReset } from "@/app/api/auth/biometria/reset/route";
import { POST as authRegistro } from "@/app/api/auth/webauthn/registro/route";
import { POST as authRegistroOpcoes } from "@/app/api/auth/webauthn/registro/opcoes/route";
import { GET as configGet, PATCH as configPatch } from "@/app/api/config/route";
import { GET as exportar } from "@/app/api/exportar/route";
import { GET as habitosGet, POST as habitosPost } from "@/app/api/habitos/route";
import { PUT as habitosOrdem } from "@/app/api/habitos/ordem/route";
import { GET as habitoGet, PATCH as habitoPatch } from "@/app/api/habitos/[id]/route";
import { POST as pausaPost } from "@/app/api/habitos/[id]/pausa/route";
import { POST as arquivoPost } from "@/app/api/habitos/[id]/arquivo/route";
import {
  GET as retroativoGet,
  POST as retroativoPost,
} from "@/app/api/habitos/[id]/retroativo/route";
import { GET as hojeGet } from "@/app/api/hoje/route";
import { POST as pushAssinatura } from "@/app/api/push/assinatura/route";
import { POST as registrosPost } from "@/app/api/registros/route";
import { DELETE as registroDelete } from "@/app/api/registros/[id]/route";

// ─── Utilidades ──────────────────────────────────────────────────────────────

const ID = f.habitoAgua.id;

function autenticar(temPasskey: boolean) {
  jar.set(COOKIE_SESSAO, temPasskey ? "stub-com-passkey" : "stub-sem-passkey");
}

function post(corpo: unknown): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

function pagina(caminho: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${caminho}`, {
    headers: cookie === undefined ? {} : { cookie: `${COOKIE_SESSAO}=${cookie}` },
  });
}

const ctxId = { params: Promise.resolve({ id: ID }) };

function novoHabito() {
  return { nome: "💧 Água", cor: "ciano", config: f.habitoAgua.config };
}

beforeEach(() => {
  jar.clear();
});

// ─── Cookie de sessão ────────────────────────────────────────────────────────

describe("lerSessao", () => {
  it("sem cookie não há sessão", () => {
    expect(lerSessao(undefined)).toBeNull();
  });

  it("valor desconhecido não vira sessão", () => {
    // Importa porque o stub acredita no cookie: o conjunto aceito é fechado.
    expect(lerSessao("qualquer-coisa")).toBeNull();
  });

  it("distingue a sessão do primeiro acesso da sessão completa", () => {
    expect(lerSessao("stub-sem-passkey")).toEqual({ token: "stub-sem-passkey", temPasskey: false });
    expect(lerSessao("stub-com-passkey")?.temPasskey).toBe(true);
  });
});

// ─── Guarda de navegação ─────────────────────────────────────────────────────

describe("proxy", () => {
  const destino = (res: Response) => new URL(res.headers.get("location") ?? "http://x/").pathname;
  const redirecionou = (res: Response) => res.headers.get("location") !== null;

  it("sem sessão, só o login existe", () => {
    expect(destino(proxy(pagina("/")))).toBe("/login");
    expect(destino(proxy(pagina("/habitos")))).toBe("/login");
    expect(destino(proxy(pagina("/ajustes")))).toBe("/login");
    expect(redirecionou(proxy(pagina("/login")))).toBe(false);
  });

  it("com sessão e sem passkey, só o cadastro de biometria existe", () => {
    // O "não existe estado intermediário utilizável" do mapa de autenticação.
    expect(destino(proxy(pagina("/", "stub-sem-passkey")))).toBe("/biometria");
    expect(destino(proxy(pagina("/ajustes", "stub-sem-passkey")))).toBe("/biometria");
    expect(destino(proxy(pagina("/login", "stub-sem-passkey")))).toBe("/biometria");
    expect(redirecionou(proxy(pagina("/biometria", "stub-sem-passkey")))).toBe(false);
  });

  it("com passkey, ninguém fica preso no login", () => {
    expect(destino(proxy(pagina("/login", "stub-com-passkey")))).toBe("/");
    expect(destino(proxy(pagina("/biometria", "stub-com-passkey")))).toBe("/");
    expect(redirecionou(proxy(pagina("/habitos", "stub-com-passkey")))).toBe(false);
  });

  it("cookie inválido é tratado como ausência de sessão", () => {
    expect(destino(proxy(pagina("/", "lixo")))).toBe("/login");
  });
});

// ─── Portão das rotas ────────────────────────────────────────────────────────

describe("portão", () => {
  const rotas: Array<[string, () => Promise<Response>]> = [
    ["GET /api/hoje", () => hojeGet()],
    ["GET /api/habitos", () => habitosGet()],
    ["POST /api/habitos", () => habitosPost(post({}))],
    ["PUT /api/habitos/ordem", () => habitosOrdem(post({}))],
    ["GET /api/habitos/:id", () => habitoGet(post({}), ctxId)],
    ["GET /api/habitos/:id/retroativo", () => retroativoGet(post({}), ctxId)],
    ["POST /api/registros", () => registrosPost(post({}))],
    ["DELETE /api/registros/:id", () => registroDelete(post({}), ctxId)],
    ["GET /api/config", () => configGet()],
    ["GET /api/exportar", () => exportar()],
    ["POST /api/push/assinatura", () => pushAssinatura(post({}))],
    ["POST /api/auth/biometria/reset", () => authReset(post({}))],
  ];

  it.each(rotas)("%s responde 401 sem sessão", async (_nome, chamar) => {
    const res = await chamar();
    expect(res.status).toBe(401);
    const corpo: RespostaErro = await res.json();
    expect(corpo.erro.codigo).toBe("nao_autenticado");
  });

  it.each(rotas)("%s responde 409 na sessão sem passkey", async (_nome, chamar) => {
    // A guarda do proxy só vale para telas; sem este portão, um fetch operaria
    // o app inteiro a partir da sessão provisória do primeiro acesso.
    autenticar(false);
    const res = await chamar();
    expect(res.status).toBe(409);
    const corpo: RespostaErro = await res.json();
    expect(corpo.erro.codigo).toBe("conflito");
  });

  it("as rotas do cadastro de biometria aceitam a sessão sem passkey", async () => {
    autenticar(false);
    expect((await authRegistroOpcoes()).status).toBe(200);
  });

  it("logout não exige sessão — sair sem estar dentro é idempotente", async () => {
    expect((await authLogout()).status).toBe(200);
  });
});

// ─── Respostas contra os schemas ─────────────────────────────────────────────

describe("todo stub responde o que o contrato promete", () => {
  beforeEach(() => autenticar(true));

  const casos: Array<[string, Parameters<typeof exigirValido>[0], () => Promise<Response>]> = [
    ["GET /api/hoje", hoje, () => hojeGet()],
    ["GET /api/habitos", listaDeHabitos, () => habitosGet()],
    ["POST /api/habitos", habito, () => habitosPost(post(novoHabito()))],
    ["GET /api/habitos/:id", habito, () => habitoGet(post({}), ctxId)],
    ["PATCH /api/habitos/:id", habito, () => habitoPatch(post({ nome: "💧 Filtrada" }), ctxId)],
    ["PUT /api/habitos/ordem", listaDeHabitos, () => habitosOrdem(post({ ordem: [ID] }))],
    [
      "POST /api/habitos/:id/pausa",
      habito,
      () => pausaPost(post({ de: "2026-11-11", ate: null }), ctxId),
    ],
    ["POST /api/habitos/:id/arquivo", habito, () => arquivoPost(post({}), ctxId)],
    ["GET /api/habitos/:id/retroativo", retroativo, () => retroativoGet(post({}), ctxId)],
    [
      "POST /api/habitos/:id/retroativo",
      retroativoAplicado,
      () => retroativoPost(post({ dataLogica: "2026-11-09" }), ctxId),
    ],
    ["POST /api/registros", registroCriado, () => registrosPost(post({ habitoId: ID, valor: 700 }))],
    ["DELETE /api/registros/:id", registroRemovido, () => registroDelete(post({}), ctxId)],
    ["GET /api/config", configApp, () => configGet()],
    ["PATCH /api/config", configApp, () => configPatch(post({ horaVirada: "05:00:00" }))],
    ["GET /api/exportar", exportacao, () => exportar()],
    [
      "POST /api/push/assinatura",
      statusPush,
      () =>
        pushAssinatura(
          post({
            endpoint: "https://push.exemplo.dev/abc",
            chaves: { p256dh: "chave", auth: "auth" },
          }),
        ),
    ],
    ["GET /api/auth/estado", estadoAuth, () => authEstado()],
  ];

  it.each(casos)("%s", async (nome, schema, chamar) => {
    const res = await chamar();
    expect(res.status).toBeLessThan(300);
    exigirValido(schema, await res.json(), nome);
  });

  it("a exportação sai como arquivo para baixar", async () => {
    const res = await exportar();
    expect(res.headers.get("content-disposition")).toContain("attachment");
  });
});

// ─── Validação de entrada ────────────────────────────────────────────────────

describe("validação ligada nas rotas que escrevem", () => {
  beforeEach(() => autenticar(true));

  it("recusa configuração que os CHECKs do banco recusariam", async () => {
    const res = await habitosPost(
      post({
        nome: "📚 Ler",
        cor: "roxo",
        config: {
          modo: "fixo",
          cadencia: { tipo: "cada_n_dias", intervalo: 3 },
          meta: { tipo: "binario" },
          congelamento: null,
        },
      }),
    );

    expect(res.status).toBe(422);
    const corpo: RespostaErro = await res.json();
    expect(corpo.erro.codigo).toBe("validacao");
    expect(corpo.erro.campos?.length).toBeGreaterThan(0);
  });

  it("aponta o campo errado em pt-BR", async () => {
    const res = await habitosPost(post({ ...novoHabito(), nome: "" }));
    const corpo: RespostaErro = await res.json();

    expect(corpo.erro.campos).toEqual([
      { campo: "nome", mensagem: "O nome não pode ficar vazio." },
    ]);
  });

  it("recusa chave desconhecida em vez de ignorar", async () => {
    const res = await habitosPost(post({ ...novoHabito(), icone: "💧" }));
    expect(res.status).toBe(422);
  });

  it("JSON malformado é 422, não 500", async () => {
    const res = await registrosPost(
      new Request("http://localhost/api/registros", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{isto nao e json",
      }),
    );

    expect(res.status).toBe(422);
    const corpo: RespostaErro = await res.json();
    expect(corpo.erro.codigo).toBe("validacao");
  });

  it("PATCH não aceita meta de outro tipo — o tipo do hábito é imutável", async () => {
    const res = await habitoPatch(
      post({
        config: {
          modo: "flexivel",
          cadencia: { tipo: "diario" },
          metaOcorrencias: 1,
          notificarEm: null,
          meta: { tipo: "duracao", minutos: 20 },
          congelamento: null,
        },
      }),
      ctxId,
    );

    expect(res.status).toBe(422);
  });

  it("a prévia do retroativo não persiste, e a confirmação persiste", async () => {
    const previa = await retroativoPost(post({ dataLogica: "2026-11-09", previa: true }), ctxId);
    expect((await previa.json()).persistido).toBe(false);

    const confirmado = await retroativoPost(post({ dataLogica: "2026-11-09" }), ctxId);
    expect((await confirmado.json()).persistido).toBe(true);
  });

  it("o reset de biometria exige a confirmação digitada", async () => {
    expect((await authReset(post({ confirmacao: "resetar" }))).status).toBe(422);

    autenticar(true);
    expect((await authReset(post({ confirmacao: "RESETAR BIOMETRIA" }))).status).toBe(200);
  });
});

// ─── Fluxo de sessão ─────────────────────────────────────────────────────────

describe("o cookie percorre o fluxo de primeiro acesso", () => {
  it("senha abre sessão sem passkey, o cadastro a completa, o logout a encerra", async () => {
    const login = await authSenha(post({ senha: "qualquer" }));
    expect(exigirValido(loginConcluido, await login.json(), "login").proximoPasso).toBe(
      "cadastrar_biometria",
    );
    expect(lerSessao(jar.get(COOKIE_SESSAO))?.temPasskey).toBe(false);

    const antes = exigirValido(estadoAuth, await (await authEstado()).json(), "estado");
    expect(antes).toMatchObject({ autenticado: true, temPasskey: false, senhaAtiva: true });

    const cadastro = await authRegistro(post({ credencial: { id: "c1", type: "public-key" } }));
    expect(cadastro.status).toBe(201);
    exigirValido(passkeyCadastrada, await cadastro.json(), "passkey");
    expect(lerSessao(jar.get(COOKIE_SESSAO))?.temPasskey).toBe(true);

    const depois = exigirValido(estadoAuth, await (await authEstado()).json(), "estado");
    expect(depois).toMatchObject({ autenticado: true, temPasskey: true, senhaAtiva: false });

    await authLogout();
    expect(lerSessao(jar.get(COOKIE_SESSAO))).toBeNull();
  });

  it("o reset de biometria derruba a própria sessão", async () => {
    // Coerente com a revogação em massa: deixar o cookie de pé contradiria o
    // que a rota acabou de fazer no banco.
    autenticar(true);

    await authReset(post({ confirmacao: "RESETAR BIOMETRIA" }));
    expect(lerSessao(jar.get(COOKIE_SESSAO))).toBeNull();
  });
});

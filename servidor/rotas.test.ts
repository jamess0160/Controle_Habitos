/**
 * Fiação das rotas: schema, portão, validação de entrada e o matcher do proxy.
 *
 * Testam as três coisas que uma rota pode errar sem que nenhum teste de domínio
 * perceba: a resposta não bate com o schema do contrato, o portão não fecha, a
 * validação de entrada não está ligada.
 *
 * Autenticação (3.1), hábitos (3.2), registro (3.3) e retroativo (3.4) já são
 * reais e têm suíte própria — [autenticacao.test.ts](autenticacao.test.ts),
 * [habitos.test.ts](habitos.test.ts), [registros.test.ts](registros.test.ts) e
 * [retroativo.test.ts](retroativo.test.ts). O que sobra de fixture aqui é o push
 * e a exportação, que são as etapas 3.5 e a onda 2; para essas, a conformidade
 * com o contrato é o que garante que a tela construída em cima do stub continue
 * valendo quando o stub sair.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  criarHabito,
  estadoAuth,
  exigirValido,
  exportacao,
  habito,
  habitoApagado,
  historicoDoHabito,
  hoje,
  listaDeHabitos,
  retroativo,
  retroativoAplicado,
  statusPush,
  type RespostaErro,
} from "@/contracts";
import * as f from "@/contracts/fixtures";
import { db } from "@/db/knex";
import { proxy } from "@/proxy";
import {
  abrirSessaoDeTeste,
  encerrarBanco,
  limpar,
  semearConfig,
  semearPasskey,
} from "./apoio-de-teste";
import { COOKIE_SESSAO } from "./cookie-sessao";
import { criarHabitoNoBanco } from "./habitos";
import { hojeLogico } from "./relogio";

import { GET as authEstado } from "@/app/api/auth/estado/route";
import { POST as authRegistroOpcoes } from "@/app/api/auth/webauthn/registro/opcoes/route";
import { GET as configGet, PATCH as configPatch } from "@/app/api/config/route";
import { GET as exportar } from "@/app/api/exportar/route";
import { GET as habitosGet, POST as habitosPost } from "@/app/api/habitos/route";
import { PUT as habitosOrdem } from "@/app/api/habitos/ordem/route";
import {
  DELETE as habitoDelete,
  GET as habitoGet,
  PATCH as habitoPatch,
} from "@/app/api/habitos/[id]/route";
import { GET as historicoGet } from "@/app/api/habitos/[id]/historico/route";
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

/**
 * Id de um hábito que **não existe**, para os casos de 404 e para o portão.
 *
 * As rotas de hábito consultam o banco desde a 3.2, então o id de uma fixture
 * não serve mais como "um hábito qualquer": ele serve como "um hábito ausente".
 * Quem precisa de hábito existente chama `comHabito()`.
 */
const ID = f.habitoAgua.id;

/** Cria um hábito de verdade e devolve o id. */
async function comHabito(): Promise<string> {
  const habito = await criarHabitoNoBanco(
    exigirValido(
      criarHabito,
      { nome: f.habitoAgua.nome, cor: f.habitoAgua.cor, config: f.habitoAgua.config },
      "hábito de teste",
    ),
  );
  return habito.id;
}

/**
 * Autentica de verdade: grava a sessão (e a passkey, quando pedida) no banco.
 *
 * Virou `async` na etapa 3.1 e isso é o próprio ponto — não há mais valor de
 * cookie que se acredite sozinho. O que o cookie carrega é a dica de navegação;
 * quem decide é a linha em `sessao` mais a existência de `credencial_passkey`.
 */
async function autenticar(temPasskey: boolean) {
  if (temPasskey) await semearPasskey();
  jar.set(COOKIE_SESSAO, await abrirSessaoDeTeste(temPasskey ? "completa" : "provisoria"));
}

function post(corpo: unknown): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    /* `origin` porque as rotas de WebAuthn o conferem contra o `rp_id` gravado. */
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(corpo),
  });
}

function pagina(caminho: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${caminho}`, {
    headers: cookie === undefined ? {} : { cookie: `${COOKIE_SESSAO}=${cookie}` },
  });
}

const ctxId = { params: Promise.resolve({ id: ID }) };

function ctxDe(id: string) {
  return { params: Promise.resolve({ id }) };
}

/**
 * Hoje pelo relógio **lógico** do servidor, não por `new Date()`.
 *
 * A pausa e o retroativo trabalham em dia lógico, e entre as 21:00 e a meia-noite
 * de São Paulo o `toISOString()` já está no dia seguinte — a data viraria futuro
 * e a rota recusaria com razão. É a armadilha nº 1 alcançando o próprio teste.
 */
async function hojeDeTeste(): Promise<string> {
  return hojeLogico();
}

/* Dicas de cookie para os testes do proxy, que não tocam o banco. */
const PROVISORIA = "token-de-teste.provisoria";
const COMPLETA = "token-de-teste.completa";

function novoHabito() {
  return { nome: "💧 Água", cor: "ciano", config: f.habitoAgua.config };
}

/**
 * Banco limpo e `APP_MODO` fixado em produção a cada caso.
 *
 * O pino do modo não é cerimônia: `next/jest` carrega o `.env` do projeto, onde
 * a chave vale `desenvolvimento` — sem ele, a suíte testaria o ambiente da
 * máquina de quem roda e o portão passaria ou falharia conforme o arquivo local.
 * Quem quer o modo frouxo o liga explicitamente.
 */
beforeEach(async () => {
  jar.clear();
  await limpar(db);
  process.env.APP_MODO = "producao";
  await semearConfig();
});

afterAll(encerrarBanco);

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

  it("com dica provisória, só o cadastro de biometria existe", () => {
    // O "não existe estado intermediário utilizável" do mapa de autenticação.
    expect(destino(proxy(pagina("/", PROVISORIA)))).toBe("/biometria");
    expect(destino(proxy(pagina("/ajustes", PROVISORIA)))).toBe("/biometria");
    expect(destino(proxy(pagina("/login", PROVISORIA)))).toBe("/biometria");
    expect(redirecionou(proxy(pagina("/biometria", PROVISORIA)))).toBe(false);
  });

  it("com dica completa, ninguém fica preso no login", () => {
    expect(destino(proxy(pagina("/login", COMPLETA)))).toBe("/");
    expect(destino(proxy(pagina("/biometria", COMPLETA)))).toBe("/");
    expect(redirecionou(proxy(pagina("/habitos", COMPLETA)))).toBe(false);
  });

  it("em desenvolvimento o cadastro de biometria continua alcançável", () => {
    /*
     * Lá a senha abre sessão completa, então sem esta exceção a tela de
     * biometria — uma das sete telas — não teria como ser aberta. O login segue
     * redirecionando: quem tem sessão está dentro.
     */
    process.env.APP_MODO = "desenvolvimento";

    expect(redirecionou(proxy(pagina("/biometria", COMPLETA)))).toBe(false);
    expect(destino(proxy(pagina("/login", COMPLETA)))).toBe("/");
  });

  it("cookie de formato desconhecido é ausência de sessão", () => {
    /*
     * Inclui o formato do stub da etapa 2: um cookie antigo guardado no
     * navegador tem de cair no login, não virar sessão de estado inventado.
     */
    expect(destino(proxy(pagina("/", "lixo")))).toBe("/login");
    expect(destino(proxy(pagina("/", "stub-com-passkey")))).toBe("/login");
    expect(destino(proxy(pagina("/", "token-sem-sufixo.")))).toBe("/login");
  });

  it("o proxy não consulta banco: a dica basta para ele, e não autoriza nada", () => {
    /*
     * Nenhuma sessão existe no banco neste caso, e o proxy ainda assim deixa
     * passar — é a verificação otimista que a documentação do Next recomenda. A
     * recusa vem de `exigirAcesso()`, coberta logo abaixo.
     */
    expect(redirecionou(proxy(pagina("/habitos", COMPLETA)))).toBe(false);
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
    await autenticar(false);
    const res = await chamar();
    expect(res.status).toBe(409);
    const corpo: RespostaErro = await res.json();
    expect(corpo.erro.codigo).toBe("conflito");
  });

  it("as rotas do cadastro de biometria aceitam a sessão sem passkey", async () => {
    await autenticar(false);
    expect((await authRegistroOpcoes(post({}))).status).toBe(200);
  });
});

// ─── Respostas contra os schemas ─────────────────────────────────────────────

describe("todo stub responde o que o contrato promete", () => {
  beforeEach(async () => autenticar(true));

  /*
   * Os casos que operam **um** hábito recebem o id por parâmetro: desde a 3.2 as
   * rotas de hábito consultam o banco, e um id de fixture agora responde 404 —
   * corretamente.
   */
  const casos: Array<
    [string, Parameters<typeof exigirValido>[0], (id: string) => Promise<Response>]
  > = [
    ["GET /api/hoje", hoje, () => hojeGet()],
    ["GET /api/habitos", listaDeHabitos, () => habitosGet()],
    ["POST /api/habitos", habito, () => habitosPost(post(novoHabito()))],
    ["GET /api/habitos/:id", habito, (id) => habitoGet(post({}), ctxDe(id))],
    [
      "PATCH /api/habitos/:id",
      habito,
      (id) => habitoPatch(post({ nome: "💧 Filtrada" }), ctxDe(id)),
    ],
    ["PUT /api/habitos/ordem", listaDeHabitos, (id) => habitosOrdem(post({ ordem: [id] }))],
    [
      "POST /api/habitos/:id/pausa",
      habito,
      async (id) => pausaPost(post({ de: await hojeDeTeste(), ate: null }), ctxDe(id)),
    ],
    ["POST /api/habitos/:id/arquivo", habito, (id) => arquivoPost(post({}), ctxDe(id))],
    [
      "GET /api/habitos/:id/historico",
      historicoDoHabito,
      (id) => historicoGet(post({}), ctxDe(id)),
    ],
    [
      "DELETE /api/habitos/:id",
      habitoApagado,
      /*
       * Arquiva antes, porque a exclusão só aceita hábito arquivado — os dois
       * passos são a proteção, não um detalhe do teste. O caso de recusa do
       * hábito ativo está em [habitos.test.ts](habitos.test.ts).
       */
      async (id) => {
        await arquivoPost(post({}), ctxDe(id));
        return habitoDelete(post({}), ctxDe(id));
      },
    ],
    ["GET /api/habitos/:id/retroativo", retroativo, (id) => retroativoGet(post({}), ctxDe(id))],
    [
      "POST /api/habitos/:id/retroativo",
      retroativoAplicado,
      /*
       * Hoje, e não uma data fixa: o hábito é criado agora, então qualquer dia
       * anterior cai antes do `inicio_em` e não tem período onde pendurar o
       * registro. Os casos de janela moram em [retroativo.test.ts](retroativo.test.ts),
       * que envelhece o hábito para poder preencher o passado.
       */
      async (id) => retroativoPost(post({ dataLogica: await hojeDeTeste() }), ctxDe(id)),
    ],
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
    ["GET /api/auth/estado", estadoAuth, () => authEstado(new Request("http://localhost/api"))],
  ];

  it.each(casos)("%s", async (nome, schema, chamar) => {
    const res = await chamar(await comHabito());
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
  beforeEach(async () => autenticar(true));

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
    /*
     * O tipo vem do **banco**, não do payload: a rota carrega o hábito, monta
     * `editarHabito(tipo)` com o tipo gravado e aí valida. O 422 é do contrato,
     * antes de a FK composta `(habito_id, tipo)` ter chance de reclamar.
     */
    const id = await comHabito();

    const res = await habitoPatch(
      post({
        config: {
          modo: "flexivel",
          cadencia: { tipo: "diario" },
          metaOcorrencias: 1,
          notificarEm: null,
          meta: { tipo: "duracao", segundos: 1_200 },
          congelamento: null,
        },
      }),
      ctxDe(id),
    );

    expect(res.status).toBe(422);
  });

  it("hábito inexistente é 404, não 500", async () => {
    const res = await habitoGet(post({}), ctxId);
    expect(res.status).toBe(404);
    const corpo: RespostaErro = await res.json();
    expect(corpo.erro.codigo).toBe("nao_encontrado");
  });

});

/**
 * O matcher do proxy, lido do próprio arquivo.
 *
 * Esta é a única parte da guarda que os testes acima **não** alcançam: eles
 * chamam `proxy()` direto, e o matcher é config consumida pelo Next antes de a
 * função rodar. Foi por ali que passou um bug real — o `/sw.js` recebia 307 para
 * `/login`, e sem registrar o service worker a PWA não instala.
 *
 * O padrão é lido do [proxy.ts](../proxy.ts) em vez de copiado porque o Next
 * exige literal no `config.matcher` (variável é ignorada), e uma segunda cópia
 * aqui divergiria em silêncio. A comparação usa `RegExp` nativa, que aproxima o
 * path-to-regexp do Next o suficiente para este padrão: um grupo único com
 * lookahead negativo.
 */
describe("matcher do proxy", () => {
  const fonte = readFileSync(join(__dirname, "..", "proxy.ts"), "utf8");

  /*
   * Pega a linha do padrão pelo começo dele, em vez de casar o literal com um
   * regex cheio de escapes — o padrão é todo feito de barras invertidas, e um
   * regex para extraí-lo fica ilegível e frágil. `JSON.parse` desfaz os escapes
   * do literal TypeScript, que são os mesmos do JSON.
   */
  const linha = fonte
    .split("\n")
    .map((l) => l.trim().replace(/,$/, ""))
    .find((l) => l.startsWith('"/((?!api'));

  it("existe no arquivo", () => {
    expect(linha).toBeDefined();
  });

  const padrao = new RegExp(`^${JSON.parse(linha ?? '""') as string}$`);

  it.each([
    ["/", true],
    ["/login", true],
    ["/biometria", true],
    ["/habitos", true],
    ["/habitos/novo", true],
    /*
     * As telas de tarefa da etapa 2. Elas moram no grupo `(tela-cheia)`, que não
     * aparece na URL — então para a guarda são caminhos sob `/habitos` como
     * qualquer outro, e precisam estar protegidas.
     */
    ["/habitos/5eed0001-0000-4000-8000-000000000002/editar", true],
    ["/habitos/5eed0001-0000-4000-8000-000000000002/retroativo", true],
    ["/ajustes", true],
    // Chamada de API redirecionada devolveria HTML 200 e quebraria o fetch.
    ["/api/hoje", false],
    ["/api/auth/estado", false],
    // Sem isto a PWA não instala.
    ["/sw.js", false],
    ["/manifest.webmanifest", false],
    ["/icone-192.png", false],
    ["/icone-512.png", false],
    ["/icon.svg", false],
    ["/apple-icon.png", false],
    ["/_next/static/chunks/main.js", false],
  ])("%s é guardado: %s", (caminho, esperado) => {
    expect(padrao.test(caminho)).toBe(esperado);
  });
});

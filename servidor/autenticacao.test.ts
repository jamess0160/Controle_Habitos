/**
 * Autenticação contra o Postgres de verdade (etapa 3.1).
 *
 * O que estes testes cobrem é a parte que **não** é da biblioteca de WebAuthn: a
 * ordem dos passos do login por senha, o rate limiting em tabela, o formato da
 * sessão, a trava de domínio e o reset transacional.
 *
 * O que eles **não** cobrem, e vale dizer: a conferência da assinatura de uma
 * passkey. Produzi-la exigiria um autenticador virtual, e a verificação é da
 * `@simplewebauthn/server` — testá-la aqui seria testar a biblioteca. O que é
 * nosso em volta dela está coberto: o desafio de uso único, o teto de desafios,
 * a regra do contador e todos os efeitos de haver ou não passkey.
 */

import { createHash } from "node:crypto";

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

import { estadoAuth, exigirValido, loginConcluido, type RespostaErro } from "@/contracts";
import { db } from "@/db/knex";
import { GET as authEstado } from "@/app/api/auth/estado/route";
import { POST as authLogout } from "@/app/api/auth/logout/route";
import { POST as authReset } from "@/app/api/auth/biometria/reset/route";
import { POST as authSenha } from "@/app/api/auth/senha/route";
import { POST as loginOpcoes } from "@/app/api/auth/webauthn/login/opcoes/route";
import { POST as registroOpcoes } from "@/app/api/auth/webauthn/registro/opcoes/route";
import { GET as hojeGet } from "@/app/api/hoje/route";
import {
  abrirSessaoDeTeste,
  encerrarBanco,
  limpar,
  ORIGEM_DE_TESTE,
  RP_ID_DE_TESTE,
  SENHA_DE_TESTE,
  semearConfig,
  semearPasskey,
  semearSenha,
  sessoesVivas,
} from "./apoio-de-teste";
import { COOKIE_SESSAO, lerDica } from "./cookie-sessao";
import { conferirSenha, gerarHash, senhaProvisoria } from "./senha";
import { sessaoAtual } from "./sessao";
import {
  ATRASOS_EM_MS,
  BLOQUEIO_EM_MINUTOS,
  estadoDeBloqueio,
  FALHAS_PARA_BLOQUEAR,
} from "./tentativas";
import { contadorAceito } from "./webauthn";

// ─── Utilidades ──────────────────────────────────────────────────────────────

const IP = "203.0.113.7";

function pedido(corpo?: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": IP,
      origin: ORIGEM_DE_TESTE,
      ...headers,
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
}

function leitura(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api", {
    headers: { "cf-connecting-ip": IP, ...headers },
  });
}

async function erroDe(res: Response): Promise<RespostaErro["erro"]> {
  return ((await res.json()) as RespostaErro).erro;
}

/** Envelhece as tentativas daquele IP, para não esperar quinze minutos de verdade. */
async function envelhecerTentativas(minutos: number): Promise<void> {
  await db.raw("UPDATE tentativa_login SET criada_em = criada_em - (? * interval '1 minute')", [
    minutos,
  ]);
}

beforeEach(async () => {
  jar.clear();
  await limpar(db);
  process.env.APP_MODO = "producao";
  await semearConfig();
});

afterAll(encerrarBanco);

// ─── Senha ───────────────────────────────────────────────────────────────────

describe("senha com Argon2id", () => {
  it("o hash não é a senha, e confere", async () => {
    const hash = await gerarHash("abacaxi");

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("abacaxi");
    expect(await conferirSenha(hash, "abacaxi")).toBe(true);
    expect(await conferirSenha(hash, "abacaxj")).toBe(false);
  });

  it("hash ilegível recusa em vez de explodir", async () => {
    // 500 aqui contaria ao atacante algo sobre o estado do banco.
    expect(await conferirSenha("não é um hash", "abacaxi")).toBe(false);
  });

  it("a senha provisória é aleatória e legível", () => {
    const uma = senhaProvisoria();

    expect(uma).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    /* Sem os caracteres que se confundem ao copiar de um terminal. */
    expect(uma).not.toMatch(/[OI10SL5]/);
    expect(senhaProvisoria()).not.toBe(uma);
  });
});

describe("POST /api/auth/senha", () => {
  it("a senha certa abre sessão e manda ao cadastro de biometria", async () => {
    await semearSenha();

    const res = await authSenha(pedido({ senha: SENHA_DE_TESTE }));

    expect(res.status).toBe(200);
    expect(exigirValido(loginConcluido, await res.json(), "login").proximoPasso).toBe(
      "cadastrar_biometria",
    );
    expect(await sessoesVivas()).toBe(1);
  });

  it("a senha errada é recusada e fica registrada", async () => {
    await semearSenha();

    const res = await authSenha(pedido({ senha: "errada" }));

    expect(res.status).toBe(401);
    expect((await erroDe(res)).codigo).toBe("nao_autenticado");
    expect(await sessoesVivas()).toBe(0);

    const tentativas = await db("tentativa_login").select("ip", "sucesso");
    expect(tentativas).toEqual([{ ip: IP, sucesso: false }]);
  });

  it("senha desativada é recusada igual a senha errada", async () => {
    /*
     * A mesma resposta de propósito: dizer "a senha está desativada" contaria
     * que existe passkey cadastrada e que a senha certa não serve mais, o que
     * orienta quem está tentando.
     */
    await semearSenha(SENHA_DE_TESTE, false);

    const res = await authSenha(pedido({ senha: SENHA_DE_TESTE }));

    expect(res.status).toBe(401);
    expect((await erroDe(res)).mensagem).toBe("Senha incorreta.");
  });

  it("sem credencial nenhuma, diz o que fazer — é estado de servidor, não de atacante", async () => {
    const res = await authSenha(pedido({ senha: "qualquer" }));

    expect(res.status).toBe(401);
    expect((await erroDe(res)).mensagem).toContain("Rode o seed");
  });

  it("o token do cookie não é o que está no banco", async () => {
    await semearSenha();
    await authSenha(pedido({ senha: SENHA_DE_TESTE }));

    const dica = lerDica(jar.get(COOKIE_SESSAO));
    const linha = await db("sessao").first("token_hash");

    expect(dica).not.toBeNull();
    expect(linha?.token_hash).not.toBe(dica?.token);
    expect(linha?.token_hash).toBe(
      createHash("sha256").update(dica?.token ?? "").digest("hex"),
    );
  });
});

// ─── Rate limiting ───────────────────────────────────────────────────────────

describe("rate limiting por IP", () => {
  it("o atraso progressivo é 0, 1, 2, 4, 8 e para de crescer", async () => {
    expect(ATRASOS_EM_MS).toEqual([0, 1_000, 2_000, 4_000, 8_000]);

    await semearSenha();

    const atrasos: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      atrasos.push((await estadoDeBloqueio(IP)).atrasoEmMs);
      await db("tentativa_login").insert({ ip: IP, sucesso: false });
    }

    expect(atrasos).toEqual([0, 1_000, 2_000, 4_000, 8_000, 8_000]);
  });

  it("bloqueia depois de 5 falhas na janela e não olha mais a senha", async () => {
    await semearSenha();

    for (let i = 0; i < FALHAS_PARA_BLOQUEAR; i += 1) {
      await db("tentativa_login").insert({ ip: IP, sucesso: false });
    }

    /* Com a senha CERTA: o bloqueio vem antes da conferência, de propósito. */
    const res = await authSenha(pedido({ senha: SENHA_DE_TESTE }));

    expect(res.status).toBe(429);
    const erro = await erroDe(res);
    expect(erro.codigo).toBe("bloqueado");
    /* E não revela se a senha estava correta. */
    expect(erro.mensagem).not.toMatch(/correta|incorreta|certa|errada/i);
    expect(await sessoesVivas()).toBe(0);
  });

  it("o bloqueio não gasta Argon2id: a tentativa bloqueada não entra na contagem", async () => {
    await semearSenha();
    for (let i = 0; i < FALHAS_PARA_BLOQUEAR; i += 1) {
      await db("tentativa_login").insert({ ip: IP, sucesso: false });
    }

    await authSenha(pedido({ senha: "errada" }));

    const [{ count }] = await db("tentativa_login").count({ count: "*" });
    expect(Number(count)).toBe(FALHAS_PARA_BLOQUEAR);
  });

  it("a janela expira sozinha — quinze minutos de silêncio limpam tudo", async () => {
    await semearSenha();
    for (let i = 0; i < FALHAS_PARA_BLOQUEAR; i += 1) {
      await db("tentativa_login").insert({ ip: IP, sucesso: false });
    }
    expect((await estadoDeBloqueio(IP)).bloqueadoAte).not.toBeNull();

    await envelhecerTentativas(BLOQUEIO_EM_MINUTOS + 1);

    expect((await estadoDeBloqueio(IP)).bloqueadoAte).toBeNull();
    expect((await authSenha(pedido({ senha: SENHA_DE_TESTE }))).status).toBe(200);
  });

  it("o bloqueio é por IP, não global — senão o túnel trancaria o app inteiro", async () => {
    await semearSenha();
    for (let i = 0; i < FALHAS_PARA_BLOQUEAR; i += 1) {
      await db("tentativa_login").insert({ ip: "198.51.100.1", sucesso: false });
    }

    expect((await estadoDeBloqueio(IP)).bloqueadoAte).toBeNull();
    expect((await authSenha(pedido({ senha: SENHA_DE_TESTE }))).status).toBe(200);
  });

  it("sobrevive ao restart: a contagem está na tabela, não na memória", async () => {
    for (let i = 0; i < FALHAS_PARA_BLOQUEAR; i += 1) {
      await db("tentativa_login").insert({ ip: IP, sucesso: false });
    }

    /* Nada em memória foi preservado entre estas duas linhas — e o bloqueio continua. */
    expect((await estadoDeBloqueio(IP)).bloqueadoAte).not.toBeNull();
  });

  it("um acerto no meio não perdoa as falhas", async () => {
    for (let i = 0; i < FALHAS_PARA_BLOQUEAR - 1; i += 1) {
      await db("tentativa_login").insert({ ip: IP, sucesso: false });
    }
    await db("tentativa_login").insert({ ip: IP, sucesso: true });
    await db("tentativa_login").insert({ ip: IP, sucesso: false });

    expect((await estadoDeBloqueio(IP)).bloqueadoAte).not.toBeNull();
  });
});

// ─── Sessão ──────────────────────────────────────────────────────────────────

describe("sessão", () => {
  it("cookie desconhecido não vira sessão", async () => {
    jar.set(COOKIE_SESSAO, "token-inventado.completa");
    expect(await sessaoAtual()).toBeNull();
  });

  it("o formato do stub da etapa 2 não é aceito", async () => {
    // Importa porque um cookie antigo no navegador não pode virar sessão de estado inventado.
    jar.set(COOKIE_SESSAO, "stub-com-passkey");
    expect(lerDica("stub-com-passkey")).toBeNull();
    expect(await sessaoAtual()).toBeNull();
  });

  it("sessão revogada não autentica", async () => {
    jar.set(COOKIE_SESSAO, await abrirSessaoDeTeste());
    expect(await sessaoAtual()).not.toBeNull();

    await db("sessao").update({ revogada_em: new Date() });
    expect(await sessaoAtual()).toBeNull();
  });

  it("sessão expirada não autentica", async () => {
    jar.set(COOKIE_SESSAO, await abrirSessaoDeTeste());

    await db("sessao").update({ expira_em: new Date(Date.now() - 1000) });
    expect(await sessaoAtual()).toBeNull();
  });

  it("`temPasskey` vem do banco, não da dica do cookie", async () => {
    /*
     * O ponto do formato de duas partes: forjar o sufixo muda a tela que aparece
     * primeiro e nada mais.
     */
    const cookie = await abrirSessaoDeTeste("completa");
    jar.set(COOKIE_SESSAO, cookie);

    expect((await sessaoAtual())?.temPasskey).toBe(false);

    await semearPasskey();
    expect((await sessaoAtual())?.temPasskey).toBe(true);
  });

  it("o logout revoga a linha e apaga o cookie", async () => {
    jar.set(COOKIE_SESSAO, await abrirSessaoDeTeste());

    expect((await authLogout()).status).toBe(200);

    expect(jar.get(COOKIE_SESSAO)).toBeUndefined();
    expect(await sessoesVivas()).toBe(0);
  });

  it("logout sem sessão é idempotente", async () => {
    expect((await authLogout()).status).toBe(200);
  });
});

// ─── Portão ──────────────────────────────────────────────────────────────────

describe("portão das rotas de domínio", () => {
  it("sem sessão é 401", async () => {
    const res = await hojeGet();
    expect(res.status).toBe(401);
    expect((await erroDe(res)).codigo).toBe("nao_autenticado");
  });

  it("com sessão e sem passkey é 409 — não existe estado intermediário utilizável", async () => {
    jar.set(COOKIE_SESSAO, await abrirSessaoDeTeste("provisoria"));

    const res = await hojeGet();
    expect(res.status).toBe(409);
    expect((await erroDe(res)).codigo).toBe("conflito");
  });

  it("a dica forjada não abre a porta", async () => {
    /* Sessão real, sem passkey, dica dizendo `completa`: a API continua recusando. */
    jar.set(COOKIE_SESSAO, await abrirSessaoDeTeste("completa"));

    expect((await hojeGet()).status).toBe(409);
  });

  it("com passkey, passa", async () => {
    await semearPasskey();
    jar.set(COOKIE_SESSAO, await abrirSessaoDeTeste());

    expect((await hojeGet()).status).toBe(200);
  });

  it("em desenvolvimento a sessão da senha já basta", async () => {
    process.env.APP_MODO = "desenvolvimento";
    jar.set(COOKIE_SESSAO, await abrirSessaoDeTeste("provisoria"));

    expect((await hojeGet()).status).toBe(200);
  });
});

// ─── GET /api/auth/estado ────────────────────────────────────────────────────

describe("GET /api/auth/estado", () => {
  it("primeiro acesso: senha ativa, sem passkey", async () => {
    await semearSenha();

    const estado = exigirValido(estadoAuth, await (await authEstado(leitura())).json(), "estado");

    expect(estado).toEqual({
      autenticado: false,
      temPasskey: false,
      senhaAtiva: true,
      bloqueadoAte: null,
      modoDesenvolvimento: false,
    });
  });

  it("depois do cadastro: passkey presente, senha inativa", async () => {
    await semearSenha(SENHA_DE_TESTE, false);
    await semearPasskey();

    const estado = exigirValido(estadoAuth, await (await authEstado(leitura())).json(), "estado");

    expect(estado).toMatchObject({ temPasskey: true, senhaAtiva: false });
  });

  it("em desenvolvimento a senha segue ativa ao lado da passkey", async () => {
    process.env.APP_MODO = "desenvolvimento";
    await semearSenha(SENHA_DE_TESTE, false);
    await semearPasskey();

    const estado = exigirValido(estadoAuth, await (await authEstado(leitura())).json(), "estado");

    expect(estado).toMatchObject({
      temPasskey: true,
      senhaAtiva: true,
      modoDesenvolvimento: true,
    });
  });

  it("informa o bloqueio em curso, que é o que a tela precisa contar", async () => {
    for (let i = 0; i < FALHAS_PARA_BLOQUEAR; i += 1) {
      await db("tentativa_login").insert({ ip: IP, sucesso: false });
    }

    const estado = exigirValido(estadoAuth, await (await authEstado(leitura())).json(), "estado");

    expect(estado.bloqueadoAte).not.toBeNull();
    expect(new Date(estado.bloqueadoAte as string).getTime()).toBeGreaterThan(Date.now());
  });
});

// ─── WebAuthn: o que é nosso ─────────────────────────────────────────────────

describe("trava de domínio (rp_id)", () => {
  it("origem divergente do rp_id gravado é recusada com mensagem própria", async () => {
    await semearConfig("habitos.exemplo.com");
    await semearPasskey();
    jar.set(COOKIE_SESSAO, await abrirSessaoDeTeste());

    const res = await registroOpcoes(pedido(undefined, { origin: "https://outro.exemplo.com" }));

    expect(res.status).toBe(409);
    const erro = await erroDe(res);
    expect(erro.mensagem).toContain("habitos.exemplo.com");
    expect(erro.mensagem).toContain("outro.exemplo.com");
    expect(erro.mensagem).toContain("CLI");
  });

  it("sem origem no pedido, não inventa uma", async () => {
    jar.set(COOKIE_SESSAO, await abrirSessaoDeTeste("provisoria"));

    const res = await registroOpcoes(
      new Request("http://localhost:3000/api", { method: "POST" }),
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("a origem de desenvolvimento bate com rp_id=localhost", async () => {
    jar.set(COOKIE_SESSAO, await abrirSessaoDeTeste("provisoria"));

    const res = await registroOpcoes(pedido());

    expect(res.status).toBe(200);
  });
});

describe("desafios", () => {
  it("o registro grava um desafio de uso único", async () => {
    jar.set(COOKIE_SESSAO, await abrirSessaoDeTeste("provisoria"));

    await registroOpcoes(pedido());

    const linhas = await db("webauthn_desafio").select("tipo", "consumido_em");
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ tipo: "registro", consumido_em: null });
  });

  it("o teto fecha a torneira de escrita em webauthn_desafio", async () => {
    jar.set(COOKIE_SESSAO, await abrirSessaoDeTeste("provisoria"));

    const expira = new Date(Date.now() + 60_000);
    await db("webauthn_desafio").insert(
      Array.from({ length: 20 }, () => ({
        desafio: Buffer.from(Math.random().toString()),
        tipo: "registro" as const,
        expira_em: expira,
      })),
    );

    const res = await registroOpcoes(pedido());

    expect(res.status).toBe(429);
    expect((await erroDe(res)).codigo).toBe("bloqueado");
  });

  it("desafio expirado não conta para o teto", async () => {
    jar.set(COOKIE_SESSAO, await abrirSessaoDeTeste("provisoria"));

    await db("webauthn_desafio").insert(
      Array.from({ length: 30 }, () => ({
        desafio: Buffer.from(Math.random().toString()),
        tipo: "registro" as const,
        expira_em: new Date(Date.now() - 1000),
      })),
    );

    expect((await registroOpcoes(pedido())).status).toBe(200);
  });

  it("login sem passkey cadastrada recusa em vez de devolver opções vazias", async () => {
    const res = await loginOpcoes(pedido());

    expect(res.status).toBe(409);
    expect((await erroDe(res)).mensagem).toContain("senha");
  });

  it("login com passkey devolve o desafio e as credenciais permitidas", async () => {
    await semearPasskey();

    const res = await loginOpcoes(pedido());
    expect(res.status).toBe(200);

    const opcoes = (await res.json()) as { challenge: string; allowCredentials: unknown[] };
    expect(opcoes.challenge).toEqual(expect.any(String));
    expect(opcoes.allowCredentials).toHaveLength(1);

    const linha = await db("webauthn_desafio").first("tipo");
    expect(linha?.tipo).toBe("autenticacao");
  });
});

describe("contador anti-clonagem", () => {
  it("contador que cresce é aceito", () => {
    expect(contadorAceito(0, 1)).toBe(true);
    expect(contadorAceito(41, 42)).toBe(true);
  });

  it("contador igual ou menor é recusado — credencial copiada ou replay", () => {
    expect(contadorAceito(42, 42)).toBe(false);
    expect(contadorAceito(42, 7)).toBe(false);
  });

  it("zero é aceito sempre: é o que Face ID e Android reportam de propósito", () => {
    expect(contadorAceito(0, 0)).toBe(true);
    expect(contadorAceito(99, 0)).toBe(true);
  });
});

// ─── Reset pela interface ────────────────────────────────────────────────────

describe("POST /api/auth/biometria/reset", () => {
  async function autenticado() {
    await semearPasskey();
    await semearSenha(SENHA_DE_TESTE, false);
    jar.set(COOKIE_SESSAO, await abrirSessaoDeTeste());
  }

  it("exige a confirmação digitada", async () => {
    await autenticado();

    const res = await authReset(pedido({ confirmacao: "resetar" }));

    expect(res.status).toBe(422);
    expect((await erroDe(res)).codigo).toBe("validacao");
    /* E nada foi apagado. */
    expect(await db("credencial_passkey").select("id")).toHaveLength(1);
  });

  it("apaga a passkey, reativa a senha e revoga todas as sessões", async () => {
    await autenticado();
    await abrirSessaoDeTeste();
    await abrirSessaoDeTeste();
    expect(await sessoesVivas()).toBe(3);

    const res = await authReset(pedido({ confirmacao: "RESETAR BIOMETRIA" }));
    expect(res.status).toBe(200);

    const corpo = (await res.json()) as { senhaProvisoria: string; sessoesRevogadas: number };

    expect(await db("credencial_passkey").select("id")).toHaveLength(0);
    expect(await sessoesVivas()).toBe(0);
    expect(corpo.sessoesRevogadas).toBe(3);
    expect(jar.get(COOKIE_SESSAO)).toBeUndefined();

    /* A senha provisória da resposta é a que passa a valer. */
    const senha = await db("credencial_senha").first("hash", "ativa");
    expect(senha?.ativa).toBe(true);
    expect(await conferirSenha(senha?.hash ?? "", corpo.senhaProvisoria)).toBe(true);
  });

  it("limpa o bloqueio: um atraso herdado trancaria a senha nova", async () => {
    await autenticado();
    for (let i = 0; i < FALHAS_PARA_BLOQUEAR; i += 1) {
      await db("tentativa_login").insert({ ip: IP, sucesso: false });
    }

    await authReset(pedido({ confirmacao: "RESETAR BIOMETRIA" }));

    expect((await estadoDeBloqueio(IP)).bloqueadoAte).toBeNull();
  });

  it("depois do reset, a senha provisória entra e cai no cadastro de biometria", async () => {
    await autenticado();

    const res = await authReset(pedido({ confirmacao: "RESETAR BIOMETRIA" }));
    const { senhaProvisoria: nova } = (await res.json()) as { senhaProvisoria: string };

    jar.clear();
    const login = await authSenha(pedido({ senha: nova }));

    expect(login.status).toBe(200);
    expect(exigirValido(loginConcluido, await login.json(), "login").proximoPasso).toBe(
      "cadastrar_biometria",
    );
  });

  it("sem sessão, o reset pela interface não existe — esse caso é da CLI", async () => {
    await semearPasskey();

    const res = await authReset(pedido({ confirmacao: "RESETAR BIOMETRIA" }));

    expect(res.status).toBe(401);
    expect(await db("credencial_passkey").select("id")).toHaveLength(1);
  });
});

// ─── rp_id gravado ───────────────────────────────────────────────────────────

describe("config_app", () => {
  it("o rp_id gravado é o que vale, não o do ambiente", async () => {
    await semearConfig("gravado.exemplo.com");
    process.env.RP_ID = "ambiente.exemplo.com";

    jar.set(COOKIE_SESSAO, await abrirSessaoDeTeste("provisoria"));
    const res = await registroOpcoes(
      pedido(undefined, { origin: "https://ambiente.exemplo.com" }),
    );

    expect(res.status).toBe(409);
    expect((await erroDe(res)).mensagem).toContain("gravado.exemplo.com");

    process.env.RP_ID = RP_ID_DE_TESTE;
  });
});

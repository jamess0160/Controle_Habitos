/**
 * As duas CLIs de reset (etapa 3.6).
 *
 * O que está sob teste é a **transação** e a diferença entre as duas, porque as
 * duas falhas possíveis aqui são do tipo que só aparece no pior momento — o
 * celular já se perdeu, e é a única chance de voltar:
 *
 * 1. um reset **parcial**: passkey apagada e senha não gravada deixa o app sem
 *    porta nenhuma, e a recuperação passa a exigir SQL à mão;
 * 2. `reset-senha` fazendo o que `reset-biometria` faz: quem só perdeu a senha
 *    perderia também o aparelho pareado e as sessões abertas.
 *
 * Os módulos de `cli/` são scripts — executam ao serem importados —, então o que
 * se testa aqui são as operações que eles compõem, nas mesmas transações. A
 * casca interativa (`confirmar`, `imprimirSenha`) é verificada à mão: ela só
 * imprime e lê do terminal.
 */

import { db } from "@/db/knex";
import { encerrarBanco, limpar, semearConfig, semearPasskey, semearSenha } from "@/servidor/apoio-de-teste";
import { definirSenhaProvisoria, estadoDaSenha } from "@/servidor/credencial";
import { conferirSenha } from "@/servidor/senha";
import { revogarTodasAsSessoes } from "@/servidor/sessao";
import { limparTentativas } from "@/servidor/tentativas";
import { apagarPasskeys } from "@/servidor/webauthn";

beforeEach(async () => {
  await limpar(db);
  await semearConfig();
});

afterAll(encerrarBanco);

/** O que `cli/reset-biometria.ts` roda, na mesma transação. */
async function resetDeBiometria() {
  return db.transaction(async (trx) => {
    const apagadas = await apagarPasskeys(trx);
    const provisoria = await definirSenhaProvisoria(trx);
    const sessoes = await revogarTodasAsSessoes(trx);
    await limparTentativas(trx);

    return { apagadas, provisoria, sessoes };
  });
}

/** O que `cli/reset-senha.ts` roda — sem tocar passkeys nem sessões. */
async function resetDeSenha() {
  return db.transaction(async (trx) => {
    const nova = await definirSenhaProvisoria(trx);
    await limparTentativas(trx);
    return nova;
  });
}

async function comSessaoViva(): Promise<void> {
  await db("sessao").insert({
    token_hash: "hash-de-teste",
    expira_em: new Date(Date.now() + 86_400_000),
    user_agent: null,
  });
}

async function sessoesVivas(): Promise<number> {
  const [{ total }] = await db("sessao").whereNull("revogada_em").count({ total: "*" });
  return Number(total);
}

async function tentativas(): Promise<number> {
  const [{ total }] = await db("tentativa_login").count({ total: "*" });
  return Number(total);
}

// ─── reset-biometria ─────────────────────────────────────────────────────────

describe("reset de biometria", () => {
  beforeEach(async () => {
    await semearSenha("a-senha-antiga", false);
    await semearPasskey();
    await comSessaoViva();
    await db("tentativa_login").insert([
      { ip: "10.0.0.9", sucesso: false },
      { ip: "10.0.0.9", sucesso: false },
    ]);
  });

  it("faz as quatro escritas de uma vez", async () => {
    const resultado = await resetDeBiometria();

    expect(resultado.apagadas).toBe(1);
    expect(resultado.sessoes).toBe(1);
    expect(await db("credencial_passkey").select()).toHaveLength(0);
    expect(await sessoesVivas()).toBe(0);
    /* Um bloqueio herdado não pode trancar a senha que acabou de nascer. */
    expect(await tentativas()).toBe(0);
    expect(await estadoDaSenha()).toEqual({ existe: true, ativa: true });
  });

  it("a senha impressa é a que entra", async () => {
    const { provisoria } = await resetDeBiometria();

    const hash = (await db("credencial_senha").first("hash"))?.hash;

    expect(hash).toBeDefined();
    expect(await conferirSenha(hash as string, provisoria)).toBe(true);
    /* E a anterior morre: senha vazada não continua valendo depois do reset. */
    expect(await conferirSenha(hash as string, "a-senha-antiga")).toBe(false);
  });

  it("a senha provisória tem o formato legível do mapa, sem caracteres ambíguos", async () => {
    const { provisoria } = await resetDeBiometria();

    expect(provisoria).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    /* Sem O/0, I/1, S/5 e L: ela é ditada por telefone e digitada à mão. */
    expect(provisoria).not.toMatch(/[OI10SL5]/);
  });

  it("duas execuções nunca dão a mesma senha", async () => {
    const primeira = await resetDeBiometria();
    const segunda = await resetDeBiometria();

    expect(segunda.provisoria).not.toBe(primeira.provisoria);
  });

  it("falha no meio não deixa o app sem porta: ou as quatro, ou nada", async () => {
    const antes = (await db("credencial_senha").first("hash"))?.hash;

    await expect(
      db.transaction(async (trx) => {
        await apagarPasskeys(trx);
        await definirSenhaProvisoria(trx);
        /*
         * O ponto exato que a transação protege: se algo falhar daqui para
         * frente, a passkey apagada tem de voltar — senão não há passkey **nem**
         * senha conhecida, e o único caminho restante é SQL à mão no homelab.
         */
        throw new Error("falha simulada no meio do reset");
      }),
    ).rejects.toThrow("falha simulada");

    expect(await db("credencial_passkey").select()).toHaveLength(1);
    expect((await db("credencial_senha").first("hash"))?.hash).toBe(antes);
    expect(await estadoDaSenha()).toEqual({ existe: true, ativa: false });
  });

  it("funciona sem senha nenhuma no banco — o caso do banco recém-criado", async () => {
    await db("credencial_senha").delete();

    const { provisoria } = await resetDeBiometria();
    const hash = (await db("credencial_senha").first("hash"))?.hash;

    expect(await conferirSenha(hash as string, provisoria)).toBe(true);
  });
});

// ─── reset-senha ─────────────────────────────────────────────────────────────

describe("reset de senha", () => {
  it("não toca nas passkeys nem nas sessões — é a diferença inteira", async () => {
    await semearSenha("a-senha-antiga", true);
    await semearPasskey();
    await comSessaoViva();

    await resetDeSenha();

    /*
     * Quem perdeu a senha não necessariamente perdeu o aparelho. Derrubar as
     * sessões de quem só precisava de uma senha nova transformaria um aperto
     * pequeno num grande.
     */
    expect(await db("credencial_passkey").select()).toHaveLength(1);
    expect(await sessoesVivas()).toBe(1);
  });

  it("reativa a senha desativada, que é o caminho de volta depois da biometria", async () => {
    await semearSenha("a-senha-antiga", false);
    expect((await estadoDaSenha()).ativa).toBe(false);

    const nova = await resetDeSenha();
    const hash = (await db("credencial_senha").first("hash"))?.hash;

    expect((await estadoDaSenha()).ativa).toBe(true);
    expect(await conferirSenha(hash as string, nova)).toBe(true);
  });

  it("limpa o bloqueio: a senha nova não nasce trancada", async () => {
    await semearSenha("a-senha-antiga", true);
    await db("tentativa_login").insert([
      { ip: "10.0.0.9", sucesso: false },
      { ip: "10.0.0.9", sucesso: false },
      { ip: "10.0.0.9", sucesso: false },
      { ip: "10.0.0.9", sucesso: false },
      { ip: "10.0.0.9", sucesso: false },
    ]);

    await resetDeSenha();

    expect(await tentativas()).toBe(0);
  });

  it("invalida a senha anterior", async () => {
    await semearSenha("a-senha-antiga", true);

    await resetDeSenha();
    const hash = (await db("credencial_senha").first("hash"))?.hash;

    expect(await conferirSenha(hash as string, "a-senha-antiga")).toBe(false);
  });
});

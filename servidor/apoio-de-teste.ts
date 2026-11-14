import { createHash, randomBytes } from "node:crypto";
import { db } from "@/db/knex";
import { limpar } from "@/db/teste";
import { valorDoCookie, type EstadoDeSessao } from "./cookie-sessao";
import { gerarHash } from "./senha";

/**
 * Apoio dos testes de integração: semeia o mínimo e abre sessões.
 *
 * Mora em `servidor/` e não em `db/` porque o que ele semeia são **credenciais**,
 * e as decisões de formato (o hash do token, o formato do cookie) são deste
 * módulo. O nome não termina em `.test.ts` de propósito, para o Jest não tentar
 * rodá-lo como suíte.
 */

export { limpar };

export const SENHA_DE_TESTE = "senha-de-teste-123";
export const RP_ID_DE_TESTE = "localhost";
export const ORIGEM_DE_TESTE = "http://localhost:3000";

/**
 * Semeia `config_app` com o que a autenticação lê.
 *
 * Explícito nos testes em vez de herdado do `.env`: `rp_id` é a trava de
 * domínio, e um teste que a lesse do ambiente passaria ou falharia conforme a
 * máquina.
 */
export async function semearConfig(rpId = RP_ID_DE_TESTE): Promise<void> {
  await db("config_app")
    .insert([
      { chave: "rp_id", valor: rpId },
      { chave: "rp_name", valor: "Controle de Hábitos" },
      { chave: "usuario_nome", valor: "Tiago" },
    ])
    .onConflict("chave")
    .merge();
}

/** Semeia a senha com o mesmo Argon2id da produção — é o que se quer exercitar. */
export async function semearSenha(senha = SENHA_DE_TESTE, ativa = true): Promise<void> {
  await db("credencial_senha").insert({
    hash: await gerarHash(senha),
    ativa,
    desativada_em: ativa ? null : new Date(),
  });
}

/**
 * Insere uma passkey **sintética**.
 *
 * Serve a tudo que depende de *haver* passkey — `temPasskey`, a desativação da
 * senha, o portão, o reset. O que ela não serve é autenticar: produzir uma
 * assinatura válida exigiria um autenticador virtual, e a conferência da
 * assinatura é da biblioteca, não nossa (ver servidor/webauthn.ts).
 */
export async function semearPasskey(contador = 0): Promise<Buffer> {
  const credentialId = randomBytes(16);

  await db("credencial_passkey").insert({
    credential_id: credentialId,
    public_key: randomBytes(64),
    counter: String(contador),
    transports: ["internal"],
    /* Sem DEFAULT no banco: as colunas anuláveis entram explícitas. */
    aaguid: null,
    apelido: "Aparelho de teste",
  });

  return credentialId;
}

/**
 * Abre uma sessão direto no banco e devolve o valor do cookie.
 *
 * Direto no banco, sem passar pela rota de login, porque a maioria dos testes
 * quer *estar* autenticado e não *testar* o login — e fazer login de verdade em
 * cada caso pagaria um Argon2id por teste.
 */
export async function abrirSessaoDeTeste(estado: EstadoDeSessao = "completa"): Promise<string> {
  const token = randomBytes(32).toString("base64url");

  await db("sessao").insert({
    token_hash: createHash("sha256").update(token).digest("hex"),
    expira_em: new Date(Date.now() + 1000 * 60 * 60),
    user_agent: null,
  });

  return valorDoCookie(token, estado);
}

/** Conta sessões vivas — usado para provar revogação em massa. */
export async function sessoesVivas(): Promise<number> {
  const [{ count }] = await db("sessao").whereNull("revogada_em").count({ count: "*" });
  return Number(count);
}

export async function encerrarBanco(): Promise<void> {
  await db.destroy();
}

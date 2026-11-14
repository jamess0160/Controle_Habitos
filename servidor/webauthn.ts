import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { Knex } from "knex";
import { db } from "@/db/knex";
import type { CodigoErro } from "@/contracts";
import { lerConfig } from "./config";

/**
 * WebAuthn do lado do servidor: desafio, verificação e o `counter`
 * anti-clonagem.
 *
 * A verificação criptográfica fica com a biblioteca, e é por isso que
 * [contracts/auth.ts](../contracts/auth.ts) deixa os payloads frouxos: o que
 * valida uma resposta de autenticador é a conferência da assinatura contra a
 * chave pública, não um schema de forma. Reescrever `PublicKeyCredential` em Zod
 * criaria uma segunda definição para divergir da primeira sem validar nada.
 *
 * O que é **nosso** e mora aqui: onde o desafio é guardado, como ele é
 * consumido, e a trava de domínio.
 */

/** Tempo de vida do desafio. Curto: ele serve a uma interação, não a uma sessão. */
const DESAFIO_EM_MS = 5 * 60_000;

/**
 * Teto de desafios recentes antes de recusar novos.
 *
 * O mapa pede isto não por haver segredo a adivinhar — não há —, mas para a rota
 * de desafios não servir de **torneira de escrita** em `webauthn_desafio`. Num
 * app de um usuário só, um teto global é a medida certa: ninguém legítimo pede
 * vinte desafios em cinco minutos.
 */
const TETO_DE_DESAFIOS = 20;

/**
 * O identificador do usuário no WebAuthn.
 *
 * Constante, e não uma linha no banco, porque o app tem exatamente um usuário
 * para sempre — é a mesma premissa que tira `user_id` das tabelas de domínio.
 * O valor vai dentro da passkey e **não pode mudar**: trocá-lo faria o
 * autenticador tratar o cadastro seguinte como de outra pessoa.
 */
const USUARIO_ID = new TextEncoder().encode("controle-habito");
const USUARIO_NOME = "controle-habito";

export type TipoDeDesafio = "registro" | "autenticacao";

/** O que o chamador precisa saber quando a trava de domínio dispara. */
export type FalhaDeWebauthn =
  | { tipo: "sem_rp_id" }
  | { tipo: "sem_origem" }
  | { tipo: "dominio_divergente"; esperado: string; recebido: string }
  | { tipo: "desafio_invalido" }
  | { tipo: "sem_passkey" }
  | { tipo: "nao_verificado" }
  | { tipo: "contador_retrocedeu" };

export type Ambiente = { rpId: string; rpName: string; origem: string };

/**
 * Resolve e **confere** o ambiente do WebAuthn.
 *
 * A trava de `rp_id` do mapa vive aqui: o valor gravado em `config_app` é o
 * domínio em que as passkeys foram cadastradas, e uma passkey só funciona nele.
 * Se a requisição chega de outro domínio, não há como a biometria dar certo — e
 * dizer isso com mensagem própria é melhor que deixar o navegador devolver um
 * `SecurityError` genérico, porque a providência é específica: voltar ao domínio
 * original ou rodar a CLI de reset.
 *
 * `localhost` é exceção da própria especificação — é contexto seguro sem TLS, e
 * é onde o app roda em desenvolvimento.
 */
export async function ambienteDeWebauthn(
  origem: string | null,
): Promise<{ ok: true; ambiente: Ambiente } | { ok: false; falha: FalhaDeWebauthn }> {
  const config = await lerConfig();

  if (config.rp_id === null || config.rp_id.trim() === "") {
    return { ok: false, falha: { tipo: "sem_rp_id" } };
  }

  if (origem === null) {
    return { ok: false, falha: { tipo: "sem_origem" } };
  }

  let hostname: string;
  try {
    hostname = new URL(origem).hostname;
  } catch {
    return { ok: false, falha: { tipo: "sem_origem" } };
  }

  if (hostname !== config.rp_id) {
    return {
      ok: false,
      falha: { tipo: "dominio_divergente", esperado: config.rp_id, recebido: hostname },
    };
  }

  return {
    ok: true,
    ambiente: {
      rpId: config.rp_id,
      rpName: config.rp_name ?? "Controle de Hábitos",
      origem,
    },
  };
}

// ─── Desafios ────────────────────────────────────────────────────────────────

async function guardarDesafio(desafio: string, tipo: TipoDeDesafio): Promise<void> {
  await db("webauthn_desafio").insert({
    desafio: Buffer.from(desafio, "utf8"),
    tipo,
    expira_em: new Date(Date.now() + DESAFIO_EM_MS),
  });
}

/**
 * Consome um desafio: ele vale **uma vez**.
 *
 * O `UPDATE ... RETURNING` com `consumido_em IS NULL` é a parte que importa —
 * duas requisições simultâneas com o mesmo desafio disputam a mesma linha, e só
 * uma leva. Conferir e depois marcar, em dois passos, abriria a janela de replay
 * que o desafio existe para fechar.
 */
async function consumirDesafio(desafio: string, tipo: TipoDeDesafio): Promise<boolean> {
  const linhas = await db("webauthn_desafio")
    .where({ desafio: Buffer.from(desafio, "utf8"), tipo })
    .whereNull("consumido_em")
    .where("expira_em", ">", new Date())
    .update({ consumido_em: new Date() })
    .returning("id");

  return linhas.length > 0;
}

/** `true` quando a torneira de desafios está aberta demais. */
export async function desafiosDemais(): Promise<boolean> {
  const [{ count }] = await db("webauthn_desafio")
    .where("expira_em", ">", new Date())
    .count({ count: "*" });

  return Number(count) >= TETO_DE_DESAFIOS;
}

// ─── Registro ────────────────────────────────────────────────────────────────

export async function opcoesDeRegistro(ambiente: Ambiente) {
  const cadastradas = await db("credencial_passkey").select("credential_id", "transports");

  const opcoes = await generateRegistrationOptions({
    rpName: ambiente.rpName,
    rpID: ambiente.rpId,
    userName: USUARIO_NOME,
    userID: USUARIO_ID,
    userDisplayName: USUARIO_NOME,
    attestationType: "none",
    /*
     * As já cadastradas entram em `excludeCredentials` para o autenticador
     * recusar um segundo cadastro do mesmo dispositivo com `InvalidStateError`
     * — que é a mensagem certa, e a tela já a traduz.
     */
    excludeCredentials: cadastradas.map((c) => ({
      id: c.credential_id.toString("base64url"),
      transports: c.transports ?? undefined,
    })),
    authenticatorSelection: {
      /*
       * `residentKey: required` porque o login não tem campo de usuário: o
       * autenticador precisa saber, sozinho, qual credencial oferecer. E
       * `userVerification: required` porque o ponto do app é a biometria — uma
       * passkey que só exige presença não substitui a senha que ela desativa.
       */
      residentKey: "required",
      userVerification: "required",
    },
  });

  await guardarDesafio(opcoes.challenge, "registro");

  return opcoes;
}

/**
 * O que sobra de uma verificação de cadastro, pronto para virar linha.
 *
 * Exatamente o que o mapa precisa guardar: `credential_id` e `public_key` para
 * conferir assinatura, `counter` para detectar clonagem, `transports` para
 * sugerir ao navegador por onde falar com o autenticador na próxima vez.
 */
export type CredencialVerificada = {
  credentialId: Buffer;
  publicKey: Buffer;
  counter: string;
  transports: string[] | null;
  aaguid: string | null;
};

/**
 * Verifica o cadastro. **Não grava a credencial** — devolve o que gravar.
 *
 * A separação existe porque o cadastro muda três coisas de uma vez (a
 * credencial, a senha, as sessões) e as três têm de ser uma transação só. Já o
 * consumo do desafio fica **fora** dela de propósito: desafio consumido tem de
 * permanecer consumido mesmo que a transação role atrás, senão a tentativa
 * falha devolveria o desafio ao atacante para um replay.
 */
export async function verificarRegistro(
  ambiente: Ambiente,
  resposta: RegistrationResponseJSON,
): Promise<
  { ok: true; credencial: CredencialVerificada } | { ok: false; falha: FalhaDeWebauthn }
> {
  let verificado;
  try {
    verificado = await verifyRegistrationResponse({
      response: resposta,
      expectedChallenge: (desafio) => consumirDesafio(desafio, "registro"),
      expectedOrigin: ambiente.origem,
      expectedRPID: ambiente.rpId,
      requireUserVerification: true,
    });
  } catch {
    /*
     * A biblioteca lança quando o desafio não confere, a origem divergiu ou a
     * attestation não bate. Nenhum desses casos é erro do servidor, e todos têm
     * a mesma providência para quem está na tela: tentar de novo.
     */
    return { ok: false, falha: { tipo: "desafio_invalido" } };
  }

  if (!verificado.verified) {
    return { ok: false, falha: { tipo: "nao_verificado" } };
  }

  const { credential, aaguid } = verificado.registrationInfo;

  return {
    ok: true,
    credencial: {
      credentialId: Buffer.from(credential.id, "base64url"),
      publicKey: Buffer.from(credential.publicKey),
      counter: String(credential.counter),
      transports: credential.transports ?? null,
      /* O AAGUID zerado é o que autenticadores de plataforma reportam quando não querem se identificar. */
      aaguid: aaguid === "00000000-0000-0000-0000-000000000000" ? null : aaguid,
    },
  };
}

/** Grava a credencial verificada. Recebe a conexão para entrar na transação do cadastro. */
export async function gravarPasskey(
  conexao: Knex,
  credencial: CredencialVerificada,
  apelido: string | null,
): Promise<{ apelido: string | null; criadaEm: Date }> {
  const [linha] = await conexao("credencial_passkey")
    .insert({
      credential_id: credencial.credentialId,
      public_key: credencial.publicKey,
      counter: credencial.counter,
      transports: credencial.transports,
      aaguid: credencial.aaguid,
      apelido,
    })
    .returning(["apelido", "criada_em"]);

  return { apelido: linha.apelido, criadaEm: linha.criada_em };
}

// ─── Autenticação ────────────────────────────────────────────────────────────

export async function opcoesDeLogin(ambiente: Ambiente) {
  const cadastradas = await db("credencial_passkey").select("credential_id", "transports");

  const opcoes = await generateAuthenticationOptions({
    rpID: ambiente.rpId,
    userVerification: "required",
    allowCredentials: cadastradas.map((c) => ({
      id: c.credential_id.toString("base64url"),
      transports: c.transports ?? undefined,
    })),
  });

  await guardarDesafio(opcoes.challenge, "autenticacao");

  return opcoes;
}

/**
 * A regra anti-clonagem, isolada para poder ser testada.
 *
 * Contador que **cresceu** é o caso normal. Contador em zero é o caso dos
 * autenticadores de plataforma (Face ID, impressão digital do Android), que
 * mantêm o valor zerado de propósito por privacidade — ali não há nada a
 * comparar, e exigir crescimento recusaria todo iPhone. Contador que ficou igual
 * ou retrocedeu, tendo já sido maior que zero, é credencial copiada ou resposta
 * reaproveitada: recusa.
 */
export function contadorAceito(anterior: number, novo: number): boolean {
  if (novo === 0) return true;
  return novo > anterior;
}

/**
 * Verifica a assinatura e confere o `counter`.
 *
 * **O que o `counter` pega.** O autenticador incrementa um contador a cada uso e
 * o assina junto. Se uma assinatura chega com contador menor ou igual ao último
 * visto, ou a credencial foi copiada para outro dispositivo, ou a resposta é um
 * replay — nos dois casos a entrada tem de ser recusada. Autenticadores de
 * plataforma (Face ID, impressão digital do Android) frequentemente mantêm o
 * contador em zero de propósito, por privacidade, e aí não há o que comparar: a
 * conferência só vale quando o valor cresce de verdade.
 */
export async function autenticarPasskey(
  ambiente: Ambiente,
  resposta: AuthenticationResponseJSON,
): Promise<{ ok: true } | { ok: false; falha: FalhaDeWebauthn }> {
  const credencial = await db("credencial_passkey")
    .where({ credential_id: Buffer.from(resposta.id, "base64url") })
    .first();

  if (credencial === undefined) {
    return { ok: false, falha: { tipo: "sem_passkey" } };
  }

  let verificado;
  try {
    verificado = await verifyAuthenticationResponse({
      response: resposta,
      expectedChallenge: (desafio) => consumirDesafio(desafio, "autenticacao"),
      expectedOrigin: ambiente.origem,
      expectedRPID: ambiente.rpId,
      requireUserVerification: true,
      credential: {
        id: credencial.credential_id.toString("base64url"),
        publicKey: new Uint8Array(credencial.public_key),
        counter: Number(credencial.counter),
        transports: credencial.transports ?? undefined,
      },
    });
  } catch {
    return { ok: false, falha: { tipo: "desafio_invalido" } };
  }

  if (!verificado.verified) {
    return { ok: false, falha: { tipo: "nao_verificado" } };
  }

  const anterior = Number(credencial.counter);
  const novo = verificado.authenticationInfo.newCounter;

  if (!contadorAceito(anterior, novo)) {
    return { ok: false, falha: { tipo: "contador_retrocedeu" } };
  }

  await db("credencial_passkey")
    .where({ id: credencial.id })
    .update({ counter: String(novo), ultimo_uso_em: new Date() });

  return { ok: true };
}

// ─── Consultas ───────────────────────────────────────────────────────────────

export async function temPasskeyCadastrada(): Promise<boolean> {
  const linha = await db("credencial_passkey").first("id");
  return linha !== undefined;
}

export async function passkeyAtual(): Promise<{
  apelido: string | null;
  criadaEm: Date;
  ultimoUsoEm: Date | null;
} | null> {
  const linha = await db("credencial_passkey")
    .orderBy("criada_em", "desc")
    .first("apelido", "criada_em", "ultimo_uso_em");

  if (linha === undefined) return null;

  return {
    apelido: linha.apelido,
    criadaEm: linha.criada_em,
    ultimoUsoEm: linha.ultimo_uso_em,
  };
}

export async function apagarPasskeys(conexao: Knex = db): Promise<number> {
  return conexao("credencial_passkey").delete();
}

/**
 * O código de erro de cada falha.
 *
 * Mora aqui, e não em cada rota, porque as quatro rotas de WebAuthn tratavam a
 * mesma lista — e a primeira versão mandava `sem_origem` para 500, o que
 * transformava um pedido sem header em erro de servidor.
 */
export function codigoDaFalha(falha: FalhaDeWebauthn): CodigoErro {
  switch (falha.tipo) {
    /* Configuração do servidor incompleta: ninguém no cliente pode consertar. */
    case "sem_rp_id":
      return "interno";
    /* Header que todo navegador manda; faltar é pedido malformado, não falha nossa. */
    case "sem_origem":
      return "validacao";
    /* Estado incompatível: a passkey existe, mas não para este domínio. */
    case "dominio_divergente":
      return "conflito";
    default:
      return "nao_autenticado";
  }
}

/** Mensagem em pt-BR por causa. Cada uma tem providência diferente. */
export function mensagemDeFalha(falha: FalhaDeWebauthn): string {
  switch (falha.tipo) {
    case "sem_rp_id":
      return "O domínio das passkeys não está configurado no servidor (RP_ID).";
    case "sem_origem":
      return "Não foi possível identificar a origem da requisição.";
    case "dominio_divergente":
      return `A biometria foi cadastrada em ${falha.esperado} e esta página está em ${falha.recebido}. A passkey só funciona no domínio original — fora dele, a saída é o reset pela CLI.`;
    case "desafio_invalido":
      return "O desafio da biometria expirou ou já foi usado. Tente de novo.";
    case "sem_passkey":
      return "Esta passkey não está cadastrada neste app.";
    case "nao_verificado":
      return "A biometria não pôde ser verificada.";
    case "contador_retrocedeu":
      return "A credencial apresentou um contador inválido e foi recusada. Rode o reset pela CLI.";
  }
}

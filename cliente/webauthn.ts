import type { OpcoesWebauthn } from "@/contracts";

/**
 * A ponte entre o JSON do servidor e a API do navegador.
 *
 * `navigator.credentials` não fala JSON: ela quer `ArrayBuffer` onde o servidor
 * manda base64url, e devolve `ArrayBuffer` onde o servidor espera base64url. Daí
 * as quatro conversões deste arquivo — não há como evitá-las sem uma biblioteca,
 * e para duas chamadas ela custaria mais que estas linhas.
 *
 * **O que fica para a etapa 3.1.** O `challenge` das fixtures é inventado, então
 * `credentials.create()` e `.get()` falham de verdade na etapa 2 — e isso é
 * correto: a verificação criptográfica é o que valida esses payloads, não um
 * schema de forma (ver a nota no topo de
 * [contracts/auth.ts](../contracts/auth.ts)). O que a etapa 2 prova é o fluxo das
 * telas e o tratamento de cada erro; o que entra na 3.1 é a biblioteca que monta
 * o desafio e confere a assinatura. Se ela trouxer as próprias conversões, este
 * arquivo some.
 */

export function suportaWebauthn(): boolean {
  return (
    typeof window !== "undefined" &&
    "PublicKeyCredential" in window &&
    typeof navigator.credentials?.create === "function"
  );
}

// ─── base64url ───────────────────────────────────────────────────────────────

function paraBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const completo = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binario = atob(completo);
  const bytes = new Uint8Array(binario.length);

  for (let i = 0; i < binario.length; i += 1) {
    bytes[i] = binario.charCodeAt(i);
  }

  return bytes;
}

function paraBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binario = "";

  for (const byte of bytes) {
    binario += String.fromCharCode(byte);
  }

  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ─── Formato do servidor ─────────────────────────────────────────────────────

/**
 * As opções como trafegam, em base64url.
 *
 * Declaradas aqui e não em `contracts/` de propósito: este é o formato da
 * **especificação**, não nosso, e o contrato deixa `opcoesWebauthn` frouxo
 * justamente para não criar uma segunda definição que divirja da primeira.
 */
type OpcoesDeRegistroJson = {
  challenge: string;
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  excludeCredentials?: { type: "public-key"; id: string }[];
  timeout?: number;
  attestation?: AttestationConveyancePreference;
};

type OpcoesDeLoginJson = {
  challenge: string;
  rpId?: string;
  allowCredentials?: { type: "public-key"; id: string }[];
  userVerification?: UserVerificationRequirement;
  timeout?: number;
};

/** O que vai no `credencial` do request — base64url de volta. */
export type CredencialSerializada = {
  id: string;
  type: string;
  rawId: string;
  response: Record<string, unknown>;
  clientExtensionResults: Record<string, unknown>;
};

function serializar(
  credencial: PublicKeyCredential,
  response: Record<string, unknown>,
): CredencialSerializada {
  return {
    id: credencial.id,
    type: credencial.type,
    rawId: paraBase64Url(credencial.rawId),
    response,
    clientExtensionResults: credencial.getClientExtensionResults() as Record<string, unknown>,
  };
}

// ─── Chamadas ────────────────────────────────────────────────────────────────

export async function criarPasskey(opcoes: OpcoesWebauthn): Promise<CredencialSerializada> {
  const json = opcoes as unknown as OpcoesDeRegistroJson;

  const credencial = (await navigator.credentials.create({
    publicKey: {
      ...json,
      challenge: paraBytes(json.challenge),
      user: { ...json.user, id: paraBytes(json.user.id) },
      excludeCredentials: (json.excludeCredentials ?? []).map((c) => ({
        ...c,
        id: paraBytes(c.id),
      })),
    },
  })) as PublicKeyCredential | null;

  if (credencial === null) {
    throw new Error("O navegador não devolveu credencial.");
  }

  const resposta = credencial.response as AuthenticatorAttestationResponse;

  return serializar(credencial, {
    clientDataJSON: paraBase64Url(resposta.clientDataJSON),
    attestationObject: paraBase64Url(resposta.attestationObject),
    transports: resposta.getTransports?.() ?? [],
  });
}

export async function usarPasskey(opcoes: OpcoesWebauthn): Promise<CredencialSerializada> {
  const json = opcoes as unknown as OpcoesDeLoginJson;

  const credencial = (await navigator.credentials.get({
    publicKey: {
      ...json,
      challenge: paraBytes(json.challenge),
      allowCredentials: (json.allowCredentials ?? []).map((c) => ({
        ...c,
        id: paraBytes(c.id),
      })),
    },
  })) as PublicKeyCredential | null;

  if (credencial === null) {
    throw new Error("O navegador não devolveu credencial.");
  }

  const resposta = credencial.response as AuthenticatorAssertionResponse;

  return serializar(credencial, {
    clientDataJSON: paraBase64Url(resposta.clientDataJSON),
    authenticatorData: paraBase64Url(resposta.authenticatorData),
    signature: paraBase64Url(resposta.signature),
    userHandle: resposta.userHandle === null ? null : paraBase64Url(resposta.userHandle),
  });
}

/**
 * O erro do navegador em português, por causa.
 *
 * Os quatro casos têm providências diferentes, e um "falha na biometria"
 * genérico esconderia justamente o pior deles. `SecurityError` é o do domínio
 * divergente: o `rp_id` está gravado no banco, a passkey só funciona nele, e sem
 * voltar ao domínio original a única saída é a CLI de reset — é a mensagem que o
 * [Mapa de autenticação](../Docs/mapas/Mapa%20de%20autenticação.md) exige
 * específica.
 */
export function mensagemDeErroWebauthn(erro: unknown): string {
  const nome = erro instanceof Error ? erro.name : "";

  switch (nome) {
    case "NotAllowedError":
      return "A biometria foi cancelada ou o tempo esgotou. Tente de novo.";
    case "SecurityError":
      return "O domínio desta página não é o que a passkey espera. A biometria só funciona no domínio original — fora dele, a saída é o reset pela CLI.";
    case "InvalidStateError":
      return "Este dispositivo já tem uma passkey cadastrada para o app.";
    case "NotSupportedError":
      return "Este dispositivo não oferece o tipo de biometria que o app exige.";
    default:
      return erro instanceof Error && erro.message !== ""
        ? erro.message
        : "A biometria não respondeu.";
  }
}

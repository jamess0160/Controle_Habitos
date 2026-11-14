"use client";

import type { AssinarPush } from "@/contracts";

/**
 * O lado do navegador do Web Push: registrar o service worker e assinar.
 *
 * O servidor não participa desta parte — quem cria a assinatura é o navegador,
 * conversando direto com o serviço de push do fabricante (FCM, Mozilla, Apple).
 * O que chega ao servidor é o resultado: um endpoint e duas chaves.
 */

/** O que impede a assinatura, em linguagem de tela. */
export type FalhaDeAssinatura =
  | { motivo: "indisponivel" }
  | { motivo: "sem_permissao" }
  | { motivo: "sem_chave" }
  | { motivo: "erro"; detalhe: string };

export type ResultadoDeAssinatura =
  | { ok: true; assinatura: AssinarPush }
  | ({ ok: false } & FalhaDeAssinatura);

export function mensagemDeFalhaDeAssinatura(falha: FalhaDeAssinatura): string {
  switch (falha.motivo) {
    case "indisponivel":
      return "Este navegador não suporta notificações push.";
    case "sem_permissao":
      return "A permissão de notificação precisa ser concedida antes de assinar.";
    case "sem_chave":
      return "O servidor ainda não tem a chave pública do push.";
    case "erro":
      return `Não foi possível assinar: ${falha.detalhe}`;
  }
}

export function suportaPush(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Registra o service worker e devolve a assinatura pronta para o servidor.
 *
 * `pushManager.subscribe()` **exige** `userVisibleOnly: true` no Chrome: push
 * silencioso é proibido, e é por isso que o `sw.js` sempre mostra notificação,
 * mesmo com payload ilegível.
 *
 * `getSubscription()` antes de assinar porque reassinar com outra chave lança —
 * o navegador guarda a assinatura por registro de service worker, e uma já
 * existente feita para o par VAPID anterior tem de ser cancelada primeiro. É o
 * caso real de trocar as chaves no servidor.
 */
export async function assinarNoNavegador(chavePublica: string | null): Promise<ResultadoDeAssinatura> {
  if (!suportaPush()) return { ok: false, motivo: "indisponivel" };
  if (chavePublica === null || chavePublica.trim() === "") {
    return { ok: false, motivo: "sem_chave" };
  }
  if (Notification.permission !== "granted") return { ok: false, motivo: "sem_permissao" };

  try {
    const registro = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    const chave = chaveEmBytes(chavePublica);
    const existente = await registro.pushManager.getSubscription();

    if (existente !== null && !mesmaChave(existente, chave)) {
      await existente.unsubscribe();
    }

    const assinatura =
      existente !== null && mesmaChave(existente, chave)
        ? existente
        : await registro.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: chave,
          });

    return { ok: true, assinatura: paraOContrato(assinatura) };
  } catch (erro) {
    return { ok: false, motivo: "erro", detalhe: erro instanceof Error ? erro.message : String(erro) };
  }
}

/** Cancela no navegador. O servidor é avisado à parte, pela rota. */
export async function desassinarNoNavegador(): Promise<void> {
  if (!suportaPush()) return;

  const registro = await navigator.serviceWorker.getRegistration();
  const assinatura = await registro?.pushManager.getSubscription();
  await assinatura?.unsubscribe();
}

function mesmaChave(assinatura: PushSubscription, chave: Uint8Array<ArrayBuffer>): boolean {
  const atual = assinatura.options.applicationServerKey;
  if (!atual) return false;

  const bytes = new Uint8Array(atual);
  return bytes.length === chave.length && bytes.every((b, i) => b === chave[i]);
}

/**
 * A chave pública VAPID chega em base64url e `subscribe()` quer bytes.
 *
 * Conversão à mão porque `atob` não entende base64url: os dois caracteres
 * trocados (`-_` por `+/`) e o preenchimento ausente fariam a decodificação
 * falhar ou, pior, produzir bytes errados — e uma chave errada só se manifesta
 * no primeiro envio, muito depois.
 */
function chaveEmBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const preenchimento = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + preenchimento).replace(/-/g, "+").replace(/_/g, "/");
  const bruto = atob(base64);

  /*
   * O buffer é construído explicitamente porque `applicationServerKey` exige um
   * `ArrayBuffer`, e `Uint8Array.from` tipa o buffer como `ArrayBufferLike` —
   * que inclui `SharedArrayBuffer` e não serve ali.
   */
  const bytes = new Uint8Array(new ArrayBuffer(bruto.length));
  for (let i = 0; i < bruto.length; i += 1) bytes[i] = bruto.charCodeAt(i);

  return bytes;
}

function paraOContrato(assinatura: PushSubscription): AssinarPush {
  const json = assinatura.toJSON();
  const chaves = json.keys;

  if (chaves === undefined || chaves.p256dh === undefined || chaves.auth === undefined) {
    throw new Error("a assinatura veio sem as chaves de criptografia");
  }

  return {
    endpoint: assinatura.endpoint,
    chaves: { p256dh: chaves.p256dh, auth: chaves.auth },
  };
}

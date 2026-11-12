"use client";

import { useSyncExternalStore } from "react";
import { suportaWebauthn } from "./webauthn";

/**
 * O que o navegador oferece: WebAuthn, permissão de notificação e o convite de
 * instalação da PWA.
 *
 * Os três são estado **externo** ao React e com valor diferente no servidor, o
 * que os obriga a `useSyncExternalStore`: lidos direto no render dariam
 * divergência de hidratação (o servidor não tem `navigator`), e lidos num efeito
 * cairiam no `react-hooks/set-state-in-effect`. Mesmo desenho do tema em
 * [app/tema.ts](../app/tema.ts).
 */

/** Suporte a WebAuthn não muda durante a sessão — assinar é não fazer nada. */
function naoMuda(): () => void {
  return () => {};
}

export function useSuportaWebauthn(): boolean {
  return useSyncExternalStore(naoMuda, suportaWebauthn, () => false);
}

// ─── Notificações ────────────────────────────────────────────────────────────

export type PermissaoDeNotificacao = NotificationPermission | "indisponivel";

const ouvintesDePermissao = new Set<() => void>();

function assinarPermissao(aoMudar: () => void): () => void {
  ouvintesDePermissao.add(aoMudar);
  return () => {
    ouvintesDePermissao.delete(aoMudar);
  };
}

function permissaoAtual(): PermissaoDeNotificacao {
  if (typeof window === "undefined" || !("Notification" in window)) return "indisponivel";
  return Notification.permission;
}

function permissaoNoServidor(): PermissaoDeNotificacao {
  return "indisponivel";
}

export function usePermissaoDeNotificacao(): PermissaoDeNotificacao {
  return useSyncExternalStore(assinarPermissao, permissaoAtual, permissaoNoServidor);
}

export const ROTULO_PERMISSAO: Record<PermissaoDeNotificacao, string> = {
  granted: "Permitida",
  denied: "Negada",
  default: "Ainda não pedida",
  indisponivel: "Indisponível neste navegador",
};

/**
 * Pede a permissão e avisa quem está ouvindo.
 *
 * `Notification.permission` não emite evento quando muda, então o aviso é
 * manual: sem ele a tela de Ajustes continuaria mostrando "ainda não pedida"
 * depois de o usuário ter concedido.
 */
export async function pedirPermissaoDeNotificacao(): Promise<PermissaoDeNotificacao> {
  if (permissaoAtual() === "indisponivel") return "indisponivel";

  const resultado = await Notification.requestPermission();

  for (const aoMudar of ouvintesDePermissao) aoMudar();

  return resultado;
}

// ─── Convite de instalação ───────────────────────────────────────────────────

type EventoDeInstalacao = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const ouvintesDeInstalacao = new Set<() => void>();
let convite: EventoDeInstalacao | null = null;

/**
 * O listener é registrado na importação do módulo, e não num efeito.
 *
 * `beforeinstallprompt` dispara logo no carregamento da página — bem antes de o
 * React montar a tela de biometria, que é onde o convite é oferecido. Registrado
 * num efeito, o evento já teria passado e o botão de instalar nunca apareceria.
 *
 * `preventDefault()` é o que guarda o evento para uso posterior: sem ele o
 * Chrome mostra o próprio banner quando quiser, e aqui a instalação é oferecida
 * num momento escolhido — o cadastro da biometria, o único em que o usuário está
 * atento ao setup.
 */
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (evento) => {
    evento.preventDefault();
    convite = evento as EventoDeInstalacao;
    for (const aoMudar of ouvintesDeInstalacao) aoMudar();
  });
}

function assinarInstalacao(aoMudar: () => void): () => void {
  ouvintesDeInstalacao.add(aoMudar);
  return () => {
    ouvintesDeInstalacao.delete(aoMudar);
  };
}

function temConvite(): boolean {
  return convite !== null;
}

/**
 * Se há convite de instalação pendente.
 *
 * `false` tanto no iOS (que não implementa `beforeinstallprompt` — lá a
 * instalação é pelo menu Compartilhar) quanto num app **já instalado**. Nos dois
 * casos o certo é não mostrar botão nenhum.
 */
export function useConviteDeInstalacao(): boolean {
  return useSyncExternalStore(assinarInstalacao, temConvite, () => false);
}

export async function instalar(): Promise<"accepted" | "dismissed" | "indisponivel"> {
  if (convite === null) return "indisponivel";

  const pendente = convite;
  await pendente.prompt();
  const { outcome } = await pendente.userChoice;

  /* O evento serve uma vez só. */
  convite = null;
  for (const aoMudar of ouvintesDeInstalacao) aoMudar();

  return outcome;
}

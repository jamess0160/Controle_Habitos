"use client";

import { useEffect } from "react";

/**
 * Registra o [service worker](../public/sw.js).
 *
 * Fica num componente de cliente porque `navigator.serviceWorker` não existe no
 * servidor, e dentro do shell `(app)` porque a tela de login não precisa dele —
 * a instalação é oferecida quando o app já está em uso.
 *
 * Falha em silêncio de propósito: sem service worker o app funciona inteiro,
 * só não oferece instalação. Não é erro que valha interromper a tela.
 */
export function RegistrarServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((erro) => {
      console.warn("Service worker não registrou:", erro);
    });
  }, []);

  return null;
}

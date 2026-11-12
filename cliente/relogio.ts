"use client";

import { useSyncExternalStore } from "react";

/**
 * O relógio de parede, como store externa.
 *
 * Duas telas precisam de um valor que muda sozinho: a contagem do bloqueio por
 * tentativas no login e o cronômetro do tipo `duracao`. Nas duas, a regra é a
 * mesma e está no [Mapa de telas](../Docs/mapas/Mapa%20de%20telas.md): o tempo
 * exibido é sempre **`agora − início`**, recalculado, e nunca um contador
 * acumulado tique a tique. O navegador estrangula timers em segundo plano, e um
 * acumulador chega errado ao voltar do app minimizado.
 *
 * Por isso o `visibilitychange` avisa junto com o intervalo: ao reabrir o app, o
 * recálculo acontece no mesmo quadro em vez de esperar o próximo segundo.
 *
 * `useSyncExternalStore` e não `useState` + efeito pelo mesmo motivo do tema
 * (ver [app/tema.ts](../app/tema.ts)): a hora não é estado do React, e o
 * snapshot do servidor precisa ser diferente do do cliente sem que isso vire
 * divergência de hidratação. O intervalo só existe enquanto alguém está inscrito.
 */

const ouvintes = new Set<() => void>();
let intervalo: ReturnType<typeof setInterval> | null = null;

function avisar(): void {
  for (const aoMudar of ouvintes) aoMudar();
}

function assinar(aoMudar: () => void): () => void {
  ouvintes.add(aoMudar);

  if (intervalo === null) {
    intervalo = setInterval(avisar, 1000);
    document.addEventListener("visibilitychange", avisar);
  }

  return () => {
    ouvintes.delete(aoMudar);

    if (ouvintes.size === 0 && intervalo !== null) {
      clearInterval(intervalo);
      intervalo = null;
      document.removeEventListener("visibilitychange", avisar);
    }
  };
}

/**
 * Arredondado ao segundo de propósito: o React chama `getSnapshot` várias vezes
 * por render e compara por identidade, então um `Date.now()` cru re-renderizaria
 * em loop.
 */
function agoraNoCliente(): number {
  return Math.floor(Date.now() / 1000) * 1000;
}

/** O servidor não tem relógio útil aqui — `0` significa "ainda não hidratou". */
function agoraNoServidor(): number {
  return 0;
}

export function useAgora(): number {
  return useSyncExternalStore(assinar, agoraNoCliente, agoraNoServidor);
}

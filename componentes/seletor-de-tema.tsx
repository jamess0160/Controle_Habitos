"use client";

import { useSyncExternalStore } from "react";
import {
  assinarTema,
  definirTema,
  lerTema,
  lerTemaNoServidor,
  ROTULO_TEMA,
  TEMA,
  type Tema,
} from "@/app/tema";
import { Celular, Lua, Sol } from "./icones";

/**
 * Seletor de tema: Sistema · Claro · Escuro.
 *
 * "Sistema" existe e é o padrão porque é o único estado que acompanha a virada
 * automática do celular ao anoitecer — e este app é usado de manhã cedo e à
 * noite.
 *
 * O tema não é estado deste componente: ele mora no `localStorage` e no atributo
 * do `<html>`, e já foi aplicado pelo script inline do layout antes de o React
 * existir. `useSyncExternalStore` é o jeito de ler isso sem divergência de
 * hidratação — ver [app/tema.ts](../app/tema.ts).
 */
const ICONE: Record<Tema, typeof Sol> = {
  sistema: Celular,
  claro: Sol,
  escuro: Lua,
};

export function SeletorDeTema() {
  const tema = useSyncExternalStore(assinarTema, lerTema, lerTemaNoServidor);

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className="inline-flex rounded-full border border-linha bg-superficie p-0.5"
    >
      {TEMA.map((opcao) => {
        const Icone = ICONE[opcao];
        const selecionado = tema === opcao;

        return (
          <button
            key={opcao}
            type="button"
            role="radio"
            aria-checked={selecionado}
            onClick={() => definirTema(opcao)}
            className={`flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
              selecionado ? "bg-cartao text-texto shadow-sm" : "text-texto-fraco hover:text-texto"
            }`}
          >
            <Icone className="size-4" />
            {ROTULO_TEMA[opcao]}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useAgora } from "@/cliente/relogio";
import { duracaoEmRelogio, duracaoEmTexto } from "@/contracts";
import { Pausa, Play } from "./icones";
import { Botao } from "./ui";

/**
 * Cronômetro do tipo `duracao`.
 *
 * Três regras do [Mapa de telas](../Docs/mapas/Mapa%20de%20telas.md), e as três
 * são decisões de implementação, não de aparência:
 *
 * 1. **`iniciado_em` fica no `sessionStorage`**, não no banco. Ele morre junto
 *    com a PWA fechada, que é exatamente o comportamento desejado: o cronômetro
 *    sobrevive ao app minimizado e não sobrevive ao app fechado. De bônus, não
 *    existe linha de "timer em andamento" para ficar órfã no Postgres.
 * 2. **O tempo exibido é sempre `agora − iniciado_em`**, recalculado — nunca um
 *    acumulado somado a cada tique. O navegador estrangula timers em segundo
 *    plano, e um acumulador voltaria do app minimizado com a conta errada. Quem
 *    dispara o recálculo é [useAgora](../cliente/relogio.ts), que também escuta
 *    `visibilitychange` para acertar no mesmo quadro em que o app reaparece.
 * 3. **O descarte é avisado antes de começar.** Fechar o app perde a sessão em
 *    andamento; sem dizer isso na tela, parece perda de dados.
 *
 * A leitura do `sessionStorage` passa por `useSyncExternalStore` pelo mesmo
 * motivo do tema: é estado externo ao React e inexistente no servidor.
 */

function chave(habitoId: string): string {
  return `habito:cronometro:${habitoId}`;
}

const ouvintes = new Set<() => void>();

function assinar(aoMudar: () => void): () => void {
  ouvintes.add(aoMudar);
  return () => {
    ouvintes.delete(aoMudar);
  };
}

function avisar(): void {
  for (const aoMudar of ouvintes) aoMudar();
}

function lerInicio(habitoId: string): number | null {
  try {
    const bruto = sessionStorage.getItem(chave(habitoId));
    if (bruto === null) return null;
    const valor = Number(bruto);
    return Number.isFinite(valor) ? valor : null;
  } catch {
    return null;
  }
}

type Props = {
  readonly habitoId: string;
  readonly ocupado: boolean;
  /** Segundos decorridos. Quem persiste é a tela, com `origem: "cronometro"`. */
  readonly aoParar: (segundos: number) => void;
};

export function Cronometro({ habitoId, ocupado, aoParar }: Props) {
  const inicio = useSyncExternalStore(
    assinar,
    useCallback(() => lerInicio(habitoId), [habitoId]),
    () => null,
  );

  const agora = useAgora();
  const segundos = inicio === null ? 0 : Math.max(0, Math.floor((agora - inicio) / 1000));

  function iniciar() {
    try {
      sessionStorage.setItem(chave(habitoId), String(Date.now()));
    } catch {
      /* Armazenamento bloqueado: o cronômetro vive só nesta tela. */
    }
    avisar();
  }

  function parar() {
    /*
     * Registra o segundo decorrido, sem arredondar.
     *
     * Arredondava para o minuto com piso de 1 enquanto a meta era em minutos
     * inteiros: 40 s eram gravados como 1 min, e 1 min 30 s como 2 min — o
     * cronômetro media melhor do que conseguia guardar. Com a meta em segundos
     * (ver `contracts/duracao.ts`) o piso ainda é 1: zero não é registro, e um
     * toque duplo em "parar" não deve criar linha de duração nula.
     */
    const decorridos = Math.max(1, segundos);

    try {
      sessionStorage.removeItem(chave(habitoId));
    } catch {
      /* idem */
    }
    avisar();
    aoParar(decorridos);
  }

  if (inicio === null) {
    return (
      <div className="flex flex-col gap-2">
        <Botao onClick={iniciar} disabled={ocupado}>
          <Play className="size-4" />
          Iniciar cronômetro
        </Botao>
        <p className="text-xs leading-snug text-texto-fraco">
          Pode minimizar o app — o tempo continua contando. Fechar o app descarta a contagem.
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span
        className="font-mono text-2xl tabular-nums"
        role="timer"
        aria-label={duracaoEmTexto(segundos)}
      >
        {duracaoEmRelogio(segundos)}
      </span>
      <Botao variante="primario" onClick={parar} disabled={ocupado}>
        <Pausa className="size-4" />
        Parar e registrar
      </Botao>
    </div>
  );
}

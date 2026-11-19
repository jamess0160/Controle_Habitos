"use client";

import type { PartesDeDuracao } from "./duracao";
import { CLASSE_ENTRADA } from "./ui";

/**
 * O relógio `h : min : s` da meta e do registro de duração.
 *
 * A aritmética e o porquê de serem três campos de texto estão em
 * [duracao.ts](./duracao.ts); aqui é só a forma.
 *
 * Não usa `Campo`, que envolve tudo num `<label>`: um rótulo não pode apontar
 * para três controles ao mesmo tempo. O conjunto é um `role="group"` rotulado, e
 * cada parte carrega o próprio `aria-label` — sem isso o leitor de tela anuncia
 * três campos "número" sem dizer qual é qual.
 */
export function CampoDeDuracao({
  rotulo,
  dica,
  erro,
  partes,
  aoMudar,
}: {
  readonly rotulo: string;
  readonly dica?: string;
  readonly erro?: string;
  readonly partes: PartesDeDuracao;
  readonly aoMudar: (partes: PartesDeDuracao) => void;
}) {
  const campos = [
    { chave: "horas", sufixo: "h", nome: "Horas", max: 99 },
    { chave: "minutos", sufixo: "min", nome: "Minutos", max: 59 },
    { chave: "segundos", sufixo: "s", nome: "Segundos", max: 59 },
  ] as const;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{rotulo}</span>

      <div role="group" aria-label={rotulo} className="flex items-end gap-1">
        {campos.map((campo, i) => (
          <div key={campo.chave} className="flex items-end gap-1">
            {i > 0 && <span aria-hidden className="pb-3 text-texto-fraco">:</span>}
            <label className="flex flex-1 flex-col gap-0.5">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={campo.max}
                value={partes[campo.chave]}
                onChange={(e) => aoMudar({ ...partes, [campo.chave]: e.target.value })}
                aria-label={`${rotulo} — ${campo.nome.toLowerCase()}`}
                placeholder="0"
                className={`${CLASSE_ENTRADA} text-center tabular-nums`}
              />
              <span aria-hidden className="text-center text-[0.68rem] text-texto-fraco">
                {campo.sufixo}
              </span>
            </label>
          </div>
        ))}
      </div>

      {dica !== undefined && erro === undefined && (
        <span className="text-xs leading-snug text-texto-fraco">{dica}</span>
      )}
      {erro !== undefined && <span className="text-xs leading-snug text-habito-vermelho">{erro}</span>}
    </div>
  );
}

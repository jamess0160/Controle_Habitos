/**
 * `🔥 8 ❄ 2` — a sequência e o estoque de congelamento de um hábito.
 *
 * Não existe número global de sequência no app: ele não dizia nada de útil, e o
 * [Mapa de telas](../Docs/mapas/Mapa%20de%20telas.md) o substituiu pela
 * sequência **na própria linha**. Duas linhas do mesmo hábito fixo mostram o
 * mesmo valor, porque a sequência é do hábito e não da ocorrência.
 *
 * O ❄ desaparece com estoque zero em vez de virar `❄ 0`: um hábito sem
 * congelamento configurado nunca mostra o floco, e um com estoque vazio também
 * não tem o que oferecer.
 *
 * Aqui os dois glifos são emoji coloridos de propósito — eles são rótulo, não a
 * marca de estado de [marca.tsx](marca.tsx), onde o floco é monocromático.
 */

type Props = {
  readonly atual: number;
  readonly congelamentos: number;
};

export function Sequencia({ atual, congelamentos }: Props) {
  return (
    <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-texto-fraco">
      <span className="flex items-center gap-1">
        <span aria-hidden>🔥</span>
        <span>{atual}</span>
        <span className="sr-only">
          {atual === 1 ? "1 interação em sequência" : `${atual} interações em sequência`}
        </span>
      </span>

      {congelamentos > 0 && (
        <span className="flex items-center gap-1">
          <span aria-hidden>❄️</span>
          <span>{congelamentos}</span>
          <span className="sr-only">
            {congelamentos === 1 ? "1 congelamento guardado" : `${congelamentos} congelamentos guardados`}
          </span>
        </span>
      )}
    </span>
  );
}

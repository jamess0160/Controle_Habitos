import type { Metadata } from "next";

export const metadata: Metadata = { title: "Hábitos" };

/** Marcador de lugar do shell (etapa 2.2) — ver [a tela Hoje](../page.tsx). */
export default function HabitosPage() {
  return (
    <main className="flex flex-1 flex-col gap-6 p-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Hábitos</h1>
        <p className="mt-0.5 text-xs uppercase tracking-widest text-texto-fraco">
          6 ativos · 1 arquivado
        </p>
      </header>

      <div className="rounded-xl border border-linha bg-cartao p-4">
        <p className="text-sm text-texto-fraco">
          A lista com reordenação por arraste e a seção recolhida de arquivados entram no próximo
          item, consumindo <code className="font-mono text-texto">GET /api/habitos</code>.
        </p>
      </div>
    </main>
  );
}

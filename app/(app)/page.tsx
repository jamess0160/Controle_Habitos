import type { Metadata } from "next";

export const metadata: Metadata = { title: "Hoje" };

/**
 * Marcador de lugar do shell (etapa 2.2).
 *
 * O dashboard de verdade — uma linha por interação devida, as quatro formas de
 * progresso, 🔥 e ❄ por hábito, o bloco de avisos — é o item seguinte do
 * roadmap, consumindo `GET /api/hoje`. Aqui só confirma que o shell monta:
 * barra, área segura e tema.
 */
export default function HojePage() {
  return (
    <main className="flex flex-1 flex-col gap-6 p-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Boa tarde, Tiago</h1>
        <p className="mt-0.5 text-xs uppercase tracking-widest text-texto-fraco">
          Terça, 10 de novembro
        </p>
      </header>

      <div className="rounded-xl border border-linha bg-cartao p-4">
        <p className="text-sm text-texto-fraco">
          O dashboard entra no próximo item da etapa 2, consumindo{" "}
          <code className="font-mono text-texto">GET /api/hoje</code>.
        </p>
      </div>
    </main>
  );
}

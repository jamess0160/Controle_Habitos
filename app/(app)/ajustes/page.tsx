import type { Metadata } from "next";
import { SeletorDeTema } from "@/componentes/seletor-de-tema";

export const metadata: Metadata = { title: "Ajustes" };

/**
 * Ajustes — parcial na etapa 2.2.
 *
 * O seletor de tema aqui **é real**: é a quarta peça do shell da PWA, e é o
 * único lugar do app em que ela faz sentido morar. O resto da tela (biometria,
 * notificações, hora da virada, exportar, resetar) entra no próximo item,
 * consumindo `GET /api/config`.
 */
export default function AjustesPage() {
  return (
    <main className="flex flex-1 flex-col gap-6 p-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Ajustes</h1>
      </header>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold">Tema</h2>
          <p className="mt-0.5 text-xs text-texto-fraco">
            Em <strong className="font-medium text-texto">Sistema</strong>, acompanha a virada
            automática do celular ao anoitecer.
          </p>
        </div>
        <SeletorDeTema />
      </section>

      <div className="rounded-xl border border-linha bg-cartao p-4">
        <p className="text-sm text-texto-fraco">
          Biometria, notificações, hora da virada, exportação e reset entram no próximo item,
          consumindo <code className="font-mono text-texto">GET /api/config</code>.
        </p>
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import { TelaLogin } from "@/componentes/tela-login";

export const metadata: Metadata = { title: "Entrar" };

/**
 * `/login` — fora do grupo `(app)`, porque aqui não há barra de navegação: não
 * existe destino nenhum a oferecer a quem não entrou.
 *
 * A página é componente de servidor só para poder exportar `metadata`, que
 * componente de cliente não pode. A fronteira de `Suspense` que existia aqui saiu
 * na etapa 3.1 junto com os atalhos `?simular=…`: era `useSearchParams` que a
 * exigia, e sem o hook a tela volta a ser estática.
 */
export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Hábitos</h1>
        <p className="mt-1 text-sm text-texto-fraco">Acompanhamento diário, só seu.</p>
      </header>

      <TelaLogin />
    </main>
  );
}

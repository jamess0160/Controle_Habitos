import type { Metadata } from "next";
import { Suspense } from "react";
import { Carregando } from "@/componentes/estado-da-tela";
import { TelaLogin } from "@/componentes/tela-login";

export const metadata: Metadata = { title: "Entrar" };

/**
 * `/login` — fora do grupo `(app)`, porque aqui não há barra de navegação: não
 * existe destino nenhum a oferecer a quem não entrou.
 *
 * A página é componente de servidor só para poder exportar `metadata`, que
 * componente de cliente não pode. O `Suspense` é obrigatório: a tela lê
 * `useSearchParams` (os atalhos de simulação da etapa 2), e sem a fronteira o
 * Next recusa a pré-renderização.
 */
export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Hábitos</h1>
        <p className="mt-1 text-sm text-texto-fraco">Acompanhamento diário, só seu.</p>
      </header>

      <Suspense fallback={<Carregando linhas={1} />}>
        <TelaLogin />
      </Suspense>
    </main>
  );
}

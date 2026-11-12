import type { Metadata } from "next";
import { TelaBiometria } from "@/componentes/tela-biometria";

export const metadata: Metadata = { title: "Cadastrar biometria" };

/**
 * `/biometria` — fora do grupo `(app)` como o login, e pelo mesmo motivo: é a
 * tela em que a sessão do primeiro acesso fica presa, e oferecer os três
 * destinos da barra aqui seria oferecer caminhos que a guarda recusa.
 */
export default function BiometriaPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Biometria</h1>
        <p className="mt-1 text-sm text-texto-fraco">O último passo do primeiro acesso.</p>
      </header>

      <TelaBiometria />
    </main>
  );
}

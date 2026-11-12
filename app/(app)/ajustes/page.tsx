import type { Metadata } from "next";
import { TelaAjustes } from "@/componentes/tela-ajustes";

export const metadata: Metadata = { title: "Ajustes" };

export default function AjustesPage() {
  return (
    <main className="flex flex-1 flex-col p-4">
      <TelaAjustes />
    </main>
  );
}

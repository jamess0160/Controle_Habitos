import type { Metadata } from "next";
import { TelaHoje } from "@/componentes/tela-hoje";

export const metadata: Metadata = { title: "Hoje" };

export default function HojePage() {
  return (
    <main className="flex flex-1 flex-col p-4">
      <TelaHoje />
    </main>
  );
}

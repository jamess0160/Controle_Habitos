import type { Metadata } from "next";
import { TelaHabitos } from "@/componentes/tela-habitos";

export const metadata: Metadata = { title: "Hábitos" };

export default function HabitosPage() {
  return (
    <main className="flex flex-1 flex-col p-4">
      <TelaHabitos />
    </main>
  );
}

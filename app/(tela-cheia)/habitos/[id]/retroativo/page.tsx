import type { Metadata } from "next";
import { Suspense } from "react";
import { CabecalhoDeTarefa } from "@/componentes/cabecalho-de-tarefa";
import { Carregando } from "@/componentes/estado-da-tela";
import { TelaRetroativo } from "@/componentes/tela-retroativo";

export const metadata: Metadata = { title: "Últimos 7 dias" };

/**
 * `/habitos/:id/retroativo` — a tela de correção, aberta pelo toque numa linha
 * do dashboard ou pela lista.
 *
 * O cabeçalho verdadeiro é desenhado pelo componente de cliente, porque o título
 * é o **nome do hábito** e ele só chega com a resposta. O daqui é o do
 * `fallback`: existe para a fronteira do `<Suspense>` ter o que pré-renderizar —
 * ver a nota na página de edição sobre por que a fronteira é obrigatória.
 */
export default function RetroativoPage() {
  return (
    <Suspense
      fallback={
        <>
          <CabecalhoDeTarefa titulo="Últimos 7 dias" voltarPara="/" />
          <div className="p-4">
            <Carregando linhas={4} />
          </div>
        </>
      }
    >
      <TelaRetroativo />
    </Suspense>
  );
}

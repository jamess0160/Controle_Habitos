import type { Metadata } from "next";
import { Suspense } from "react";
import { CabecalhoDeTarefa } from "@/componentes/cabecalho-de-tarefa";
import { Carregando } from "@/componentes/estado-da-tela";
import { TelaEdicao } from "@/componentes/tela-edicao";

export const metadata: Metadata = { title: "Editar hábito" };

/**
 * `/habitos/:id/editar`.
 *
 * O `<Suspense>` é obrigatório, não decoração: com `cacheComponents` ligado,
 * **qualquer** leitura do `:id` tira a rota da pré-renderização se não estiver
 * dentro de uma fronteira — vale para `await params` numa página de servidor e
 * também para `useParams` num componente de cliente (`CLIENT_HOOK_DYNAMIC`).
 *
 * Com a fronteira aqui, o cabeçalho é estático e pinta na hora, e só o
 * formulário — que depende do `:id` — espera. É o que se quer numa PWA
 * instalada: nenhuma tela em branco enquanto o servidor pensa.
 */
export default function EditarHabitoPage() {
  return (
    <>
      <CabecalhoDeTarefa
        titulo="Editar hábito"
        subtitulo="A mudança vale a partir de hoje"
        voltarPara="/habitos"
        rotuloDaVolta="Voltar para a lista"
      />
      <Suspense
        fallback={
          <div className="p-4">
            <Carregando linhas={2} />
          </div>
        }
      >
        <TelaEdicao />
      </Suspense>
    </>
  );
}

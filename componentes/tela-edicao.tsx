"use client";

import { useParams } from "next/navigation";
import { useRecurso } from "@/cliente/api";
import type { Habito } from "@/contracts";
import { Carregando, Erro } from "./estado-da-tela";
import { FormularioDeHabito } from "./formulario-habito";

/**
 * Edição: o mesmo formulário, com o hábito carregado antes.
 *
 * O formulário é o mesmo arquivo porque as diferenças são duas e pequenas — o
 * tipo vira somente-leitura e aparece o aviso de versionamento. Duplicar a tela
 * para isso daria dois formulários divergindo a cada campo novo.
 *
 * O rascunho é montado **uma vez**, no estado inicial do formulário. Por isso o
 * `GET` tem de terminar antes de ele existir: montado com o hábito vazio, o
 * formulário nasceria com os defaults de criação e nunca receberia os valores
 * salvos.
 *
 * O `:id` é lido com `useParams` e não recebido da página. Com `cacheComponents`
 * ligado, uma página que faz `await params` deixa de ser pré-renderizável e
 * passa a exigir `<Suspense>` em volta — e aqui não há ganho nenhum nisso: a
 * busca é no cliente de todo jeito. Lendo o parâmetro aqui, a página fica
 * estática e o esqueleto pinta antes de qualquer ida ao servidor, que é o que se
 * quer numa PWA instalada.
 */
export function TelaEdicao() {
  const { id } = useParams<{ id: string }>();
  const { recurso, recarregar } = useRecurso<Habito>(`/api/habitos/${id}`);

  if (recurso.estado === "carregando") {
    return (
      <div className="p-4">
        <Carregando linhas={2} />
      </div>
    );
  }

  if (recurso.estado === "erro") {
    return (
      <div className="p-4">
        <Erro falha={recurso.falha} aoTentarDeNovo={() => void recarregar()} />
      </div>
    );
  }

  return <FormularioDeHabito habito={recurso.dados} />;
}

import type { Metadata } from "next";
import { CabecalhoDeTarefa } from "@/componentes/cabecalho-de-tarefa";
import { FormularioDeHabito } from "@/componentes/formulario-habito";

export const metadata: Metadata = { title: "Novo hábito" };

export default function NovoHabitoPage() {
  return (
    <>
      <CabecalhoDeTarefa
        titulo="Novo hábito"
        subtitulo="Começa a valer hoje"
        voltarPara="/habitos"
        rotuloDaVolta="Voltar para a lista"
      />
      <FormularioDeHabito habito={null} />
    </>
  );
}

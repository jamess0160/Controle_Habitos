"use client";

import Link from "next/link";
import { useState } from "react";
import { enviar, useRecurso, type Falha } from "@/cliente/api";
import { dataCurta, dataLonga, SAUDACAO_TEXTO } from "@/cliente/formato";
import type { Aviso, Hoje, LinhaDeHoje, Progresso, RegistroCriado } from "@/contracts";
import { Carregando, Erro } from "./estado-da-tela";
import { Mais } from "./icones";
import { LinhaDeHojeItem, type PedidoDeRegistro } from "./linha-de-hoje";
import { classeDeBotao, TituloDeSecao } from "./ui";

/**
 * Dashboard — "Hoje".
 *
 * Foco no que é devido hoje, com a sequência de **cada hábito na própria linha**:
 * não existe número global de sequência, que não dizia nada de útil.
 *
 * A saudação vem do servidor pela **hora de parede**, não pelo dia lógico — à
 * 01:00 é "boa noite" ainda que o dia lógico seja o anterior. É o tipo de conta
 * que o cliente não faz: o relógio do celular não é fonte confiável para a
 * virada das 04:00.
 */

export function TelaHoje() {
  const { recurso, recarregar, definir } = useRecurso<Hoje>("/api/hoje");
  const [ocupado, setOcupado] = useState(false);
  const [falha, setFalha] = useState<Falha | null>(null);
  const [avisosOcultos, setAvisosOcultos] = useState<string[]>([]);

  if (recurso.estado === "carregando") {
    return <Carregando />;
  }

  if (recurso.estado === "erro") {
    return <Erro falha={recurso.falha} aoTentarDeNovo={() => void recarregar()} />;
  }

  const hoje = recurso.dados;

  async function registrar(linha: LinhaDeHoje, pedido: PedidoDeRegistro) {
    setFalha(null);
    setOcupado(true);

    const r = await enviar<RegistroCriado>("/api/registros", "POST", {
      habitoId: linha.habitoId,
      ocorrenciaId: linha.ocorrenciaId,
      valor: pedido.valor,
      origem: pedido.origem ?? "app",
    });

    setOcupado(false);

    if (!r.ok) {
      setFalha(r.falha);
      return;
    }

    definir(comEfeitos(hoje, linha, r.dados));
  }

  const avisos = hoje.avisos.filter((a) => !avisosOcultos.includes(chaveDeAviso(a)));
  const tudoCumprido = hoje.linhas.length > 0 && hoje.linhas.every((l) => l.concluida);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">
          {SAUDACAO_TEXTO[hoje.saudacao]}, {hoje.usuarioNome}
        </h1>
        <p className="mt-0.5 text-xs uppercase tracking-widest text-texto-fraco">
          {dataLonga(hoje.dataLogica)}
        </p>
      </header>

      {falha !== null && (
        <p role="alert" className="text-sm text-habito-vermelho">
          {falha.mensagem}
        </p>
      )}

      {hoje.linhas.length === 0 ? (
        <SemHabitos />
      ) : (
        <section className="flex flex-col gap-2">
          <TituloDeSecao>Hoje</TituloDeSecao>

          {/*
            O dia fechado é dito, não deduzido de uma lista toda preenchida: a
            confirmação explícita é o que distingue "terminei" de "não carregou".
          */}
          {tudoCumprido && (
            <p className="px-1 pb-1 text-sm text-texto-fraco">
              Tudo cumprido hoje. Nada mais devido até a virada das 04:00.
            </p>
          )}

          <ul className="flex flex-col gap-2">
            {hoje.linhas.map((linha) => (
              <LinhaDeHojeItem
                key={`${linha.habitoId}:${linha.ocorrenciaId ?? "flexivel"}`}
                linha={linha}
                ocupado={ocupado}
                aoRegistrar={(pedido) => void registrar(linha, pedido)}
              />
            ))}
          </ul>
        </section>
      )}

      {avisos.length > 0 && (
        <section className="flex flex-col gap-2">
          <TituloDeSecao>Avisos</TituloDeSecao>
          <ul className="flex flex-col gap-2">
            {avisos.map((aviso) => (
              <AvisoItem
                key={chaveDeAviso(aviso)}
                aviso={aviso}
                aoDispensar={() =>
                  setAvisosOcultos((ocultos) => [...ocultos, chaveDeAviso(aviso)])
                }
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Nenhum hábito cadastrado: a tela leva ao cadastro em vez de ficar vazia. */
function SemHabitos() {
  return (
    <div className="flex flex-col items-start gap-4 rounded-xl border border-linha bg-cartao p-5">
      <div>
        <h2 className="text-base font-semibold">Nada por aqui ainda</h2>
        <p className="mt-1 text-sm leading-relaxed text-texto-fraco">
          Crie o primeiro hábito e ele aparece nesta tela todo dia em que for devido. O emoji vai
          dentro do nome — <span className="whitespace-nowrap">💧 Água</span> — e é ele que
          identifica o hábito de relance.
        </p>
      </div>
      <Link href="/habitos/novo" className={classeDeBotao("primario")}>
        <Mais className="size-4" />
        Criar hábito
      </Link>
    </div>
  );
}

/**
 * Um aviso: informativo e dispensável.
 *
 * Ele conta o que **já aconteceu** — o congelamento foi gasto, a sequência caiu.
 * Não há nada a decidir no prazo, porque o consumo de congelamento é automático:
 * foi isso que aposentou o antigo bloco "em risco", que supunha uma decisão e um
 * prazo de resgate que não existem.
 *
 * Dispensar vale só para esta visita — não há campo no contrato para lembrar, e
 * inventar um `localStorage` aqui faria o aviso sumir num aparelho e ficar no
 * outro. O próximo `GET /api/hoje` traz os avisos que ainda valem.
 */
function AvisoItem({
  aviso,
  aoDispensar,
}: {
  readonly aviso: Aviso;
  readonly aoDispensar: () => void;
}) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-linha bg-cartao p-3">
      <span aria-hidden className="text-base leading-none">
        {aviso.tipo === "congelamento_usado" ? "❄️" : "🔥"}
      </span>

      <p className="flex-1 text-xs leading-relaxed text-texto-fraco">
        <strong className="font-medium text-texto">{aviso.habitoNome}</strong>
        {aviso.tipo === "congelamento_usado" ? (
          <>
            : um congelamento manteve a sequência no período que fechou em{" "}
            {dataCurta(aviso.periodoFim)}.{" "}
            {aviso.restantes === 0
              ? "Não resta nenhum guardado."
              : `Restam ${aviso.restantes} guardados.`}
          </>
        ) : (
          <>
            : a sequência de {aviso.sequenciaPerdida} caiu no período que fechou em{" "}
            {dataCurta(aviso.periodoFim)}.
          </>
        )}
      </p>

      <button
        type="button"
        onClick={aoDispensar}
        aria-label={`Dispensar aviso de ${aviso.habitoNome}`}
        className="-m-1 flex size-8 shrink-0 items-center justify-center rounded-full text-texto-fraco"
      >
        ✕
      </button>
    </li>
  );
}

function chaveDeAviso(aviso: Aviso): string {
  return `${aviso.tipo}:${aviso.habitoId}:${aviso.periodoFim}`;
}

// ─── Aplicação local dos efeitos ─────────────────────────────────────────────

/**
 * Redesenha as linhas com o que o servidor devolveu.
 *
 * `RegistroCriado.efeitos` existe exatamente para isto: a sequência e o estoque
 * de congelamento são **do hábito**, então um registro muda as duas linhas de um
 * hábito fixo de dois horários, não só a tocada. Recarregar o payload inteiro
 * depois de cada toque jogaria fora o que o contrato se deu o trabalho de
 * mandar — e acrescentaria uma ida ao servidor entre o toque e a resposta visual.
 */
function comEfeitos(hoje: Hoje, tocada: LinhaDeHoje, criado: RegistroCriado): Hoje {
  return {
    ...hoje,
    linhas: hoje.linhas.map((linha) => {
      if (linha.habitoId !== tocada.habitoId) return linha;

      const progresso = avancar(linha.progresso, criado.valor);

      return {
        ...linha,
        sequencia: criado.efeitos.sequencia.atual,
        congelamentos: criado.efeitos.congelamentosDisponiveis,
        progresso,
        /*
         * O negativo é avaliado no período inteiro, então a recaída muda todas as
         * linhas do hábito. Nos outros tipos, só a ocorrência tocada é concluída.
         */
        concluida:
          progresso.tipo === "negativo"
            ? progresso.recaidas <= progresso.tolerancia
            : linha.ocorrenciaId === tocada.ocorrenciaId || linha.concluida,
      };
    }),
  };
}

function avancar(progresso: Progresso, valor: number): Progresso {
  switch (progresso.tipo) {
    case "binario":
      return { ...progresso, concluidas: Math.min(progresso.meta, progresso.concluidas + 1) };
    case "quantificado":
    case "duracao":
      return { ...progresso, acumulado: progresso.acumulado + valor };
    case "negativo":
      return { ...progresso, recaidas: progresso.recaidas + 1 };
  }
}

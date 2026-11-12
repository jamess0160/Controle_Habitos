"use client";

import Link from "next/link";
import { useState } from "react";
import { enviar, useRecurso, type Falha } from "@/cliente/api";
import { dataCurta, dataDeHojeNoAparelho } from "@/cliente/formato";
import type { Habito, ListaDeHabitos } from "@/contracts";
import { CLASSE_COR } from "./cor";
import { Carregando, Erro } from "./estado-da-tela";
import { Mais } from "./icones";
import { Sequencia } from "./sequencia";
import { Botao, Campo, classeDeBotao, CLASSE_ENTRADA, Nota } from "./ui";

/**
 * Lista de hábitos.
 *
 * Todos os ativos com nome (emoji incluso), cor, o resumo da cadência em
 * linguagem natural, sequência e estoque de congelamento. Arquivados ficam numa
 * seção recolhida no fim — não há exclusão permanente neste app.
 *
 * A ordem é a de `habito.ordem`, a mesma do dashboard. **O arraste para
 * reordenar não está aqui**: ele persiste `habito.ordem` por
 * `PUT /api/habitos/ordem` e é item da etapa 3.2, junto do CRUD real.
 *
 * As quatro ações por linha devolvem o **hábito**, não `ok: true` — é o que
 * permite redesenhar só aquela linha em vez de recarregar a lista. Pausa e
 * arquivamento foram escritos assim no contrato exatamente por isso.
 */

export function TelaHabitos() {
  const { recurso, recarregar, definir } = useRecurso<ListaDeHabitos>("/api/habitos");
  const [falha, setFalha] = useState<Falha | null>(null);
  const [ocupado, setOcupado] = useState(false);

  if (recurso.estado === "carregando") {
    return <Carregando />;
  }

  if (recurso.estado === "erro") {
    return <Erro falha={recurso.falha} aoTentarDeNovo={() => void recarregar()} />;
  }

  const lista = recurso.dados;

  /** Troca um hábito de lugar entre ativos e arquivados conforme o que voltou. */
  function aplicar(atualizado: Habito) {
    const semEle = {
      habitos: lista.habitos.filter((h) => h.id !== atualizado.id),
      arquivados: lista.arquivados.filter((h) => h.id !== atualizado.id),
    };

    definir(
      atualizado.arquivadoEm === null
        ? {
            habitos: [...semEle.habitos, atualizado].sort((a, b) => a.ordem - b.ordem),
            arquivados: semEle.arquivados,
          }
        : {
            habitos: semEle.habitos,
            arquivados: [...semEle.arquivados, atualizado].sort((a, b) => a.ordem - b.ordem),
          },
    );
  }

  async function agir(url: string, metodo: string, corpo?: unknown) {
    setFalha(null);
    setOcupado(true);

    const r = await enviar<Habito>(url, metodo, corpo);

    setOcupado(false);

    if (!r.ok) {
      setFalha(r.falha);
      return;
    }

    aplicar(r.dados);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Hábitos</h1>
          <p className="mt-0.5 text-xs uppercase tracking-widest text-texto-fraco">
            {lista.habitos.length} {lista.habitos.length === 1 ? "ativo" : "ativos"}
            {lista.arquivados.length > 0 && ` · ${lista.arquivados.length} arquivado`}
            {lista.arquivados.length > 1 && "s"}
          </p>
        </div>

        <Link href="/habitos/novo" className={classeDeBotao("primario")}>
          <Mais className="size-4" />
          Novo
        </Link>
      </header>

      {falha !== null && (
        <p role="alert" className="text-sm text-habito-vermelho">
          {falha.mensagem}
        </p>
      )}

      {lista.habitos.length === 0 ? (
        <Nota tom="forte">
          Nenhum hábito ativo. Crie o primeiro em <strong className="text-texto">Novo</strong> — ou
          desarquive um lá embaixo.
        </Nota>
      ) : (
        <ul className="flex flex-col gap-2">
          {lista.habitos.map((habito) => (
            <CartaoDeHabito key={habito.id} habito={habito} ocupado={ocupado} aoAgir={agir} />
          ))}
        </ul>
      )}

      {lista.arquivados.length > 0 && (
        <details className="rounded-xl border border-linha bg-cartao">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium">
            Arquivados ({lista.arquivados.length})
          </summary>
          <ul className="flex flex-col gap-2 border-t border-linha p-2">
            {lista.arquivados.map((habito) => (
              <CartaoDeHabito key={habito.id} habito={habito} ocupado={ocupado} aoAgir={agir} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * Um hábito na lista.
 *
 * Pausado fica a **52% de opacidade** — a marca de `pausado` da paleta. É o
 * tratamento que sobrou depois de a paleta Esmalte gastar os seis matizes nos
 * hábitos: não há cor livre para dizer "este está suspenso", e a opacidade diz
 * sem competir com a cor do próprio hábito.
 */
function CartaoDeHabito({
  habito,
  ocupado,
  aoAgir,
}: {
  readonly habito: Habito;
  readonly ocupado: boolean;
  readonly aoAgir: (url: string, metodo: string, corpo?: unknown) => void;
}) {
  const [pausando, setPausando] = useState(false);
  const arquivado = habito.arquivadoEm !== null;
  const pausado = habito.pausa !== null;

  return (
    <li
      className={`flex overflow-hidden rounded-xl border border-linha bg-cartao ${pausado ? "opacity-[0.52]" : ""}`}
    >
      {/* O filete de 3 px na cor do hábito: marca, não texto. */}
      <span aria-hidden className={`w-[3px] shrink-0 ${CLASSE_COR[habito.cor].fundo}`} />

      <div className="min-w-0 flex-1 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{habito.nome}</p>
            <p className="mt-0.5 truncate text-xs text-texto-fraco">{habito.resumo}</p>
          </div>
          <Sequencia atual={habito.sequencia.atual} congelamentos={habito.congelamentosDisponiveis} />
        </div>

        {pausado && habito.pausa !== null && (
          <p className="mt-2 text-xs text-texto-fraco">
            Pausado desde {dataCurta(habito.pausa.de)}
            {habito.pausa.ate === null ? " (sem data de retorno)" : ` até ${dataCurta(habito.pausa.ate)}`}
          </p>
        )}

        {pausando ? (
          <FormularioDePausa
            ocupado={ocupado}
            aoCancelar={() => setPausando(false)}
            aoPausar={(corpo) => {
              setPausando(false);
              aoAgir(`/api/habitos/${habito.id}/pausa`, "POST", corpo);
            }}
          />
        ) : (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {arquivado ? (
              <AcaoDeLinha
                rotulo="Desarquivar"
                ocupado={ocupado}
                aoClicar={() => aoAgir(`/api/habitos/${habito.id}/arquivo`, "DELETE")}
              />
            ) : (
              <>
                <Link href={`/habitos/${habito.id}/editar`} className="min-h-11 py-3 font-medium">
                  Editar
                </Link>
                <Link
                  href={`/habitos/${habito.id}/retroativo`}
                  className="min-h-11 py-3 font-medium"
                >
                  7 dias
                </Link>
                {pausado ? (
                  <AcaoDeLinha
                    rotulo="Retomar"
                    ocupado={ocupado}
                    aoClicar={() => aoAgir(`/api/habitos/${habito.id}/pausa`, "DELETE")}
                  />
                ) : (
                  <AcaoDeLinha
                    rotulo="Pausar"
                    ocupado={ocupado}
                    aoClicar={() => setPausando(true)}
                  />
                )}
                <AcaoDeLinha
                  rotulo="Arquivar"
                  ocupado={ocupado}
                  aoClicar={() => aoAgir(`/api/habitos/${habito.id}/arquivo`, "POST")}
                />
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function AcaoDeLinha({
  rotulo,
  ocupado,
  aoClicar,
}: {
  readonly rotulo: string;
  readonly ocupado: boolean;
  readonly aoClicar: () => void;
}) {
  return (
    <button
      type="button"
      disabled={ocupado}
      onClick={aoClicar}
      className="min-h-11 py-3 font-medium text-texto-fraco disabled:opacity-50"
    >
      {rotulo}
    </button>
  );
}

/**
 * Pausa aberta ou agendada.
 *
 * A data de início é um campo, e não "agora": `pausarHabito` exige `de`, e o
 * cliente não tem como saber o dia lógico — às 02:00 o dia lógico ainda é o de
 * ontem. Então o palpite do aparelho entra **visível e corrigível** no campo, em
 * vez de ser aplicado em silêncio. Vale uma revisão na etapa 3.2: `de` opcional
 * resolveria isso do mesmo jeito que `criarRegistro.dataLogica` resolve.
 */
function FormularioDePausa({
  ocupado,
  aoCancelar,
  aoPausar,
}: {
  readonly ocupado: boolean;
  readonly aoCancelar: () => void;
  readonly aoPausar: (corpo: { de: string; ate: string | null }) => void;
}) {
  const [de, setDe] = useState(dataDeHojeNoAparelho);
  const [ate, setAte] = useState("");

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-linha pt-3">
      <Campo rotulo="Pausar a partir de">
        <input
          type="date"
          value={de}
          onChange={(e) => setDe(e.target.value)}
          className={CLASSE_ENTRADA}
        />
      </Campo>
      <Campo rotulo="Até" dica="Em branco, a pausa fica aberta até você retomar.">
        <input
          type="date"
          value={ate}
          min={de}
          onChange={(e) => setAte(e.target.value)}
          className={CLASSE_ENTRADA}
        />
      </Campo>
      <div className="flex gap-2">
        <Botao
          variante="primario"
          disabled={ocupado || de === ""}
          onClick={() => aoPausar({ de, ate: ate === "" ? null : ate })}
        >
          Pausar
        </Botao>
        <Botao variante="fantasma" onClick={aoCancelar}>
          Cancelar
        </Botao>
      </div>
      <p className="text-xs leading-snug text-texto-fraco">
        Durante a pausa não há período nem vencimento — a sequência fica parada, não cai. Em hábito
        &quot;a cada N dias&quot; a contagem recomeça na retomada.
      </p>
    </div>
  );
}

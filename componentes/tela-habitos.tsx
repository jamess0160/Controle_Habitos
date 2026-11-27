"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { enviar, useRecurso, type Falha } from "@/cliente/api";
import { dataCurta, dataDeHojeNoAparelho } from "@/cliente/formato";
import type { HabitoApagado, Habito, HistoricoDoHabito, ListaDeHabitos } from "@/contracts";
import { CLASSE_COR } from "./cor";
import { Carregando, Erro } from "./estado-da-tela";
import { Mais } from "./icones";
import { indiceSobre, mover, ordemDe } from "./reordenar";
import { Sequencia } from "./sequencia";
import { Botao, Campo, classeDeBotao, CLASSE_ENTRADA, Nota } from "./ui";

/**
 * Lista de hábitos.
 *
 * Todos os ativos com nome (emoji incluso), cor, o resumo da cadência em
 * linguagem natural, sequência e estoque de congelamento. Arquivados ficam numa
 * seção recolhida no fim, e é **só** lá que a exclusão aparece: apagar exige
 * arquivar primeiro, para a única ação irreversível do app não ficar a um toque
 * de distância. Ver `PainelDeExclusao`.
 *
 * A ordem é a de `habito.ordem`, a mesma do dashboard, e o arraste a persiste por
 * `PUT /api/habitos/ordem`.
 *
 * **O arraste usa Pointer Events, não a API de arrastar do HTML5.** `draggable`
 * simplesmente não dispara em toque no iOS e no Android, e este app é usado no
 * celular — seria um recurso que só funciona no desktop. O ponteiro unifica os
 * dois: o mesmo código atende dedo, mouse e caneta.
 *
 * A alça tem `touch-action: none` e só ela: arrastar pela alça não rola a página,
 * e o resto da linha continua rolando normalmente. Sem essa separação, o gesto de
 * reordenar e o de rolar disputariam o mesmo toque.
 *
 * Para quem não arrasta — teclado, leitor de tela — as mesmas posições se movem
 * pelos botões ↑ e ↓ da alça, que chamam a mesma função.
 *
 * As quatro ações por linha devolvem o **hábito**, não `ok: true` — é o que
 * permite redesenhar só aquela linha em vez de recarregar a lista. Pausa e
 * arquivamento foram escritos assim no contrato exatamente por isso.
 *
 * Apagar é a exceção, e tem de ser: não há hábito para devolver. Ele devolve o
 * que foi destruído (`habitoApagado`) e a tela remove o id das duas listas.
 */

/**
 * `3 marcações` / `1 marcação`.
 *
 * Local, e não o `plural()` de `contracts/resumo.ts`: aquele é privado do módulo
 * da frase da regra, e exportá-lo misturaria vocabulário de contrato com texto
 * de tela.
 */
function contagem(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function TelaHabitos() {
  const { recurso, recarregar, definir } = useRecurso<ListaDeHabitos>("/api/habitos");
  const [falha, setFalha] = useState<Falha | null>(null);
  /** Só a exclusão produz aviso: é a única ação cujo efeito não se vê na lista. */
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  if (recurso.estado === "carregando") {
    return <Carregando />;
  }

  if (recurso.estado === "erro") {
    return <Erro falha={recurso.falha} aoTentarDeNovo={() => void recarregar()} />;
  }

  const lista = recurso.dados;

  /**
   * Persiste a ordem depois do gesto, não durante.
   *
   * Um `PUT` por quadro de `pointermove` seria dezenas de chamadas por arraste, e
   * a lista já é redesenhada localmente — o servidor só precisa saber onde o
   * dedo parou. A resposta traz a lista como ficou, que é o que confirma o
   * estado otimista.
   */
  async function persistirOrdem(ordenados: Habito[]) {
    definir({ ...lista, habitos: ordenados });
    setFalha(null);

    const r = await enviar<ListaDeHabitos>("/api/habitos/ordem", "PUT", {
      ordem: ordemDe(ordenados),
    });

    if (!r.ok) {
      setFalha(r.falha);
      /* Volta ao que o servidor tem: ordem otimista que não gravou é mentira. */
      void recarregar();
      return;
    }

    definir(r.dados);
  }

  /** O ↑/↓ da alça: mesma conta do arraste, por um passo. */
  function moverUm(id: string, direcao: -1 | 1) {
    const de = lista.habitos.findIndex((h) => h.id === id);
    if (de < 0) return;

    const para = de + direcao;
    if (para < 0 || para >= lista.habitos.length) return;

    void persistirOrdem(mover(lista.habitos, de, para));
  }

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
    setAviso(null);
    setOcupado(true);

    const r = await enviar<Habito>(url, metodo, corpo);

    setOcupado(false);

    if (!r.ok) {
      setFalha(r.falha);
      return;
    }

    aplicar(r.dados);
  }

  /**
   * Apagar não passa por `agir`.
   *
   * As outras quatro ações devolvem o **hábito** e `aplicar()` o recoloca na
   * lista certa pelo `arquivadoEm` que voltou. Aqui não volta hábito nenhum —
   * ele deixou de existir —, então o caminho é remover o id das duas listas.
   * Reaproveitar `aplicar` com um objeto sintético seria o jeito de o hábito
   * apagado reaparecer na tela.
   *
   * O aviso de sucesso repete os números que a confirmação mostrou: é a única
   * ação sem volta do app, e ver o que foi destruído fecha o ciclo.
   */
  async function apagar(habito: Habito) {
    setFalha(null);
    setAviso(null);
    setOcupado(true);

    const r = await enviar<HabitoApagado>(`/api/habitos/${habito.id}`, "DELETE");

    setOcupado(false);

    if (!r.ok) {
      setFalha(r.falha);
      return;
    }

    definir({
      habitos: lista.habitos.filter((h) => h.id !== r.dados.id),
      arquivados: lista.arquivados.filter((h) => h.id !== r.dados.id),
    });

    setAviso(
      `${r.dados.nome} foi apagado, com ${contagem(r.dados.historico.registros, "marcação", "marcações")}.`,
    );
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

      {aviso !== null && (
        <p role="status" className="text-sm text-texto-fraco">
          {aviso}
        </p>
      )}

      {lista.habitos.length === 0 ? (
        <Nota tom="forte">
          Nenhum hábito ativo. Crie o primeiro em <strong className="text-texto">Novo</strong> — ou
          desarquive um lá embaixo.
        </Nota>
      ) : (
        <ListaArrastavel
          habitos={lista.habitos}
          ocupado={ocupado}
          aoAgir={agir}
          aoReordenar={persistirOrdem}
          aoMoverUm={moverUm}
        />
      )}

      {lista.arquivados.length > 0 && (
        <details className="rounded-xl border border-linha bg-cartao">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium">
            Arquivados ({lista.arquivados.length})
          </summary>
          <ul className="flex flex-col gap-2 border-t border-linha p-2">
            {lista.arquivados.map((habito) => (
              <CartaoDeHabito
                key={habito.id}
                habito={habito}
                ocupado={ocupado}
                aoAgir={agir}
                aoApagar={() => void apagar(habito)}
              />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * A lista dos ativos, arrastável.
 *
 * O arraste acontece **só no estado local** (`ordem`), e o servidor é chamado
 * uma vez no `pointerup`. Durante o gesto a lista do recurso não é tocada: um
 * `definir()` por quadro faria o componente remontar e perder a captura do
 * ponteiro no meio do movimento.
 */
function ListaArrastavel({
  habitos,
  ocupado,
  aoAgir,
  aoReordenar,
  aoMoverUm,
}: {
  readonly habitos: Habito[];
  readonly ocupado: boolean;
  readonly aoAgir: (url: string, metodo: string, corpo?: unknown) => void;
  readonly aoReordenar: (ordenados: Habito[]) => void;
  readonly aoMoverUm: (id: string, direcao: -1 | 1) => void;
}) {
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [ordem, setOrdem] = useState<Habito[] | null>(null);
  const itens = useRef(new Map<string, HTMLLIElement>());

  /* Durante o gesto vale a ordem local; fora dele, a do servidor. */
  const visivel = ordem ?? habitos;

  function centros(atual: Habito[]): number[] {
    return atual.map((h) => {
      const elemento = itens.current.get(h.id);
      if (elemento === undefined) return Number.POSITIVE_INFINITY;
      const caixa = elemento.getBoundingClientRect();
      return caixa.top + caixa.height / 2;
    });
  }

  function aoPegar(evento: React.PointerEvent, id: string) {
    /*
     * `setPointerCapture` na própria alça: sem ela, o `pointermove` para de
     * chegar no instante em que o dedo sai de cima do elemento — que é a primeira
     * coisa que acontece ao arrastar.
     */
    evento.currentTarget.setPointerCapture(evento.pointerId);
    setArrastando(id);
    setOrdem(habitos);
  }

  function aoMover(evento: React.PointerEvent) {
    if (arrastando === null || ordem === null) return;

    const de = ordem.findIndex((h) => h.id === arrastando);
    const para = indiceSobre(centros(ordem), evento.clientY);

    if (de === para) return;

    setOrdem(mover(ordem, de, para));
  }

  function aoSoltar() {
    if (arrastando === null || ordem === null) return;

    const mudou = ordem.some((h, i) => h.id !== habitos[i]?.id);

    setArrastando(null);
    const resultado = ordem;
    setOrdem(null);

    /* Soltar no mesmo lugar não é edição: não gasta uma chamada. */
    if (mudou) aoReordenar(resultado);
  }

  return (
    <ul className="flex flex-col gap-2">
      {visivel.map((habito, i) => (
        <CartaoDeHabito
          key={habito.id}
          habito={habito}
          ocupado={ocupado}
          aoAgir={aoAgir}
          arrastando={arrastando === habito.id}
          aoRegistrarElemento={(elemento) => {
            if (elemento === null) itens.current.delete(habito.id);
            else itens.current.set(habito.id, elemento);
          }}
          alca={
            <Alca
              nome={habito.nome}
              posicao={i + 1}
              total={visivel.length}
              ocupado={ocupado}
              aoPegar={(evento) => aoPegar(evento, habito.id)}
              aoMover={aoMover}
              aoSoltar={aoSoltar}
              aoSubir={() => aoMoverUm(habito.id, -1)}
              aoDescer={() => aoMoverUm(habito.id, 1)}
            />
          }
        />
      ))}
    </ul>
  );
}

/**
 * A alça: arraste por ponteiro e, para quem não arrasta, dois botões.
 *
 * `touch-action: none` fica **aqui** e não na linha: é o que permite arrastar
 * pela alça sem rolar a página, mantendo o resto da linha rolável. Aplicar na
 * linha inteira travaria a rolagem da tela.
 */
function Alca({
  nome,
  posicao,
  total,
  ocupado,
  aoPegar,
  aoMover,
  aoSoltar,
  aoSubir,
  aoDescer,
}: {
  readonly nome: string;
  readonly posicao: number;
  readonly total: number;
  readonly ocupado: boolean;
  readonly aoPegar: (evento: React.PointerEvent) => void;
  readonly aoMover: (evento: React.PointerEvent) => void;
  readonly aoSoltar: () => void;
  readonly aoSubir: () => void;
  readonly aoDescer: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center gap-0.5 py-1 pl-1">
      <button
        type="button"
        disabled={ocupado || posicao === 1}
        onClick={aoSubir}
        aria-label={`Mover ${nome} para cima`}
        className="flex size-7 items-center justify-center rounded text-xs text-texto-fraco disabled:opacity-30"
      >
        ↑
      </button>

      <div
        role="button"
        tabIndex={-1}
        aria-hidden
        onPointerDown={aoPegar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar}
        /*
         * `aria-hidden` e `tabIndex={-1}`: para leitor de tela e teclado, quem
         * reordena são os dois botões acima e abaixo, que dizem o que fazem. Uma
         * alça de arraste anunciada seria um controle sem como ser operado.
         */
        className="flex size-7 cursor-grab touch-none items-center justify-center text-texto-fraco"
      >
        ⠿
      </div>

      <button
        type="button"
        disabled={ocupado || posicao === total}
        onClick={aoDescer}
        aria-label={`Mover ${nome} para baixo`}
        className="flex size-7 items-center justify-center rounded text-xs text-texto-fraco disabled:opacity-30"
      >
        ↓
      </button>
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
  aoApagar,
  alca,
  arrastando = false,
  aoRegistrarElemento,
}: {
  readonly habito: Habito;
  readonly ocupado: boolean;
  readonly aoAgir: (url: string, metodo: string, corpo?: unknown) => void;
  /** Só nos arquivados: apagar exige arquivar primeiro, e o cartão ativo não oferece. */
  readonly aoApagar?: () => void;
  /** Ausente nos arquivados: ordem de arquivado não é ordem de nada. */
  readonly alca?: React.ReactNode;
  readonly arrastando?: boolean;
  readonly aoRegistrarElemento?: (elemento: HTMLLIElement | null) => void;
}) {
  const [pausando, setPausando] = useState(false);
  const [apagando, setApagando] = useState(false);
  const arquivado = habito.arquivadoEm !== null;
  const pausado = habito.pausa !== null;

  return (
    <li
      ref={aoRegistrarElemento}
      className={`flex overflow-hidden rounded-xl border bg-cartao ${
        arrastando ? "border-texto shadow-lg" : "border-linha"
      } ${pausado ? "opacity-[0.52]" : ""}`}
    >
      {/* O filete de 3 px na cor do hábito: marca, não texto. */}
      <span aria-hidden className={`w-[3px] shrink-0 ${CLASSE_COR[habito.cor].fundo}`} />

      {alca}

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
        ) : apagando && aoApagar !== undefined ? (
          <PainelDeExclusao
            habito={habito}
            ocupado={ocupado}
            aoCancelar={() => setApagando(false)}
            aoConfirmar={() => {
              setApagando(false);
              aoApagar();
            }}
          />
        ) : (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {arquivado ? (
              <>
                <AcaoDeLinha
                  rotulo="Desarquivar"
                  ocupado={ocupado}
                  aoClicar={() => aoAgir(`/api/habitos/${habito.id}/arquivo`, "DELETE")}
                />
                {aoApagar !== undefined && (
                  <AcaoDeLinha
                    rotulo="Apagar"
                    destrutivo
                    ocupado={ocupado}
                    aoClicar={() => setApagando(true)}
                  />
                )}
              </>
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
  destrutivo = false,
  aoClicar,
}: {
  readonly rotulo: string;
  readonly ocupado: boolean;
  /** Pinta o rótulo de vermelho. Só "Apagar" usa: é a única ação sem volta. */
  readonly destrutivo?: boolean;
  readonly aoClicar: () => void;
}) {
  return (
    <button
      type="button"
      disabled={ocupado}
      onClick={aoClicar}
      className={`min-h-11 py-3 font-medium disabled:opacity-50 ${
        destrutivo ? "text-habito-vermelho" : "text-texto-fraco"
      }`}
    >
      {rotulo}
    </button>
  );
}

/**
 * A confirmação de apagar, com o estrago em números.
 *
 * Dois toques, e o segundo é um botão destrutivo: apagar é a **única** operação
 * irreversível do app. Todo o resto é replay — editar, pausar, arquivar e
 * desmarcar recalculam a partir de `habito_config`, `registro` e a pausa —, e
 * daqui a volta é só a restauração do `pg_dump`, isto é, perder o que foi
 * registrado desde o backup da noite.
 *
 * Os números vêm de `GET /api/habitos/:id/historico` no momento do primeiro
 * toque, e não do payload da lista: a contagem exige um join e pagá-la em toda
 * abertura da tela seria caro para um dado usado aqui. Enquanto carrega, o botão
 * de confirmar **não** aparece — "tem certeza?" sem o número é a mesma pergunta
 * vazia que isto existe para não fazer.
 *
 * Se a contagem falhar, apagar continua possível: o número é informação, não
 * autorização. Mas a tela diz que não sabe, em vez de fingir um zero.
 */
function PainelDeExclusao({
  habito,
  ocupado,
  aoCancelar,
  aoConfirmar,
}: {
  readonly habito: Habito;
  readonly ocupado: boolean;
  readonly aoCancelar: () => void;
  readonly aoConfirmar: () => void;
}) {
  const { recurso } = useRecurso<HistoricoDoHabito>(`/api/habitos/${habito.id}/historico`);

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-linha pt-3">
      <p className="text-sm">
        Apagar <strong className="font-medium">{habito.nome}</strong>?
      </p>

      {recurso.estado === "carregando" && (
        <p className="text-xs text-texto-fraco">Contando o histórico…</p>
      )}

      {recurso.estado === "erro" && (
        <p className="text-xs text-texto-fraco">
          Não foi possível contar o histórico deste hábito — então não sei dizer quanto se perde.
          Apagar continua sem volta.
        </p>
      )}

      {recurso.estado === "pronto" && (
        <p className="text-xs leading-snug text-texto-fraco">
          {recurso.dados.registros === 0
            ? "Este hábito não tem nenhuma marcação."
            : `Isto apaga ${contagem(recurso.dados.registros, "marcação", "marcações")} em ${contagem(recurso.dados.dias, "dia", "dias")}`}
          {recurso.dados.registros > 0 && recurso.dados.primeiroEm !== null
            ? `, desde ${dataCurta(recurso.dados.primeiroEm)}.`
            : recurso.dados.registros > 0
              ? "."
              : ""}
          {habito.sequencia.recorde > 0 &&
            ` A sequência recorde de ${habito.sequencia.recorde} vai com ele.`}
          {" Não há como desfazer: só a restauração do backup."}
        </p>
      )}

      <div className="flex gap-2">
        <Botao
          variante="destrutivo"
          disabled={ocupado || recurso.estado === "carregando"}
          onClick={aoConfirmar}
        >
          Apagar para sempre
        </Botao>
        <Botao variante="fantasma" onClick={aoCancelar}>
          Cancelar
        </Botao>
      </div>
    </div>
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

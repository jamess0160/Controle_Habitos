"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { enviar, useRecurso, type Falha } from "@/cliente/api";
import { dataCurta, diaCurtoDe, numero } from "@/cliente/formato";
import type {
  Cor,
  DiaRetroativo,
  Efeitos,
  Meta,
  Retroativo,
  RetroativoAplicado,
  RegistroRemovido,
} from "@/contracts";
import { CabecalhoDeTarefa } from "./cabecalho-de-tarefa";
import { Carregando, Erro } from "./estado-da-tela";
import { Marca, type EstadoDaMarca } from "./marca";
import { Sequencia } from "./sequencia";
import { Botao, CLASSE_ENTRADA } from "./ui";

/**
 * Preenchimento retroativo — 7 dias lógicos, do mais recente para o mais antigo.
 *
 * Dias bloqueados aparecem **com o motivo visível**, não ausentes: sumir com o
 * dia deixaria a tela ambígua entre "não pode" e "não aconteceu".
 *
 * Três coisas que a tela precisa comunicar na hora, e todas as três vêm no
 * `efeitos` da resposta em vez de serem deduzidas comparando estados: a
 * sequência recalculada, o congelamento estornado, e — em `cada_n_dias` — o novo
 * vencimento.
 *
 * **A prévia é sempre pedida antes de aplicar.** O payload do retroativo não diz
 * a cadência do hábito, então a tela não sabe de antemão se o toque vai mover a
 * âncora; pedindo `previa: true` primeiro, ela descobre com o próprio servidor.
 * Quando vem `novoVencimento`, a confirmação aparece — é o aviso mais forte que o
 * mapa exige, porque ali o efeito vai muito além do dia tocado: mover a âncora
 * **re-encadeia todos os períodos seguintes**. Quando não vem, aplica direto.
 */

const MOTIVO: Record<NonNullable<DiaRetroativo["motivoBloqueio"]>, string> = {
  antes_do_inicio: "antes do início do hábito",
  em_pausa: "dentro de uma pausa",
  fora_da_janela: "fora da janela de 7 dias",
  nao_previsto: "não é dia deste hábito",
};

const MARCA_DE_ESTADO: Record<DiaRetroativo["estado"], EstadoDaMarca> = {
  cumprido: "cumprido",
  nao_cumprido: "aberto",
  congelado: "congelado",
  /* Bloqueado reaproveita a marca de falha: anel riscado, sem matiz. */
  bloqueado: "falhou",
};

type Confirmacao = {
  readonly dia: DiaRetroativo;
  readonly valor?: number;
  readonly efeitos: Efeitos;
};

export function TelaRetroativo() {
  /* `useParams` e não `await params` na página — ver a nota em [tela-edicao.tsx](tela-edicao.tsx). */
  const { id } = useParams<{ id: string }>();
  const url = `/api/habitos/${id}/retroativo`;
  const { recurso, recarregar, definir } = useRecurso<Retroativo>(url);

  const [ocupado, setOcupado] = useState(false);
  const [falha, setFalha] = useState<Falha | null>(null);
  const [efeitos, setEfeitos] = useState<Efeitos | null>(null);
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [diaComValor, setDiaComValor] = useState<string | null>(null);

  /*
   * O cabeçalho mora aqui e não na página porque o título é o **nome do hábito**,
   * que só existe depois da resposta — e porque o botão de voltar tem de existir
   * também nos estados de carregamento e de erro, que é justamente quando o
   * usuário mais precisa de saída.
   */
  if (recurso.estado === "carregando") {
    return (
      <>
        <CabecalhoDeTarefa titulo="Últimos 7 dias" voltarPara="/" />
        <div className="p-4">
          <Carregando linhas={4} />
        </div>
      </>
    );
  }

  if (recurso.estado === "erro") {
    return (
      <>
        <CabecalhoDeTarefa titulo="Últimos 7 dias" voltarPara="/" />
        <div className="p-4">
          <Erro falha={recurso.falha} aoTentarDeNovo={() => void recarregar()} />
        </div>
      </>
    );
  }

  const retro = recurso.dados;
  const pedeValor = retro.meta.tipo === "quantificado" || retro.meta.tipo === "duracao";

  function aplicarResposta(aplicado: RetroativoAplicado) {
    definir({ ...retro, dias: aplicado.dias });
    setEfeitos(aplicado.efeitos);
  }

  async function marcar(dia: DiaRetroativo, valor?: number) {
    setFalha(null);
    setEfeitos(null);
    setOcupado(true);

    const previa = await enviar<RetroativoAplicado>(url, "POST", {
      dataLogica: dia.dataLogica,
      valor,
      previa: true,
    });

    if (!previa.ok) {
      setOcupado(false);
      setFalha(previa.falha);
      return;
    }

    /*
     * Mover a âncora de `cada_n_dias` re-encadeia tudo: isso se confirma antes.
     *
     * Mas só quando ela **move**. `novoVencimento` vem preenchido em toda
     * resposta de hábito ancorado, inclusive quando o dia preenchido não é a
     * última conclusão e a cadeia fica onde estava — pedir confirmação ali
     * anunciaria uma mudança que não houve, e em duas telas de uso o aviso
     * perderia o sentido. A comparação é com o vencimento que a janela já
     * carrega, sem mais uma ida ao servidor.
     */
    const move =
      previa.dados.efeitos.novoVencimento !== null &&
      previa.dados.efeitos.novoVencimento !== retro.periodoAtual?.fim;

    if (move) {
      setOcupado(false);
      setConfirmacao({ dia, valor, efeitos: previa.dados.efeitos });
      return;
    }

    const r = await enviar<RetroativoAplicado>(url, "POST", {
      dataLogica: dia.dataLogica,
      valor,
      previa: false,
    });

    setOcupado(false);

    if (!r.ok) {
      setFalha(r.falha);
      return;
    }

    aplicarResposta(r.dados);
  }

  async function confirmar() {
    if (confirmacao === null) return;

    const { dia, valor } = confirmacao;
    setConfirmacao(null);
    setOcupado(true);

    const r = await enviar<RetroativoAplicado>(url, "POST", {
      dataLogica: dia.dataLogica,
      valor,
      previa: false,
    });

    setOcupado(false);

    if (!r.ok) {
      setFalha(r.falha);
      return;
    }

    aplicarResposta(r.dados);
  }

  /**
   * Desmarcar é apagar os registros do dia.
   *
   * `DELETE /api/registros/:id` devolve os `efeitos` mas não os sete dias, então
   * aqui a janela é recarregada depois — é a única das ações que precisa de uma
   * segunda ida ao servidor. Um dia pode ter mais de um registro (dois copos de
   * água), e desmarcar o dia significa apagar todos.
   */
  async function desmarcar(dia: DiaRetroativo) {
    setFalha(null);
    setEfeitos(null);
    setOcupado(true);

    let ultimos: Efeitos | null = null;

    for (const registroId of dia.registroIds) {
      const r = await enviar<RegistroRemovido>(`/api/registros/${registroId}`, "DELETE");

      if (!r.ok) {
        setOcupado(false);
        setFalha(r.falha);
        return;
      }

      ultimos = r.dados.efeitos;
    }

    recarregar();
    setOcupado(false);
    setEfeitos(ultimos);
  }

  return (
    <>
      <CabecalhoDeTarefa
        titulo={retro.nome}
        subtitulo="Últimos 7 dias"
        voltarPara="/"
        rotuloDaVolta="Voltar para hoje"
      />

      <div className="flex flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-3">
        <p className="text-sm text-texto-fraco">
          {retro.periodoAtual === null
            ? "Sem período aberto"
            : `${retro.periodoAtual.concluidas} de ${retro.periodoAtual.meta} até ${dataCurta(retro.periodoAtual.fim)}`}
        </p>
        <Sequencia atual={retro.sequencia.atual} congelamentos={retro.congelamentosDisponiveis} />
      </header>

      {falha !== null && (
        <p role="alert" className="text-sm text-habito-vermelho">
          {falha.mensagem}
        </p>
      )}

      {efeitos !== null && <BlocoDeEfeitos efeitos={efeitos} />}

      {confirmacao !== null && (
        <div className="flex flex-col gap-3 rounded-xl border border-linha-forte bg-cartao p-4">
          <p className="text-sm font-medium">Isto move o vencimento</p>
          <p className="text-xs leading-relaxed text-texto-fraco">
            Este hábito conta a partir da última conclusão, então mexer em{" "}
            {dataCurta(confirmacao.dia.dataLogica)} re-encadeia todos os períodos seguintes. O
            próximo vencimento passa a ser{" "}
            <strong className="font-medium text-texto">
              {dataCurta(confirmacao.efeitos.novoVencimento ?? "")}
            </strong>
            .
          </p>
          <div className="flex gap-2">
            <Botao variante="primario" disabled={ocupado} onClick={() => void confirmar()}>
              Confirmar
            </Botao>
            <Botao variante="fantasma" onClick={() => setConfirmacao(null)}>
              Cancelar
            </Botao>
          </div>
        </div>
      )}

      <ul className="flex flex-col divide-y divide-linha overflow-hidden rounded-xl border border-linha bg-cartao">
        {retro.dias.map((dia) => (
          <DiaItem
            key={dia.dataLogica}
            dia={dia}
            cor={retro.cor}
            meta={retro.meta}
            ocupado={ocupado}
            pedeValor={pedeValor}
            valorAberto={diaComValor === dia.dataLogica}
            aoPedirValor={() =>
              setDiaComValor(diaComValor === dia.dataLogica ? null : dia.dataLogica)
            }
            aoMarcar={(valor) => {
              setDiaComValor(null);
              void marcar(dia, valor);
            }}
            aoDesmarcar={() => void desmarcar(dia)}
          />
        ))}
      </ul>

      <p className="px-1 text-xs text-texto-fraco">
        A janela é de 7 dias lógicos e não anda para trás: o que ficou fora dela não é mais
        corrigível. É o único caminho de correção do app — não há prazo de resgate de sequência.
      </p>
      </div>
    </>
  );
}

/** O que mudou, dito na hora. */
function BlocoDeEfeitos({ efeitos }: { readonly efeitos: Efeitos }) {
  return (
    <div role="status" className="flex flex-col gap-1 rounded-xl border border-linha bg-cartao p-3">
      <p className="text-xs text-texto-fraco">
        Sequência recalculada:{" "}
        <strong className="font-medium text-texto">{efeitos.sequencia.atual}</strong> · estoque de
        congelamento:{" "}
        <strong className="font-medium text-texto">{efeitos.congelamentosDisponiveis}</strong>
      </p>
      {efeitos.congelamentoEstornado && (
        <p className="text-xs text-texto-fraco">
          Um congelamento voltou ao estoque — o período resgatado não precisou mais dele.
        </p>
      )}
      {efeitos.novoVencimento !== null && (
        <p className="text-xs text-texto-fraco">
          Novo vencimento:{" "}
          <strong className="font-medium text-texto">{dataCurta(efeitos.novoVencimento)}</strong>
        </p>
      )}
    </div>
  );
}

function DiaItem({
  dia,
  cor,
  meta,
  ocupado,
  pedeValor,
  valorAberto,
  aoPedirValor,
  aoMarcar,
  aoDesmarcar,
}: {
  readonly dia: DiaRetroativo;
  readonly cor: Cor;
  readonly meta: Meta;
  readonly ocupado: boolean;
  readonly pedeValor: boolean;
  readonly valorAberto: boolean;
  readonly aoPedirValor: () => void;
  readonly aoMarcar: (valor?: number) => void;
  readonly aoDesmarcar: () => void;
}) {
  const bloqueado = dia.estado === "bloqueado";
  /*
   * O que o toque faz num dia que já tem registro depende do tipo, e as duas
   * leituras erradas doem:
   *
   * - num dia **somável ainda curto** (250 de 2000 ml) o toque acrescenta, senão
   *   não haveria como completar o dia sem antes apagar o que já estava lá;
   * - em qualquer outro dia com registro o toque desfaz. Isso inclui o hábito
   *   `negativo`, onde o dia com registro é a recaída: sem esta regra, tocar o
   *   dia da escorregada registraria uma segunda.
   */
  const aceitaMais = pedeValor && dia.estado === "nao_cumprido";
  const podeDesmarcar = dia.registroIds.length > 0 && !aceitaMais;

  /*
   * `valor` é nulo no hábito negativo — o `1` do registro é convenção de
   * armazenamento, não quantidade —, então a contagem sai dos próprios ids. Sem
   * isto o dia da escorregada ficaria idêntico ao dia limpo, mudando só a marca.
   */
  const recaidas = meta.tipo === "negativo" ? dia.registroIds.length : 0;

  function aoTocar() {
    if (bloqueado) return;
    if (podeDesmarcar) {
      aoDesmarcar();
      return;
    }
    if (pedeValor) {
      aoPedirValor();
      return;
    }
    aoMarcar();
  }

  return (
    <li className={bloqueado ? "opacity-[0.52]" : undefined}>
      <button
        type="button"
        onClick={aoTocar}
        disabled={ocupado || bloqueado}
        className="flex min-h-14 w-full items-center gap-3 px-3 text-left"
        aria-label={`${diaCurtoDe(dia.dataLogica)} ${dataCurta(dia.dataLogica)}`}
      >
        <span className="w-20 shrink-0 text-sm tabular-nums">
          {diaCurtoDe(dia.dataLogica)} {dataCurta(dia.dataLogica)}
        </span>

        <span className="flex-1 text-xs text-texto-fraco">
          {dia.hoje && "hoje"}
          {bloqueado && dia.motivoBloqueio !== null && MOTIVO[dia.motivoBloqueio]}
          {dia.estado === "congelado" && "congelamento usado"}
          {recaidas > 0 && (recaidas === 1 ? "recaída" : `${recaidas} recaídas`)}
          {dia.valor !== null && `${numero(dia.valor)}${meta.tipo === "duracao" ? " min" : ""}`}
        </span>

        <Marca estado={MARCA_DE_ESTADO[dia.estado]} cor={cor} tamanho="toque" />
      </button>

      {valorAberto && <EntradaDeValor meta={meta} ocupado={ocupado} aoMarcar={aoMarcar} />}
    </li>
  );
}

/** Em `quantificado` e `duracao` o dia não alterna: ele recebe um valor. */
function EntradaDeValor({
  meta,
  ocupado,
  aoMarcar,
}: {
  readonly meta: Meta;
  readonly ocupado: boolean;
  readonly aoMarcar: (valor: number) => void;
}) {
  const sugestao =
    meta.tipo === "quantificado" ? meta.valor : meta.tipo === "duracao" ? meta.minutos : 1;
  const unidade = meta.tipo === "quantificado" ? meta.unidade : "min";

  const [valor, setValor] = useState(String(sugestao));
  const numerico = Number(valor);
  const valido = Number.isFinite(numerico) && numerico > 0;

  return (
    <div className="flex items-end gap-2 border-t border-linha p-3">
      <label className="flex-1">
        <span className="mb-1 block text-xs text-texto-fraco">Valor em {unidade}</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          className={`${CLASSE_ENTRADA} tabular-nums`}
        />
      </label>
      <Botao variante="primario" disabled={ocupado || !valido} onClick={() => aoMarcar(numerico)}>
        Registrar
      </Botao>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { fracaoDeProgresso, horaCurta, numero, passoDe, textoDeProgresso } from "@/cliente/formato";
import type { LinhaDeHoje, Origem } from "@/contracts";
import { CLASSE_COR } from "./cor";
import { Cronometro } from "./cronometro";
import { Marca } from "./marca";
import { Sequencia } from "./sequencia";
import { Botao, CLASSE_ENTRADA } from "./ui";

/**
 * Uma linha do dashboard: **uma interação devida**, não um hábito.
 *
 * Um hábito fixo com dois horários rende duas linhas, cada uma marcável, ambas
 * exibindo a mesma sequência — ela é do hábito, não da ocorrência. Por isso nada
 * aqui é indexado por `habitoId`, e por isso `GET /api/hoje` devolve `linhas` e
 * não `habitos`.
 *
 * A ação muda com o tipo, como manda o
 * [Mapa de telas](../Docs/mapas/Mapa%20de%20telas.md): `binario` marca direto no
 * toque, `quantificado` abre o incremento, `duracao` abre o cronômetro, e
 * `negativo` pede confirmação porque registrar recaída é destrutivo.
 *
 * **O negativo é a exceção que o `concluida` não descreve bem.** Ele nasce
 * cumprido — "sem recaída" é o estado inicial —, então a marca já vem preenchida
 * e a ação continua disponível.
 *
 * **Desfazer mora aqui, não só no retroativo.** Um toque por engano é o erro mais
 * provável de toda a tela, e `linha.ultimoRegistro` existe para corrigi-lo no
 * lugar: no `binario` a marca é alternância — toca e desmarca —, e nos outros
 * três o desfazer aparece dentro do painel, junto da ação que o criou. Vale só
 * para o último registro do dia; a janela de 7 dias continua sendo assunto do
 * retroativo.
 */

export type PedidoDeRegistro = { readonly valor?: number; readonly origem?: Origem };

type Props = {
  readonly linha: LinhaDeHoje;
  readonly ocupado: boolean;
  readonly aoRegistrar: (pedido: PedidoDeRegistro) => void;
  readonly aoDesmarcar: () => void;
};

export function LinhaDeHojeItem({ linha, ocupado, aoRegistrar, aoDesmarcar }: Props) {
  const [painelAberto, setPainelAberto] = useState(false);

  const tipo = linha.progresso.tipo;
  const podeDesfazer = linha.ultimoRegistro !== null;
  /*
   * A marca só fica inerte no caso em que nada pode acontecer: binário cumprido
   * sem registro conhecido para desfazer. Nos demais ela sempre faz algo —
   * marcar, desmarcar ou abrir o painel.
   */
  const inerte = tipo === "binario" && linha.concluida && !podeDesfazer;
  const fracao = fracaoDeProgresso(linha.progresso);

  function aoTocarNaMarca() {
    if (tipo === "binario") {
      if (linha.concluida) {
        if (podeDesfazer) aoDesmarcar();
        return;
      }

      aoRegistrar({});
      return;
    }

    setPainelAberto((aberto) => !aberto);
  }

  function desfazer() {
    setPainelAberto(false);
    aoDesmarcar();
  }

  function registrar(pedido: PedidoDeRegistro) {
    setPainelAberto(false);
    aoRegistrar(pedido);
  }

  const detalhe = [textoDeProgresso(linha.progresso)];
  if (linha.horario !== null) detalhe.push(horaCurta(linha.horario));

  return (
    <li className="overflow-hidden rounded-xl border border-linha bg-cartao">
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          onClick={aoTocarNaMarca}
          disabled={ocupado || inerte}
          /*
           * `size-11` é o alvo de toque (44 px) e a marca de 32 px mora dentro
           * dele: a área clicável não precisa ser do tamanho do desenho, e um
           * disco de 44 px dominaria a linha.
           */
          className="flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-100"
          aria-label={rotuloDaMarca(linha, podeDesfazer)}
        >
          <Marca estado={linha.concluida ? "cumprido" : "aberto"} cor={linha.cor} tamanho="toque" />
        </button>

        {/*
          O corpo da linha abre o retroativo daquele hábito. Desfazer o toque de
          hoje é aqui mesmo, na marca ou no painel; o retroativo é para o resto
          da janela de 7 dias, que esta linha não enxerga.
        */}
        <Link
          href={`/habitos/${linha.habitoId}/retroativo`}
          className="min-w-0 flex-1 py-1"
          aria-label={`Abrir os últimos 7 dias de ${linha.nome}`}
        >
          <span className="block truncate text-sm font-medium">{linha.nome}</span>
          <span className="mt-0.5 block truncate text-xs tabular-nums text-texto-fraco">
            {detalhe.join(" · ")}
          </span>
        </Link>

        <Sequencia atual={linha.sequencia} congelamentos={linha.congelamentos} />
      </div>

      {painelAberto && (
        <div className="border-t border-linha p-3">
          {linha.progresso.tipo === "quantificado" && (
            <PainelQuantificado
              meta={linha.progresso.meta}
              acumulado={linha.progresso.acumulado}
              unidade={linha.progresso.unidade}
              ocupado={ocupado}
              aoRegistrar={(valor) => registrar({ valor })}
            />
          )}

          {linha.progresso.tipo === "duracao" && (
            <PainelDuracao
              habitoId={linha.habitoId}
              ocupado={ocupado}
              aoRegistrar={(valor, origem) => registrar({ valor, origem })}
            />
          )}

          {linha.progresso.tipo === "negativo" && (
            <PainelRecaida
              nome={linha.nome}
              ocupado={ocupado}
              aoCancelar={() => setPainelAberto(false)}
              aoConfirmar={() => registrar({})}
            />
          )}

          {podeDesfazer && (
            <Desfazer linha={linha} ocupado={ocupado} aoDesmarcar={desfazer} />
          )}
        </div>
      )}

      {/*
        O filete de 3 px na cor do hábito. A paleta Esmalte foi medida para que as
        seis cores passem 3:1 contra o card — a régua de **marca** da WCAG 1.4.11,
        que é o que o filete e o disco são. Texto nunca é pintado com elas.
      */}
      {fracao !== null && (
        <div className="h-[3px] bg-trilha" aria-hidden>
          <div
            className={`h-full ${CLASSE_COR[linha.cor].fundo}`}
            style={{ width: `${Math.min(100, Math.max(0, fracao * 100))}%` }}
          />
        </div>
      )}
    </li>
  );
}

/**
 * O que a marca faz, dito para quem não a vê.
 *
 * Importa porque o mesmo disco cheio significa duas coisas diferentes: no
 * `binario` ele é um botão de desmarcar, e no `negativo` ele é o estado "sem
 * recaída" com a ação de registrar uma. Um rótulo só para os dois mentiria para
 * o leitor de tela.
 */
function rotuloDaMarca(linha: LinhaDeHoje, podeDesfazer: boolean): string {
  if (linha.progresso.tipo === "negativo") return `Registrar recaída em ${linha.nome}`;

  if (linha.progresso.tipo !== "binario") return `Registrar ${linha.nome}`;

  if (!linha.concluida) return `Marcar ${linha.nome}`;

  return podeDesfazer ? `Desmarcar ${linha.nome}` : `${linha.nome}: cumprido`;
}

/**
 * Desfazer o último registro do dia, dentro do painel.
 *
 * Fica junto da ação que o criou, e não numa área de "histórico": o erro que ele
 * conserta acabou de acontecer ali. O rótulo diz **quanto** vai voltar, porque
 * desfazer 250 ml e desfazer 700 ml são decisões diferentes e o número está no
 * payload — `linha.ultimoRegistro.valor`.
 */
function Desfazer({
  linha,
  ocupado,
  aoDesmarcar,
}: {
  readonly linha: LinhaDeHoje;
  readonly ocupado: boolean;
  readonly aoDesmarcar: () => void;
}) {
  const registro = linha.ultimoRegistro;
  if (registro === null) return null;

  const rotulo =
    linha.progresso.tipo === "quantificado"
      ? `Desfazer os últimos ${numero(registro.valor)} ${linha.progresso.unidade}`
      : linha.progresso.tipo === "duracao"
        ? `Desfazer os últimos ${numero(registro.valor)} min`
        : linha.progresso.tipo === "negativo"
          ? "Desfazer a última recaída"
          : "Desmarcar";

  return (
    <div className="mt-3 border-t border-linha pt-3">
      <Botao variante="fantasma" largo disabled={ocupado} onClick={aoDesmarcar}>
        {rotulo}
      </Botao>
    </div>
  );
}

/**
 * Incremento rápido do tipo quantificado.
 *
 * O passo sai de uma heurística sobre a meta (ver `passoDe`), porque o contrato
 * não tem campo de passo: 2000 ml pede um botão de 250, e 3 páginas pedem um de
 * 1. O campo editável ao lado existe para o caso de a heurística errar.
 */
function PainelQuantificado({
  meta,
  acumulado,
  unidade,
  ocupado,
  aoRegistrar,
}: {
  readonly meta: number;
  readonly acumulado: number;
  readonly unidade: string;
  readonly ocupado: boolean;
  readonly aoRegistrar: (valor: number) => void;
}) {
  const passo = passoDe(meta);
  const [valor, setValor] = useState(String(passo));
  const numerico = Number(valor);
  const valido = Number.isFinite(numerico) && numerico > 0;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-texto-fraco">
        Faltam {numero(Math.max(0, meta - acumulado))} {unidade} para a meta de hoje.
      </p>

      <div className="flex items-center gap-2">
        <Botao
          aria-label={`Diminuir ${passo} ${unidade}`}
          onClick={() => setValor(String(Math.max(passo, numerico - passo)))}
        >
          −
        </Botao>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={passo}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          aria-label={`Quantidade em ${unidade}`}
          className={`${CLASSE_ENTRADA} text-center tabular-nums`}
        />
        <Botao
          aria-label={`Aumentar ${passo} ${unidade}`}
          onClick={() => setValor(String((valido ? numerico : 0) + passo))}
        >
          +
        </Botao>
      </div>

      <Botao
        variante="primario"
        largo
        disabled={ocupado || !valido}
        onClick={() => aoRegistrar(numerico)}
      >
        Registrar {valido ? numero(numerico) : ""} {unidade}
      </Botao>
    </div>
  );
}

/** Cronômetro ou entrada manual — as duas formas que o mapa pede para `duracao`. */
function PainelDuracao({
  habitoId,
  ocupado,
  aoRegistrar,
}: {
  readonly habitoId: string;
  readonly ocupado: boolean;
  readonly aoRegistrar: (valor: number, origem: Origem) => void;
}) {
  const [minutos, setMinutos] = useState("");
  const numerico = Number(minutos);
  const valido = minutos !== "" && Number.isFinite(numerico) && numerico > 0;

  return (
    <div className="flex flex-col gap-4">
      <Cronometro
        habitoId={habitoId}
        ocupado={ocupado}
        aoParar={(min) => aoRegistrar(min, "cronometro")}
      />

      <div className="flex items-end gap-2 border-t border-linha pt-3">
        <label className="flex-1">
          <span className="mb-1 block text-xs text-texto-fraco">ou informe os minutos</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={minutos}
            onChange={(e) => setMinutos(e.target.value)}
            className={`${CLASSE_ENTRADA} tabular-nums`}
          />
        </label>
        <Botao disabled={ocupado || !valido} onClick={() => aoRegistrar(numerico, "app")}>
          Registrar
        </Botao>
      </div>
    </div>
  );
}

/**
 * Confirmação de recaída.
 *
 * Confirmar, e não desfazer: é o que o
 * [Mapa de telas](../Docs/mapas/Mapa%20de%20telas.md) descreve hoje — e a
 * pendência 1 dele, aberta, é justamente se desfazer depois teria menos atrito.
 * A decisão ainda é sua; o que está aqui é o comportamento mapeado.
 */
function PainelRecaida({
  nome,
  ocupado,
  aoCancelar,
  aoConfirmar,
}: {
  readonly nome: string;
  readonly ocupado: boolean;
  readonly aoCancelar: () => void;
  readonly aoConfirmar: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Registrar uma recaída em <strong className="font-medium">{nome}</strong>?
      </p>
      <p className="text-xs leading-snug text-texto-fraco">
        Passar da tolerância do período derruba a sequência. Só o preenchimento retroativo desfaz.
      </p>
      <div className="flex gap-2">
        <Botao variante="destrutivo" disabled={ocupado} onClick={aoConfirmar}>
          Registrar recaída
        </Botao>
        <Botao variante="fantasma" onClick={aoCancelar}>
          Cancelar
        </Botao>
      </div>
    </div>
  );
}

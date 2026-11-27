"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { enviar, type Falha } from "@/cliente/api";
import { diaDaSemanaCurto } from "@/cliente/formato";
import {
  COR,
  criarHabito,
  editarHabito,
  resumoDeConfig,
  textoDeCongelamento,
  validar,
  type CampoInvalido,
  type ConfigHabito,
  type Habito,
  type TipoHabito,
} from "@/contracts";
import { CampoDeDuracao } from "./campo-de-duracao";
import { CLASSE_COR, ROTULO_COR } from "./cor";
import {
  HORARIO_PADRAO_DO_LEMBRETE,
  montarConfig,
  passoDoCampo,
  rascunhoDe,
  type Rascunho,
} from "./rascunho-de-habito";
import { Botao, Campo, CLASSE_ENTRADA, Escolha, Nota } from "./ui";

/**
 * Cadastro e edição de hábito, em 6 passos.
 *
 * Em etapas porque a configuração é grande o bastante para não caber de uma vez —
 * são quatro tipos, quatro cadências, dois modos e o congelamento. O passo 4 é o
 * que justifica a divisão: *flexível* e *fixo* são **caminhos alternativos**, e
 * foi exatamente ali que o modelo antigo de "período externo + interno" produzia
 * combinação inválida. Mostrar os dois lado a lado, um por vez, é o que torna a
 * exclusividade visível.
 *
 * **Nada de validação espelhada.** O que diz se o formulário está válido é o
 * schema do contrato (`criarHabito` / `editarHabito`), o mesmo que o route
 * handler usa — a mesma função, não uma cópia com as mesmas regras. Os números
 * ficam como texto no rascunho de propósito: campo vazio vira `NaN`, o schema
 * recusa, e a mensagem em pt-BR que aparece na tela é a que o servidor mandaria.
 *
 * **Ao editar, o tipo não muda.** `editarHabito(tipo)` monta o schema a partir
 * do tipo atual: trocar `binario` por `quantificado` reinterpretaria todo o
 * histórico pela régua errada, e no banco a FK composta `(habito_id, tipo)`
 * propagaria a troca para as versões antigas de config, que então quebrariam os
 * CHECKs de meta.
 */

export const PASSOS = [
  "Identidade",
  "Tipo",
  "Cadência",
  "Modo",
  "Notificação",
  "Congelamento",
] as const;

export function FormularioDeHabito({ habito }: { readonly habito: Habito | null }) {
  const router = useRouter();
  const editando = habito !== null;

  const [rascunho, setRascunho] = useState<Rascunho>(() => rascunhoDe(habito));
  const [passo, setPasso] = useState(0);
  const [erros, setErros] = useState<CampoInvalido[]>([]);
  const [falha, setFalha] = useState<Falha | null>(null);
  const [ocupado, setOcupado] = useState(false);

  function muda<K extends keyof Rascunho>(chave: K, valor: Rascunho[K]) {
    setRascunho((atual) => ({ ...atual, [chave]: valor }));
    setErros([]);
  }

  function erroDe(caminho: string): string | undefined {
    return erros.find((e) => e.campo === caminho)?.mensagem;
  }

  const config = montarConfig(rascunho);

  /**
   * A frase da regra, montada pelo **mesmo** `resumoDeConfig` que preenche
   * `habito.resumo` no servidor. Só aparece quando a configuração já é válida —
   * antes disso não há regra a descrever, e uma frase a partir de rascunho
   * incompleto mentiria.
   */
  const configValida = validar(
    // Só a parte da config, para a frase existir antes de o nome ser digitado.
    criarHabito.shape.config,
    config,
  );
  const frase = configValida.ok ? resumoDeConfig(configValida.dados as ConfigHabito) : null;

  async function salvar() {
    setFalha(null);
    setOcupado(true);

    const payload = { nome: rascunho.nome, cor: rascunho.cor, config };

    /* O mesmo schema do route handler — nunca uma cópia das regras no cliente. */
    const validacao = editando
      ? validar(editarHabito(rascunho.tipo), payload)
      : validar(criarHabito, payload);

    if (!validacao.ok) {
      setOcupado(false);
      const campos = validacao.resposta.erro.campos ?? [];
      setErros(campos);

      /*
       * O passo **mais baixo** com erro, não o do primeiro campo da lista: a
       * ordem dos `issues` do Zod segue a estrutura do payload, em que
       * `metaOcorrencias` (passo 4) vem antes de `meta.valor` (passo 2). Pelo
       * primeiro, o usuário corrigiria o passo 4, salvaria, e só então seria
       * mandado de volta ao 2.
       */
      const passos = campos.map((c) => passoDoCampo(c.campo));
      if (passos.length > 0) setPasso(Math.min(...passos));
      return;
    }

    const r = editando
      ? await enviar<Habito>(`/api/habitos/${habito.id}`, "PATCH", payload)
      : await enviar<Habito>("/api/habitos", "POST", payload);

    setOcupado(false);

    if (!r.ok) {
      setFalha(r.falha);
      setErros(r.falha.campos ?? []);
      return;
    }

    /*
     * Zera o rascunho antes de sair, e só na criação.
     *
     * `router.replace` troca a rota, não o estado deste componente: quando ele
     * sobrevive à navegação — o cache de rotas devolvendo a mesma árvore ao
     * voltar para `/habitos/novo` — o próximo cadastro abria com o hábito
     * anterior inteiro dentro, no passo em que o anterior terminou. Recarregar a
     * página era o único jeito de limpar. Zerar aqui não depende de descobrir
     * quando a árvore é reaproveitada.
     *
     * Na edição não se zera: o formulário continua sendo o daquele hábito, e
     * jogá-lo para os defaults de criação exibiria, por um quadro, uma
     * configuração que não é a de ninguém.
     */
    if (!editando) {
      setRascunho(rascunhoDe(null));
      setPasso(0);
      setErros([]);
      setFalha(null);
    }

    router.replace("/habitos");
  }

  return (
    <div className="flex flex-1 flex-col">
      <ol className="flex gap-1 px-4 pt-3" aria-label="Passos">
        {PASSOS.map((nome, i) => (
          <li key={nome} className="flex-1">
            <button
              type="button"
              onClick={() => setPasso(i)}
              aria-current={i === passo ? "step" : undefined}
              className="w-full py-2"
              aria-label={`Passo ${i + 1}: ${nome}`}
            >
              <span
                className={`block h-1 rounded-full ${i <= passo ? "bg-texto" : "bg-trilha"}`}
              />
            </button>
          </li>
        ))}
      </ol>

      <div className="flex flex-1 flex-col gap-4 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-texto-fraco">
          {passo + 1}. {PASSOS[passo]}
        </h2>

        {falha !== null && (
          <p role="alert" className="text-sm text-habito-vermelho">
            {falha.mensagem}
          </p>
        )}

        {passo === 0 && (
          <PassoIdentidade rascunho={rascunho} muda={muda} erroDe={erroDe} />
        )}
        {passo === 1 && (
          <PassoTipo rascunho={rascunho} muda={muda} erroDe={erroDe} editando={editando} />
        )}
        {passo === 2 && <PassoCadencia rascunho={rascunho} muda={muda} erroDe={erroDe} />}
        {passo === 3 && <PassoModo rascunho={rascunho} muda={muda} erroDe={erroDe} />}
        {passo === 4 && <PassoNotificacao rascunho={rascunho} muda={muda} erroDe={erroDe} />}
        {passo === 5 && <PassoCongelamento rascunho={rascunho} muda={muda} erroDe={erroDe} />}

        {editando && (
          <Nota tom="forte">
            A mudança vale <strong className="text-texto">a partir de hoje</strong>. Os períodos já
            fechados continuam avaliados pela regra antiga — a configuração é versionada, e sem este
            aviso o histórico pareceria errado.
          </Nota>
        )}
      </div>

      {/*
        Rodapé fixo: a frase da regra sempre à vista enquanto se decide, e não
        apenas num passo final de revisão. É o resumo que o Mapa de telas pede
        antes de salvar, atualizado a cada escolha.
      */}
      <footer className="sticky bottom-0 flex flex-col gap-3 border-t border-linha bg-cartao p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <p className="text-xs leading-snug text-texto-fraco">
          {frase === null ? (
            "Complete os campos para ver a regra."
          ) : (
            <>
              <strong className="font-medium text-texto">{rascunho.nome || "Sem nome"}</strong> —{" "}
              {frase}.
            </>
          )}
        </p>

        <div className="flex gap-2">
          {passo > 0 && (
            <Botao onClick={() => setPasso(passo - 1)} largo>
              Voltar
            </Botao>
          )}
          {passo < PASSOS.length - 1 ? (
            <Botao variante="primario" largo onClick={() => setPasso(passo + 1)}>
              Avançar
            </Botao>
          ) : (
            <Botao variante="primario" largo disabled={ocupado} onClick={() => void salvar()}>
              {ocupado ? "Salvando…" : editando ? "Salvar mudanças" : "Criar hábito"}
            </Botao>
          )}
        </div>
      </footer>
    </div>
  );
}

// ─── Passos ──────────────────────────────────────────────────────────────────

type PropsDePasso = {
  readonly rascunho: Rascunho;
  readonly muda: <K extends keyof Rascunho>(chave: K, valor: Rascunho[K]) => void;
  readonly erroDe: (caminho: string) => string | undefined;
};

function PassoIdentidade({ rascunho, muda, erroDe }: PropsDePasso) {
  return (
    <>
      <Campo
        rotulo="Nome"
        erro={erroDe("nome")}
        dica="O emoji vai dentro do nome — não há campo de ícone. Use o teclado de emoji do sistema."
      >
        <input
          type="text"
          value={rascunho.nome}
          onChange={(e) => muda("nome", e.target.value)}
          placeholder="💧 Água"
          maxLength={80}
          className={CLASSE_ENTRADA}
        />
      </Campo>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Cor</span>
        <div role="radiogroup" aria-label="Cor" className="flex gap-2">
          {COR.map((cor) => (
            <button
              key={cor}
              type="button"
              role="radio"
              aria-checked={rascunho.cor === cor}
              aria-label={ROTULO_COR[cor]}
              onClick={() => muda("cor", cor)}
              className={`flex size-11 items-center justify-center rounded-full border-2 ${
                rascunho.cor === cor ? "border-texto" : "border-transparent"
              }`}
            >
              <span aria-hidden className={`size-7 rounded-full ${CLASSE_COR[cor].fundo}`} />
            </button>
          ))}
        </div>
        <span className="text-xs leading-snug text-texto-fraco">
          A cor é reforço, não identificação: no sol, ou para quem tem deficiência de visão de cor,
          dois discos vizinhos podem virar a mesma mancha. Quem identifica o hábito é o emoji.
        </span>
      </div>
    </>
  );
}

const DESCRICAO_DE_TIPO: Record<TipoHabito, { rotulo: string; descricao: string }> = {
  binario: { rotulo: "Binário", descricao: "Fez ou não fez." },
  quantificado: { rotulo: "Quantificado", descricao: "Acumula um valor: ml, páginas, km." },
  duracao: { rotulo: "Duração", descricao: "Acumula tempo, com cronômetro." },
  negativo: { rotulo: "Negativo", descricao: "Evitar algo. Conta recaídas, não acertos." },
};

function PassoTipo({
  rascunho,
  muda,
  erroDe,
  editando,
}: PropsDePasso & { readonly editando: boolean }) {
  return (
    <>
      {editando ? (
        <Nota tom="forte">
          Tipo: <strong className="text-texto">{DESCRICAO_DE_TIPO[rascunho.tipo].rotulo}</strong>.
          Não é editável — trocar o tipo reinterpretaria todo o histórico pela régua errada.
        </Nota>
      ) : (
        <Escolha
          coluna
          rotulo="Tipo"
          valor={rascunho.tipo}
          opcoes={(Object.keys(DESCRICAO_DE_TIPO) as TipoHabito[]).map((tipo) => ({
            valor: tipo,
            ...DESCRICAO_DE_TIPO[tipo],
          }))}
          aoEscolher={(tipo) => muda("tipo", tipo)}
        />
      )}

      {rascunho.tipo === "quantificado" && (
        <div className="flex gap-2">
          <div className="flex-1">
            <Campo rotulo="Meta" erro={erroDe("config.meta.valor")}>
              <input
                type="number"
                inputMode="decimal"
                min={1}
                value={rascunho.valor}
                onChange={(e) => muda("valor", e.target.value)}
                placeholder="2000"
                className={CLASSE_ENTRADA}
              />
            </Campo>
          </div>
          <div className="flex-1">
            <Campo rotulo="Unidade" erro={erroDe("config.meta.unidade")}>
              <input
                type="text"
                value={rascunho.unidade}
                onChange={(e) => muda("unidade", e.target.value)}
                placeholder="ml"
                maxLength={16}
                className={CLASSE_ENTRADA}
              />
            </Campo>
          </div>
        </div>
      )}

      {rascunho.tipo === "duracao" && (
        <CampoDeDuracao
          rotulo="Duração por interação"
          erro={erroDe("config.meta.segundos")}
          dica="A unidade é o segundo, então metas curtas cabem: 30 s de respiração, 45 s de prancha."
          partes={rascunho.duracao}
          aoMudar={(partes) => muda("duracao", partes)}
        />
      )}

      {rascunho.tipo === "negativo" && (
        <Campo
          rotulo="Recaídas toleradas por período"
          erro={erroDe("config.meta.tolerancia")}
          dica="0 significa nenhuma recaída tolerada. O período nasce cumprido e a recaída é que o derruba."
        >
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={rascunho.tolerancia}
            onChange={(e) => muda("tolerancia", e.target.value)}
            className={CLASSE_ENTRADA}
          />
        </Campo>
      )}
    </>
  );
}

function PassoCadencia({ rascunho, muda, erroDe }: PropsDePasso) {
  return (
    <>
      <Escolha
        coluna
        rotulo="Cadência"
        valor={rascunho.cadencia}
        opcoes={[
          { valor: "diario", rotulo: "Diário", descricao: "Um período por dia." },
          { valor: "semanal", rotulo: "Semanal", descricao: "Semana começando no domingo." },
          { valor: "mensal", rotulo: "Mensal", descricao: "Do dia 1 ao fim do mês." },
          {
            valor: "cada_n_dias",
            rotulo: "A cada N dias",
            descricao: "Janela móvel, ancorada na última conclusão.",
          },
        ]}
        aoEscolher={(cadencia) => {
          muda("cadencia", cadencia);
          /* Modo fixo não é oferecido em `cada_n_dias` — ver a nota do passo 4. */
          if (cadencia === "cada_n_dias") muda("modo", "flexivel");
        }}
      />

      {rascunho.cadencia === "cada_n_dias" && (
        <>
          <Campo rotulo="Intervalo em dias" erro={erroDe("config.cadencia.intervalo")}>
            <input
              type="number"
              inputMode="numeric"
              min={2}
              value={rascunho.intervalo}
              onChange={(e) => muda("intervalo", e.target.value)}
              className={CLASSE_ENTRADA}
            />
          </Campo>
          <Nota tom="forte">
            A contagem <strong className="text-texto">reinicia na última conclusão</strong>, não no
            calendário: concluir no 3º dia de uma janela de {rascunho.intervalo || "N"} joga o
            próximo vencimento para {rascunho.intervalo || "N"} dias depois{" "}
            <strong className="text-texto">daquela conclusão</strong>. É por isso que o modo fixo não
            existe aqui — horário determinado dentro de uma janela que anda não descreveria nada.
          </Nota>
        </>
      )}
    </>
  );
}

function PassoModo({ rascunho, muda, erroDe }: PropsDePasso) {
  const soFlexivel = rascunho.cadencia === "cada_n_dias";
  /*
   * Diário flexível não tem meta a escolher: o período é um dia, a unidade do
   * modo flexível é o dia, e 1 é o único valor cumprível. O campo dá lugar à
   * nota que manda para o modo fixo — sem ela, quem queria duas vezes por dia
   * procuraria um campo que simplesmente não está mais ali.
   */
  const diarioFlexivel = rascunho.cadencia === "diario" && rascunho.modo === "flexivel";

  return (
    <>
      {soFlexivel ? (
        <Nota tom="forte">
          Em <strong className="text-texto">a cada N dias</strong> só existe o modo flexível: a
          janela anda com as suas conclusões, e dias e horários determinados dentro dela não
          descreveriam nada.
        </Nota>
      ) : (
        <Escolha
          coluna
          rotulo="Modo"
          valor={rascunho.modo}
          opcoes={[
            {
              valor: "flexivel",
              rotulo: "Flexível",
              descricao:
                rascunho.cadencia === "diario"
                  ? "Uma vez no dia, a qualquer hora."
                  : "N vezes dentro do período, quando der.",
            },
            {
              valor: "fixo",
              rotulo: "Fixo",
              descricao: "Nestes dias e horários — cada momento é marcável.",
            },
          ]}
          aoEscolher={(modo) => muda("modo", modo)}
        />
      )}

      {diarioFlexivel ? (
        <Nota tom="forte">
          Em <strong className="text-texto">diário</strong> o período é um dia, então a meta é{" "}
          <strong className="text-texto">uma</strong> conclusão — o dia não cabe mais de uma. Para
          marcar <strong className="text-texto">duas vezes por dia</strong>, escolha o modo{" "}
          <strong className="text-texto">fixo</strong> e declare dois horários: cada um vira uma
          linha marcável no painel de hoje, com lembrete próprio.
        </Nota>
      ) : rascunho.modo === "flexivel" || soFlexivel ? (
        <Campo
          rotulo="Quantas vezes no período"
          erro={erroDe("config.metaOcorrencias")}
          dica="O período fecha como cumprido quando reúne esta quantidade."
        >
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={rascunho.metaOcorrencias}
            onChange={(e) => muda("metaOcorrencias", e.target.value)}
            className={CLASSE_ENTRADA}
          />
        </Campo>
      ) : (
        <>
          {rascunho.cadencia === "semanal" && (
            <SeletorDeDias
              rotulo="Dias da semana"
              erro={erroDe("config.cadencia.diasSemana")}
              valores={[1, 2, 3, 4, 5, 6, 7]}
              rotuloDe={diaDaSemanaCurto}
              colunas="grid-cols-7"
              escolhidos={rascunho.diasSemana}
              aoAlternar={(dias) => muda("diasSemana", dias)}
            />
          )}

          {rascunho.cadencia === "mensal" && (
            <SeletorDeDias
              rotulo="Dias do mês"
              erro={erroDe("config.cadencia.diasMes")}
              valores={Array.from({ length: 31 }, (_, i) => i + 1)}
              rotuloDe={String}
              colunas="grid-cols-6"
              escolhidos={rascunho.diasMes}
              aoAlternar={(dias) => muda("diasMes", dias)}
            />
          )}

          <Horarios
            obrigatorio={rascunho.cadencia === "diario"}
            erro={erroDe("config.cadencia.horarios")}
            horarios={rascunho.horarios}
            aoMudar={(horarios) => muda("horarios", horarios)}
          />
        </>
      )}
    </>
  );
}

function PassoNotificacao({ rascunho, muda, erroDe }: PropsDePasso) {
  if (rascunho.modo === "fixo" && rascunho.cadencia !== "cada_n_dias") {
    return (
      <Nota tom="forte">
        No modo fixo o lembrete é{" "}
        <strong className="text-texto">derivado dos horários do passo anterior</strong>
        {rascunho.horarios.length > 0 && <> ({rascunho.horarios.join(", ")})</>}. Não há horário
        separado a escolher.
      </Nota>
    );
  }

  return (
    <>
      <Escolha
        rotulo="Lembrete"
        valor={rascunho.lembreteAtivo ? "sim" : "nao"}
        opcoes={[
          { valor: "sim", rotulo: "Ativar" },
          { valor: "nao", rotulo: "Sem lembrete" },
        ]}
        aoEscolher={(v) => {
          const ativo = v === "sim";
          muda("lembreteAtivo", ativo);
          /*
           * Reativar com o campo limpo pelo usuário devolveria um horário vazio
           * e, com ele, um erro de validação em cima de uma escolha que acabou
           * de ser feita. O padrão volta junto.
           */
          if (ativo && rascunho.notificarEm === "") {
            muda("notificarEm", HORARIO_PADRAO_DO_LEMBRETE);
          }
        }}
      />

      {rascunho.lembreteAtivo && (
        <Campo rotulo="Horário do lembrete" erro={erroDe("config.notificarEm")}>
          <input
            type="time"
            value={rascunho.notificarEm}
            onChange={(e) => muda("notificarEm", e.target.value)}
            className={CLASSE_ENTRADA}
          />
        </Campo>
      )}

      {!rascunho.lembreteAtivo && (
        /*
         * O que ainda chega sem lembrete depende da cadência, e dizer "o aviso
         * de atraso continua valendo" seria falso no diário: `meta_atraso` só
         * existe no flexível semanal e mensal (ver `worker/notificacoes.ts`).
         * Num hábito diário sem lembrete, nada é enviado — e é melhor a tela
         * dizer isso do que a pessoa descobrir pela ausência.
         */
        <Nota>
          {rascunho.cadencia === "semanal" || rascunho.cadencia === "mensal" ? (
            <>
              Sem lembrete, não há notificação de horário. O aviso de{" "}
              <strong className="text-texto">último dia do período</strong> continua chegando às
              20:00 — ele não depende deste campo.
            </>
          ) : (
            <>
              Sem lembrete, este hábito{" "}
              <strong className="text-texto">não envia notificação nenhuma</strong>. O aviso de
              último dia do período só existe nas cadências semanal e mensal.
            </>
          )}
        </Nota>
      )}
    </>
  );
}

function PassoCongelamento({ rascunho, muda, erroDe }: PropsDePasso) {
  const congelamento = rascunho.congelamentoAtivo
    ? { aCada: Number(rascunho.aCada), max: Number(rascunho.max) }
    : null;

  const numerosValidos =
    congelamento === null ||
    (Number.isFinite(congelamento.aCada) && Number.isFinite(congelamento.max));

  return (
    <>
      <Escolha
        rotulo="Congelamento"
        valor={rascunho.congelamentoAtivo ? "sim" : "nao"}
        opcoes={[
          { valor: "sim", rotulo: "Ativar" },
          { valor: "nao", rotulo: "Sem congelamento" },
        ]}
        aoEscolher={(v) => muda("congelamentoAtivo", v === "sim")}
      />

      {rascunho.congelamentoAtivo && (
        <div className="flex gap-2">
          <div className="flex-1">
            <Campo rotulo="A cada N interações" erro={erroDe("config.congelamento.aCada")}>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={rascunho.aCada}
                onChange={(e) => muda("aCada", e.target.value)}
                className={CLASSE_ENTRADA}
              />
            </Campo>
          </div>
          <div className="flex-1">
            <Campo rotulo="Máximo guardado" erro={erroDe("config.congelamento.max")}>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={10}
                value={rascunho.max}
                onChange={(e) => muda("max", e.target.value)}
                className={CLASSE_ENTRADA}
              />
            </Campo>
          </div>
        </div>
      )}

      {/*
        O texto do automatismo é exigência do Mapa de telas, e vem da mesma
        função que o servidor usaria: sem dizer que o congelamento é gasto
        sozinho, o usuário espera uma decisão que nunca lhe será oferecida — não
        há estado `em_risco` nem prazo de resgate.
      */}
      {numerosValidos && <Nota tom="forte">{textoDeCongelamento(congelamento)}</Nota>}
    </>
  );
}

// ─── Peças do passo 4 ────────────────────────────────────────────────────────

function SeletorDeDias({
  rotulo,
  erro,
  valores,
  rotuloDe,
  colunas,
  escolhidos,
  aoAlternar,
}: {
  readonly rotulo: string;
  readonly erro?: string;
  readonly valores: readonly number[];
  readonly rotuloDe: (valor: number) => string;
  readonly colunas: string;
  readonly escolhidos: readonly number[];
  readonly aoAlternar: (dias: number[]) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{rotulo}</span>
      <div className={`grid ${colunas} gap-1`} role="group" aria-label={rotulo}>
        {valores.map((valor) => {
          const marcado = escolhidos.includes(valor);

          return (
            <button
              key={valor}
              type="button"
              aria-pressed={marcado}
              onClick={() =>
                aoAlternar(
                  marcado
                    ? escolhidos.filter((v) => v !== valor)
                    : [...escolhidos, valor].sort((a, b) => a - b),
                )
              }
              className={`flex min-h-11 items-center justify-center rounded-lg border text-xs tabular-nums ${
                marcado ? "border-texto bg-cartao font-semibold" : "border-linha text-texto-fraco"
              }`}
            >
              {rotuloDe(valor)}
            </button>
          );
        })}
      </div>
      {erro !== undefined && <span className="text-xs text-habito-vermelho">{erro}</span>}
    </div>
  );
}

/**
 * Horários do modo fixo, até 8.
 *
 * Cada horário vira uma **ocorrência marcável** por dia devido — é o que faz o
 * 💊 Vitamina D de 08:00 e 20:00 render duas linhas no dashboard. Na cadência
 * diária é obrigatório; na semanal e na mensal, sem horário o dia inteiro é uma
 * ocorrência só.
 */
function Horarios({
  obrigatorio,
  erro,
  horarios,
  aoMudar,
}: {
  readonly obrigatorio: boolean;
  readonly erro?: string;
  readonly horarios: readonly string[];
  readonly aoMudar: (horarios: string[]) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Horários</span>

      {horarios.map((horario, i) => (
        <div key={i} className="flex gap-2">
          <input
            type="time"
            value={horario}
            onChange={(e) => aoMudar(horarios.map((h, j) => (j === i ? e.target.value : h)))}
            aria-label={`Horário ${i + 1}`}
            className={CLASSE_ENTRADA}
          />
          <Botao
            variante="fantasma"
            aria-label={`Remover horário ${i + 1}`}
            onClick={() => aoMudar(horarios.filter((_, j) => j !== i))}
          >
            Remover
          </Botao>
        </div>
      ))}

      {horarios.length < 8 && (
        <Botao onClick={() => aoMudar([...horarios, "08:00"])}>Adicionar horário</Botao>
      )}

      <span className="text-xs leading-snug text-texto-fraco">
        {obrigatorio
          ? "Na cadência diária é preciso ao menos um horário — sem ele a configuração não determinaria momento nenhum."
          : "Sem horário, o dia devido inteiro conta como uma ocorrência só."}
      </span>
      {erro !== undefined && <span className="text-xs text-habito-vermelho">{erro}</span>}
    </div>
  );
}

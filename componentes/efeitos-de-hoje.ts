import type { Efeitos, Hoje, LinhaDeHoje, Progresso, RegistroCriado } from "@/contracts";

/**
 * Aplicação local dos efeitos de marcar e desmarcar no dashboard.
 *
 * Sem React de propósito, e testado: é aqui que a tela redesenha a si mesma
 * depois de um toque, e uma conta errada aqui mostra sequência, estoque de
 * congelamento ou progresso **divergentes do servidor** sem nenhum sinal de que
 * algo falhou — a tela parece funcionar.
 *
 * `RegistroCriado.efeitos` e `RegistroRemovido.efeitos` existem exatamente para
 * isto: sequência e congelamento são **do hábito**, então um registro muda as
 * duas linhas de um hábito fixo de dois horários, não só a tocada. Recarregar
 * `GET /api/hoje` depois de cada toque jogaria fora o que o contrato se deu o
 * trabalho de mandar, e acrescentaria uma ida ao servidor entre o toque e a
 * resposta visual.
 */

export type UltimoRegistro = NonNullable<LinhaDeHoje["ultimoRegistro"]>;

/**
 * Quando a marca aparece cheia.
 *
 * A regra **muda com o tipo**, e é por isso que mora numa função só:
 *
 * - `binario`: cumprido é *haver registro nesta interação*. Num hábito 3x por
 *   semana, o dia de hoje está feito mesmo com a semana em 1/3 — a linha fala da
 *   interação devida, não do período.
 * - `quantificado` e `duracao`: cumprido é o acumulado alcançar a meta. Um
 *   incremento de 250 ml numa meta de 2000 **não** fecha a linha; tratá-lo como
 *   fechamento era o comportamento anterior, e ele mostrava disco cheio com
 *   1750 ml faltando.
 * - `negativo`: cumprido é continuar dentro da tolerância. Ele nasce cumprido, e
 *   é a recaída que o derruba.
 */
export function concluidaDe(progresso: Progresso, temRegistro: boolean): boolean {
  switch (progresso.tipo) {
    case "binario":
      return temRegistro;
    case "quantificado":
    case "duracao":
      return progresso.acumulado >= progresso.meta;
    case "negativo":
      return progresso.recaidas <= progresso.tolerancia;
  }
}

/**
 * De quem é o progresso: do período ou da interação.
 *
 * `binario` conta unidades cumpridas no **período**, e `negativo` conta recaídas
 * no período — os dois são compartilhados, então marcar a dose da manhã move o
 * número exibido na linha da noite. Já `quantificado` e `duracao` acumulam **por
 * interação**: cada ocorrência tem a sua soma contra a meta de uma unidade.
 *
 * A distinção importa num caso só, hábito fixo com meta somável, e é justamente o
 * caso em que errar some: somar o incremento nas duas linhas mostraria 1400 ml em
 * cada dose quando foram 700 em uma.
 */
function progressoDoPeriodo(progresso: Progresso): boolean {
  return progresso.tipo === "binario" || progresso.tipo === "negativo";
}

/** Redesenha as linhas depois de `POST /api/registros`. */
export function comRegistro(hoje: Hoje, tocada: LinhaDeHoje, criado: RegistroCriado): Hoje {
  return mapearHabito(hoje, tocada, (linha) => {
    const tocadaAqui = linha.ocorrenciaId === tocada.ocorrenciaId;
    const move = tocadaAqui || progressoDoPeriodo(linha.progresso);
    const progresso = move ? avancar(linha.progresso, criado.valor) : linha.progresso;

    return {
      ...linha,
      progresso,
      ultimoRegistro: tocadaAqui ? { id: criado.id, valor: criado.valor } : linha.ultimoRegistro,
      concluida: concluidaDe(progresso, tocadaAqui || linha.ultimoRegistro !== null),
      ...doHabito(criado.efeitos),
    };
  });
}

/**
 * Redesenha as linhas depois de `DELETE /api/registros/:id`.
 *
 * `registro` é o que a linha carregava em `ultimoRegistro`, não algo lido da
 * resposta: o `valor` precisa ser conhecido **antes** de apagar para a conta ser
 * a inversa exata do que `comRegistro` somou.
 *
 * A linha desmarcada fica com `ultimoRegistro: null`, então só há um desfazer por
 * carregamento — o payload traz o último registro, não a pilha. Desfazer mais que
 * o último toque é trabalho do retroativo, onde a janela de 7 dias está à vista.
 */
export function semRegistro(
  hoje: Hoje,
  tocada: LinhaDeHoje,
  registro: UltimoRegistro,
  efeitos: Efeitos,
): Hoje {
  return mapearHabito(hoje, tocada, (linha) => {
    const tocadaAqui = linha.ocorrenciaId === tocada.ocorrenciaId;
    const move = tocadaAqui || progressoDoPeriodo(linha.progresso);
    const progresso = move ? retroceder(linha.progresso, registro.valor) : linha.progresso;

    return {
      ...linha,
      progresso,
      ultimoRegistro: tocadaAqui ? null : linha.ultimoRegistro,
      concluida: concluidaDe(progresso, !tocadaAqui && linha.ultimoRegistro !== null),
      ...doHabito(efeitos),
    };
  });
}

/**
 * O que é do hábito, e não da ocorrência.
 *
 * Separado porque é a razão de as **duas** linhas de um hábito fixo serem
 * reescritas: marcar a dose da manhã muda a sequência exibida na linha da noite.
 */
function doHabito(efeitos: Efeitos) {
  return {
    sequencia: efeitos.sequencia.atual,
    congelamentos: efeitos.congelamentosDisponiveis,
  };
}

function mapearHabito(
  hoje: Hoje,
  tocada: LinhaDeHoje,
  reescrever: (linha: LinhaDeHoje) => LinhaDeHoje,
): Hoje {
  return {
    ...hoje,
    linhas: hoje.linhas.map((linha) =>
      linha.habitoId === tocada.habitoId ? reescrever(linha) : linha,
    ),
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

/** A inversa de `avancar`, com piso em zero: nenhum progresso é negativo. */
function retroceder(progresso: Progresso, valor: number): Progresso {
  switch (progresso.tipo) {
    case "binario":
      return { ...progresso, concluidas: Math.max(0, progresso.concluidas - 1) };
    case "quantificado":
    case "duracao":
      return { ...progresso, acumulado: Math.max(0, progresso.acumulado - valor) };
    case "negativo":
      return { ...progresso, recaidas: Math.max(0, progresso.recaidas - 1) };
  }
}

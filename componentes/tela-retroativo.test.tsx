/**
 * @jest-environment jsdom
 */

/**
 * O retroativo, montado de verdade (etapa 3.7).
 *
 * Esta tela concentra três decisões que só existem **no cliente** e que nenhum
 * teste de servidor alcança:
 *
 * 1. **o que o toque faz num dia já registrado**, que muda com o tipo do hábito —
 *    acrescenta num dia somável ainda curto, desfaz em todos os outros, e errar
 *    isso faz o dia da recaída registrar uma segunda;
 * 2. **quando pedir confirmação** num `cada_n_dias`: só quando o vencimento
 *    realmente se move, e não a cada toque;
 * 3. **os bloqueios aparecem com motivo**, nunca ausentes.
 */

jest.mock("next/navigation", () => {
  const estado = { replace: jest.fn(), push: jest.fn(), params: { id: "habito-1" } };
  /* Referência estável — ver a nota em apoio-de-teste.tsx. */
  const router = { replace: estado.replace, push: estado.push };
  return {
    estado,
    useRouter: () => router,
    useParams: () => estado.params,
  };
});

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DiaRetroativo, Meta, Retroativo, RetroativoAplicado } from "@/contracts";
import { retroativoFixture, registroCriadoFixture } from "@/contracts/fixtures";
import { renderizar, servirApi } from "./apoio-de-teste";
import { TelaRetroativo } from "./tela-retroativo";

const ROTA = "GET /api/habitos/:id/retroativo" as const;
const APLICAR = "POST /api/habitos/:id/retroativo" as const;

const HOJE = retroativoFixture.dias[0].dataLogica;
const ONTEM = retroativoFixture.dias[1].dataLogica;

function dia(sobre: Partial<DiaRetroativo>, base = retroativoFixture.dias[1]): DiaRetroativo {
  return { ...base, ...sobre };
}

/** A janela com os dias pedidos, completada até sete. */
function janela(dias: DiaRetroativo[], meta: Meta = { tipo: "binario" }): Retroativo {
  const resto = retroativoFixture.dias.slice(dias.length).map((d) =>
    dia({ estado: "bloqueado", motivoBloqueio: "antes_do_inicio", registroIds: [] }, d),
  );

  return { ...retroativoFixture, meta, dias: [...dias, ...resto] };
}

function aplicado(dias: DiaRetroativo[], novoVencimento: string | null = null): RetroativoAplicado {
  return {
    persistido: true,
    efeitos: { ...registroCriadoFixture.efeitos, novoVencimento },
    dias: janela(dias).dias,
  };
}

// ─── Bloqueios ───────────────────────────────────────────────────────────────

describe("bloqueios", () => {
  it("aparecem com o motivo escrito, não ausentes", async () => {
    servirApi({
      [ROTA]: {
        corpo: janela([
          dia({ hoje: true, estado: "nao_cumprido", registroIds: [] }, retroativoFixture.dias[0]),
          dia({ estado: "bloqueado", motivoBloqueio: "em_pausa", registroIds: [] }),
          dia({ estado: "bloqueado", motivoBloqueio: "nao_previsto", registroIds: [] }),
        ]),
      },
    });

    renderizar(<TelaRetroativo />);

    /* Sumir com o dia deixaria a tela ambígua entre "não pode" e "não aconteceu". */
    expect(await screen.findByText("dentro de uma pausa")).toBeInTheDocument();
    expect(screen.getByText("não é dia deste hábito")).toBeInTheDocument();
  });

  it("o dia bloqueado não aceita toque", async () => {
    const api = servirApi({
      [ROTA]: {
        corpo: janela([
          dia({ hoje: true, estado: "nao_cumprido", registroIds: [] }, retroativoFixture.dias[0]),
          dia({ estado: "bloqueado", motivoBloqueio: "em_pausa", registroIds: [] }),
        ]),
      },
    });

    renderizar(<TelaRetroativo />);
    const bloqueado = await botaoDoDia(ONTEM);

    expect(bloqueado).toBeDisabled();
    await userEvent.click(bloqueado);
    expect(api.de(APLICAR)).toHaveLength(0);
  });
});

async function botaoDoDia(dataLogica: string) {
  const botoes = await screen.findAllByRole("button");
  const achado = botoes.find((b) => (b.getAttribute("aria-label") ?? "").includes(rotulo(dataLogica)));
  if (achado === undefined) throw new Error(`sem botão para o dia ${dataLogica}`);
  return achado;
}

/** `2026-11-09` → `09/11`, como a tela escreve no rótulo. */
function rotulo(dataLogica: string): string {
  const [, mes, dia] = dataLogica.split("-");
  return `${dia}/${mes}`;
}

// ─── Marcar ──────────────────────────────────────────────────────────────────

describe("marcar um dia", () => {
  it("pede a prévia antes e só então aplica", async () => {
    const vazio = dia({ estado: "nao_cumprido", registroIds: [] });
    const api = servirApi({
      [ROTA]: { corpo: janela([retroativoFixture.dias[0], vazio]) },
      [APLICAR]: { corpo: aplicado([retroativoFixture.dias[0], dia({ estado: "cumprido" })]) },
    });

    renderizar(<TelaRetroativo />);
    await userEvent.click(await botaoDoDia(ONTEM));

    await waitFor(() => expect(api.de(APLICAR)).toHaveLength(2));

    /*
     * A ordem é a regra: a prévia primeiro, porque o payload não diz a cadência
     * do hábito e a tela não sabe de antemão se o toque move a âncora.
     */
    expect(api.de(APLICAR)[0].corpo).toMatchObject({ dataLogica: ONTEM, previa: true });
    expect(api.de(APLICAR)[1].corpo).toMatchObject({ dataLogica: ONTEM, previa: false });
  });

  it("mostra os efeitos que o servidor devolveu", async () => {
    const api = servirApi({
      [ROTA]: {
        corpo: janela([retroativoFixture.dias[0], dia({ estado: "nao_cumprido", registroIds: [] })]),
      },
      [APLICAR]: { corpo: aplicado([retroativoFixture.dias[0], dia({ estado: "cumprido" })]) },
    });

    renderizar(<TelaRetroativo />);
    await userEvent.click(await botaoDoDia(ONTEM));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/Sequência recalculada/);
    expect(api.de(APLICAR)).toHaveLength(2);
  });

  it("a recusa do servidor aparece com a mensagem dele", async () => {
    servirApi({
      [ROTA]: {
        corpo: janela([retroativoFixture.dias[0], dia({ estado: "nao_cumprido", registroIds: [] })]),
      },
      [APLICAR]: {
        erro: { codigo: "regra_violada", mensagem: "Este dia já está cumprido." },
        status: 422,
      },
    });

    renderizar(<TelaRetroativo />);
    await userEvent.click(await botaoDoDia(ONTEM));

    expect(await screen.findByRole("alert")).toHaveTextContent("Este dia já está cumprido.");
  });
});

// ─── A confirmação de cada_n_dias ────────────────────────────────────────────

describe("confirmação de vencimento", () => {
  const aberto = () => [
    retroativoFixture.dias[0],
    dia({ estado: "nao_cumprido", registroIds: [] }),
  ];

  it("pede confirmação quando o vencimento se move", async () => {
    const api = servirApi({
      [ROTA]: { corpo: janela(aberto()) },
      [APLICAR]: { corpo: aplicado(aberto(), "2026-11-20") },
    });

    renderizar(<TelaRetroativo />);
    await userEvent.click(await botaoDoDia(ONTEM));

    expect(await screen.findByText(/move o vencimento/i)).toBeInTheDocument();
    /* A prévia e nada mais: aplicar espera o "Confirmar". */
    expect(api.de(APLICAR)).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(api.de(APLICAR)).toHaveLength(2));
    expect(api.de(APLICAR)[1].corpo).toMatchObject({ previa: false });
  });

  it("não pede confirmação quando o vencimento é o mesmo que a janela já mostrava", async () => {
    /*
     * O defeito que a etapa 3.4 encontrou contra o banco real: `novoVencimento`
     * vem preenchido em TODA resposta de hábito ancorado, não só quando a âncora
     * se move. Pedir confirmação nos dois casos anunciava "o próximo vencimento
     * passa a ser 16/11" quando ele já era 16/11 — e um aviso que aparece sempre
     * deixa de ser aviso justamente antes do caso em que ele importa.
     */
    const fim = retroativoFixture.periodoAtual?.fim ?? null;
    const api = servirApi({
      [ROTA]: { corpo: janela(aberto()) },
      [APLICAR]: { corpo: aplicado(aberto(), fim) },
    });

    renderizar(<TelaRetroativo />);
    await userEvent.click(await botaoDoDia(ONTEM));

    await waitFor(() => expect(api.de(APLICAR)).toHaveLength(2));
    expect(screen.queryByText(/move o vencimento/i)).not.toBeInTheDocument();
  });

  it("cancelar não aplica nada", async () => {
    const api = servirApi({
      [ROTA]: { corpo: janela(aberto()) },
      [APLICAR]: { corpo: aplicado(aberto(), "2026-11-20") },
    });

    renderizar(<TelaRetroativo />);
    await userEvent.click(await botaoDoDia(ONTEM));
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar" }));

    expect(api.de(APLICAR)).toHaveLength(1);
    expect(screen.queryByText(/move o vencimento/i)).not.toBeInTheDocument();
  });
});

// ─── O que o toque faz num dia já registrado ─────────────────────────────────

describe("dia já registrado: a regra muda com o tipo", () => {
  it("binário cumprido: o toque desfaz, apagando os registros do dia", async () => {
    const cumprido = dia({ estado: "cumprido", registroIds: ["reg-1", "reg-2"] });
    const api = servirApi({
      [ROTA]: { corpo: janela([retroativoFixture.dias[0], cumprido]) },
      "DELETE /api/registros/:id": { corpo: { efeitos: registroCriadoFixture.efeitos } },
    });

    renderizar(<TelaRetroativo />);
    await userEvent.click(await botaoDoDia(ONTEM));

    /* Um dia pode ter mais de um registro, e desmarcar o dia apaga todos. */
    await waitFor(() => expect(api.de("DELETE /api/registros/:id")).toHaveLength(2));
    expect(api.de(APLICAR)).toHaveLength(0);
  });

  it("somável ainda curto: o toque ACRESCENTA em vez de apagar", async () => {
    const parcial = dia({ estado: "nao_cumprido", valor: 250, registroIds: ["reg-1"] });
    const api = servirApi({
      [ROTA]: {
        corpo: janela([retroativoFixture.dias[0], parcial], {
          tipo: "quantificado",
          valor: 2000,
          unidade: "ml",
        }),
      },
      [APLICAR]: { corpo: aplicado([retroativoFixture.dias[0], dia({ estado: "cumprido" })]) },
    });

    renderizar(<TelaRetroativo />);
    await userEvent.click(await botaoDoDia(ONTEM));

    /*
     * Sem esta regra não haveria como completar um dia a meio sem antes apagar o
     * que já estava lá. O toque abre a entrada de valor.
     */
    expect(api.de("DELETE /api/registros/:id")).toHaveLength(0);
    await userEvent.click(await screen.findByRole("button", { name: "Registrar" }));

    await waitFor(() => expect(api.de(APLICAR)).toHaveLength(2));
    expect(api.de(APLICAR)[0].corpo).toMatchObject({ valor: 2000 });
  });

  it("somável já cumprido: o toque desfaz", async () => {
    const cheio = dia({ estado: "cumprido", valor: 2000, registroIds: ["reg-1"] });
    const api = servirApi({
      [ROTA]: {
        corpo: janela([retroativoFixture.dias[0], cheio], {
          tipo: "quantificado",
          valor: 2000,
          unidade: "ml",
        }),
      },
      "DELETE /api/registros/:id": { corpo: { efeitos: registroCriadoFixture.efeitos } },
    });

    renderizar(<TelaRetroativo />);
    await userEvent.click(await botaoDoDia(ONTEM));

    await waitFor(() => expect(api.de("DELETE /api/registros/:id")).toHaveLength(1));
  });

  it("negativo com recaída: o toque desfaz, não registra uma segunda", async () => {
    /*
     * O caso que a regra existe para evitar. No hábito negativo o dia com
     * registro é a **recaída**, e ele chega como `nao_cumprido` — a leitura
     * ingênua ("não cumprido, então marcar") gravaria uma segunda escorregada no
     * dia em que a pessoa quis apagar a primeira.
     */
    const recaida = dia({ estado: "nao_cumprido", valor: null, registroIds: ["reg-1"] });
    const api = servirApi({
      [ROTA]: {
        corpo: janela([retroativoFixture.dias[0], recaida], { tipo: "negativo", tolerancia: 2 }),
      },
      "DELETE /api/registros/:id": { corpo: { efeitos: registroCriadoFixture.efeitos } },
    });

    renderizar(<TelaRetroativo />);
    await userEvent.click(await botaoDoDia(ONTEM));

    await waitFor(() => expect(api.de("DELETE /api/registros/:id")).toHaveLength(1));
    expect(api.de(APLICAR)).toHaveLength(0);
  });

  it("negativo mostra a contagem de recaídas, porque `valor` é nulo ali", async () => {
    const recaida = dia({ estado: "nao_cumprido", valor: null, registroIds: ["reg-1"] });
    servirApi({
      [ROTA]: {
        corpo: janela([retroativoFixture.dias[0], recaida], { tipo: "negativo", tolerancia: 2 }),
      },
    });

    renderizar(<TelaRetroativo />);

    /* O `1` do registro é convenção de armazenamento; exibi-lo seria críptico. */
    expect(await screen.findByText("recaída")).toBeInTheDocument();
  });

  it("negativo limpo nasce cumprido e o toque registra a recaída", async () => {
    const limpo = dia({ estado: "cumprido", valor: null, registroIds: [] });
    const api = servirApi({
      [ROTA]: {
        corpo: janela([retroativoFixture.dias[0], limpo], { tipo: "negativo", tolerancia: 2 }),
      },
      [APLICAR]: { corpo: aplicado([retroativoFixture.dias[0], limpo]) },
    });

    renderizar(<TelaRetroativo />);
    await userEvent.click(await botaoDoDia(ONTEM));

    await waitFor(() => expect(api.de(APLICAR)).toHaveLength(2));
    expect(api.de("DELETE /api/registros/:id")).toHaveLength(0);
  });
});

// ─── Cabeçalho ───────────────────────────────────────────────────────────────

describe("cabeçalho", () => {
  it("mostra o progresso do período e a sequência", async () => {
    servirApi({ [ROTA]: { corpo: retroativoFixture } });

    renderizar(<TelaRetroativo />);

    const { concluidas, meta } = retroativoFixture.periodoAtual ?? { concluidas: 0, meta: 0 };
    expect(await screen.findByText(new RegExp(`${concluidas} de ${meta}`))).toBeInTheDocument();
  });

  it("sem período aberto, diz isso em vez de mostrar zeros", async () => {
    servirApi({ [ROTA]: { corpo: { ...retroativoFixture, periodoAtual: null } } });

    renderizar(<TelaRetroativo />);

    expect(await screen.findByText("Sem período aberto")).toBeInTheDocument();
  });

  it("o dia de hoje está rotulado como hoje", async () => {
    servirApi({ [ROTA]: { corpo: retroativoFixture } });

    renderizar(<TelaRetroativo />);

    expect(await screen.findByText("hoje")).toBeInTheDocument();
    expect(rotulo(HOJE)).toMatch(/^\d{2}\/\d{2}$/);
  });
});

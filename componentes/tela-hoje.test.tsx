/**
 * @jest-environment jsdom
 */

/**
 * O dashboard, montado de verdade (etapa 3.7).
 *
 * `componentes/efeitos-de-hoje.test.ts` já prova as **contas** da marcação. O
 * que falta, e é o que este arquivo cobre, é a fiação: o toque chega na rota
 * certa com o corpo certo, a resposta redesenha a linha, e os três estados da
 * tela aparecem quando devem.
 *
 * Os dados saem dos fixtures dos contratos, não de objetos escritos à mão aqui:
 * é o que garante que a tela esteja sendo testada contra o mesmo payload que o
 * servidor promete — um mock feito à mão divergiria do contrato em silêncio.
 */

jest.mock("next/navigation", () => {
  const estado = { replace: jest.fn(), push: jest.fn(), params: {} as Record<string, string> };
  /*
   * O objeto do router é criado UMA vez. `useRecurso` tem `router` entre as
   * dependências do efeito que busca, e um objeto novo a cada render refaria o
   * `GET` sem parar — atropelando a atualização otimista que a tela acabou de
   * aplicar. O `useRouter` de verdade devolve uma referência estável; um mock que
   * não devolve testaria um comportamento que não existe.
   */
  const router = { replace: estado.replace, push: estado.push };
  return {
    estado,
    useRouter: () => router,
    useParams: () => estado.params,
  };
});

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Hoje, LinhaDeHoje } from "@/contracts";
import { hojeFixture, registroCriadoFixture } from "@/contracts/fixtures";
import { renderizar, servirApi, type Navegacao } from "./apoio-de-teste";
import { TelaHoje } from "./tela-hoje";

const { estado: navegacao } = jest.requireMock<{ estado: Navegacao }>("next/navigation");

function linha(nome: string, horario: string | null = null): LinhaDeHoje {
  const achada = hojeFixture.linhas.find((l) => l.nome === nome && l.horario === horario);
  if (achada === undefined) throw new Error(`linha ausente na fixture: ${nome}`);
  return achada;
}

/** O dashboard com só as linhas pedidas — um caso por vez, legível. */
function hojeCom(linhas: LinhaDeHoje[], sobre: Partial<Hoje> = {}): Hoje {
  return { ...hojeFixture, linhas, avisos: [], ...sobre };
}

beforeEach(() => {
  navegacao.replace.mockClear();
});

// ─── Os três estados ─────────────────────────────────────────────────────────

describe("estados da tela", () => {
  it("mostra a saudação e as linhas depois de carregar", async () => {
    servirApi({ "GET /api/hoje": { corpo: hojeFixture } });

    renderizar(<TelaHoje />);

    expect(await screen.findByText(/Tiago/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar 💧 Água" })).toBeInTheDocument();
  });

  it("um erro do servidor vira mensagem com o texto que ele mandou", async () => {
    servirApi({
      "GET /api/hoje": {
        erro: { codigo: "interno", mensagem: "O banco não respondeu." },
        status: 500,
      },
    });

    renderizar(<TelaHoje />);

    expect(await screen.findByText("O banco não respondeu.")).toBeInTheDocument();
  });

  it("401 manda ao login em vez de mostrar erro — a decisão mora no cliente", async () => {
    servirApi({
      "GET /api/hoje": {
        erro: { codigo: "nao_autenticado", mensagem: "Entre para continuar." },
        status: 401,
      },
    });

    renderizar(<TelaHoje />);

    await waitFor(() => expect(navegacao.replace).toHaveBeenCalledWith("/login"));
  });

  it("409 manda ao cadastro de biometria: sessão existe, mas está incompleta", async () => {
    servirApi({
      "GET /api/hoje": {
        erro: { codigo: "conflito", mensagem: "Cadastre a biometria para continuar." },
        status: 409,
      },
    });

    renderizar(<TelaHoje />);

    await waitFor(() => expect(navegacao.replace).toHaveBeenCalledWith("/biometria"));
  });

  it("sem hábitos, convida a criar o primeiro", async () => {
    servirApi({ "GET /api/hoje": { corpo: hojeCom([]) } });

    renderizar(<TelaHoje />);

    expect(await screen.findByRole("link", { name: /criar/i })).toBeInTheDocument();
  });
});

// ─── Marcar ──────────────────────────────────────────────────────────────────

describe("marcar", () => {
  it("manda habitoId e ocorrenciaId, e nunca a data lógica", async () => {
    /* A dose das 20:00: habito fixo, para a ocorrencia tambem viajar. */
    const dose = linha("💊 Vitamina D", "20:00:00");
    const api = servirApi({
      "GET /api/hoje": { corpo: hojeCom([dose]) },
      "POST /api/registros": {
        corpo: { ...registroCriadoFixture, habitoId: dose.habitoId },
        status: 201,
      },
    });

    renderizar(<TelaHoje />);
    await userEvent.click(await screen.findByRole("button", { name: "Marcar 💊 Vitamina D" }));

    const [chamada] = api.de("POST /api/registros");
    expect(chamada.corpo).toMatchObject({
      habitoId: dose.habitoId,
      ocorrenciaId: dose.ocorrenciaId,
      origem: "app",
    });
    /*
     * A ausência é o teste: quem aplica a virada das 04:00 é o servidor, e um
     * `dataLogica` daqui usaria o relógio do celular para escolher o período.
     */
    expect(chamada.corpo).not.toHaveProperty("dataLogica");
  });

  it("a marca fica cheia sem esperar um novo GET", async () => {
    const correr = linha("🏃 Correr");
    const api = servirApi({
      "GET /api/hoje": { corpo: hojeCom([correr]) },
      "POST /api/registros": {
        corpo: { ...registroCriadoFixture, habitoId: correr.habitoId, valor: 1 },
        status: 201,
      },
    });

    renderizar(<TelaHoje />);
    await userEvent.click(await screen.findByRole("button", { name: "Marcar 🏃 Correr" }));

    expect(await screen.findByRole("button", { name: /Desmarcar 🏃 Correr/ })).toBeInTheDocument();
    /* Um GET só: o payload da escrita já traz o que redesenhar. */
    expect(api.de("GET /api/hoje")).toHaveLength(1);
  });

  it("no quantificado o toque abre o painel, e é o painel que registra", async () => {
    /*
     * A diferença por tipo que o Mapa de telas define: `binario` marca no toque,
     * `quantificado` **abre o incremento**. Tocar a marca aqui não deve gravar
     * nada — foi o comportamento antigo, e ele desenhava disco cheio com 1750 ml
     * faltando.
     */
    const agua = linha("💧 Água");
    const api = servirApi({
      "GET /api/hoje": { corpo: hojeCom([agua]) },
      "POST /api/registros": {
        corpo: { ...registroCriadoFixture, habitoId: agua.habitoId, valor: 300 },
        status: 201,
      },
    });

    renderizar(<TelaHoje />);
    await userEvent.click(await screen.findByRole("button", { name: "Registrar 💧 Água" }));

    expect(api.de("POST /api/registros")).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: /^Registrar 300 ml$/ }));

    /* 300 ml é o passo configurado do hábito, e o painel o sugere. */
    expect(api.de("POST /api/registros")[0].corpo).toMatchObject({ valor: 300 });
  });

  it("a recusa do servidor aparece e a linha não muda", async () => {
    const correr = linha("🏃 Correr");
    servirApi({
      "GET /api/hoje": { corpo: hojeCom([correr]) },
      "POST /api/registros": {
        erro: { codigo: "regra_violada", mensagem: "Este hábito está pausado." },
        status: 422,
      },
    });

    renderizar(<TelaHoje />);
    await userEvent.click(await screen.findByRole("button", { name: "Marcar 🏃 Correr" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Este hábito está pausado.");
    expect(screen.getByRole("button", { name: "Marcar 🏃 Correr" })).toBeInTheDocument();
  });

  it("a queda de rede também vira mensagem exibível", async () => {
    servirApi({ "GET /api/hoje": { corpo: hojeCom([linha("🏃 Correr")]) } });

    renderizar(<TelaHoje />);

    /* Sem a rota de POST servida, o `fetch` falso lança — é a queda de rede. */
    await userEvent.click(await screen.findByRole("button", { name: "Marcar 🏃 Correr" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/não foi possível falar/i);
  });
});

// ─── Desmarcar ───────────────────────────────────────────────────────────────

describe("desmarcar", () => {
  it("apaga pelo id que a linha carrega e volta a marca para aberta", async () => {
    const correr = {
      ...linha("🏃 Correr"),
      concluida: true,
      ultimoRegistro: { id: "reg-1", valor: 1 },
    };

    const api = servirApi({
      "GET /api/hoje": { corpo: hojeCom([correr]) },
      "DELETE /api/registros/:id": { corpo: { efeitos: registroCriadoFixture.efeitos } },
    });

    renderizar(<TelaHoje />);
    await userEvent.click(await screen.findByRole("button", { name: /Desmarcar 🏃 Correr/ }));

    expect(api.de("DELETE /api/registros/:id")).toHaveLength(1);
    expect(await screen.findByRole("button", { name: "Marcar 🏃 Correr" })).toBeInTheDocument();
  });

  it("cumprido sem registro conhecido não oferece desfazer", async () => {
    /*
     * É o estado de quem recarregou a tela: o payload traz o último registro do
     * dia, e sem ele não há como saber **quanto** desfazer. Oferecer o botão daria
     * um 404 ou uma conta errada.
     */
    const correr = { ...linha("🏃 Correr"), concluida: true, ultimoRegistro: null };
    servirApi({ "GET /api/hoje": { corpo: hojeCom([correr]) } });

    renderizar(<TelaHoje />);

    expect(await screen.findByRole("button", { name: "🏃 Correr: cumprido" })).toBeDisabled();
  });
});

// ─── O que a tela conclui sozinha ────────────────────────────────────────────

describe("tudo cumprido", () => {
  it("aparece quando todas as linhas estão concluídas", async () => {
    const cumpridas = hojeFixture.linhas.map((l) => ({ ...l, concluida: true }));
    servirApi({ "GET /api/hoje": { corpo: hojeCom(cumpridas) } });

    renderizar(<TelaHoje />);

    expect(await screen.findByText(/cumprido/i)).toBeInTheDocument();
  });

  it("não aparece com uma linha aberta", async () => {
    const [primeira, ...resto] = hojeFixture.linhas;
    servirApi({
      "GET /api/hoje": {
        corpo: hojeCom([
          { ...primeira, concluida: false },
          ...resto.map((l) => ({ ...l, concluida: true })),
        ]),
      },
    });

    renderizar(<TelaHoje />);
    await screen.findByText("💧 Água");

    expect(screen.queryByText(/tudo cumprido/i)).not.toBeInTheDocument();
  });
});

describe("avisos", () => {
  it("mostra o que já aconteceu e deixa dispensar", async () => {
    const [aviso] = hojeFixture.avisos;
    servirApi({
      "GET /api/hoje": { corpo: hojeCom([linha("🏃 Correr")], { avisos: [aviso] }) },
    });

    renderizar(<TelaHoje />);

    const dispensar = await screen.findByRole("button", { name: /dispensar/i });
    await userEvent.click(dispensar);

    /*
     * Dispensar é local e vale por esta carga: não há registro de leitura no
     * banco, e o aviso reaparece no próximo GET enquanto estiver na janela de
     * dois dias. É a decisão da etapa 2.3, não um esquecimento.
     */
    expect(screen.queryByRole("button", { name: /dispensar/i })).not.toBeInTheDocument();
  });
});

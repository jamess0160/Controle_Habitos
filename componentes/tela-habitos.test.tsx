/**
 * @jest-environment jsdom
 */

/**
 * A lista de hábitos, com foco na **exclusão**.
 *
 * Arquivar, pausar e reordenar já têm o comportamento provado no servidor; o que
 * precisa de teste de tela é a única ação sem volta do app. Três coisas podem dar
 * errado aqui, e as três são invisíveis em teste de servidor: "Apagar" aparecer
 * num hábito ativo, o `DELETE` sair antes da confirmação, e o hábito apagado
 * continuar na lista depois da resposta.
 *
 * Os dados saem das fixtures dos contratos, não de objetos escritos à mão: é o
 * que garante que a tela seja testada contra o payload que o servidor promete.
 */

jest.mock("next/navigation", () => {
  const estado = { replace: jest.fn(), push: jest.fn(), params: {} as Record<string, string> };
  /* Referência estável — ver a nota em `apoio-de-teste.tsx`. */
  const router = { replace: estado.replace, push: estado.push };
  return { estado, useRouter: () => router, useParams: () => estado.params };
});

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ListaDeHabitos } from "@/contracts";
import {
  habitoApagadoFixture,
  habitoArquivado,
  habitoAgua,
  historicoDoHabitoFixture,
} from "@/contracts/fixtures";
import { renderizar, servirApi, type Navegacao } from "./apoio-de-teste";
import { TelaHabitos } from "./tela-habitos";

const { estado: navegacao } = jest.requireMock<{ estado: Navegacao }>("next/navigation");

const LISTA: ListaDeHabitos = { habitos: [habitoAgua], arquivados: [habitoArquivado] };

/** A seção de arquivados é um `<details>` fechado: sem abrir, nada dentro existe. */
async function abrirArquivados() {
  await userEvent.click(await screen.findByText("Arquivados (1)"));
}

function servir() {
  return servirApi({
    "GET /api/habitos": { corpo: LISTA },
    "GET /api/habitos/:id/historico": { corpo: historicoDoHabitoFixture },
    "DELETE /api/habitos/:id": { corpo: habitoApagadoFixture },
  });
}

beforeEach(() => {
  navegacao.replace.mockClear();
});

describe("apagar", () => {
  /*
   * A asserção é **por cartão**, e não no documento: um `<details>` fechado
   * continua tendo os filhos no DOM (ele esconde por apresentação, não por
   * montagem), então procurar "Apagar" na tela inteira acharia o botão do
   * arquivado e não diria nada sobre o ativo — que é o que importa aqui.
   */
  function cartaoDe(nome: string): HTMLElement {
    const cartao = screen.getByText(nome).closest("li");
    if (cartao === null) throw new Error(`cartão não encontrado: ${nome}`);
    return cartao;
  }

  it("a ação existe no arquivado e não no ativo", async () => {
    servir();
    renderizar(<TelaHabitos />);
    await screen.findByText(habitoAgua.nome);

    const ativo = within(cartaoDe(habitoAgua.nome));
    expect(ativo.getByRole("button", { name: "Arquivar" })).toBeInTheDocument();
    expect(ativo.queryByRole("button", { name: "Apagar" })).not.toBeInTheDocument();

    const arquivado = within(cartaoDe(habitoArquivado.nome));
    expect(arquivado.getByRole("button", { name: "Desarquivar" })).toBeInTheDocument();
    expect(arquivado.getByRole("button", { name: "Apagar" })).toBeInTheDocument();
  });

  it("o primeiro toque não apaga: ele busca o histórico e pede confirmação", async () => {
    const api = servir();
    renderizar(<TelaHabitos />);
    await abrirArquivados();

    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));

    /* O número do estrago vem do servidor, e aparece antes de a decisão ser tomada. */
    expect(await screen.findByText(/2 marcações em 2 dias/)).toBeInTheDocument();
    expect(api.de("GET /api/habitos/:id/historico")).toHaveLength(1);
    expect(api.de("DELETE /api/habitos/:id")).toHaveLength(0);
  });

  it("cancelar volta às ações, sem chamar nada", async () => {
    const api = servir();
    renderizar(<TelaHabitos />);
    await abrirArquivados();

    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar" }));

    expect(screen.getByRole("button", { name: "Desarquivar" })).toBeInTheDocument();
    expect(api.de("DELETE /api/habitos/:id")).toHaveLength(0);
  });

  it("o segundo toque apaga, e o hábito sai da lista", async () => {
    const api = servir();
    renderizar(<TelaHabitos />);
    await abrirArquivados();

    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));
    await userEvent.click(await screen.findByRole("button", { name: "Apagar para sempre" }));

    await waitFor(() => expect(api.de("DELETE /api/habitos/:id")).toHaveLength(1));

    /*
     * A seção de arquivados desaparece inteira: era o único arquivado. Se a tela
     * dependesse de recarregar a lista, o hábito apagado ficaria à vista até o
     * `GET` voltar — e aqui o `GET` responde a lista **com** ele, de propósito.
     */
    await waitFor(() =>
      expect(screen.queryByText(habitoArquivado.nome)).not.toBeInTheDocument(),
    );
    expect(screen.getByText(habitoAgua.nome)).toBeInTheDocument();
  });

  it("o aviso de sucesso diz o que foi destruído", async () => {
    servir();
    renderizar(<TelaHabitos />);
    await abrirArquivados();

    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));
    await userEvent.click(await screen.findByRole("button", { name: "Apagar para sempre" }));

    const aviso = await screen.findByRole("status");
    expect(aviso).toHaveTextContent(`${habitoArquivado.nome} foi apagado, com 2 marcações.`);
  });

  it("recusa do servidor aparece como erro, e o hábito fica", async () => {
    const api = servir();
    api.responder("DELETE /api/habitos/:id", {
      erro: { codigo: "regra_violada", mensagem: "Arquive o hábito antes de apagá-lo." },
      status: 422,
    });

    renderizar(<TelaHabitos />);
    await abrirArquivados();

    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));
    await userEvent.click(await screen.findByRole("button", { name: "Apagar para sempre" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Arquive o hábito antes de apagá-lo.",
    );
    expect(screen.getByText(habitoArquivado.nome)).toBeInTheDocument();
  });

  /*
   * A contagem é informação, não autorização: se ela falha, a tela diz que não
   * sabe o tamanho do estrago em vez de fingir zero — e apagar segue possível,
   * porque o número não é o que dá permissão.
   */
  it("histórico que não carrega não bloqueia, mas a tela admite que não sabe", async () => {
    const api = servir();
    api.responder("GET /api/habitos/:id/historico", {
      erro: { codigo: "interno", mensagem: "O servidor respondeu 500." },
      status: 500,
    });

    renderizar(<TelaHabitos />);
    await abrirArquivados();

    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));

    expect(await screen.findByText(/não sei dizer quanto se perde/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Apagar para sempre" }));
    await waitFor(() => expect(api.de("DELETE /api/habitos/:id")).toHaveLength(1));
  });
});

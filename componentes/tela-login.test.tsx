/**
 * @jest-environment jsdom
 */

/**
 * O login (etapa 3.7).
 *
 * É a tela em que errar custa mais, e por motivos que não são de domínio:
 *
 * - o **bloqueio por tentativas** tem de esconder o formulário, e não pode dizer
 *   nada sobre qual tentativa acertou — dizer entregaria a senha;
 * - o aviso de `APP_MODO=desenvolvimento` é a última linha de defesa contra a
 *   chave vazar no deploy, e ele precisa estar visível;
 * - qual botão aparece depende de `temPasskey` e `senhaAtiva`, e a combinação
 *   errada tranca o acesso ou oferece uma porta que não existe.
 *
 * Os quatro estados vêm dos fixtures de `estadoAuth`, que é o mesmo payload que
 * `GET /api/auth/estado` monta no servidor.
 */

jest.mock("next/navigation", () => {
  const estado = { replace: jest.fn(), push: jest.fn(), params: {} as Record<string, string> };
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
import type { EstadoAuth } from "@/contracts";
import {
  estadoAuthFixture,
  estadoAuthBloqueadoFixture,
  estadoAuthPrimeiroAcessoFixture,
} from "@/contracts/fixtures";
import { renderizar, servirApi, type Navegacao } from "./apoio-de-teste";
import { TelaLogin } from "./tela-login";

const { estado: navegacao } = jest.requireMock<{ estado: Navegacao }>("next/navigation");

const ESTADO = "GET /api/auth/estado" as const;
const SENHA = "POST /api/auth/senha" as const;

function auth(sobre: Partial<EstadoAuth> = {}): EstadoAuth {
  return { ...estadoAuthFixture, ...sobre };
}

beforeEach(() => {
  navegacao.replace.mockClear();
  semWebauthn();
});

/**
 * Declara (ou retira) o suporte a WebAuthn no `window`.
 *
 * O jsdom não implementa `PublicKeyCredential`, então sem isto a tela sempre cai
 * no ramo "este navegador não tem suporte" — e o botão de biometria, que é o
 * acesso normal em produção, nunca apareceria no teste. O que se declara aqui é
 * só a presença da API; usá-la de verdade é assunto do aparelho.
 */
function comWebauthn(): void {
  Object.defineProperty(window, "PublicKeyCredential", {
    value: class {},
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, "credentials", {
    value: { create: () => Promise.reject(new Error("nao usado")), get: () => Promise.reject(new Error("nao usado")) },
    configurable: true,
    writable: true,
  });
}

function semWebauthn(): void {
  Object.defineProperty(window, "PublicKeyCredential", {
    value: undefined,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, "credentials", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

// ─── Os quatro estados ───────────────────────────────────────────────────────

describe("o que aparece em cada estado", () => {
  it("primeiro acesso: só a senha", async () => {
    servirApi({ [ESTADO]: { corpo: estadoAuthPrimeiroAcessoFixture } });

    renderizar(<TelaLogin />);

    expect(await screen.findByLabelText(/^Senha/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /biometria|desbloquear/i })).not.toBeInTheDocument();
  });

  it("produção com passkey: biometria, e nenhum campo de senha", async () => {
    comWebauthn();
    /* A senha é desativada no cadastro da biometria — é a porta única fechando. */
    servirApi({ [ESTADO]: { corpo: auth({ temPasskey: true, senhaAtiva: false }) } });

    renderizar(<TelaLogin />);

    expect(await screen.findByRole("button", { name: /biometria|desbloquear/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Senha/)).not.toBeInTheDocument();
  });

  it("sem credencial nenhuma: manda rodar o seed em vez de um formulário inútil", async () => {
    servirApi({ [ESTADO]: { corpo: auth({ temPasskey: false, senhaAtiva: false }) } });

    renderizar(<TelaLogin />);

    expect(await screen.findByText(/não tem credencial cadastrada/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Senha/)).not.toBeInTheDocument();
  });

  it("bloqueado: a contagem no lugar do formulário", async () => {
    /*
     * A fixture tem um instante fixo; o bloqueio é recalculado contra o relógio,
     * então aqui ele é empurrado para o futuro para o caso não depender da data
     * em que a suíte roda.
     */
    const daquiAPouco = new Date(Date.now() + 10 * 60_000).toISOString();
    servirApi({
      [ESTADO]: { corpo: { ...estadoAuthBloqueadoFixture, bloqueadoAte: daquiAPouco } },
    });

    renderizar(<TelaLogin />);

    expect(await screen.findByText("Entrada bloqueada")).toBeInTheDocument();
    /* Nada sobre qual tentativa acertou: isso entregaria a senha. */
    expect(screen.queryByLabelText(/^Senha/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Entrar$/ })).not.toBeInTheDocument();
  });

  it("bloqueio vencido volta a oferecer entrada", async () => {
    const jaPassou = new Date(Date.now() - 60_000).toISOString();
    servirApi({
      [ESTADO]: { corpo: { ...estadoAuthPrimeiroAcessoFixture, bloqueadoAte: jaPassou } },
    });

    renderizar(<TelaLogin />);

    expect(await screen.findByLabelText(/^Senha/)).toBeInTheDocument();
    expect(screen.queryByText("Entrada bloqueada")).not.toBeInTheDocument();
  });


  it("sem suporte a biometria e sem senha, a CLI é a única saída — e a tela diz isso", async () => {
    /*
     * O desktop sem autenticador diante de um app cuja única porta é a passkey.
     * Não há o que tentar na tela, e esconder isso deixaria a pessoa clicando num
     * botão que falha sempre.
     */
    servirApi({ [ESTADO]: { corpo: auth({ temPasskey: true, senhaAtiva: false }) } });

    renderizar(<TelaLogin />);

    expect(await screen.findByText(/não tem suporte a biometria/i)).toBeInTheDocument();
    expect(screen.getByText(/cli:reset-biometria/)).toBeInTheDocument();
  });

  it("sem suporte MAS com senha ativa, não alarma: o formulário resolve", async () => {
    servirApi({ [ESTADO]: { corpo: auth({ temPasskey: true, senhaAtiva: true }) } });

    renderizar(<TelaLogin />);

    expect(await screen.findByLabelText(/^Senha/)).toBeInTheDocument();
    expect(screen.queryByText(/não tem suporte a biometria/i)).not.toBeInTheDocument();
  });
});

// ─── O aviso de modo ─────────────────────────────────────────────────────────

describe("aviso de APP_MODO", () => {
  it("aparece em desenvolvimento", async () => {
    servirApi({ [ESTADO]: { corpo: auth({ modoDesenvolvimento: true }) } });

    renderizar(<TelaLogin />);

    expect(await screen.findByText(/APP_MODO=desenvolvimento/)).toBeInTheDocument();
  });

  it("não aparece em produção — e é por isso que o aviso significa algo", async () => {
    comWebauthn();
    servirApi({ [ESTADO]: { corpo: auth({ modoDesenvolvimento: false }) } });

    renderizar(<TelaLogin />);
    await screen.findByRole("button", { name: /biometria|desbloquear/i });

    expect(screen.queryByText(/APP_MODO=desenvolvimento/)).not.toBeInTheDocument();
  });

  it("o cliente aprende o modo do payload, não de uma variável do bundle", async () => {
    const api = servirApi({ [ESTADO]: { corpo: auth({ modoDesenvolvimento: true }) } });

    renderizar(<TelaLogin />);
    await screen.findByText(/APP_MODO=desenvolvimento/);

    /*
     * Uma fonte só: `NEXT_PUBLIC_*` seria inlinada no build e poderia divergir do
     * que o servidor realmente lê a cada requisição.
     */
    expect(api.de(ESTADO)).toHaveLength(1);
  });
});

// ─── Entrar com senha ────────────────────────────────────────────────────────

describe("entrar com senha", () => {
  it("manda a senha e segue para onde o servidor disse", async () => {
    const api = servirApi({
      [ESTADO]: { corpo: estadoAuthPrimeiroAcessoFixture },
      [SENHA]: { corpo: { proximoPasso: "cadastrar_biometria" } },
    });

    renderizar(<TelaLogin />);
    await userEvent.type(await screen.findByLabelText(/^Senha/), "ABCD-EFGH-JKMN-PQRS");
    await userEvent.click(screen.getByRole("button", { name: /^Entrar$/ }));

    await waitFor(() => expect(navegacao.replace).toHaveBeenCalledWith("/biometria"));
    expect(api.de(SENHA)[0].corpo).toEqual({ senha: "ABCD-EFGH-JKMN-PQRS" });
  });

  it("senha errada: mensagem, campo limpo e estado recarregado", async () => {
    const api = servirApi({
      [ESTADO]: { corpo: estadoAuthPrimeiroAcessoFixture },
      [SENHA]: { erro: { codigo: "nao_autenticado", mensagem: "Senha incorreta." }, status: 401 },
    });

    renderizar(<TelaLogin />);
    const campo = await screen.findByLabelText(/^Senha/);
    await userEvent.type(campo, "errada");
    await userEvent.click(screen.getByRole("button", { name: /^Entrar$/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Senha incorreta.");
    expect(campo).toHaveValue("");

    /*
     * A recarga é o ponto: a tentativa pode ter sido a quinta, e aí o que a tela
     * precisa mostrar é a contagem do bloqueio — não o formulário outra vez.
     */
    await waitFor(() => expect(api.de(ESTADO).length).toBeGreaterThan(1));
    expect(navegacao.replace).not.toHaveBeenCalled();
  });

  it("a quinta tentativa troca o formulário pelo bloqueio", async () => {
    const api = servirApi({
      [ESTADO]: { corpo: estadoAuthPrimeiroAcessoFixture },
      [SENHA]: {
        erro: { codigo: "bloqueado", mensagem: "Muitas tentativas." },
        status: 429,
      },
    });

    renderizar(<TelaLogin />);

    /* O servidor passa a responder bloqueado — é o que a recarga vai encontrar. */
    api.responder(ESTADO, {
      corpo: {
        ...estadoAuthPrimeiroAcessoFixture,
        bloqueadoAte: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
    });

    await userEvent.type(await screen.findByLabelText(/^Senha/), "errada");
    await userEvent.click(screen.getByRole("button", { name: /^Entrar$/ }));

    expect(await screen.findByText("Entrada bloqueada")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Senha/)).not.toBeInTheDocument();
  });
});

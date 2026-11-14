import { render } from "@testing-library/react";
import type { ReactElement } from "react";

/**
 * O que os testes de tela precisam ter em volta: um `fetch` que responde como a
 * API e uma navegação que registra para onde foi.
 *
 * O `fetch` é mockado, e não `cliente/api.ts`: assim o teste exercita o cliente
 * de verdade — o formato único de erro, o desvio de 401 para o login, o de 409
 * para a biometria. Mockar `api.ts` testaria a tela contra um dublê do contrato
 * em vez de contra o contrato.
 */

export type Rota = `${"GET" | "POST" | "PATCH" | "PUT" | "DELETE"} ${string}`;

/** O que uma rota responde: o corpo, ou um erro com código. */
export type Resposta =
  | { corpo: unknown; status?: number }
  | { erro: { codigo: string; mensagem: string }; status: number };

type Chamada = { rota: Rota; corpo: unknown };

export type Api = {
  /** Toda chamada que passou, em ordem — é por aqui que se afirma o que a tela pediu. */
  readonly chamadas: Chamada[];
  /** Troca a resposta de uma rota no meio do teste. */
  responder(rota: Rota, resposta: Resposta): void;
  /** As chamadas de uma rota, já com o corpo desserializado. */
  de(rota: Rota): Chamada[];
};

/**
 * Instala o `fetch` falso.
 *
 * As rotas aceitam `:id` como curinga de um segmento, porque
 * `DELETE /api/registros/:id` é endereçada por um id que a fixture inventa e o
 * teste não deveria precisar repetir.
 */
export function servirApi(rotas: Partial<Record<Rota, Resposta>>): Api {
  const tabela = new Map<Rota, Resposta>(Object.entries(rotas) as Array<[Rota, Resposta]>);
  const chamadas: Chamada[] = [];

  const fetchFalso = jest.fn(async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = typeof entrada === "string" ? entrada : entrada.toString();
    const metodo = (init?.method ?? "GET").toUpperCase();
    const achada = casar(tabela, metodo, url);

    if (achada === undefined) {
      throw new Error(`rota não servida no teste: ${metodo} ${url}`);
    }

    const [rota, resposta] = achada;
    chamadas.push({
      rota,
      corpo: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });

    if ("erro" in resposta) {
      return respostaFalsa({ erro: resposta.erro }, resposta.status);
    }

    return respostaFalsa(resposta.corpo, resposta.status ?? 200);
  });

  global.fetch = fetchFalso as unknown as typeof fetch;

  return {
    chamadas,
    responder: (rota, resposta) => tabela.set(rota, resposta),
    de: (rota) => chamadas.filter((c) => c.rota === rota),
  };
}

/**
 * O mínimo de `Response` que `cliente/api.ts` toca: `ok`, `status` e `json()`.
 *
 * Um `Response` de verdade não serve aqui — o ambiente `jsdom` do Jest substitui
 * os globais do Node pelos do jsdom, que **não** tem `Response`. Construí-lo
 * lançaria dentro do `try` do cliente, e toda chamada do teste viraria "não foi
 * possível falar com o servidor": o erro de rede, mascarando o teste inteiro.
 */
function respostaFalsa(corpo: unknown, status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  } as Response;
}

function casar(
  tabela: Map<Rota, Resposta>,
  metodo: string,
  url: string,
): [Rota, Resposta] | undefined {
  const caminho = url.replace(/^https?:\/\/[^/]+/, "");

  for (const [rota, resposta] of tabela) {
    const [metodoDaRota, padrao] = rota.split(" ") as [string, string];
    if (metodoDaRota !== metodo) continue;

    const regex = new RegExp(`^${padrao.replace(/:\w+/g, "[^/]+")}$`);
    if (regex.test(caminho)) return [rota, resposta];
  }

  return undefined;
}

// ─── Navegação ───────────────────────────────────────────────────────────────

/**
 * `next/navigation` é mockado **em cada arquivo de teste**, não aqui.
 *
 * `jest.mock` é içado acima de tudo no módulo onde aparece, então uma função
 * auxiliar que o chamasse rodaria tarde demais — a tela já teria importado o
 * módulo real. E o estado do mock tem de nascer dentro da factory, senão uma
 * referência a um `const` de fora cai em TDZ quando o primeiro import dispara.
 *
 * O padrão, idêntico ao que [rotas.test.ts](../servidor/rotas.test.ts) usa para
 * `next/headers`:
 *
 * ```ts
 * jest.mock("next/navigation", () => {
 *   const estado = { replace: jest.fn(), params: {} as Record<string, string> };
 *   const router = { replace: estado.replace };
 *   return { estado, useRouter: () => router, useParams: () => estado.params };
 * });
 * const { estado: navegacao } = jest.requireMock<{ estado: Navegacao }>("next/navigation");
 * ```
 *
 * O `router` é criado **uma** vez de propósito. `useRecurso` o tem entre as
 * dependências do efeito que busca; um objeto novo a cada render refaz o `GET`
 * sem parar e atropela a atualização otimista que a tela acabou de aplicar. O
 * `useRouter` de verdade devolve referência estável, e um mock que não devolve
 * testa um comportamento que não existe.
 */
export type Navegacao = {
  replace: jest.Mock;
  params: Record<string, string>;
};

// ─── Render ──────────────────────────────────────────────────────────────────

export function renderizar(ui: ReactElement) {
  return render(ui);
}

"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { RespostaErro } from "@/contracts";

/**
 * Acesso à API pelo cliente.
 *
 * As telas da etapa 2 buscam no navegador, não no servidor, por três motivos
 * concretos:
 *
 * 1. a autorização é por **cookie de sessão**, que o `fetch` de mesma origem
 *    manda sozinho — de um componente de servidor seria preciso montar URL
 *    absoluta e repassar o cookie à mão;
 * 2. as interações que importam (cronômetro, incremento, recaída) são de cliente
 *    de todo jeito, e um registro precisa redesenhar a linha na hora;
 * 3. os estados "carregando" e "erro" que a etapa 2 tem de mostrar nascem daqui
 *    de graça.
 *
 * `servidor/` é o espelho disto no outro lado: lá mora o que responde, aqui o
 * que chama.
 */

export type Falha = RespostaErro["erro"];

export type Resultado<T> = { ok: true; dados: T } | { ok: false; falha: Falha };

const SEM_CONEXAO: Falha = {
  codigo: "interno",
  mensagem: "Não foi possível falar com o servidor.",
};

/**
 * Uma chamada à API, com o erro já no formato único de `contracts/erro.ts`.
 *
 * Toda falha sai por aqui com o mesmo shape — inclusive a de rede, que não vem
 * do servidor. Assim nenhuma tela precisa distinguir "respondeu erro" de "não
 * respondeu": as duas chegam como `Falha` com mensagem exibível.
 */
export async function chamar<T>(url: string, init?: RequestInit): Promise<Resultado<T>> {
  let resposta: Response;

  try {
    resposta = await fetch(url, {
      ...init,
      headers:
        init?.body === undefined
          ? init?.headers
          : { "content-type": "application/json", ...init.headers },
    });
  } catch {
    return { ok: false, falha: SEM_CONEXAO };
  }

  let payload: unknown = null;
  try {
    payload = await resposta.json();
  } catch {
    /* 204, HTML inesperado, corpo truncado: cai no erro genérico abaixo. */
  }

  if (!resposta.ok) {
    const falha = (payload as RespostaErro | null)?.erro;
    return {
      ok: false,
      falha: falha ?? { codigo: "interno", mensagem: `O servidor respondeu ${resposta.status}.` },
    };
  }

  return { ok: true, dados: payload as T };
}

/** Atalho para as rotas de escrita, que são todas JSON. */
export function enviar<T>(url: string, metodo: string, corpo?: unknown): Promise<Resultado<T>> {
  return chamar<T>(url, {
    method: metodo,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
}

export type Recurso<T> =
  | { estado: "carregando" }
  | { estado: "erro"; falha: Falha }
  | { estado: "pronto"; dados: T };

/** Lê um recurso da API e devolve os três estados da tela. */
export function useRecurso<T>(url: string) {
  const router = useRouter();
  const [recurso, setRecurso] = useState<Recurso<T>>({ estado: "carregando" });
  const [gatilho, setGatilho] = useState(0);

  useEffect(() => {
    /*
     * A flag impede que uma resposta atrasada sobrescreva uma mais nova: trocar
     * de hábito no meio de um `GET` deixava a tela mostrando os dados do
     * anterior quando a primeira resposta chegava depois da segunda.
     */
    let atual = true;

    void chamar<T>(url).then((r) => {
      if (!atual) return;

      if (r.ok) {
        setRecurso({ estado: "pronto", dados: r.dados });
        return;
      }

      /*
       * O desvio de 401 e 409 fica aqui, e não em cada tela, porque é o par
       * exato que `exigirAcesso()` produz no servidor: **401** significa "sem
       * sessão" e manda ao login, **409** significa "sessão sem passkey" e manda
       * ao cadastro de biometria. Repetir essa decisão em sete telas seria sete
       * chances de divergir da guarda do [proxy](../proxy.ts).
       */
      if (r.falha.codigo === "nao_autenticado") {
        router.replace("/login");
        return;
      }

      if (r.falha.codigo === "conflito") {
        router.replace("/biometria");
        return;
      }

      setRecurso({ estado: "erro", falha: r.falha });
    });

    return () => {
      atual = false;
    };
  }, [url, gatilho, router]);

  /**
   * Pede uma nova busca incrementando um gatilho, em vez de chamar a função de
   * busca direto.
   *
   * Duas razões. A primeira é que `setState` chamado de dentro do corpo de um
   * efeito é o que o `react-hooks/set-state-in-effect` recusa — e com razão: a
   * busca pertence ao efeito, que é quem sabe cancelá-la. A segunda é que assim a
   * recarga **mantém os dados atuais na tela** enquanto a nova resposta não
   * chega, em vez de piscar o esqueleto de carregamento a cada atualização.
   */
  const recarregar = useCallback(() => {
    setGatilho((n) => n + 1);
  }, []);

  /**
   * Troca os dados em mãos sem ir ao servidor.
   *
   * Existe porque as rotas de escrita devolvem o recurso atualizado: pausar um
   * hábito responde o **hábito**, não `ok: true`, e um registro responde os
   * `efeitos`. Recarregar a tela inteira depois de cada toque jogaria fora
   * exatamente o que o contrato se deu o trabalho de devolver.
   */
  const definir = useCallback((dados: T) => {
    setRecurso({ estado: "pronto", dados });
  }, []);

  return { recurso, recarregar, definir };
}

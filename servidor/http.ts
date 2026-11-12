import * as z from "zod";
import { erroDe, STATUS_DE, validar, type CodigoErro, type Validado } from "@/contracts";
import { sessaoAtual, type Sessao } from "./sessao";

/**
 * Plumbing dos route handlers: resposta, erro padronizado, corpo validado e o
 * portão de sessão.
 *
 * Existe para o handler ficar com três linhas de cerimônia e nada mais — toda
 * rota de domínio começa com o portão e, quando escreve, com a validação do
 * corpo. Centralizar aqui é o que garante que **nenhuma** rota responda um erro
 * fora do shape de `respostaErro`.
 */

export function json<T>(dados: T, status = 200, headers?: HeadersInit): Response {
  return Response.json(dados, { status, headers });
}

export function falha(codigo: CodigoErro, mensagem: string): Response {
  return Response.json(erroDe(codigo, mensagem), { status: STATUS_DE[codigo] });
}

/**
 * Lê e valida o corpo JSON.
 *
 * JSON malformado vira 422 de validação, e não 500: corpo inválido é erro de
 * quem chamou, e um `await req.json()` sem try/catch transformaria isso em
 * exceção não tratada no servidor.
 */
export async function corpo<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<Validado<z.infer<S>>> {
  let payload: unknown;

  try {
    payload = await req.json();
  } catch {
    return {
      ok: false,
      status: STATUS_DE.validacao,
      resposta: erroDe("validacao", "O corpo da requisição não é um JSON válido."),
    };
  }

  return validar(schema, payload);
}

export type Acesso = { liberado: true; sessao: Sessao } | { liberado: false; resposta: Response };

/**
 * Portão de toda rota de domínio: exige sessão **e** passkey cadastrada.
 *
 * A guarda "sem passkey ⇒ só a tela de biometria" tem de valer na API também, e
 * não apenas no proxy — senão ela é cosmética: bastaria um `fetch` para operar o
 * app inteiro a partir da sessão provisória do primeiro acesso.
 *
 * Os dois casos têm códigos diferentes de propósito. 401 manda o cliente para o
 * login; 409 diz que a sessão existe mas está incompleta, e é o que faz a tela
 * levar ao cadastro de biometria em vez de pedir a senha outra vez.
 */
export async function exigirAcesso(): Promise<Acesso> {
  const sessao = await sessaoAtual();

  if (sessao === null) {
    return { liberado: false, resposta: falha("nao_autenticado", "Entre para continuar.") };
  }

  if (!sessao.temPasskey) {
    return {
      liberado: false,
      resposta: falha("conflito", "Cadastre a biometria para continuar."),
    };
  }

  return { liberado: true, sessao };
}

/** Portão das rotas do próprio cadastro de biometria: exige sessão, não passkey. */
export async function exigirSessao(): Promise<Acesso> {
  const sessao = await sessaoAtual();

  if (sessao === null) {
    return { liberado: false, resposta: falha("nao_autenticado", "Entre para continuar.") };
  }

  return { liberado: true, sessao };
}

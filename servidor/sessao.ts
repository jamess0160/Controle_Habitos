import { cookies } from "next/headers";
import { COOKIE_SESSAO, lerSessao, valorDeStub, type Sessao } from "./cookie-sessao";

/**
 * Sessão do lado do servidor: lê, abre e fecha o cookie.
 *
 * Usa `cookies()` do Next em vez de ler o header na mão, para o mesmo helper
 * servir route handler e server component — a etapa 2 vai precisar do estado da
 * sessão dentro das telas, não só nas rotas.
 *
 * Atributos do cookie conforme o
 * [Mapa de autenticação](../Docs/mapas/Mapa%20de%20autenticação.md): `httpOnly`,
 * `SameSite=Lax`, 30 dias. `Secure` só em produção — em desenvolvimento o app
 * roda em `http://localhost` e um cookie `Secure` simplesmente não seria
 * gravado, deixando o login quebrado só na máquina de desenvolvimento.
 */

export { COOKIE_SESSAO, type Sessao };

const TRINTA_DIAS = 60 * 60 * 24 * 30;

export async function sessaoAtual(): Promise<Sessao | null> {
  const cookieStore = await cookies();
  return lerSessao(cookieStore.get(COOKIE_SESSAO)?.value);
}

export async function abrirSessao(temPasskey: boolean): Promise<Sessao> {
  const cookieStore = await cookies();
  const token = valorDeStub(temPasskey);

  cookieStore.set({
    name: COOKIE_SESSAO,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TRINTA_DIAS,
  });

  return { token, temPasskey };
}

export async function fecharSessao(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_SESSAO);
}

import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSAO, lerSessao } from "@/servidor/cookie-sessao";

/**
 * Guarda de navegação.
 *
 * No Next 16 o `middleware` virou `proxy` — mesma função, outro nome de arquivo
 * e de export. Aqui ele faz **só** o que a documentação recomenda: uma
 * verificação otimista sobre o cookie, para o usuário não ver o esqueleto de uma
 * tela à qual não tem acesso. A autorização de verdade é de quem responde:
 * `exigirAcesso()` em [servidor/http.ts](servidor/http.ts) para as rotas, e a
 * leitura da sessão nas telas. Proxy não é lugar de consultar banco.
 *
 * Duas regras, as duas vindas do
 * [Mapa de autenticação](Docs/mapas/Mapa%20de%20autenticação.md):
 *
 * 1. sem sessão, só o login existe;
 * 2. com sessão e **sem passkey**, só o cadastro de biometria existe — a sessão
 *    do primeiro acesso não dá acesso a mais nada.
 *
 * E a volta: quem já tem passkey não fica preso no login.
 */

const LOGIN = "/login";
const BIOMETRIA = "/biometria";
const DASHBOARD = "/";

export function proxy(request: NextRequest) {
  const sessao = lerSessao(request.cookies.get(COOKIE_SESSAO)?.value);
  const caminho = request.nextUrl.pathname;

  if (sessao === null) {
    return caminho === LOGIN ? NextResponse.next() : paraOnde(request, LOGIN);
  }

  if (!sessao.temPasskey) {
    return caminho === BIOMETRIA ? NextResponse.next() : paraOnde(request, BIOMETRIA);
  }

  if (caminho === LOGIN || caminho === BIOMETRIA) {
    return paraOnde(request, DASHBOARD);
  }

  return NextResponse.next();
}

function paraOnde(request: NextRequest, caminho: string) {
  return NextResponse.redirect(new URL(caminho, request.url));
}

/**
 * O que fica fora da guarda, e por quê.
 *
 * **`api`**, de propósito: redirecionar uma chamada de API para `/login`
 * devolveria HTML com status 200, e o `fetch` do cliente quebraria num erro de
 * parse em vez de receber o 401 que sabe tratar. Cada route handler se protege
 * com `exigirAcesso()`.
 *
 * **`sw.js`**, porque senão a PWA não instala. O service worker é buscado pelo
 * navegador sem passar por tela nenhuma; redirecioná-lo para o login faz o
 * registro falhar, e sem service worker o Chrome no Android não oferece a
 * instalação do app. Foi exatamente o que aconteceu na primeira versão deste
 * matcher — a guarda respondia 307 para `/sw.js`.
 *
 * **O resto**, para a guarda não derrubar estático: sem matcher o proxy roda até
 * em `_next/static`. As extensões cobrem o que é servido da raiz por `public/`.
 *
 * Os valores precisam ser literais: o Next analisa este `matcher` em tempo de
 * build e **ignora** variável. Por isso o padrão está escrito aqui e o teste em
 * [servidor/rotas.test.ts](servidor/rotas.test.ts) o lê deste arquivo em vez de
 * manter uma segunda cópia.
 */
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|sw\\.js|.*\\.(?:png|svg|ico|webmanifest|js|css|json|txt|woff2)$).*)",
  ],
};

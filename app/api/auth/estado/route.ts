import type { EstadoAuth } from "@/contracts";
import { estadoDaSenha } from "@/servidor/credencial";
import { json } from "@/servidor/http";
import { emDesenvolvimento } from "@/servidor/modo";
import { ipDoPedido } from "@/servidor/pedido";
import { sessaoAtual } from "@/servidor/sessao";
import { estadoDeBloqueio } from "@/servidor/tentativas";
import { temPasskeyCadastrada } from "@/servidor/webauthn";

/**
 * GET /api/auth/estado
 *
 * É daqui que a tela de login decide o que mostrar, e os quatro campos vêm de
 * quatro lugares diferentes: a sessão do cookie, `credencial_passkey`,
 * `credencial_senha` e `tentativa_login`.
 *
 * **Rota pública** — tem de ser: quem está trancado fora é justamente quem
 * precisa dela. Por isso nada aqui conta mais do que a tela de login já pode
 * ver: existe ou não passkey, a senha está ou não ativa, há ou não bloqueio em
 * curso. Nenhum desses três ajuda quem não tem a credencial.
 */
export async function GET(req: Request) {
  const sessao = await sessaoAtual();
  const desenvolvimento = emDesenvolvimento();

  const [temPasskey, senha, bloqueio] = await Promise.all([
    temPasskeyCadastrada(),
    estadoDaSenha(),
    estadoDeBloqueio(ipDoPedido(req)),
  ]);

  const estado: EstadoAuth = {
    autenticado: sessao !== null,
    temPasskey,
    /*
     * Em desenvolvimento a senha vale mesmo com passkey cadastrada — é o ponto
     * todo de `APP_MODO` (ver servidor/modo.ts). Em produção `senhaAtiva` é a
     * coluna do banco, e o cadastro da passkey é quem a desliga.
     */
    senhaAtiva: senha.ativa || (desenvolvimento && senha.existe),
    bloqueadoAte: bloqueio.bloqueadoAte?.toISOString() ?? null,
    modoDesenvolvimento: desenvolvimento,
  };

  return json(estado);
}

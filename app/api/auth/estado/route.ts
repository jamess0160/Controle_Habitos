import type { EstadoAuth } from "@/contracts";
import { json } from "@/servidor/http";
import { emDesenvolvimento } from "@/servidor/modo";
import { sessaoAtual } from "@/servidor/sessao";

/**
 * GET /api/auth/estado
 *
 * Única rota de leitura que **não** devolve fixture: é ela que diz à tela de
 * login o que mostrar, então responder um valor fixo deixaria o fluxo de
 * primeiro acesso → biometria → dashboard impossível de percorrer na etapa 2.
 *
 * Sem sessão, `temPasskey` é `false` — o stub não tem como saber se existe
 * passkey cadastrada sem consultar `credencial_passkey`, e cair no caminho do
 * primeiro acesso é o palpite útil. A etapa 3.1 lê as duas colunas do banco e
 * `bloqueadoAte` sai de `tentativa_login`.
 *
 * `senhaAtiva` é o único campo que o modo do app altera, e é o ponto todo da
 * chave (ver [servidor/modo.ts](../../../../servidor/modo.ts)): em produção a
 * senha morre no cadastro da biometria; em desenvolvimento ela continua valendo
 * ao lado da passkey, porque é o que permite entrar num desktop sem
 * autenticador.
 */
export async function GET() {
  const sessao = await sessaoAtual();
  const temPasskey = sessao?.temPasskey ?? false;
  const desenvolvimento = emDesenvolvimento();

  const estado: EstadoAuth = {
    autenticado: sessao !== null,
    temPasskey,
    senhaAtiva: desenvolvimento || !temPasskey,
    bloqueadoAte: null,
    modoDesenvolvimento: desenvolvimento,
  };

  return json(estado);
}

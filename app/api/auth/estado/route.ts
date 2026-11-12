import type { EstadoAuth } from "@/contracts";
import { json } from "@/servidor/http";
import { sessaoAtual } from "@/servidor/sessao";

/**
 * GET /api/auth/estado
 *
 * Única rota de leitura que **não** devolve fixture: é ela que diz à tela de
 * login o que mostrar, então responder um valor fixo deixaria o fluxo de
 * primeiro acesso → biometria → dashboard impossível de percorrer na etapa 2.
 *
 * Sem sessão, `temPasskey` é `false` e `senhaAtiva` é `true` — o stub não tem
 * como saber se existe passkey cadastrada sem consultar `credencial_passkey`, e
 * cair no caminho do primeiro acesso é o palpite útil. A etapa 3.1 lê as duas
 * colunas do banco e `bloqueadoAte` sai de `tentativa_login`.
 */
export async function GET() {
  const sessao = await sessaoAtual();
  const temPasskey = sessao?.temPasskey ?? false;

  const estado: EstadoAuth = {
    autenticado: sessao !== null,
    temPasskey,
    senhaAtiva: !temPasskey,
    bloqueadoAte: null,
  };

  return json(estado);
}

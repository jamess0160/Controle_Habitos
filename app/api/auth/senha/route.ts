import { loginComSenha, type LoginConcluido } from "@/contracts";
import { estadoDaSenha, hashDaSenhaAtiva } from "@/servidor/credencial";
import { corpo, falha, json } from "@/servidor/http";
import { emDesenvolvimento } from "@/servidor/modo";
import { ipDoPedido } from "@/servidor/pedido";
import { conferirSenha } from "@/servidor/senha";
import { abrirSessao } from "@/servidor/sessao";
import { esperar, estadoDeBloqueio, registrarTentativa } from "@/servidor/tentativas";
import { db } from "@/db/knex";

/**
 * POST /api/auth/senha — entrada por senha.
 *
 * A ordem dos passos aqui é a própria regra de segurança:
 *
 * 1. **bloqueio primeiro.** Enquanto o IP está bloqueado nem se olha a senha —
 *    conferir e então recusar gastaria um Argon2id por tentativa, que é
 *    exatamente o trabalho que o atacante quer impor ao servidor.
 * 2. **senha desativada é recusada como senha errada.** Mesma resposta, mesmo
 *    custo, mesma contagem. Responder "a senha está desativada" contaria que
 *    existe passkey cadastrada e que a senha certa não serve mais, o que orienta
 *    quem está tentando.
 * 3. **atraso progressivo depois de falhar**, nunca antes: atrasar o acerto
 *    puniria o dono do app.
 *
 * `APP_MODO=desenvolvimento` afrouxa só o passo 2 e o destino — a senha continua
 * valendo depois da passkey e a sessão já nasce completa, porque é o único
 * acesso possível num desktop sem autenticador.
 */
export async function POST(req: Request) {
  const r = await corpo(req, loginComSenha);
  if (!r.ok) return json(r.resposta, r.status);

  const ip = ipDoPedido(req);
  const bloqueio = await estadoDeBloqueio(ip);

  if (bloqueio.bloqueadoAte !== null) {
    return falha(
      "bloqueado",
      "Muitas tentativas. Tente de novo mais tarde.",
    );
  }

  const desenvolvimento = emDesenvolvimento();

  /*
   * Em desenvolvimento aceita a senha mesmo desativada; em produção só a ativa.
   * Nos dois casos o que se compara é um hash do banco — não há atalho que entre
   * sem senha.
   */
  const hash = desenvolvimento
    ? ((await db("credencial_senha").first("hash"))?.hash ?? null)
    : await hashDaSenhaAtiva();

  const confere = hash !== null && (await conferirSenha(hash, r.dados.senha));

  if (!confere) {
    await registrarTentativa(ip, false);
    await esperar(bloqueio.atrasoEmMs);

    const { existe } = await estadoDaSenha();

    return falha(
      "nao_autenticado",
      existe
        ? "Senha incorreta."
        : "Nenhuma senha cadastrada no servidor. Rode o seed do banco ou a CLI de reset.",
    );
  }

  await registrarTentativa(ip, true);

  const sessao = await abrirSessao(req);

  /*
   * O pedágio só existe quando falta passkey **e** o modo é produção — a mesma
   * condição que `exigirAcesso()` aplica. Em desenvolvimento, ou com a passkey já
   * cadastrada, a sessão nasce utilizável e mandar para `/biometria` seria um
   * desvio sem função.
   */
  const concluido: LoginConcluido = {
    proximoPasso:
      sessao.temPasskey || desenvolvimento ? "dashboard" : "cadastrar_biometria",
  };

  return json(concluido);
}

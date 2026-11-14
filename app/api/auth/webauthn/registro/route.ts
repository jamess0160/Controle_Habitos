import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { credencialWebauthn, type PasskeyCadastrada } from "@/contracts";
import { desativarSenha, estadoDaSenha } from "@/servidor/credencial";
import { corpo, exigirSessao, falha, json } from "@/servidor/http";
import { emDesenvolvimento } from "@/servidor/modo";
import { origemDoPedido } from "@/servidor/pedido";
import { atualizarDica } from "@/servidor/sessao";
import {
  ambienteDeWebauthn,
  codigoDaFalha,
  gravarPasskey,
  mensagemDeFalha,
  temPasskeyCadastrada,
  verificarRegistro,
} from "@/servidor/webauthn";
import { db } from "@/db/knex";

/**
 * POST /api/auth/webauthn/registro — o momento em que a porta única fecha.
 *
 * Três mudanças de estado acontecem juntas, numa transação: a credencial é
 * gravada, a senha é desativada e as **outras** sessões são revogadas. Gravar a
 * passkey sem desativar a senha deixaria o app com duas portas; desativar a
 * senha sem gravar a passkey deixaria o app sem nenhuma — e essa segunda só se
 * conserta com acesso ao Postgres.
 *
 * A sessão atual sobrevive de propósito: ela acabou de provar a posse do
 * autenticador, e derrubá-la mandaria o usuário ao login no instante seguinte a
 * ter cadastrado a biometria.
 *
 * Em `APP_MODO=desenvolvimento` a senha **não** é desativada — continuar podendo
 * entrar por senha num desktop sem autenticador é o que a chave garante.
 */
export async function POST(req: Request) {
  const acesso = await exigirSessao();
  if (!acesso.liberado) return acesso.resposta;

  const r = await corpo(req, credencialWebauthn);
  if (!r.ok) return json(r.resposta, r.status);

  if (await temPasskeyCadastrada()) {
    return falha(
      "conflito",
      "Já existe uma passkey cadastrada. Use o reset antes de cadastrar outra.",
    );
  }

  const ambiente = await ambienteDeWebauthn(origemDoPedido(req));
  if (!ambiente.ok) {
    return falha(codigoDaFalha(ambiente.falha), mensagemDeFalha(ambiente.falha));
  }

  const verificacao = await verificarRegistro(
    ambiente.ambiente,
    r.dados.credencial as unknown as RegistrationResponseJSON,
  );

  if (!verificacao.ok) {
    return falha(codigoDaFalha(verificacao.falha), mensagemDeFalha(verificacao.falha));
  }

  const manterSenha = emDesenvolvimento();

  const passkey = await db.transaction(async (trx) => {
    const gravada = await gravarPasskey(trx, verificacao.credencial, r.dados.apelido ?? null);

    if (!manterSenha) {
      await desativarSenha(trx);
    }

    /*
     * Revoga tudo e reabre esta. Mais simples e mais seguro que uma revogação
     * com exceção: um `whereNot` com o id errado erraria calado, deixando de pé
     * justamente a sessão que deveria cair.
     */
    await trx("sessao").whereNull("revogada_em").update({ revogada_em: new Date() });
    await trx("sessao").where({ id: acesso.sessao.id }).update({ revogada_em: null });

    return gravada;
  });

  await atualizarDica(true);

  const senha = await estadoDaSenha();

  const cadastrada: PasskeyCadastrada = {
    apelido: passkey.apelido,
    criadaEm: passkey.criadaEm.toISOString(),
    ultimoUsoEm: null,
    senhaAtiva: senha.ativa,
  };

  return json(cadastrada, 201);
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { enviar, useRecurso, type Falha } from "@/cliente/api";
import { useSuportaWebauthn } from "@/cliente/ambiente";
import { restanteAte } from "@/cliente/formato";
import { useAgora } from "@/cliente/relogio";
import { mensagemDeErroWebauthn, usarPasskey } from "@/cliente/webauthn";
import type { EstadoAuth, LoginConcluido, OpcoesWebauthn } from "@/contracts";
import { Carregando, Erro } from "./estado-da-tela";
import { Botao, Campo, CLASSE_ENTRADA, Nota } from "./ui";

/**
 * Login — a única tela pública.
 *
 * Não há campo de usuário: existe um único usuário, e o nome dele serve só para
 * a saudação do dashboard. O que a tela mostra sai de `GET /api/auth/estado`,
 * nos quatro estados do [Mapa de telas](../Docs/mapas/Mapa%20de%20telas.md):
 *
 * | Estado | O que aparece |
 * |---|---|
 * | sem passkey | campo de senha |
 * | com passkey | só "Entrar com biometria" |
 * | com passkey, sem WebAuthn | aviso e instrução de rodar a CLI |
 * | bloqueado | tempo restante, **sem dizer se a senha estava certa** |
 *
 * O bloqueio vem antes de tudo na ordem de render: revelar o formulário durante
 * um bloqueio por tentativas diria ao atacante que ele ainda tem o que tentar.
 *
 * Desde a etapa 3.1 os quatro estados vêm do banco, e os atalhos `?simular=…` da
 * etapa 2 foram removidos: `temPasskey` sai de `credencial_passkey`, `senhaAtiva`
 * de `credencial_senha` e `bloqueadoAte` de `tentativa_login`. Percorrer um
 * estado agora é colocá-lo no banco, não simulá-lo na tela.
 *
 * **Existem dois estados a mais que a tabela não prevê.** O primeiro só acontece
 * em desenvolvimento: passkey cadastrada *e* senha ativa, os dois caminhos
 * disponíveis — em produção eles são mutuamente exclusivos, porque o cadastro da
 * passkey desativa a senha e o reset apaga a passkey ao reativá-la. Quem decide é
 * `APP_MODO` no servidor (ver [servidor/modo.ts](../servidor/modo.ts)), e a tela
 * avisa em letras visíveis quando está nesse modo: um deploy esquecido em
 * `desenvolvimento` significa senha ativa para sempre, e esse erro não pode ser
 * silencioso.
 *
 * O segundo é o banco sem credencial nenhuma — sem seed, ou recém-criado. Não é
 * estado de produção, mas é o que aparece na primeira subida do app, e sem uma
 * mensagem a tela ficaria simplesmente vazia.
 */

const PROXIMA_TELA: Record<LoginConcluido["proximoPasso"], string> = {
  cadastrar_biometria: "/biometria",
  dashboard: "/",
};

export function TelaLogin() {
  const router = useRouter();
  const { recurso, recarregar } = useRecurso<EstadoAuth>("/api/auth/estado");

  const suporta = useSuportaWebauthn();
  const agora = useAgora();
  const [falha, setFalha] = useState<Falha | null>(null);
  const [senha, setSenha] = useState("");
  const [ocupado, setOcupado] = useState(false);

  if (recurso.estado === "carregando") {
    return <Carregando linhas={1} />;
  }

  if (recurso.estado === "erro") {
    return <Erro falha={recurso.falha} aoTentarDeNovo={() => void recarregar()} />;
  }

  const estado = recurso.dados;
  const restante = estado.bloqueadoAte === null ? "" : restanteAte(estado.bloqueadoAte, agora);
  const bloqueado = restante !== "";
  const semCredencial = !estado.temPasskey && !estado.senhaAtiva;

  async function entrarComSenha(evento: React.FormEvent) {
    evento.preventDefault();
    setFalha(null);
    setOcupado(true);

    const r = await enviar<LoginConcluido>("/api/auth/senha", "POST", { senha });

    setOcupado(false);

    if (!r.ok) {
      setFalha(r.falha);
      setSenha("");
      /*
       * Recarrega o estado: a tentativa pode ter sido a quinta, e aí o que a tela
       * tem de mostrar é a contagem do bloqueio, não o formulário de novo.
       */
      void recarregar();
      return;
    }

    router.replace(PROXIMA_TELA[r.dados.proximoPasso]);
  }

  async function entrarComBiometria() {
    setFalha(null);
    setOcupado(true);

    const opcoes = await enviar<OpcoesWebauthn>("/api/auth/webauthn/login/opcoes", "POST");

    if (!opcoes.ok) {
      setOcupado(false);
      setFalha(opcoes.falha);
      return;
    }

    let credencial: unknown;
    try {
      credencial = await usarPasskey(opcoes.dados);
    } catch (erro) {
      setOcupado(false);
      setFalha({ codigo: "nao_autenticado", mensagem: mensagemDeErroWebauthn(erro) });
      return;
    }

    const r = await enviar<LoginConcluido>("/api/auth/webauthn/login", "POST", { credencial });

    setOcupado(false);

    if (!r.ok) {
      setFalha(r.falha);
      return;
    }

    router.replace(PROXIMA_TELA[r.dados.proximoPasso]);
  }

  return (
    <div className="flex flex-col gap-6">
      {falha !== null && (
        <p role="alert" className="text-sm text-habito-vermelho">
          {falha.mensagem}
        </p>
      )}

      {bloqueado ? (
        /*
         * Nada de campo de senha aqui, e nada sobre a última tentativa ter sido
         * certa ou errada — o bloqueio é por tentativas, e dizer qual delas
         * acertou entregaria a senha.
         */
        <div className="flex flex-col gap-2" role="status">
          <h2 className="text-base font-semibold">Entrada bloqueada</h2>
          <p className="text-sm text-texto-fraco">
            Muitas tentativas. Tente de novo em{" "}
            <strong className="font-medium tabular-nums text-texto">{restante}</strong>.
          </p>
        </div>
      ) : semCredencial ? (
        <Nota tom="forte">
          <strong className="font-medium text-texto">
            O servidor não tem credencial cadastrada.
          </strong>{" "}
          Rode <code className="font-mono text-texto">npm run db:seed</code> para semear a senha do
          primeiro acesso, ou{" "}
          <code className="font-mono text-texto">npm run cli:reset-senha</code> para gerar uma
          provisória.
        </Nota>
      ) : (
        <>
          {estado.temPasskey &&
            (suporta ? (
              <div className="flex flex-col gap-3">
                <Botao
                  variante="primario"
                  largo
                  disabled={ocupado}
                  onClick={() => void entrarComBiometria()}
                >
                  {ocupado ? "Aguardando o aparelho…" : "Entrar com biometria"}
                </Botao>
                {!estado.senhaAtiva && (
                  <p className="text-center text-xs text-texto-fraco">
                    A senha foi desativada no cadastro da biometria.
                  </p>
                )}
              </div>
            ) : (
              /*
               * Com a senha ativa ainda há como entrar, então a CLI não é a
               * única saída e o aviso seria alarme falso — o formulário abaixo
               * resolve.
               */
              !estado.senhaAtiva && (
                <Nota tom="forte">
                  <strong className="font-medium text-texto">
                    Este navegador não tem suporte a biometria.
                  </strong>{" "}
                  A passkey é o único acesso do app, e ela não pode ser usada aqui. Para voltar a
                  entrar por senha, rode{" "}
                  <code className="font-mono text-texto">npm run cli:reset-biometria</code> no
                  servidor — ele apaga a passkey, reativa a senha e imprime uma provisória.
                </Nota>
              )
            ))}

          {estado.senhaAtiva && (
            <form onSubmit={entrarComSenha} className="flex flex-col gap-4">
              {estado.temPasskey && (
                <p className="text-center text-xs uppercase tracking-widest text-texto-fraco">
                  ou entre com a senha
                </p>
              )}

              <Campo rotulo="Senha" dica="Primeiro acesso: a senha definida no .env do servidor.">
                <input
                  type="password"
                  name="senha"
                  autoComplete="current-password"
                  autoFocus={!estado.temPasskey}
                  required
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  className={CLASSE_ENTRADA}
                />
              </Campo>

              <Botao
                type="submit"
                variante={estado.temPasskey ? "secundario" : "primario"}
                largo
                disabled={ocupado || senha === ""}
              >
                {ocupado ? "Entrando…" : "Entrar"}
              </Botao>
            </form>
          )}
        </>
      )}

      {estado.modoDesenvolvimento && (
        <Nota tom="forte">
          <strong className="font-medium text-texto">APP_MODO=desenvolvimento.</strong> A senha
          continua ativa mesmo com a biometria cadastrada, e a sessão dela já abre o app. Em
          produção esta chave tem de ser{" "}
          <code className="font-mono text-texto">producao</code> — ou ficar ausente, que dá no
          mesmo.
        </Nota>
      )}
    </div>
  );
}

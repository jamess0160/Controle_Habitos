"use client";

import { useRouter, useSearchParams } from "next/navigation";
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
 * **Existe um quinto estado, e ele só acontece em desenvolvimento**: passkey
 * cadastrada *e* senha ativa, os dois caminhos de entrada disponíveis. Em
 * produção os dois são mutuamente exclusivos — o cadastro da passkey desativa a
 * senha, e o reset apaga a passkey ao reativá-la. Quem decide é `APP_MODO` no
 * servidor (ver [servidor/modo.ts](../servidor/modo.ts)), e a tela avisa em
 * letras visíveis quando está nesse modo: um deploy de produção esquecido em
 * `desenvolvimento` significa senha ativa para sempre, e esse erro não pode ser
 * silencioso.
 */

const PROXIMA_TELA: Record<LoginConcluido["proximoPasso"], string> = {
  cadastrar_biometria: "/biometria",
  dashboard: "/",
};

/**
 * Simulação de estado — **só com `APP_MODO=desenvolvimento`**.
 *
 * O stub de `GET /api/auth/estado` não tem como saber se existe passkey
 * cadastrada sem consultar o banco, então ele responde sempre o caminho do
 * primeiro acesso. Sem isto, três dos quatro estados da tabela acima seriam
 * impossíveis de ver na etapa 2 — cujo propósito é exatamente percorrer as telas
 * com dados falsos.
 *
 * Simular desliga o modo frouxo **na tela**: `com-passkey` e `sem-webauthn`
 * forçam `senhaAtiva: false`, porque é justamente o estado de produção que se
 * quer olhar. Morre na etapa 3.1, quando `temPasskey`, `senhaAtiva` e
 * `bloqueadoAte` passam a sair de `credencial_passkey` e `tentativa_login`.
 */
const SIMULAVEIS = ["com-passkey", "sem-webauthn", "bloqueado"] as const;
type Simulacao = (typeof SIMULAVEIS)[number];

function simulacaoDe(valor: string | null, desenvolvimento: boolean): Simulacao | null {
  if (!desenvolvimento) return null;
  return SIMULAVEIS.find((s) => s === valor) ?? null;
}

export function TelaLogin() {
  const router = useRouter();
  const parametros = useSearchParams();
  const { recurso, recarregar } = useRecurso<EstadoAuth>("/api/auth/estado");

  const suportaDeVerdade = useSuportaWebauthn();
  const agora = useAgora();
  const [falha, setFalha] = useState<Falha | null>(null);
  const [senha, setSenha] = useState("");
  const [ocupado, setOcupado] = useState(false);

  /* Fixo em 9 minutos para a contagem ter o que contar sem depender do banco. */
  const [bloqueioSimulado] = useState(() => new Date(Date.now() + 9 * 60_000).toISOString());

  if (recurso.estado === "carregando") {
    return <Carregando linhas={1} />;
  }

  if (recurso.estado === "erro") {
    return <Erro falha={recurso.falha} aoTentarDeNovo={() => void recarregar()} />;
  }

  const desenvolvimento = recurso.dados.modoDesenvolvimento;
  const simulacao = simulacaoDe(parametros.get("simular"), desenvolvimento);
  const suporta = suportaDeVerdade && simulacao !== "sem-webauthn";

  const estado: EstadoAuth =
    simulacao === null
      ? recurso.dados
      : {
          ...recurso.dados,
          temPasskey: simulacao !== "bloqueado",
          senhaAtiva: false,
          bloqueadoAte: simulacao === "bloqueado" ? bloqueioSimulado : recurso.dados.bloqueadoAte,
        };

  const restante = estado.bloqueadoAte === null ? "" : restanteAte(estado.bloqueadoAte, agora);
  const bloqueado = restante !== "";

  async function entrarComSenha(evento: React.FormEvent) {
    evento.preventDefault();
    setFalha(null);
    setOcupado(true);

    const r = await enviar<LoginConcluido>("/api/auth/senha", "POST", { senha });

    setOcupado(false);

    if (!r.ok) {
      setFalha(r.falha);
      setSenha("");
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

      {desenvolvimento && <BlocoDeDesenvolvimento atual={simulacao} />}
    </div>
  );
}

/**
 * O aviso e os atalhos de desenvolvimento.
 *
 * O aviso não é decoração: `APP_MODO=desenvolvimento` mantém a senha ativa ao
 * lado da passkey, e se essa chave vazar para o deploy de produção o app fica
 * com uma porta a mais para sempre. A tela de login é o lugar certo para dizer
 * isso, porque é exatamente onde a porta aparece.
 */
function BlocoDeDesenvolvimento({ atual }: { readonly atual: Simulacao | null }) {
  const rotulos: Record<Simulacao, string> = {
    "com-passkey": "Com passkey",
    "sem-webauthn": "Sem WebAuthn",
    bloqueado: "Bloqueado",
  };

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-linha pt-4">
      <Nota tom="forte">
        <strong className="font-medium text-texto">
          APP_MODO=desenvolvimento.
        </strong>{" "}
        A senha continua ativa mesmo com a biometria cadastrada. Em produção esta chave tem de ser{" "}
        <code className="font-mono text-texto">producao</code> — ou ficar ausente, que dá no mesmo.
      </Nota>

      <div className="flex flex-col gap-2">
        <p className="text-[0.68rem] uppercase tracking-widest text-texto-fraco">Simular estado</p>
        <div className="flex flex-wrap gap-2">
          <a
            href="/login"
            className={`rounded-full border px-3 py-1.5 text-xs ${atual === null ? "border-texto font-semibold" : "border-linha text-texto-fraco"}`}
          >
            Primeiro acesso
          </a>
          {SIMULAVEIS.map((chave) => (
            <a
              key={chave}
              href={`/login?simular=${chave}`}
              className={`rounded-full border px-3 py-1.5 text-xs ${atual === chave ? "border-texto font-semibold" : "border-linha text-texto-fraco"}`}
            >
              {rotulos[chave]}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

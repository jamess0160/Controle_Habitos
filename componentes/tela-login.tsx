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
 */

const PROXIMA_TELA: Record<LoginConcluido["proximoPasso"], string> = {
  cadastrar_biometria: "/biometria",
  dashboard: "/",
};

/**
 * Simulação de estado — **só em desenvolvimento**.
 *
 * O stub de `GET /api/auth/estado` não tem como saber se existe passkey
 * cadastrada sem consultar o banco, então ele responde sempre o caminho do
 * primeiro acesso. Sem isto, três dos quatro estados da tabela acima seriam
 * impossíveis de ver na etapa 2 — cujo propósito é exatamente percorrer as telas
 * com dados falsos.
 *
 * Morre na etapa 3.1, junto com o cookie de stub: a partir de lá `temPasskey`,
 * `senhaAtiva` e `bloqueadoAte` saem de `credencial_passkey` e `tentativa_login`.
 */
const SIMULAVEIS = ["com-passkey", "sem-webauthn", "bloqueado"] as const;
type Simulacao = (typeof SIMULAVEIS)[number];

const EM_DESENVOLVIMENTO = process.env.NODE_ENV !== "production";

function simulacaoDe(valor: string | null): Simulacao | null {
  if (!EM_DESENVOLVIMENTO) return null;
  return SIMULAVEIS.find((s) => s === valor) ?? null;
}

export function TelaLogin() {
  const router = useRouter();
  const parametros = useSearchParams();
  const { recurso, recarregar } = useRecurso<EstadoAuth>("/api/auth/estado");

  const simulacao = simulacaoDe(parametros.get("simular"));
  const suportaDeVerdade = useSuportaWebauthn();
  const suporta = suportaDeVerdade && simulacao !== "sem-webauthn";

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

  const estado: EstadoAuth = {
    ...recurso.dados,
    temPasskey: simulacao === null ? recurso.dados.temPasskey : simulacao !== "bloqueado",
    bloqueadoAte: simulacao === "bloqueado" ? bloqueioSimulado : recurso.dados.bloqueadoAte,
  };

  const restante = estado.bloqueadoAte === null ? "" : restanteAte(estado.bloqueadoAte, agora);

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

      {restante !== "" ? (
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
      ) : estado.temPasskey ? (
        suporta ? (
          <div className="flex flex-col gap-3">
            <Botao
              variante="primario"
              largo
              disabled={ocupado}
              onClick={() => void entrarComBiometria()}
            >
              {ocupado ? "Aguardando o aparelho…" : "Entrar com biometria"}
            </Botao>
            <p className="text-center text-xs text-texto-fraco">
              A senha foi desativada no cadastro da biometria.
            </p>
          </div>
        ) : (
          <Nota tom="forte">
            <strong className="font-medium text-texto">
              Este navegador não tem suporte a biometria.
            </strong>{" "}
            A passkey é o único acesso do app, e ela não pode ser usada aqui. Para voltar a entrar
            por senha, rode <code className="font-mono text-texto">npm run cli:reset-biometria</code>{" "}
            no servidor — ele apaga a passkey, reativa a senha e imprime uma provisória.
          </Nota>
        )
      ) : (
        <form onSubmit={entrarComSenha} className="flex flex-col gap-4">
          <Campo rotulo="Senha" dica="Primeiro acesso: a senha definida no .env do servidor.">
            <input
              type="password"
              name="senha"
              autoComplete="current-password"
              autoFocus
              required
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className={CLASSE_ENTRADA}
            />
          </Campo>

          <Botao type="submit" variante="primario" largo disabled={ocupado || senha === ""}>
            {ocupado ? "Entrando…" : "Entrar"}
          </Botao>
        </form>
      )}

      {EM_DESENVOLVIMENTO && <AtalhosDeSimulacao atual={simulacao} />}
    </div>
  );
}

/** Ver a nota de `SIMULAVEIS`: andaime da etapa 2, removido na 3.1. */
function AtalhosDeSimulacao({ atual }: { readonly atual: Simulacao | null }) {
  const rotulos: Record<Simulacao, string> = {
    "com-passkey": "Com passkey",
    "sem-webauthn": "Sem WebAuthn",
    bloqueado: "Bloqueado",
  };

  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-linha pt-4">
      <p className="text-[0.68rem] uppercase tracking-widest text-texto-fraco">
        Simular estado (dev)
      </p>
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
  );
}

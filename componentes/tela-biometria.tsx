"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { instalar, pedirPermissaoDeNotificacao, useConviteDeInstalacao, useSuportaWebauthn } from "@/cliente/ambiente";
import { enviar, useRecurso, type Falha } from "@/cliente/api";
import { criarPasskey, mensagemDeErroWebauthn } from "@/cliente/webauthn";
import type { EstadoAuth, Ok, OpcoesWebauthn, PasskeyCadastrada } from "@/contracts";
import { Botao, Nota } from "./ui";

/**
 * Cadastro de biometria — o pedágio do primeiro acesso.
 *
 * A sessão aberta pela senha **não dá acesso a mais nada**: a guarda do
 * [proxy](../proxy.ts) prende aqui, e `exigirAcesso()` responde 409 a qualquer
 * rota de domínio. Não existe caminho que deixe o app em uso com a senha ativa.
 *
 * Isso vale em produção. Com `APP_MODO=desenvolvimento` a senha abre uma sessão
 * completa e esta tela deixa de ser pedágio — passa a ser uma tela que se visita
 * por escolha, para exercitar o fluxo. É o único jeito de entrar num desktop sem
 * autenticador, e está documentado em [servidor/modo.ts](../servidor/modo.ts).
 *
 * Três coisas acontecem ao concluir, e as três estão aqui de propósito: a senha
 * é desativada, a instalação da PWA é oferecida e a permissão de notificação é
 * pedida. Os dois pedidos ficam neste momento porque é o único em que o usuário
 * está atento ao setup — pedidos soltos no meio do uso são os que se nega por
 * reflexo. E no iOS a notificação **só funciona com a PWA instalada**, então a
 * ordem importa: instalar antes de pedir permissão.
 */

type Passo = "explicando" | "pronto";

export function TelaBiometria() {
  const router = useRouter();
  const suporta = useSuportaWebauthn();
  const temConvite = useConviteDeInstalacao();

  /*
   * O modo do app vem do servidor, não de uma variável pública: a chave é
   * `APP_MODO` e quem a lê é `GET /api/auth/estado` (ver
   * [servidor/modo.ts](../servidor/modo.ts)). A tela **não** espera por essa
   * resposta — o bloco de desenvolvimento aparece um instante depois, e segurar
   * o cadastro de biometria atrás de uma segunda requisição seria pagar um
   * carregamento por uma informação que só interessa a um botão de andaime.
   */
  const { recurso: auth } = useRecurso<EstadoAuth>("/api/auth/estado");
  const desenvolvimento = auth.estado === "pronto" && auth.dados.modoDesenvolvimento;

  const [passo, setPasso] = useState<Passo>("explicando");
  const [passkey, setPasskey] = useState<PasskeyCadastrada | null>(null);
  const [falha, setFalha] = useState<Falha | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [notificacao, setNotificacao] = useState<string | null>(null);

  async function concluir(credencial: unknown) {
    const r = await enviar<PasskeyCadastrada>("/api/auth/webauthn/registro", "POST", {
      credencial,
      apelido: "Este aparelho",
    });

    setOcupado(false);

    if (!r.ok) {
      setFalha(r.falha);
      return;
    }

    setPasskey(r.dados);
    setPasso("pronto");
  }

  async function cadastrar() {
    setFalha(null);
    setOcupado(true);

    const opcoes = await enviar<OpcoesWebauthn>("/api/auth/webauthn/registro/opcoes", "POST");

    if (!opcoes.ok) {
      setOcupado(false);
      setFalha(opcoes.falha);
      return;
    }

    let credencial: unknown;
    try {
      credencial = await criarPasskey(opcoes.dados);
    } catch (erro) {
      setOcupado(false);
      setFalha({ codigo: "conflito", mensagem: mensagemDeErroWebauthn(erro) });
      return;
    }

    await concluir(credencial);
  }

  /**
   * Caminho de desenvolvimento: promove a sessão sem passar pelo aparelho.
   *
   * O `challenge` das fixtures é inventado, então o `credentials.create()` acima
   * **falha de verdade** na etapa 2 — e sem esta saída o fluxo primeiro acesso →
   * biometria → dashboard seria impossível de percorrer, que é justamente o que
   * a etapa 2 existe para validar. O stub de `POST .../registro` só confere o
   * shape do payload, então um objeto sintético basta para ele promover o cookie.
   *
   * É um botão separado e visível, não um `catch` que finge sucesso: a diferença
   * entre "a biometria funcionou" e "pulamos a biometria" não pode ficar
   * escondida. Removido na etapa 3.1.
   */
  async function simularCadastro() {
    setFalha(null);
    setOcupado(true);
    await concluir({ id: "credencial-simulada", type: "public-key" });
  }

  async function pedirNotificacao() {
    const resultado = await pedirPermissaoDeNotificacao();

    setNotificacao(
      resultado === "granted"
        ? "Notificações permitidas."
        : resultado === "denied"
          ? "Notificações negadas — dá para liberar depois nos ajustes do navegador."
          : "Este navegador não oferece notificação.",
    );
  }

  async function sair() {
    await enviar<Ok>("/api/auth/logout", "POST");
    router.replace("/login");
  }

  if (passo === "pronto") {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="text-base font-semibold">Biometria cadastrada</h2>
          <p className="mt-1 text-sm text-texto-fraco">
            {passkey?.senhaAtiva === false
              ? "A senha foi desativada. Este aparelho é o único acesso ao app."
              : "A senha continua ativa."}
          </p>
        </div>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Instalar o app</h3>
          <p className="text-sm text-texto-fraco">
            No iPhone a notificação só chega com o app instalado — é uma exigência do iOS, não uma
            escolha nossa.
          </p>
          {temConvite ? (
            <Botao onClick={() => void instalar()}>Instalar</Botao>
          ) : (
            <Nota>
              Este navegador não oferece o convite automático. No iPhone: Compartilhar → Adicionar à
              Tela de Início.
            </Nota>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Permitir notificações</h3>
          <p className="text-sm text-texto-fraco">
            É assim que chegam os lembretes e o aviso de congelamento usado.
          </p>
          <Botao onClick={() => void pedirNotificacao()}>Permitir</Botao>
          {notificacao !== null && <p className="text-xs text-texto-fraco">{notificacao}</p>}
        </section>

        <Botao variante="primario" largo onClick={() => router.replace("/")}>
          Ir para o app
        </Botao>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed">
          Cadastrar a biometria <strong className="font-semibold">desativa a senha</strong> e torna{" "}
          <strong className="font-semibold">este aparelho o único</strong> com acesso ao app.
        </p>
        <Nota tom="forte">
          Perder o aparelho significa rodar{" "}
          <code className="font-mono text-texto">npm run cli:reset-biometria</code> no servidor para
          reativar a senha. Não há recuperação por e-mail — o app não tem e-mail.
        </Nota>
      </div>

      {falha !== null && (
        <p role="alert" className="text-sm text-habito-vermelho">
          {falha.mensagem}
        </p>
      )}

      {suporta ? (
        <Botao variante="primario" largo disabled={ocupado} onClick={() => void cadastrar()}>
          {ocupado ? "Aguardando o aparelho…" : "Entendi, cadastrar biometria"}
        </Botao>
      ) : (
        <Nota tom="forte">
          Este navegador não tem suporte a WebAuthn, então não há como cadastrar a passkey aqui.
          Abra o app no aparelho que vai usar.
        </Nota>
      )}

      {desenvolvimento && (
        <div className="flex flex-col gap-2 border-t border-linha pt-4">
          <p className="text-[0.68rem] uppercase tracking-widest text-texto-fraco">
            Desenvolvimento
          </p>
          <Botao disabled={ocupado} onClick={() => void simularCadastro()}>
            Pular a biometria (dev)
          </Botao>
          <p className="text-xs leading-snug text-texto-fraco">
            O desafio das fixtures é inventado, então o cadastro real falha até a etapa 3.1. Isto
            promove a sessão para o dashboard.
          </p>
        </div>
      )}

      <Botao variante="fantasma" largo onClick={() => void sair()}>
        Sair
      </Botao>
    </div>
  );
}

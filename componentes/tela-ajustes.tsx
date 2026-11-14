"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  pedirPermissaoDeNotificacao,
  ROTULO_PERMISSAO,
  usePermissaoDeNotificacao,
} from "@/cliente/ambiente";
import { enviar, useRecurso, type Falha } from "@/cliente/api";
import {
  assinarNoNavegador,
  desassinarNoNavegador,
  mensagemDeFalhaDeAssinatura,
} from "@/cliente/push";
import { horaCurta, instanteCurto } from "@/cliente/formato";
import {
  CONFIRMACAO_RESET,
  type BiometriaResetada,
  type ConfigApp,
  type Ok,
  type StatusPush,
} from "@/contracts";
import { Carregando, Erro } from "./estado-da-tela";
import { SeletorDeTema } from "./seletor-de-tema";
import { Botao, Campo, classeDeBotao, CLASSE_ENTRADA, Nota, TituloDeSecao } from "./ui";

/**
 * Ajustes.
 *
 * Quatro blocos do [Mapa de telas](../Docs/mapas/Mapa%20de%20telas.md) —
 * biometria, notificações, preferências e dados — mais o tema, que é a quarta
 * peça do shell da PWA e só faz sentido morar aqui.
 *
 * Dois campos são **somente leitura de propósito**: o nome da saudação vem do
 * `.env` via `config_app`, e o `rp_id` é o domínio das passkeys. Trocar o
 * `rp_id` invalida a biometria cadastrada, então não existe campo para isso —
 * ele é decidido no deploy e gravado.
 */
export function TelaAjustes() {
  const { recurso, recarregar, definir } = useRecurso<ConfigApp>("/api/config");

  if (recurso.estado === "carregando") {
    return <Carregando linhas={4} />;
  }

  if (recurso.estado === "erro") {
    return <Erro falha={recurso.falha} aoTentarDeNovo={() => void recarregar()} />;
  }

  const config = recurso.dados;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Ajustes</h1>
        <p className="mt-0.5 text-xs uppercase tracking-widest text-texto-fraco">
          {config.usuarioNome}
        </p>
      </header>

      <Secao titulo="Tema">
        <p className="text-xs leading-snug text-texto-fraco">
          Em <strong className="font-medium text-texto">Sistema</strong>, acompanha a virada
          automática do celular ao anoitecer.
        </p>
        <SeletorDeTema />
      </Secao>

      <Biometria config={config} />

      <Notificacoes
        push={config.push}
        aoMudar={(push) => definir({ ...config, push })}
      />

      <Preferencias config={config} aoMudar={definir} />

      <Secao titulo="Dados">
        <p className="text-xs leading-snug text-texto-fraco">
          Exporta hábitos e registros em JSON. Enquanto não houver backup automatizado verificado
          (etapa 5), este arquivo é a única cópia do histórico fora do Postgres do servidor.
        </p>
        {/*
          Link comum, e não `fetch`: a rota já responde com `Content-Disposition:
          attachment`, e deixar o navegador cuidar do download evita montar um
          blob na memória do celular com o histórico inteiro.
        */}
        <a href="/api/exportar" download className={`self-start ${classeDeBotao()}`}>
          Exportar histórico
        </a>
      </Secao>

      <Sair />
    </div>
  );
}

function Secao({ titulo, children }: { readonly titulo: string; readonly children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <TituloDeSecao>{titulo}</TituloDeSecao>
      {children}
    </section>
  );
}

/**
 * Biometria, com o reset.
 *
 * A confirmação digitada é exigida **pelo contrato**, não só pela interface:
 * `resetarBiometria` só aceita a frase exata. Assim um POST acidental — um retry
 * de rede, uma aba antiga — não derruba o único caminho de entrada do app.
 */
function Biometria({ config }: { readonly config: ConfigApp }) {
  const router = useRouter();
  const [confirmacao, setConfirmacao] = useState("");
  const [abrindo, setAbrindo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [falha, setFalha] = useState<Falha | null>(null);
  const [resultado, setResultado] = useState<BiometriaResetada | null>(null);

  async function resetar() {
    setFalha(null);
    setOcupado(true);

    const r = await enviar<BiometriaResetada>("/api/auth/biometria/reset", "POST", {
      confirmacao,
    });

    setOcupado(false);

    if (!r.ok) {
      setFalha(r.falha);
      return;
    }

    setResultado(r.dados);
  }

  if (resultado !== null) {
    return (
      <Secao titulo="Biometria">
        <Nota tom="forte">
          <strong className="text-texto">Senha provisória:</strong>{" "}
          <code className="font-mono text-base text-texto">{resultado.senhaProvisoria}</code>
          <br />
          Ela aparece <strong className="text-texto">uma única vez</strong>. Anote agora: as{" "}
          {resultado.sessoesRevogadas === 1
            ? "sessões foram revogadas"
            : `${resultado.sessoesRevogadas} sessões foram revogadas`}{" "}
          e a próxima entrada é por senha, seguida de um novo cadastro de biometria.
        </Nota>
        <Botao variante="primario" onClick={() => router.replace("/login")}>
          Anotei, sair
        </Botao>
      </Secao>
    );
  }

  return (
    <Secao titulo="Biometria">
      {config.passkey === null ? (
        <Nota>Nenhuma passkey cadastrada.</Nota>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-texto-fraco">Dispositivo</dt>
          <dd>{config.passkey.apelido ?? "sem apelido"}</dd>
          <dt className="text-texto-fraco">Cadastrada</dt>
          <dd className="tabular-nums">{instanteCurto(config.passkey.criadaEm)}</dd>
          <dt className="text-texto-fraco">Último uso</dt>
          <dd className="tabular-nums">
            {config.passkey.ultimoUsoEm === null
              ? "nunca"
              : instanteCurto(config.passkey.ultimoUsoEm)}
          </dd>
          <dt className="text-texto-fraco">Domínio (rp_id)</dt>
          <dd className="font-mono">{config.rpId}</dd>
        </dl>
      )}

      {falha !== null && (
        <p role="alert" className="text-sm text-habito-vermelho">
          {falha.mensagem}
        </p>
      )}

      {abrindo ? (
        <div className="flex flex-col gap-3 rounded-xl border border-habito-vermelho p-3">
          <p className="text-xs leading-relaxed text-texto-fraco">
            O reset apaga a passkey, reativa a senha e revoga as sessões. É o caminho quando o
            aparelho muda — e é destrutivo: a biometria atual deixa de funcionar na hora.
          </p>
          <Campo rotulo={`Digite ${CONFIRMACAO_RESET}`}>
            <input
              type="text"
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              autoCapitalize="characters"
              autoComplete="off"
              className={CLASSE_ENTRADA}
            />
          </Campo>
          <div className="flex gap-2">
            <Botao
              variante="destrutivo"
              disabled={ocupado || confirmacao !== CONFIRMACAO_RESET}
              onClick={() => void resetar()}
            >
              Resetar biometria
            </Botao>
            <Botao variante="fantasma" onClick={() => setAbrindo(false)}>
              Cancelar
            </Botao>
          </div>
        </div>
      ) : (
        <Botao variante="destrutivo" className="self-start" onClick={() => setAbrindo(true)}>
          Resetar biometria
        </Botao>
      )}
    </Secao>
  );
}

function Notificacoes({
  push,
  aoMudar,
}: {
  readonly push: StatusPush;
  readonly aoMudar: (push: StatusPush) => void;
}) {
  const permissao = usePermissaoDeNotificacao();
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);

  /**
   * Assinar é um aperto de mão de três partes, e a ordem importa.
   *
   * O navegador cria a assinatura **com** a chave pública do servidor; só então
   * o servidor pode guardá-la. Gravar primeiro e assinar depois deixaria uma
   * linha apontando para um endpoint que talvez nunca tenha existido.
   */
  async function assinar() {
    setMensagem(null);
    setOcupado(true);

    const local = await assinarNoNavegador(push.chavePublica);

    if (!local.ok) {
      setOcupado(false);
      setMensagem(mensagemDeFalhaDeAssinatura(local));
      return;
    }

    const r = await enviar<StatusPush>("/api/push/assinatura", "POST", local.assinatura);
    setOcupado(false);

    if (!r.ok) {
      setMensagem(r.falha.mensagem);
      return;
    }

    aoMudar(r.dados);
    setMensagem("Assinatura criada. Use o teste para confirmar a entrega.");
  }

  async function enviarTeste() {
    setOcupado(true);
    const r = await enviar<Ok>("/api/push/teste", "POST");
    setOcupado(false);
    setMensagem(r.ok ? "Teste enviado." : r.falha.mensagem);
  }

  async function desassinar() {
    setOcupado(true);
    /* Primeiro o navegador: cancelada lá, ela para de receber mesmo se o
       servidor falhar na linha seguinte. */
    await desassinarNoNavegador();
    const r = await enviar<StatusPush>("/api/push/assinatura", "DELETE");
    setOcupado(false);

    if (r.ok) {
      aoMudar(r.dados);
      setMensagem("Assinatura removida.");
      return;
    }

    setMensagem(r.falha.mensagem);
  }

  return (
    <Secao titulo="Notificações">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-texto-fraco">Permissão</dt>
        <dd>{ROTULO_PERMISSAO[permissao]}</dd>
        <dt className="text-texto-fraco">Assinatura</dt>
        <dd>{push.assinado ? "ativa" : "nenhuma"}</dd>
        <dt className="text-texto-fraco">Último envio</dt>
        <dd className="tabular-nums">
          {push.ultimoEnvioEm === null ? "nunca" : instanteCurto(push.ultimoEnvioEm)}
        </dd>
        {push.invalidaEm !== null && (
          <>
            <dt className="text-texto-fraco">Invalidada em</dt>
            <dd className="tabular-nums">{instanteCurto(push.invalidaEm)}</dd>
          </>
        )}
      </dl>

      <div className="flex flex-wrap gap-2">
        {permissao === "default" && (
          <Botao onClick={() => void pedirPermissaoDeNotificacao()}>Permitir notificações</Botao>
        )}
        {push.assinado ? (
          <>
            <Botao disabled={ocupado} onClick={() => void enviarTeste()}>
              Enviar teste
            </Botao>
            <Botao variante="fantasma" disabled={ocupado} onClick={() => void desassinar()}>
              Desassinar
            </Botao>
          </>
        ) : (
          <Botao
            variante="primario"
            disabled={ocupado || permissao !== "granted" || push.chavePublica === null}
            onClick={() => void assinar()}
          >
            Assinar
          </Botao>
        )}
      </div>

      {!push.assinado && push.chavePublica === null && (
        <Nota>
          Assinar exige a chave VAPID pública, que o servidor ainda não tem — sem ela o navegador
          não tem com o que montar a assinatura. Gere o par com <code>npm run push:chaves</code> e
          rode <code>npm run db:seed</code>.
        </Nota>
      )}

      {!push.assinado && push.chavePublica !== null && permissao !== "granted" && (
        <Nota>
          A permissão de notificação precisa vir antes da assinatura: é ela que autoriza o
          navegador a receber.
        </Nota>
      )}

      {push.assinado && push.ultimoEnvioEm === null && (
        <Nota>
          Assinatura gravada, mas nada foi entregue ainda. O teste acima é o que prova o caminho
          inteiro — e, no celular, ele só vale com a PWA instalada e fechada.
        </Nota>
      )}

      {permissao === "denied" && (
        <Nota tom="forte">
          Negada. Depois de negar, o navegador não pergunta de novo: a liberação é nos ajustes do
          site, no próprio navegador.
        </Nota>
      )}

      {mensagem !== null && <p className="text-xs text-texto-fraco">{mensagem}</p>}
    </Secao>
  );
}

/**
 * Preferências.
 *
 * A hora da virada é a regra mais estrutural do app: ela define o que é "hoje"
 * para toda marcação. Mudá-la **não** reavalia o passado, porque os registros
 * guardam o `data_logica` com que foram gravados — o aviso diz isso, porque sem
 * ele a conta de ontem parecer diferente da de hoje soaria como bug.
 */
function Preferencias({
  config,
  aoMudar,
}: {
  readonly config: ConfigApp;
  readonly aoMudar: (config: ConfigApp) => void;
}) {
  const [horaVirada, setHoraVirada] = useState(horaCurta(config.horaVirada));
  const [timezone, setTimezone] = useState(config.timezone);
  const [ocupado, setOcupado] = useState(false);
  const [falha, setFalha] = useState<Falha | null>(null);
  const [salvo, setSalvo] = useState(false);

  const mudou = horaVirada !== horaCurta(config.horaVirada) || timezone !== config.timezone;

  async function salvar() {
    setFalha(null);
    setSalvo(false);
    setOcupado(true);

    const r = await enviar<ConfigApp>("/api/config", "PATCH", {
      horaVirada: `${horaVirada}:00`,
      timezone,
    });

    setOcupado(false);

    if (!r.ok) {
      setFalha(r.falha);
      return;
    }

    aoMudar(r.dados);
    setSalvo(true);
  }

  return (
    <Secao titulo="Preferências">
      <Campo
        rotulo="Hora da virada do dia"
        dica="Antes deste horário, uma marcação conta para o dia anterior. O padrão é 04:00."
      >
        <input
          type="time"
          value={horaVirada}
          onChange={(e) => setHoraVirada(e.target.value)}
          className={CLASSE_ENTRADA}
        />
      </Campo>

      <Campo rotulo="Fuso horário">
        <input
          type="text"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          autoCapitalize="none"
          autoComplete="off"
          className={`${CLASSE_ENTRADA} font-mono text-sm`}
        />
      </Campo>

      <Campo rotulo="Nome na saudação" dica="Vem do .env do servidor, via config_app.">
        <input type="text" value={config.usuarioNome} readOnly className={`${CLASSE_ENTRADA} opacity-60`} />
      </Campo>

      {falha !== null && (
        <p role="alert" className="text-sm text-habito-vermelho">
          {falha.mensagem}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Botao variante="primario" disabled={ocupado || !mudou} onClick={() => void salvar()}>
          Salvar
        </Botao>
        {salvo && <span className="text-xs text-texto-fraco">Salvo.</span>}
      </div>

      <Nota>
        Mudar a virada vale para as marcações <strong className="text-texto">de agora em
        diante</strong>. O histórico guarda o dia lógico com que foi gravado e não é reavaliado.
      </Nota>
    </Secao>
  );
}

function Sair() {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);

  async function sair() {
    setOcupado(true);
    await enviar<Ok>("/api/auth/logout", "POST");
    router.replace("/login");
  }

  return (
    <Botao variante="fantasma" largo disabled={ocupado} onClick={() => void sair()}>
      Sair
    </Botao>
  );
}

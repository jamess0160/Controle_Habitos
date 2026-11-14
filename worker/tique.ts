import { db } from "@/db/knex";
import type { DataLogica } from "@/dominio/calendario";
import { garantirPeriodoDeHoje } from "@/servidor/hoje";
import { SemVapid, enviarPush } from "@/servidor/push";
import { hojeLogico, relogioAtual } from "@/servidor/relogio";
import { pendentes, type NotificacaoPendente } from "./notificacoes";

/**
 * Um tique do worker.
 *
 * Três trabalhos, nesta ordem, e a ordem é a regra: **fechamento de período é o
 * gatilho de tudo** (Mapa de regras). Notificar antes de materializar anunciaria
 * o estado de ontem, e o `congelamento_usado` de um período que ainda não fechou
 * simplesmente não existiria para ser anunciado.
 *
 * Nenhuma das três partes pode derrubar as outras. Um erro de rede no push não
 * pode impedir a virada do dia seguinte, e por isso cada etapa é capturada em
 * separado e o resultado é um relatório, não uma exceção.
 */

export type RelatorioDoTique = {
  instante: string;
  materializados: number;
  notificacoes: { novas: number; enviadas: number; baixadas: number; falhas: number };
  limpezas: { tentativas: number; desafios: number };
  erros: string[];
};

/** Quanto tempo um desafio WebAuthn consumido ou vencido fica guardado. */
const DESAFIOS_POR_HORAS = 24;

export async function tique(agora = new Date()): Promise<RelatorioDoTique> {
  const relatorio: RelatorioDoTique = {
    instante: agora.toISOString(),
    materializados: 0,
    notificacoes: { novas: 0, enviadas: 0, baixadas: 0, falhas: 0 },
    limpezas: { tentativas: 0, desafios: 0 },
    erros: [],
  };

  const relogio = await relogioAtual();
  const hoje = await hojeLogico(agora);

  await tentar(relatorio, "virada", async () => {
    relatorio.materializados = await virarODia(hoje, relogio.timezone, agora);
  });

  await tentar(relatorio, "notificações", async () => {
    relatorio.notificacoes = await notificar({ agora, hoje, relogio });
  });

  await tentar(relatorio, "limpeza", async () => {
    relatorio.limpezas = await limpar(agora);
  });

  return relatorio;
}

async function tentar(
  relatorio: RelatorioDoTique,
  etapa: string,
  trabalho: () => Promise<void>,
): Promise<void> {
  try {
    await trabalho();
  } catch (erro) {
    relatorio.erros.push(`${etapa}: ${erro instanceof Error ? erro.message : String(erro)}`);
  }
}

// ─── A virada ────────────────────────────────────────────────────────────────

/**
 * Fecha o período vencido e abre o seguinte, em todo hábito ativo.
 *
 * Não há código de fechamento aqui, e é de propósito: fechar é re-materializar,
 * e a materialização é o replay de `simular()`. O ganho de congelamento, o
 * consumo automático, o `falhou` e o re-encadeamento de `cada_n_dias` caem do
 * mesmo lugar de onde já caíam quando o usuário marca — não existe uma segunda
 * implementação do fechamento rodando de madrugada, que é exatamente onde um
 * erro ficaria escondido por semanas.
 *
 * A condição é "nenhum período cobre hoje". Com ela o custo é uma consulta por
 * hábito nos 1439 minutos em que não há nada a fazer, e o replay no minuto em
 * que há.
 */
async function virarODia(hoje: DataLogica, timezone: string, agora: Date): Promise<number> {
  const habitos = await db("habito").whereNull("arquivado_em").select("id");

  let materializados = 0;

  for (const habito of habitos) {
    const cobre = await db("habito_periodo")
      .where({ habito_id: habito.id })
      .where("inicio", "<=", hoje)
      .where("fim", ">=", hoje)
      .first("id");

    if (cobre !== undefined) continue;

    if (await garantirPeriodoDeHoje(habito.id, hoje, timezone, agora)) {
      materializados += 1;
    }
  }

  return materializados;
}

// ─── As notificações ─────────────────────────────────────────────────────────

type ContagemDeEnvio = { novas: number; enviadas: number; baixadas: number; falhas: number };

/**
 * Envia o que está pendente e ainda não foi enviado.
 *
 * A guarda de idempotência é gravada **antes** do envio, e a inserção é a própria
 * guarda: `notificacao_enviada` tem UNIQUE em (tipo, referência), então duas
 * execuções concorrentes do worker não conseguem as duas inserir — a segunda
 * recebe zero linhas e desiste. Ler-depois-escrever teria uma janela entre as
 * duas operações, e o tique de um minuto é curto o bastante para cair nela.
 *
 * O preço é que um envio que falha **não** é tentado de novo: a linha já está
 * gravada. É a troca certa para este app — o push é comunicação de cortesia, e a
 * mesma informação está no dashboard. Reenviar até conseguir é o modo de uma
 * falha de rede virar dez notificações iguais quando a conexão volta.
 */
async function notificar(opcoes: Parameters<typeof pendentes>[0]): Promise<ContagemDeEnvio> {
  const contagem: ContagemDeEnvio = { novas: 0, enviadas: 0, baixadas: 0, falhas: 0 };

  const lista = await pendentes(opcoes);
  if (lista.length === 0) return contagem;

  for (const notificacao of lista) {
    if (!(await reservar(notificacao))) continue;

    contagem.novas += 1;

    try {
      const envio = await enviarPush(notificacao.conteudo);
      contagem.enviadas += envio.enviadas;
      contagem.baixadas += envio.baixadas;
      contagem.falhas += envio.falhas;
    } catch (erro) {
      /*
       * Sem par VAPID não há push, e isso é estado esperado antes do primeiro
       * deploy — não é erro de execução. As outras duas partes do tique seguem.
       */
      if (erro instanceof SemVapid) return contagem;
      throw erro;
    }
  }

  return contagem;
}

/** `true` se esta execução ganhou o direito de enviar. */
async function reservar(notificacao: NotificacaoPendente): Promise<boolean> {
  const gravadas = await db("notificacao_enviada")
    .insert({ tipo: notificacao.tipo, referencia: notificacao.referencia })
    .onConflict(["tipo", "referencia"])
    .ignore()
    .returning("id");

  return gravadas.length > 0;
}

// ─── A limpeza ───────────────────────────────────────────────────────────────

/**
 * Tira do banco o que já não serve.
 *
 * As duas tabelas são de controle de acesso e crescem com cada tentativa de
 * login e cada toque no cadastro de biometria. Nenhuma das duas tem consulta que
 * olhe para trás além da própria janela: `tentativa_login` conta falhas dos
 * últimos 15 minutos, e um desafio WebAuthn vale 5. Guardar além disso é só
 * acumular histórico de autenticação sem ninguém para lê-lo.
 */
async function limpar(agora: Date): Promise<{ tentativas: number; desafios: number }> {
  /*
   * Uma folga larga sobre a janela de bloqueio: o que decide se alguém está
   * bloqueado são as falhas recentes, e apagar perto do limite poderia liberar o
   * bloqueio antes da hora. Um dia de histórico não pesa.
   */
  const limiteDeTentativas = new Date(agora.getTime() - 24 * 60 * 60_000);
  const limiteDeDesafios = new Date(agora.getTime() - DESAFIOS_POR_HORAS * 60 * 60_000);

  const tentativas = await db("tentativa_login")
    .where("criada_em", "<", limiteDeTentativas)
    .delete();

  const desafios = await db("webauthn_desafio")
    .where("expira_em", "<", limiteDeDesafios)
    .delete();

  return { tentativas, desafios };
}

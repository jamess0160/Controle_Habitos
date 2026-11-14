import type { Aviso } from "@/contracts";
import { db } from "@/db/knex";
import type { NotificacaoTipo } from "@/db/tipos";
import { type DataLogica, comoDataLogica } from "@/dominio/calendario";
import { type RelogioLogico, dataLogicaDe } from "@/dominio/dia-logico";
import { avisosDoHabito } from "@/servidor/hoje";
import type { Notificacao } from "@/servidor/push";
import { horaDeParede } from "@/servidor/relogio";

/**
 * O que notificar agora.
 *
 * Esta é a parte do worker que decide, separada da que envia: a decisão é toda a
 * regra e precisa de teste, o envio é rede. A tabela do
 * [Mapa de regras](../Docs/mapas/Mapa%20de%20regras.md) está escrita aqui linha
 * por linha.
 *
 * Nada aqui olha o relógio por conta própria — `agora` entra por parâmetro, pelo
 * mesmo motivo de `dominio/`: um teste de notificação sem controle do relógio não
 * é teste, é uma aposta no minuto em que a suíte rodou.
 */

/**
 * A hora em que as comunicações de fechamento são entregues.
 *
 * A virada é às 04:00, e é nela que um período fecha como `congelado` ou
 * `falhou` — mas acordar alguém às quatro da manhã para contar que a sequência
 * acabou é o oposto do que esses avisos servem. Eles esperam o dia começar. Nada
 * se perde: o dashboard mostra os mesmos dois avisos por dois dias.
 */
export const HORA_DO_RESUMO = "08:00:00";

/**
 * A hora do `meta_atraso` quando o hábito não tem lembrete configurado.
 *
 * Ele é o **único** aviso antes de perder o período, então não pode depender de
 * um `notificar_em` opcional — um hábito semanal sem lembrete perderia a semana
 * sem nunca ter sido avisado.
 */
export const HORA_DO_ATRASO = "20:00:00";

export type NotificacaoPendente = {
  tipo: NotificacaoTipo;
  /** Identidade do evento, estável entre materializações. */
  referencia: string;
  conteudo: Notificacao;
};

type HabitoAtivo = { id: string; nome: string };

export async function pendentes(opcoes: {
  agora: Date;
  hoje: DataLogica;
  relogio: RelogioLogico;
}): Promise<NotificacaoPendente[]> {
  const { agora, hoje, relogio } = opcoes;
  const hora = horaDeParede(agora, relogio.timezone);

  const habitos = await db("habito")
    .whereNull("arquivado_em")
    .orderBy("ordem", "asc")
    .select("id", "nome", "pausado_de", "pausado_ate");

  const lista: NotificacaoPendente[] = [];

  for (const habito of habitos) {
    if (emPausa(habito, hoje)) continue;

    lista.push(...(await doFechamento(habito, hoje, hora)));
    lista.push(...(await doDia(habito, { hoje, hora, agora, relogio })));
  }

  return lista;
}

function emPausa(
  habito: { pausado_de: string | null; pausado_ate: string | null },
  hoje: DataLogica,
): boolean {
  if (habito.pausado_de === null) return false;

  return (
    habito.pausado_de <= hoje && (habito.pausado_ate === null || hoje <= habito.pausado_ate)
  );
}

// ─── O que já aconteceu ──────────────────────────────────────────────────────

/**
 * `congelamento_usado` e `sequencia_perdida`, a partir dos **mesmos** avisos do
 * dashboard.
 *
 * Reusar `avisosDoHabito` não é economia de código: é o que garante que o push e
 * a tela digam o mesmo número. Duas contas do estoque de congelamento no mesmo
 * minuto podem discordar, e quem lê não tem como saber qual acreditar.
 */
async function doFechamento(
  habito: HabitoAtivo,
  hoje: DataLogica,
  hora: string,
): Promise<NotificacaoPendente[]> {
  if (hora < HORA_DO_RESUMO) return [];

  const avisos = await avisosDoHabito(habito.id, habito.nome, hoje);

  return avisos.map((aviso) => ({
    tipo: aviso.tipo,
    referencia: chave(habito.id, aviso.periodoFim),
    conteudo: conteudoDoAviso(aviso),
  }));
}

function conteudoDoAviso(aviso: Aviso): Notificacao {
  if (aviso.tipo === "congelamento_usado") {
    return {
      titulo: "Congelamento usado",
      corpo:
        `${aviso.habitoNome}: o período de ${dia(aviso.periodoFim)} foi coberto pelo estoque. ` +
        `${restantes(aviso.restantes)}.`,
      url: "/",
      tag: `congelamento_usado|${aviso.habitoId}`,
    };
  }

  return {
    titulo: "Sequência perdida",
    corpo:
      `${aviso.habitoNome}: a sequência de ${aviso.sequenciaPerdida} terminou em ` +
      `${dia(aviso.periodoFim)}. A janela de 7 dias ainda corrige.`,
    url: "/",
    tag: `sequencia_perdida|${aviso.habitoId}`,
  };
}

function restantes(quantos: number): string {
  if (quantos === 0) return "Não resta nenhum";
  return quantos === 1 ? "Resta 1" : `Restam ${quantos}`;
}

// ─── O que ainda dá para fazer ───────────────────────────────────────────────

/**
 * `lembrete` e `meta_atraso`, que dependem da hora de parede.
 *
 * Os dois disparam quando o momento **já passou** e o alvo continua pendente, e
 * não exatamente no minuto marcado: o worker pode ter ficado fora do ar, e um
 * lembrete de 08:00 entregue às 10:00 ainda serve. O que o limita a não virar
 * arqueologia é o escopo do dia lógico — passou da virada, o momento morreu com
 * ele.
 */
async function doDia(
  habito: HabitoAtivo,
  opcoes: { hoje: DataLogica; hora: string; agora: Date; relogio: RelogioLogico },
): Promise<NotificacaoPendente[]> {
  const { hoje, hora, agora, relogio } = opcoes;

  const periodo = await db("habito_periodo")
    .where({ habito_id: habito.id })
    .where("inicio", "<=", hoje)
    .where("fim", ">=", hoje)
    .orderBy("inicio", "desc")
    .first();

  if (periodo === undefined) return [];

  const config = await db("habito_config").where({ id: periodo.config_id }).first();
  if (config === undefined) return [];

  const progresso = { feitas: periodo.concluidas, meta: periodo.meta_ocorrencias };
  const ultimoDia = comoDataLogica(periodo.fim) === hoje;
  const cumprido = periodo.status === "cumprido";

  /*
   * `meta_atraso` **substitui** o lembrete no último dia, em vez de somar-se a
   * ele: os dois diriam a mesma coisa com urgências diferentes, no mesmo minuto,
   * e duas notificações simultâneas do mesmo hábito treinam a pessoa a ignorar as
   * duas.
   */
  const atraso =
    config.modo === "flexivel" &&
    (config.cadencia === "semanal" || config.cadencia === "mensal") &&
    ultimoDia &&
    !cumprido;

  if (atraso) {
    const quando = config.notificar_em ?? HORA_DO_ATRASO;
    if (hora < quando) return [];

    return [
      {
        tipo: "meta_atraso",
        referencia: chave(habito.id, hoje),
        conteudo: {
          titulo: `${habito.nome} — último dia`,
          corpo: `${faltam(progresso)} até o fim do período, que é hoje.`,
          url: "/",
          tag: `meta_atraso|${habito.id}`,
        },
      },
    ];
  }

  if (cumprido) return [];

  if (config.modo === "fixo") {
    return lembretesFixos(habito, periodo.id, { hoje, agora, relogio });
  }

  /* Sem lembrete configurado, o hábito flexível não lembra nada. */
  if (config.notificar_em === null || hora < config.notificar_em) return [];

  /*
   * Em `cada_n_dias` o lembrete cai no **dia do vencimento**, e só nele: a janela
   * pode ter quinze dias, e lembrar todos eles de algo que só vence no fim é
   * ruído diário. O mapa de regras decide isso explicitamente.
   */
  if (config.cadencia === "cada_n_dias" && !ultimoDia) return [];

  return [
    {
      tipo: "lembrete",
      referencia: chave(habito.id, hoje, config.notificar_em),
      conteudo: {
        titulo: habito.nome,
        corpo: corpoDoLembrete(progresso, comoDataLogica(periodo.fim), hoje),
        url: "/",
        tag: `lembrete|${habito.id}`,
      },
    },
  ];
}

/**
 * Um lembrete por momento devido que já passou e continua pendente.
 *
 * O dia de uma ocorrência é o dia **lógico** de `previsto_para`: a dose das 02:00
 * pertence ao dia anterior, e comparar a data direto lembraria no dia errado.
 */
async function lembretesFixos(
  habito: HabitoAtivo,
  periodoId: string,
  opcoes: { hoje: DataLogica; agora: Date; relogio: RelogioLogico },
): Promise<NotificacaoPendente[]> {
  const ocorrencias = await db("habito_ocorrencia")
    .where({ periodo_id: periodoId })
    .whereNot({ status: "cumprida" })
    .orderBy("previsto_para", "asc");

  return ocorrencias
    .filter((o) => dataLogicaDe(o.previsto_para, opcoes.relogio) === opcoes.hoje)
    .filter((o) => o.previsto_para <= opcoes.agora)
    .map((o) => {
      const horario = horaDeParede(o.previsto_para, opcoes.relogio.timezone);

      return {
        tipo: "lembrete" as const,
        referencia: chave(habito.id, opcoes.hoje, horario),
        conteudo: {
          titulo: habito.nome,
          corpo: `Momento das ${horario.slice(0, 5)}, ainda pendente.`,
          url: "/",
          /* A tag inclui o horário: as duas doses do dia são dois avisos. */
          tag: `lembrete|${habito.id}|${horario}`,
        },
      };
    });
}

function corpoDoLembrete(
  progresso: { feitas: number; meta: number },
  fim: DataLogica,
  hoje: DataLogica,
): string {
  if (progresso.meta <= 1) return "Ainda não marcado hoje.";

  return fim === hoje
    ? `${faltam(progresso)} até o fim do período, que é hoje.`
    : `${faltam(progresso)} até ${dia(fim)}.`;
}

function faltam(progresso: { feitas: number; meta: number }): string {
  const quantas = Math.max(0, progresso.meta - progresso.feitas);
  return quantas === 1 ? "Falta 1" : `Faltam ${quantas}`;
}

// ─── Identidade do evento ────────────────────────────────────────────────────

/**
 * A chave de idempotência.
 *
 * Descreve o **evento** — hábito, dia, momento —, nunca a linha que o
 * materializa: `habito_periodo` e `habito_ocorrencia` são apagados e recriados
 * com ids novos a cada escrita, então uma chave de id faria o lembrete já
 * enviado deixar de ser reconhecido na primeira marcação do dia, e o worker o
 * reenviaria a cada minuto.
 */
function chave(habitoId: string, ...partes: string[]): string {
  return [habitoId, ...partes].join("|");
}

/** `2026-11-14` → `14/11`, sem passar por `new Date` — ver a armadilha nº 1. */
function dia(dataLogica: string): string {
  const [, mes, diaDoMes] = dataLogica.split("-");
  return `${diaDoMes}/${mes}`;
}

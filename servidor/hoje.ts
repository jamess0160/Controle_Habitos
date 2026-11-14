import type { Knex } from "knex";
import type { Aviso, Hoje, LinhaDeHoje, Progresso } from "@/contracts";
import { db } from "@/db/knex";
import { configDoContrato } from "@/db/mapa-dominio";
import { type DataLogica, comoDataLogica, somarDias } from "@/dominio/calendario";
import { type RelogioLogico, dataLogicaDe } from "@/dominio/dia-logico";
import { lerConfig } from "./config";
import { materializar } from "./materializar";
import { hojeLogico, relogioAtual, saudacaoAtual } from "./relogio";

/**
 * `GET /api/hoje` — o dashboard.
 *
 * O payload é montado por **interação devida**, não por hábito: um hábito fixo
 * com dois horários rende duas linhas marcáveis, ambas exibindo a mesma
 * sequência, porque ela é do hábito e não da ocorrência.
 *
 * Nada aqui roda a simulação. As linhas saem das tabelas materializadas —
 * `habito_periodo`, `habito_ocorrencia`, `registro`, `habito_streak`,
 * `congelamento` —, que é o motivo de a materialização existir: replicar o
 * histórico de seis hábitos a cada abertura do app seria o oposto do objetivo.
 */

/** Quantos dias para trás um aviso ainda vale. */
const JANELA_DE_AVISOS = 2;

export async function montarHoje(): Promise<Hoje> {
  const agora = new Date();
  const relogio = await relogioAtual();
  const hoje = await hojeLogico(agora);
  const config = await lerConfig();

  const habitos = await db("habito")
    .whereNull("arquivado_em")
    .orderBy("ordem", "asc")
    .select("id", "nome", "cor");

  const linhas: LinhaDeHoje[] = [];
  const avisos: Aviso[] = [];

  for (const habito of habitos) {
    await garantirPeriodoDeHoje(habito.id, hoje, relogio.timezone, agora);

    linhas.push(...(await linhasDoHabito(habito, hoje, relogio)));
    avisos.push(...(await avisosDoHabito(habito.id, habito.nome, hoje)));
  }

  return {
    saudacao: await saudacaoAtual(agora),
    usuarioNome: config.usuario_nome ?? "você",
    dataLogica: hoje,
    geradoEm: agora.toISOString(),
    linhas,
    avisos,
  };
}

/**
 * Re-materializa quando o período aberto não cobre hoje.
 *
 * **Isto é uma muleta com prazo.** Quem deveria fechar o período da véspera e
 * abrir o de hoje é o worker da etapa 3.5, no tique da virada. Sem ele, um
 * hábito cujo último acesso foi anteontem teria o período aberto com `fim` no
 * passado, e desaparecer do dashboard é pior que uma escrita dentro de um GET.
 *
 * Quando o worker existir isto continua, como rede: ele pode estar parado, e a
 * conta é uma consulta quando não há nada a fazer.
 *
 * Exportada porque o retroativo precisa da mesma garantia: a janela de 7 dias
 * mostraria os dias recentes sem período — bloqueados, sem motivo que o usuário
 * reconheça. Duas cópias divergiriam na virada do dia, que é o único momento em
 * que isto importa.
 */
export async function garantirPeriodoDeHoje(
  habitoId: string,
  hoje: DataLogica,
  timezone: string,
  agora: Date,
): Promise<void> {
  if ((await periodoDeHoje(habitoId, hoje)) !== undefined) return;

  const pausado = await db("habito")
    .where({ id: habitoId })
    .whereNotNull("pausado_de")
    .first("id");

  /* Pausado não gera período por decisão da simulação, e isso está certo. */
  if (pausado !== undefined) return;

  await db.transaction(async (trx) => {
    await materializar(trx, habitoId, { hoje, timezone, agora });
  });
}

/**
 * O período que **cobre hoje**, de qualquer status.
 *
 * Exigir `status = 'aberto'` era um bug: ao cumprir a meta de um hábito diário, o
 * período de hoje fecha como `cumprido` e o próximo só começa amanhã — não existe
 * período aberto. O hábito então sumia do dashboard no instante em que era
 * marcado, que é exatamente quando ele precisa aparecer com a marca cheia. O
 * "tudo cumprido hoje" da tela depende dessas linhas continuarem lá.
 */
async function periodoDeHoje(habitoId: string, hoje: DataLogica) {
  return db("habito_periodo")
    .where({ habito_id: habitoId })
    .where("inicio", "<=", hoje)
    .where("fim", ">=", hoje)
    .orderBy("inicio", "desc")
    .first();
}

// ─── Linhas ──────────────────────────────────────────────────────────────────

type HabitoDaLinha = { id: string; nome: string; cor: string };

async function linhasDoHabito(
  habito: HabitoDaLinha,
  hoje: DataLogica,
  relogio: RelogioLogico,
): Promise<LinhaDeHoje[]> {
  const periodo = await periodoDeHoje(habito.id, hoje);
  if (periodo === undefined) return [];

  /*
   * A configuração vem do **período**, por `config_id`, e não a vigente hoje: o
   * período foi aberto sob uma versão, e é por ela que ele é avaliado. Ler a
   * vigente aqui erraria exatamente a armadilha nº 2 do projeto.
   */
  const configLinha = await db("habito_config").where({ id: periodo.config_id }).first();
  if (configLinha === undefined) {
    throw new Error(`Período ${periodo.id} aponta para config inexistente.`);
  }

  const config = configDoContrato(configLinha);

  const streak = await db("habito_streak").where({ habito_id: habito.id }).first();
  const [{ congelados }] = await db("congelamento")
    .where({ habito_id: habito.id, status: "disponivel" })
    .count({ congelados: "*" });

  const comum = {
    habitoId: habito.id,
    nome: habito.nome,
    cor: habito.cor as LinhaDeHoje["cor"],
    periodoId: periodo.id,
    sequencia: streak?.sequencia_atual ?? 0,
    congelamentos: Number(congelados),
  };

  const registros = await registrosDoPeriodo(db, periodo.id);
  const deHoje = registros.filter((r) => r.dataLogica === hoje);

  if (config.modo === "flexivel") {
    const meus = deHoje;

    return [
      {
        ...comum,
        ocorrenciaId: null,
        horario: null,
        ultimoRegistro: ultimoDe(meus),
        progresso: progressoDe(config, periodo, meus, registros),
        concluida: concluidaDe(config, meus, registros),
      },
    ];
  }

  /* Modo fixo: uma linha por ocorrência **devida hoje**. */
  const ocorrencias = await db("habito_ocorrencia")
    .where({ periodo_id: periodo.id })
    .orderBy("previsto_para", "asc");

  /*
   * "Devida hoje" é o **dia lógico** de `previsto_para`, não a data de parede: a
   * dose das 02:00 pertence ao dia anterior, e comparar a data direto a colocaria
   * na linha errada. É a armadilha nº 1 chegando à montagem do dashboard.
   */
  const devidasHoje = ocorrencias.filter(
    (o) => dataLogicaDe(o.previsto_para, relogio) === hoje,
  );

  return devidasHoje.map((ocorrencia) => {
    const meus = deHoje.filter((r) => r.ocorrenciaId === ocorrencia.id);

    return {
      ...comum,
      ocorrenciaId: ocorrencia.id,
      horario: horaDeParede(ocorrencia.previsto_para, relogio.timezone),
      ultimoRegistro: ultimoDe(meus),
      progresso: progressoDe(config, periodo, meus, registros),
      concluida: concluidaDe(config, meus, registros),
    };
  });
}

function horaDeParede(instante: Date, timezone: string): string {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instante);

  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? "00";

  return `${valor("hour")}:${valor("minute")}:${valor("second")}`;
}

type RegistroDaLinha = {
  id: string;
  ocorrenciaId: string | null;
  dataLogica: DataLogica;
  valor: number;
};

async function registrosDoPeriodo(conexao: Knex, periodoId: string): Promise<RegistroDaLinha[]> {
  const linhas = await conexao("registro")
    .where({ periodo_id: periodoId })
    .orderBy("criado_em", "asc")
    .select("id", "ocorrencia_id", "data_logica", "valor");

  return linhas.map((l) => ({
    id: l.id,
    ocorrenciaId: l.ocorrencia_id,
    dataLogica: comoDataLogica(l.data_logica),
    valor: Number(l.valor),
  }));
}

/**
 * O último registro da interação — o que o dashboard desfaz.
 *
 * O último e não a lista: desfazer na tela é para o toque de agora, e a janela de
 * 7 dias inteira é assunto do retroativo. Ver a nota em `linhaDeHoje`.
 */
function ultimoDe(registros: RegistroDaLinha[]): LinhaDeHoje["ultimoRegistro"] {
  const ultimo = registros.at(-1);
  return ultimo === undefined ? null : { id: ultimo.id, valor: ultimo.valor };
}

type ConfigDaLinha = ReturnType<typeof configDoContrato>;
type PeriodoDaLinha = { meta_ocorrencias: number; concluidas: number };

/**
 * O progresso na forma própria de cada tipo.
 *
 * As duas escalas não são a mesma, e é de propósito:
 *
 * - `binario` mostra o **período** (2 de 3 na semana), porque a interação é
 *   binária e o que resta de informação é quanto falta para fechar o período;
 * - `quantificado` e `duracao` mostram a **interação de hoje** contra a meta de
 *   uma unidade (1400 de 2000 ml), porque é isso que o botão de incremento move;
 * - `negativo` mostra o período, porque a tolerância é por período.
 */
function progressoDe(
  config: ConfigDaLinha,
  periodo: PeriodoDaLinha,
  daInteracao: RegistroDaLinha[],
  doPeriodo: RegistroDaLinha[],
): Progresso {
  switch (config.meta.tipo) {
    case "binario":
      return {
        tipo: "binario",
        concluidas: periodo.concluidas,
        meta: periodo.meta_ocorrencias,
      };
    case "quantificado":
      return {
        tipo: "quantificado",
        acumulado: somar(daInteracao),
        meta: config.meta.valor,
        unidade: config.meta.unidade,
      };
    case "duracao":
      return {
        tipo: "duracao",
        acumulado: somar(daInteracao),
        meta: config.meta.minutos,
      };
    case "negativo":
      return {
        tipo: "negativo",
        recaidas: doPeriodo.length,
        tolerancia: config.meta.tolerancia,
      };
  }
}

/**
 * Quando a marca aparece cheia. Mesma regra de `componentes/efeitos-de-hoje.ts`,
 * do outro lado do fio — e é por isso que ela está escrita nos dois lugares com
 * a mesma forma: a tela aplica o efeito local sem esperar o servidor, e as duas
 * contas precisam concordar.
 */
function concluidaDe(
  config: ConfigDaLinha,
  daInteracao: RegistroDaLinha[],
  doPeriodo: RegistroDaLinha[],
): boolean {
  switch (config.meta.tipo) {
    case "binario":
      return daInteracao.length > 0;
    case "quantificado":
      return somar(daInteracao) >= config.meta.valor;
    case "duracao":
      return somar(daInteracao) >= config.meta.minutos;
    case "negativo":
      /* Nasce cumprido: "sem recaída" é o estado inicial. */
      return doPeriodo.length <= config.meta.tolerancia;
  }
}

function somar(registros: RegistroDaLinha[]): number {
  return registros.reduce((total, r) => total + r.valor, 0);
}

// ─── Avisos ──────────────────────────────────────────────────────────────────

/**
 * Os avisos são **informativos**: contam o que já aconteceu.
 *
 * Com o consumo automático de congelamento não há nada a decidir no prazo, então
 * o antigo bloco "sequência em risco" não tem equivalente — ele supunha uma
 * decisão e um prazo de resgate que não existem.
 *
 * A janela de dois dias evita que o aviso fique permanente. Sem registro de
 * leitura, é o melhor critério disponível: mais que isso e o dashboard viraria
 * um mural do mês passado.
 */
async function avisosDoHabito(
  habitoId: string,
  habitoNome: string,
  hoje: DataLogica,
): Promise<Aviso[]> {
  const recentes = await db("habito_periodo")
    .where({ habito_id: habitoId })
    .whereNot({ status: "aberto" })
    .where("fim", ">=", somarDias(hoje, -JANELA_DE_AVISOS))
    .orderBy("fim", "asc")
    .select("id", "fim", "status");

  if (recentes.length === 0) return [];

  const [{ restantes }] = await db("congelamento")
    .where({ habito_id: habitoId, status: "disponivel" })
    .count({ restantes: "*" });

  const avisos: Aviso[] = [];

  for (const periodo of recentes) {
    if (periodo.status === "congelado") {
      avisos.push({
        tipo: "congelamento_usado",
        habitoId,
        habitoNome,
        periodoFim: comoDataLogica(periodo.fim),
        restantes: Number(restantes),
      });
      continue;
    }

    if (periodo.status !== "falhou") continue;

    const perdida = await sequenciaAntesDe(habitoId, periodo.fim);

    /* Sequência de zero não foi perdida: não havia nada ali para contar. */
    if (perdida >= 1) {
      avisos.push({
        tipo: "sequencia_perdida",
        habitoId,
        habitoNome,
        periodoFim: comoDataLogica(periodo.fim),
        sequenciaPerdida: perdida,
      });
    }
  }

  return avisos;
}

/**
 * Quanto a sequência valia imediatamente antes daquele período.
 *
 * Caminha para trás pelos períodos materializados somando o que cada um valeu —
 * 1 no modo flexível, um por slot cumprido no fixo, que é a conta de
 * `avaliarPeriodo` — e para no primeiro `falhou`. `congelado` não soma e não
 * interrompe, exatamente como `aplicarFechamento` o trata.
 *
 * Reconstruir aqui em vez de guardar a coluna: o número serve a um aviso de dois
 * dias, e uma coluna a mais em `habito_periodo` precisaria ser mantida correta
 * por toda materialização — risco maior que a consulta.
 */
async function sequenciaAntesDe(habitoId: string, fim: string): Promise<number> {
  const anteriores = await db("habito_periodo")
    .join("habito_config", "habito_config.id", "habito_periodo.config_id")
    .where("habito_periodo.habito_id", habitoId)
    .where("habito_periodo.fim", "<", fim)
    .whereNot("habito_periodo.status", "aberto")
    .orderBy("habito_periodo.fim", "desc")
    .select(
      "habito_periodo.status",
      "habito_periodo.concluidas",
      "habito_config.modo",
    );

  let total = 0;

  for (const periodo of anteriores as unknown as Array<{
    status: string;
    concluidas: number;
    modo: string;
  }>) {
    if (periodo.status === "falhou") break;
    if (periodo.status === "congelado") continue;

    total += periodo.modo === "fixo" ? periodo.concluidas : 1;
  }

  return total;
}

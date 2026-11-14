import type { Knex } from "knex";
import type {
  ConfigHabito,
  CriarHabito,
  Habito,
  ListaDeHabitos,
  PausarHabito,
} from "@/contracts";
import { resumoDeConfig } from "@/contracts/resumo";
import { db } from "@/db/knex";
import { configDoContrato, linhaDeConfig } from "@/db/mapa-dominio";
import { somarDias } from "@/dominio/calendario";
import { materializar } from "./materializar";
import { hojeLogico, relogioAtual, type DataLogica } from "./relogio";

/**
 * O repositório de hábitos.
 *
 * Toda escrita aqui termina em `materializar()`, dentro da mesma transação:
 * criar, editar, pausar, retomar, arquivar e desarquivar **todas** mudam a
 * entrada da simulação, e deixar a materialização para depois significaria uma
 * janela em que a sequência exibida não corresponde à configuração gravada.
 */

// ─── Leitura ─────────────────────────────────────────────────────────────────

/**
 * Monta o payload de um hábito.
 *
 * Três leituras além da linha do hábito: a config vigente, a sequência
 * materializada e o estoque de congelamento. Nenhuma delas roda a simulação — é
 * exatamente o que a materialização existe para evitar, e um `GET /api/habitos`
 * que replicasse o histórico de seis hábitos a cada abertura da lista seria o
 * oposto do objetivo.
 */
async function montar(conexao: Knex, habitoId: string): Promise<Habito | null> {
  const linha = await conexao("habito").where({ id: habitoId }).first();
  if (linha === undefined) return null;

  const config = await conexao("habito_config")
    .where({ habito_id: habitoId })
    .whereNull("vigente_ate")
    .first();

  if (config === undefined) {
    throw new Error(`Hábito ${habitoId} sem configuração vigente.`);
  }

  const streak = await conexao("habito_streak").where({ habito_id: habitoId }).first();

  const [{ count }] = await conexao("congelamento")
    .where({ habito_id: habitoId, status: "disponivel" })
    .count({ count: "*" });

  const doContrato = configDoContrato(config);

  return {
    id: linha.id,
    nome: linha.nome,
    cor: linha.cor as Habito["cor"],
    inicioEm: linha.inicio_em,
    ordem: linha.ordem,
    config: doContrato,
    resumo: resumoDeConfig(doContrato),
    sequencia: {
      atual: streak?.sequencia_atual ?? 0,
      recorde: streak?.sequencia_recorde ?? 0,
      totalNoPrazo: streak?.total_no_prazo ?? 0,
      desde: streak?.desde ?? null,
    },
    congelamentosDisponiveis: Number(count),
    pausa: linha.pausado_de === null ? null : { de: linha.pausado_de, ate: linha.pausado_ate },
    arquivadoEm: linha.arquivado_em?.toISOString() ?? null,
  };
}

/** Obrigatório depois de uma escrita: se o hábito sumiu ali, é bug, não 404. */
async function exigirMontado(conexao: Knex, habitoId: string): Promise<Habito> {
  const habito = await montar(conexao, habitoId);
  if (habito === null) throw new Error(`Hábito ${habitoId} desapareceu durante a escrita.`);
  return habito;
}

export async function buscarHabito(habitoId: string): Promise<Habito | null> {
  return montar(db, habitoId);
}

/**
 * A lista, separada em ativos e arquivados.
 *
 * Duas listas no payload e não um `arquivadoEm` para a tela filtrar: a tela
 * mostra os arquivados dentro de um `<details>` fechado, e a separação no
 * servidor deixa a ordenação de cada grupo ser a que faz sentido nele — `ordem`
 * nos ativos, data de arquivamento nos arquivados.
 */
export async function listarHabitos(): Promise<ListaDeHabitos> {
  const ativos = await db("habito")
    .whereNull("arquivado_em")
    .orderBy("ordem", "asc")
    .select("id");

  const arquivados = await db("habito")
    .whereNotNull("arquivado_em")
    .orderBy("arquivado_em", "desc")
    .select("id");

  return {
    habitos: await Promise.all(ativos.map((h) => exigirMontado(db, h.id))),
    arquivados: await Promise.all(arquivados.map((h) => exigirMontado(db, h.id))),
  };
}

// ─── Escrita ─────────────────────────────────────────────────────────────────

/**
 * Cria o hábito com a versão 1 da configuração e já o materializa.
 *
 * `inicio_em` é hoje, sempre: o contrato não tem campo de início (ver
 * `criarHabito`), e a janela retroativa de 7 dias cobre quem começou antes.
 *
 * A `ordem` vai para o fim da lista dos ativos. `COALESCE(max, 0) + 1` numa
 * subconsulta e não uma contagem: contar daria o número errado depois de qualquer
 * arquivamento, e duas criações simultâneas num app de um usuário só não são
 * cenário — mas a transação cobre isso de todo jeito.
 */
export async function criarHabitoNoBanco(dados: CriarHabito): Promise<Habito> {
  const hoje = await hojeLogico();
  const { timezone } = await relogioAtual();

  return db.transaction(async (trx) => {
    const [{ proxima }] = await trx("habito")
      .whereNull("arquivado_em")
      .select(trx.raw("COALESCE(MAX(ordem), 0) + 1 AS proxima") as unknown as string);

    const [linha] = await trx("habito")
      .insert({
        nome: dados.nome,
        cor: dados.cor,
        tipo: dados.config.meta.tipo,
        inicio_em: hoje,
        ordem: Number(proxima),
        pausado_de: null,
        pausado_ate: null,
        arquivado_em: null,
      })
      .returning("id");

    await trx("habito_config").insert(
      linhaDeConfig(dados.config, { habitoId: linha.id, versao: 1, vigenteDe: hoje }),
    );

    await materializar(trx, linha.id, { hoje, timezone });

    return exigirMontado(trx, linha.id);
  });
}

export type EdicaoDeHabito = {
  nome?: string;
  cor?: string;
  config?: ConfigHabito;
};

/**
 * Edita o hábito. Nome e cor mudam na linha; a configuração **versiona**.
 *
 * ## O versionamento, e a única exceção ao "nunca UPDATE"
 *
 * A regra do mapa é que período passado seja avaliado pela configuração que
 * valia nele, então editar fecha a versão vigente em **ontem** e abre a próxima
 * a partir de hoje. As faixas não se sobrepõem, que é o que `configVigenteEm`
 * assume ao resolver por `vigente_de <= data <= vigente_ate`.
 *
 * Só que uma versão criada **hoje** não governou período fechado nenhum: ela só
 * governa o período aberto, que a materialização recalcula do zero de todo jeito.
 * Fechá-la em ontem produziria `vigente_ate < vigente_de` e o `CHECK
 * habito_config_vigencia` recusaria; criar a nova com a mesma data produziria
 * duas faixas sobrepostas e `configVigenteEm` escolheria a mais antiga. Então
 * nesse caso — e **somente** nele — a versão vigente é atualizada no lugar.
 *
 * O ganho não é só evitar o conflito: uma tarde ajustando a meta de um hábito
 * novo deixaria uma dúzia de versões no histórico, todas sem nenhum período
 * fechado para explicar.
 */
export async function editarHabitoNoBanco(
  habitoId: string,
  dados: EdicaoDeHabito,
): Promise<Habito | null> {
  const hoje = await hojeLogico();
  const { timezone } = await relogioAtual();

  return db.transaction(async (trx) => {
    const atual = await trx("habito").where({ id: habitoId }).first("id", "tipo");
    if (atual === undefined) return null;

    if (dados.nome !== undefined || dados.cor !== undefined) {
      await trx("habito")
        .where({ id: habitoId })
        .update({
          ...(dados.nome !== undefined ? { nome: dados.nome } : {}),
          ...(dados.cor !== undefined ? { cor: dados.cor } : {}),
        });
    }

    if (dados.config !== undefined) {
      await versionarConfig(trx, habitoId, dados.config, hoje);
    }

    await materializar(trx, habitoId, { hoje, timezone });

    return exigirMontado(trx, habitoId);
  });
}

async function versionarConfig(
  trx: Knex,
  habitoId: string,
  config: ConfigHabito,
  hoje: DataLogica,
): Promise<void> {
  const vigente = await trx("habito_config")
    .where({ habito_id: habitoId })
    .whereNull("vigente_ate")
    .first("id", "versao", "vigente_de");

  if (vigente === undefined) {
    throw new Error(`Hábito ${habitoId} sem configuração vigente para versionar.`);
  }

  /*
   * O tipo é imutável, e a rota já garante isso pelo schema `editarHabito(tipo)`.
   * A guarda existe porque esta função é exportada: sem ela, um chamador novo
   * receberia a violação da FK composta `(habito_id, tipo)` como 500, em vez de
   * um erro que diz o que está errado.
   */
  const habito = await trx("habito").where({ id: habitoId }).first("tipo");
  if (habito !== undefined && habito.tipo !== config.meta.tipo) {
    throw new Error(
      `O tipo do hábito é imutável: ${habito.tipo} não pode virar ${config.meta.tipo}.`,
    );
  }

  const linha = linhaDeConfig(config, {
    habitoId,
    versao: vigente.versao,
    vigenteDe: vigente.vigente_de,
  });

  /* Versão que nasceu hoje nunca governou período fechado: atualiza no lugar. */
  if (vigente.vigente_de >= hoje) {
    const { habito_id: _ignora, versao: _v, vigente_de: _vd, ...campos } = linha;
    await trx("habito_config").where({ id: vigente.id }).update(campos);
    return;
  }

  await trx("habito_config")
    .where({ id: vigente.id })
    .update({ vigente_ate: somarDias(hoje, -1) });

  await trx("habito_config").insert(
    linhaDeConfig(config, { habitoId, versao: vigente.versao + 1, vigenteDe: hoje }),
  );
}

/**
 * Reordena pela lista completa, e não por um par de índices.
 *
 * O arraste na tela produz a ordem final; mandar a lista inteira deixa a
 * operação ser idempotente e dispensa o cliente calcular deltas. Ids ausentes
 * ficam onde estavam, depois dos enviados — um hábito criado em outra aba não
 * desaparece da ordenação por não constar do pedido.
 */
export async function reordenarHabitosNoBanco(ordem: string[]): Promise<ListaDeHabitos> {
  await db.transaction(async (trx) => {
    const existentes = await trx("habito").whereNull("arquivado_em").select("id");
    const conhecidos = new Set(existentes.map((h) => h.id));

    const pedidos = ordem.filter((id) => conhecidos.has(id));
    const resto = [...conhecidos].filter((id) => !pedidos.includes(id));

    for (const [i, id] of [...pedidos, ...resto].entries()) {
      await trx("habito").where({ id }).update({ ordem: i + 1 });
    }
  });

  return listarHabitos();
}

/**
 * Pausa e retomada.
 *
 * Pausa suspende sem punição: a simulação não gera período no intervalo, então
 * nenhuma sequência cai. `ate: null` é pausa aberta — a simulação para ali e o
 * hábito só volta quando a pausa receber uma data de fim.
 *
 * Retomar é pausar com `de: null`? Não: é `POST .../pausa` com a pausa limpa,
 * que o contrato expressa como... nada. Então `retomarHabito` é função própria —
 * a alternativa seria sobrecarregar `de` com um significado nulo que o schema
 * não tem.
 */
export async function pausarHabitoNoBanco(
  habitoId: string,
  pausa: PausarHabito,
): Promise<Habito | null> {
  return comMaterializacao(habitoId, async (trx) => {
    await trx("habito")
      .where({ id: habitoId })
      .update({ pausado_de: pausa.de, pausado_ate: pausa.ate });
  });
}

export async function retomarHabitoNoBanco(habitoId: string): Promise<Habito | null> {
  return comMaterializacao(habitoId, async (trx) => {
    await trx("habito").where({ id: habitoId }).update({ pausado_de: null, pausado_ate: null });
  });
}

/**
 * Arquivar e desarquivar.
 *
 * Arquivar não apaga nada e não mexe na pausa: é uma decisão de apresentação —
 * o hábito sai da lista e do dashboard, e o histórico fica. Desarquivar o traz
 * de volta ao fim da ordem, porque a `ordem` antiga provavelmente colide com a
 * de quem ficou.
 */
export async function arquivarHabitoNoBanco(
  habitoId: string,
  arquivar: boolean,
): Promise<Habito | null> {
  return comMaterializacao(habitoId, async (trx) => {
    if (arquivar) {
      await trx("habito").where({ id: habitoId }).update({ arquivado_em: new Date() });
      return;
    }

    const [{ proxima }] = await trx("habito")
      .whereNull("arquivado_em")
      .select(trx.raw("COALESCE(MAX(ordem), 0) + 1 AS proxima") as unknown as string);

    await trx("habito")
      .where({ id: habitoId })
      .update({ arquivado_em: null, ordem: Number(proxima) });
  });
}

/** O par escrita + materialização, que toda mudança de estado do hábito repete. */
async function comMaterializacao(
  habitoId: string,
  escrever: (trx: Knex) => Promise<void>,
): Promise<Habito | null> {
  const hoje = await hojeLogico();
  const { timezone } = await relogioAtual();

  return db.transaction(async (trx) => {
    const existe = await trx("habito").where({ id: habitoId }).first("id");
    if (existe === undefined) return null;

    await escrever(trx);
    await materializar(trx, habitoId, { hoje, timezone });

    return exigirMontado(trx, habitoId);
  });
}

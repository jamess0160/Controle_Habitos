import { type DataLogica, comoDataLogica } from "../dominio/calendario";
import type { Meta, Modo } from "../dominio/meta";
import type { Cadencia, ModoFixo } from "../dominio/periodo";
import type { VersaoConfig } from "../dominio/simulacao";
import type { ConfigHabito as ConfigDoContrato } from "../contracts";
import type { HabitoConfig, HabitoConfigInsert } from "./tipos";

/**
 * Tradução da linha do banco para a forma que o domínio consome.
 *
 * `habito_config` é larga e cheia de nullables, porque uma única tabela guarda
 * as quatro cadências, os dois modos e os quatro tipos de meta. O domínio
 * trabalha com uniões discriminadas, onde cada variante carrega só os campos que
 * fazem sentido nela. Este módulo é a fronteira entre as duas formas, e é o
 * único lugar do código onde o nullable da tabela precisa ser encarado.
 *
 * Os CHECKs da migration garantem que os campos exigidos abaixo existem — mas o
 * tipo da linha não sabe disso, então `exigir` transforma a garantia do banco em
 * erro legível caso alguém insira configuração por fora (psql, correção manual).
 */

function exigir<T>(valor: T | null | undefined, campo: string, contexto: string): T {
  if (valor === null || valor === undefined) {
    throw new Error(`habito_config.${campo} é obrigatório em ${contexto}.`);
  }
  return valor;
}

function cadenciaDe(linha: HabitoConfig): Cadencia {
  switch (linha.cadencia) {
    case "diario":
      return { tipo: "diario" };
    case "semanal":
      return { tipo: "semanal" };
    case "mensal":
      return { tipo: "mensal" };
    case "cada_n_dias":
      return {
        tipo: "cada_n_dias",
        intervalo: exigir(linha.cadencia_intervalo, "cadencia_intervalo", "cadência cada_n_dias"),
      };
  }
}

function metaDe(linha: HabitoConfig): Meta {
  switch (linha.tipo) {
    case "binario":
      return { tipo: "binario" };
    case "quantificado":
      return {
        tipo: "quantificado",
        valor: exigir(linha.meta_valor, "meta_valor", "hábito quantificado"),
      };
    case "duracao":
      return {
        tipo: "duracao",
        minutos: exigir(linha.meta_minutos, "meta_minutos", "hábito de duração"),
      };
    case "negativo":
      return {
        tipo: "negativo",
        tolerancia: exigir(linha.tolerancia_recaidas, "tolerancia_recaidas", "hábito negativo"),
      };
  }
}

function modoDe(linha: HabitoConfig): Modo {
  if (linha.modo === "fixo") return { tipo: "fixo" };
  return {
    tipo: "flexivel",
    metaOcorrencias: exigir(linha.meta_ocorrencias, "meta_ocorrencias", "modo flexível"),
  };
}

function modoFixoDe(linha: HabitoConfig): ModoFixo | undefined {
  if (linha.modo !== "fixo") return undefined;

  return {
    diasSemana: linha.dias_semana?.map(comoDiaDaSemana),
    diasMes: linha.dias_mes ?? undefined,
    horarios: linha.horarios ?? undefined,
  };
}

function comoDiaDaSemana(valor: number): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  if (!Number.isInteger(valor) || valor < 1 || valor > 7) {
    throw new Error(`dias_semana fora do domínio 1..7 (1 = domingo): ${valor}`);
  }
  return valor as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

export function versaoDeConfig(linha: HabitoConfig): VersaoConfig {
  return {
    id: linha.id,
    vigenteDe: comoDataLogica(linha.vigente_de),
    vigenteAte: linha.vigente_ate === null ? null : comoDataLogica(linha.vigente_ate),
    cadencia: cadenciaDe(linha),
    modo: modoDe(linha),
    modoFixo: modoFixoDe(linha),
    meta: metaDe(linha),
    congelamento: linha.congelamento_ativo
      ? {
          aCada: exigir(linha.congelamento_a_cada, "congelamento_a_cada", "congelamento ativo"),
          max: exigir(linha.congelamento_max, "congelamento_max", "congelamento ativo"),
        }
      : null,
  };
}

/**
 * Instante absoluto de um horário num dia lógico.
 *
 * O Brasil não tem horário de verão desde 2019, então o deslocamento de
 * São Paulo é fixo em -03:00 e pode ser escrito direto. Se isso voltar a mudar,
 * este é o ponto único a corrigir.
 */
export function instanteDe(data: DataLogica, hora: string): Date {
  return new Date(`${data}T${hora}-03:00`);
}

export { comoDataLogica };

// ─── O caminho de volta: contrato → linha ────────────────────────────────────

/**
 * Traduz a configuração do contrato para a linha de `habito_config`.
 *
 * É o inverso de `versaoDeConfig`, e mora no mesmo arquivo de propósito: as duas
 * direções têm de concordar sobre qual campo é nulo em qual variante, e separá-las
 * em módulos distintos seria convidar a divergência. Aqui é onde a união
 * discriminada do contrato volta a ser a tabela larga.
 *
 * Todos os nullables aparecem **explícitos**, mesmo os nulos: omitir um campo e
 * confiar no default da coluna esconderia a decisão, e a tabela não tem default
 * para nenhum deles. Ler esta função de cima a baixo é ler a tabela de CHECKs da
 * migration.
 */
export function linhaDeConfig(
  config: ConfigDoContrato,
  base: { habitoId: string; versao: number; vigenteDe: string; vigenteAte?: string | null },
): HabitoConfigInsert {
  const fixo = config.modo === "fixo" ? config.cadencia : null;

  return {
    habito_id: base.habitoId,
    tipo: config.meta.tipo,
    versao: base.versao,
    vigente_de: base.vigenteDe,
    vigente_ate: base.vigenteAte ?? null,

    cadencia: config.cadencia.tipo,
    cadencia_intervalo:
      config.cadencia.tipo === "cada_n_dias" ? config.cadencia.intervalo : null,
    modo: config.modo,
    meta_ocorrencias: config.modo === "flexivel" ? config.metaOcorrencias : null,
    dias_semana: fixo !== null && fixo.tipo === "semanal" ? fixo.diasSemana : null,
    dias_mes: fixo !== null && fixo.tipo === "mensal" ? fixo.diasMes : null,
    horarios: fixo !== null ? (fixo.horarios ?? null) : null,
    /* O CHECK `habito_config_notificar_em_modo` só admite lembrete no flexível. */
    notificar_em: config.modo === "flexivel" ? config.notificarEm : null,

    meta_valor: config.meta.tipo === "quantificado" ? config.meta.valor : null,
    unidade: config.meta.tipo === "quantificado" ? config.meta.unidade : null,
    meta_minutos: config.meta.tipo === "duracao" ? config.meta.minutos : null,
    tolerancia_recaidas: config.meta.tipo === "negativo" ? config.meta.tolerancia : null,

    congelamento_ativo: config.congelamento !== null,
    congelamento_a_cada: config.congelamento?.aCada ?? null,
    congelamento_max: config.congelamento?.max ?? null,
  };
}

/**
 * E a volta da volta: a linha como o contrato a descreve.
 *
 * Necessária porque `GET /api/habitos` devolve `config` no formato do contrato, e
 * a linha do banco não é esse formato. Sem ela cada rota montaria a união à mão.
 */
export function configDoContrato(linha: HabitoConfig): ConfigDoContrato {
  const meta = metaDoContrato(linha);
  const congelamento = linha.congelamento_ativo
    ? {
        aCada: exigir(linha.congelamento_a_cada, "congelamento_a_cada", "congelamento ativo"),
        max: exigir(linha.congelamento_max, "congelamento_max", "congelamento ativo"),
      }
    : null;

  if (linha.modo === "flexivel") {
    return {
      modo: "flexivel",
      cadencia: cadenciaFlexivelDoContrato(linha),
      metaOcorrencias: exigir(linha.meta_ocorrencias, "meta_ocorrencias", "modo flexível"),
      notificarEm: linha.notificar_em,
      meta,
      congelamento,
    };
  }

  return { modo: "fixo", cadencia: cadenciaFixaDoContrato(linha), meta, congelamento };
}

function metaDoContrato(linha: HabitoConfig): ConfigDoContrato["meta"] {
  switch (linha.tipo) {
    case "binario":
      return { tipo: "binario" };
    case "quantificado":
      return {
        tipo: "quantificado",
        valor: exigir(linha.meta_valor, "meta_valor", "hábito quantificado"),
        unidade: exigir(linha.unidade, "unidade", "hábito quantificado"),
      };
    case "duracao":
      return {
        tipo: "duracao",
        minutos: exigir(linha.meta_minutos, "meta_minutos", "hábito de duração"),
      };
    case "negativo":
      return {
        tipo: "negativo",
        tolerancia: exigir(linha.tolerancia_recaidas, "tolerancia_recaidas", "hábito negativo"),
      };
  }
}

type CadenciaFlexivelDoContrato = Extract<ConfigDoContrato, { modo: "flexivel" }>["cadencia"];
type CadenciaFixaDoContrato = Extract<ConfigDoContrato, { modo: "fixo" }>["cadencia"];

function cadenciaFlexivelDoContrato(linha: HabitoConfig): CadenciaFlexivelDoContrato {
  if (linha.cadencia === "cada_n_dias") {
    return {
      tipo: "cada_n_dias",
      intervalo: exigir(linha.cadencia_intervalo, "cadencia_intervalo", "cadência cada_n_dias"),
    };
  }
  return { tipo: linha.cadencia };
}

function cadenciaFixaDoContrato(linha: HabitoConfig): CadenciaFixaDoContrato {
  const horarios = linha.horarios ?? undefined;

  switch (linha.cadencia) {
    case "diario":
      return {
        tipo: "diario",
        horarios: exigir(linha.horarios, "horarios", "cadência diária no modo fixo"),
      };
    case "semanal":
      return {
        tipo: "semanal",
        diasSemana: exigir(linha.dias_semana, "dias_semana", "cadência semanal no modo fixo").map(
          comoDiaDaSemana,
        ),
        horarios,
      };
    case "mensal":
      return {
        tipo: "mensal",
        diasMes: exigir(linha.dias_mes, "dias_mes", "cadência mensal no modo fixo"),
        horarios,
      };
    case "cada_n_dias":
      /* O CHECK `habito_config_cada_n_dias` impede esta combinação no banco. */
      throw new Error("cada_n_dias não existe no modo fixo.");
  }
}

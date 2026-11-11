import { type DataLogica, comoDataLogica } from "../dominio/calendario";
import type { Meta, Modo } from "../dominio/meta";
import type { Cadencia, ModoFixo } from "../dominio/periodo";
import type { VersaoConfig } from "../dominio/simulacao";
import type { HabitoConfig } from "./tipos";

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

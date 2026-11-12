import type { Cor, Habito, TipoHabito } from "@/contracts";

/**
 * A tradução rascunho ⇆ configuração.
 *
 * Separada do componente porque é **lógica, não interface**: montar a união
 * discriminada a partir de campos soltos de formulário, e desmontá-la de volta
 * ao abrir uma edição. É também a parte testável sem navegador — e a que mais
 * precisa de teste, porque um round-trip que perde um campo faz a edição de um
 * hábito apagar em silêncio parte da configuração dele.
 *
 * Os números ficam como **texto** de propósito. Um `<input type="number">`
 * vazio dá `""`, e guardar isso como `number` obrigaria a escolher entre `0`
 * (que o schema aceitaria em alguns campos) e `NaN` espalhado pelo estado.
 * Convertendo só na montagem, campo vazio vira `NaN`, o schema do contrato
 * recusa, e a mensagem em pt-BR que a tela mostra é a que o servidor mandaria.
 */

export type Cadencia = "diario" | "cada_n_dias" | "semanal" | "mensal";
export type Modo = "flexivel" | "fixo";

export type Rascunho = {
  nome: string;
  cor: Cor;
  tipo: TipoHabito;
  valor: string;
  unidade: string;
  minutos: string;
  tolerancia: string;
  cadencia: Cadencia;
  intervalo: string;
  modo: Modo;
  metaOcorrencias: string;
  diasSemana: number[];
  diasMes: number[];
  /** `"HH:MM"`, o formato do `<input type="time">`. O contrato quer `:00` no fim. */
  horarios: string[];
  notificarEm: string;
  congelamentoAtivo: boolean;
  aCada: string;
  max: string;
};

export function rascunhoDe(habito: Habito | null): Rascunho {
  const base: Rascunho = {
    nome: "",
    cor: "azul",
    tipo: "binario",
    valor: "",
    unidade: "",
    minutos: "",
    tolerancia: "0",
    cadencia: "diario",
    intervalo: "15",
    modo: "flexivel",
    metaOcorrencias: "1",
    diasSemana: [2, 4, 6],
    diasMes: [1],
    horarios: ["08:00"],
    notificarEm: "",
    congelamentoAtivo: false,
    aCada: "3",
    max: "2",
  };

  if (habito === null) return base;

  const { config } = habito;
  const comum = {
    ...base,
    nome: habito.nome,
    cor: habito.cor,
    tipo: config.meta.tipo,
    valor: config.meta.tipo === "quantificado" ? String(config.meta.valor) : base.valor,
    unidade: config.meta.tipo === "quantificado" ? config.meta.unidade : base.unidade,
    minutos: config.meta.tipo === "duracao" ? String(config.meta.minutos) : base.minutos,
    tolerancia: config.meta.tipo === "negativo" ? String(config.meta.tolerancia) : base.tolerancia,
    cadencia: config.cadencia.tipo,
    congelamentoAtivo: config.congelamento !== null,
    aCada: config.congelamento === null ? base.aCada : String(config.congelamento.aCada),
    max: config.congelamento === null ? base.max : String(config.congelamento.max),
  };

  if (config.modo === "fixo") {
    return {
      ...comum,
      modo: "fixo",
      diasSemana: config.cadencia.tipo === "semanal" ? config.cadencia.diasSemana : base.diasSemana,
      diasMes: config.cadencia.tipo === "mensal" ? config.cadencia.diasMes : base.diasMes,
      horarios: (config.cadencia.horarios ?? []).map((h) => h.slice(0, 5)),
      notificarEm: "",
    };
  }

  return {
    ...comum,
    modo: "flexivel",
    metaOcorrencias: String(config.metaOcorrencias),
    intervalo:
      config.cadencia.tipo === "cada_n_dias" ? String(config.cadencia.intervalo) : base.intervalo,
    notificarEm: config.notificarEm === null ? "" : config.notificarEm.slice(0, 5),
  };
}

/** `"08:00"` → `"08:00:00"`, o formato que o contrato (e o Postgres) usam. */
export function comSegundos(hhmm: string): string {
  return `${hhmm}:00`;
}

export function montarConfig(r: Rascunho): unknown {
  const meta =
    r.tipo === "quantificado"
      ? { tipo: "quantificado", valor: Number(r.valor), unidade: r.unidade }
      : r.tipo === "duracao"
        ? { tipo: "duracao", minutos: Number(r.minutos) }
        : r.tipo === "negativo"
          ? { tipo: "negativo", tolerancia: Number(r.tolerancia) }
          : { tipo: "binario" };

  const congelamento = r.congelamentoAtivo
    ? { aCada: Number(r.aCada), max: Number(r.max) }
    : null;

  if (r.modo === "fixo") {
    const horarios = r.horarios.filter((h) => h !== "").map(comSegundos);

    const cadencia =
      r.cadencia === "semanal"
        ? { tipo: "semanal", diasSemana: r.diasSemana, ...(horarios.length > 0 ? { horarios } : {}) }
        : r.cadencia === "mensal"
          ? { tipo: "mensal", diasMes: r.diasMes, ...(horarios.length > 0 ? { horarios } : {}) }
          : { tipo: "diario", horarios };

    return { modo: "fixo", cadencia, meta, congelamento };
  }

  const cadencia =
    r.cadencia === "cada_n_dias"
      ? { tipo: "cada_n_dias", intervalo: Number(r.intervalo) }
      : { tipo: r.cadencia };

  return {
    modo: "flexivel",
    cadencia,
    metaOcorrencias: Number(r.metaOcorrencias),
    notificarEm: r.notificarEm === "" ? null : comSegundos(r.notificarEm),
    meta,
    congelamento,
  };
}

/**
 * Em que passo mora cada campo do payload.
 *
 * Serve para o erro de validação levar o usuário até o campo errado em vez de
 * aparecer como um toast genérico num passo que não tem nada a ver. O caminho
 * vem de `campos[].campo`, que `validar()` monta com `caminhoDe()`.
 */
export function passoDoCampo(caminho: string): number {
  if (caminho.startsWith("nome") || caminho.startsWith("cor")) return 0;
  /*
   * O ponto final importa: `config.metaOcorrencias` **começa com**
   * `config.meta`, e sem ele a meta do período — que é a escolha do passo 4 —
   * mandava o usuário para o passo 2, onde não existe campo com esse nome.
   */
  if (caminho === "config.meta" || caminho.startsWith("config.meta.")) return 1;
  if (caminho.startsWith("config.cadencia.intervalo")) return 2;
  if (caminho.startsWith("config.notificarEm")) return 4;
  if (caminho.startsWith("config.congelamento")) return 5;
  /* Dias, horários, `metaOcorrencias` e o próprio `modo` são a escolha do passo 4. */
  return caminho.startsWith("config") ? 3 : 0;
}


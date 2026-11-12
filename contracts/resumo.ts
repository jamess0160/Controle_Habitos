import type { ConfigHabito, Meta } from "./habito";

/**
 * A regra do hábito em linguagem natural.
 *
 * `habito.resumo` trafega no payload justamente para a frase não ser remontada
 * em cada tela — mas o formulário precisa dela **antes** de salvar, quando não
 * existe resposta do servidor para ler. Esta é a única implementação: o
 * formulário a usa na prévia e a etapa 3.2 a usa para preencher `habito.resumo`.
 * Escrever uma segunda cópia no cliente era o caminho curto, e ela divergiria da
 * do servidor no primeiro ajuste de texto.
 *
 * Mora em `contracts/` e não em `dominio/` porque a frase depende de
 * `meta.unidade`, que é campo de contrato: o domínio não precisa da unidade para
 * avaliar nada, então `dominio/meta.ts` não a carrega.
 *
 * Os testes travam a função contra as sete fixtures — cujos `resumo` foram
 * escritos à mão antes de ela existir, e por isso servem de referência.
 */

/** 1 = domingo, como no banco e no domínio. */
const DIA_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

/** `"08:00:00"` → `"08:00"`. O contrato sempre manda os segundos; a tela nunca. */
export function horaCurta(horario: string): string {
  return horario.slice(0, 5);
}

/** `["a", "b", "c"]` → `"a, b e c"`. */
function lista(partes: readonly string[]): string {
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function plural(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

/**
 * A parte da meta, ou `null` quando ela não acrescenta nada.
 *
 * No tipo `binario` não há o que dizer — "3x por semana" já é a regra inteira, e
 * um ", 1 vez" colado no fim só faria ruído.
 */
function fraseDeMeta(meta: Meta): string | null {
  switch (meta.tipo) {
    case "binario":
      return null;
    case "quantificado":
      return `${meta.valor} ${meta.unidade}`;
    case "duracao":
      return `${meta.minutos} min`;
    case "negativo":
      return meta.tolerancia === 0
        ? "sem recaídas"
        : `até ${meta.tolerancia} ${plural(meta.tolerancia, "recaída", "recaídas")}`;
  }
}

function horariosEm(horarios: readonly string[] | undefined): string {
  if (horarios === undefined || horarios.length === 0) return "";
  return ` às ${lista(horarios.map(horaCurta))}`;
}

type ConfigFlexivel = Extract<ConfigHabito, { modo: "flexivel" }>;
type ConfigFixo = Extract<ConfigHabito, { modo: "fixo" }>;

/**
 * Modo flexível: quantas vezes dentro do período.
 *
 * Meta 1 ganha frase própria ("Todo dia", "Por semana") porque "1x por semana"
 * soa como contagem quando não há contagem nenhuma a fazer.
 */
function regraFlexivel(config: ConfigFlexivel): string {
  const n = config.metaOcorrencias;
  const vezes = `${n}x`;

  switch (config.cadencia.tipo) {
    case "diario":
      return n === 1 ? "Todo dia" : `${vezes} por dia`;
    case "semanal":
      return n === 1 ? "Por semana" : `${vezes} por semana`;
    case "mensal":
      return n === 1 ? "Por mês" : `${vezes} por mês`;
    case "cada_n_dias": {
      const janela = `a cada ${config.cadencia.intervalo} dias`;
      return n === 1 ? maiuscula(janela) : `${vezes} ${janela}`;
    }
  }
}

/** Modo fixo: em quais dias e horários. */
function regraFixa(config: ConfigFixo): string {
  const { cadencia } = config;

  switch (cadencia.tipo) {
    case "diario":
      return `Todo dia${horariosEm(cadencia.horarios)}`;
    case "semanal": {
      const dias = [...cadencia.diasSemana].sort((a, b) => a - b);
      /* Os sete dias são "todo dia", não a enumeração dom…sáb. */
      const quando =
        dias.length === 7 ? "Todo dia" : maiuscula(lista(dias.map((d) => DIA_CURTO[d - 1])));
      return `${quando}${horariosEm(cadencia.horarios)}`;
    }
    case "mensal": {
      const dias = [...cadencia.diasMes].sort((a, b) => a - b);
      const quando = `${plural(dias.length, "Dia", "Dias")} ${lista(dias.map(String))} do mês`;
      return `${quando}${horariosEm(cadencia.horarios)}`;
    }
  }
}

export function resumoDeConfig(config: ConfigHabito): string {
  const regra = config.modo === "fixo" ? regraFixa(config) : regraFlexivel(config);
  const meta = fraseDeMeta(config.meta);

  return meta === null ? regra : `${regra}, ${meta}`;
}

/**
 * O congelamento explicado, **com o automatismo**.
 *
 * A frase é exigência do [Mapa de telas](../Docs/mapas/Mapa%20de%20telas.md): o
 * usuário precisa saber que o congelamento é gasto sozinho ao fechar um período
 * perdido. Sem isso ele espera uma decisão que nunca vai lhe ser oferecida — não
 * existe estado `em_risco` nem prazo de resgate.
 */
export function textoDeCongelamento(congelamento: { aCada: number; max: number } | null): string {
  if (congelamento === null) {
    return "Sem congelamento: perder um período zera a sequência.";
  }

  const { aCada, max } = congelamento;
  const intervalo =
    aCada === 1 ? "cada interação no prazo" : `cada ${aCada} interações no prazo`;

  return (
    `A ${intervalo} você ganha 1 congelamento, até ${max} ${plural(max, "guardado", "guardados")}; ` +
    "se você perder um período, um congelamento é usado automaticamente para manter a sequência."
  );
}

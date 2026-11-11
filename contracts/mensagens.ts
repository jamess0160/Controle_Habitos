import * as z from "zod";

/**
 * Mensagens de validação em pt-BR.
 *
 * O Zod v4 traz um locale `pt`, mas é português de Portugal: "Demasiado pequeno:
 * esperava que o texto tivesse >= 3 caracteres". Num app em pt-BR isso aparece
 * direto no formulário, então as mensagens são escritas aqui.
 *
 * O mapa é passado por chamada em `validar()`, não via `z.config()` global: a
 * configuração global depende de um import com efeito colateral ter rodado
 * antes, e num route handler do Next não há garantia de ordem.
 */

const ORIGENS: Record<string, string> = {
  string: "o texto",
  number: "o número",
  array: "a lista",
  set: "o conjunto",
  date: "a data",
  bigint: "o número",
};

const TIPOS: Record<string, string> = {
  string: "texto",
  number: "número",
  boolean: "sim/não",
  array: "lista",
  object: "objeto",
  date: "data",
  null: "nulo",
};

function tipoLegivel(valor: string): string {
  return TIPOS[valor] ?? valor;
}

function origemLegivel(valor: string | undefined): string {
  return ORIGENS[valor ?? ""] ?? "o valor";
}

function recebido(input: unknown): string {
  if (input === undefined) return "nada foi enviado";
  if (input === null) return "veio nulo";
  if (Array.isArray(input)) return "veio uma lista";
  return `veio ${tipoLegivel(typeof input)}`;
}

function unidade(origem: string | undefined, quantidade: number): string {
  const plural = quantidade === 1 ? "" : "s";
  switch (origem) {
    case "string":
      return `caractere${plural}`;
    case "array":
    case "set":
      return `item${plural === "s" ? "ns" : ""}`;
    default:
      return "";
  }
}

const FORMATOS: Record<string, string> = {
  email: "não é um e-mail válido",
  url: "não é uma URL válida",
  uuid: "não é um identificador válido",
  date: "não é uma data no formato AAAA-MM-DD",
  datetime: "não é um instante no formato ISO 8601",
  regex: "está fora do formato esperado",
  base64: "não é base64 válido",
  base64url: "não é base64url válido",
};

export const mensagensPtBr: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case "invalid_type":
      return `Esperava ${tipoLegivel(String(issue.expected))}, mas ${recebido(issue.input)}.`;

    case "too_small": {
      const minimo = Number(issue.minimum);
      const u = unidade(issue.origin, minimo);
      if (issue.origin === "number") {
        return issue.inclusive
          ? `Precisa ser pelo menos ${minimo}.`
          : `Precisa ser maior que ${minimo}.`;
      }
      return minimo === 1 && (issue.origin === "array" || issue.origin === "set")
        ? "Informe pelo menos um item."
        : `${capitalizar(origemLegivel(issue.origin))} precisa ter ao menos ${minimo} ${u}.`;
    }

    case "too_big": {
      const maximo = Number(issue.maximum);
      const u = unidade(issue.origin, maximo);
      if (issue.origin === "number") {
        return issue.inclusive
          ? `Precisa ser no máximo ${maximo}.`
          : `Precisa ser menor que ${maximo}.`;
      }
      return `${capitalizar(origemLegivel(issue.origin))} aceita no máximo ${maximo} ${u}.`;
    }

    case "invalid_format":
      return `Valor ${FORMATOS[issue.format] ?? "está fora do formato esperado"}.`;

    case "not_multiple_of":
      return `Precisa ser múltiplo de ${issue.divisor}.`;

    case "invalid_value": {
      const valores = issue.values.map((v) => JSON.stringify(v));
      return valores.length === 1
        ? `O único valor aceito é ${valores[0]}.`
        : `Valor fora das opções aceitas: ${valores.join(", ")}.`;
    }

    case "unrecognized_keys":
      return issue.keys.length === 1
        ? `O campo "${issue.keys[0]}" não existe nesta configuração.`
        : `Campos que não existem nesta configuração: ${issue.keys.join(", ")}.`;

    case "invalid_union":
      // Acontece quando a combinação não casa com nenhuma variante — tipicamente
      // cadência e modo incompatíveis. A mensagem genérica do Zod não ajudaria.
      return "Essa combinação de configuração não é válida.";

    case "invalid_key":
    case "invalid_element":
      return "Valor inválido.";

    default:
      return undefined; // deixa a mensagem do próprio refinamento passar
  }
};

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

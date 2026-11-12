/**
 * Contratos da API.
 *
 * Fonte única: cada schema é escrito uma vez e o tipo sai dele por inferência,
 * então não existe a possibilidade de o tipo e a validação divergirem. Roda no
 * servidor e no cliente, o que deixa o formulário usar a validação real em vez
 * de uma cópia à mão.
 *
 * Convenção: schema em `camelCase` (`criarHabito`), tipo inferido em
 * `PascalCase` (`CriarHabito`), listas de valores em `MAIÚSCULA` (`TIPO_HABITO`).
 */

export * from "./comum";
export * from "./erro";
export * from "./mensagens";

export * from "./auth";
export * from "./habito";
export * from "./hoje";
export * from "./infra";
export * from "./registro";
export * from "./resumo";

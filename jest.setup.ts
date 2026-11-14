import { urlDeTeste } from "./db/teste";

/**
 * Aponta o Knex para o banco de teste **antes** de qualquer módulo ser
 * importado.
 *
 * `knexfile.ts` lê `process.env.DATABASE_URL` no topo do módulo, então trocar a
 * variável depois do primeiro import não teria efeito nenhum — a pool já estaria
 * apontada para o banco de desenvolvimento, e a suíte apagaria os dados de
 * trabalho a cada `limpar()`. `setupFiles` roda antes dos módulos do teste, que
 * é exatamente a janela necessária.
 *
 * `APP_MODO` também é fixado aqui: o `next/jest` carrega o `.env`, onde a chave
 * vale `desenvolvimento`, e sem o pino a suíte testaria o ambiente da máquina de
 * quem roda. Cada teste que quer o modo frouxo o liga explicitamente.
 */
process.env.DATABASE_URL = urlDeTeste();
process.env.APP_MODO = "producao";

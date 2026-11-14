import { randomInt } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

/**
 * A senha: hash, conferência e geração da provisória.
 *
 * Sem dependência do Next de propósito — o seed do Knex e a CLI de reset
 * importam este módulo, e os dois rodam fora do servidor.
 */

/** Parâmetros Argon2id alinhados à recomendação da OWASP (m=19 MiB, t=2, p=1). */
export const PARAMETROS_ARGON2 = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function gerarHash(senha: string): Promise<string> {
  return hash(senha, PARAMETROS_ARGON2);
}

/**
 * Confere a senha contra o hash armazenado.
 *
 * O `catch` devolve `false` em vez de propagar: `verify` lança quando o hash
 * está corrompido ou em formato desconhecido, e um 500 ali contaria ao atacante
 * algo sobre o estado do banco. Hash ilegível é senha que não serve — o caminho
 * de volta é a CLI de reset.
 */
export async function conferirSenha(hashArmazenado: string, senha: string): Promise<boolean> {
  try {
    return await verify(hashArmazenado, senha, PARAMETROS_ARGON2);
  } catch {
    return false;
  }
}

/**
 * Alfabeto sem os pares que se confundem ao ler em voz alta ou copiar de um
 * terminal: sem `O`/`0`, `I`/`l`/`1`, `S`/`5`. A senha provisória é lida de uma
 * tela e digitada em outra — é o único momento do app em que isso acontece.
 */
const ALFABETO = "ABCDEFGHJKMNPQRTUVWXYZ2346789";

/**
 * Senha provisória aleatória, em quatro grupos de quatro.
 *
 * `randomInt` e não `Math.random`: é credencial, ainda que de vida curta. Gerada
 * aqui e nunca aceita por argumento, para não ficar no histórico do shell de
 * quem roda a CLI.
 */
export function senhaProvisoria(): string {
  const grupos = Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => ALFABETO[randomInt(ALFABETO.length)]).join(""),
  );

  return grupos.join("-");
}

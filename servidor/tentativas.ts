import type { Knex } from "knex";
import { db } from "@/db/knex";

/**
 * Rate limiting da senha, conforme o
 * [Mapa de autenticação](../Docs/mapas/Mapa%20de%20autenticação.md).
 *
 * A janela em que a senha está ativa é curta, mas é a única em que força bruta
 * faz sentido — e o app fica exposto na internet pelo túnel.
 *
 * - **atraso progressivo** por falha do mesmo IP: 0s, 1s, 2s, 4s, 8s;
 * - **bloqueio de 15 minutos** depois de 5 falhas em 15 minutos, por IP.
 *
 * A contagem vive em `tentativa_login`, uma **tabela**, não memória: o contador
 * tem de sobreviver ao restart do contêiner, senão basta derrubar o processo
 * para zerar o bloqueio. Num app que reinicia a cada deploy, um contador em
 * memória seria quase decorativo.
 */

export const JANELA_EM_MINUTOS = 15;
export const FALHAS_PARA_BLOQUEAR = 5;
export const BLOQUEIO_EM_MINUTOS = 15;

/** 0s, 1s, 2s, 4s, 8s — e 8s para qualquer coisa além disso. */
export const ATRASOS_EM_MS = [0, 1_000, 2_000, 4_000, 8_000] as const;

function inicioDaJanela(): Date {
  return new Date(Date.now() - JANELA_EM_MINUTOS * 60_000);
}

/**
 * As falhas recentes daquele IP, da mais nova para a mais antiga.
 *
 * Só falhas: um acerto no meio não zera a contagem de propósito. Zerar daria ao
 * atacante uma forma de limpar o histórico — e num app de usuário único, um
 * acerto legítimo seguido de falhas é o padrão de quem errou a digitação, que o
 * atraso progressivo já atende sem precisar de perdão.
 */
async function falhasRecentes(ip: string): Promise<Date[]> {
  const linhas = await db("tentativa_login")
    .where({ ip, sucesso: false })
    .where("criada_em", ">=", inicioDaJanela())
    .orderBy("criada_em", "desc")
    .select("criada_em");

  return linhas.map((l) => l.criada_em);
}

export type Bloqueio = {
  /** `null` quando não há bloqueio em curso. */
  bloqueadoAte: Date | null;
  /** Quanto esperar antes de responder a **esta** tentativa, se ela falhar. */
  atrasoEmMs: number;
};

/**
 * O estado de bloqueio de um IP.
 *
 * `bloqueadoAte` sai da **última** falha, não da primeira: cinco falhas e mais
 * uma tentativa estendem o bloqueio, o que é o comportamento desejado contra
 * quem insiste. Como a janela de contagem é igual à do bloqueio, isso não prende
 * ninguém para sempre — quinze minutos de silêncio limpam tudo.
 */
export async function estadoDeBloqueio(ip: string): Promise<Bloqueio> {
  const falhas = await falhasRecentes(ip);

  const atrasoEmMs = ATRASOS_EM_MS[Math.min(falhas.length, ATRASOS_EM_MS.length - 1)];

  if (falhas.length < FALHAS_PARA_BLOQUEAR) {
    return { bloqueadoAte: null, atrasoEmMs };
  }

  const ultima = falhas[0];
  const fim = new Date(ultima.getTime() + BLOQUEIO_EM_MINUTOS * 60_000);

  return { bloqueadoAte: fim.getTime() > Date.now() ? fim : null, atrasoEmMs };
}

export async function registrarTentativa(ip: string, sucesso: boolean): Promise<void> {
  await db("tentativa_login").insert({ ip, sucesso });
}

/**
 * Espera o atraso progressivo.
 *
 * Função própria para o teste poder não esperar: oito segundos de `setTimeout`
 * dentro de um caso tornariam a suíte insuportável, e o que importa provar é que
 * o atraso **calculado** cresce — a espera em si é uma linha sem lógica.
 */
export async function esperar(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Usada pelo reset: um bloqueio herdado não pode trancar a senha nova.
 *
 * Recebe a conexão para a CLI poder rodar isto na **mesma** transação em que
 * apaga as passkeys e grava a senha provisória — um reset parcial deixaria o app
 * sem porta nenhuma.
 */
export async function limparTentativas(conexao: Knex = db): Promise<void> {
  await conexao("tentativa_login").delete();
}

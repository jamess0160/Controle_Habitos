import "dotenv/config";
import { db } from "@/db/knex";
import { tique } from "./tique";

/**
 * O worker: um processo separado que bate a cada minuto.
 *
 * Separado do Next **de propósito**, e é a decisão de arquitetura que o
 * [Roadmap](../Docs/Roadmap%20onda%201.md) fixou: o app não está na Vercel, está
 * num contêiner do homelab, então trabalho agendado é um processo que fica de
 * pé — não uma rota que alguém precisa acordar com um cron externo. Uma rota
 * `/api/cron` seria uma porta a mais no app, protegida por um segredo a mais,
 * fazendo o que um `setInterval` faz de graça aqui dentro.
 *
 * O minuto é a granularidade dos lembretes: eles têm hora e minuto, e um tique
 * mais lento os atrasaria pelo mesmo tanto.
 *
 * ## Por que não `setInterval`
 *
 * Um tique que demore mais que o intervalo faria o `setInterval` enfileirar o
 * próximo imediatamente, e dois tiques concorrentes disputariam a mesma reserva
 * de notificação. Aqui o próximo é agendado **depois** que o anterior termina, e
 * o alvo é o começo do minuto seguinte — assim o lembrete das 08:00 não vai
 * chegando às 08:00:37, 08:01:14, 08:02:03 conforme o processo envelhece.
 */

const MINUTO = 60_000;

let rodando = true;

async function laco(): Promise<void> {
  while (rodando) {
    const comecou = Date.now();

    try {
      const relatorio = await tique();
      relatar(relatorio);
    } catch (erro) {
      /* `tique` já captura por etapa; aqui só sobra falha de conexão. */
      console.error("[worker] tique falhou inteiro:", erro);
    }

    const proximo = MINUTO - ((Date.now() - comecou) % MINUTO);
    await dormir(Math.max(1000, proximo));
  }
}

function relatar(relatorio: Awaited<ReturnType<typeof tique>>): void {
  const { materializados, notificacoes, limpezas, erros } = relatorio;

  /*
   * Silêncio quando não houve nada: o processo roda 1440 vezes por dia, e um log
   * por tique enterraria as linhas que importam. O que aparece é evento.
   */
  const houve =
    materializados > 0 ||
    notificacoes.novas > 0 ||
    limpezas.tentativas > 0 ||
    limpezas.desafios > 0 ||
    erros.length > 0;

  if (!houve) return;

  console.log(
    `[worker] ${relatorio.instante} · períodos: ${materializados} · ` +
      `notificações: ${notificacoes.novas} novas, ${notificacoes.enviadas} enviadas, ` +
      `${notificacoes.baixadas} baixadas, ${notificacoes.falhas} falhas · ` +
      `limpeza: ${limpezas.tentativas} tentativas, ${limpezas.desafios} desafios`,
  );

  for (const erro of erros) console.error(`[worker]   erro em ${erro}`);
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Encerra terminando o tique em curso.
 *
 * Matar no meio de uma materialização deixaria o hábito com os períodos
 * apagados e não reescritos — a transação protege o banco, mas o processo tem de
 * dar a ela a chance de terminar.
 */
async function encerrar(sinal: string): Promise<void> {
  console.log(`[worker] ${sinal}: encerrando depois deste tique.`);
  rodando = false;
}

process.on("SIGTERM", () => void encerrar("SIGTERM"));
process.on("SIGINT", () => void encerrar("SIGINT"));

console.log("[worker] de pé, tique de 1 minuto.");

laco()
  .catch((erro) => {
    console.error("[worker] laço interrompido:", erro);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());

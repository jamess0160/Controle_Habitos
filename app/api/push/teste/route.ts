import type { Ok } from "@/contracts";
import { exigirAcesso, falha, json } from "@/servidor/http";
import { SemVapid, enviarPush } from "@/servidor/push";

/**
 * POST /api/push/teste
 *
 * Existe para a etapa 4: push só se prova no celular, com a PWA instalada e
 * fechada, e sem um disparo sob demanda o teste manual dependeria de esperar o
 * horário de um lembrete real.
 *
 * Passa pelo **mesmo** `enviarPush` do worker, incluindo a baixa em 404/410: um
 * teste que funcionasse por um caminho próprio não provaria nada sobre o caminho
 * que entrega os lembretes.
 */
export async function POST() {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  try {
    const envio = await enviarPush({
      titulo: "Controle de Hábitos",
      corpo: "Teste de notificação — se chegou, o push está funcionando.",
      url: "/ajustes",
      tag: "teste",
    });

    /*
     * As três razões de não entregar são distinguidas porque a ação do usuário é
     * diferente em cada uma: assinar, reassinar, ou simplesmente tentar de novo.
     * Uma mensagem só mandaria reassinar quem só tinha a rede instável.
     */
    if (envio.enviadas === 0) {
      if (envio.baixadas > 0) {
        return falha(
          "regra_violada",
          "A assinatura deste aparelho foi recusada pelo serviço de push. Assine de novo.",
        );
      }

      if (envio.falhas > 0) {
        return falha(
          "regra_violada",
          "O serviço de push não aceitou o envio agora. A assinatura continua válida — tente de novo.",
        );
      }

      return falha("regra_violada", "Nenhuma assinatura ativa para receber o teste.");
    }

    const ok: Ok = { ok: true };
    return json(ok);
  } catch (erro) {
    if (erro instanceof SemVapid) {
      return falha("regra_violada", erro.message);
    }
    throw erro;
  }
}

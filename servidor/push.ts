import webpush from "web-push";
import type { AssinarPush, StatusPush } from "@/contracts";
import { db } from "@/db/knex";
import { lerConfig, type Config } from "./config";

/*
 * `web-push` fica preso no 3.x de propósito.
 *
 * O 4.0 é uma reescrita só-ESM que **não publica tipos**, enquanto
 * `@types/web-push` descreve a API do 3.x — com default export. As duas coisas
 * juntas compilam e quebram em execução: `webpush.generateVAPIDKeys` vira
 * `undefined` porque o default export não existe mais. O 4.0 não traz nada que
 * este app precise, e tipos escritos à mão para um pacote de criptografia de
 * terceiros são a mesma armadilha, só que de dentro.
 */
const { WebPushError } = webpush;

/**
 * Web Push: guardar a assinatura, enviar, e dar baixa quando o endpoint morre.
 *
 * O envio é do **worker**, não das rotas — quem notifica é um processo que roda
 * a cada minuto, e uma rota só existe para o disparo de teste. Mas o código vive
 * aqui, e não em `worker/`, porque a rota de teste e o worker têm de enviar pelo
 * mesmo caminho: um push de teste que funciona por um código diferente do real
 * não testa nada.
 *
 * ## A trava das chaves
 *
 * O par VAPID é a identidade do remetente. O navegador assina **para** uma chave
 * pública específica, e o serviço de push recusa um envio assinado por outra —
 * trocar o par invalida toda assinatura existente, em silêncio, do ponto de
 * vista do usuário. Por isso o par é lido de `config_app` (gravado uma vez pelo
 * seed, com `ON CONFLICT DO NOTHING`) e não do ambiente a cada envio: o `.env`
 * muda junto com o deploy, e a assinatura gravada no celular não.
 */

/** Uma notificação pronta para virar push. */
export type Notificacao = {
  titulo: string;
  corpo: string;
  /** Para onde o toque na notificação leva. */
  url: string;
  /**
   * Agrupador no sistema operacional: uma notificação com a mesma `tag`
   * substitui a anterior em vez de empilhar. Sem isso, um dia sem abrir o app
   * rende uma torre de lembretes do mesmo hábito.
   */
  tag: string;
};

export type ResultadoDeEnvio = {
  enviadas: number;
  /** Assinaturas que o serviço de push declarou mortas (404/410). */
  baixadas: number;
  /** Falhas de outra natureza — rede, 5xx — que valem nova tentativa. */
  falhas: number;
};

/**
 * As credenciais do remetente, ou `null` quando o par ainda não foi gerado.
 *
 * `vapid_subject` vazio cai em `https://<rp_id>`: o padrão exige um contato, e o
 * domínio do próprio app é a resposta certa num app de um usuário só — não há
 * endereço de suporte a oferecer, e pôr o e-mail do dono ali o entregaria a
 * todos os serviços de push a cada envio.
 */
export function credenciaisDe(config: Config): webpush.VapidKeys & { subject: string } {
  const publicKey = config.vapid_public_key;
  const privateKey = config.vapid_private_key;

  if (publicKey === null || privateKey === null) {
    throw new SemVapid();
  }

  const subject =
    config.vapid_subject?.trim() ||
    `https://${config.rp_id ?? "localhost"}`;

  return { publicKey, privateKey, subject };
}

/** O par VAPID ainda não existe — é condição esperada, não defeito. */
export class SemVapid extends Error {
  constructor() {
    super("As chaves VAPID ainda não foram geradas (npm run push:chaves).");
  }
}

// ─── Assinatura ──────────────────────────────────────────────────────────────

export async function assinarPushNoBanco(assinatura: AssinarPush): Promise<StatusPush> {
  /*
   * `merge` e não `ignore`: reassinar com o mesmo endpoint acontece sempre que o
   * navegador renova as chaves por conta própria, e a linha antiga ficaria com
   * um `p256dh` que não decifra mais nada. Reassinar também **ressuscita** a
   * assinatura — `invalida_em` volta a nulo —, que é exatamente o que o usuário
   * quis dizer ao tocar em "Assinar" depois de uma baixa.
   */
  await db("push_subscription")
    .insert({
      endpoint: assinatura.endpoint,
      p256dh: assinatura.chaves.p256dh,
      auth: assinatura.chaves.auth,
    })
    .onConflict("endpoint")
    .merge(["p256dh", "auth", "invalida_em"]);

  return statusDePush();
}

/**
 * Remove **todas** as assinaturas.
 *
 * Sem distinguir dispositivo de propósito: o app é de um usuário com um
 * aparelho — é a mesma premissa do cadastro de biometria, que aceita uma passkey
 * só. Pedir o endpoint no corpo para apagar "este aparelho" daria a impressão de
 * uma gestão de dispositivos que não existe, e deixaria assinaturas órfãs de
 * aparelhos trocados recebendo push para sempre.
 */
export async function desassinarPush(): Promise<StatusPush> {
  await db("push_subscription").delete();
  return statusDePush();
}

export async function statusDePush(): Promise<StatusPush> {
  const config = await lerConfig();

  const assinatura = await db("push_subscription")
    .orderBy("criada_em", "desc")
    .first("ultimo_envio_em", "invalida_em");

  return {
    assinado: assinatura !== undefined && assinatura.invalida_em === null,
    ultimoEnvioEm: assinatura?.ultimo_envio_em?.toISOString() ?? null,
    invalidaEm: assinatura?.invalida_em?.toISOString() ?? null,
    chavePublica: config.vapid_public_key,
  };
}

// ─── Envio ───────────────────────────────────────────────────────────────────

/**
 * Envia para todas as assinaturas vivas.
 *
 * Não lança quando um envio falha: o worker roda a cada minuto e uma exceção aqui
 * derrubaria o tique inteiro — o fechamento de período iria junto, que é a parte
 * que não pode parar. Falha vira contagem no resultado.
 */
export async function enviarPush(notificacao: Notificacao): Promise<ResultadoDeEnvio> {
  const config = await lerConfig();
  const { publicKey, privateKey, subject } = credenciaisDe(config);

  const assinaturas = await db("push_subscription").whereNull("invalida_em").select();

  const resultado: ResultadoDeEnvio = { enviadas: 0, baixadas: 0, falhas: 0 };
  const payload = JSON.stringify(notificacao);

  for (const assinatura of assinaturas) {
    try {
      await webpush.sendNotification(
        {
          endpoint: assinatura.endpoint,
          keys: { p256dh: assinatura.p256dh, auth: assinatura.auth },
        },
        payload,
        { vapidDetails: { subject, publicKey, privateKey } },
      );

      await db("push_subscription")
        .where({ id: assinatura.id })
        .update({ ultimo_envio_em: new Date() });

      resultado.enviadas += 1;
    } catch (erro) {
      if (ehEndpointMorto(erro)) {
        /*
         * 404/410 é o serviço de push dizendo que a inscrição não existe mais —
         * app desinstalado, permissão revogada, navegador limpo. Insistir rende
         * o mesmo erro para sempre.
         *
         * Marcada, não apagada: a tela de Ajustes mostra "invalidada em" e isso
         * é a diferença entre "o push está desligado" e "o push parou de
         * funcionar sem ninguém desligar".
         */
        await db("push_subscription")
          .where({ id: assinatura.id })
          .update({ invalida_em: new Date() });

        resultado.baixadas += 1;
        continue;
      }

      resultado.falhas += 1;
    }
  }

  return resultado;
}

function ehEndpointMorto(erro: unknown): boolean {
  return erro instanceof WebPushError && (erro.statusCode === 404 || erro.statusCode === 410);
}

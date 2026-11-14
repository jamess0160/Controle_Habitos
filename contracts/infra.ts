import * as z from "zod";
import { dataLogica, horario, instante } from "./comum";
import { habito } from "./habito";

/**
 * Contratos de infraestrutura: push, preferências e exportação.
 */

/** POST /api/push/assinatura — o que o `PushSubscription` do navegador entrega. */
export const assinarPush = z.strictObject({
  endpoint: z.url(),
  chaves: z.strictObject({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
export type AssinarPush = z.infer<typeof assinarPush>;

export const statusPush = z.object({
  assinado: z.boolean(),
  /** Última vez que o endpoint aceitou um envio. */
  ultimoEnvioEm: instante.nullable(),
  /** Marcado quando o endpoint responde 404/410 e a assinatura é baixada. */
  invalidaEm: instante.nullable(),
  /**
   * A chave pública VAPID, que o navegador precisa para montar a assinatura.
   *
   * Acréscimo da etapa 3.5: sem ela a tela não tem o que passar a
   * `pushManager.subscribe()`, e o botão "Assinar" ficava desabilitado. Vem no
   * payload em vez de um `NEXT_PUBLIC_*` pelo mesmo motivo de
   * `estadoAuth.modoDesenvolvimento`: o valor que vale é o gravado no banco, e
   * uma segunda fonte no bundle divergiria do par que assina de verdade.
   *
   * Pública no sentido literal — ela é enviada ao serviço de push por qualquer
   * cliente que assine. `nula` enquanto o par não foi gerado.
   */
  chavePublica: z.string().nullable(),
});
export type StatusPush = z.infer<typeof statusPush>;

/**
 * GET /api/config — o que a tela de Ajustes mostra.
 *
 * `usuarioNome` e `rpId` são somente leitura: o nome vem do `.env` via
 * `config_app`, e o `rpId` é o domínio das passkeys — trocá-lo invalida a
 * biometria cadastrada, então não existe campo de edição para ele.
 */
export const configApp = z.object({
  usuarioNome: z.string(),
  horaVirada: horario,
  timezone: z.string(),
  rpId: z.string(),
  push: statusPush,
  passkey: z
    .object({
      apelido: z.string().nullable(),
      criadaEm: instante,
      ultimoUsoEm: instante.nullable(),
    })
    .nullable(),
});
export type ConfigApp = z.infer<typeof configApp>;

/** PATCH /api/config — só o que é seguro mudar sem reinstalar a biometria. */
export const editarConfig = z.strictObject({
  horaVirada: horario.optional(),
  timezone: z.string().min(1).optional(),
});
export type EditarConfig = z.infer<typeof editarConfig>;

/**
 * GET /api/exportar — histórico completo em JSON.
 *
 * Única cópia dos dados fora do Postgres do homelab enquanto não houver backup
 * automatizado verificado (etapa 5), então o formato é propositalmente cru: os
 * hábitos com a configuração vigente e todos os registros, sem derivados. O que
 * é derivado o domínio reconstrói a partir dos registros — e um backup que
 * guarda o derivado envelhece junto com as regras.
 */
export const exportacao = z.object({
  geradoEm: instante,
  versao: z.literal(1),
  habitos: z.array(habito),
  registros: z.array(
    z.object({
      habitoId: z.uuid(),
      dataLogica,
      valor: z.number(),
      origem: z.enum(["app", "retroativo", "cronometro"]),
      criadoEm: instante,
    }),
  ),
});
export type Exportacao = z.infer<typeof exportacao>;

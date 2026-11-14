import { editarConfig, type ConfigApp } from "@/contracts";
import { gravarConfig, lerConfig } from "@/servidor/config";
import { corpo, exigirAcesso, falha, json } from "@/servidor/http";
import { statusDePush } from "@/servidor/push";
import { passkeyAtual } from "@/servidor/webauthn";

/**
 * GET e PATCH /api/config — a tela de Ajustes.
 *
 * Deixou de ser stub na etapa 3.5 junto do push: o botão "Assinar" precisa da
 * chave pública VAPID, que vem em `push.chavePublica`, e uma fixture ali deixaria
 * o navegador tentando assinar para uma chave que ninguém tem.
 */
export async function GET() {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  return json(await montarConfig());
}

/**
 * PATCH /api/config
 *
 * Só `horaVirada` e `timezone`. `usuarioNome` vem do `.env` pelo seed, e `rpId`
 * é o domínio das passkeys — editá-lo invalidaria a biometria cadastrada, então
 * não existe campo para ele nem aqui nem na tela.
 */
export async function PATCH(req: Request) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const r = await corpo(req, editarConfig);
  if (!r.ok) return json(r.resposta, r.status);

  if (r.dados.timezone !== undefined && !fusoConhecido(r.dados.timezone)) {
    return falha("validacao", `Fuso horário desconhecido: ${r.dados.timezone}.`);
  }

  await gravarConfig({
    /*
     * Gravada como `HH:MM`, que é como `hora_virada` sempre esteve no banco e o
     * que `horaDe()` lê. O contrato trafega `HH:MM:00` porque o tipo `horario` é
     * um só para toda a API, e os horários de hábito têm segundos.
     */
    ...(r.dados.horaVirada === undefined
      ? {}
      : { hora_virada: r.dados.horaVirada.slice(0, 5) }),
    ...(r.dados.timezone === undefined ? {} : { timezone: r.dados.timezone }),
  });

  return json(await montarConfig());
}

async function montarConfig(): Promise<ConfigApp> {
  const config = await lerConfig();
  const passkey = await passkeyAtual();

  return {
    usuarioNome: config.usuario_nome ?? "você",
    horaVirada: comSegundos(config.hora_virada ?? "04:00"),
    timezone: config.timezone ?? "America/Sao_Paulo",
    rpId: config.rp_id ?? "",
    push: await statusDePush(),
    passkey:
      passkey === null
        ? null
        : {
            apelido: passkey.apelido,
            criadaEm: passkey.criadaEm.toISOString(),
            ultimoUsoEm: passkey.ultimoUsoEm?.toISOString() ?? null,
          },
  };
}

/** `04:00` → `04:00:00`; já com segundos, passa direto. */
function comSegundos(hora: string): string {
  return hora.length === 5 ? `${hora}:00` : hora;
}

/**
 * O fuso existe neste runtime?
 *
 * Conferido aqui porque um fuso inválido só falharia muito depois, dentro do
 * `Intl.DateTimeFormat` que calcula o dia lógico — e aí o app inteiro para de
 * responder, não só a tela que salvou o valor errado.
 */
function fusoConhecido(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

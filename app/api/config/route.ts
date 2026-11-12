import { editarConfig, type ConfigApp } from "@/contracts";
import { configAppFixture } from "@/contracts/fixtures";
import { corpo, exigirAcesso, json } from "@/servidor/http";

/** GET /api/config — o que a tela de Ajustes mostra. */
export async function GET() {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  return json(configAppFixture);
}

/**
 * PATCH /api/config
 *
 * Só `horaVirada` e `timezone`. `usuarioNome` vem do `.env` pelo seed, e `rpId`
 * é o domínio das passkeys — editá-lo invalidaria a biometria cadastrada, então
 * não existe campo para ele nem aqui nem na tela.
 *
 * **O stub ecoa o que recebeu**, como `POST /api/registros`: devolvendo a fixture
 * crua, a tela de Ajustes salvava 05:00 e via o campo voltar para 04:00 com um
 * "Salvo." do lado — indistinguível de um bug de verdade. O que não é editável
 * continua vindo da fixture.
 */
export async function PATCH(req: Request) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const r = await corpo(req, editarConfig);
  if (!r.ok) return json(r.resposta, r.status);

  const config: ConfigApp = {
    ...configAppFixture,
    horaVirada: r.dados.horaVirada ?? configAppFixture.horaVirada,
    timezone: r.dados.timezone ?? configAppFixture.timezone,
  };

  return json(config);
}

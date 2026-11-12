import { criarRegistro, type RegistroCriado } from "@/contracts";
import { registroCriadoFixture } from "@/contracts/fixtures";
import { corpo, exigirAcesso, json } from "@/servidor/http";

/**
 * POST /api/registros — a marcação.
 *
 * O cliente não manda `periodoId` nem calcula o dia lógico: `dataLogica`
 * ausente significa "agora", e quem aplica a virada das 04:00 é o servidor. O
 * relógio do celular não é fonte confiável para isso, e deixar o cliente
 * escolher o período erraria justamente a marcação de madrugada.
 *
 * **O stub ecoa a identidade do pedido e mantém os `efeitos` enlatados.** O
 * motivo é o mesmo de `GET /api/auth/estado` não devolver fixture: com `valor`
 * fixo em 700, o incremento de "+250 ml" somaria 700 na tela e o dashboard
 * pareceria quebrado na etapa 2. O que é derivado — sequência, estoque de
 * congelamento, status do período — continua vindo da fixture, porque é
 * justamente o que a etapa 3.3 vai calcular.
 */
export async function POST(req: Request) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const r = await corpo(req, criarRegistro);
  if (!r.ok) return json(r.resposta, r.status);

  const criado: RegistroCriado = {
    ...registroCriadoFixture,
    habitoId: r.dados.habitoId,
    ocorrenciaId: r.dados.ocorrenciaId ?? null,
    /* Sem valor é marcação binária, que vale 1 — a regra do contrato. */
    valor: r.dados.valor ?? 1,
    dataLogica: r.dados.dataLogica ?? registroCriadoFixture.dataLogica,
    origem: r.dados.origem,
  };

  return json(criado, 201);
}

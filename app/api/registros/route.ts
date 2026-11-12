import { criarRegistro } from "@/contracts";
import { registroCriadoFixture } from "@/contracts/fixtures";
import { corpo, exigirAcesso, json } from "@/servidor/http";

/**
 * POST /api/registros — a marcação.
 *
 * O cliente não manda `periodoId` nem calcula o dia lógico: `dataLogica`
 * ausente significa "agora", e quem aplica a virada das 04:00 é o servidor. O
 * relógio do celular não é fonte confiável para isso, e deixar o cliente
 * escolher o período erraria justamente a marcação de madrugada.
 */
export async function POST(req: Request) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const r = await corpo(req, criarRegistro);
  if (!r.ok) return json(r.resposta, r.status);

  return json(registroCriadoFixture, 201);
}

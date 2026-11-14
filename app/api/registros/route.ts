import { criarRegistro } from "@/contracts";
import { corpo, exigirAcesso, falha, json } from "@/servidor/http";
import { criarRegistroNoBanco, mensagemDeFalhaDeRegistro } from "@/servidor/registros";

/**
 * POST /api/registros — a marcação.
 *
 * O cliente não manda `periodoId` nem calcula o dia lógico: `dataLogica` ausente
 * significa "agora", e quem aplica a virada das 04:00 é o servidor. O relógio do
 * celular não é fonte confiável para isso, e deixar o cliente escolher o período
 * erraria justamente a marcação de madrugada.
 *
 * Os `efeitos` da resposta saem da simulação, pela materialização, e é por isso
 * que marcar hoje e preencher retroativamente não têm duas implementações do
 * fechamento — é a mesma conta com uma entrada diferente.
 */
export async function POST(req: Request) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const r = await corpo(req, criarRegistro);
  if (!r.ok) return json(r.resposta, r.status);

  const resultado = await criarRegistroNoBanco(r.dados);

  if (!resultado.ok) {
    const codigo =
      resultado.falha.tipo === "habito_inexistente" ? "nao_encontrado" : "regra_violada";
    return falha(codigo, mensagemDeFalhaDeRegistro(resultado.falha));
  }

  return json(resultado.dados, 201);
}

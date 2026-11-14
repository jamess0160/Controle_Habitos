import { criarHabito } from "@/contracts";
import { corpo, exigirAcesso, json } from "@/servidor/http";
import { criarHabitoNoBanco, listarHabitos } from "@/servidor/habitos";

/** GET /api/habitos — ativos e arquivados, na ordem de `habito.ordem`. */
export async function GET() {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  return json(await listarHabitos());
}

/**
 * POST /api/habitos
 *
 * `criarHabito` recusa toda combinação que os CHECKs de `habito_config`
 * recusariam — modo fixo com `cada_n_dias`, `metaOcorrencias` no modo fixo,
 * quantificado sem unidade. A validação acontece antes de o banco ser tocado, e
 * é a mesma que o formulário de 6 passos roda no cliente: um schema, dois lados.
 *
 * O hábito nasce já materializado, com a versão 1 da configuração e o primeiro
 * período aberto. Criar sem materializar deixaria um hábito que o dashboard não
 * sabe mostrar até a próxima escrita.
 */
export async function POST(req: Request) {
  const acesso = await exigirAcesso();
  if (!acesso.liberado) return acesso.resposta;

  const r = await corpo(req, criarHabito);
  if (!r.ok) return json(r.resposta, r.status);

  return json(await criarHabitoNoBanco(r.dados), 201);
}

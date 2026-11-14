import "dotenv/config";
import { db } from "@/db/knex";
import { definirSenhaProvisoria, estadoDaSenha } from "@/servidor/credencial";
import { limparTentativas } from "@/servidor/tentativas";
import { passkeyAtual } from "@/servidor/webauthn";
import { confirmar, imprimirSenha, registrar, titulo } from "./comum";

/**
 * `npm run cli:reset-senha` — a senha provisória foi perdida antes do uso.
 *
 * O caso previsto no [Mapa de autenticação](../Docs/mapas/Mapa%20de%20autentica%C3%A7%C3%A3o.md):
 * rodou-se o reset de biometria, a senha impressa se perdeu, e sem ela não há
 * como entrar. Gera outra.
 *
 * **Não toca nas passkeys nem nas sessões**, e é a diferença inteira em relação
 * ao `reset-biometria`. Quem perdeu a senha não necessariamente perdeu o
 * aparelho, e derrubar as sessões abertas de quem só precisava de uma senha nova
 * transformaria um aperto pequeno num grande.
 *
 * ## O aviso quando existe passkey
 *
 * Em produção a senha é desativada no cadastro da biometria, e é isso que faz o
 * app ter **uma** porta. Reativá-la com a passkey funcionando abre a segunda —
 * legítimo como recuperação, mas não é o que se quer por engano, e é um estado
 * que permanece até o próximo cadastro de biometria desativar a senha de novo.
 * Por isso a confirmação muda de palavra nesse caso: ela não pode ser a mesma
 * que se digita no caminho rotineiro.
 */
async function main(): Promise<void> {
  titulo("Nova senha provisória");

  const passkey = await passkeyAtual();
  const senha = await estadoDaSenha();

  console.log(`Passkey cadastrada : ${passkey === null ? "nenhuma" : (passkey.apelido ?? "sem apelido")}`);
  console.log(`Senha              : ${senha.existe ? (senha.ativa ? "ativa" : "desativada") : "inexistente"}`);

  const temPasskey = passkey !== null;

  const aviso = temPasskey
    ? "\nATENÇÃO: existe passkey cadastrada e funcionando. Gerar uma senha agora\n" +
      "a reativa, deixando DUAS portas abertas até o próximo cadastro de\n" +
      "biometria desativá-la. Se o objetivo é trocar de aparelho, o caminho é o\n" +
      "reset pela tela de Ajustes, com sessão válida."
    : "\nIsto gera uma senha provisória nova e invalida a anterior.\n" +
      "As passkeys e as sessões abertas não são afetadas.";

  const confirmado = await confirmar(aviso, temPasskey ? "REATIVAR" : "GERAR");

  if (!confirmado) {
    registrar("reset de senha cancelado");
    return;
  }

  const provisoria = await db.transaction(async (trx) => {
    const nova = await definirSenhaProvisoria(trx);
    /* Mesmo motivo do outro reset: bloqueio herdado não tranca a senha nova. */
    await limparTentativas(trx);
    return nova;
  });

  registrar(
    `senha provisória regerada${temPasskey ? " (senha reativada com passkey presente)" : ""}`,
  );

  imprimirSenha(provisoria);
}

main()
  .catch((erro) => {
    console.error("\nA troca FALHOU e nada foi alterado:", erro);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());

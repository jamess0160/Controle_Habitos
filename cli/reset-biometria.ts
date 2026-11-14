import "dotenv/config";
import { db } from "@/db/knex";
import { definirSenhaProvisoria, estadoDaSenha } from "@/servidor/credencial";
import { revogarTodasAsSessoes } from "@/servidor/sessao";
import { limparTentativas } from "@/servidor/tentativas";
import { apagarPasskeys, passkeyAtual } from "@/servidor/webauthn";
import { confirmar, imprimirSenha, registrar, titulo } from "./comum";

/**
 * `npm run cli:reset-biometria` — o caminho de volta quando não há sessão.
 *
 * Celular perdido, quebrado ou formatado, ou domínio trocado (o `rp_id` é parte
 * do contrato da passkey, e mudá-lo invalida a biometria). Roda no homelab, com
 * acesso direto ao Postgres, sem passar pelo app — é a razão de ele existir:
 * todo caminho pela web exige a credencial que acabou de se perder.
 *
 * ## Tudo numa transação
 *
 * São quatro escritas, e um reset parcial é pior que nenhum: apagar as passkeys
 * sem gravar a senha nova deixaria o app **sem porta nenhuma**, e a recuperação
 * passaria a exigir SQL à mão. Ou as quatro, ou nada.
 *
 * ## Por que a senha é gerada, não passada por argumento
 *
 * `--senha minhasenha` ficaria no histórico do shell e no `ps` de quem estivesse
 * na máquina. A senha sai aleatória, é impressa uma vez, e some do mundo em
 * texto claro no instante seguinte.
 */
async function main(): Promise<void> {
  titulo("Reset de biometria");

  const passkey = await passkeyAtual();
  const senha = await estadoDaSenha();

  console.log(`Passkey cadastrada : ${passkey === null ? "nenhuma" : (passkey.apelido ?? "sem apelido")}`);
  console.log(`Senha              : ${senha.existe ? (senha.ativa ? "ativa" : "desativada") : "inexistente"}`);

  const confirmado = await confirmar(
    "\nIsto apaga a passkey cadastrada, gera uma senha provisória nova e\n" +
      "derruba todas as sessões abertas. É irreversível.",
    "RESETAR",
  );

  if (!confirmado) {
    registrar("reset de biometria cancelado");
    return;
  }

  const resultado = await db.transaction(async (trx) => {
    const apagadas = await apagarPasskeys(trx);
    const provisoria = await definirSenhaProvisoria(trx);
    const sessoes = await revogarTodasAsSessoes(trx);
    /* Um bloqueio herdado de tentativas não pode trancar a senha nova. */
    await limparTentativas(trx);

    return { apagadas, provisoria, sessoes };
  });

  registrar(
    `reset de biometria concluído: ${resultado.apagadas} passkey(s) apagada(s), ` +
      `${resultado.sessoes} sessão(ões) revogada(s), senha provisória ativa`,
  );

  imprimirSenha(resultado.provisoria);
}

main()
  .catch((erro) => {
    console.error("\nO reset FALHOU e nada foi alterado:", erro);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());

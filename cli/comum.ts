import { createInterface } from "node:readline/promises";

/**
 * O que as CLIs de reset compartilham: confirmação, log e saída.
 *
 * As duas são destrutivas e irreversíveis, rodam no homelab com acesso direto ao
 * Postgres, e são o **único** caminho de volta quando o celular se perde. O que
 * este arquivo garante é que nenhuma delas aconteça por acidente e que toda
 * execução deixe rastro.
 */

/** Marca de tempo legível, no fuso do contêiner. */
function agora(): string {
  return new Date().toISOString();
}

/**
 * Registra a execução.
 *
 * `stdout` **é** o log: num contêiner do compose, é o que `docker logs` guarda
 * com data e hora. Escrever num arquivo à parte dentro do contêiner daria um log
 * que desaparece no próximo `docker compose up`.
 */
export function registrar(mensagem: string): void {
  console.log(`[${agora()}] ${mensagem}`);
}

export function titulo(texto: string): void {
  console.log(`\n${texto}\n${"─".repeat(texto.length)}`);
}

/**
 * Pergunta e exige a palavra exata.
 *
 * Não é `s/n`: digitar `s` por reflexo é fácil, e o preço de errar aqui é a
 * senha da única porta do app sendo trocada sem querer. Exigir a palavra
 * escrita é o que força a leitura da pergunta.
 *
 * Sem terminal interativo a resposta não pode ser lida, e **não** há default:
 * `stdin` fechado devolveria `null`, que um `=== CONFIRMACAO` recusaria em
 * silêncio e faria a CLI parecer quebrada. O caminho para automação é explícito.
 */
export async function confirmar(pergunta: string, palavra: string): Promise<boolean> {
  if (process.argv.includes("--sim")) {
    registrar(`confirmação dispensada por --sim`);
    return true;
  }

  if (!process.stdin.isTTY) {
    console.error(
      "Sem terminal interativo. Rode com `docker compose exec -it` ou passe --sim " +
        "se souber o que está fazendo.",
    );
    return false;
  }

  const leitor = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const resposta = await leitor.question(`${pergunta}\nDigite ${palavra} para confirmar: `);
    return resposta.trim().toUpperCase() === palavra;
  } finally {
    leitor.close();
  }
}

/**
 * A senha provisória, impressa de forma que não se perca na rolagem.
 *
 * É a **única** vez em que ela existe fora de um hash. Perdê-la aqui significa
 * rodar o reset de novo.
 */
export function imprimirSenha(senha: string): void {
  const moldura = "═".repeat(senha.length + 6);

  console.log(`
Senha provisória — anote agora, ela não será mostrada de novo:

  ╔${moldura}╗
  ║   ${senha}   ║
  ╚${moldura}╝

Use-a no próximo acesso pela web. O app vai pedir o cadastro da biometria em
seguida, e é esse cadastro que desativa a senha outra vez.
`);
}

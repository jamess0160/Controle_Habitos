/**
 * A unidade do hábito `duracao`: **segundos inteiros**.
 *
 * Era minutos inteiros, e isso impedia a meta mais curta que existe — "respirar
 * 30 s", "prancha de 45 s" não eram configuráveis. A saída óbvia seria aceitar
 * minuto fracionário, e ela está errada por um motivo aritmético: a meta é
 * cumprida por **soma de registros**, e 20 s viraria `0.3333…` min, de modo que
 * três sessões de 20 s somariam `0.99999…` e o período de 1 min fecharia
 * perdido. Com segundo inteiro a soma é exata e a pergunta "alcançou a meta?"
 * não depende de ponto flutuante.
 *
 * Este módulo é o único lugar que sabe decompor e escrever a unidade — o
 * servidor usa pela frase da regra (`resumo.ts`), o cliente pelos campos e
 * pelos rótulos. Duas decomposições em arquivos diferentes divergiriam no
 * arredondamento, que é exatamente onde um erro de unidade passa despercebido.
 */

/** Em horas, minutos e segundos. Só para exibir ou preencher campos. */
export function partirDuracao(segundos: number): {
  horas: number;
  minutos: number;
  segundos: number;
} {
  const total = Math.max(0, Math.floor(segundos));

  return {
    horas: Math.floor(total / 3600),
    minutos: Math.floor((total % 3600) / 60),
    segundos: total % 60,
  };
}

/**
 * A duração em prosa, como entra na frase da regra: `"30 s"`, `"10 min"`,
 * `"1 min 30 s"`, `"1 h 30 min"`.
 *
 * Partes em zero são omitidas — "0 h 10 min 0 s" é a mesma informação com três
 * vezes o ruído. Zero total ganha `"0 s"` para a função nunca devolver vazio.
 */
export function duracaoEmTexto(segundos: number): string {
  const { horas: h, minutos: m, segundos: s } = partirDuracao(segundos);

  const partes = [
    h > 0 ? `${h} h` : null,
    m > 0 ? `${m} min` : null,
    s > 0 ? `${s} s` : null,
  ].filter((parte): parte is string => parte !== null);

  return partes.length === 0 ? "0 s" : partes.join(" ");
}

/** `mm:ss`, ou `h:mm:ss` passada a hora — a forma de relógio, para o progresso. */
export function duracaoEmRelogio(segundos: number): string {
  const { horas: h, minutos: m, segundos: s } = partirDuracao(segundos);
  const dois = (n: number) => String(n).padStart(2, "0");

  return h > 0 ? `${h}:${dois(m)}:${dois(s)}` : `${dois(m)}:${dois(s)}`;
}

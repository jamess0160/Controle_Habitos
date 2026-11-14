/**
 * A conta de reordenar, separada do arraste.
 *
 * Sem React e sem DOM, porque é a parte onde um erro é invisível: um
 * deslocamento de um índice embaralha a lista do usuário de um jeito que parece
 * intencional. O arraste em si é posição de ponteiro e `getBoundingClientRect`,
 * que teste de unidade não alcança — mas a conta, sim.
 */

/**
 * Move o item de `de` para `para`, deslocando o resto.
 *
 * `splice` duas vezes e não uma troca de posições: trocar faria o item pular por
 * cima dos vizinhos em vez de atravessá-los, o que num arraste de três linhas
 * deixa a lista em outra ordem que a vista.
 *
 * Índice fora da lista devolve a lista intacta em vez de lançar: o `pointermove`
 * dispara dezenas de vezes por segundo, inclusive nas bordas, e um erro ali
 * derrubaria a tela no meio do gesto.
 */
export function mover<T>(lista: readonly T[], de: number, para: number): T[] {
  const copia = [...lista];

  if (de === para) return copia;
  if (de < 0 || de >= copia.length) return copia;
  if (para < 0 || para >= copia.length) return copia;

  const [item] = copia.splice(de, 1);
  copia.splice(para, 0, item);

  return copia;
}

/**
 * Qual índice o ponteiro está sobrevoando, dadas as alturas das linhas.
 *
 * Compara contra o **meio** de cada linha e não contra as bordas: usando a borda,
 * o item trocaria de lugar no instante em que encosta na linha vizinha e voltaria
 * no quadro seguinte, porque a troca move a própria linha sob o dedo. O meio dá
 * a histerese necessária para o gesto ficar estável.
 */
export function indiceSobre(centros: readonly number[], y: number): number {
  for (const [i, centro] of centros.entries()) {
    if (y < centro) return i;
  }
  return Math.max(0, centros.length - 1);
}

/** A ordem final, como `PUT /api/habitos/ordem` a espera. */
export function ordemDe(itens: readonly { id: string }[]): string[] {
  return itens.map((i) => i.id);
}

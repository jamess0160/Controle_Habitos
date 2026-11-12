import type { Cor } from "@/contracts";

/**
 * Nome da cor do hábito → classes do Tailwind.
 *
 * Escrito à mão, e não montado com `` `bg-habito-${cor}` ``, porque o Tailwind v4
 * varre o **código-fonte** procurando nomes de classe: uma classe montada em
 * tempo de execução nunca é encontrada, e o CSS dela simplesmente não existe no
 * bundle. O hábito aparece sem cor e nada acusa o erro.
 *
 * Os seis nomes são o enum `COR` de [contracts/comum.ts](../contracts/comum.ts) e
 * estão gravados em `habito.cor`; os valores vivem em
 * [app/globals.css](../app/globals.css).
 */
export const CLASSE_COR: Record<Cor, { texto: string; fundo: string; borda: string }> = {
  roxo: { texto: "text-habito-roxo", fundo: "bg-habito-roxo", borda: "border-habito-roxo" },
  azul: { texto: "text-habito-azul", fundo: "bg-habito-azul", borda: "border-habito-azul" },
  vermelho: {
    texto: "text-habito-vermelho",
    fundo: "bg-habito-vermelho",
    borda: "border-habito-vermelho",
  },
  ciano: { texto: "text-habito-ciano", fundo: "bg-habito-ciano", borda: "border-habito-ciano" },
  verde: { texto: "text-habito-verde", fundo: "bg-habito-verde", borda: "border-habito-verde" },
  ambar: { texto: "text-habito-ambar", fundo: "bg-habito-ambar", borda: "border-habito-ambar" },
};

/**
 * Rótulo da cor, para o seletor do formulário.
 *
 * Só o `aria-label` do botão usa isto: na tela a cor é a própria amostra. Ela
 * existe porque um radiogroup de seis quadrados sem nome é inoperável por leitor
 * de tela — e porque o nome é o que está gravado no banco.
 */
export const ROTULO_COR: Record<Cor, string> = {
  roxo: "Roxo",
  azul: "Azul",
  vermelho: "Vermelho",
  ciano: "Ciano",
  verde: "Verde",
  ambar: "Âmbar",
};

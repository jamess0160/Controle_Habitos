import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Primitivas de interface.
 *
 * Existem para as sete telas não repetirem vinte classes do Tailwind por botão —
 * e, mais que isso, para o alvo de toque ser decidido num lugar só: `min-h-11`
 * (44 px) é o mínimo do iOS, e é o número que as telas inteiras herdam daqui.
 *
 * **Não há cor de marca.** A paleta Esmalte só define os seis matizes de hábito
 * e os neutros, então o botão principal é o contraste puro — quase preto no
 * claro, quase branco no escuro. Dar a ele um matiz próprio o colocaria em
 * competição com as cores dos hábitos, que são a informação da tela.
 */

type VarianteDeBotao = "primario" | "secundario" | "fantasma" | "destrutivo";

const ESTILO: Record<VarianteDeBotao, string> = {
  primario: "bg-texto text-superficie font-semibold",
  secundario: "border border-linha-forte bg-cartao font-medium",
  fantasma: "text-texto-fraco font-medium",
  /*
   * Vermelho aqui não colide com a regra "estado é forma, não cor": a regra fala
   * do estado de um **hábito**, e isto é uma ação. Nenhum hábito é identificado
   * por este vermelho.
   */
  destrutivo: "border border-habito-vermelho text-habito-vermelho font-medium",
};

type PropsDeBotao = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variante?: VarianteDeBotao;
  readonly largo?: boolean;
};

/**
 * As classes de botão, separadas do componente.
 *
 * Existem porque um `<Link>` que **parece** botão tem de ser um `<a>`, e não um
 * `<button>` dentro de um `<a>`: conteúdo interativo dentro de conteúdo
 * interativo é HTML inválido, o leitor de tela anuncia os dois, e o alvo de toque
 * fica ambíguo. Então "Novo hábito", "Criar hábito" e "Exportar histórico" usam
 * estas classes direto no link.
 */
export function classeDeBotao(
  variante: VarianteDeBotao = "secundario",
  largo = false,
): string {
  return `inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm transition-opacity disabled:opacity-50 ${ESTILO[variante]} ${largo ? "w-full" : ""}`;
}

export function Botao({
  variante = "secundario",
  largo = false,
  className = "",
  type = "button",
  ...props
}: PropsDeBotao) {
  return (
    <button type={type} className={`${classeDeBotao(variante, largo)} ${className}`} {...props} />
  );
}

export function Campo({
  rotulo,
  dica,
  erro,
  children,
}: {
  readonly rotulo: string;
  readonly dica?: ReactNode;
  readonly erro?: string;
  readonly children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{rotulo}</span>
      {children}
      {dica !== undefined && erro === undefined && (
        <span className="text-xs leading-snug text-texto-fraco">{dica}</span>
      )}
      {erro !== undefined && (
        <span className="text-xs leading-snug text-habito-vermelho">{erro}</span>
      )}
    </label>
  );
}

/** Classes do `<input>`/`<select>`, para os campos soltos ficarem iguais. */
export const CLASSE_ENTRADA =
  "min-h-11 w-full rounded-xl border border-linha-forte bg-cartao px-3 text-base";

/**
 * Escolha entre poucas opções, como grupo de botões.
 *
 * `role="radiogroup"` e não `<select>`: no celular, quatro tipos de hábito em
 * botões de 44 px são um toque, enquanto um `<select>` abre a roda do sistema e
 * esconde as alternativas. E são alternativas que precisam de descrição ao lado —
 * o modo flexível contra o fixo é a decisão mais fácil de errar do formulário.
 */
export function Escolha<T extends string>({
  rotulo,
  valor,
  opcoes,
  aoEscolher,
  coluna = false,
}: {
  readonly rotulo: string;
  readonly valor: T;
  readonly opcoes: readonly { valor: T; rotulo: string; descricao?: string }[];
  readonly aoEscolher: (valor: T) => void;
  readonly coluna?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} className={`flex gap-2 ${coluna ? "flex-col" : "flex-wrap"}`}>
      {opcoes.map((opcao) => {
        const marcada = opcao.valor === valor;

        return (
          <button
            key={opcao.valor}
            type="button"
            role="radio"
            aria-checked={marcada}
            onClick={() => aoEscolher(opcao.valor)}
            className={`flex min-h-11 flex-col items-start justify-center rounded-xl border px-3 py-2 text-left text-sm ${
              marcada
                ? "border-texto bg-cartao font-semibold"
                : "border-linha bg-cartao text-texto-fraco"
            }`}
          >
            <span>{opcao.rotulo}</span>
            {opcao.descricao !== undefined && (
              <span className="mt-0.5 text-xs font-normal leading-snug text-texto-fraco">
                {opcao.descricao}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Bloco informativo.
 *
 * `tom` não muda a cor, muda a borda: a paleta não tem matiz sobrando para
 * semântica de aviso, e os avisos deste app são informativos — eles contam o que
 * já aconteceu, porque o congelamento é consumido sozinho e não há nada a decidir.
 */
export function Nota({
  tom = "neutro",
  children,
}: {
  readonly tom?: "neutro" | "forte";
  readonly children: ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border bg-cartao p-3 text-xs leading-relaxed text-texto-fraco ${
        tom === "forte" ? "border-linha-forte" : "border-linha"
      }`}
    >
      {children}
    </div>
  );
}

/** Título de seção, com a tipografia das faixas HOJE / AVISOS do dashboard. */
export function TituloDeSecao({ children }: { readonly children: ReactNode }) {
  return (
    <h2 className="px-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-texto-fraco">
      {children}
    </h2>
  );
}

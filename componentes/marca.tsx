import type { Cor } from "@/contracts";
import { CLASSE_COR } from "./cor";

/**
 * A marca de estado de uma interação.
 *
 * **Estado é forma, não cor** — a consequência direta da paleta Esmalte,
 * registrada na seção "Paleta" do
 * [Mapa de telas](../Docs/mapas/Mapa%20de%20telas.md). As seis cores de hábito
 * ocupam a roda inteira, então não sobra matiz para `cumprido`, `falhou` e
 * `congelado`: um hábito verde cumprido ficaria verde duas vezes, e um vermelho
 * cumprido ficaria vermelho com cara de falha.
 *
 * | Estado | Marca |
 * |---|---|
 * | `aberto` | anel na cor do hábito |
 * | `cumprido` | disco cheio na cor do hábito, com `✓` |
 * | `congelado` | anel pontilhado com `❄`, em `--texto-fraco` |
 * | `falhou` | anel riscado com `✕`, em `--texto-fraco` |
 *
 * O `❄` leva o seletor de apresentação textual (`U+FE0E`): sem ele o Android
 * desenha o emoji colorido, e o floco voltaria a ser cor justamente no estado
 * que a paleta mandou tirar do matiz.
 */

export type EstadoDaMarca = "aberto" | "cumprido" | "congelado" | "falhou";

const NEVE = "❄︎";

const ROTULO: Record<EstadoDaMarca, string> = {
  aberto: "pendente",
  cumprido: "cumprido",
  congelado: "congelado",
  falhou: "não cumprido",
};

function Visto() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12.5 10 17.5 19 7" />
    </svg>
  );
}

type Props = {
  readonly estado: EstadoDaMarca;
  readonly cor: Cor;
  /** 11 = alvo de toque do dashboard; 8 = marca de leitura do retroativo. */
  readonly tamanho?: "toque" | "leitura";
};

export function Marca({ estado, cor, tamanho = "leitura" }: Props) {
  const medida = tamanho === "toque" ? "size-8" : "size-6";
  const base = `inline-flex ${medida} shrink-0 items-center justify-center rounded-full border-2`;

  if (estado === "cumprido") {
    const { fundo, borda } = CLASSE_COR[cor];
    return (
      <span className={`${base} ${fundo} ${borda} text-sobre-habito`} aria-hidden>
        <Visto />
      </span>
    );
  }

  if (estado === "congelado") {
    return (
      <span
        className={`${base} border-dotted border-congelado text-[0.6rem] text-congelado`}
        aria-hidden
      >
        {NEVE}
      </span>
    );
  }

  if (estado === "falhou") {
    return (
      <span className={`${base} border-falhou text-[0.68rem] text-falhou`} aria-hidden>
        ✕
      </span>
    );
  }

  return <span className={`${base} ${CLASSE_COR[cor].borda} bg-transparent`} aria-hidden />;
}

export function rotuloDaMarca(estado: EstadoDaMarca): string {
  return ROTULO[estado];
}

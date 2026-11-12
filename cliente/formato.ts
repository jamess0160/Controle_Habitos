import type { Progresso, Saudacao } from "@/contracts";
import { horaCurta } from "@/contracts";

/**
 * Formatação para a tela, em pt-BR.
 *
 * Nada de `Intl.DateTimeFormat` sobre dia lógico. `new Date("2026-11-10")` é
 * meia-noite **UTC**, que em São Paulo é 21:00 do dia 9 — formatar isso mostra a
 * data errada, e é a armadilha nº 1 do projeto aparecendo na camada de
 * apresentação. Aqui o `AAAA-MM-DD` é partido em números e os nomes saem de
 * tabela: sem fuso envolvido, não há como deslocar.
 */

const DIA_LONGO = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
] as const;

/** 1 = domingo, como `diaDaSemana` no contrato, no banco e no domínio. */
const DIA_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

const MES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

export const SAUDACAO_TEXTO: Record<Saudacao, string> = {
  bom_dia: "Bom dia",
  boa_tarde: "Boa tarde",
  boa_noite: "Boa noite",
};

function partes(data: string): { ano: number; mes: number; dia: number } {
  const [ano, mes, dia] = data.split("-").map(Number);
  return { ano: ano ?? 1970, mes: mes ?? 1, dia: dia ?? 1 };
}

/** Dia da semana de um dia lógico, 0 = domingo — só com componentes locais. */
function diaDaSemanaDe(data: string): number {
  const { ano, mes, dia } = partes(data);
  return new Date(ano, mes - 1, dia).getDay();
}

/** `"2026-11-10"` → `"Terça, 10 de novembro"`. */
export function dataLonga(data: string): string {
  const { mes, dia } = partes(data);
  return `${DIA_LONGO[diaDaSemanaDe(data)]}, ${dia} de ${MES[mes - 1]}`;
}

/** `"2026-11-10"` → `"10/11"`. */
export function dataCurta(data: string): string {
  const { mes, dia } = partes(data);
  return `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}`;
}

/** `"2026-11-10"` → `"ter"` — a coluna da esquerda do retroativo. */
export function diaCurtoDe(data: string): string {
  return DIA_CURTO[diaDaSemanaDe(data)] ?? "";
}

/** `1` → `"dom"`, pelo índice do contrato. */
export function diaDaSemanaCurto(dia: number): string {
  return DIA_CURTO[dia - 1] ?? "";
}

export { horaCurta };

const NUMERO = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

export function numero(valor: number): string {
  return NUMERO.format(valor);
}

/**
 * O progresso na forma própria do tipo.
 *
 * A união discriminada do contrato é o que permite isto ser um `switch` sem
 * null-check: `unidade` existe exatamente onde é usada, e "0/2" nunca pode ser
 * renderizado sem a unidade ao lado.
 */
export function textoDeProgresso(progresso: Progresso): string {
  switch (progresso.tipo) {
    case "binario":
      return `${progresso.concluidas}/${progresso.meta}`;
    case "quantificado":
      return `${numero(progresso.acumulado)}/${numero(progresso.meta)} ${progresso.unidade}`;
    case "duracao":
      return `${numero(progresso.acumulado)}/${numero(progresso.meta)} min`;
    case "negativo":
      return progresso.recaidas === 0
        ? "sem recaída"
        : `${progresso.recaidas} de ${progresso.tolerancia} recaídas`;
  }
}

/** Fração cumprida, para a trilha de progresso. `null` onde ela não faz sentido. */
export function fracaoDeProgresso(progresso: Progresso): number | null {
  switch (progresso.tipo) {
    case "binario":
      return progresso.concluidas / progresso.meta;
    case "quantificado":
    case "duracao":
      return progresso.acumulado / progresso.meta;
    case "negativo":
      /* Recaída não é progresso: a barra subiria quanto pior o resultado. */
      return null;
  }
}

/**
 * Passo do incremento rápido no tipo quantificado.
 *
 * **Heurística, não contrato.** `meta.quantificado` não tem campo de passo, e
 * uma meta de 2000 ml precisa de um botão de 250 enquanto uma de 3 páginas
 * precisa de um de 1. Candidata a virar campo do formulário na etapa 3.3, se na
 * prática incomodar.
 */
export function passoDe(meta: number): number {
  if (meta <= 10) return 1;
  const bruto = meta / 8;
  const escala = 10 ** Math.floor(Math.log10(bruto));
  return Math.max(1, Math.round(bruto / escala) * escala);
}

/** Segundos → `"mm:ss"`, ou `"h:mm:ss"` depois de uma hora. */
export function cronometroEmTexto(segundos: number): string {
  const total = Math.max(0, Math.floor(segundos));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dois = (n: number) => String(n).padStart(2, "0");

  return h > 0 ? `${h}:${dois(m)}:${dois(s)}` : `${dois(m)}:${dois(s)}`;
}

/** Quanto falta de um bloqueio, em `"4 min 12 s"`. Vazio quando já passou. */
export function restanteAte(instante: string, agora: number): string {
  const falta = Math.max(0, new Date(instante).getTime() - agora);
  if (falta === 0) return "";

  const segundos = Math.ceil(falta / 1000);
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;

  return m > 0 ? `${m} min ${String(s).padStart(2, "0")} s` : `${s} s`;
}

/** `"2026-11-10T15:20:00.000-03:00"` → `"10/11 às 15:20"`. */
export function instanteCurto(instante: string): string {
  const d = new Date(instante);
  const dois = (n: number) => String(n).padStart(2, "0");

  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)} às ${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

/**
 * A data de hoje pelo relógio **do aparelho**, em `AAAA-MM-DD`.
 *
 * Usada só onde o valor aparece num campo editável à vista do usuário — hoje,
 * o início de uma pausa. **Nunca** para derivar o dia lógico de um registro: a
 * virada das 04:00 é conta do servidor, e `criarRegistro.dataLogica` é opcional
 * exatamente para o cliente não precisar fazê-la (armadilha nº 1 do projeto).
 *
 * `POST /api/habitos/:id/pausa` ainda exige `de`, então aqui o palpite do
 * aparelho é oferecido como sugestão visível e corrigível, e não aplicado em
 * silêncio. Candidato a `de` opcional na etapa 3.2, pelo mesmo motivo do registro.
 */
export function dataDeHojeNoAparelho(): string {
  const agora = new Date();
  const dois = (n: number) => String(n).padStart(2, "0");

  return `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}`;
}

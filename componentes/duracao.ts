import { partirDuracao } from "@/contracts";

/**
 * A duração como três campos de texto — a aritmética do relógio, fora do React.
 *
 * O campo era um `<input type="number">` de minutos, e com ele não havia como
 * pedir "30 s": a unidade mais fina oferecida era o minuto inteiro. Agora a
 * unidade é o segundo (ver [contracts/duracao.ts](../contracts/duracao.ts)) e a
 * entrada é um relógio `h : min : s`.
 *
 * Três `<input>` e não um `<input type="time">`: `time` é **hora do dia**, está
 * limitado a 23:59, perde os segundos em boa parte dos navegadores sem
 * `step="1"`, e no celular abre a roda de despertador — que é o gesto errado
 * para dizer "45 segundos".
 *
 * Como no resto do formulário, os números ficam como **texto**: campo vazio tem
 * de ser distinguível de zero. Com as três partes em branco o total é `NaN`, o
 * schema do contrato recusa, e a mensagem que aparece na tela é a mesma que o
 * servidor mandaria — em vez de um silencioso `0` que o CHECK do banco
 * rejeitaria lá na frente.
 */

export type PartesDeDuracao = {
  readonly horas: string;
  readonly minutos: string;
  readonly segundos: string;
};

export const DURACAO_VAZIA: PartesDeDuracao = { horas: "", minutos: "", segundos: "" };

/**
 * As três partes em segundos. `NaN` quando **todas** estão em branco, e também
 * quando alguma não é número — nos dois casos é o schema que produz a mensagem.
 *
 * Uma parte vazia entre partes preenchidas vale zero: digitar `10` em minutos e
 * deixar horas e segundos em branco significa 10 min, não um erro.
 */
export function segundosDePartes(partes: PartesDeDuracao): number {
  const brutas = [partes.horas, partes.minutos, partes.segundos].map((p) => p.trim());
  if (brutas.every((p) => p === "")) return NaN;

  const [h = 0, m = 0, s = 0] = brutas.map((p) => (p === "" ? 0 : Number(p)));
  return h * 3600 + m * 60 + s;
}

/**
 * A volta, para abrir a edição de um hábito já salvo.
 *
 * Parte em zero fica **em branco**, não `"0"`: uma meta de 10 min não deve abrir
 * como `0 h 10 min 0 s`, e o total é o mesmo de qualquer forma. Zero total é o
 * único caso que preenche — `0 s` é o valor, e deixar tudo vazio o leria como
 * campo não preenchido.
 */
export function partesDeSegundos(total: number): PartesDeDuracao {
  if (!Number.isFinite(total)) return DURACAO_VAZIA;
  if (total <= 0) return { horas: "", minutos: "", segundos: "0" };

  const { horas, minutos, segundos } = partirDuracao(total);

  return {
    horas: horas > 0 ? String(horas) : "",
    minutos: minutos > 0 ? String(minutos) : "",
    segundos: segundos > 0 ? String(segundos) : "",
  };
}

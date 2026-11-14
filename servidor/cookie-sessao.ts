/**
 * O cookie de sessão: nome, formato e a leitura **pura** do valor.
 *
 * Mora separado de [sessao.ts](sessao.ts) porque o [proxy](../proxy.ts) também
 * precisa disso, e a documentação do Next é explícita: o proxy roda apartado do
 * código de render e não deve depender de módulos compartilhados nem de globais.
 * Este arquivo não importa nada — nem `next/headers`, nem o Knex —, então o
 * proxy pode usá-lo sem arrastar o banco para dentro do bundle dele.
 *
 * ## O formato, e por que ele tem duas partes
 *
 * ```
 * <token base64url>.<provisoria|completa>
 * ```
 *
 * O token é o segredo: 32 bytes aleatórios cujo **hash** vive em
 * `sessao.token_hash`. O sufixo é uma **dica**, e existe por uma restrição real:
 * desde que a sessão passou a morar no Postgres, descobrir se há passkey
 * cadastrada custa uma consulta — e proxy não é lugar de consultar banco. Sem a
 * dica, a guarda de navegação não teria como distinguir a sessão do primeiro
 * acesso da sessão completa, e o usuário veria o esqueleto de uma tela à qual
 * não tem acesso antes de ser mandado embora.
 *
 * **Forjar o sufixo não compra nada.** Ele decide apenas qual tela aparece
 * primeiro; `sessaoAtual()` ignora o sufixo por completo e deriva `temPasskey`
 * de `credencial_passkey`, e é essa leitura que `exigirAcesso()` usa para
 * responder 401 ou 409. A verificação otimista no proxy é cosmética **de
 * propósito** — é o padrão que a própria documentação do Next recomenda.
 *
 * Uma parte só, e não dois cookies, para não existir o estado em que um
 * sobreviveu e o outro não.
 */

export const COOKIE_SESSAO = "habito_sessao";

export const ESTADOS_DE_SESSAO = ["provisoria", "completa"] as const;
export type EstadoDeSessao = (typeof ESTADOS_DE_SESSAO)[number];

export type DicaDeSessao = {
  /** O token em claro, como veio do cookie. Só `sessao.ts` sabe o que fazer com ele. */
  token: string;
  /** A dica de navegação. Não é autorização — ver a nota no topo do arquivo. */
  estado: EstadoDeSessao;
};

/** Monta o valor do cookie. */
export function valorDoCookie(token: string, estado: EstadoDeSessao): string {
  return `${token}.${estado}`;
}

/**
 * Interpreta o cookie. `null` = sem cookie utilizável.
 *
 * Recusa o que não tem exatamente as duas partes, em vez de assumir um padrão:
 * um cookie de formato antigo (o stub da etapa 2 gravava `stub-com-passkey`)
 * tem de cair no login e não virar uma sessão de estado inventado.
 */
export function lerDica(valor: string | undefined): DicaDeSessao | null {
  if (valor === undefined) return null;

  const separador = valor.lastIndexOf(".");
  if (separador <= 0) return null;

  const token = valor.slice(0, separador);
  const sufixo = valor.slice(separador + 1);

  const estado = ESTADOS_DE_SESSAO.find((e) => e === sufixo);
  if (estado === undefined || token === "") return null;

  return { token, estado };
}

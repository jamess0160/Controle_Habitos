/**
 * Nome do cookie de sessão e a leitura **pura** do seu valor.
 *
 * Mora separado de [sessao.ts](sessao.ts) porque o [proxy](../proxy.ts) também
 * precisa disso, e a documentação do Next é explícita: o proxy roda apartado do
 * código de render e não deve depender de módulos compartilhados nem de
 * globais. Este arquivo não importa nada — nem `next/headers` —, então o proxy
 * pode usá-lo sem arrastar o resto do servidor para dentro do bundle dele.
 */

export const COOKIE_SESSAO = "habito_sessao";

export type Sessao = {
  /**
   * Valor opaco do cookie. Na etapa 3.1 passa a ser o token cujo **hash** vive
   * em `sessao` no Postgres; aqui ele é apenas o rótulo do stub.
   */
  token: string;
  /**
   * `false` enquanto a passkey não foi cadastrada. Nesse estado a sessão existe
   * mas só abre a tela de biometria — é o "não existe estado intermediário
   * utilizável" do [Mapa de autenticação](../Docs/mapas/Mapa%20de%20autenticação.md).
   */
  temPasskey: boolean;
};

/**
 * ⚠️ **STUB (etapa 1.5).** O valor do cookie é acreditado como vem, sem
 * consultar o banco: não há verificação nenhuma aqui. Serve para a etapa 2
 * navegar os dois estados de sessão sem backend, e é substituído na etapa 3.1
 * pela consulta a `sessao` com o hash do token. Nada neste arquivo é segurança.
 */
const STUB: Record<string, boolean> = {
  "stub-com-passkey": true,
  "stub-sem-passkey": false,
};

/** Interpreta o cookie. `null` = sem sessão. */
export function lerSessao(valor: string | undefined): Sessao | null {
  if (valor === undefined) return null;
  const temPasskey = STUB[valor];
  if (temPasskey === undefined) return null;
  return { token: valor, temPasskey };
}

/** O valor que `abrirSessao` grava no cookie. */
export function valorDeStub(temPasskey: boolean): string {
  return temPasskey ? "stub-com-passkey" : "stub-sem-passkey";
}

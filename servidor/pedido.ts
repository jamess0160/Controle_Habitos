/**
 * O que se lê do pedido HTTP: IP de origem e origem do navegador.
 *
 * Os dois são headers, e os dois têm uma armadilha própria.
 */

/** Usado quando não há `CF-Connecting-IP` — desenvolvimento local. */
export const IP_LOCAL = "127.0.0.1";

/**
 * O IP do cliente, de `CF-Connecting-IP`.
 *
 * **Nunca do socket.** Atrás do Cloudflare Tunnel o socket é sempre o do próprio
 * túnel, então contar tentativas por ele transformaria o bloqueio por IP num
 * bloqueio global: cinco erros de digitação trancariam o app para todo mundo,
 * inclusive para quem sabe a senha. É o aviso em destaque no
 * [Mapa de autenticação](../Docs/mapas/Mapa%20de%20autenticação.md).
 *
 * **A suposição que isto carrega:** o header é confiável porque o único caminho
 * até o app é o túnel, e é o Cloudflare que o escreve. Publicar a porta do
 * contêiner direto na internet quebraria essa suposição — aí qualquer um
 * trocaria de IP a cada tentativa e o bloqueio viraria enfeite. O compose de
 * produção não publica porta; o de desenvolvimento publica só o Postgres.
 */
export function ipDoPedido(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf !== null && cf.trim() !== "") return cf.trim();

  return IP_LOCAL;
}

/**
 * A origem do navegador (`https://habitos.exemplo.com`), para o WebAuthn.
 *
 * O `Origin` é obrigatório em requisição `fetch` de mesma origem, mas o valor
 * **não** é tomado como verdade: quem confere é
 * [servidor/webauthn.ts](webauthn.ts), comparando o hostname desta origem com o
 * `rp_id` gravado em `config_app`. Mentir aqui não ajuda — a assinatura da
 * passkey carrega a origem de verdade dentro do `clientDataJSON`, e a biblioteca
 * compara as duas.
 */
export function origemDoPedido(req: Request): string | null {
  const origem = req.headers.get("origin");
  if (origem !== null && origem.trim() !== "") return origem.trim();

  /*
   * Sem `Origin`, o `Referer` serve de reserva — é o que aparece em alguns
   * navegadores antigos no iOS. Só o esquema e o host interessam.
   */
  const referer = req.headers.get("referer");
  if (referer === null) return null;

  try {
    const url = new URL(referer);
    return url.origin;
  } catch {
    return null;
  }
}

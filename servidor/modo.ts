/**
 * `APP_MODO` — a única chave que afasta o comportamento de desenvolvimento do de
 * produção.
 *
 * Existe por uma necessidade concreta: em desenvolvimento a senha tem de
 * continuar valendo **quantas vezes forem necessárias**, mesmo com a passkey
 * cadastrada, porque é a única forma de entrar no app num navegador de desktop
 * sem autenticador. Em produção a senha é desativada no cadastro da biometria e
 * não volta — é o que faz a porta única do
 * [Mapa de autenticação](../Docs/mapas/Mapa%20de%20autenticação.md) ser única.
 *
 * **Por que não `NODE_ENV`.** Dois motivos, e o segundo é o que decide:
 *
 * 1. `NODE_ENV` é escolhido pelo comando (`next dev` contra `next build`), não
 *    pelo operador. Uma chave de segurança não deve ser efeito colateral de
 *    qual script foi rodado.
 * 2. A validação da etapa 2 na PWA do celular exige **build de produção servido
 *    por HTTPS** — `next build && next start` atrás de um túnel —, e nesse
 *    cenário `NODE_ENV` é `production` enquanto o app ainda é um ambiente de
 *    teste com fixtures. Sem uma chave separada, não haveria como entrar por
 *    senha ali.
 *
 * **Falha fechada.** Só a palavra exata `desenvolvimento` liga o modo frouxo.
 * Variável ausente, vazia, com erro de digitação ou com qualquer outro valor
 * resulta em produção — o erro cai sempre para o lado seguro, e um `.env`
 * copiado de exemplo nunca abre o app por acidente.
 */

export const MODO_DESENVOLVIMENTO = "desenvolvimento";
export const MODO_PRODUCAO = "producao";

export type Modo = typeof MODO_DESENVOLVIMENTO | typeof MODO_PRODUCAO;

/**
 * Lido a cada chamada, não no carregamento do módulo: assim o valor é o do
 * processo no momento da requisição, e o teste pode trocar `process.env` sem
 * depender da ordem de import.
 *
 * Vale **inclusive no [proxy](../proxy.ts)**, e isso foi verificado em build de
 * produção: um bundle compilado com `APP_MODO=desenvolvimento` e servido com
 * `APP_MODO=producao` se comporta como produção. A dúvida é legítima porque o
 * Next substitui `process.env.X` em tempo de build no middleware de edge; o
 * proxy do Next 16 roda no runtime Node e lê o ambiente do processo. É o que
 * permite a mesma imagem Docker rodar nos dois modos.
 */
export function modoDoApp(): Modo {
  const bruto = process.env.APP_MODO?.trim().toLowerCase();
  return bruto === MODO_DESENVOLVIMENTO ? MODO_DESENVOLVIMENTO : MODO_PRODUCAO;
}

export function emDesenvolvimento(): boolean {
  return modoDoApp() === MODO_DESENVOLVIMENTO;
}

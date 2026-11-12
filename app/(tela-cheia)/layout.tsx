/**
 * Shell das telas de tarefa.
 *
 * Segundo grupo de rotas do app, e a razão dele é a regra do
 * [Mapa de telas](../../Docs/mapas/Mapa%20de%20telas.md): "retroativo e cadastro
 * abrem como tela cheia **sobre** a navegação, não como aba". Então eles não
 * podem morar em `(app)/`, que é quem desenha a barra inferior — e sem grupo
 * nenhum herdariam só o layout raiz, perdendo a largura e a altura da coluna.
 *
 * Os dois grupos convivem com caminhos sob `/habitos`: `(app)/habitos` é
 * `/habitos`, `(tela-cheia)/habitos/novo` é `/habitos/novo`. Nenhum parêntese
 * aparece na URL e nenhum dos dois produz o mesmo caminho, que é a única coisa
 * que o Next recusaria.
 *
 * Sem `padding-bottom` de barra aqui: o que reserva espaço é o próprio rodapé de
 * ação de cada tela, quando ela tem um.
 */
export default function LayoutDeTarefa({ children }: LayoutProps<"/">) {
  return <div className="mx-auto flex min-h-dvh max-w-lg flex-col">{children}</div>;
}

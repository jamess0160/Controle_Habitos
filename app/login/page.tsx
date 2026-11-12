/**
 * Marcador de lugar da etapa 1.5.
 *
 * A guarda do [proxy](../../proxy.ts) manda para cá quem não tem sessão, e um
 * redirecionamento para rota inexistente seria 404 — a guarda não dá para
 * verificar sem esta página existir. A tela de verdade (campo de senha, estado
 * de bloqueio, botão de biometria) é da etapa 2.
 */
export default function LoginPage() {
  return <main>Login — tela da etapa 2.</main>;
}

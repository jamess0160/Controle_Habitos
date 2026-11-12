import { BarraInferior } from "@/componentes/barra-inferior";
import { RegistrarServiceWorker } from "@/componentes/registrar-sw";

/**
 * Shell dos três destinos.
 *
 * O grupo de rotas `(app)` existe para separar o que tem navegação do que não
 * tem: `/login` e `/biometria` ficam **fora** dele, porque uma barra com três
 * destinos numa tela de onde não se pode sair ofereceria caminhos que o
 * [proxy](../../proxy.ts) ia recusar — e o parêntese não aparece na URL, então
 * `/` continua sendo `/`.
 *
 * O `padding-bottom` reserva a altura da barra fixa mais a área segura do
 * iPhone; sem ele a última linha do dashboard nasce debaixo da barra.
 */
export default function LayoutDoApp({ children }: LayoutProps<"/">) {
  return (
    <>
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
        {children}
      </div>
      <BarraInferior />
      <RegistrarServiceWorker />
    </>
  );
}

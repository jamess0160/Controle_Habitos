import Link from "next/link";
import { Voltar } from "./icones";

/**
 * Cabeçalho das telas de tarefa (cadastro, edição, retroativo).
 *
 * Elas abrem **sobre** a navegação e não como aba, porque são tarefas com começo
 * e fim — e por isso precisam de uma saída explícita, não da barra inferior. O
 * destino da volta é um `href` e não `router.back()`: aberta por link direto (de
 * uma notificação, por exemplo) a tela não tem histórico para voltar, e o botão
 * não faria nada.
 */
export function CabecalhoDeTarefa({
  titulo,
  subtitulo,
  voltarPara,
  rotuloDaVolta = "Voltar",
}: {
  readonly titulo: string;
  readonly subtitulo?: string;
  readonly voltarPara: string;
  readonly rotuloDaVolta?: string;
}) {
  return (
    <header className="flex items-start gap-1 border-b border-linha px-2 py-3">
      <Link
        href={voltarPara}
        aria-label={rotuloDaVolta}
        className="-ml-0.5 flex size-11 shrink-0 items-center justify-center rounded-full text-texto-fraco"
      >
        <Voltar />
      </Link>

      <div className="min-w-0 flex-1 pt-1.5">
        <h1 className="truncate text-base font-semibold tracking-tight">{titulo}</h1>
        {subtitulo !== undefined && (
          <p className="mt-0.5 truncate text-xs text-texto-fraco">{subtitulo}</p>
        )}
      </div>
    </header>
  );
}

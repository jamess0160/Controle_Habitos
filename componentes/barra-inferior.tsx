"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Alvo, Engrenagem, Lista } from "./icones";

/**
 * Barra inferior de três destinos.
 *
 * Os três do [Mapa de telas](../Docs/mapas/Mapa%20de%20telas.md). Retroativo e
 * cadastro **não** entram aqui: abrem como tela cheia sobre a navegação, porque
 * são tarefas com começo e fim, não lugares onde se fica.
 *
 * Fica no rodapé e não no topo pelo alcance do polegar — é a única parte da tela
 * que se alcança com uma mão em qualquer tamanho de aparelho.
 */

const DESTINOS = [
  { href: "/", rotulo: "Hoje", Icone: Alvo },
  { href: "/habitos", rotulo: "Hábitos", Icone: Lista },
  { href: "/ajustes", rotulo: "Ajustes", Icone: Engrenagem },
] as const;

export function BarraInferior() {
  const caminho = usePathname();

  return (
    <nav
      aria-label="Navegação principal"
      /*
       * `pb-[env(safe-area-inset-bottom)]` desvia do indicador de gestos do
       * iPhone — sem isso o último destino fica debaixo da barra do sistema e
       * não dá para tocar. Depende de `viewportFit: "cover"` no layout raiz.
       */
      className="fixed inset-x-0 bottom-0 z-20 border-t border-linha bg-cartao pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-3">
        {DESTINOS.map(({ href, rotulo, Icone }) => {
          /*
           * Hoje casa exato; os outros por prefixo, para `/habitos/novo` e
           * `/habitos/:id/retroativo` manterem o destino aceso.
           */
          const ativo = href === "/" ? caminho === "/" : caminho.startsWith(href);

          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={ativo ? "page" : undefined}
                /* min-h-14 = 56 px: alvo de toque confortável, acima dos 44 mínimos. */
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.68rem] tracking-wide transition-colors ${
                  ativo ? "font-semibold text-texto" : "text-texto-fraco"
                }`}
              >
                <Icone className={ativo ? "stroke-2" : undefined} />
                {rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

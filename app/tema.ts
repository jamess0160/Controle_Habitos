/**
 * Tema claro/escuro.
 *
 * Três estados, não dois, para casar com o que [globals.css](globals.css) já
 * suporta: sem atributo nenhum o app segue o `prefers-color-scheme` do sistema,
 * e `data-tema="claro"` ou `"escuro"` vence o sistema nos dois sentidos.
 * "Sistema" é a **ausência** do atributo, e não um terceiro valor — é isso que
 * faz o app acompanhar a virada automática do celular ao anoitecer sem precisar
 * de listener.
 *
 * O tema é estado externo ao React: ele vive no `localStorage` e no atributo do
 * `<html>`, e o script inline do layout já o aplicou antes de o React existir.
 * Por isso o acesso é uma store para `useSyncExternalStore`, e não `useState`
 * dentro de um efeito — a leitura do `localStorage` na montagem daria
 * divergência de hidratação, e corrigi-la com `setState` num efeito é
 * justamente o que o `react-hooks/set-state-in-effect` recusa.
 */

export const TEMA = ["sistema", "claro", "escuro"] as const;
export type Tema = (typeof TEMA)[number];

export const ROTULO_TEMA: Record<Tema, string> = {
  sistema: "Sistema",
  claro: "Claro",
  escuro: "Escuro",
};

export const CHAVE_TEMA = "habito:tema";

/**
 * Script aplicado **antes da primeira pintura**.
 *
 * Sem isto o app pinta no tema do sistema e só então o React corrige, o que
 * aparece como um flash branco ao abrir no escuro — justamente às 6:30 da
 * manhã, que é um dos dois horários em que este app é usado. Precisa ser
 * síncrono e inline no `<head>`: qualquer coisa adiada já perdeu a corrida.
 *
 * O `try` existe porque `localStorage` lança quando o navegador bloqueia
 * armazenamento, e aí o certo é cair no tema do sistema em silêncio.
 */
export const SCRIPT_TEMA = `
try {
  var t = localStorage.getItem(${JSON.stringify(CHAVE_TEMA)});
  if (t === "claro" || t === "escuro") document.documentElement.dataset.tema = t;
} catch (e) {}
`.trim();

// ─── Store ───────────────────────────────────────────────────────────────────

const ouvintes = new Set<() => void>();

export function assinarTema(aoMudar: () => void): () => void {
  ouvintes.add(aoMudar);
  return () => ouvintes.delete(aoMudar);
}

/**
 * Snapshot do cliente. Devolve string, não objeto, de propósito: o
 * `useSyncExternalStore` compara snapshots por identidade, e um objeto novo a
 * cada leitura o faria re-renderizar em loop.
 */
export function lerTema(): Tema {
  try {
    const t = localStorage.getItem(CHAVE_TEMA);
    return t === "claro" || t === "escuro" ? t : "sistema";
  } catch {
    return "sistema";
  }
}

/**
 * Snapshot do servidor, e também o da hidratação.
 *
 * É sempre `sistema` porque o servidor não tem como saber o que está no
 * `localStorage` do aparelho. O React re-renderiza com o valor real logo após
 * hidratar — o que pode aparecer é o destaque do botão, nunca a cor da tela,
 * que o script inline já acertou.
 */
export function lerTemaNoServidor(): Tema {
  return "sistema";
}

/** Aplica, persiste e avisa os assinantes. */
export function definirTema(tema: Tema): void {
  if (tema === "sistema") {
    delete document.documentElement.dataset.tema;
  } else {
    document.documentElement.dataset.tema = tema;
  }

  try {
    if (tema === "sistema") localStorage.removeItem(CHAVE_TEMA);
    else localStorage.setItem(CHAVE_TEMA, tema);
  } catch {
    /* Armazenamento bloqueado: o tema vale só para esta sessão. */
  }

  for (const aoMudar of ouvintes) aoMudar();
}

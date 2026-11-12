import type { Falha } from "@/cliente/api";

/**
 * Os dois estados que toda tela que busca dados tem.
 *
 * Eles não são enfeite: a tela é montada antes de a resposta chegar, e sem
 * `Carregando` o primeiro quadro é uma página em branco que parece erro. Como a
 * busca é no cliente ([cliente/api.ts](../cliente/api.ts)), os dois casos existem
 * em todas as sete telas, e centralizá-los é o que evita sete aparências
 * diferentes para a mesma situação.
 *
 * O esqueleto imita a forma do conteúdo em vez de girar um spinner: a tela não
 * salta quando os dados chegam, e o que aparece já diz o que vai aparecer.
 */

export function Carregando({ linhas = 3 }: { readonly linhas?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      {Array.from({ length: linhas }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-xl border border-linha bg-cartao p-4"
        >
          <span className="size-8 shrink-0 animate-pulse rounded-full bg-trilha" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="h-3 w-2/5 animate-pulse rounded bg-trilha" />
            <span className="h-2.5 w-1/4 animate-pulse rounded bg-trilha" />
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Erro com o motivo e um caminho de volta.
 *
 * A mensagem vem do servidor no formato único de `contracts/erro.ts` — ou do
 * próprio `chamar()`, quando nem houve resposta. Mostrar a mensagem recebida, e
 * não um "algo deu errado", é o que torna o problema diagnosticável de dentro do
 * app: num homelab atrás de um túnel, "não foi possível falar com o servidor" e
 * "o servidor respondeu 500" pedem providências diferentes.
 */
export function Erro({
  falha,
  aoTentarDeNovo,
}: {
  readonly falha: Falha;
  readonly aoTentarDeNovo?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-linha-forte bg-cartao p-4"
    >
      <div>
        <p className="text-sm font-medium">Não foi possível carregar</p>
        <p className="mt-1 text-sm text-texto-fraco">{falha.mensagem}</p>
      </div>

      {aoTentarDeNovo !== undefined && (
        <button
          type="button"
          onClick={aoTentarDeNovo}
          className="min-h-11 rounded-full border border-linha-forte px-4 text-sm font-medium"
        >
          Tentar de novo
        </button>
      )}
    </div>
  );
}

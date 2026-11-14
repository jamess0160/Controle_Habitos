/*
 * Matchers de DOM para os testes de componente (`toBeInTheDocument`,
 * `toBeDisabled`, …).
 *
 * Em `setupFilesAfterEnv` e não `setupFiles` porque registra matchers no
 * `expect`, que só existe depois de o framework de teste subir. O import é
 * inofensivo nos arquivos de ambiente `node`: ele só adiciona matchers, não toca
 * em `document`.
 */
import "@testing-library/jest-dom";

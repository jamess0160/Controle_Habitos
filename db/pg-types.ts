import pg from "pg";

const OID_DATE = 1082;
const OID_NUMERIC = 1700;

let aplicado = false;

/**
 * Ajusta como o driver do Postgres entrega dois tipos que o domínio usa muito.
 *
 * DATE: por padrão o `pg` converte em `Date` do JavaScript interpretando no fuso
 * local, o que desloca `2026-11-09` para o dia anterior conforme o horário da
 * máquina. Como o app inteiro gira em torno de data lógica (ver
 * `Docs/mapas/Mapa de regras.md`), isso seria uma fonte silenciosa de erro de um
 * dia. Mantemos DATE como string `YYYY-MM-DD`.
 *
 * NUMERIC: vem como string para não perder precisão. Os numerics daqui são
 * quantidades pequenas (litros, páginas, km, minutos), então convertemos para
 * number e evitamos conversão espalhada pelo código.
 */
export function aplicarParsersPg(): void {
  if (aplicado) return;
  pg.types.setTypeParser(OID_DATE, (valor) => valor);
  pg.types.setTypeParser(OID_NUMERIC, (valor) => Number(valor));
  aplicado = true;
}

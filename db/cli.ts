import "dotenv/config";
import knexLib from "knex";
import config from "../knexfile";

/**
 * Comandos de banco pela API do Knex, em vez do binário `knex`.
 *
 * O CLI do Knex com `knexfile.ts` depende de registrar um loader de TypeScript
 * no processo dele, o que é frágil — especialmente no Windows. Chamar a API
 * direto sob `tsx` funciona igual em qualquer máquina e dentro do contêiner.
 */

const db = knexLib(config);

const comandos = {
  async make(nome?: string) {
    if (!nome) throw new Error('Informe o nome: npm run db:make -- "criar_tabela_x"');
    const arquivo = await db.migrate.make(nome, { extension: "ts" });
    console.log(`migration criada: ${arquivo}`);
  },

  async latest() {
    const [lote, aplicadas] = await db.migrate.latest();
    if (aplicadas.length === 0) {
      console.log("nada a aplicar: banco já está na última versão");
      return;
    }
    console.log(`lote ${lote}, ${aplicadas.length} migration(s):`);
    for (const nome of aplicadas) console.log(`  + ${nome}`);
  },

  async rollback(flag?: string) {
    const tudo = flag === "--all";
    const [lote, revertidas] = await db.migrate.rollback(undefined, tudo);
    if (revertidas.length === 0) {
      console.log("nada a reverter");
      return;
    }
    console.log(`revertido lote ${lote}, ${revertidas.length} migration(s):`);
    for (const nome of revertidas) console.log(`  - ${nome}`);
  },

  async status() {
    const atual = await db.migrate.currentVersion();
    const [aplicadas, pendentes] = await db.migrate.list();
    console.log(`versão atual: ${atual}`);
    console.log(`aplicadas (${aplicadas.length}):`);
    for (const m of aplicadas) console.log(`  ok  ${nomeDe(m)}`);
    console.log(`pendentes (${pendentes.length}):`);
    for (const m of pendentes) console.log(`  --  ${nomeDe(m)}`);
  },

  async seed() {
    const [executados] = await db.seed.run();
    if (executados.length === 0) {
      console.log("nenhum seed encontrado");
      return;
    }
    for (const nome of executados) console.log(`  * ${nome}`);
  },

  /** Derruba tudo e reconstrói. Só para desenvolvimento. */
  async reset() {
    await comandos.rollback("--all");
    await comandos.latest();
    await comandos.seed();
  },
};

type Comando = keyof typeof comandos;

function nomeDe(item: unknown): string {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    const registro = item as { name?: string; file?: string };
    return registro.name ?? registro.file ?? JSON.stringify(item);
  }
  return String(item);
}

async function main(): Promise<void> {
  const [comando, ...args] = process.argv.slice(2);

  if (!comando || !(comando in comandos)) {
    console.error(`comandos disponíveis: ${Object.keys(comandos).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  await comandos[comando as Comando](...(args as [string?]));
}

main()
  .catch((erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());

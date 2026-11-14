import "dotenv/config";
import knexLib, { type Knex } from "knex";
import { aplicarParsersPg } from "./pg-types";
import "./tipos";

/**
 * O banco de teste: um Postgres **de verdade**, no mesmo contêiner, em outro
 * database.
 *
 * O roadmap (etapa 3.7) pede integração contra Postgres real, e a razão é
 * concreta: quase toda regra deste app mora em algo que um mock não tem — o
 * `CHECK` que proíbe dois períodos abertos, o `UNIQUE` parcial da ocorrência, a
 * conversão de `date` sem fuso, o `RETURNING` de um `ON CONFLICT`. Um banco
 * falso aprovaria código que o banco de verdade recusa.
 *
 * Outro database e não outro contêiner para o ciclo ser curto: `npm test` não
 * sobe nada, só exige que o `db:up` esteja rodando — o mesmo que o
 * desenvolvimento já exige.
 *
 * ## Um database por worker
 *
 * O Jest roda arquivos de teste **em paralelo**, e `limpar()` trunca tudo. Dois
 * arquivos no mesmo database truncam o banco um do outro no meio do caso: foi
 * exatamente o que aconteceu quando esta suíte ganhou o segundo arquivo de
 * integração — 21 falhas que não apareciam rodando cada arquivo sozinho.
 *
 * Em vez de serializar a suíte inteira (`maxWorkers: 1`), que pagaria o preço nos
 * testes puros de domínio, cada worker recebe o seu: `controle_habito_test_1`,
 * `_2`, … Um worker roda seus arquivos em sequência, então dentro dele o
 * `TRUNCATE` é seguro.
 */

/** Nome base do database de teste, sem o sufixo do worker. */
function urlBase(): URL {
  const explicita = process.env.DATABASE_URL_TEST;
  const base = explicita !== undefined && explicita.trim() !== "" ? explicita : process.env.DATABASE_URL;

  if (base === undefined || base.trim() === "") {
    throw new Error(
      "DATABASE_URL não definida. Copie .env.example para .env antes de rodar os testes.",
    );
  }

  const url = new URL(base);
  if (explicita === undefined || explicita.trim() === "") {
    url.pathname = `${url.pathname.replace(/^\//, "")}_test`;
  }
  return url;
}

/**
 * A URL do database **deste** worker.
 *
 * `JEST_WORKER_ID` existe em cada processo de worker e vale 1 no modo serial
 * (`--runInBand`), então a conta é a mesma nos dois casos.
 */
export function urlDeTeste(worker = process.env.JEST_WORKER_ID ?? "1"): string {
  const url = urlBase();
  url.pathname = `${url.pathname.replace(/^\//, "")}_${worker}`;
  return url.toString();
}

function configDe(url: string): Knex.Config {
  aplicarParsersPg();

  return {
    client: "pg",
    connection: url,
    pool: { min: 0, max: 5 },
    migrations: {
      directory: `${__dirname}/migrations`,
      extension: "ts",
      loadExtensions: [".ts"],
      tableName: "knex_migrations",
    },
  };
}

export function abrirBancoDeTeste(): Knex {
  return knexLib(configDe(urlDeTeste()));
}

/**
 * Cria o database se ele não existir.
 *
 * `CREATE DATABASE` não aceita parâmetro e não tem `IF NOT EXISTS` em toda
 * versão útil, então o nome é interpolado — vem de `DATABASE_URL`, que é
 * configuração nossa, e é escapado com aspas duplas. Erro `42P04` (já existe) é
 * o caminho normal da segunda execução em diante.
 */
async function criarSeAusente(url: string): Promise<void> {
  const alvo = new URL(url);
  const nome = alvo.pathname.replace(/^\//, "");

  const administrativo = new URL(url);
  administrativo.pathname = "/postgres";

  const admin = knexLib({
    client: "pg",
    connection: administrativo.toString(),
    pool: { min: 0, max: 1 },
  });

  try {
    await admin.raw(`CREATE DATABASE "${nome.replace(/"/g, '""')}"`);
  } catch (erro) {
    const codigo = (erro as { code?: string }).code;
    if (codigo !== "42P04") throw erro;
  } finally {
    await admin.destroy();
  }
}

/**
 * Prepara um database por worker: cria o que faltar e aplica as migrations.
 *
 * Roda no `globalSetup`, que é o único lugar que conhece `maxWorkers` — daí o
 * parâmetro. Migrar é idempotente, então da segunda execução em diante cada
 * chamada é só uma consulta a `knex_migrations`.
 */
export async function prepararBancosDeTeste(workers: number): Promise<void> {
  for (let i = 1; i <= Math.max(1, workers); i += 1) {
    const url = urlDeTeste(String(i));
    await criarSeAusente(url);

    const db = knexLib(configDe(url));
    try {
      await db.migrate.latest();
    } finally {
      await db.destroy();
    }
  }
}

/**
 * As tabelas de dados, na ordem em que não importa — `CASCADE` resolve as
 * dependências. `knex_migrations` fica fora de propósito: truncá-la faria a
 * suíte seguinte achar que o schema não existe.
 */
export const TABELAS_DE_DADOS = [
  "registro",
  "congelamento",
  "habito_streak",
  "habito_ocorrencia",
  "habito_periodo",
  "habito_config",
  "habito",
  "credencial_passkey",
  "credencial_senha",
  "webauthn_desafio",
  "sessao",
  "tentativa_login",
  "push_subscription",
  "notificacao_enviada",
  "config_app",
] as const;

/**
 * Esvazia o banco entre casos.
 *
 * Um `TRUNCATE` de todas as tabelas numa instrução, e não `DELETE` tabela por
 * tabela: além de ser muito mais rápido, resolve as dependências de uma vez e
 * não deixa a ordem das tabelas virar uma segunda fonte de verdade sobre as
 * chaves estrangeiras.
 */
export async function limpar(db: Knex): Promise<void> {
  const lista = TABELAS_DE_DADOS.map((t) => `"${t}"`).join(", ");
  await db.raw(`TRUNCATE ${lista} RESTART IDENTITY CASCADE`);
}

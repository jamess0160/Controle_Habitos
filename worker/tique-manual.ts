import "dotenv/config";
import { db } from "@/db/knex";
import { dataLogicaDe, instanteDeParede } from "@/dominio/dia-logico";
import { horaDeParede, relogioAtual } from "@/servidor/relogio";
import { tique } from "./tique";

/**
 * Um tique, à mão, com o relógio que você escolher.
 *
 * É a ferramenta que a etapa 4 do [Roadmap](../Docs/Roadmap%20onda%201.md) pede:
 * sem ela, provar que um período fecha exige esperar a virada das 04:00, e
 * provar o `meta_atraso` exige esperar as 20:00 do último dia de um período
 * semanal — dias de espera para um teste de cinco minutos.
 *
 * Roda o **mesmo** `tique()` do processo de um minuto, e isso é o ponto: um
 * caminho separado de fechamento manual não provaria nada sobre o que roda de
 * madrugada. O que muda é só o instante que entra.
 *
 * ```
 * npm run worker:tique                              # agora
 * npm run worker:tique -- "2026-11-19 04:01"        # a virada de amanhã
 * npm run worker:tique -- 2026-11-19T20:00:00-03:00
 * npm run worker:tique -- "2026-11-19 04:01" --seco # só resolve o instante
 * ```
 *
 * `--seco` mostra que instante, que parede e que dia lógico o argumento produz,
 * e para antes de tocar no banco. Existe porque o argumento é a parte fácil de
 * errar e um tique com o instante errado não é observável: ele materializa,
 * reserva chave de notificação e limpa — e só então se descobre que o dia
 * simulado não era o pretendido.
 *
 * **O instante é lido no fuso do app**, não no do processo — `config_app.timezone`,
 * o mesmo que decide o dia lógico. Num contêiner com `TZ=UTC` as `04:01` pedidas
 * seriam `01:01` em São Paulo, a virada não aconteceria, e o teste concluiria que
 * o worker está quebrado. Quem converte é `instanteDeParede`.
 *
 * ## O que o instante simulado move, e o que não move
 *
 * Move a **avaliação**: qual é o dia lógico de hoje, se já passou a hora de um
 * lembrete, se o período que cobria ontem ainda cobre hoje. É o bastante para
 * fechar período, gastar congelamento e disparar notificação.
 *
 * Não move o **passado**: `registro.criado_em` continua sendo a hora real em que
 * cada marcação foi feita, e `registro.data_logica` continua a do dia em que
 * aconteceu. Simular amanhã não inventa histórico — fecha o período de hoje com
 * os registros que existem agora, que é exatamente o que a virada faria.
 *
 * E tem dois efeitos que um instante distante causa **de verdade**, porque a
 * limpeza do tique é relativa a `agora`: tentativa de login com mais de 24 h e
 * desafio WebAuthn vencido há mais de 24 h são apagados contando do instante
 * simulado. Pular um dia adiante limpa o bloqueio de rate limiting que você
 * talvez estivesse testando. O aviso aparece quando o instante está longe.
 */

const AVISO_DE_DISTANCIA_MS = 5 * 60_000;

/**
 * `2026-11-19 04:01` ou `2026-11-19T04:01[:00]` — **sem fuso é parede do app**.
 *
 * Divergência deliberada do `new Date`: pela especificação, um ISO 8601 sem fuso
 * é lido em **UTC**, e é a armadilha nº 1 do projeto. Aqui a ausência de fuso
 * significa "a hora que aparece no seu relógio", que é o que alguém digitando
 * `04:01` quer dizer ao simular a virada das 04:00.
 */
const PAREDE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Traz fuso embutido — `Z`, `+03:00`, `-0300`. Aí o instante já é absoluto. */
const COM_FUSO = /(?:Z|[+-]\d{2}:?\d{2})$/i;

type Alvo = { instante: Date; comoFoiLido: string };

function alvoDe(argumento: string | undefined, timezone: string): Alvo {
  if (argumento === undefined) {
    return { instante: new Date(), comoFoiLido: "agora" };
  }

  const parede = PAREDE.exec(argumento);

  if (parede !== null) {
    const [, ano, mes, dia, hora, minuto, segundo] = parede;

    return {
      instante: instanteDeParede(
        {
          ano: Number(ano),
          mes: Number(mes),
          dia: Number(dia),
          hora: Number(hora),
          minuto: Number(minuto),
          segundo: segundo === undefined ? 0 : Number(segundo),
        },
        timezone,
      ),
      comoFoiLido: `hora de parede em ${timezone}`,
    };
  }

  if (COM_FUSO.test(argumento)) {
    const instante = new Date(argumento);

    if (Number.isNaN(instante.getTime())) {
      throw new Error(`Não consegui ler "${argumento}" como instante.`);
    }

    return { instante, comoFoiLido: "instante absoluto, fuso dado no argumento" };
  }

  /*
   * Recusa em vez de adivinhar. `new Date("2026-11-19T04:01:00")` sem fuso é
   * meia-noite **UTC** pela especificação — a armadilha nº 1 do projeto — e aqui
   * ela sairia como "a virada não aconteceu", que é um diagnóstico errado sobre
   * o worker em vez de um erro sobre o argumento.
   */
  throw new Error(
    `Não consegui ler "${argumento}".\n` +
      `Use "AAAA-MM-DD HH:MM" (hora de parede do app) ou um ISO 8601 com fuso ` +
      `explícito, como 2026-11-19T04:01:00-03:00.`,
  );
}

async function principal(): Promise<number> {
  const relogio = await relogioAtual();
  const bandeiras = process.argv.slice(2).filter((a) => a.startsWith("--"));
  const argumento = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const { instante, comoFoiLido } = alvoDe(argumento, relogio.timezone);
  const seco = bandeiras.includes("--seco");

  const distancia = Math.abs(instante.getTime() - Date.now());

  console.log(`
Tique manual
────────────
  instante      ${instante.toISOString()}  (${comoFoiLido})
  parede        ${horaDeParede(instante, relogio.timezone)} em ${relogio.timezone}
  dia lógico    ${dataLogicaDe(instante, relogio)}  (vira às ${String(relogio.horaVirada).padStart(2, "0")}:00)`);

  if (distancia > AVISO_DE_DISTANCIA_MS) {
    const horas = Math.round(distancia / 3_600_000);

    console.log(`
  ⚠ ${horas} h de distância do agora real. A limpeza do tique conta a partir
    deste instante: tentativas de login e desafios WebAuthn com mais de 24 h em
    relação a ele serão apagados. Se você estava testando o bloqueio por
    tentativas, ele será liberado.`);
  }

  if (seco) {
    console.log(`\n  --seco: nada foi executado.\n`);
    return 0;
  }

  const relatorio = await tique(instante);

  const { materializados, notificacoes, limpezas, erros } = relatorio;

  /*
   * Imprime sempre, inclusive o tique que não fez nada. O processo de um minuto
   * cala quando não houve evento, porque 1440 linhas por dia enterrariam o que
   * importa; aqui o silêncio seria indistinguível de "não rodou".
   */
  console.log(`
Resultado
─────────
  períodos materializados   ${materializados}
  notificações              ${notificacoes.novas} novas · ${notificacoes.enviadas} enviadas · ${notificacoes.baixadas} baixadas · ${notificacoes.falhas} falhas
  limpeza                   ${limpezas.tentativas} tentativas · ${limpezas.desafios} desafios`);

  if (erros.length === 0) {
    console.log("\n  sem erros\n");
    return 0;
  }

  console.error("\n  erros:");
  for (const erro of erros) console.error(`    ${erro}`);
  console.error("");

  /*
   * Saída não-zero: as três etapas do tique são capturadas em separado para que
   * uma falha de rede não impeça o fechamento, então o processo do minuto segue
   * de pé. Rodando à mão, o que se quer é o contrário — o shell precisa dizer
   * que falhou.
   */
  return 1;
}

principal()
  .then((codigo) => {
    process.exitCode = codigo;
  })
  .catch((erro: unknown) => {
    console.error(`\n${erro instanceof Error ? erro.message : String(erro)}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/db/knex";
import {
  COOKIE_SESSAO,
  lerDica,
  valorDoCookie,
  type EstadoDeSessao,
} from "./cookie-sessao";
import { emDesenvolvimento } from "./modo";

/**
 * A sessão, agora no Postgres.
 *
 * O cookie leva um token opaco; o banco guarda só o **hash** dele. A razão é a
 * de sempre para credencial: um dump do banco — backup, log de replicação, olho
 * em cima do `psql` — não pode conter nada que abra uma sessão. O token em claro
 * existe em dois lugares apenas: no cookie `httpOnly` e, por um instante, na
 * memória de quem o gerou.
 *
 * SHA-256 e não Argon2id aqui, de propósito. Argon2id existe para resistir a
 * força bruta sobre segredos **que humanos escolhem**, e paga caro por isso. Um
 * token de 32 bytes aleatórios não tem espaço de busca a reduzir: hash rápido é
 * suficiente, e precisa ser rápido porque é conferido em toda requisição.
 *
 * Atributos conforme o
 * [Mapa de autenticação](../Docs/mapas/Mapa%20de%20autenticação.md): `httpOnly`,
 * `SameSite=Lax`, 30 dias com renovação por uso. `Secure` só em produção — em
 * desenvolvimento o app roda em `http://localhost` e um cookie `Secure`
 * simplesmente não seria gravado, deixando o login quebrado só na máquina de
 * desenvolvimento.
 */

export { COOKIE_SESSAO };

const TRINTA_DIAS_EM_SEGUNDOS = 60 * 60 * 24 * 30;
const TRINTA_DIAS_EM_MS = TRINTA_DIAS_EM_SEGUNDOS * 1000;

/**
 * A folga antes de renovar.
 *
 * Renovar a cada requisição custaria um `UPDATE` por chamada de API sem ganho
 * nenhum. Com a folga de um dia, a renovação acontece no máximo uma vez por dia
 * de uso — e quem usa o app todo dia nunca vê a sessão expirar.
 */
const FOLGA_DE_RENOVACAO_EM_MS = 1000 * 60 * 60 * 24;

export type Sessao = {
  id: string;
  /**
   * `false` enquanto não existe passkey cadastrada. Nesse estado a sessão existe
   * mas só abre a tela de biometria — é o "não existe estado intermediário
   * utilizável" do mapa de autenticação.
   *
   * Derivado de `credencial_passkey`, **não** do cookie: é o que faz a dica do
   * cookie ser apenas uma dica.
   */
  temPasskey: boolean;
};

function hashDeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A dica que vai no cookie.
 *
 * Em desenvolvimento a sessão nasce `completa` mesmo sem passkey: `APP_MODO`
 * afrouxa o pedágio, e deixar a dica em `provisoria` faria o proxy devolver o
 * usuário para `/biometria` a cada navegação numa sessão que o portão já aceita.
 * A dica acompanha a decisão do portão, nunca a contradiz — ver
 * [http.ts](http.ts).
 */
function estadoDe(temPasskey: boolean): EstadoDeSessao {
  return temPasskey || emDesenvolvimento() ? "completa" : "provisoria";
}

async function existePasskey(): Promise<boolean> {
  const linha = await db("credencial_passkey").first("id");
  return linha !== undefined;
}

/**
 * Lê a sessão do cookie e confere contra o banco.
 *
 * **Não escreve nada** — nem no banco, nem no cookie. É o que permite chamá-la
 * de qualquer lugar, componente de servidor incluído, onde o Next proíbe mexer
 * em cookie. Quem renova é `renovar()`, chamada pelo portão das rotas.
 */
export async function sessaoAtual(): Promise<Sessao | null> {
  const cookieStore = await cookies();
  const dica = lerDica(cookieStore.get(COOKIE_SESSAO)?.value);
  if (dica === null) return null;

  const linha = await db("sessao")
    .where({ token_hash: hashDeToken(dica.token) })
    .whereNull("revogada_em")
    .where("expira_em", ">", new Date())
    .first("id", "expira_em");

  if (linha === undefined) return null;

  return { id: linha.id, temPasskey: await existePasskey() };
}

/**
 * Estende a validade, no banco e no cookie, quando falta menos de um dia.
 *
 * Os dois juntos porque de nada serve renovar a linha se o navegador descarta o
 * cookie: o `maxAge` é o que decide se ele chega na próxima visita.
 */
export async function renovar(sessao: Sessao): Promise<void> {
  const linha = await db("sessao").where({ id: sessao.id }).first("expira_em");
  if (linha === undefined) return;

  const alvo = Date.now() + TRINTA_DIAS_EM_MS;
  if (linha.expira_em.getTime() > alvo - FOLGA_DE_RENOVACAO_EM_MS) return;

  await db("sessao").where({ id: sessao.id }).update({ expira_em: new Date(alvo) });

  const cookieStore = await cookies();
  const valor = cookieStore.get(COOKIE_SESSAO)?.value;
  if (valor === undefined) return;

  gravarCookie(cookieStore, valor);
}

type Jar = Awaited<ReturnType<typeof cookies>>;

function gravarCookie(cookieStore: Jar, valor: string): void {
  cookieStore.set({
    name: COOKIE_SESSAO,
    value: valor,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TRINTA_DIAS_EM_SEGUNDOS,
  });
}

/**
 * Abre uma sessão: grava a linha, devolve o cookie.
 *
 * O `user_agent` é guardado só para a tela de Ajustes poder dizer de onde a
 * sessão veio. Não participa de nenhuma decisão de autorização — fixar sessão a
 * user agent quebra em atualização de navegador e não impede nada.
 */
export async function abrirSessao(req?: Request): Promise<Sessao> {
  const token = randomBytes(32).toString("base64url");
  const temPasskey = await existePasskey();

  const [linha] = await db("sessao")
    .insert({
      token_hash: hashDeToken(token),
      expira_em: new Date(Date.now() + TRINTA_DIAS_EM_MS),
      user_agent: req?.headers.get("user-agent") ?? null,
    })
    .returning("id");

  const cookieStore = await cookies();
  gravarCookie(cookieStore, valorDoCookie(token, estadoDe(temPasskey)));

  return { id: linha.id, temPasskey };
}

/**
 * Reescreve a dica do cookie sem trocar a sessão.
 *
 * Chamada no cadastro da passkey: a linha de `sessao` continua a mesma, mas a
 * dica tem de passar a dizer `completa`, senão o proxy seguiria mandando o
 * usuário de volta para `/biometria` numa sessão que já está completa.
 */
export async function atualizarDica(temPasskey: boolean): Promise<void> {
  const cookieStore = await cookies();
  const dica = lerDica(cookieStore.get(COOKIE_SESSAO)?.value);
  if (dica === null) return;

  gravarCookie(cookieStore, valorDoCookie(dica.token, estadoDe(temPasskey)));
}

/** Encerra a sessão atual: revoga a linha e apaga o cookie. */
export async function fecharSessao(): Promise<void> {
  const cookieStore = await cookies();
  const dica = lerDica(cookieStore.get(COOKIE_SESSAO)?.value);

  if (dica !== null) {
    await db("sessao")
      .where({ token_hash: hashDeToken(dica.token) })
      .whereNull("revogada_em")
      .update({ revogada_em: new Date() });
  }

  cookieStore.delete(COOKIE_SESSAO);
}

/**
 * Revoga **todas** as sessões. Devolve quantas caíram.
 *
 * Acontece em todo reset e em todo cadastro de nova passkey, conforme o mapa: a
 * credencial de acesso mudou, então nenhuma sessão aberta sob a credencial
 * antiga continua valendo.
 */
export async function revogarTodasAsSessoes(): Promise<number> {
  return db("sessao").whereNull("revogada_em").update({ revogada_em: new Date() });
}

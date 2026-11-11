import * as z from "zod";
import { instante } from "./comum";

/**
 * Contrato de autenticação.
 *
 * Fluxo de porta única: primeiro acesso com senha, cadastro da passkey, senha
 * desativada. Detalhes em
 * [Mapa de autenticação](../Docs/mapas/Mapa%20de%20autenticação.md).
 *
 * **Os payloads do WebAuthn são deliberadamente frouxos.** Eles não são formato
 * nosso: são `PublicKeyCredentialCreationOptionsJSON` e as respostas do
 * navegador, definidos pela especificação e produzidos/consumidos pela
 * biblioteca de WebAuthn. Reescrevê-los em Zod criaria uma segunda definição
 * para divergir da primeira, sem ganho — o que valida esses dados é a
 * verificação criptográfica do servidor, não um schema de forma. O que é nosso
 * (o envelope, o estado, a confirmação do reset) está tipado com rigor.
 */

/** GET /api/auth/estado — a tela de login decide o que mostrar com isto. */
export const estadoAuth = z.object({
  autenticado: z.boolean(),
  /** Com passkey cadastrada, o login mostra só "Entrar com biometria". */
  temPasskey: z.boolean(),
  /** Desativada depois do cadastro da passkey; reativada por um reset. */
  senhaAtiva: z.boolean(),
  /** Rate limiting em curso: instante em que o bloqueio termina. */
  bloqueadoAte: instante.nullable(),
});
export type EstadoAuth = z.infer<typeof estadoAuth>;

/**
 * POST /api/auth/senha — só a senha; não há campo de usuário.
 *
 * Sem `.max()` nem exigência de formato: é a senha que já existe no banco, e
 * recusá-la por formato aqui só adiantaria ao atacante que ela não serve. O
 * mínimo de 1 existe para não gastar um Argon2id com string vazia.
 */
export const loginComSenha = z.strictObject({
  senha: z.string().min(1, "Informe a senha."),
});
export type LoginComSenha = z.infer<typeof loginComSenha>;

export const PROXIMO_PASSO = ["cadastrar_biometria", "dashboard"] as const;

export const loginConcluido = z.object({
  proximoPasso: z.enum(PROXIMO_PASSO),
});
export type LoginConcluido = z.infer<typeof loginConcluido>;

/**
 * Opções do WebAuthn, como a especificação as define. Ver a nota no topo do
 * arquivo sobre por que isto não é tipado em detalhe.
 */
export const opcoesWebauthn = z.looseObject({
  challenge: z.string(),
  rpId: z.string().optional(),
});
export type OpcoesWebauthn = z.infer<typeof opcoesWebauthn>;

/** POST /api/auth/webauthn/registro e .../login — a resposta do navegador. */
export const credencialWebauthn = z.strictObject({
  credencial: z.looseObject({ id: z.string(), type: z.string() }),
  /** Apelido opcional do dispositivo, para a tela de ajustes. */
  apelido: z.string().trim().min(1).max(40).optional(),
});
export type CredencialWebauthn = z.infer<typeof credencialWebauthn>;

export const passkeyCadastrada = z.object({
  apelido: z.string().nullable(),
  criadaEm: instante,
  ultimoUsoEm: instante.nullable(),
  /** A senha fica inativa a partir daqui. */
  senhaAtiva: z.boolean(),
});
export type PasskeyCadastrada = z.infer<typeof passkeyCadastrada>;

/**
 * POST /api/auth/biometria/reset
 *
 * Ação destrutiva: apaga a passkey, reativa a senha e revoga as sessões. A
 * confirmação digitada é exigida no contrato, não só na interface — assim um
 * POST acidental (um retry, uma aba antiga) não derruba o único caminho de
 * entrada do app.
 */
export const CONFIRMACAO_RESET = "RESETAR BIOMETRIA";

export const resetarBiometria = z.strictObject({
  confirmacao: z.literal(
    CONFIRMACAO_RESET,
    `Digite exatamente "${CONFIRMACAO_RESET}" para confirmar.`,
  ),
});
export type ResetarBiometria = z.infer<typeof resetarBiometria>;

export const biometriaResetada = z.object({
  /** Senha provisória, mostrada **uma única vez**. */
  senhaProvisoria: z.string(),
  sessoesRevogadas: z.int().min(0),
});
export type BiometriaResetada = z.infer<typeof biometriaResetada>;

export const ok = z.object({ ok: z.literal(true) });
export type Ok = z.infer<typeof ok>;

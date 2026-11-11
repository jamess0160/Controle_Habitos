import type { EstadoAuth, LoginConcluido, PasskeyCadastrada } from "./auth";
import type { Habito, ListaDeHabitos } from "./habito";
import type { Hoje } from "./hoje";
import type { ConfigApp, Exportacao, StatusPush } from "./infra";
import type { RegistroCriado, Retroativo, RetroativoAplicado } from "./registro";

/**
 * Fixtures dos responses.
 *
 * Servem a dois propósitos: os stubs da etapa 1.5 devolvem exatamente isto, e os
 * testes de contrato validam cada uma contra o próprio schema. A segunda parte é
 * o que importa — fixture que não passa no schema é promessa falsa, e a tela
 * construída sobre ela quebraria na troca pelo backend real.
 *
 * Datas fixas em novembro de 2026 de propósito: fixture com `new Date()` muda de
 * forma a cada execução e deixa de servir de referência.
 */

const ID = {
  agua: "5eed0001-0000-4000-8000-000000000001",
  correr: "5eed0001-0000-4000-8000-000000000002",
  vitamina: "5eed0001-0000-4000-8000-000000000006",
  periodoAgua: "5eed0002-0000-4000-8000-000000000001",
  periodoCorrer: "5eed0002-0000-4000-8000-000000000002",
  periodoVitamina: "5eed0002-0000-4000-8000-000000000003",
  ocorrenciaVitamina: "5eed0003-0000-4000-8000-000000000001",
  registro: "5eed0004-0000-4000-8000-000000000001",
} as const;

export const habitoAgua: Habito = {
  id: ID.agua,
  nome: "💧 Água",
  cor: "ciano",
  inicioEm: "2026-10-12",
  ordem: 1,
  config: {
    modo: "flexivel",
    cadencia: { tipo: "diario" },
    metaOcorrencias: 1,
    notificarEm: "09:00:00",
    meta: { tipo: "quantificado", valor: 2000, unidade: "ml" },
    congelamento: { aCada: 3, max: 3 },
  },
  resumo: "Todo dia, 2000 ml",
  sequencia: { atual: 24, recorde: 24, totalNoPrazo: 24, desde: "2026-10-13" },
  congelamentosDisponiveis: 3,
  pausa: null,
  arquivadoEm: null,
};

export const habitoCorrer: Habito = {
  id: ID.correr,
  nome: "🏃 Correr",
  cor: "vermelho",
  inicioEm: "2026-10-12",
  ordem: 2,
  config: {
    modo: "flexivel",
    cadencia: { tipo: "semanal" },
    metaOcorrencias: 3,
    notificarEm: "18:00:00",
    meta: { tipo: "binario" },
    congelamento: { aCada: 2, max: 2 },
  },
  resumo: "3x por semana",
  sequencia: { atual: 3, recorde: 3, totalNoPrazo: 3, desde: "2026-10-18" },
  congelamentosDisponiveis: 1,
  pausa: null,
  arquivadoEm: null,
};

/** Modo fixo: a única variante que materializa ocorrências. */
export const habitoVitamina: Habito = {
  id: ID.vitamina,
  nome: "💊 Vitamina D",
  cor: "azul",
  inicioEm: "2026-10-12",
  ordem: 3,
  config: {
    modo: "fixo",
    cadencia: { tipo: "semanal", diasSemana: [2, 4, 6], horarios: ["08:00:00"] },
    meta: { tipo: "binario" },
    congelamento: { aCada: 3, max: 2 },
  },
  resumo: "Seg, qua e sex às 08:00",
  sequencia: { atual: 9, recorde: 9, totalNoPrazo: 9, desde: "2026-10-12" },
  congelamentosDisponiveis: 2,
  pausa: null,
  arquivadoEm: null,
};

export const habitoPausado: Habito = {
  id: "5eed0001-0000-4000-8000-000000000003",
  nome: "🧘 Meditar",
  cor: "roxo",
  inicioEm: "2026-10-12",
  ordem: 4,
  config: {
    modo: "flexivel",
    cadencia: { tipo: "diario" },
    metaOcorrencias: 1,
    notificarEm: "06:30:00",
    meta: { tipo: "duracao", minutos: 10 },
    congelamento: null,
  },
  resumo: "Todo dia, 10 min",
  sequencia: { atual: 8, recorde: 14, totalNoPrazo: 22, desde: "2026-11-02" },
  congelamentosDisponiveis: 0,
  pausa: { de: "2026-11-09", ate: null },
  arquivadoEm: null,
};

export const habitoArquivado: Habito = {
  id: "5eed0001-0000-4000-8000-000000000009",
  nome: "🚬 Parar de fumar",
  cor: "ambar",
  inicioEm: "2026-08-01",
  ordem: 9,
  config: {
    modo: "flexivel",
    cadencia: { tipo: "mensal" },
    metaOcorrencias: 1,
    notificarEm: null,
    meta: { tipo: "negativo", tolerancia: 2 },
    congelamento: null,
  },
  resumo: "Por mês, até 2 recaídas",
  sequencia: { atual: 0, recorde: 2, totalNoPrazo: 2, desde: null },
  congelamentosDisponiveis: 0,
  pausa: null,
  arquivadoEm: "2026-10-30T18:00:00.000-03:00",
};

export const listaDeHabitosFixture: ListaDeHabitos = {
  habitos: [habitoAgua, habitoCorrer, habitoVitamina, habitoPausado],
  arquivados: [habitoArquivado],
};

/**
 * Dashboard de uma terça-feira à tarde.
 *
 * Cobre as quatro formas de progresso e as duas linhas que um hábito fixo com
 * horário gera — a tela precisa resolver isso no layout, não só no caminho feliz.
 */
export const hojeFixture: Hoje = {
  saudacao: "boa_tarde",
  usuarioNome: "Tiago",
  dataLogica: "2026-11-10",
  geradoEm: "2026-11-10T15:20:00.000-03:00",
  linhas: [
    {
      habitoId: ID.agua,
      nome: "💧 Água",
      cor: "ciano",
      periodoId: ID.periodoAgua,
      ocorrenciaId: null,
      horario: null,
      concluida: false,
      progresso: { tipo: "quantificado", acumulado: 1400, meta: 2000, unidade: "ml" },
      sequencia: 24,
      congelamentos: 3,
    },
    {
      habitoId: ID.correr,
      nome: "🏃 Correr",
      cor: "vermelho",
      periodoId: ID.periodoCorrer,
      ocorrenciaId: null,
      horario: null,
      concluida: false,
      progresso: { tipo: "binario", concluidas: 2, meta: 3 },
      sequencia: 3,
      congelamentos: 1,
    },
    {
      habitoId: ID.vitamina,
      nome: "💊 Vitamina D",
      cor: "azul",
      periodoId: ID.periodoVitamina,
      ocorrenciaId: ID.ocorrenciaVitamina,
      horario: "08:00:00",
      concluida: true,
      progresso: { tipo: "binario", concluidas: 1, meta: 3 },
      sequencia: 9,
      congelamentos: 2,
    },
    {
      habitoId: habitoArquivado.id,
      nome: "🚬 Parar de fumar",
      cor: "ambar",
      periodoId: "5eed0002-0000-4000-8000-000000000009",
      ocorrenciaId: null,
      horario: null,
      concluida: true,
      progresso: { tipo: "negativo", recaidas: 0, tolerancia: 2 },
      sequencia: 44,
      congelamentos: 0,
    },
  ],
  avisos: [
    {
      tipo: "congelamento_usado",
      habitoId: ID.agua,
      habitoNome: "💧 Água",
      periodoFim: "2026-11-09",
      restantes: 2,
    },
    {
      tipo: "sequencia_perdida",
      habitoId: ID.correr,
      habitoNome: "🏃 Correr",
      periodoFim: "2026-10-17",
      sequenciaPerdida: 4,
    },
  ],
};

export const registroCriadoFixture: RegistroCriado = {
  id: ID.registro,
  habitoId: ID.agua,
  periodoId: ID.periodoAgua,
  ocorrenciaId: null,
  dataLogica: "2026-11-10",
  valor: 700,
  origem: "app",
  criadoEm: "2026-11-10T15:21:00.000-03:00",
  efeitos: {
    sequencia: { atual: 25, recorde: 25, totalNoPrazo: 25, desde: "2026-10-13" },
    congelamentosDisponiveis: 3,
    congelamentoEstornado: false,
    periodoStatus: "cumprido",
    novoVencimento: null,
  },
};

/** Janela de 7 dias com um dia bloqueado por pausa e um período congelado. */
export const retroativoFixture: Retroativo = {
  habitoId: ID.correr,
  nome: "🏃 Correr",
  periodoAtual: { concluidas: 2, meta: 3, fim: "2026-11-14" },
  sequencia: { atual: 3, recorde: 3, totalNoPrazo: 3, desde: "2026-10-18" },
  congelamentosDisponiveis: 1,
  dias: [
    {
      dataLogica: "2026-11-10",
      diaDaSemana: 3,
      hoje: true,
      estado: "nao_cumprido",
      motivoBloqueio: null,
      valor: null,
      registroIds: [],
    },
    {
      dataLogica: "2026-11-09",
      diaDaSemana: 2,
      hoje: false,
      estado: "cumprido",
      motivoBloqueio: null,
      valor: null,
      registroIds: ["5eed0004-0000-4000-8000-000000000002"],
    },
    {
      dataLogica: "2026-11-08",
      diaDaSemana: 1,
      hoje: false,
      estado: "nao_cumprido",
      motivoBloqueio: null,
      valor: null,
      registroIds: [],
    },
    {
      dataLogica: "2026-11-07",
      diaDaSemana: 7,
      hoje: false,
      estado: "cumprido",
      motivoBloqueio: null,
      valor: null,
      registroIds: ["5eed0004-0000-4000-8000-000000000003"],
    },
    {
      dataLogica: "2026-11-06",
      diaDaSemana: 6,
      hoje: false,
      estado: "congelado",
      motivoBloqueio: null,
      valor: null,
      registroIds: [],
    },
    {
      dataLogica: "2026-11-05",
      diaDaSemana: 5,
      hoje: false,
      estado: "bloqueado",
      motivoBloqueio: "em_pausa",
      valor: null,
      registroIds: [],
    },
    {
      dataLogica: "2026-11-04",
      diaDaSemana: 4,
      hoje: false,
      estado: "cumprido",
      motivoBloqueio: null,
      valor: null,
      registroIds: ["5eed0004-0000-4000-8000-000000000004"],
    },
  ],
};

/** Prévia num hábito `cada_n_dias`: mostra o vencimento que vai resultar. */
export const retroativoPreviaFixture: RetroativoAplicado = {
  persistido: false,
  efeitos: {
    sequencia: { atual: 12, recorde: 12, totalNoPrazo: 12, desde: "2026-10-15" },
    congelamentosDisponiveis: 2,
    congelamentoEstornado: true,
    periodoStatus: "cumprido",
    novoVencimento: "2026-11-13",
  },
  dias: retroativoFixture.dias,
};

export const estadoAuthFixture: EstadoAuth = {
  autenticado: false,
  temPasskey: true,
  senhaAtiva: false,
  bloqueadoAte: null,
};

export const estadoAuthPrimeiroAcessoFixture: EstadoAuth = {
  autenticado: false,
  temPasskey: false,
  senhaAtiva: true,
  bloqueadoAte: null,
};

export const estadoAuthBloqueadoFixture: EstadoAuth = {
  autenticado: false,
  temPasskey: false,
  senhaAtiva: true,
  bloqueadoAte: "2026-11-10T15:35:00.000-03:00",
};

export const loginConcluidoFixture: LoginConcluido = {
  proximoPasso: "cadastrar_biometria",
};

export const passkeyCadastradaFixture: PasskeyCadastrada = {
  apelido: "iPhone",
  criadaEm: "2026-10-12T09:00:00.000-03:00",
  ultimoUsoEm: "2026-11-10T08:12:00.000-03:00",
  senhaAtiva: false,
};

export const statusPushFixture: StatusPush = {
  assinado: true,
  ultimoEnvioEm: "2026-11-10T09:00:00.000-03:00",
  invalidaEm: null,
};

export const configAppFixture: ConfigApp = {
  usuarioNome: "Tiago",
  horaVirada: "04:00:00",
  timezone: "America/Sao_Paulo",
  rpId: "habitos.exemplo.dev",
  push: statusPushFixture,
  passkey: {
    apelido: "iPhone",
    criadaEm: "2026-10-12T09:00:00.000-03:00",
    ultimoUsoEm: "2026-11-10T08:12:00.000-03:00",
  },
};

export const exportacaoFixture: Exportacao = {
  geradoEm: "2026-11-10T15:30:00.000-03:00",
  versao: 1,
  habitos: [habitoAgua, habitoCorrer],
  registros: [
    {
      habitoId: ID.agua,
      dataLogica: "2026-11-10",
      valor: 700,
      origem: "app",
      criadoEm: "2026-11-10T09:30:00.000-03:00",
    },
    {
      // Marcação à 01:30 pertence ao dia lógico anterior — o caso que o
      // exportado precisa preservar para a importação não deslocar o histórico.
      habitoId: ID.agua,
      dataLogica: "2026-11-06",
      valor: 700,
      origem: "app",
      criadoEm: "2026-11-07T01:30:00.000-03:00",
    },
  ],
};

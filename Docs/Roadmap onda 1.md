# Roadmap — onda 1

Sequenciamento da primeira entrega. O comportamento está definido nos [mapas](mapas/); aqui está só a ordem de execução, o que cada etapa entrega e o critério para considerá-la fechada.

Escopo da onda 1: login, biometria, dashboard, lista de hábitos, cadastro/edição, retroativo de 7 dias, ajustes, notificações push, rate limiting e CLI de reset. Fora de escopo: tela de detalhe/histórico do hábito (onda 2) e uso offline (descartado).

| Etapa | Entrega | Tamanho |
|---|---|---|
| 1 | Banco, núcleo de domínio e contratos | G |
| 2 | Layout com dados falsos | M |
| 3 | Desenvolvimento com cobertura de testes | G |
| 4 | Testes manuais (você) | M |
| 5 | Deploy e documentação | M |

---

## Etapa 1 — Banco, núcleo de domínio e contratos

Objetivo: ter o schema aplicável, a lógica de domínio provada, e os contratos de API escritos em código, de modo que a etapa 2 possa consumir rotas reais com dados falsos.

### 1.1 Infraestrutura local

- [x] `docker-compose.dev.yml` com Postgres 16 e volume nomeado
- [x] `.env.example` com `DATABASE_URL`, `APP_USUARIO_NOME`, `APP_SENHA_INICIAL`, `RP_ID`, chaves VAPID
- [x] `knexfile.ts` lendo `DATABASE_URL`, client `pg`, rodando sob `tsx`
- [x] instância Knex singleton em `globalThis` para o hot reload do Next não vazar pools
- [x] scripts `db:make`, `db:migrate`, `db:rollback`, `db:seed`

### 1.2 Migrations e seeds

Ordem importa: enums antes das tabelas, tabelas de domínio antes das dependentes.

- [x] extensão `pgcrypto`; enums `habito_tipo`, `cadencia_tipo`, `modo_tipo`, `periodo_status`, `ocorrencia_status`, `registro_origem`, `congelamento_status`
- [x] domínio: `habito`, `habito_config`, `habito_periodo`, `habito_ocorrencia`, `registro`, `congelamento`, `habito_streak`
- [x] auth/infra: `credencial_senha`, `credencial_passkey`, `webauthn_desafio`, `sessao`, `tentativa_login`, `push_subscription`, `notificacao_enviada`, `config_app`
- [x] todos os CHECKs do [Mapa do banco](mapas/Mapa%20do%20banco.md) — são a defesa contra configuração sem sentido, não decoração
- [x] índices, inclusive os parciais (`congelamento` disponível, `habito_config` vigente)
- [x] tipos de linha em TypeScript registrados via `Knex.TableType`
- [x] seed de `config_app` e `credencial_senha` a partir do `.env`
- [ ] seed de desenvolvimento: 6 hábitos cobrindo os 4 tipos e as 4 cadências, com histórico de 30 dias

**Fechada quando** `db:migrate` + `db:rollback` + `db:migrate` rodam limpos do zero, e o seed de desenvolvimento popula um banco navegável.

### 1.3 Núcleo de domínio

Funções puras, sem I/O e sem `new Date()` interno — **o instante atual entra sempre por parâmetro**. É o que torna a virada das 04:00 testável, e é a parte onde mora o risco do projeto.

- [ ] `data_logica(ts)` e fronteiras de período por cadência (semana começando domingo)
- [ ] geração de períodos sob demanda nas 4 cadências, com `cada_n_dias` ancorado na última conclusão
- [ ] geração de ocorrências do modo `fixo` a partir de `dias_semana` / `dias_mes` / `horarios`
- [ ] avaliação de meta por tipo (binário, quantificado, duração, negativo)
- [ ] fechamento de período: `cumprido` / `congelado` / `falhou`, com consumo FIFO de congelamento
- [ ] ganho de congelamento e teto de estoque
- [ ] cálculo de sequência, recorde e `total_no_prazo`
- [ ] recálculo retroativo, incluindo **re-encadeamento de `cada_n_dias`** e estorno de congelamento
- [ ] deslocamento de âncora por pausa

> Puxei a cobertura de testes desta sub-etapa para cá, antes da etapa 3 que você definiu como o momento dos testes. Motivo: o schema só está validado quando essa lógica roda contra ele, e descobrir na etapa 3 que `cada_n_dias` precisa de outra coluna custa refazer migration já aplicada. São testes de função pura, baratos de escrever e sem dependência de UI. Se preferir manter tudo na etapa 3, é só mover.

**Fechada quando** os casos difíceis passam: registro à 01:30 contando para o dia anterior, conclusão antecipada em `cada_n_dias` encurtando o período, retroativo re-encadeando a cadeia, congelamento esgotado levando a `falhou`, pausa de 20 dias não gerando vencimento estourado.

### 1.4 Contratos

**Zod v4** como fonte única: o schema é escrito uma vez e o tipo sai dele por inferência, então não existe o risco de tipo e validação divergirem. Roda no servidor e no cliente, o que deixa o formulário usar a validação real em vez de uma cópia à mão.

```ts
// contracts/habito.ts — schema e tipo no mesmo módulo, usado nos dois lados
export const criarHabito = z.object({ nome: z.string().min(1), cor: corToken })
  .and(z.discriminatedUnion("modo", [modoFlexivel, modoFixo]));

export type CriarHabito = z.infer<typeof criarHabito>;
```

- [ ] pasta `contracts/` com um módulo por recurso, schema e tipo juntos
- [ ] request e response de cada rota, com os erros padronizados
- [ ] helper `validar(schema, payload)` usado por todo route handler
- [ ] `habito_config` como **união discriminada** em `modo` e em `tipo`
- [ ] mensagens de erro em pt-BR centralizadas
- [ ] testes de contrato: cada fixture de response valida contra o próprio schema

> A união discriminada é o que faz a tabela de CHECKs do [Mapa do banco](mapas/Mapa%20do%20banco.md) existir também no tipo: com `modo: "fixo"`, `horarios` está presente e `meta_ocorrencias` nem compila. Sem isso o tipo vira um objeto largo com tudo opcional e null-check espalhado pelo domínio.

### 1.5 Rotas declaradas (stubs)

Route handlers do App Router já com validação ligada e devolvendo **fixtures**, não lógica. É o que deixa a etapa 2 consumir contratos reais.

| Grupo | Rotas |
|---|---|
| Auth | `GET /api/auth/estado` · `POST /api/auth/senha` · `POST /api/auth/webauthn/registro/opcoes` · `POST /api/auth/webauthn/registro` · `POST /api/auth/webauthn/login/opcoes` · `POST /api/auth/webauthn/login` · `POST /api/auth/logout` · `POST /api/auth/biometria/reset` |
| Dashboard | `GET /api/hoje` (interações devidas, sequência por hábito, avisos, saudação) |
| Hábitos | `GET /api/habitos` · `POST /api/habitos` · `GET /api/habitos/:id` · `PATCH /api/habitos/:id` (nova versão de config) · `PUT /api/habitos/ordem` · `POST\|DELETE /api/habitos/:id/pausa` · `POST\|DELETE /api/habitos/:id/arquivo` |
| Registros | `POST /api/registros` · `DELETE /api/registros/:id` · `GET /api/habitos/:id/retroativo` · `POST /api/habitos/:id/retroativo` |
| Infra | `POST\|DELETE /api/push/assinatura` · `POST /api/push/teste` · `GET\|PATCH /api/config` · `GET /api/exportar` |

- [ ] stubs com validação de entrada ativa e fixture de saída
- [ ] middleware de sessão (cookie httpOnly) e guarda "sem passkey ⇒ só a tela de biometria"

**Fechada quando** todo contrato existe em código, os stubs respondem fixtures válidas contra os próprios schemas, e um `GET /api/hoje` devolve o payload que o dashboard precisa.

---

## Etapa 2 — Layout com dados falsos

Telas reais em Next + Tailwind, consumindo os stubs da etapa 1. Nada de backend de verdade aqui.

- [ ] paleta de cores fechada (resolve a pendência do [Mapa de telas](mapas/Mapa%20de%20telas.md)) e tokens em `@theme inline`
- [ ] shell da PWA: manifest, ícones, barra inferior de 3 destinos, tema claro/escuro
- [ ] 7 telas navegáveis: login, cadastro de biometria, dashboard, lista, cadastro/edição, retroativo, ajustes
- [ ] estados que não aparecem no caminho feliz: vazio, carregando, erro, hábito pausado, dia todo cumprido, bloqueio por tentativas
- [ ] linha do dashboard nas 4 variantes de tipo, com `🔥` e `❄` por hábito
- [ ] formulário de cadastro em 6 passos, com o modo flexível/fixo como escolha excludente e o texto explicando o congelamento automático
- [ ] validação na PWA instalada do celular — alvos de toque, alcance do polegar, leitura ao sol

**Fechada quando** você navega o app inteiro no celular com dados falsos e aprova a estrutura.

---

## Etapa 3 — Desenvolvimento

Substituir stubs por implementação real, tela e rota em pares, cada fatia entregue com teste.

### 3.1 Autenticação
- [ ] senha com Argon2id, sessão com token opaco (hash no banco)
- [ ] rate limiting: atraso progressivo + bloqueio de 15 min, IP lido de `CF-Connecting-IP`
- [ ] WebAuthn registro e login, `counter` anti-clonagem, desativação da senha
- [ ] reset pela interface, com revogação de sessões
- [ ] trava de `rp_id` divergente com mensagem própria

### 3.2 Hábitos
- [ ] CRUD com **versionamento** de `habito_config` (nunca UPDATE)
- [ ] formulário validando com o mesmo schema do contrato, sem lógica espelhada no cliente
- [ ] pausa agendada e aberta, arquivar e desarquivar
- [ ] reordenação por arraste persistindo `habito.ordem`

### 3.3 Registro e dashboard
- [ ] `GET /api/hoje` real, uma linha por interação devida
- [ ] marcação por tipo: binário, incremento quantificado, recaída negativa
- [ ] cronômetro de `duracao`: `iniciado_em` em `sessionStorage`, tempo por diferença de relógio, **nunca acumulado por `setInterval`** (o navegador estrangula timers em segundo plano e a conta chega errada ao voltar); sobrevive minimizado, morre com o app fechado

### 3.4 Retroativo
- [ ] janela de 7 dias, marcar e desmarcar, bloqueios visíveis com motivo
- [ ] recálculo de sequência e estorno de congelamento
- [ ] re-encadeamento de `cada_n_dias` com o novo vencimento mostrado antes de confirmar

### 3.5 Worker e notificações
- [ ] processo separado no compose, tick de 1 minuto
- [ ] fechamento de período, geração do próximo, ganho de congelamento
- [ ] push com VAPID e service worker; `lembrete`, `meta_atraso`, `congelamento_usado`, `sequencia_perdida`
- [ ] idempotência via `notificacao_enviada`; baixa de `push_subscription` em 404/410
- [ ] limpeza de `tentativa_login` e `webauthn_desafio`

### 3.6 CLI
- [ ] `cli:reset-biometria` e `cli:reset-senha`, transacionais, com confirmação interativa e senha provisória aleatória impressa uma vez

### 3.7 Testes (Jest)
- [ ] configuração via `next/jest`
- [ ] **unit**: núcleo de domínio com relógio injetado
- [ ] **integração**: route handlers contra Postgres real de teste, migrations aplicadas, truncate entre casos
- [ ] **componente**: telas com React Testing Library sobre os fixtures dos contratos
- [ ] cenários obrigatórios: virada das 04:00, `cada_n_dias` re-encadeado, congelamento esgotado, pausa, senha desativada recusando login, bloqueio por tentativas

**Fechada quando** a suíte passa, nenhuma rota devolve fixture, e o fluxo completo roda contra o Postgres local.

---

## Etapa 4 — Testes manuais

Executados por você. Entrego um roteiro em `Docs/Roteiro de testes.md` antes desta etapa começar, cobrindo:

- [ ] primeiro acesso, cadastro de biometria, reentrada por biometria, senha recusada depois de desativada
- [ ] reset pela interface e reset pela CLI, com reentrada após cada um
- [ ] um hábito de cada tipo e de cada cadência, do cadastro ao fechamento do período
- [ ] marcação perto da virada das 04:00
- [ ] sequência subindo, congelamento sendo ganho, gasto automaticamente e esgotado
- [ ] retroativo marcando, desmarcando e estornando congelamento
- [ ] `cada_n_dias`: conclusão antecipada e retroativo movendo vencimentos
- [ ] pausa agendada e aberta, arquivar e desarquivar
- [ ] notificações reais no celular, com a PWA instalada e com ela fechada
- [ ] reordenação persistindo

Para não esperar dias por um fechamento de período, o worker ganha um modo de execução manual que aceita um instante simulado — necessário para testar à mão o que depende de calendário.

---

## Etapa 5 — Deploy

- [ ] `output: 'standalone'` no [next.config.ts](../next.config.ts) (ainda não está lá) e Dockerfile multi-stage
- [ ] `docker-compose.yml` de produção: `postgres`, `app`, `worker`, `cloudflared`
- [ ] entrypoint aplicando `knex migrate:latest` na subida
- [ ] geração das chaves VAPID e registro em `config_app`
- [ ] domínio definido e `rp_id` gravado — **imutável depois**, mudar invalida a biometria
- [ ] `pg_dump` agendado no host, com retenção e **uma restauração testada** (backup não verificado não é backup)
- [ ] `Docs/Deploy.md`: subida do zero, variáveis, primeiro acesso, como rodar a CLI de reset, como restaurar backup

**Fechada quando** o app sobe do zero numa máquina limpa seguindo só a documentação, acessível pelo domínio, com notificação chegando no celular.

---

## Riscos conhecidos

| Risco | Onde morde | Mitigação |
|---|---|---|
| Re-encadeamento de `cada_n_dias` | retroativo corrompendo a cronologia | lógica pura com teste dedicado na etapa 1.3, antes de existir UI |
| Push no iOS | só funciona com PWA instalada (iOS 16.4+) | validar no aparelho real já na etapa 2, antes de depender disso |
| `rp_id` imutável | trocar de domínio invalida a biometria | domínio decidido na etapa 5 e gravado; CLI como saída |
| Pool do Knex no dev | hot reload esgotando conexões | singleton em `globalThis` na etapa 1.1 |
| API do Zod mudou na v4 | tutorial de v3 não se aplica | versão fixada na etapa 1.1, contratos escritos contra a v4 |
| Backup de homelab | única cópia do histórico | restauração testada como critério de fechamento da etapa 5 |

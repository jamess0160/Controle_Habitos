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
- [x] seed de desenvolvimento: 6 hábitos cobrindo os 4 tipos e as 4 cadências, com histórico de 30 dias

**Como ficou o seed.** O histórico não é escrito à mão: `db/seeds/03_desenvolvimento.ts` monta só os **registros** (o que você teria tocado) e deixa `simular()` derivar períodos, ocorrências, sequência e congelamentos. Escrever o histórico à mão seria reimplementar o domínio num segundo lugar, com outro resultado.

Isso fez o seed virar a primeira prova de que a saída do domínio assenta no schema — e ela encontrou três coisas, duas delas regras que faltavam:

- `PeriodoSimulado` não dizia **qual** período gerou cada congelamento, e `congelamento.ganho_por_periodo_id` é NOT NULL. Virou o campo `congelamentosGanhos`.
- Janela do modo `fixo` sem nenhum momento devido fechava como `falhou` e zerava a sequência (hábito seg/qua/sex criado num sábado). Agora não gera período.
- `ocorrencia_status` não tinha regra de transição definida. Decidido: `perdida` quando o momento previsto passa, sem esperar o período fechar.

O seed é idempotente por UUID fixo — re-semear apaga só estes 6 hábitos e reconstrói, sem tocar no que você criar à mão — e ignora `NODE_ENV=production`. `db/mapa-dominio.ts` faz a tradução linha larga → união discriminada, e é a fronteira que a etapa 3 vai reusar.

**Fechada quando** `db:migrate` + `db:rollback` + `db:migrate` rodam limpos do zero, e o seed de desenvolvimento popula um banco navegável.

### 1.3 Núcleo de domínio

Funções puras, sem I/O e sem `new Date()` interno — **o instante atual entra sempre por parâmetro**. É o que torna a virada das 04:00 testável, e é a parte onde mora o risco do projeto.

- [x] `data_logica(ts)` e fronteiras de período por cadência (semana começando domingo)
- [x] geração de períodos sob demanda nas 4 cadências, com `cada_n_dias` ancorado na última conclusão
- [x] geração de ocorrências do modo `fixo` a partir de `dias_semana` / `dias_mes` / `horarios`
- [x] avaliação de meta por tipo (binário, quantificado, duração, negativo)
- [x] fechamento de período: `cumprido` / `congelado` / `falhou`, com consumo FIFO de congelamento
- [x] ganho de congelamento e teto de estoque
- [x] cálculo de sequência, recorde e `total_no_prazo`
- [x] recálculo retroativo, incluindo **re-encadeamento de `cada_n_dias`** e estorno de congelamento
- [x] deslocamento de âncora por pausa

> Puxei a cobertura de testes desta sub-etapa para cá, antes da etapa 3 que você definiu como o momento dos testes. Motivo: o schema só está validado quando essa lógica roda contra ele, e descobrir na etapa 3 que `cada_n_dias` precisa de outra coluna custa refazer migration já aplicada. São testes de função pura, baratos de escrever e sem dependência de UI. Se preferir manter tudo na etapa 3, é só mover.

**Como ficou implementado.** O núcleo é um *replay*: `dominio/simulacao.ts` reexecuta a história do hábito desde `inicio_em` sobre os registros que existem agora, e devolve períodos, sequência e estoque de congelamento. As tabelas são a materialização desse resultado, não a fonte dele.

A escolha resolve de graça o problema mais delicado do domínio. Como `cada_n_dias` é ancorado na última conclusão, um preenchimento retroativo move o início de todos os períodos seguintes — não existe "corrigir o período afetado", existe reencadear. Um replay puro reencadeia por construção, e o estorno de congelamento deixa de ser uma operação: na nova execução aquele congelamento simplesmente não é consumido. A camada de persistência compara o resultado com o que está no banco e escreve a diferença (etapa 3.4).

Dois pontos ficaram deliberadamente fora do domínio puro, porque são de persistência: **qual** linha de `congelamento` é consumida (FIFO por `ganho_em`, decidido no repositório — o domínio só conta o estoque) e o registro de `estornado_em` nas linhas afetadas.

**Fechada quando** os casos difíceis passam: registro à 01:30 contando para o dia anterior, conclusão antecipada em `cada_n_dias` encurtando o período, retroativo re-encadeando a cadeia, congelamento esgotado levando a `falhou`, pausa de 20 dias não gerando vencimento estourado.

### 1.4 Contratos

**Zod v4** como fonte única: o schema é escrito uma vez e o tipo sai dele por inferência, então não existe o risco de tipo e validação divergirem. Roda no servidor e no cliente, o que deixa o formulário usar a validação real em vez de uma cópia à mão.

- [x] pasta `contracts/` com um módulo por recurso, schema e tipo juntos
- [x] request e response de cada rota, com os erros padronizados
- [x] helper `validar(schema, payload)` usado por todo route handler
- [x] `habito_config` como **união discriminada** em `modo` e em `tipo`
- [x] mensagens de erro em pt-BR centralizadas
- [x] testes de contrato: cada fixture de response valida contra o próprio schema

> A união discriminada é o que faz a tabela de CHECKs do [Mapa do banco](mapas/Mapa%20do%20banco.md) existir também no tipo: com `modo: "fixo"`, `horarios` está presente e `meta_ocorrencias` nem compila. Sem isso o tipo vira um objeto largo com tudo opcional e null-check espalhado pelo domínio.

**Como ficou implementado.** O exemplo que estava escrito aqui não compila: `z.discriminatedUnion` da v4 **não aceita intersecção como opção** (`Invalid discriminated union option at index "0"`), e não há como discriminar por duas chaves irmãs ao mesmo tempo. A saída foi aninhar — e ela acabou melhor que o plano:

```ts
// contracts/habito.ts
export const configHabito = z.discriminatedUnion("modo", [
  z.strictObject({ modo: z.literal("flexivel"), cadencia: cadenciaFlexivel, metaOcorrencias, notificarEm, meta, congelamento }),
  z.strictObject({ modo: z.literal("fixo"),     cadencia: cadenciaFixa,     meta, congelamento }),
]);
```

`cadencia` e `meta` são uniões discriminadas aninhadas, com a mesma forma de `dominio/periodo.ts` e `dominio/meta.ts`. A exclusividade fica **estrutural**: `cada_n_dias` não existe na `cadenciaFixa`, `dias_semana` existe só na variante semanal, e `metaOcorrencias` com `modo: "fixo"` nem compila. Nenhum refinamento manual replicando CHECK.

Decisões que caíram da escrita:

- **`z.strictObject` nos requests.** Chave desconhecida é recusada, não ignorada: num app de um cliente só, campo extra é bug do formulário, e silenciá-lo esconderia justamente o caso do `icone` que tiramos do modelo.
- **Mensagens próprias, não o locale do Zod.** A v4 traz `pt`, mas é de Portugal ("Demasiado pequeno: esperava que o texto tivesse >= 3 caracteres"). `contracts/mensagens.ts` escreve em pt-BR, e o mapa é passado **por chamada** em `validar()` em vez de `z.config()` global — configuração global depende de um import com efeito colateral ter rodado antes, e em route handler do Next não há garantia de ordem.
- **`validar()` devolve resultado, não lança.** O handler faz `if (!r.ok) return Response.json(r.resposta, { status: r.status })` e segue com `r.dados` estreitado.
- **Tipo do hábito é imutável.** `editarHabito(tipo)` monta o schema a partir do tipo atual, então uma edição não pode trocar `binario` por `quantificado`. Trocar reinterpretaria o histórico pela régua errada — e no banco a FK composta `(habito_id, tipo)` propagaria a troca para as versões antigas, que então quebrariam os CHECKs de meta.
- **WebAuthn fica frouxo de propósito.** `PublicKeyCredentialCreationOptionsJSON` e as respostas do navegador não são formato nosso; reescrevê-los em Zod criaria uma segunda definição para divergir da primeira. O que valida aquele payload é a verificação criptográfica, não um schema de forma.
- **`POST /api/habitos/:id/retroativo` ganhou `previa: boolean`** — acréscimo ao inventário abaixo. É o que permite a tela mostrar o novo vencimento de um `cada_n_dias` **antes** de confirmar, como o Mapa de telas exige, sem inventar uma rota de simulação.

### 1.5 Rotas declaradas (stubs)

Route handlers do App Router já com validação ligada e devolvendo **fixtures**, não lógica. É o que deixa a etapa 2 consumir contratos reais.

| Grupo | Rotas |
|---|---|
| Auth | `GET /api/auth/estado` · `POST /api/auth/senha` · `POST /api/auth/webauthn/registro/opcoes` · `POST /api/auth/webauthn/registro` · `POST /api/auth/webauthn/login/opcoes` · `POST /api/auth/webauthn/login` · `POST /api/auth/logout` · `POST /api/auth/biometria/reset` |
| Dashboard | `GET /api/hoje` (interações devidas, sequência por hábito, avisos, saudação) |
| Hábitos | `GET /api/habitos` · `POST /api/habitos` · `GET /api/habitos/:id` · `PATCH /api/habitos/:id` (nova versão de config) · `PUT /api/habitos/ordem` · `POST\|DELETE /api/habitos/:id/pausa` · `POST\|DELETE /api/habitos/:id/arquivo` |
| Registros | `POST /api/registros` · `DELETE /api/registros/:id` · `GET /api/habitos/:id/retroativo` · `POST /api/habitos/:id/retroativo` |
| Infra | `POST\|DELETE /api/push/assinatura` · `POST /api/push/teste` · `GET\|PATCH /api/config` · `GET /api/exportar` |

- [x] stubs com validação de entrada ativa e fixture de saída
- [x] middleware de sessão (cookie httpOnly) e guarda "sem passkey ⇒ só a tela de biometria"

**Fechada quando** todo contrato existe em código, os stubs respondem fixtures válidas contra os próprios schemas, e um `GET /api/hoje` devolve o payload que o dashboard precisa.

**Como ficou implementado**

21 route handlers em `app/api/`, a plumbing em [servidor/](../servidor), a guarda em [proxy.ts](../proxy.ts). Todo handler tem a mesma cerimônia e nada mais:

```ts
const acesso = await exigirAcesso();
if (!acesso.liberado) return acesso.resposta;

const r = await corpo(req, criarHabito);
if (!r.ok) return json(r.resposta, r.status);
```

- **`middleware.ts` não existe mais no Next 16** — a convenção virou `proxy.ts`, com o export `proxy`. Mesma função, outro nome.
- **A guarda vale na API também, não só nas telas.** O proxy faz a verificação otimista do cookie (é o que a documentação do Next recomenda, e ele roda apartado do código de render); quem autoriza de verdade é `exigirAcesso()` em cada rota. Sem isso a guarda seria cosmética: um `fetch` operaria o app inteiro a partir da sessão provisória do primeiro acesso. Os dois casos têm códigos distintos — **401** manda ao login, **409** diz que a sessão existe mas falta cadastrar a biometria.
- **`/api` fica fora do matcher do proxy de propósito.** Redirecionar uma chamada de API para `/login` devolveria HTML com status 200, e o `fetch` quebraria num erro de parse em vez de receber o 401 que sabe tratar.
- **O nome do cookie e a leitura dele moram em [servidor/cookie-sessao.ts](../servidor/cookie-sessao.ts)**, um módulo puro sem imports — é o único jeito de o proxy e as rotas compartilharem isso sem o proxy arrastar `next/headers` para o bundle dele.
- **O cookie de stub tem dois valores** (`stub-sem-passkey`, `stub-com-passkey`), e o fluxo inteiro anda: `POST /api/auth/senha` abre a sessão provisória, `POST /api/auth/webauthn/registro` a promove, o logout e o reset a encerram. A etapa 2 percorre primeiro acesso → biometria → dashboard sem banco nenhum. **Nada ali é segurança** — o valor do cookie é acreditado como vem, e a etapa 3.1 substitui por token opaco com hash no Postgres.
- **`GET /api/auth/estado` é a única leitura que não devolve fixture**, porque é ela que diz à tela de login o que mostrar — um valor fixo tornaria o fluxo impossível de percorrer.
- **JSON malformado é 422, não 500.** `corpo()` embrulha o `await req.json()`; sem isso um corpo truncado viraria exceção não tratada.
- **Acréscimos ao contrato:** `registroRemovido` (o `DELETE /api/registros/:id` devolve os mesmos efeitos de uma marcação — apagar recalcula sequência, pode estornar congelamento e mover vencimento de `cada_n_dias`), e as fixtures de WebAuthn e de reset. Pausa e arquivamento devolvem o **hábito**, não `ok: true`, para a lista redesenhar a linha sem recarregar tudo.
- **Convenção `_` registrada no ESLint.** Parâmetro posicional só existe para alcançar o seguinte: um handler que precisa do `ctx` é obrigado a declarar o `req` antes dele.

**O que o stub achou na fixture do dashboard**

Rodar o `GET /api/hoje` de verdade expôs três furos que o schema não pega, porque ele valida cada linha isolada e não tem como reclamar do caso difícil estar **ausente**:

1. **Não havia linha de `duracao`.** O único hábito de duração era o 🧘 Meditar, que é a fixture do estado *pausado* — e pausado não rende interação devida. O dashboard seria desenhado sem a linha do cronômetro, que é a interação mais complicada da etapa 3.
2. **O hábito fixo rendia uma linha só.** O payload é por interação devida, e era justamente o caso que faltava: agora o 💊 Vitamina D tem dois horários, com a dose da manhã cumprida e a da noite pendente — a distinção que o estado da ocorrência existe para permitir, e a prova de que a linha não pode ser indexada por `habitoId`.
3. **A única linha de tipo negativo era de um hábito arquivado**, que não aparece no dashboard nem na lista ativa.

Corrigido com dois hábitos ativos novos (🤸 Alongar, 🥤 Sem refrigerante) e seis testes que travam os invariantes: as quatro formas de progresso presentes, duas linhas por hábito fixo de dois horários com a mesma sequência, e nenhuma linha de hábito arquivado ou pausado.

---

## Etapa 2 — Layout com dados falsos

Telas reais em Next + Tailwind, consumindo os stubs da etapa 1. Nada de backend de verdade aqui.

- [x] paleta de cores fechada (resolve a pendência do [Mapa de telas](mapas/Mapa%20de%20telas.md)) e tokens em `@theme inline` — **Esmalte**, medida e registrada na seção "Paleta" do mapa; o custo dela é que **estado passa a ser forma, não cor**
- [x] shell da PWA: manifest, ícones, barra inferior de 3 destinos, tema claro/escuro

  **Como ficou.** `app/manifest.ts` em `standalone`, ícones gerados de [public/icone.svg](../public/icone.svg) com o `sharp` que já vem no Next (192, 512 e o `apple-icon` de 180), e o grupo de rotas `app/(app)/` separando o que tem barra do que não tem — `/login` e `/biometria` ficam fora, porque uma barra de três destinos numa tela de onde não se pode sair ofereceria caminhos que o proxy recusaria.

  Três decisões que não eram óbvias:

  - **O tema tem três estados, não dois.** "Sistema" é a *ausência* do atributo `data-tema`, e é o que faz o app acompanhar a virada automática do celular ao anoitecer sem listener. Quem aplica é um script **inline e síncrono** no `<head>`: sem ele o app pinta no tema do sistema e o React corrige depois, o que aparece como flash branco ao abrir no escuro — às 6:30 da manhã, que é um dos dois horários de uso.
  - **O tema é lido com `useSyncExternalStore`, não `useState` + efeito.** Ele mora no `localStorage` e no atributo do `<html>`, ou seja é estado externo ao React; ler no efeito e corrigir com `setState` é o que o `react-hooks/set-state-in-effect` recusa — e a regra está certa, porque o valor já foi aplicado antes de o React existir.
  - **Existe um `public/sw.js` mínimo, sem estratégia de cache.** Ele existe porque o Chrome no Android exige service worker com handler de `fetch` para oferecer a instalação, e o critério de saída desta etapa é validar o app **instalado**. Cache offline não está na onda 1, e um service worker que serve conteúdo guardado sem isso ter sido decidido é a causa clássica de "mudei o código e o celular mostra o antigo".

  **Um bug que o matcher do proxy tinha e ninguém veria.** `/sw.js` recebia **307 para `/login`** — a guarda de navegação estava engolindo o service worker, então o registro falhava e a PWA não instalava. O teste de `proxy()` não pegava: ele chama a função direto e nunca passa pelo matcher, que é config lida pelo Next antes. Agora o matcher exclui `sw.js` e as extensões servidas da raiz, e há um teste que **lê o padrão do próprio `proxy.ts`** e o aplica a 15 caminhos — o Next exige literal no `config.matcher` (variável é ignorada), então uma segunda cópia no teste divergiria em silêncio.
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

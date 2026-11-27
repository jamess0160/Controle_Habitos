# Fix 01 — `diario` + `flexivel` limitado a 1 ocorrência

**Estado:** **executado** em 2026-11-27, com as decisões **A1** (CHECK no banco) e
**B1** (normalizar as linhas existentes). Verificado: `tsc --noEmit`, 592 testes
em 28 arquivos, `npm run build`, `eslint`, migration aplicada e revertida no
banco de desenvolvimento.
**Escrito em:** 2026-11-27.

> **Uma correção de rota ficou registrada abaixo**, no passo 1: a verificação que
> este plano dizia ter feito sobre `.extend()` testou a forma errada, e o fix não
> pôde ser escrito como estava planejado. A seção diz o que aconteceu e por que a
> estrutura final é outra.

## O sintoma

Hábito "escovar os dentes" criado como **diário, flexível, 2 vezes**. Depois de
marcar a primeira vez não existe forma de marcar a segunda: a linha mostra
`1/2` com a barra na metade, a marca aparece **cheia**, e tocar nela
**desmarca** a primeira em vez de somar a segunda. O retroativo recusa com
"Este dia já está cumprido". Às 04:00 o período fecha como `falhou` — consumindo
congelamento, se o hábito tiver — e a sequência cai, num dia em que a pessoa
escovou os dentes.

## A causa

No modo flexível a unidade contável é o **dia lógico**, não a marcação.

- [`dominio/meta.ts:88`](../../dominio/meta.ts#L88) compara `cumpridas >= metaOcorrencias`;
- [`dominio/simulacao.ts:301-308`](../../dominio/simulacao.ts#L301-L308) monta `cumpridas`
  agrupando os registros **por `dataLogica`** — um grupo por dia, e
  `unidadeCumprida` de um hábito binário basta-se com `registros.length >= 1`.

Com cadência diária a janela tem exatamente um dia dentro. Logo `cumpridas`
nunca passa de 1, e `metaOcorrencias: 2` é **inalcançável por construção**. O
app não tem como entregar o que o formulário aceitou.

Os três sintomas saem daí:

| Sintoma | Onde |
|---|---|
| `1/2` na linha e barra na metade | [`servidor/hoje.ts:273-277`](../../servidor/hoje.ts#L273-L277) manda o progresso **do período** no tipo binário |
| marca cheia, toque desmarca | [`servidor/hoje.ts:308`](../../servidor/hoje.ts#L308) (`registros.length > 0`) + [`componentes/linha-de-hoje.tsx:74-79`](../../componentes/linha-de-hoje.tsx#L74-L79) |
| "Este dia já está cumprido" | [`servidor/retroativo.ts:274`](../../servidor/retroativo.ts#L274) — e o comentário ali está certo: no modelo atual um segundo registro mesmo não muda nada |

E a frase do hábito diz `"2x por dia"`
([`contracts/resumo.ts:85`](../../contracts/resumo.ts#L85)), ou seja: o app
descreve de volta uma regra que ele não sabe avaliar.

### O mapa de regras está do lado errado

Isto não é só código divergindo de si mesmo. A tabela de combinações válidas do
[Mapa de regras](../mapas/Mapa%20de%20regras.md) (seção "Cadência e modo") diz,
na célula `diario` × `flexivel`: **"meta N vezes no dia"**. Era a intenção. A
implementação escolheu o dia como unidade do modo flexível e com isso a célula
virou mentira — a linha 100 do mesmo mapa ("a meta é contada por soma") é vaga
exatamente no ponto que importa.

Então existem dois consertos possíveis, e eles vão em direções opostas:

- **mudar o mapa para descrever a implementação** — diário flexível vale 1, e
  "2x por dia" é o modo **fixo** com dois horários. É este documento.
- **mudar a implementação para cumprir o mapa** — a unidade do flexível passa a
  ser a marcação, não o dia. Mexe em `unidadeCumprida`, no agrupamento da
  simulação, no `dia_ja_cumprido` do retroativo, no desfazer da tela e nas duas
  escalas de progresso. É decisão de domínio e **não** é este documento.

O modo fixo já resolve o caso de uso: o próprio mapa de regras usa
"remédio todo dia às 08:00 e 20:00 (duas ocorrências por período)" como exemplo,
e cada horário rende uma linha marcável no dashboard, com lembrete próprio e
contando 2 interações por dia na sequência.

## O que este fix faz

Fecha a porta, nos três lugares em que ela está aberta, e aponta o caminho que
funciona:

1. **Contrato** — `configFlexivel` recusa `metaOcorrencias > 1` quando a
   cadência é `diario`. É o schema que o route handler e o formulário já
   compartilham, então vale para a API e para a tela de uma vez.
2. **Formulário** — na cadência diária o campo "Quantas vezes no período" não
   aparece: no lugar dele, uma nota dizendo que 2x por dia se faz no modo fixo.
   E `montarConfig` passa a emitir `metaOcorrencias: 1` nessa cadência, para que
   a tela nunca monte um payload que o contrato recusaria.
3. **Frase** — `regraFlexivel` deixa de ter o ramo `"2x por dia"`: diário
   flexível é sempre "Todo dia".
4. **Mapa de regras** — a célula da tabela e a linha 100 passam a dizer o que o
   código faz.

## Duas decisões que preciso que você tome

> **Decididas em 2026-11-27: A1 e B1.** O hábito ofensor tinha sido criado no dia
> anterior, então o histórico em jogo era de um dia — o que torna a reescrita da
> versão de config (o preço do B1) irrelevante na prática, e tira a única objeção
> séria ao CHECK. Executado como `db/migrations/0010_meta_diaria_e_um.ts`.

### Decisão A — CHECK no banco?

O projeto trata os CHECKs de `habito_config` como a mesma regra escrita duas
vezes ("é a tabela de CHECKs da migration existindo também no tipo"). Pela
coerência, cabia uma migration `0010` com

```sql
CONSTRAINT habito_config_meta_diaria CHECK (
  cadencia <> 'diario' OR meta_ocorrencias IS NULL OR meta_ocorrencias = 1
)
```

Isso fecha também os caminhos que não passam pelo contrato — seeds e qualquer
`UPDATE` futuro. **Mas ele só pode ser criado depois de normalizar as linhas que
já existem** (ver decisão B), e aí as duas decisões ficam amarradas.

- **A1 (recomendada):** migration com o CHECK, junto da normalização dos dados.
- **A2:** sem CHECK. Contrato + formulário bastam, e o banco segue aceitando a
  linha impossível se alguém escrever direto nele.

### Decisão B — o histórico do "escovar os dentes"

Hoje existe (no servidor) pelo menos uma versão de config com
`cadencia = 'diario'` e `meta_ocorrencias = 2`, e os períodos que ela governou
fecharam como `falhou` em dias que você cumpriu. `habito_config` é **versionada
e nunca atualizada no lugar**, e o princípio nº 2 do projeto é que o passado seja
avaliado pela regra que valia nele. Só que a regra que valia era impossível de
cumprir: o histórico ali é artefato de bug, não registro de decisão.

- **B1 (recomendada):** a migration normaliza as versões ofensoras
  (`UPDATE habito_config SET meta_ocorrencias = 1 WHERE cadencia = 'diario' AND meta_ocorrencias > 1`)
  e os hábitos afetados são **re-materializados**. Os dias em que você marcou
  passam a fechar `cumprido`, a sequência volta e os congelamentos consumidos à
  toa são estornados — estorno é a diferença entre dois recálculos, e replay é
  idempotente. Preço: reescreve uma versão de config no lugar, que é a única vez
  em que o projeto faz isso, e o `down` não recupera o valor antigo.
- **B2:** não tocar no histórico. Você edita o hábito para o modo fixo, isso
  cria a versão 2 valendo de hoje, e os dias anteriores continuam marcados como
  perdidos para sempre.

Sobre a re-materialização do B1: `garantirPeriodoDeHoje` **não** serve — ela só
materializa quando nenhum período cobre hoje, e aqui a config mudou mas o
período existe. Duas saídas, nesta ordem de preferência:

- a edição que você vai fazer de qualquer jeito (hábito → modo fixo) já chama
  `materializar` para o hábito inteiro, inclusive o passado normalizado;
- se preferir separar as coisas, um `cli/rematerializar.ts` de uso único rodando
  `materializar` para cada hábito não arquivado — a imagem `worker` executa
  TypeScript cru, então é `docker compose run --rm worker tsx cli/rematerializar.ts`.

**Nada disso resolve o seu hábito sozinho.** Depois do fix, o "escovar os dentes"
precisa ser editado para **modo fixo, diário, dois horários** — é a configuração
que entrega duas marcações por dia. O fix só garante que a configuração
impossível não seja mais oferecida.

## Execução

Ordem proposta, cada passo verificável por conta própria.

### 1. Contrato — [`contracts/habito.ts`](../../contracts/habito.ts)

O plano era pendurar um `.refine` no `strictObject` de `configFlexivel`. **Não
funciona, e a verificação que dizia o contrário testou a forma errada.**

O que foi verificado antes: `flex.extend({ x: z.string() })`, ou seja, `extend`
**acrescentando** uma chave nova — e aí os checks de fato sobrevivem. Só que
`editarHabito()` **sobrescreve** `meta`, e a zod 4 recusa sobrescrever chave de
objeto que tenha refinement:

```
Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.
```

Pior: o erro é de **execução**, com os tipos compilando. Ele apareceu como
`PATCH /api/habitos/:id` quebrando em `servidor/rotas.test.ts` e
`servidor/habitos.test.ts` — 6 testes em 3 arquivos —, não no `tsc`. Se a suíte
não cobrisse a rota de edição, o fix teria ido para o servidor com o PATCH morto.

As duas saídas seguintes também não serviram, cada uma por um motivo próprio:

- **`.safeExtend()`**, que a própria zod indica e que de fato preserva os checks
  (verificado), **não aceita o schema indexado por genérico** de
  `META_POR_TIPO[tipo]`: `TS2345`, meta incompatível.
- **uma fábrica genérica** (`flexivelComMeta<M extends z.ZodType<Meta>>`)
  compila e passa nos testes, mas a inferência da zod cai no *constraint* do
  parâmetro em vez do argumento: `z.infer` do schema de edição passa a ter
  `meta: Meta` em vez da variante estreitada. Isso **apaga silenciosamente o
  estreitamento em tempo de compilação** que é a razão de `editarHabito` receber
  o tipo do hábito — `editarHabito("binario")` voltaria a aceitar uma meta de
  duração no tipo. Pego com um `@ts-expect-error` de uso único, não por teste.

**O que ficou:** `configFlexivel` volta a ser um `strictObject` puro, e a regra
vira um predicado aplicado à **união**, nos dois lugares em que a união é montada
— `configHabito` e o `configDoTipo` de `editarHabito`:

```ts
function metaDiariaCumprivel(config: {
  modo: string;
  cadencia: { tipo: string };
  metaOcorrencias?: number;
}): boolean {
  if (config.modo !== "flexivel" || config.cadencia.tipo !== "diario") return true;
  return (config.metaOcorrencias ?? 1) <= 1;
}
```

Só a *aplicação* se repete; o predicado e a mensagem moram num lugar só. O
`path: ["metaOcorrencias"]` sobrevive a estar na união: o issue sai como
`config.metaOcorrencias`, verificado nas duas rotas, e `passoDoCampo` o manda
para o passo 4 ([teste existente](../../componentes/rascunho-de-habito.test.ts#L166)).

A exclusividade estrutural continua sendo a regra da casa, e a nota longa em
`metaDiariaCumprivel` registra por que esta é a exceção: a regra relaciona dois
campos **irmãos** (`cadencia.tipo` e `metaOcorrencias`), e discriminar por dois
campos ao mesmo tempo é exatamente o que `z.discriminatedUnion` não faz. Torná-la
estrutural exigiria mover `metaOcorrencias` para dentro da união de cadências,
arrastando `db/mapa-dominio.ts`, `dominio/meta.ts`, `resumo.ts`, o rascunho e as
fixtures.

### 2. Frase — [`contracts/resumo.ts:85`](../../contracts/resumo.ts#L85)

`case "diario": return "Todo dia";` — sem o ramo de `n > 1`. Com o contrato
fechado, `n` só pode ser 1 ali, e deixar a frase morta sugeriria que o estado
existe.

### 3. Formulário — [`componentes/formulario-habito.tsx`](../../componentes/formulario-habito.tsx)

Em `PassoModo` (o `{rascunho.modo === "flexivel" || soFlexivel ? (…) : (…)}` da
linha ~478), o campo "Quantas vezes no período" passa a ter **três** estados em
vez de dois: flexível com cadência diária mostra uma `Nota` em lugar do
`<input>`, no espírito da nota que `cada_n_dias` já tem no passo 3:

> Em **diário** o período é um dia, então a meta é 1. Para escovar os dentes duas
> vezes por dia, escolha o modo **fixo** e declare dois horários — cada um vira
> uma linha marcável no dashboard.

A nota não é decoração: sem ela a pessoa vai procurar o campo que desapareceu.

### 4. Rascunho — [`componentes/rascunho-de-habito.ts`](../../componentes/rascunho-de-habito.ts)

Em `montarConfig`, no ramo flexível:
`metaOcorrencias: r.cadencia === "diario" ? 1 : Number(r.metaOcorrencias)`.

Necessário porque o campo escondido **não** zera o rascunho: quem escolhe
semanal, digita 3 e volta para diário mandaria `3` num campo que a tela não
mostra mais — erro de validação apontando para um campo invisível, que é pior
que o bug original. Com a coerção, a tela é correta por construção e o
refinement do contrato fica sendo o que deve ser: a guarda da API.

Efeito colateral útil: abrir a edição de um hábito já salvo como diário+2 e
salvar normaliza a config para 1, sem o usuário fazer nada de especial.

### 5. Mapa de regras — [`Docs/mapas/Mapa de regras.md`](../mapas/Mapa%20de%20regras.md)

- na tabela de combinações válidas, a célula `diario` × `flexivel` deixa de ser
  "meta N vezes no dia" e passa a "sempre 1 — para N por dia, modo `fixo`";
- a linha "a meta é contada por soma" (~100) ganha a precisão que falta: **a
  unidade do modo flexível é o dia lógico** — um dia com registro suficiente
  conta uma ocorrência, e é por isso que a cadência diária satura em 1;
- uma nota curta registrando a decisão e apontando para este arquivo, para que
  "N vezes por dia no flexível" não seja reinventado daqui a três meses.

### 6. Migration `0010` — só se A1/B1

Na linha do que a `0009` fez (CHECK derrubado, dados convertidos, CHECK
recriado):

```sql
UPDATE habito_config SET meta_ocorrencias = 1
  WHERE cadencia = 'diario' AND meta_ocorrencias > 1;

ALTER TABLE habito_config ADD CONSTRAINT habito_config_meta_diaria CHECK (…);
```

O `down` derruba o CHECK e **não** restaura os valores: a ida é lossy por
construção, e o comentário do arquivo precisa dizer isso — é o mesmo padrão e o
mesmo tipo de aviso do `down` da `0009`.

## Testes a ajustar

O refinement não roda em quem chama o servidor com dados já tipados, então
nenhum destes **quebra** — mas todos passariam a descrever uma configuração que
o contrato proíbe, e um teste assim é uma armadilha para quem ler depois.

| Arquivo | O que tem hoje | O que fazer |
|---|---|---|
| [`servidor/registros.test.ts:145-155`](../../servidor/registros.test.ts#L145-L155) | "binário mostra o período" com `config({ metaOcorrencias: 3 })`, e o `config()` do arquivo é **diário** ([:38](../../servidor/registros.test.ts#L38)) — o teste afirma `1/3` num hábito diário, que é o bug | trocar para `cadencia: { tipo: "semanal" }`, onde 3x é legítimo e a asserção continua fazendo o ponto dela |
| [`servidor/habitos.test.ts`](../../servidor/habitos.test.ts), 4 chamadas | usa `diaria({ metaOcorrencias: 2 \| 3 \| 4 })` só como "uma versão diferente de config" | **feito**: o helper `diaria()` deixou de aceitar `metaOcorrencias` (fixo em 1, para que nenhum teste possa montar a combinação) e passou a aceitar `notificarEm`, que é o jeito de ter outra versão de um hábito diário sem mexer na avaliação. O teste da armadilha nº 2 trocou de sinal: o que prova "o passado é avaliado pela regra de então" passou a ser o `config_id` dos períodos fechados — `meta_ocorrencias` agora é sempre 1 num diário e não distinguiria versão nenhuma. A régua que muda ali é a meta do tipo, 2000 → 3000 ml |
| [`dominio/simulacao.test.ts:365-392`](../../dominio/simulacao.test.ts#L365-L392) | "avalia cada período pela regra vigente na época" com v1 = diário+1 e v2 = diário+2, esperando `falhou` | é teste de domínio e o domínio segue genérico (ele não conhece o contrato), mas o par escolhido é justamente o impossível: trocar a v2 por `cadencia: { tipo: "semanal" }` ou por outra `meta` |
| [`contracts/contratos.test.ts`](../../contracts/contratos.test.ts) | nada a corrigir | **acrescentar** dois casos: diário+2 recusado com o caminho `metaOcorrencias`, diário+1 aceito. Vizinho natural do "recusa meta de ocorrências no modo fixo" ([:90](../../contracts/contratos.test.ts#L90)) e do "recusa cada_n_dias com intervalo de 1" |
| [`contracts/contratos.test.ts:405-415`](../../contracts/contratos.test.ts#L405-L415) | "cada_n_dias com meta acima de 1 mantém a janela na frase" | continua válido — `cada_n_dias` não é afetado. Acrescentar um caso de frase para diário, garantindo "Todo dia" |
| [`componentes/rascunho-de-habito.test.ts`](../../componentes/rascunho-de-habito.test.ts) | nada a corrigir | **acrescentar**: `montarConfig` com cadência diária e `metaOcorrencias: "3"` emite `1` |

Fora de perigo, verificado: as **seeds** não têm nenhum diário com
`meta_ocorrencias > 1` (os valores 2 e 3 de
[`db/seeds/03_desenvolvimento.ts:239,247`](../../db/seeds/03_desenvolvimento.ts#L239)
pertencem ao hábito **semanal** da linha 207), e as **fixtures** só usam
`metaOcorrencias: 3` no "🏃 Correr", que é semanal
([`contracts/fixtures.ts:77`](../../contracts/fixtures.ts#L77)).

## Verificação

Feito, nesta ordem:

1. `npx tsc --noEmit` — limpo. Rodado várias vezes: foi ele que pegou o
   `TS2345` do `safeExtend`.
2. `npm test` — **592 passando em 28 arquivos** (eram 586; 6 novos). Foi a
   suíte que pegou o `extend` lançando no PATCH.
3. `npm run build` — passa, todas as rotas coletadas.
4. `npm run lint` — limpo.
5. `npm run db:migrate`, depois `rollback`, depois `latest` de novo: a `0010`
   sobe, desce e volta. Com o CHECK de pé, um `UPDATE habito_config SET
   meta_ocorrencias = 2` num hábito diário é **recusado pelo banco**
   (`violates check constraint "habito_config_meta_diaria"`), e não sobrou
   nenhuma linha diária com meta acima de 1.
6. Pela API, com `tsx`: `POST /api/habitos` e `PATCH /api/habitos/:id` com
   diário+2 recusam no campo `config.metaOcorrencias`, com a mensagem em pt-BR;
   o mesmo hábito como **fixo com dois horários** passa.

Falta — depende de você, no navegador e no servidor:

- criar um hábito diário e confirmar que o campo "Quantas vezes no período" deu
  lugar à nota que manda para o modo fixo;
- criar "escovar os dentes" como **fixo, diário, dois horários** e confirmar
  **duas linhas marcáveis** no painel de hoje, cada uma marcando sem desfazer a
  outra, com a sequência subindo 2 no dia;
- no servidor, rodar a `0010` junto do deploy. O hábito ofensor nasceu ontem, e
  a intenção é apagá-lo (ver o fix 02), não corrigi-lo — então a
  re-materialização que o B1 descreve não precisa de cerimônia nenhuma aqui.

## O que este fix deliberadamente não faz

- **Não** muda a unidade do modo flexível (item 2 da conversa). Quem quiser "N
  marcações por dia contadas de verdade" continua sem isso, e o modo fixo é a
  resposta.
- **Não** mexe em `servidor/hoje.ts`, `linha-de-hoje.tsx` nem no retroativo.
  Eles estão coerentes com a unidade-dia; o que estava errado era a configuração
  chegar até eles.
- **Não** toca na escala dupla de progresso: com `metaOcorrencias: 1` no diário,
  `0/1` e `1/1` seguem corretos, e o `cada_n_dias` com meta acima de 1 continua
  mostrando o período como mostra hoje.

## Risco residual

O único é a **decisão B1**: reescrever uma versão de config no lugar contraria o
princípio de que o passado é avaliado pela regra que valia nele, e o `down` não
desfaz. O argumento a favor é que a regra em questão não era avaliável, e a
alternativa é guardar para sempre uma semana de falhas que não aconteceram. Em
B2 o risco é zero e o histórico fica errado.

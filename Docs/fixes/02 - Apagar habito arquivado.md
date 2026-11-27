# Fix 02 — apagar um hábito arquivado

**Estado:** **executado** em 2026-11-27, com as decisões **A1** (só arquivado),
**B1** (confirmação em dois toques, com os números) e **C2** (as linhas de
`notificacao_enviada` ficam). Verificado: `tsc --noEmit`, 612 testes em 29
arquivos, `npm run build`, `eslint`.
**Escrito em:** 2026-11-27.

> **Dois desvios do plano**, registrados nas seções correspondentes: a contagem
> do estrago virou uma **rota de leitura própria** em vez de um campo no payload
> de `habito` (passo 1), e o teste da cascata precisou de um hábito **com
> congelamento** para que aquela tabela não passasse batida (seção de testes).

## O pedido

Hoje dá para **arquivar** um hábito, não para apagá-lo. Arquivar é a ferramenta
certa para um hábito que você cumpriu e deixou de lado: ele sai do painel de hoje
e da lista ativa, e o histórico fica. Não é a ferramenta para um hábito **criado
errado** — "escovar os dentes, diário, 2 vezes" nunca devia ter existido, e
mantê-lo arquivado guarda para sempre uma semana de períodos falhados de um
hábito que não era aquilo.

Falta a saída definitiva: apagar.

## O que existe hoje

| Ação | Rota | Função |
|---|---|---|
| arquivar | `POST /api/habitos/:id/arquivo` | `arquivarHabitoNoBanco(id, true)` |
| desarquivar | `DELETE /api/habitos/:id/arquivo` | `arquivarHabitoNoBanco(id, false)` |

As duas em [`app/api/habitos/[id]/arquivo/route.ts`](../../app/api/habitos/%5Bid%5D/arquivo/route.ts),
e a interface em [`componentes/tela-habitos.tsx:427-431`](../../componentes/tela-habitos.tsx#L427-L431):
o cartão de um hábito arquivado hoje tem **uma** ação, "Desarquivar".

## Três decisões que preciso que você tome

### Decisão A — só arquivado, ou qualquer hábito?

- **A1 (recomendada):** só hábito **arquivado** pode ser apagado; a rota recusa
  um hábito ativo. Arquivar já existe, já é reversível, e vira o primeiro dos
  dois passos — o mesmo desenho das CLIs de reset, onde a ação destrutiva nunca
  está a um toque de distância. Também é o que você pediu.
- **A2:** apagar direto de qualquer hábito, com a confirmação sendo a única
  proteção. Menos atrito para o caso "criei errado agora", mais chance de apagar
  por engano o hábito de 200 dias logo abaixo dele na lista.

### Decisão B — o que a confirmação pede

Apagar é **irreversível pelo app**. A única volta é o `pg_dump` de
[`infra/backup.sh`](../../infra/backup.sh) — ou seja, perder tudo o que foi
registrado desde o último backup diário. Isso merece mais que um `window.confirm`.

- **B1 (recomendada):** confirmação em dois toques, no próprio cartão, dizendo
  **o que será destruído em números** — "apaga 47 marcações em 23 dias, e a
  sequência recorde de 14". O número vem do servidor, porque é ele que sabe; a
  tela não tem essa contagem hoje. Um botão destrutivo e um "Cancelar", no
  formato que `PainelRecaida` já usa em
  [`linha-de-hoje.tsx`](../../componentes/linha-de-hoje.tsx).
- **B2:** exigir **digitar o nome do hábito**, como as CLIs exigem a palavra
  escrita. Mais seguro e mais atrito — e num aparelho de toque, digitar
  "🦷 Escovar os dentes" com emoji é hostil. Se escolher isto, a comparação tem
  de ser pelo nome sem emoji.

Em qualquer uma das duas, a tela precisa dizer que o backup é a única volta.

### Decisão C — o lixo que não tem FK

Apagar o hábito leva por cascata, **verificado nas migrations**, tudo o que
importa: `habito_config`, `habito_periodo`, `habito_ocorrencia`, `registro`,
`congelamento` e `habito_streak` — todos com `ON DELETE CASCADE` até `habito`
([0003](../../db/migrations/0003_periodo_ocorrencia_registro.ts),
[0004](../../db/migrations/0004_congelamento_e_streak.ts)).

Uma tabela fica fora: **`notificacao_enviada`**. Ela guarda
`referencia` em **texto** (`<habito>|<dia>|<momento>`, montada por `chave()` em
[`worker/notificacoes.ts:297`](../../worker/notificacoes.ts#L297)) justamente
para não depender de ids que a materialização recria — então não há FK para
cascatear. E `limpar()` no tique
([`worker/tique.ts:178`](../../worker/tique.ts#L178)) só varre
`tentativa_login` e `webauthn_desafio`: essas linhas **nunca** são apagadas.

- **C1 (recomendada):** apagar na mesma transação, por prefixo
  (`WHERE referencia LIKE :habitoId || '|%'`). Isso acopla a exclusão ao formato
  da chave, e o acoplamento tem de estar comentado nos dois lados — mas deixar
  lixo permanente numa tabela que ninguém poda é pior.
- **C2:** deixar. São linhas inertes: a chave nunca mais será gerada, porque o
  hábito não existe. Custa algumas dezenas de linhas por hábito apagado, para
  sempre.

## Execução

### 1. Servidor — [`servidor/habitos.ts`](../../servidor/habitos.ts)

`apagarHabitoNoBanco(id)`, em transação:

1. lê o hábito; devolve `null` se não existe;
2. **recusa se não estiver arquivado** (decisão A1) — e a recusa é
   `regra_violada` (422: "pedido válido no formato, proibido pela regra"), não um
   404: o hábito existe, e a tela precisa poder dizer "arquive primeiro". Os
   códigos são fechados em [`contracts/erro.ts:12`](../../contracts/erro.ts#L12),
   então a distinção vem da mensagem, não de um código novo;
3. conta o que vai embora (registros, dias, sequência recorde) **antes** de
   apagar, porque é isso que a resposta devolve e o que a confirmação mostrou;
4. apaga `notificacao_enviada` por prefixo (decisão C1);
5. `DELETE FROM habito WHERE id = ?` — as cascatas fazem o resto.

**Desvio:** o plano dizia que a contagem prévia dispensaria uma rota de prévia.
Não dispensa — a confirmação precisa dos números **antes** do `DELETE`, e o
`DELETE` é justamente o que destrói a fonte deles. As duas saídas eram engordar o
payload de `habito` com a contagem (uma consulta a mais por hábito em toda
abertura da lista, mais a mudança do contrato em dez fixtures) ou uma rota de
leitura própria. Ficou a rota: `GET /api/habitos/:id/historico`, com
`historicoDoHabito` no contrato, e o custo é pago no toque em "Apagar" em vez de
em cada abertura da tela. `apagarHabitoNoBanco` reusa a mesma função dentro da
transação, então o aviso de sucesso fala exatamente os números que a confirmação
mostrou.

A contagem exige join (`registro` não tem `habito_id`; o dono é o período), então
ela carrega um tipo de linha escrito à mão — `Knex.TableType` descreve tabelas,
não junções, e um `join` tipa como `never`. É o padrão que o projeto já usa nas
poucas consultas com join.

### 2. Rota — `DELETE /api/habitos/:id`

Em [`app/api/habitos/[id]/route.ts`](../../app/api/habitos/%5Bid%5D/route.ts),
ao lado do `GET` e do `PATCH`.

**A armadilha está no nome.** `DELETE /api/habitos/:id/arquivo` já existe e
significa **desarquivar** — o oposto de destruir. Dois `DELETE` com sentidos
opostos a um segmento de distância é um erro esperando acontecer em qualquer
chamada escrita à mão. Duas saídas:

- manter `DELETE /api/habitos/:id` (REST óbvio) e **comentar nos dois arquivos**
  que o vizinho é o inverso;
- ou nomear a ação: `POST /api/habitos/:id/apagar`, que não tem simetria para
  confundir e combina com o `POST .../arquivo`.

Recomendo o primeiro, com os comentários: a rota REST é a que alguém tentaria de
qualquer forma, e é melhor que ela exista e esteja certa.

**A resposta tem de ter corpo.** `chamar()` em
[`cliente/api.ts:58`](../../cliente/api.ts#L58) faz `resposta.json()` e engole a
falha: um 204 chega à tela como `{ ok: true, dados: null }`, com `dados` tipado
como se houvesse um objeto. Devolver `{ id, nome, registrosApagados }` mantém o
contrato honesto e dá o texto do aviso de sucesso.

### 3. Contrato — [`contracts/habito.ts`](../../contracts/habito.ts)

Nada de request (a ação é o método). Um schema de resposta novo,
`habitoApagado`, com `id`, `nome` e os números apagados — e a entrada em
`contracts/fixtures.ts` para o teste de contrato.

### 4. Tela — [`componentes/tela-habitos.tsx`](../../componentes/tela-habitos.tsx)

A ação "Apagar" entra **só no cartão arquivado**, ao lado de "Desarquivar", com
`variante="destrutivo"`.

**`aoAgir` não serve como está.** `agir()` (linha ~113) faz
`enviar<Habito>(...)` e passa o resultado para `aplicar(atualizado)`, que decide
entre as listas de ativos e arquivados pelo `arquivadoEm` do hábito que voltou.
Apagar não devolve hábito nenhum: precisa de um caminho próprio que **remove o
id das duas listas** e mostra o aviso. Reaproveitar `aplicar` com um objeto
sintético é o jeito de o hábito apagado reaparecer na tela.

### 5. Mapas

- [`Mapa de telas.md`](../mapas/Mapa%20de%20telas.md) — a tela de hábitos ganha a
  ação, e a pendência correspondente (se houver) sai.
- [`Mapa do banco.md`](../mapas/Mapa%20do%20banco.md) — registrar que apagar o
  hábito é a **única** operação destrutiva do domínio, o que as cascatas levam, e
  que `notificacao_enviada` é a exceção sem FK.
- [`CLAUDE.md`](../../CLAUDE.md) — uma linha: arquivar não é apagar, e apagar só
  vale para arquivado.

## Testes

**Desvio, e o teste quase nasceu cego.** A asserção que prova a cascata tem duas
metades: antes do `DELETE`, há linhas em cada tabela dependente; depois, não há
nenhuma. A primeira metade falhou na primeira execução, e por um motivo que
importa: a config dos testes não tem congelamento, então `congelamento` estava
**vazia desde o início** — a metade "depois" passaria com a cascata daquela
tabela quebrada. O helper passou a criar o hábito com `congelamento: { aCada: 1 }`,
que faz a primeira marcação já render um congelamento ganho. A lição é a
pré-asserção: sem ela, um teste de exclusão é verde por vacuidade.

Novos, em [`servidor/habitos.test.ts`](../../servidor/habitos.test.ts):

- apaga um hábito arquivado e **as seis tabelas dependentes ficam sem rastro**
  dele (é a asserção que prova a cascata, e a que avisaria se uma migration
  futura trocasse um `ON DELETE CASCADE` por `RESTRICT`);
- **recusa apagar hábito ativo**, com `regra_violada`;
- 404 em id inexistente;
- apagar **não toca nos outros hábitos**: os vizinhos continuam com registros,
  períodos e sequência — a cascata é por `habito_id`, e um `DELETE` sem `WHERE`
  no lugar errado é exatamente o erro que este teste pega;
- as linhas de `notificacao_enviada` daquele hábito somem e as dos outros ficam
  (decisão C1);
- a contagem devolvida bate com o que havia antes.

Em [`servidor/rotas.test.ts`](../../servidor/rotas.test.ts), o `DELETE` novo
entra na tabela de stubs — ela cobre toda rota, e uma rota sem stub ali é uma
rota sem teste de contrato.

Em [`componentes/tela-habitos`](../../componentes/tela-habitos.tsx) (teste novo,
não existe arquivo de teste para esta tela hoje): o cartão ativo **não** oferece
"Apagar", e a confirmação não dispara a chamada antes do segundo toque.

## Verificação

Feito:

1. `npx tsc --noEmit` — limpo. A rota nova precisou de um `npm run build` antes:
   os tipos de `RouteContext<"/api/habitos/[id]/historico">` são **gerados**, e
   até o build existir o `tsc` reclama de uma rota que está correta.
2. `npm test` — **612 passando em 29 arquivos** (eram 592 em 28). O arquivo novo
   é `componentes/tela-habitos.test.tsx`, que não existia.
3. `npm run build` — passa, e a rota `/api/habitos/[id]/historico` aparece no
   inventário.
4. `npm run lint` — limpo.

Falta você conferir no navegador: arquivar um hábito, tocar em **Apagar**, ver os
números do histórico na confirmação, cancelar, apagar de verdade, e confirmar que
ele sai da lista e do painel de hoje enquanto os outros seguem intactos.

Um achado do teste de tela que vale saber: um `<details>` **fechado** continua
tendo os filhos no DOM — ele esconde por apresentação, não por montagem. Procurar
"Apagar" no documento inteiro acha o botão do arquivado e não diz nada sobre o
cartão ativo, então a asserção de "a ação não existe no ativo" tem de ser escopada
ao `<li>` do cartão.

## Risco residual

É a primeira operação **irreversível** do app. O resto do domínio é replay — toda
escrita é recalculável a partir de `habito_config`, `registro` e a pausa, e é por
isso que editar, pausar, arquivar e desmarcar não precisam de confirmação forte.
Apagar sai desse modelo: não há replay que traga de volta o que não existe mais,
e a única cópia é o `pg_dump` da noite anterior. As decisões A1 e B1 existem para
que esse toque nunca seja acidental.

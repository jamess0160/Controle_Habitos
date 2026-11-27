# Fix 02 — apagar um hábito arquivado

**Estado:** proposto, aguardando aprovação. Nada executado.
**Escrito em:** 2026-11-27.

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

A contagem prévia é também o que permite a tela confirmar com números sem uma
rota de "prévia": `GET /api/habitos/:id` já traz `sequencia`, e o que falta
(registros e dias) cabe numa consulta.

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

1. `npx tsc --noEmit`;
2. `npm test` com o `db:up` de pé;
3. `npm run build`;
4. `npm run lint`;
5. à mão: criar um hábito, marcar duas vezes, arquivar, apagar, e confirmar que
   ele sai da lista, que o painel de hoje não o mostra, e que os outros hábitos
   seguem com sequência e histórico;
6. no banco, depois do passo 5: `SELECT count(*) FROM registro` e
   `notificacao_enviada` para ver que sobrou só o que é dos outros hábitos.

## Risco residual

É a primeira operação **irreversível** do app. O resto do domínio é replay — toda
escrita é recalculável a partir de `habito_config`, `registro` e a pausa, e é por
isso que editar, pausar, arquivar e desmarcar não precisam de confirmação forte.
Apagar sai desse modelo: não há replay que traga de volta o que não existe mais,
e a única cópia é o `pg_dump` da noite anterior. As decisões A1 e B1 existem para
que esse toque nunca seja acidental.

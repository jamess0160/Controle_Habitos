# Roteiro de testes — onda 1

Etapa 4 do [Roadmap](Roadmap%20onda%201.md). Quem executa é você, à mão, no app de verdade: o que `npm test` cobre são 586 casos sobre o domínio, as rotas e as telas isoladas — o que **não** se prova em teste automatizado é o aparelho, o autenticador, a entrega do push e a sensação de usar.

Cada seção tem **objetivo**, **passos**, **o que esperar** e, quando existe, a **armadilha**: o comportamento que parece defeito e é a regra. Lê-la antes de abrir um bug economiza a investigação.

A ordem importa só em parte: a seção 1 precisa de um banco recém-semeado e a 9 precisa de HTTPS. O resto pode ser executado na ordem que convier.

---

## 0. Preparação

### Os dois ambientes, e por que são dois

| | Desktop | Celular |
|---|---|---|
| `APP_MODO` | `desenvolvimento` | `producao` |
| `RP_ID` | `localhost` | o domínio do túnel |
| Como sobe | `npm run dev` | `npm run build && npm run start`, atrás de HTTPS |
| Senha | continua ativa ao lado da passkey | desativada no cadastro da biometria |
| Serve para | tudo que é domínio, tela e fluxo | biometria, PWA instalada e push real |

A separação não é conforto: `APP_MODO` existe porque validar a PWA exige **build de produção servido por HTTPS**, e nesse cenário `NODE_ENV` já é `production` enquanto o app ainda é ambiente de teste. Sem a chave separada não haveria como entrar por senha ali. Ela **falha fechada** — só a palavra exata `desenvolvimento` solta a senha, e a tela de login avisa em bloco visível quando está nesse modo.

> **O domínio é parte do contrato de autenticação.** O `rp_id` da passkey é o hostname. Trocar de domínio invalida a biometria cadastrada — o app detecta e explica, mas a volta é o reset. Decida o domínio antes de cadastrar biometria no celular, ou conte com um reset a mais.

### Banco

```bash
npm run db:up       # Postgres de desenvolvimento
npm run db:reset    # rollback total + migrate + seed
npm run db:status   # confere que as 9 migrations rodaram
```

`db:reset` apaga **tudo**, passkey incluída: depois dele, o celular precisa cadastrar biometria de novo. O seed deixa a senha do `.env`, a configuração e 6 hábitos com 30 dias de histórico — útil para as seções 5 e 6, atrapalha a 3, que quer o cadastro visto de perto. As duas coisas convivem: crie os hábitos da seção 3 ao lado dos semeados.

### Push, uma vez

```bash
npm run push:chaves   # gera o par VAPID e imprime para colar no .env
```

Trocar o par depois invalida **toda** assinatura existente: o navegador assina para uma chave pública, e um envio assinado por outra é recusado. Se o push parar de funcionar sem motivo aparente, a primeira pergunta é se as chaves mudaram.

---

## Ferramentas de teste

### O tique manual

Sem ele, provar que um período fecha custa esperar as 04:00, e provar o `meta_atraso` custa esperar as 20:00 do último dia de um período semanal.

```bash
npm run worker:tique                              # um tique, agora
npm run worker:tique -- "2026-11-19 04:01"        # a virada de amanhã
npm run worker:tique -- 2026-11-19T20:00:00-03:00 # instante absoluto
npm run worker:tique -- "2026-11-19 04:01" --seco # só resolve e mostra o instante
```

Roda o **mesmo** `tique()` do processo de um minuto — um caminho separado de fechamento manual não provaria nada sobre o que roda de madrugada. O instante sem fuso é lido na **parede do app** (`config_app.timezone`), não na do processo; `--seco` mostra instante, parede e dia lógico e para antes de tocar no banco. Use `--seco` sempre que digitar um instante pela primeira vez.

**O que o instante simulado move:** a avaliação — que dia lógico é hoje, se já passou a hora de um lembrete, se o período que cobria ontem ainda cobre hoje.

**O que não move:** o passado. `registro.criado_em` continua sendo a hora real de cada marcação. Simular amanhã não inventa histórico; fecha o período de hoje com os registros que existem agora, que é exatamente o que a virada faria.

**O que ele consome de verdade:** a limpeza do tique é relativa a `agora`, então um instante um dia à frente apaga tentativas de login e desafios WebAuthn com mais de 24 h **em relação a ele** — e com isso libera o bloqueio da seção 1 que você talvez estivesse testando. O comando avisa quando o instante está longe.

### Rearmar uma notificação

`notificacao_enviada` é a guarda de idempotência, e a linha é gravada **antes** do envio. Um tique que reservou a chave e não entregou nada (sem assinatura, sem chave VAPID) deixa aquele evento marcado como enviado — e ele não volta sozinho.

```sql
-- o que já foi reservado
select tipo, referencia, enviada_em from notificacao_enviada order by enviada_em desc limit 20;

-- rearmar os eventos de um dia
delete from notificacao_enviada where referencia like '%2026-11-19%';
```

A chave descreve o **evento** (`<habito>|<dia>|<momento>`), não a linha, justamente porque períodos e ocorrências trocam de id a cada materialização.

### A virada, sem esperar a madrugada

Ajustes → Preferências tem **hora da virada** e **fuso**. Pôr a virada alguns minutos à frente do relógio de parede reproduz exatamente o "antes da virada", e alguns minutos atrás reproduz o "depois" — é a mesma `dataLogicaDe` que o servidor usa para tudo. Devolva o valor a `04:00` ao terminar.

### Acesso ao banco

```bash
docker exec -it habito_postgres_dev psql -U habito -d controle_habito
```

---

## 1. Primeiro acesso, biometria e a senha depois dela

**Objetivo:** provar a porta única — e que ela fecha.

### Passos

1. Banco recém-resetado, `APP_MODO=producao`, celular no domínio por HTTPS.
2. Abra o app. A tela de login mostra **campo de senha** e nada de biometria.
3. Entre com a senha do `.env` (`APP_SENHA_INICIAL`).
4. O app leva ao cadastro da biometria. Cadastre.
5. Saia e volte: a tela agora mostra **"Entrar com biometria"** e **nenhum campo de senha**.
6. Entre pela biometria.

### O que esperar

- Não há campo de usuário — o app é de um usuário só, e `APP_USUARIO_NOME` aparece apenas na saudação do dashboard.
- Depois do cadastro a senha está **desativada**, e a tela diz isso em vez de oferecer um campo que seria recusado.
- Ajustes → Biometria mostra dispositivo, data de cadastro, último uso e o `rp_id`.

### Rate limiting

Com a senha ativa (modo desenvolvimento, ou depois de um reset), erre a senha **5 vezes**. Da 5ª falha em 15 minutos em diante o IP fica bloqueado por 15 minutos, com atraso progressivo (0, 1, 2, 4, 8 s) antes disso.

A tela mostra **o tempo restante e nada mais** — não diz se a última senha estava certa. É deliberado: dizer "senha correta, mas bloqueado" entregaria a senha.

Quinze minutos de silêncio limpam a janela sozinhos. Para não esperar:

```sql
delete from tentativa_login;
```

### Armadilha

O bloqueio é por `CF-Connecting-IP`. Em `localhost` sem o túnel na frente, todas as tentativas vêm do mesmo IP — o que é o comportamento certo, mas significa que você bloqueia a si mesmo com facilidade.

- [ ] primeiro acesso por senha
- [ ] cadastro de biometria
- [ ] reentrada por biometria
- [ ] senha recusada depois de desativada
- [ ] bloqueio por tentativas, e a liberação sozinha

---

## 2. Os dois resets

São caminhos diferentes para situações diferentes, e é isso que se testa.

### Reset pela interface — "mudei de aparelho, ainda tenho sessão"

1. Com sessão válida: Ajustes → Biometria → **Resetar biometria**.
2. Digite a frase exata `RESETAR BIOMETRIA`. O botão só habilita com ela.
3. Confirme.

**O que esperar:** a passkey é apagada, a senha é **reativada** e todas as sessões são revogadas — você cai no login. A senha que volta é a que estava gravada; se não souber mais qual é, use a CLI em vez deste caminho.

### Reset pela CLI — "perdi o aparelho, não tenho sessão"

```bash
npm run cli:reset-biometria
```

1. Imprime o estado atual (passkey e senha) antes de qualquer coisa.
2. Exige a palavra **`RESETAR`** escrita. Não é `s/n`: digitar `s` por reflexo é fácil, e o preço é a única porta do app trocando sem querer.
3. Apaga a passkey, gera uma **senha provisória aleatória**, revoga as sessões e limpa as tentativas — um bloqueio herdado não pode trancar a senha nova.
4. A senha provisória é impressa **uma vez**, emoldurada. Anote.

E a CLI só de senha:

```bash
npm run cli:reset-senha
```

Com passkey presente ela avisa que vai **reativar** a senha, deixando duas portas abertas até o próximo cadastro de biometria desativá-la, e exige a palavra `REATIVAR`. Sem passkey, exige `GERAR`.

### O que esperar das duas

- Sem terminal interativo elas **recusam** em vez de assumir um default. `--sim` dispensa a confirmação e fica registrado no log.
- Reentrada funciona depois de cada reset: senha → cadastro de biometria → biometria.

- [ ] reset pela interface, com reentrada
- [ ] reset pela CLI de biometria, com reentrada
- [ ] `cli:reset-senha` com e sem passkey presente
- [ ] recusa sem terminal interativo

---

## 3. Um hábito de cada tipo e de cada cadência

**Objetivo:** percorrer o formulário inteiro e ver cada tipo fechar um período.

Crie seis, ao lado dos semeados:

| Hábito | Tipo | Cadência | Modo |
|---|---|---|---|
| 💧 Água | `quantificado` | diário | flexível |
| 🧘 Respirar | `duracao` | diário | flexível |
| 🛏️ Fazer a cama | `binario` | diário | fixo, um horário |
| 💊 Vitamina | `binario` | diário | fixo, **dois** horários |
| 🏃 Correr | `binario` | semanal, 3× | flexível |
| 🥤 Sem refrigerante | `negativo` | mensal | flexível |

### O que esperar no cadastro

- O rodapé mostra **a regra em uma frase**, atualizada a cada escolha, e é a mesma frase que aparece depois na lista de hábitos — vem da mesma função no servidor e no cliente.
- Erro de validação leva ao **passo** do campo errado, não a um aviso genérico.
- Em `a cada N dias` o modo fixo **não é oferecido**, com a explicação na tela.
- No modo fixo, o passo de notificação diz que o lembrete é derivado dos horários e não oferece horário separado.

### Regressões da etapa 4.1 — confira aqui

- **Duração em relógio.** O campo é `h : min : s`. Peça **30 s** em 🧘 Respirar: tem de ser aceito. Os três campos em branco têm de ser **recusados** com mensagem, não salvos como zero.
- **Lembrete opt-in.** O passo 5 abre com *Ativar* / *Sem lembrete*; o campo de horário só aparece ativado, já em 20:00. Ativado e apagado tem de dar erro de validação, não silêncio.
- **Formulário limpa.** Depois de criar, volte em **Novo hábito**: tem de estar vazio, no passo 1, sem recarregar a página. Em **editar**, o formulário continua sendo o do hábito.

### Fechamento

Marque cada um conforme o tipo e feche o dia:

```bash
npm run worker:tique -- "<amanhã> 04:01" --seco   # confira o instante
npm run worker:tique -- "<amanhã> 04:01"
```

**O que esperar:** `períodos materializados` maior que zero, cada hábito com período novo cobrindo o novo dia, e o anterior fechado como `cumprido` ou `falhou`. O 🥤 negativo fecha **cumprido** sem você tocar nele — ele nasce cumprido e só a recaída o derruba.

### Armadilhas

- **Período que cobre hoje ≠ período aberto.** Cumprir a meta de um hábito diário **fecha** o período de hoje; o próximo só começa amanhã. O hábito continua no dashboard — sumir dele no instante da marcação era o defeito, não o contrário.
- **Duas escalas de progresso.** `binario` e `negativo` mostram o **período**; `quantificado` e `duracao` mostram a **interação de hoje**. No 💊 Vitamina de dois horários, as duas linhas mostram a mesma contagem do período, de propósito — somar o incremento nas duas mostraria o dobro.
- **`duracao` conta segundos.** O progresso aparece como relógio (`00:30/01:00`), não como "0/60 s".

- [ ] um hábito de cada tipo, cadastrado e marcado
- [ ] cada cadência, inclusive fixo com dois horários
- [ ] as três regressões da 4.1
- [ ] fechamento de período em cada tipo

---

## 4. Marcação perto da virada das 04:00

**Objetivo:** provar a armadilha nº 1 do projeto na prática — um timestamp não é um dia lógico.

### Passos

1. Ajustes → Preferências → ponha a **hora da virada** 2 ou 3 minutos **à frente** do seu relógio.
2. Marque um hábito diário.
3. Abra o retroativo desse hábito.

**O que esperar:** a marcação aparece no dia de **ontem**, não no de hoje. Antes da virada, a marcação pertence ao dia anterior.

4. Espere passar da hora configurada (ou mova-a para trás) e marque de novo.

**O que esperar:** agora cai no dia de hoje.

5. Devolva a virada para `04:00`.

### Armadilha

Quem decide o dia lógico é o **servidor**, nunca o relógio do aparelho — o celular pode estar com a hora errada, e o cliente não calcula isso em lugar nenhum. Se o resultado parecer estranho, confira o **fuso** em Preferências antes de suspeitar do código: é ele que define a parede.

- [ ] marcação antes da virada cai no dia anterior
- [ ] marcação depois da virada cai no dia corrente

---

## 5. Sequência, e o congelamento do nascimento ao esgotamento

**Objetivo:** o único mecanismo do app que age sozinho.

Use um hábito diário com congelamento **a cada 2 interações, máximo 2** — números pequenos para o ciclo caber em poucos tiques.

### Passos

1. Marque dois dias seguidos, fechando cada um com o tique manual.

   **Esperar:** 🔥 em 2 e **1 congelamento** em estoque.

2. Marque mais dois.

   **Esperar:** 🔥 em 4 e **2 congelamentos** — o teto. O ciclo seguinte não dá um terceiro.

3. **Não marque** e feche o dia.

   **Esperar:** o período fecha como `congelado`, o estoque cai para 1, a **sequência é preservada**, e o bloco de avisos do dashboard mostra `congelamento usado`.

4. Não marque de novo e feche.

   **Esperar:** estoque em 0, sequência ainda preservada.

5. Não marque uma terceira vez e feche.

   **Esperar:** agora o período fecha `falhou`, a sequência **zera**, e o aviso é `sequência perdida`.

### As notificações desses dois eventos

`congelamento_usado` e `sequencia_perdida` nascem na virada das **04:00** e esperam as **08:00** para serem entregues — acordar alguém às quatro para contar que a sequência acabou é o oposto do que o aviso serve. Nada se perde: o dashboard mostra os mesmos dois avisos por dois dias.

Para ver a entrega, simule as 08:00:

```bash
npm run worker:tique -- "<o dia> 08:00"
```

### Armadilhas

- **Não existe estado `em_risco` nem prazo de resgate.** O congelamento é gasto no fechamento, automaticamente, e não há nada a decidir. A única correção é o retroativo de 7 dias.
- **Idempotência.** Rode o mesmo tique duas vezes: o estoque **não** pode crescer. Se crescer é defeito — e há teste em `servidor/fechamento.test.ts` dizendo que não deveria.

- [ ] sequência subindo
- [ ] congelamento ganho, e o teto respeitado
- [ ] congelamento gasto sozinho no fechamento
- [ ] estoque esgotado, sequência perdida
- [ ] tique repetido não infla o estoque

---

## 6. Retroativo: marcar, desmarcar, estornar

**Objetivo:** a única via de correção do app.

### Passos

1. Abra o retroativo de um hábito (toque na linha, no dashboard). São **7 dias lógicos**, do mais recente ao mais antigo, semana começando no domingo.
2. Marque um dia em branco no meio da janela.

   **Esperar:** a sequência é recalculada na hora, e a tela diz o que mudou.

3. Em `quantificado` e `duracao` o dia não alterna: ele abre uma entrada de valor, já sugerindo a meta. No de duração, o relógio `h : min : s`.
4. Desmarque um dia que estava marcado.

   **Esperar:** a sequência cai de acordo.

5. Agora o estorno: tenha um período fechado como `congelado` (seção 5) dentro da janela e **marque** o dia que faltava.

   **Esperar:** o período deixa de ser `congelado`, vira `cumprido`, e o congelamento **volta ao estoque**.

### Armadilhas

- **Estorno não é um evento gravado.** Ele é a diferença entre dois recálculos — "o total consumido diminuiu". Não procure uma coluna de estorno no banco: ela existiu, nunca recebeu valor, e foi removida na migration `0007`.
- **Os ids dos registros sobrevivem ao recálculo.** A materialização apaga e recria períodos e ocorrências, mas reinsere os registros **com os mesmos ids** — se desfazer der 404, é defeito aqui.
- **Fora da janela de 7 dias não há correção.** É a decisão, não uma limitação a reportar.

- [ ] marcar dia retroativo
- [ ] desmarcar dia retroativo
- [ ] valor retroativo em `quantificado` e em `duracao`
- [ ] congelamento estornado por retroativo

---

## 7. `cada_n_dias`: a cadência que anda

**Objetivo:** a única cadência de vencimento móvel, e a mais fácil de quebrar.

Crie um hábito `a cada 5 dias`, flexível.

### Conclusão antecipada

1. Veja o vencimento atual na lista.
2. Marque **antes** dele — digamos, no 2º dia da janela.

**Esperar:** o próximo vencimento pula para **5 dias depois daquela conclusão**, não 5 dias depois do vencimento antigo. A âncora é a última conclusão.

**Esperar também:** a tela **pede confirmação** da mudança de vencimento — e só quando ela de fato mudou.

> **Armadilha:** `novoVencimento` vem preenchido em **toda** resposta de hábito ancorado, não só quando a âncora se move. A tela compara com o vencimento que já tem antes de avisar. Um aviso que aparece sempre deixa de ser aviso — se ele aparecer numa marcação que não moveu nada, é defeito.

### Retroativo movendo vencimentos

3. Pelo retroativo, marque um dia **anterior** ao que você já havia marcado.

**Esperar:** todos os vencimentos seguintes são **re-encadeados** a partir da nova âncora. Não é um conserto caso a caso: a materialização é replay, então o re-encadeamento cai de graça.

4. Desmarque esse dia.

**Esperar:** a cadeia volta ao que era.

### Pausa, aqui, é diferente

Em `cada_n_dias` a pausa **congela o relógio**: a âncora é deslocada pela duração da pausa. Voltar de 20 dias de férias não pode criar um vencimento já estourado — teste isso junto com a seção 8.

- [ ] conclusão antecipada move o vencimento
- [ ] confirmação aparece só quando o vencimento muda
- [ ] retroativo re-encadeia os vencimentos seguintes
- [ ] pausa desloca a âncora

---

## 8. Pausa, arquivo e a volta dos dois

**Objetivo:** suspender sem punir.

### Pausa agendada

1. Pause um hábito com data de fim (`pausado_ate` preenchido).

   **Esperar:** nenhum período é gerado no intervalo, nada falha, a sequência é preservada, e o hábito sai do dashboard.

2. Feche os dias do intervalo com o tique manual.

   **Esperar:** nenhum `falhou` aparece.

3. Simule um tique **depois** do fim da pausa.

   **Esperar:** o hábito **volta sozinho** ao dashboard, com a sequência de antes, e um período novo materializado.

### Pausa aberta

4. Pause outro hábito sem data de fim e retome à mão.

### Arquivar

5. Arquive um hábito.

   **Esperar:** sai do dashboard e da lista ativa, aparece em seção recolhida no fim. Não existe exclusão permanente.

6. Desarquive.

### Armadilha

**Pausa vencida não é "está pausado".** `pausado_de`/`pausado_ate` guardam o intervalo e **não são limpos** quando a pausa expira. A condição errada (`pausado_de IS NOT NULL`) fazia um hábito que voltou de férias nunca mais materializar — ele seguia aparecendo pelo último período e sumia no dia seguinte, sem erro em lugar nenhum. O passo 3 é o que pega isso.

- [ ] pausa agendada: sem período, sem falha, sequência preservada
- [ ] retomada automática ao fim da pausa
- [ ] pausa aberta e retomada manual
- [ ] arquivar e desarquivar

---

## 9. Notificações reais, no celular, com o app fechado

**Objetivo:** o último item que `localhost` não prova. Exige HTTPS em domínio estável.

### Preparação

1. `APP_MODO=producao`, `RP_ID` igual ao domínio, build de produção servido pelo túnel.
2. **Instale a PWA** (adicionar à tela de início). No iOS, notificação só funciona com o app instalado.
3. Ajustes → Notificações → **Permitir notificações**. A assinatura é gravada.
4. **Enviar teste.** É o que prova o caminho inteiro: sem ele, uma assinatura gravada e válida pode nunca ter entregue nada — e Ajustes diz exatamente isso enquanto `último envio` estiver vazio.

### A prova com o app fechado

5. Crie um hábito diário com lembrete em um horário qualquer, e **não** o marque.
6. **Feche o app** — fechado, não minimizado.
7. No servidor, simule o minuto do lembrete:

```bash
npm run worker:tique -- "<hoje> <HH:MM do lembrete>"
```

**Esperar:** a notificação chega com o app fechado. Tocar nela abre o app no dashboard.

Se nada chegar, antes de suspeitar do envio:

```sql
select tipo, referencia, enviada_em from notificacao_enviada order by enviada_em desc limit 10;
select endpoint, ultimo_envio_em from push_subscription;
```

Linha em `notificacao_enviada` com `push_subscription` vazia significa evento **reservado sem entregar** — rearme a chave (ver Ferramentas) depois de assinar.

### As outras notificações

| Tipo | Quando | Como simular |
|---|---|---|
| `lembrete` | no `notificar_em` (flexível) ou em cada horário (fixo) | tique no minuto do horário |
| `meta_atraso` | **20:00** do último dia do período, ou no `notificar_em` se houver | tique às 20:00 do último dia |
| `congelamento_usado` | nasce na virada das 04:00, entregue às **08:00** | tique às 08:00 |
| `sequencia_perdida` | idem | tique às 08:00 |

### Armadilhas

- **`meta_atraso` só existe no flexível semanal e mensal.** Um hábito diário sem lembrete **não notifica nada** — e a tela de cadastro diz isso, no passo de notificação, quando o lembrete está desativado. Não é defeito.
- **No último dia, `meta_atraso` substitui o lembrete** em vez de somar-se a ele: duas notificações do mesmo hábito no mesmo minuto treinam a pessoa a ignorar as duas.
- **Lembrete só sai se a ocorrência estiver pendente.** Hábito já cumprido não lembra.
- **Um tique, uma entrega.** A chave é gravada antes do envio, então repetir o tique não repete a notificação. Para repetir de propósito, apague a linha.

- [ ] permissão concedida e assinatura gravada
- [ ] `Enviar teste` entrega
- [ ] lembrete com a PWA instalada e **fechada**
- [ ] `meta_atraso` num hábito semanal
- [ ] `congelamento_usado` e `sequencia_perdida` às 08:00
- [ ] toque na notificação abre o app

---

## 10. Reordenação

1. Lista de hábitos → arraste para reordenar.
2. Recarregue a página.
3. Abra o dashboard.

**Esperar:** a ordem persiste em `habito.ordem` e é **a mesma** nas duas telas — a ordem escolhida na lista é a ordem do dashboard.

- [ ] arraste reordena
- [ ] a ordem sobrevive ao recarregamento
- [ ] dashboard e lista concordam

---

## 11. Exportação

Ajustes → Dados → **Exportar histórico**. Baixa um JSON — hoje a única cópia dos dados fora do Postgres do homelab.

**Esperar:** o arquivo abre e tem os hábitos, as configurações versionadas e os registros.

- [ ] o JSON baixa e está completo

---

## Quando algo falhar

Anote, nesta ordem:

1. **O que você fez**, em passos — e qual seção do roteiro.
2. **O que esperava** e **o que aconteceu**.
3. **O instante**: hora de parede, e o instante do tique manual se houver.
4. **O estado**, quando for de domínio:

```sql
select nome, pausado_de, pausado_ate, arquivado_em from habito;

select h.nome, p.inicio, p.fim, p.status, p.concluidas, p.meta_ocorrencias
  from habito_periodo p join habito h on h.id = p.habito_id
  order by h.nome, p.inicio;

select h.nome, r.data_logica, r.valor, r.origem
  from registro r
  join habito_periodo p on p.id = r.periodo_id
  join habito h on h.id = p.habito_id
  order by r.data_logica desc limit 30;
```

5. O relatório do tique, se foi ele que expôs o problema — ele imprime as três etapas em separado, e `erros` nomeia qual falhou.

Antes de abrir qualquer um: **releia a armadilha da seção**. Boa parte dos defeitos encontrados até aqui era a regra funcionando.

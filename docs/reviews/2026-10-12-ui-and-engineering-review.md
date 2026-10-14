# Review de UI e engenharia — 12/10/2026

O projeto detecta inconsistências em pipelines de dados, investiga causas com ferramentas limitadas e valida recuperações em sandbox. A UI precisa tornar esse fluxo compreensível e permitir conferir o que realmente executou. Este review assume uso local por uma pequena equipe; concorrência de requests e falhas de processo já importam nessa escala.

**Veredito:** a UI operacional evoluiu; antes de uso compartilhado com informações sensíveis, corrija os itens 1–6 abaixo. O modo fake e o ambiente local continuam adequados para demonstração controlada, mas não demonstram qualidade de um LLM real nem prontidão de produção.

## O que foi melhorado nesta entrega

- **Health:** explicação visual do caminho `raw → staging → fato → relatório`, link para a execução, refresh manual e atualização a cada 10 segundos.
- **Histórico:** nova seção Pipeline runs, com as últimas 20 execuções, status de processamento e contagem de checks.
- **Detalhe de execução:** resultados registrados de transformações, testes e freshness; snapshot; checks que precisam de atenção primeiro, com opção de ver todos; links para incidentes relacionados àquela execução, incluindo recorrências. Isso evita enterrar os checks falhos depois de dezenas de passes no mobile.
- **Honestidade dos estados:** zero checks aparece como qualidade não avaliada; checks pulados ficam visíveis e impedem o resumo de todos aprovados; códigos ausentes não viram sucesso.
- **Freshness:** o resultado agregado usa a maior severidade, sem depender da ordem das linhas retornadas pelo banco.
- **API:** endpoints de leitura `/api/pipeline-runs` e `/api/pipeline-runs/{id}`, com limite validado de 1–200 no histórico. Não expõem cenário de benchmark nem caminhos locais de artefatos.
- **Design existente:** Mantine, tokens, temas claro/escuro, navegação por teclado e tabelas responsivas foram preservados. Nenhuma dependência nova.

O diagrama de dados explica a arquitetura; não é uma animação inferida do progresso. Resultados de etapas vêm do audit event de término. Enquanto não forem registrados, a tela informa a ausência. A UI não ganhou ingestão arbitrária nem aplicação de correções ao warehouse.

## Evidência e alcance

Foram lidos os fluxos da UI, API, pipeline, detecção, grafo, citações, worker, recuperação, domínio e persistência, além dos testes e da CI. A revisão também consultou as limitações documentadas de cloud. Capturas antes/depois e resultados locais estão em `var/ui-review/` (não versionado).

Quatro problemas foram reproduzidos com registros sintéticos próprios no PostgreSQL isolado da porta 55433. O script `var/ui-review/reproduce.py` removeu os registros que criou; não executou recuperação nem mudou dados existentes. O resultado está em `var/ui-review/reproductions.json`. Os demais achados indicam explicitamente quando a evidência é leitura do código, não uma simulação de falha real.

## Correções necessárias antes de ampliar o uso

### 1. Conteúdo restrito reaparece no diagnóstico entregue ao viewer — P1

**O que é:** a API oculta `Evidence.content` de evidências restritas para o papel viewer. [Implementação](../../src/drc/api.py), função `investigation`.

**Problema comprovado:** um fato que cita uma evidência restrita mantém sua `quote` no JSON de `diagnosis`. A reprodução criou apenas um valor sintético: o conteúdo da evidência ficou nulo, mas o mesmo valor continuou no diagnóstico retornado ao viewer. Portanto, esconder o accordion de evidências não protege o conteúdo derivado.

**Correção mínima:** aplicar autorização na projeção inteira da resposta. Fatos e hipóteses dependentes de evidências restritas precisam ser ocultados para viewer; campos livres como resumo e rationale exigem uma política explícita, pois podem incorporar o mesmo conteúdo sem uma referência estruturada. Uma primeira solução segura é restringir o diagnóstico completo quando houver dependência de dados restritos, sem alterar o registro original.

**Se adiado:** a separação entre viewer e investigator não protege informações sensíveis. O fato de o demo usar dados fictícios limita o dano atual, não corrige a fronteira de acesso.

**Aceite:** um teste insere um marcador restrito e verifica que ele não aparece em nenhum campo do JSON de viewer, permanecendo disponível ao investigator autorizado.

### 2. Criação da tarefa e enqueue não são atômicos — P1

**O que é:** a API cria uma investigação ou validação e depois chama `worker.enqueue`, que abre outra transação. [API](../../src/drc/api.py), `start_investigation` e `start_validation`; [worker](../../src/drc/worker.py), `enqueue`.

**Problema comprovado:** ao simular falha do enqueue, a API respondeu 500 e deixou uma investigação `queued` sem nenhum job. Não existe lease a expirar nesse caso: o worker nunca recebeu trabalho. A validação usa a mesma separação de transações.

**Correção mínima:** permitir que o enqueue use a conexão da transação de criação e gravar entidade, auditoria e job juntos. PostgreSQL já atende esse caso; não há necessidade de adicionar um broker ou outbox enquanto todos os efeitos estiverem no mesmo banco.

**Se adiado:** a UI promete processamento que não acontecerá. Um retry sem a mesma chave pode criar outra investigação.

**Aceite:** falha simulada ao gravar job reverte também a criação da tarefa; retry com a mesma chave produz uma entidade e um job.

### 3. Duas requests podem iniciar validações da mesma proposta — P1

**O que é:** `start_validation` consulta validações ativas com `FOR UPDATE`, mas não serializa o caso em que ainda não existe nenhuma. [API](../../src/drc/api.py), `start_validation`.

**Problema comprovado:** uma barreira controlada colocou duas requests depois da consulta vazia; ambas criaram uma validação `queued`. Bloquear linhas retornadas não bloqueia uma linha que não existe. O processamento posterior disputa transições da mesma proposta.

**Correção mínima:** bloquear a linha da proposta antes de verificar status e validações ativas, dentro da transação de criação e enqueue. Um índice único parcial por proposta para os estados `queued/running` oferece defesa adicional; trate a colisão como 409.

**Se adiado:** duplo clique, retry de rede ou dois investigadores criam trabalho concorrente e resultados confusos para a mesma proposta.

**Aceite:** duas requests sincronizadas recebem exatamente um 202 e um 409; há apenas uma validação ativa e um job correspondente.

### 4. Revisão aceita rejeição sem nota e pode resolver o incidente — P1

**O que é:** a UI exige nota para rejeitar e só oferece encerramento associado à aprovação; a API aceita `note=""` e `close_incident="resolved"` com `decision="reject"`. [API](../../src/drc/api.py), `ReviewBody`; [grafo](../../src/drc/agent.py), `record`.

**Problema comprovado:** o modelo de entrada aceitou essa combinação, e o nó `record` registrou a rejeição e moveu um incidente sintético para `resolved`. A regra da interface não é uma regra do domínio. A reprodução executou a validação de entrada e o nó de gravação; não simulou uma revisão completa pela UI.

**Correção mínima:** validar no backend que rejeição exige nota não vazia e que resolução nessa operação exige aprovação. Reutilize a regra nos caminhos API e CLI; não deixe a validação apenas no componente React. Uma eventual decisão de dispensar o incidente deve continuar sendo uma ação explícita e auditada.

**Se adiado:** um cliente HTTP pode violar o processo de revisão, mesmo com papel autorizado.

**Aceite:** API e CLI recusam rejeição sem nota e rejeição com resolução; aprovação sem encerramento permanece válida e não muda dados do warehouse.

### 5. Recuperação escolhe a execução mais recente do incidente, não a da investigação — P1

**O que é:** reincidências atualizam `incident.last_pipeline_run_id`; a recuperação faz join por esse campo para escolher snapshot e projeto. [Detecção](../../src/drc/quality.py), `_open_incident`; [recuperação](../../src/drc/recovery.py), `validate`. Evidência: leitura dos caminhos conectados; não foi aplicado um playbook sobre uma recorrência para provar o efeito final.

**Caso concreto:** uma investigação de R1 fica aguardando revisão; R2 repete a assinatura do incidente; depois alguém valida a proposta de R1. A consulta de recuperação agora seleciona o snapshot/projeto de R2. Mudanças de dados ou código entre as execuções tornam a comparação diferente da evidência usada no diagnóstico.

**Correção mínima:** persistir `pipeline_run_id` imutável na investigação quando ela começa e usar esse vínculo em ferramentas e recuperação. Defina um backfill auditável para registros antigos; não use silenciosamente a última execução como substituto.

**Se adiado:** "validado no snapshot investigado" pode ser uma afirmação incorreta após recorrência.

**Aceite:** teste cria investigação em R1, registra recorrência R2 e confirma que a validação continua lendo snapshot e projeto de R1.

### 6. Retry de validação interrompida pode deixar a execução presa — P1

**O que é:** `recovery.validate` começa transicionando a proposta para `validating`; `validating → validating` não é permitido. O worker só finaliza o estado da investigação quando esgota retries, não o estado da validação. [Recuperação](../../src/drc/recovery.py), `validate`; [domínio](../../src/drc/domain.py), `TRANSITIONS`; [worker](../../src/drc/worker.py), `run_once`. Evidência: leitura dos três caminhos; não foi morto um processo de validação durante dbt neste review.

**Caso concreto:** o processo morre depois de marcar proposta e validação em execução. Ao reclamar o job após expirar a lease, a nova tentativa tenta `validating → validating` e falha antes de continuar. Ao esgotar as tentativas, o job vira `failed`, mas a validação pode continuar `running` e a UI segue esperando.

**Correção mínima:** definir uma política explícita para tentativas de recuperação: nova validação/sandbox por tentativa, com a anterior encerrada e limpa, ou retomada idempotente da mesma execução com estados válidos. Ao esgotar retries, persistir estado terminal na validação e na proposta. Não basta adicionar um retry genérico.

**Se adiado:** uma falha real de processo impede nova validação pela UI, pois a consulta de validação ativa continua encontrando a execução presa.

**Aceite:** interrupção controlada após o início, retomada por outro worker e esgotamento de retries nunca deixam uma validação ativa sem dono e sem caminho de recuperação.

## Correções recomendadas para operação confiável

### 7. Worker antigo pode finalizar um job após perder a lease — P2

**O que é:** o heartbeat verifica `locked_by`, mas os updates de conclusão e falha do job usam apenas `where id=%s`. [Worker](../../src/drc/worker.py), `run_once` e `_heartbeat`. Evidência: leitura do código; não foi simulada uma pausa real de processo por mais de 120 segundos.

**Caso concreto:** W1 fica pausado e perde a lease; W2 reclama o job; W1 retorna e grava `done` ou `queued` sobre o trabalho que agora pertence a W2. O handler de W1 também não é interrompido quando o heartbeat detecta a perda.

**Correção mínima:** condicionar conclusão/falha ao dono e ao estado ativo da lease. Para prevenir efeitos tardios do handler, carregue um token de tentativa e valide a posse antes das gravações relevantes. Uma comparação de dono apenas no heartbeat é insuficiente.

**Se adiado:** retomada após falhas pode produzir estados que não correspondem ao worker atual.

**Aceite:** teste troca a posse enquanto o handler antigo está bloqueado; o antigo não consegue concluir nem reencaminhar o job da nova tentativa.

### 8. Linha do tempo limita os eventos mais antigos — P2

**O que é:** o endpoint do incidente usa `order by at limit 200`. [API](../../src/drc/api.py), `incident`. Evidência: consulta SQL, sem geração de 201 eventos neste review.

**Caso concreto:** após muitas investigações e recorrências, eventos novos deixam de aparecer. A pessoa que busca a ação mais recente vê apenas o começo do histórico.

**Correção mínima:** selecionar a página dos eventos mais recentes com desempate por ID, e ordenar essa página cronologicamente para exibir; informar o truncamento. Se houver necessidade de consultar o restante, adicionar paginação por cursor.

**Se adiado:** ações recentes podem parecer não ter ocorrido, gerando repetição de comandos ou interpretações erradas.

**Aceite:** com mais de 200 eventos, o último aparece e a UI informa que há histórico anterior.

### 9. Argumentos de ferramentas entram em logs e traces sem política de redação — P2

**O que é:** `tools.call` exporta `json.dumps(args)` no atributo `tool.args` e no log estruturado. `sample_rows` aceita uma chave de registro para datasets ligados a clientes. [Ferramentas](../../src/drc/tools.py), `sample_rows` e `call`. Evidência: leitura das ferramentas e dos pontos de exportação; nenhum dado pessoal real foi usado.

**Caso concreto:** consultar uma chave de cliente ou contrato envia o identificador para um backend de telemetria, independentemente do acesso restrito da evidência resultante.

**Correção mínima:** logar o nome da ferramenta, dataset, duração, contagens e status; omitir valores de chaves de registro nos atributos de telemetria. Se correlação por registro for necessária, usar um identificador opaco com política de retenção e acesso definida.

**Se adiado:** o backend de observabilidade pode se tornar uma cópia de identificadores sensíveis.

**Aceite:** teste de captura de logs e exportação de spans verifica ausência de um marcador enviado como argumento de chave.

## O que implementar depois, em ordem

| Ordem | Entrega | Por que vale fazer | Critério de conclusão | Esforço relativo |
|---|---|---|---|---|
| 1 | Corrigir itens 1–6 e adicionar regressões | Confiança no acesso, na fila e no snapshot investigado | Cada reprodução passa a ser recusada ou preserva o estado correto | M |
| 2 | Execução sintética iniciada pela UI | A pessoa consegue demonstrar o ciclo completo sem alternar para CLI | Endpoint de dev com cenários permitidos, confirmação da recarga, idempotência e job; sem aceitar SQL, comandos ou caminhos arbitrários | M |
| 3 | Progresso persistido das etapas do pipeline | O usuário vê qual etapa está trabalhando antes do audit event final | Registrar início/fim/status por etapa; UI distingue executando, falhou, não iniciou e resultado ausente | M |
| 4 | Investigação com execução fixa e acesso ao trace | Conectar problema, evidência, LangGraph e duração numa investigação | `pipeline_run_id` e IDs de traces persistidos; link só com destino configurado; nenhum diagnóstico inferido de spans | M |
| 5 | Propagação de contexto API → job → worker | O trace acompanha a request assíncrona e os spans do grafo | Contexto W3C no job, extração no worker, spans por nó com duração/status e sem payload sensível | M |
| 6 | E2E de ciclo completo na CI | Hoje a CI web roda sem banco/API e pula a suíte live | Ambiente descartável com API, worker e IDs; investigação, validação, decisão e permissões verificadas em cada PR | M |
| 7 | Medição com LLM real | Diferenciar engenharia funcionando de qualidade do investigador | Dev split com acurácia, abstenção, erros, custo e latência; protocolo congelado antes do final | M |
| 8 | Paginação real e carregamento sob demanda | Melhorar a operação quando o histórico deixar de ser pequeno | Busca e paginação no servidor; filtros preservados; consultas e payloads medidos antes/depois | M |

S/M/L são comparações relativas, não estimativas de calendário. Os itens 2–5 são recomendações; esta entrega implementa consulta de execuções, não o disparo pela UI, progresso de cada nó ou correlação automática com Jaeger.

### Limites conhecidos que não devem ser tratados como recursos prontos

- Papéis por header e seletor na UI são para desenvolvimento. O backend recusa modos de autenticação não implementados; antes de expor a aplicação, é preciso autenticação real e autorização por identidade.
- Artefatos locais não são armazenamento compartilhado para workers em outras máquinas ou containers efêmeros. Cloud exige resolver persistência e bootstrap dos papéis do PostgreSQL.
- Sandbox no mesmo servidor isola banco e credenciais, mas não CPU, IO ou comprometimento do servidor.
- Benchmark fake não mede raciocínio de modelo real, resistência a prompt injection ou qualidade semântica das conclusões.
- A listagem de execuções é limitada a 20 na UI e 200 na API. O volume local cabe; não foi feito benchmark de consultas com centenas de milhares de runs. A tela informa esse limite.
- O build ainda avisa sobre módulos Mantine com `use client` e chunk acima de 500 kB. O bundle gera e executa; carregamento sob demanda de avaliações/gallery só deve ser priorizado com medição de carga inicial.

## Validação desta entrega

Validações executadas no ambiente local isolado:

| Check | Resultado |
|---|---|
| Backend: `pytest -q -rs` | 40 passed, sem skips |
| Ruff format + lint | Aprovado |
| mypy | Aprovado em 21 arquivos |
| TypeScript, build e contraste | Aprovados; avisos de bundle documentados acima |
| Playwright completo, com IDs live | 42 passed, sem falhas |
| Novos fluxos, incluindo filtro de checks | 7 passed, incluídos na rodada final dos 42 casos |
| Inspeção da UI em 4174 com dados reais | 7 screenshots; nenhum pageerror; reflow mobile sem overflow |

Os testes acrescentados cobrem limites da API, ausência de resultados, contagens de checks, pior freshness, navegação até incidentes, atualização periódica, acessibilidade e reflow em 320 px. A suíte live também abre histórico e detalhe de execução contra dados reais da API local. O filtro de checks foi acrescentado após a inspeção mobile e validado novamente; a seleção All checks mantém os passes acessíveis.

Não foram executados deploy cloud, benchmark de carga, LLM real, nem uma auditoria exaustiva de Terraform e de todas as dependências. Não foi redesenhado o fluxo de aprovação para mascarar as falhas de backend relatadas. O objetivo da UI é expor estado registrado e próxima ação, mantendo visíveis as limitações.

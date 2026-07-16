# CONTROLE OFICIAL — PILAR 18 DO ZION

## Papéis, permissões, multi-loja, responsáveis, demo, acessos e governança

### Estado atual

* Progresso oficial: **0%**
* Bloco atual: **Bloco 1 — Governança e controle do escopo**
* Pilar 9: **em andamento**
* Pilar 8: **aprovado para o Gate do Piloto de 2 meses, com pendências não bloqueantes movidas para o Pilar 19B**
* Pilar 18: **em execução paralela e conservadora**
* Pilar 19-A: **obrigatório antes do piloto**
* Pilar 19-B: **melhorias não bloqueantes pós-piloto**

---

## Regra obrigatória de conclusão

Nenhum bloco pode ser considerado concluído apenas porque o código foi implementado.

Para fechar um bloco, devem existir:

1. Diagnóstico do estado anterior.
2. Decisões aprovadas.
3. Implementação completa do escopo aprovado.
4. Testes manuais e/ou automatizados.
5. Testes de tentativa de acesso indevido.
6. Regressão das áreas afetadas.
7. Evidências dos testes.
8. Lista de pendências restantes.
9. Confirmação de que não houve solução personalizada para um único caso de teste.
10. Confirmação de que backend e banco não dependem apenas da interface para segurança.

Caso algum desses pontos não seja atendido, o bloco continuará aberto.

---

## Regra de convivência com o Pilar 9

O Pilar 18 não deve finalizar, reescrever ou inventar regras funcionais ainda abertas no Pilar 9.

Itens dependentes dessas decisões devem ser registrados como:

> **AGUARDAR DOSSIÊ FINAL DO PILAR 9.**

Isso inclui, quando ainda não estiver definido:

* transições finais do CRM;
* Método Comercial ZION V1;
* eventos e cards finais do Pilar 9;
* gatilhos comerciais;
* Follow-up;
* visita técnica;
* pagamento;
* contrato dentro do fluxo comercial;
* devolução da conversa para a IA;
* instruções do responsável;
* pós-venda.

---

## Regra de criação de contas

Não haverá botão público de criação de conta para usuários de lojas.

Somente um **ZION ADM interno**, pela área **Zion-ADM**, poderá iniciar a criação ou liberação de uma nova conta.

O processo deverá garantir:

* criação controlada;
* convite ou ativação segura;
* vínculo explícito à organização;
* vínculo explícito à loja;
* papel inicial definido;
* bloqueio de usuário sem membership válida;
* auditoria de quem criou ou liberou o acesso;
* impossibilidade de um administrador comum de loja criar contas livremente.

---

## Blocos oficiais

| Bloco | Escopo                                       | Peso | Acumulado | Estado                 |
| ----- | -------------------------------------------- | ---: | --------: | ---------------------- |
| 1     | Governança e controle do escopo              |   3% |        3% | Em andamento           |
| 2     | Diagnóstico completo do estado atual         |  12% |       15% | Não iniciado           |
| 3     | Papéis oficiais e matriz de permissões       |  10% |       25% | Não iniciado           |
| 4     | Membership e arquitetura multi-loja          |  11% |       36% | Não iniciado           |
| 5     | Autorização real no backend                  |  15% |       51% | Não iniciado           |
| 6     | Permissões refletidas na interface           |   7% |       58% | Não iniciado           |
| 7     | Múltiplos responsáveis                       |   8% |       66% | Não iniciado           |
| 8     | Permissões do WhatsApp do responsável        |   5% |       71% | Não iniciado           |
| 9     | Criação de contas e convites pelo Zion-ADM   |   6% |       77% | Não iniciado           |
| 10    | Loja demo                                    |   4% |       81% | Não iniciado           |
| 11    | Offboarding e desativação                    |   5% |       86% | Não iniciado           |
| 12    | Auditoria mínima                             |   5% |       91% | Não iniciado           |
| 13    | Testes gerais, regressão e dossiê estrutural |   6% |       97% | Não iniciado           |
| 14    | Complemento após o dossiê final do Pilar 9   |   3% |      100% | Bloqueado pelo Pilar 9 |

A porcentagem representa **escopo fechado e validado**, não tempo ou esforço.

---

## Registro 1 — Aguardar dossiê final do Pilar 9

Adicionar aqui qualquer ponto que dependa de uma decisão funcional ainda aberta no Pilar 9.

| Data | Item                                      | Motivo                     | Área afetada | Estado     |
| ---- | ----------------------------------------- | -------------------------- | ------------ | ---------- |
| —    | Complemento final de permissões e eventos | Pilar 9 ainda em andamento | Pilar 18     | Aguardando |

---

## Registro 2 — Pendências obrigatórias do Pilar 19-A

Entram aqui riscos críticos que precisam ser vistoriados ou testados antes do piloto.

Exemplos:

* RLS e policies;
* isolamento por organização e loja;
* storage e signed URLs;
* anexos sensíveis;
* permissões reais no backend;
* ações pelo WhatsApp do responsável;
* idempotência;
* eventos críticos;
* integrações;
* importação e armazenamento ligados ao Pilar 8;
* orquestração ponta a ponta dos dois canais.

| Data | Pendência                                        | Risco                                     | Área                | Estado   |
| ---- | ------------------------------------------------ | ----------------------------------------- | ------------------- | -------- |
| —    | Auditoria final de RLS, policies e isolamento    | Vazamento entre lojas                     | Banco               | Pendente |
| —    | Orquestração completa do WhatsApp do responsável | Ação ou resposta vinculada incorretamente | Assistente/WhatsApp | Pendente |

---

## Registro 3 — Pendências não bloqueantes do Pilar 19-B

Somente melhorias que não comprometam segurança, integridade, isolamento ou funcionamento mínimo do piloto podem entrar aqui.

| Data | Pendência                                      | Motivo do adiamento | Risco aceito | Estado |
| ---- | ---------------------------------------------- | ------------------- | ------------ | ------ |
| —    | Nenhuma registrada pelo Pilar 18 até o momento | —                   | —            | —      |

---

## Registro 4 — Riscos aceitos no piloto

Nenhum risco crítico de segurança poderá ser aceito apenas para acelerar o piloto.

| Data | Risco             | Impacto | Mitigação | Responsável pela decisão |
| ---- | ----------------- | ------- | --------- | ------------------------ |
| —    | Nenhum registrado | —       | —         | —                        |

---

## Travas obrigatórias

1. Não fazer hardcode por `organization_id`, `store_id`, `user_id`, e-mail, nome, SKU ou arquivo de teste.
2. Não usar loja ou usuário de teste como regra fixa.
3. Não corrigir apenas o caso usado para reproduzir um defeito.
4. Não depender apenas da interface para bloquear ações.
5. Backend e banco devem validar membership e permissão.
6. Não quebrar o acesso atual de owner/admin sem migração segura.
7. Não apagar dados para esconder conflitos.
8. Não misturar dados demo com dados reais.
9. Não expor documentos, anexos, Pix, tokens ou informações financeiras a papéis indevidos.
10. Não reabrir regras comerciais do Pilar 9.
11. Não implementar billing ou Asaas.
12. Não empurrar risco crítico para o Pilar 19-B.
13. Não chamar bloco de concluído sem testes.
14. Não considerar o Pilar 18 100% antes do complemento do dossiê final do Pilar 9.

---

## Evidências obrigatórias por bloco

Para cada bloco concluído, registrar:

* arquivos alterados;
* migrations aplicadas;
* tabelas ou funções afetadas;
* rotas protegidas;
* papéis testados;
* usuários e lojas de teste, sem criar hardcodes;
* casos positivos;
* casos negativos;
* tentativa de acesso cruzado;
* resultado esperado;
* resultado obtido;
* prints ou logs relevantes;
* regressões realizadas;
* pendências restantes;
* commit criado manualmente pelo usuário.

---

## Histórico de progresso

| Data | Bloco | Alteração                                | Progresso anterior | Progresso novo |
| ---- | ----- | ---------------------------------------- | -----------------: | -------------: |
| —    | 1     | Início da governança oficial do Pilar 18 |                 0% |             0% |

O progresso permanecerá em 0% até o Bloco 1 ser integralmente validado.

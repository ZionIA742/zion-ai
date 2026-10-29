-- ZION / PILAR 19-A / BLOCO 6 / ETAPA 5.2-E.1-A.1
-- Fundacao da fila de preparacao de orcamentos.
-- Preserva agendamentos existentes e isolamento tenant.
-- Nao cria tarefas, nao autoriza execucao e nao ativa worker.

BEGIN;

-- Preservar os estados existentes.
-- Permitir o novo tipo sem alterar o default.

ALTER TABLE public.store_assistant_operational_task_queue
    DROP CONSTRAINT IF EXISTS
        store_assistant_operational_task_queue_type_check;

ALTER TABLE public.store_assistant_operational_task_queue
    ADD CONSTRAINT
        store_assistant_operational_task_queue_type_check
    CHECK (
        queue_type IN (
            'customer_reply_to_operational_task',
            'quote_preparation_request'
        )
    );

-- Primeiro criar a protecao equivalente para agendamentos.
-- A unicidade por message_id continua global nesse tipo.

CREATE UNIQUE INDEX IF NOT EXISTS
    store_assistant_operational_task_queue_customer_reply_message_unique
ON public.store_assistant_operational_task_queue (
    message_id
)
WHERE queue_type = 'customer_reply_to_operational_task';

-- Preparacao: uma entrada por tarefa e tenant.

CREATE UNIQUE INDEX IF NOT EXISTS
    p19a_quote_preparation_queue_task_unique
ON public.store_assistant_operational_task_queue (
    organization_id,
    store_id,
    task_id
)
WHERE queue_type = 'quote_preparation_request'
  AND task_id IS NOT NULL;

-- Preparacao: uma entrada por mensagem original e tenant.

CREATE UNIQUE INDEX IF NOT EXISTS
    p19a_quote_preparation_queue_message_unique
ON public.store_assistant_operational_task_queue (
    organization_id,
    store_id,
    message_id
)
WHERE queue_type = 'quote_preparation_request'
  AND message_id IS NOT NULL;

-- Somente depois de criar os novos indices,
-- remover a antiga unicidade global compartilhada.
-- A operacao inteira e transacional.

DROP INDEX IF EXISTS
    public.store_assistant_operational_task_queue_message_unique;

COMMENT ON INDEX
    public.store_assistant_operational_task_queue_customer_reply_message_unique
IS
    'Preserva unicidade global da mensagem para filas '
    'de resposta operacional do cliente.';

COMMENT ON INDEX
    public.p19a_quote_preparation_queue_task_unique
IS
    'Impede duplicacao de preparacao de orcamento '
    'por organizacao, loja e tarefa.';

COMMENT ON INDEX
    public.p19a_quote_preparation_queue_message_unique
IS
    'Impede duplicacao de preparacao de orcamento '
    'por organizacao, loja e mensagem incoming.';

COMMIT;

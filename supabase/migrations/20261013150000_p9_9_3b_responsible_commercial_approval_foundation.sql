-- ZION / PILAR 9 / BLOCO 9 / ETAPA 9.3-B
-- Fundacao da autoridade de aprovacoes comerciais.
--
-- NAO executa envios.
-- NAO altera orcamentos.
-- NAO altera PDFs de contratos.
-- NAO modifica tabelas operacionais existentes.

BEGIN;

CREATE TABLE public.p9_responsible_commercial_approval_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL,
    store_id uuid NOT NULL,
    responsible_id uuid NOT NULL,

    commercial_opportunity_id uuid NOT NULL,
    lifecycle_cycle integer NOT NULL
        CHECK (lifecycle_cycle > 0),

    request_kind text NOT NULL
        CHECK (
            request_kind IN (
                'quote_send_approval',
                'contract_send_authorization'
            )
        ),

    request_key text NOT NULL
        CHECK (
            length(btrim(request_key)) BETWEEN 16 AND 512
        ),

    quote_id uuid NOT NULL,
    quote_version_id uuid NOT NULL,

    proposal_acceptance_event_id uuid,

    contract_template_id uuid,
    contract_template_version_id uuid,

    report_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(report_snapshot) = 'object'),

    status text NOT NULL DEFAULT 'pending_dispatch'
        CHECK (
            status IN (
                'pending_dispatch',
                'awaiting_responsible',
                'dispatch_uncertain',
                'approved',
                'rejected',
                'changes_requested',
                'superseded',
                'cancelled',
                'fulfilled'
            )
        ),

    outbound_notification_id uuid,
    outbound_external_message_id text,

    decision_inbound_message_id uuid,
    decision_external_message_id text,
    decision_text text,
    decided_at timestamptz,

    customer_outbound_message_id uuid,
    fulfilled_at timestamptz,

    invalidated_at timestamptz,
    invalidated_reason text,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT p9_commercial_approval_document_kind_ck
        CHECK (
            (
                request_kind = 'quote_send_approval'
                AND proposal_acceptance_event_id IS NULL
                AND contract_template_id IS NULL
                AND contract_template_version_id IS NULL
            )
            OR
            (
                request_kind = 'contract_send_authorization'
                AND proposal_acceptance_event_id IS NOT NULL
                AND contract_template_id IS NOT NULL
                AND contract_template_version_id IS NOT NULL
            )
        ),

    CONSTRAINT p9_commercial_approval_decision_evidence_ck
        CHECK (
            status NOT IN (
                'approved',
                'rejected',
                'changes_requested',
                'fulfilled'
            )
            OR (
                decision_inbound_message_id IS NOT NULL
                AND NULLIF(
                    btrim(decision_external_message_id),
                    ''
                ) IS NOT NULL
                AND decided_at IS NOT NULL
            )
        ),

    CONSTRAINT p9_commercial_approval_fulfillment_ck
        CHECK (
            status <> 'fulfilled'
            OR (
                customer_outbound_message_id IS NOT NULL
                AND fulfilled_at IS NOT NULL
            )
        ),

    CONSTRAINT p9_commercial_approval_opportunity_fk
        FOREIGN KEY (commercial_opportunity_id)
        REFERENCES public.commercial_opportunities(id),

    CONSTRAINT p9_commercial_approval_quote_fk
        FOREIGN KEY (quote_id)
        REFERENCES public.sales_quotes(id),

    CONSTRAINT p9_commercial_approval_quote_version_fk
        FOREIGN KEY (quote_version_id)
        REFERENCES public.sales_quote_versions(id),

    CONSTRAINT p9_commercial_approval_acceptance_fk
        FOREIGN KEY (proposal_acceptance_event_id)
        REFERENCES public.commercial_proposal_acceptance_events(id),

    CONSTRAINT p9_commercial_approval_template_fk
        FOREIGN KEY (contract_template_id)
        REFERENCES public.store_contract_templates(id),

    CONSTRAINT p9_commercial_approval_template_version_fk
        FOREIGN KEY (contract_template_version_id)
        REFERENCES public.store_contract_template_versions(id),

    CONSTRAINT p9_commercial_approval_notification_fk
        FOREIGN KEY (outbound_notification_id)
        REFERENCES public.store_responsible_external_notifications(id),

    CONSTRAINT p9_commercial_approval_responsible_message_fk
        FOREIGN KEY (decision_inbound_message_id)
        REFERENCES public.store_assistant_messages(id),

    CONSTRAINT p9_commercial_approval_request_key_uidx
        UNIQUE (
            organization_id,
            store_id,
            request_key
        )
);

-- Somente uma solicitacao ativa de cada tipo
-- por oportunidade comercial.

CREATE UNIQUE INDEX
    p9_commercial_approval_one_active_per_kind_uidx
ON public.p9_responsible_commercial_approval_requests (
    organization_id,
    store_id,
    commercial_opportunity_id,
    request_kind
)
WHERE status IN (
    'pending_dispatch',
    'awaiting_responsible',
    'dispatch_uncertain',
    'approved'
);

-- Uma mesma notificacao nao pode representar
-- duas solicitacoes de aprovacao.

CREATE UNIQUE INDEX
    p9_commercial_approval_notification_uidx
ON public.p9_responsible_commercial_approval_requests (
    outbound_notification_id
)
WHERE outbound_notification_id IS NOT NULL;

-- Uma mesma resposta humana nao pode decidir
-- duas solicitacoes comerciais diferentes.

CREATE UNIQUE INDEX
    p9_commercial_approval_inbound_decision_uidx
ON public.p9_responsible_commercial_approval_requests (
    decision_inbound_message_id
)
WHERE decision_inbound_message_id IS NOT NULL;

CREATE UNIQUE INDEX
    p9_commercial_approval_external_decision_uidx
ON public.p9_responsible_commercial_approval_requests (
    organization_id,
    store_id,
    decision_external_message_id
)
WHERE decision_external_message_id IS NOT NULL;

-- Identificacao da solicitacao pela mensagem
-- original enviada ao responsavel.

CREATE UNIQUE INDEX
    p9_commercial_approval_outbound_external_uidx
ON public.p9_responsible_commercial_approval_requests (
    organization_id,
    store_id,
    outbound_external_message_id
)
WHERE outbound_external_message_id IS NOT NULL;

CREATE INDEX
    p9_commercial_approval_pending_idx
ON public.p9_responsible_commercial_approval_requests (
    organization_id,
    store_id,
    responsible_id,
    status,
    created_at DESC
);

-- Fechado para acesso direto do cliente.
-- Os futuros writers canonicos validarao os vinculos
-- entre loja, oportunidade, versoes e mensagem humana.

ALTER TABLE public.p9_responsible_commercial_approval_requests
ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON public.p9_responsible_commercial_approval_requests
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE
ON public.p9_responsible_commercial_approval_requests
TO service_role;

COMMENT ON TABLE
public.p9_responsible_commercial_approval_requests
IS
'P9: solicitacoes de aprovacao de orcamento e autorizacao de envio do PDF padrao, por WhatsApp do responsavel. Nenhuma autoridade de envio e concedida por esta tabela isoladamente.';

COMMIT;

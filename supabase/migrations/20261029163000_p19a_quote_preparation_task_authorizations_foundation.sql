-- ZION / PILAR 19-A / BLOCO 6 / ETAPA 5.2-E.1-A.2
-- Fundacao da autorizacao individual de preparacao.
-- Nao emite autorizacoes, nao enfileira e nao cria orcamentos.

BEGIN;

-- Garantir referencia composta para impedir que
-- uma autorizacao seja associada a outro tenant.

CREATE UNIQUE INDEX
    p19a_operational_tasks_identity_scope_uidx
ON public.store_assistant_operational_tasks (
    id,
    organization_id,
    store_id
);

CREATE TABLE public.p19a_quote_preparation_task_authorizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL,
    store_id uuid NOT NULL,
    task_id uuid NOT NULL,
    request_message_id uuid NOT NULL,

    issued_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,

    revoked_at timestamptz,
    revocation_reason text,

    CONSTRAINT p19a_quote_prep_auth_task_scope_fk
        FOREIGN KEY (
            task_id,
            organization_id,
            store_id
        )
        REFERENCES public.store_assistant_operational_tasks (
            id,
            organization_id,
            store_id
        )
        ON DELETE RESTRICT,

    CONSTRAINT p19a_quote_prep_auth_task_unique
        UNIQUE (
            organization_id,
            store_id,
            task_id
        ),

    CONSTRAINT p19a_quote_prep_auth_message_unique
        UNIQUE (
            organization_id,
            store_id,
            request_message_id
        ),

    CONSTRAINT p19a_quote_prep_auth_expiry_check
        CHECK (expires_at > issued_at),

    CONSTRAINT p19a_quote_prep_auth_revocation_check
        CHECK (
            revoked_at IS NOT NULL
            OR revocation_reason IS NULL
        )
);

-- Autoridade interna.
-- Nenhum usuario comum pode emitir autorizacoes.
-- Nem o service_role recebe escrita direta.
-- Uma RPC SECURITY DEFINER especifica sera
-- implementada na microetapa seguinte.

ALTER TABLE
    public.p19a_quote_preparation_task_authorizations
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.p19a_quote_preparation_task_authorizations
FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE
    public.p19a_quote_preparation_task_authorizations
IS
    'Autorizacoes sistemicas individuais de preparacao '
    'de orcamento P19-A. Nao autoriza aprovacao, PDF '
    'ou envio. Emissao e validacao por RPCs protegidas.';

COMMENT ON COLUMN
    public.p19a_quote_preparation_task_authorizations.request_message_id
IS
    'Identidade da mensagem incoming que originou '
    'a solicitacao, validada pela futura RPC emissora.';

COMMENT ON COLUMN
    public.p19a_quote_preparation_task_authorizations.expires_at
IS
    'Limite de validade da autorizacao. '
    'Autorizacao expirada nao permite processamento.';

COMMIT;

-- ZION-ADM | Bloco 1 | Etapa 2.3-B.5-D
-- Historico candidato de vinculacoes financeiras Meta.
--
-- NAO representa faturamento confirmado.
-- NAO representa isencao ou custo zero.
-- NAO cria registros historicos retroativos.
-- NAO concede INSERT a papeis da aplicacao.
-- NAO cria RPC de escrita nem altera fechamentos.
--
-- A futura RPC devera validar tenancy, identificadores,
-- origem autenticada, transicoes, continuidade e idempotencia.
-- O instante de registro no banco sera o ponto inicial
-- conservador de cada observacao, nunca uma prova retroativa.

BEGIN;

CREATE TABLE public.zion_admin_meta_financial_binding_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    store_id uuid NOT NULL
        REFERENCES public.stores(id)
        ON DELETE RESTRICT,

    integration_id uuid NOT NULL
        REFERENCES public.external_integrations(id)
        ON DELETE RESTRICT,

    whatsapp_business_account_id text NOT NULL
        CHECK (
            whatsapp_business_account_id ~ '^[0-9]{5,25}$'
        ),

    event_type text NOT NULL
        CHECK (
            event_type IN ('bound', 'unbound')
        ),

    financial_account_type text
        CHECK (
            financial_account_type IS NULL
            OR financial_account_type IN (
                'messaging_account',
                'business_portfolio'
            )
        ),

    financial_account_id text
        CHECK (
            financial_account_id IS NULL
            OR financial_account_id ~ '^[A-Za-z0-9:_-]{1,128}$'
        ),

    source_kind text NOT NULL
        CHECK (
            source_kind IN (
                'meta_api_observation',
                'integration_state_observation'
            )
        ),

    source_fingerprint_sha256 text NOT NULL
        CHECK (
            source_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        ),

    operation_key text NOT NULL UNIQUE
        CHECK (
            length(btrim(operation_key)) BETWEEN 1 AND 200
            AND operation_key = btrim(operation_key)
        ),

    authority_status text NOT NULL DEFAULT 'candidate_only'
        CHECK (
            authority_status = 'candidate_only'
        ),

    recorded_at timestamptz NOT NULL
        DEFAULT clock_timestamp(),

    CONSTRAINT zamfbe_store_tenancy_fk
        FOREIGN KEY (store_id, organization_id)
        REFERENCES public.stores(id, organization_id)
        ON DELETE RESTRICT,

    -- Vinculacao e desvinculacao devem identificar
    -- explicitamente a conta financeira envolvida.
    CONSTRAINT zamfbe_event_payload_check
        CHECK (
            financial_account_type IS NOT NULL
            AND financial_account_id IS NOT NULL
        )
);

-- A mesma conta financeira podera atender varias WABAs.
-- Os indices nao presumem relacionamento 1:1.

CREATE INDEX zamfbe_waba_history_idx
ON public.zion_admin_meta_financial_binding_events (
    organization_id,
    store_id,
    whatsapp_business_account_id,
    id DESC
);

CREATE INDEX zamfbe_financial_account_history_idx
ON public.zion_admin_meta_financial_binding_events (
    financial_account_type,
    financial_account_id,
    id DESC
);

CREATE INDEX zamfbe_integration_history_idx
ON public.zion_admin_meta_financial_binding_events (
    integration_id,
    id DESC
);

-- Confere tenancy e WABA no estado observado.
-- O bloqueio da linha impede alteracao concorrente
-- da integracao durante a transacao de registro.
--
-- Isso nao autentica faturamento Meta e nao impede
-- alteracoes futuras da integracao, que deverao
-- produzir novos eventos no futuro writer.

CREATE FUNCTION public.zion_admin_validate_meta_binding_event_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    PERFORM 1
    FROM public.external_integrations AS ei
    WHERE ei.id = NEW.integration_id
      AND ei.organization_id = NEW.organization_id
      AND ei.store_id = NEW.store_id
      AND ei.provider = 'whatsapp'
      AND ei.whatsapp_business_account_id =
          NEW.whatsapp_business_account_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'ZION_ADMIN_META_BINDING_TENANCY_MISMATCH';
    END IF;

    -- Nunca aceitar horario retroativo fornecido
    -- pelo chamador da futura RPC.
    NEW.recorded_at := clock_timestamp();

    RETURN NEW;
END;
$function$;

CREATE TRIGGER zamfbe_validate_insert
BEFORE INSERT
ON public.zion_admin_meta_financial_binding_events
FOR EACH ROW
EXECUTE FUNCTION
    public.zion_admin_validate_meta_binding_event_insert();

-- Registros append-only: nenhum UPDATE ou DELETE.
CREATE FUNCTION public.zion_admin_reject_meta_binding_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    RAISE EXCEPTION
        'ZION_ADMIN_META_BINDING_EVENT_IMMUTABLE';
END;
$function$;

CREATE TRIGGER zamfbe_immutable
BEFORE UPDATE OR DELETE
ON public.zion_admin_meta_financial_binding_events
FOR EACH ROW
EXECUTE FUNCTION
    public.zion_admin_reject_meta_binding_event_mutation();

ALTER TABLE public.zion_admin_meta_financial_binding_events
    ENABLE ROW LEVEL SECURITY;

-- Nenhum papel de aplicacao pode gravar eventos.
REVOKE ALL ON TABLE
    public.zion_admin_meta_financial_binding_events
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
    public.zion_admin_meta_financial_binding_events
TO service_role;

REVOKE ALL ON SEQUENCE
    public.zion_admin_meta_financial_binding_events_id_seq
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
    public.zion_admin_validate_meta_binding_event_insert()
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
    public.zion_admin_reject_meta_binding_event_mutation()
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
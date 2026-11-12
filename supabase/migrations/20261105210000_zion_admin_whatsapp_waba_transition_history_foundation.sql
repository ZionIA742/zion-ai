-- ZION-ADM | Bloco 1 | Etapa 2.3-B.5-E
-- Fundacao do historico operacional de WABAs.
--
-- Nao registra identidade financeira Meta.
-- Nao comprova faturamento ou isencao.
-- Nao reconstrui eventos anteriores a instalacao.
-- Nao altera external_integrations.
-- Nao cria trigger automatico nesta etapa.
-- Nao cria RPC de escrita.
-- Nao bloqueia operacoes WhatsApp.
--
-- A instrumentacao futura deve ser testada isoladamente
-- e nao deve impedir atualizacoes da integracao.
-- Falhas ou lacunas de auditoria impedem conclusoes
-- sobre cobertura historica financeira.

BEGIN;

CREATE TABLE public.zion_admin_whatsapp_waba_transition_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    integration_id uuid NOT NULL,

    event_kind text NOT NULL
        CHECK (
            event_kind IN ('created', 'changed', 'deleted')
        ),

    previous_organization_id uuid,
    previous_store_id uuid,
    current_organization_id uuid,
    current_store_id uuid,

    previous_provider text,
    current_provider text,

    previous_waba_id text,
    current_waba_id text,

    previous_active boolean,
    current_active boolean,

    previous_status text,
    current_status text,

    source_kind text NOT NULL DEFAULT 'database_observation'
        CHECK (source_kind = 'database_observation'),

    authority_status text NOT NULL DEFAULT 'operational_only'
        CHECK (authority_status = 'operational_only'),

    recorded_at timestamptz NOT NULL
        DEFAULT clock_timestamp(),

    CONSTRAINT zawte_event_shape_check
        CHECK (
            (
                event_kind = 'created'
                AND previous_organization_id IS NULL
                AND previous_store_id IS NULL
                AND previous_provider IS NULL
                AND current_organization_id IS NOT NULL
                AND current_store_id IS NOT NULL
                AND current_provider IS NOT NULL
            )
            OR
            (
                event_kind = 'changed'
                AND previous_organization_id IS NOT NULL
                AND previous_store_id IS NOT NULL
                AND previous_provider IS NOT NULL
                AND current_organization_id IS NOT NULL
                AND current_store_id IS NOT NULL
                AND current_provider IS NOT NULL
            )
            OR
            (
                event_kind = 'deleted'
                AND previous_organization_id IS NOT NULL
                AND previous_store_id IS NOT NULL
                AND previous_provider IS NOT NULL
                AND current_organization_id IS NULL
                AND current_store_id IS NULL
                AND current_provider IS NULL
            )
        ),

    CONSTRAINT zawte_whatsapp_scope_check
        CHECK (
            COALESCE(previous_provider = 'whatsapp', false)
            OR COALESCE(current_provider = 'whatsapp', false)
        )
);

-- Sem FK para external_integrations nesta fundacao:
-- o historico deve sobreviver a exclusao da integracao
-- e nao deve bloquear operacoes humanas.

CREATE INDEX zawte_integration_history_idx
ON public.zion_admin_whatsapp_waba_transition_events (
    integration_id,
    id DESC
);

CREATE INDEX zawte_previous_scope_idx
ON public.zion_admin_whatsapp_waba_transition_events (
    previous_organization_id,
    previous_store_id,
    id DESC
);

CREATE INDEX zawte_current_scope_idx
ON public.zion_admin_whatsapp_waba_transition_events (
    current_organization_id,
    current_store_id,
    id DESC
);

-- Historico append-only.

CREATE FUNCTION public.zion_admin_reject_waba_transition_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    RAISE EXCEPTION
        'ZION_ADMIN_WABA_TRANSITION_IMMUTABLE';
END;
$function$;

CREATE TRIGGER zawte_immutable
BEFORE UPDATE OR DELETE
ON public.zion_admin_whatsapp_waba_transition_events
FOR EACH ROW
EXECUTE FUNCTION
    public.zion_admin_reject_waba_transition_mutation();

ALTER TABLE public.zion_admin_whatsapp_waba_transition_events
    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.zion_admin_whatsapp_waba_transition_events
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
    public.zion_admin_whatsapp_waba_transition_events
TO service_role;

REVOKE ALL ON SEQUENCE
    public.zion_admin_whatsapp_waba_transition_events_id_seq
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
    public.zion_admin_reject_waba_transition_mutation()
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
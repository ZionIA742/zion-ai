-- ZION-ADM Bloco 2: fundacao da Central de Diagnostico.
-- Nenhuma captura ou execucao automatica e habilitada aqui.
-- As futuras RPCs devem validar permissao e sanitizar evidencias.

BEGIN;

-- Pre-condicao confirmada na auditoria 2.2-D.4-A:
-- stores_id_organization_uidx ja existe em public.stores
-- com UNIQUE (id, organization_id).
-- A FK composta abaixo utiliza esse indice existente.
-- Nao criar indice redundante.

CREATE TABLE public.zion_admin_diagnostic_incidents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_key text NOT NULL UNIQUE,

    scope text NOT NULL
        CHECK (scope IN ('system', 'organization', 'store')),

    organization_id uuid
        REFERENCES public.organizations(id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    store_id uuid,

    component text NOT NULL,
    category text NOT NULL,

    severity text NOT NULL
        CHECK (severity IN (
            'info', 'warning', 'error', 'critical'
        )),

    status text NOT NULL DEFAULT 'open'
        CHECK (status IN (
            'open', 'investigating', 'resolved'
        )),

    cause_confidence text NOT NULL DEFAULT 'unknown'
        CHECK (cause_confidence IN (
            'unknown', 'hypothesis', 'confirmed'
        )),

    title_simple text NOT NULL,
    explanation_simple text,
    impact_simple text,
    next_action_simple text,
    cause_explanation_simple text,

    first_seen_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL,
    resolved_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT diagnostic_incident_scope_check CHECK (
        (
            scope = 'system'
            AND organization_id IS NULL
            AND store_id IS NULL
        )
        OR (
            scope = 'organization'
            AND organization_id IS NOT NULL
            AND store_id IS NULL
        )
        OR (
            scope = 'store'
            AND organization_id IS NOT NULL
            AND store_id IS NOT NULL
        )
    ),

    CONSTRAINT diagnostic_incident_store_organization_fk
        FOREIGN KEY (store_id, organization_id)
        REFERENCES public.stores (id, organization_id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,

    CONSTRAINT diagnostic_incident_key_nonempty CHECK (
        length(btrim(incident_key)) > 0
    )
);

CREATE INDEX diagnostic_incidents_status_seen_idx
    ON public.zion_admin_diagnostic_incidents
    (status, last_seen_at DESC);

CREATE INDEX diagnostic_incidents_store_idx
    ON public.zion_admin_diagnostic_incidents
    (store_id, status, last_seen_at DESC);

CREATE INDEX diagnostic_incidents_org_idx
    ON public.zion_admin_diagnostic_incidents
    (organization_id, status, last_seen_at DESC);


CREATE TABLE public.zion_admin_diagnostic_occurrences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    incident_id uuid NOT NULL
        REFERENCES public.zion_admin_diagnostic_incidents(id)
        ON DELETE RESTRICT,

    occurrence_key text NOT NULL UNIQUE,

    source_system text NOT NULL,
    source_record_id text,

    correlation_id text,
    request_id text,
    execution_id text,

    error_code text,
    sanitized_error_message text,
    sanitized_stack_trace text,

    sanitized_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,

    occurred_at timestamptz NOT NULL,
    captured_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT diagnostic_occurrence_key_nonempty CHECK (
        length(btrim(occurrence_key)) > 0
    ),

    CONSTRAINT diagnostic_occurrence_evidence_object CHECK (
        jsonb_typeof(sanitized_evidence) = 'object'
    )
);

CREATE INDEX diagnostic_occurrences_incident_time_idx
    ON public.zion_admin_diagnostic_occurrences
    (incident_id, occurred_at DESC);

CREATE INDEX diagnostic_occurrences_source_idx
    ON public.zion_admin_diagnostic_occurrences
    (source_system, source_record_id);


CREATE TABLE public.zion_admin_diagnostic_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    incident_id uuid NOT NULL
        REFERENCES public.zion_admin_diagnostic_incidents(id)
        ON DELETE RESTRICT,

    event_kind text NOT NULL,
    actor_kind text NOT NULL,
    actor_user_id uuid,

    previous_status text,
    new_status text,

    description_simple text,
    sanitized_details jsonb NOT NULL DEFAULT '{}'::jsonb,

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT diagnostic_history_details_object CHECK (
        jsonb_typeof(sanitized_details) = 'object'
    )
);

CREATE INDEX diagnostic_history_incident_time_idx
    ON public.zion_admin_diagnostic_history
    (incident_id, created_at DESC);


-- Negacao de acesso direto para clientes e service_role.
-- Acesso futuro somente por RPCs administrativas controladas.

ALTER TABLE public.zion_admin_diagnostic_incidents
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.zion_admin_diagnostic_occurrences
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.zion_admin_diagnostic_history
    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.zion_admin_diagnostic_incidents,
    public.zion_admin_diagnostic_occurrences,
    public.zion_admin_diagnostic_history
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
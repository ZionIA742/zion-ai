BEGIN;

-- ZION-ADM / B1 / 1.2.3
-- Autoridade administrativa do catalogo de despesas.
-- Nao modifica lancamentos financeiros.
-- Nao cria valores mensais de zero.

CREATE TABLE public.zion_admin_variable_expense_catalog_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_item_id uuid NOT NULL
        REFERENCES public.zion_admin_variable_expense_catalog(id)
        ON DELETE RESTRICT,
    operation_key text NOT NULL UNIQUE,
    action text NOT NULL,
    request_data jsonb NOT NULL,
    before_data jsonb,
    after_data jsonb NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT zavca_operation_key_check
        CHECK (
            char_length(operation_key) BETWEEN 8 AND 200
            AND operation_key = btrim(operation_key)
        ),

    CONSTRAINT zavca_action_check
        CHECK (action IN ('created', 'archived', 'restored'))
);

CREATE INDEX zavca_item_created_idx
ON public.zion_admin_variable_expense_catalog_audit (
    catalog_item_id,
    created_at
);

CREATE FUNCTION
public.zion_admin_refuse_variable_catalog_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'VARIABLE_CATALOG_AUDIT_IMMUTABLE';
END;
$$;

CREATE TRIGGER zion_admin_variable_catalog_audit_immutable
BEFORE UPDATE OR DELETE
ON public.zion_admin_variable_expense_catalog_audit
FOR EACH ROW
EXECUTE FUNCTION
public.zion_admin_refuse_variable_catalog_audit_mutation();

CREATE FUNCTION
public.zion_admin_manage_variable_expense_catalog(
    p_action text,
    p_operation_key text,
    p_item_id uuid,
    p_name text,
    p_category text,
    p_currency text,
    p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_name text := btrim(p_name);
    v_category text := btrim(p_category);
    v_request jsonb;
    v_prior public.zion_admin_variable_expense_catalog_audit%ROWTYPE;
    v_before public.zion_admin_variable_expense_catalog%ROWTYPE;
    v_after public.zion_admin_variable_expense_catalog%ROWTYPE;
    v_before_json jsonb;
BEGIN
    IF p_actor_id IS NULL THEN
        RAISE EXCEPTION 'CATALOG_ACTOR_REQUIRED';
    END IF;

    IF p_action IS NULL
       OR p_action NOT IN ('created', 'archived', 'restored')
    THEN
        RAISE EXCEPTION 'CATALOG_ACTION_INVALID';
    END IF;

    IF p_operation_key IS NULL
       OR char_length(p_operation_key) NOT BETWEEN 8 AND 200
       OR p_operation_key <> btrim(p_operation_key)
    THEN
        RAISE EXCEPTION 'CATALOG_OPERATION_KEY_INVALID';
    END IF;

    IF p_action = 'created' THEN
        IF p_item_id IS NOT NULL
           OR v_name IS NULL
           OR char_length(v_name) NOT BETWEEN 1 AND 100
           OR v_category IS NULL
           OR char_length(v_category) NOT BETWEEN 1 AND 80
           OR p_currency IS NULL
           OR p_currency NOT IN ('BRL', 'USD')
        THEN
            RAISE EXCEPTION 'CATALOG_FIELDS_INVALID';
        END IF;

        v_request := pg_catalog.jsonb_build_object(
            'action', p_action,
            'name', v_name,
            'category', v_category,
            'currency', p_currency,
            'actor_id', p_actor_id
        );
    ELSE
        IF p_item_id IS NULL
           OR p_name IS NOT NULL
           OR p_category IS NOT NULL
           OR p_currency IS NOT NULL
        THEN
            RAISE EXCEPTION 'CATALOG_FIELDS_INVALID';
        END IF;

        v_request := pg_catalog.jsonb_build_object(
            'action', p_action,
            'item_id', p_item_id,
            'actor_id', p_actor_id
        );
    END IF;

    -- Operacoes administrativas pouco frequentes.
    -- Serializa cadastro, arquivamento e reativacao.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('zion_admin_variable_catalog'),
        1
    );

    -- Repeticao exata devolve o resultado auditado.
    SELECT *
    INTO v_prior
    FROM public.zion_admin_variable_expense_catalog_audit
    WHERE operation_key = p_operation_key;

    IF FOUND THEN
        IF v_prior.action <> p_action
           OR v_prior.request_data <> v_request
        THEN
            RAISE EXCEPTION
                'CATALOG_OPERATION_KEY_REUSED';
        END IF;

        RETURN pg_catalog.jsonb_build_object(
            'item', v_prior.after_data,
            'idempotent', true
        );
    END IF;

    IF p_action = 'created' THEN
        -- Nao duplicar nomes arquivados.
        -- Para voltar a utilizar um nome antigo,
        -- usar a operacao de reativacao.
        IF EXISTS (
            SELECT 1
            FROM public.zion_admin_variable_expense_catalog
            WHERE lower(btrim(name)) = lower(v_name)
              AND lower(btrim(category)) = lower(v_category)
              AND currency = p_currency
        ) THEN
            RAISE EXCEPTION 'CATALOG_ITEM_ALREADY_EXISTS';
        END IF;

        INSERT INTO public.zion_admin_variable_expense_catalog (
            name,
            category,
            currency
        )
        VALUES (
            v_name,
            v_category,
            p_currency
        )
        RETURNING * INTO v_after;

        v_before_json := NULL;
    ELSE
        SELECT *
        INTO v_before
        FROM public.zion_admin_variable_expense_catalog
        WHERE id = p_item_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'CATALOG_ITEM_NOT_FOUND';
        END IF;

        IF p_action = 'archived'
           AND v_before.archived_at IS NOT NULL
        THEN
            RAISE EXCEPTION 'CATALOG_ALREADY_ARCHIVED';
        END IF;

        IF p_action = 'restored'
           AND v_before.archived_at IS NULL
        THEN
            RAISE EXCEPTION 'CATALOG_ALREADY_ACTIVE';
        END IF;

        v_before_json := pg_catalog.to_jsonb(v_before);

        UPDATE public.zion_admin_variable_expense_catalog
        SET
            archived_at = CASE
                WHEN p_action = 'archived'
                    THEN pg_catalog.clock_timestamp()
                ELSE NULL
            END,
            updated_at = GREATEST(
                pg_catalog.clock_timestamp(),
                v_before.updated_at + interval '1 microsecond'
            )
        WHERE id = p_item_id
        RETURNING * INTO v_after;
    END IF;

    -- A mutacao e a auditoria pertencem a mesma transacao.
    INSERT INTO public.zion_admin_variable_expense_catalog_audit (
        catalog_item_id,
        operation_key,
        action,
        request_data,
        before_data,
        after_data,
        actor_id
    )
    VALUES (
        v_after.id,
        p_operation_key,
        p_action,
        v_request,
        v_before_json,
        pg_catalog.to_jsonb(v_after),
        p_actor_id
    );

    RETURN pg_catalog.jsonb_build_object(
        'item', pg_catalog.to_jsonb(v_after),
        'idempotent', false
    );
END;
$$;

-- Acesso direto ao historico somente para leitura
-- pela camada administrativa.
ALTER TABLE public.zion_admin_variable_expense_catalog_audit
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.zion_admin_variable_expense_catalog_audit
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
    public.zion_admin_variable_expense_catalog_audit
TO service_role;

-- Escrita no catalogo exclusivamente pela RPC.
REVOKE ALL ON FUNCTION
public.zion_admin_manage_variable_expense_catalog(
    text, text, uuid, text, text, text, uuid
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
public.zion_admin_manage_variable_expense_catalog(
    text, text, uuid, text, text, text, uuid
)
TO service_role;

REVOKE ALL ON FUNCTION
public.zion_admin_refuse_variable_catalog_audit_mutation()
FROM PUBLIC, anon, authenticated;

COMMIT;
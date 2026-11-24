BEGIN;

SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

DO $migration$
DECLARE
    v_tables text[] := ARRAY[
        'sales_quotes',
        'sales_quote_items',
        'sales_quote_change_requests'
    ];

    v_before jsonb;
    v_after jsonb;
    v_table text;
    v_role text;
BEGIN
    SELECT jsonb_agg(
        jsonb_build_array(
            t.relname,
            r.rolname,
            p.privilege,
            has_table_privilege(r.oid, t.oid, p.privilege)
        )
        ORDER BY t.relname, r.rolname, p.privilege
    )
    INTO v_before
    FROM pg_class t
    CROSS JOIN pg_roles r
    CROSS JOIN unnest(ARRAY[
        'SELECT', 'INSERT', 'UPDATE',
        'DELETE', 'REFERENCES', 'TRUNCATE', 'TRIGGER'
    ]) AS p(privilege)
    WHERE t.relnamespace = 'public'::regnamespace
      AND t.relname = ANY(v_tables)
      AND r.rolname IN (
          'anon', 'authenticated', 'service_role'
      )
      AND NOT (
          r.rolname IN ('anon', 'authenticated')
          AND p.privilege IN ('TRUNCATE', 'TRIGGER')
      );

    IF jsonb_array_length(v_before) IS DISTINCT FROM 51 THEN
        RAISE EXCEPTION 'BASELINE_INCOMPLETA';
    END IF;

    REVOKE TRUNCATE, TRIGGER
    ON TABLE
        public.sales_quotes,
        public.sales_quote_items,
        public.sales_quote_change_requests
    FROM anon, authenticated;

    FOREACH v_table IN ARRAY v_tables LOOP
        FOREACH v_role IN ARRAY ARRAY[
            'anon', 'authenticated'
        ] LOOP
            IF has_table_privilege(
                v_role, 'public.' || v_table, 'TRUNCATE'
            ) OR has_table_privilege(
                v_role, 'public.' || v_table, 'TRIGGER'
            ) THEN
                RAISE EXCEPTION
                    'PERMISSAO_RESIDUAL: % %',
                    v_table, v_role;
            END IF;
        END LOOP;
    END LOOP;

    SELECT jsonb_agg(
        jsonb_build_array(
            t.relname,
            r.rolname,
            p.privilege,
            has_table_privilege(r.oid, t.oid, p.privilege)
        )
        ORDER BY t.relname, r.rolname, p.privilege
    )
    INTO v_after
    FROM pg_class t
    CROSS JOIN pg_roles r
    CROSS JOIN unnest(ARRAY[
        'SELECT', 'INSERT', 'UPDATE',
        'DELETE', 'REFERENCES', 'TRUNCATE', 'TRIGGER'
    ]) AS p(privilege)
    WHERE t.relnamespace = 'public'::regnamespace
      AND t.relname = ANY(v_tables)
      AND r.rolname IN (
          'anon', 'authenticated', 'service_role'
      )
      AND NOT (
          r.rolname IN ('anon', 'authenticated')
          AND p.privilege IN ('TRUNCATE', 'TRIGGER')
      );

    IF v_before IS DISTINCT FROM v_after THEN
        RAISE EXCEPTION 'PERMISSOES_FORA_DO_ESCOPO_ALTERADAS';
    END IF;
END;
$migration$;

COMMIT;

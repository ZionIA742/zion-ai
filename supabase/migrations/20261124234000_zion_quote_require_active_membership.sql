BEGIN;

SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '3s';

DO $migration$
DECLARE
    v_table text;
    v_predicate text;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'sales_quotes',
        'sales_quote_items',
        'sales_quote_change_requests'
    ] LOOP

        v_predicate := format(
            'EXISTS (
                SELECT 1
                FROM public.memberships m
                WHERE m.user_id = auth.uid()
                  AND m.organization_id = %I.organization_id
                  AND m.is_active IS TRUE
            )',
            v_table
        );

        EXECUTE format(
            'CREATE POLICY
                zion_quote_require_active_membership
             ON public.%I
             AS RESTRICTIVE
             FOR ALL
             TO authenticated
             USING (%s)
             WITH CHECK (%s)',
            v_table,
            v_predicate,
            v_predicate
        );

    END LOOP;
END;
$migration$;

COMMIT;

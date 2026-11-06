-- ZION / P9 / 9.4-A.2.1
-- Exige explicacao operacional em novos salvamentos configurados.
-- Nao faz backfill: registros legados incompletos permanecem preservados.

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.upsert_store_supply_policy_scoped(uuid,uuid,boolean,boolean,text,integer,text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'P9_SUPPLY_UPSERT_FUNCTION_MISSING';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.upsert_store_supply_policy_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_pool_stock_enabled boolean,
  p_pool_order_enabled boolean,
  p_pool_supply_explanation text,
  p_pool_supply_lead_time_days integer,
  p_pool_supply_lead_time_unit text,
  p_pool_supply_lead_time_start_event text,
  p_pool_supply_lead_time_start_event_other text,
  p_pool_supply_lead_time_applies_until text,
  p_pool_factory_order_condition text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET row_security = off
AS $fn$
DECLARE
  v_explanation text := NULLIF(btrim(p_pool_supply_explanation), '');
  v_factory_condition text := NULLIF(btrim(p_pool_factory_order_condition), '');
  v_other_start text := NULLIF(btrim(p_pool_supply_lead_time_start_event_other), '');
BEGIN
  PERFORM public.p9_supply_assert_human_scope_internal(p_organization_id, p_store_id);

  IF (p_pool_stock_enabled IS TRUE OR p_pool_order_enabled IS TRUE)
     AND v_explanation IS NULL THEN
    RAISE EXCEPTION 'P9_SUPPLY_EXPLANATION_REQUIRED';
  END IF;

  -- Serializa updates da loja e de suas excecoes por produto.
  PERFORM 1 FROM public.stores s
    WHERE s.id = p_store_id AND s.organization_id = p_organization_id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.pool_supply_policies q
    WHERE q.organization_id = p_organization_id AND q.store_id = p_store_id
      AND (
        (q.supply_mode = 'stock' AND p_pool_stock_enabled IS DISTINCT FROM TRUE)
        OR (q.supply_mode = 'on_order' AND p_pool_order_enabled IS DISTINCT FROM TRUE)
      )
  ) THEN
    RAISE EXCEPTION 'P9_SUPPLY_STORE_CHANGE_CONFLICTS_WITH_POOL_OVERRIDES';
  END IF;

  INSERT INTO public.store_operation_settings (
    organization_id, store_id,
    pool_stock_enabled, pool_order_enabled, pool_supply_explanation,
    pool_supply_lead_time_days, pool_supply_lead_time_unit,
    pool_supply_lead_time_start_event, pool_supply_lead_time_start_event_other,
    pool_supply_lead_time_applies_until, pool_factory_order_condition
  ) VALUES (
    p_organization_id, p_store_id,
    p_pool_stock_enabled, p_pool_order_enabled, v_explanation,
    p_pool_supply_lead_time_days, p_pool_supply_lead_time_unit,
    p_pool_supply_lead_time_start_event, v_other_start,
    p_pool_supply_lead_time_applies_until, v_factory_condition
  )
  ON CONFLICT (organization_id, store_id) DO UPDATE SET
    pool_stock_enabled = EXCLUDED.pool_stock_enabled,
    pool_order_enabled = EXCLUDED.pool_order_enabled,
    pool_supply_explanation = EXCLUDED.pool_supply_explanation,
    pool_supply_lead_time_days = EXCLUDED.pool_supply_lead_time_days,
    pool_supply_lead_time_unit = EXCLUDED.pool_supply_lead_time_unit,
    pool_supply_lead_time_start_event = EXCLUDED.pool_supply_lead_time_start_event,
    pool_supply_lead_time_start_event_other = EXCLUDED.pool_supply_lead_time_start_event_other,
    pool_supply_lead_time_applies_until = EXCLUDED.pool_supply_lead_time_applies_until,
    pool_factory_order_condition = EXCLUDED.pool_factory_order_condition;

  RETURN public.p9_read_supply_policy_internal(p_organization_id, p_store_id, NULL);
END;
$fn$;

REVOKE ALL ON FUNCTION public.upsert_store_supply_policy_scoped(
  uuid,uuid,boolean,boolean,text,integer,text,text,text,text,text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_store_supply_policy_scoped(
  uuid,uuid,boolean,boolean,text,integer,text,text,text,text,text
) TO authenticated;

COMMIT;

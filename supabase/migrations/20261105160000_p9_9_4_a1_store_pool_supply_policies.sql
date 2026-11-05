-- ZION / Pilar 9 / Microetapa 9.4-A.1
-- Politicas de fornecimento por loja e piscina. NAO registra pedidos a fabrica,
-- NAO cria obrigacoes financeiras e NAO altera contratos, orcamentos ou estoque.
-- Fonte: preflight do Supabase atual em 05/11/2026.
-- Executar uma unica vez no SQL Editor do Supabase atual, apos revisao.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF to_regclass('public.stores') IS NULL
     OR to_regclass('public.pools') IS NULL
     OR to_regclass('public.store_operation_settings') IS NULL
     OR to_regclass('public.memberships') IS NULL
     OR to_regclass('public.stores_id_organization_uidx') IS NULL
     OR to_regclass('public.pools_id_organization_store_uidx') IS NULL THEN
    RAISE EXCEPTION 'P9_SUPPLY_PREREQUISITE_MISSING';
  END IF;
  IF to_regclass('public.pool_supply_policies') IS NOT NULL THEN
    RAISE EXCEPTION 'P9_SUPPLY_ALREADY_EXISTS_REVIEW_BEFORE_REAPPLY';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'memberships'
      AND column_name = 'is_active' AND data_type = 'boolean'
  ) THEN
    RAISE EXCEPTION 'P9_SUPPLY_ACTIVE_MEMBERSHIP_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.store_operation_settings'::regclass
      AND contype = 'p'
      AND pg_get_constraintdef(oid) LIKE '%(organization_id, store_id)%'
  ) THEN
    RAISE EXCEPTION 'P9_SUPPLY_SETTINGS_COMPOSITE_KEY_MISSING';
  END IF;
END;
$preflight$;

-- Colunas novas e independentes dos writers legados (instalacao, visita etc.).
-- NULL/NULL = loja ainda nao configurou o modelo de fornecimento.
ALTER TABLE public.store_operation_settings
  ADD COLUMN pool_stock_enabled boolean NULL,
  ADD COLUMN pool_order_enabled boolean NULL,
  ADD COLUMN pool_supply_explanation text NULL,
  ADD COLUMN pool_supply_lead_time_days integer NULL,
  ADD COLUMN pool_supply_lead_time_unit text NULL,
  ADD COLUMN pool_supply_lead_time_start_event text NULL,
  ADD COLUMN pool_supply_lead_time_start_event_other text NULL,
  ADD COLUMN pool_supply_lead_time_applies_until text NULL,
  ADD COLUMN pool_factory_order_condition text NULL;

ALTER TABLE public.store_operation_settings
  ADD CONSTRAINT p9_supply_store_policy_valid CHECK (
    (
      pool_stock_enabled IS NULL AND pool_order_enabled IS NULL
      AND pool_supply_explanation IS NULL
      AND pool_supply_lead_time_days IS NULL
      AND pool_supply_lead_time_unit IS NULL
      AND pool_supply_lead_time_start_event IS NULL
      AND pool_supply_lead_time_start_event_other IS NULL
      AND pool_supply_lead_time_applies_until IS NULL
      AND pool_factory_order_condition IS NULL
    ) OR (
      pool_stock_enabled IS NOT NULL AND pool_order_enabled IS NOT NULL
      AND (pool_stock_enabled IS TRUE OR pool_order_enabled IS TRUE)
      AND (pool_supply_explanation IS NULL OR char_length(pool_supply_explanation) <= 4000)
      AND (pool_factory_order_condition IS NULL OR char_length(pool_factory_order_condition) <= 2000)
      AND (
        pool_order_enabled IS TRUE OR (
          pool_supply_lead_time_days IS NULL
          AND pool_supply_lead_time_unit IS NULL
          AND pool_supply_lead_time_start_event IS NULL
          AND pool_supply_lead_time_start_event_other IS NULL
          AND pool_supply_lead_time_applies_until IS NULL
          AND pool_factory_order_condition IS NULL
        )
      )
      AND (
        (
          pool_supply_lead_time_days IS NULL
          AND pool_supply_lead_time_unit IS NULL
          AND pool_supply_lead_time_start_event IS NULL
          AND pool_supply_lead_time_start_event_other IS NULL
          AND pool_supply_lead_time_applies_until IS NULL
        ) OR (
          pool_supply_lead_time_days BETWEEN 1 AND 3650
          AND pool_supply_lead_time_unit IS NOT NULL
          AND pool_supply_lead_time_unit IN ('business_days', 'calendar_days')
          AND pool_supply_lead_time_start_event IS NOT NULL
          AND pool_supply_lead_time_start_event IN (
            'sale_confirmed', 'entry_payment_confirmed',
            'factory_order_placed', 'factory_order_confirmed', 'other'
          )
          AND pool_supply_lead_time_applies_until IS NOT NULL
          AND pool_supply_lead_time_applies_until IN ('release', 'delivery', 'installation')
          AND (
            (pool_supply_lead_time_start_event = 'other'
             AND pool_supply_lead_time_start_event_other IS NOT NULL
             AND char_length(pool_supply_lead_time_start_event_other) BETWEEN 1 AND 300)
            OR
            (pool_supply_lead_time_start_event <> 'other'
             AND pool_supply_lead_time_start_event_other IS NULL)
          )
        )
      )
    )
  );

-- Override por piscina. Estoque e modalidade de fornecimento sao coisas distintas.
CREATE TABLE public.pool_supply_policies (
  organization_id uuid NOT NULL,
  store_id uuid NOT NULL,
  pool_id uuid NOT NULL,
  supply_mode text NOT NULL CHECK (supply_mode IN ('stock', 'on_order')),
  lead_time_days integer NULL,
  lead_time_unit text NULL,
  lead_time_start_event text NULL,
  lead_time_start_event_other text NULL,
  lead_time_applies_until text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pool_supply_policies_pkey PRIMARY KEY (organization_id, store_id, pool_id),
  CONSTRAINT pool_supply_policies_store_scope_fkey
    FOREIGN KEY (store_id, organization_id)
    REFERENCES public.stores (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT pool_supply_policies_pool_scope_fkey
    FOREIGN KEY (pool_id, organization_id, store_id)
    REFERENCES public.pools (id, organization_id, store_id) ON DELETE CASCADE,
  CONSTRAINT pool_supply_policies_lead_time_check CHECK (
    (supply_mode = 'stock' AND lead_time_days IS NULL
      AND lead_time_unit IS NULL AND lead_time_start_event IS NULL
      AND lead_time_start_event_other IS NULL AND lead_time_applies_until IS NULL)
    OR
    (supply_mode = 'on_order' AND (
      (lead_time_days IS NULL AND lead_time_unit IS NULL
        AND lead_time_start_event IS NULL
        AND lead_time_start_event_other IS NULL
        AND lead_time_applies_until IS NULL)
      OR
      (lead_time_days BETWEEN 1 AND 3650
        AND lead_time_unit IS NOT NULL
        AND lead_time_unit IN ('business_days', 'calendar_days')
        AND lead_time_start_event IS NOT NULL
        AND lead_time_start_event IN (
          'sale_confirmed', 'entry_payment_confirmed',
          'factory_order_placed', 'factory_order_confirmed', 'other'
        )
        AND lead_time_applies_until IS NOT NULL
        AND lead_time_applies_until IN ('release', 'delivery', 'installation')
        AND (
          (lead_time_start_event = 'other' AND lead_time_start_event_other IS NOT NULL
            AND char_length(lead_time_start_event_other) BETWEEN 1 AND 300)
          OR
          (lead_time_start_event <> 'other' AND lead_time_start_event_other IS NULL)
        )
      )
    ))
  )
);

ALTER TABLE public.pool_supply_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pool_supply_policies FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.pool_supply_policies TO authenticated, service_role;

CREATE POLICY pool_supply_policies_select_active_membership
ON public.pool_supply_policies FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.organization_id = pool_supply_policies.organization_id
      AND m.user_id = auth.uid() AND m.is_active IS TRUE
  )
  AND EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id = pool_supply_policies.store_id
      AND s.organization_id = pool_supply_policies.organization_id
  )
);

-- Helper de autorizacao humana. Nao conceder EXECUTE a clientes ou service_role.
CREATE FUNCTION public.p9_supply_assert_human_scope_internal(
  p_organization_id uuid, p_store_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET row_security = off
AS $fn$
BEGIN
  IF p_organization_id IS NULL OR p_store_id IS NULL
     OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'P9_SUPPLY_UNAUTHENTICATED_OR_SCOPE_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.organization_id = p_organization_id
      AND m.user_id = auth.uid() AND m.is_active IS TRUE
  ) OR NOT EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id = p_store_id AND s.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'P9_SUPPLY_HUMAN_SCOPE_DENIED';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.p9_supply_assert_human_scope_internal(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Leitor interno (privado). Nunca usa contrato ou estoque para inferir encomenda.
CREATE FUNCTION public.p9_read_supply_policy_internal(
  p_organization_id uuid, p_store_id uuid, p_pool_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET row_security = off
AS $fn$
DECLARE
  v_store public.store_operation_settings%ROWTYPE;
  v_override public.pool_supply_policies%ROWTYPE;
  v_store_mode text;
  v_effective_mode text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id = p_store_id AND s.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'P9_SUPPLY_STORE_NOT_FOUND';
  END IF;
  IF p_pool_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.pools p
    WHERE p.id = p_pool_id AND p.organization_id = p_organization_id
      AND p.store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'P9_SUPPLY_POOL_NOT_FOUND_OR_OUT_OF_SCOPE';
  END IF;

  SELECT * INTO v_store FROM public.store_operation_settings s
    WHERE s.organization_id = p_organization_id AND s.store_id = p_store_id;
  IF v_store.pool_stock_enabled IS TRUE AND v_store.pool_order_enabled IS TRUE THEN
    v_store_mode := 'mixed';
  ELSIF v_store.pool_stock_enabled IS TRUE THEN
    v_store_mode := 'stock';
  ELSIF v_store.pool_order_enabled IS TRUE THEN
    v_store_mode := 'on_order';
  ELSE
    v_store_mode := 'unconfigured';
  END IF;

  IF p_pool_id IS NOT NULL THEN
    SELECT * INTO v_override FROM public.pool_supply_policies q
      WHERE q.organization_id = p_organization_id AND q.store_id = p_store_id
        AND q.pool_id = p_pool_id;
  END IF;

  v_effective_mode := CASE
    WHEN p_pool_id IS NOT NULL AND v_override.supply_mode IS NOT NULL
      THEN v_override.supply_mode
    WHEN v_store_mode IN ('stock', 'on_order') THEN v_store_mode
    ELSE 'unconfigured'
  END;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'store_id', p_store_id,
    'pool_id', p_pool_id,
    'configured', v_store_mode <> 'unconfigured',
    'store_supply_mode', v_store_mode,
    'pool_override_mode', CASE WHEN p_pool_id IS NULL THEN NULL ELSE v_override.supply_mode END,
    'effective_supply_mode', v_effective_mode,
    'store_stock_enabled', v_store.pool_stock_enabled,
    'store_order_enabled', v_store.pool_order_enabled,
    'operational_explanation', v_store.pool_supply_explanation,
    'factory_order_condition', CASE WHEN v_store.pool_order_enabled IS TRUE
      THEN v_store.pool_factory_order_condition ELSE NULL END,
    -- Politica bruta da loja para popular o formulario, inclusive no modo misto.
    'store_lead_time_days', v_store.pool_supply_lead_time_days,
    'store_lead_time_unit', v_store.pool_supply_lead_time_unit,
    'store_lead_time_start_event', v_store.pool_supply_lead_time_start_event,
    'store_lead_time_start_event_other', v_store.pool_supply_lead_time_start_event_other,
    'store_lead_time_applies_until', v_store.pool_supply_lead_time_applies_until,
    -- Prazo efetivo: override de prazo e um conjunto indivisivel, nao mistura campos
    -- entre inicio da piscina e inicio da loja.
    'lead_time_days', CASE WHEN v_effective_mode = 'on_order'
      THEN COALESCE(v_override.lead_time_days, v_store.pool_supply_lead_time_days) ELSE NULL END,
    'lead_time_unit', CASE WHEN v_effective_mode <> 'on_order' THEN NULL
      WHEN v_override.lead_time_days IS NOT NULL THEN v_override.lead_time_unit
      ELSE v_store.pool_supply_lead_time_unit END,
    'lead_time_start_event', CASE WHEN v_effective_mode <> 'on_order' THEN NULL
      WHEN v_override.lead_time_days IS NOT NULL THEN v_override.lead_time_start_event
      ELSE v_store.pool_supply_lead_time_start_event END,
    'lead_time_start_event_other', CASE WHEN v_effective_mode <> 'on_order' THEN NULL
      WHEN v_override.lead_time_days IS NOT NULL THEN v_override.lead_time_start_event_other
      ELSE v_store.pool_supply_lead_time_start_event_other END,
    'lead_time_applies_until', CASE WHEN v_effective_mode <> 'on_order' THEN NULL
      WHEN v_override.lead_time_days IS NOT NULL THEN v_override.lead_time_applies_until
      ELSE v_store.pool_supply_lead_time_applies_until END,
    'lead_time_is_estimate', true,
    'factory_order_placed', NULL,
    'factory_released', NULL
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.p9_read_supply_policy_internal(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Leituras humanas e leitura sistemica para a futura integracao da IA.
CREATE FUNCTION public.read_store_supply_policy_scoped(
  p_organization_id uuid, p_store_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET row_security = off
AS $fn$
BEGIN
  PERFORM public.p9_supply_assert_human_scope_internal(p_organization_id, p_store_id);
  RETURN public.p9_read_supply_policy_internal(p_organization_id, p_store_id, NULL);
END;
$fn$;
CREATE FUNCTION public.read_pool_supply_policy_scoped(
  p_organization_id uuid, p_store_id uuid, p_pool_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET row_security = off
AS $fn$
BEGIN
  PERFORM public.p9_supply_assert_human_scope_internal(p_organization_id, p_store_id);
  RETURN public.p9_read_supply_policy_internal(p_organization_id, p_store_id, p_pool_id);
END;
$fn$;
CREATE FUNCTION public.read_store_supply_policy_by_system(
  p_organization_id uuid, p_store_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET row_security = off
AS $fn$
BEGIN
  RETURN public.p9_read_supply_policy_internal(p_organization_id, p_store_id, NULL);
END;
$fn$;
CREATE FUNCTION public.read_pool_supply_policy_by_system(
  p_organization_id uuid, p_store_id uuid, p_pool_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET row_security = off
AS $fn$
BEGIN
  RETURN public.p9_read_supply_policy_internal(p_organization_id, p_store_id, p_pool_id);
END;
$fn$;

-- Salvar apenas campos da politica. As outras configuracoes da loja permanecem intactas.
CREATE FUNCTION public.upsert_store_supply_policy_scoped(
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

CREATE FUNCTION public.upsert_pool_supply_policy_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_pool_id uuid,
  p_supply_mode text,
  p_lead_time_days integer,
  p_lead_time_unit text,
  p_lead_time_start_event text,
  p_lead_time_start_event_other text,
  p_lead_time_applies_until text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET row_security = off
AS $fn$
DECLARE
  v_stock boolean;
  v_order boolean;
  v_other_start text := NULLIF(btrim(p_lead_time_start_event_other), '');
BEGIN
  PERFORM public.p9_supply_assert_human_scope_internal(p_organization_id, p_store_id);
  PERFORM 1 FROM public.stores s
    WHERE s.id = p_store_id AND s.organization_id = p_organization_id FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public.pools p
    WHERE p.id = p_pool_id AND p.organization_id = p_organization_id
      AND p.store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'P9_SUPPLY_POOL_NOT_FOUND_OR_OUT_OF_SCOPE';
  END IF;

  SELECT s.pool_stock_enabled, s.pool_order_enabled INTO v_stock, v_order
  FROM public.store_operation_settings s
  WHERE s.organization_id = p_organization_id AND s.store_id = p_store_id;
  IF (p_supply_mode = 'stock' AND v_stock IS DISTINCT FROM TRUE)
      OR (p_supply_mode = 'on_order' AND v_order IS DISTINCT FROM TRUE)
      OR p_supply_mode IS NULL OR p_supply_mode NOT IN ('stock','on_order') THEN
    RAISE EXCEPTION 'P9_SUPPLY_POOL_MODE_NOT_ALLOWED_BY_STORE';
  END IF;

  INSERT INTO public.pool_supply_policies (
    organization_id, store_id, pool_id, supply_mode,
    lead_time_days, lead_time_unit, lead_time_start_event,
    lead_time_start_event_other, lead_time_applies_until
  ) VALUES (
    p_organization_id, p_store_id, p_pool_id, p_supply_mode,
    p_lead_time_days, p_lead_time_unit, p_lead_time_start_event,
    v_other_start, p_lead_time_applies_until
  )
  ON CONFLICT (organization_id, store_id, pool_id) DO UPDATE SET
    supply_mode = EXCLUDED.supply_mode,
    lead_time_days = EXCLUDED.lead_time_days,
    lead_time_unit = EXCLUDED.lead_time_unit,
    lead_time_start_event = EXCLUDED.lead_time_start_event,
    lead_time_start_event_other = EXCLUDED.lead_time_start_event_other,
    lead_time_applies_until = EXCLUDED.lead_time_applies_until,
    updated_at = now();

  RETURN public.p9_read_supply_policy_internal(p_organization_id, p_store_id, p_pool_id);
END;
$fn$;

CREATE FUNCTION public.delete_pool_supply_policy_scoped(
  p_organization_id uuid, p_store_id uuid, p_pool_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET row_security = off
AS $fn$
BEGIN
  PERFORM public.p9_supply_assert_human_scope_internal(p_organization_id, p_store_id);
  PERFORM 1 FROM public.stores s
    WHERE s.id = p_store_id AND s.organization_id = p_organization_id FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public.pools p
    WHERE p.id = p_pool_id AND p.organization_id = p_organization_id
      AND p.store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'P9_SUPPLY_POOL_NOT_FOUND_OR_OUT_OF_SCOPE';
  END IF;
  DELETE FROM public.pool_supply_policies q
    WHERE q.organization_id = p_organization_id AND q.store_id = p_store_id
      AND q.pool_id = p_pool_id;
  RETURN public.p9_read_supply_policy_internal(p_organization_id, p_store_id, p_pool_id);
END;
$fn$;

-- O PUBLIC possui EXECUTE por padrao em PostgreSQL: revogar explicitamente.
REVOKE ALL ON FUNCTION public.read_store_supply_policy_scoped(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_pool_supply_policy_scoped(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_store_supply_policy_by_system(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_pool_supply_policy_by_system(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.upsert_store_supply_policy_scoped(
  uuid,uuid,boolean,boolean,text,integer,text,text,text,text,text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.upsert_pool_supply_policy_scoped(
  uuid,uuid,uuid,text,integer,text,text,text,text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_pool_supply_policy_scoped(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.read_store_supply_policy_scoped(uuid,uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.read_pool_supply_policy_scoped(uuid,uuid,uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.read_store_supply_policy_by_system(uuid,uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.read_pool_supply_policy_by_system(uuid,uuid,uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_store_supply_policy_scoped(
  uuid,uuid,boolean,boolean,text,integer,text,text,text,text,text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_pool_supply_policy_scoped(
  uuid,uuid,uuid,text,integer,text,text,text,text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_pool_supply_policy_scoped(uuid,uuid,uuid)
  TO authenticated;

-- Postcondicoes estruturais (ainda nao sao testes funcionais).
DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid = 'public.pool_supply_policies'::regclass
      AND c.relrowsecurity IS TRUE
  ) THEN
    RAISE EXCEPTION 'P9_SUPPLY_RLS_NOT_ENABLED';
  END IF;
  IF has_table_privilege('authenticated', 'public.pool_supply_policies', 'INSERT')
     OR has_table_privilege('authenticated', 'public.pool_supply_policies', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.pool_supply_policies', 'DELETE')
     OR has_table_privilege('service_role', 'public.pool_supply_policies', 'INSERT')
     OR has_table_privilege('service_role', 'public.pool_supply_policies', 'UPDATE')
     OR has_table_privilege('service_role', 'public.pool_supply_policies', 'DELETE') THEN
    RAISE EXCEPTION 'P9_SUPPLY_DIRECT_WRITES_NOT_REVOKED';
  END IF;
END;
$postflight$;
COMMIT;

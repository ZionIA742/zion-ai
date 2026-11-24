BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

-- P19-A 4-T4-H: fixed baseline, create-only system bootstrap.
-- No store backfill, trigger, or runtime caller is installed by this file.
CREATE FUNCTION public.ensure_store_opportunity_gate_policy_by_system(
    p_organization_id uuid,
    p_store_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp, public, extensions
SET row_security = off
AS $function$
DECLARE
    v_current uuid;
    v_rules jsonb;
    v_count integer;
    v_fingerprint text;
    v_result record;
BEGIN
    IF public.zion_resolve_request_role_internal()
        IS DISTINCT FROM 'service_role'
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'GATE_POLICY_BOOTSTRAP_NOT_AUTHORIZED';
    END IF;

    IF p_organization_id IS NULL OR p_store_id IS NULL THEN
        RAISE EXCEPTION 'GATE_POLICY_BOOTSTRAP_SCOPE_REQUIRED';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'zion:p9:gate-policy-writer:v1:' ||
            p_organization_id::text || ':' ||
            p_store_id::text, 0
        )
    );

    PERFORM 1
    FROM public.stores s
    WHERE s.id = p_store_id
      AND s.organization_id = p_organization_id
    FOR KEY SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'GATE_POLICY_BOOTSTRAP_SCOPE_INVALID';
    END IF;

    SELECT c.current_policy_version_id
    INTO v_current
    FROM public.store_opportunity_gate_policy_current c
    WHERE c.organization_id = p_organization_id
      AND c.store_id = p_store_id
    FOR UPDATE;

    IF FOUND THEN
        IF NOT EXISTS (
            SELECT 1
            FROM public.store_opportunity_gate_policy_versions v
            WHERE v.id = v_current
              AND v.organization_id = p_organization_id
              AND v.store_id = p_store_id
        ) THEN
            RAISE EXCEPTION 'GATE_POLICY_BOOTSTRAP_CURRENT_INVALID';
        END IF;

        SELECT count(*)::integer
        INTO v_count
        FROM public.store_opportunity_gate_policy_rules r
        WHERE r.policy_version_id = v_current
          AND r.organization_id = p_organization_id
          AND r.store_id = p_store_id;

        IF v_count = 0 THEN
            RAISE EXCEPTION 'GATE_POLICY_BOOTSTRAP_RULES_MISSING';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM public.store_opportunity_gate_policy_rules r
            WHERE r.policy_version_id = v_current
              AND r.organization_id = p_organization_id
              AND r.store_id = p_store_id
            GROUP BY r.item_key
            HAVING count(DISTINCT r.item_kind) > 1
        ) THEN
            RAISE EXCEPTION 'GATE_POLICY_BOOTSTRAP_RULES_AMBIGUOUS';
        END IF;

        RETURN jsonb_build_object(
            'status', 'preserved',
            'policy_version_id', v_current,
            'rule_count', v_count
        );
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.store_opportunity_gate_policy_versions v
        WHERE v.organization_id = p_organization_id
          AND v.store_id = p_store_id
    ) THEN
        RAISE EXCEPTION 'GATE_POLICY_BOOTSTRAP_HISTORY_WITHOUT_CURRENT';
    END IF;

    SELECT jsonb_agg(
        jsonb_build_object(
            'rule_key', r.rule_key,
            'rule_priority', r.priority,
            'item_kind', r.item_kind,
            'item_key', r.item_key,
            'match_mode', r.match_mode,
            'component_kind', r.component_kind,
            'execution_kind', r.execution_kind,
            'applicability_state', r.state,
            'reason_code', r.reason,
            'metadata', '{}'::jsonb
        )
        ORDER BY r.priority DESC, r.rule_key
    )
    INTO v_rules
    FROM (
        VALUES
        ('address.delivery.required',70,'technical_requirement','address_confirmation','execution',NULL,'delivery','required','delivery_requires_address_confirmation'),
        ('address.installation.required',70,'technical_requirement','address_confirmation','execution',NULL,'installation','required','installation_requires_address_confirmation'),
        ('address.service_execution.required',70,'technical_requirement','address_confirmation','execution',NULL,'service_execution','required','service_execution_requires_address_confirmation'),
        ('fulfillment.delivery.required',70,'commercial_gate','fulfillment','execution',NULL,'delivery','required','delivery_requires_fulfillment'),
        ('fulfillment.installation.required',70,'commercial_gate','fulfillment','execution',NULL,'installation','required','installation_requires_fulfillment'),
        ('fulfillment.pickup.required',70,'commercial_gate','fulfillment','execution',NULL,'pickup','required','pickup_requires_fulfillment'),
        ('fulfillment.service_execution.required',70,'commercial_gate','fulfillment','execution',NULL,'service_execution','required','service_execution_requires_fulfillment'),
        ('measurements.installation.required',70,'technical_requirement','measurements_confirmation','execution',NULL,'installation','required','installation_requires_measurements_confirmation'),
        ('site_assessment.installation.needs_resolution',70,'technical_requirement','site_assessment','execution',NULL,'installation','needs_resolution','installation_site_assessment_requirement_unresolved'),
        ('technical_visit.installation.needs_resolution',70,'commercial_gate','technical_visit','execution',NULL,'installation','needs_resolution','installation_visit_requirement_unresolved'),
        ('measurements.pool.required',60,'technical_requirement','measurements_confirmation','component','pool',NULL,'required','pool_requires_measurements_confirmation'),
        ('quote.custom.required',60,'commercial_gate','quote','component','custom',NULL,'required','custom_sale_requires_quote'),
        ('quote.pool.required',60,'commercial_gate','quote','component','pool',NULL,'required','pool_sale_requires_quote'),
        ('compatibility.catalog_item.needs_resolution',50,'technical_requirement','compatibility_confirmation','component','catalog_item',NULL,'needs_resolution','catalog_item_compatibility_requirement_unresolved'),
        ('quote.service.needs_resolution',50,'commercial_gate','quote','component','service',NULL,'needs_resolution','service_quote_requirement_unresolved'),
        ('quote.catalog_item.optional',40,'commercial_gate','quote','component','catalog_item',NULL,'optional','catalog_item_quote_optional'),
        ('address.default.not_applicable',10,'technical_requirement','address_confirmation','always',NULL,NULL,'not_applicable','address_confirmation_not_required_by_default'),
        ('compatibility.default.not_applicable',10,'technical_requirement','compatibility_confirmation','always',NULL,NULL,'not_applicable','compatibility_not_required_by_default'),
        ('contract.always.needs_resolution',10,'commercial_gate','contract','always',NULL,NULL,'needs_resolution','contract_applicability_not_configured'),
        ('fulfillment.default.needs_resolution',10,'commercial_gate','fulfillment','always',NULL,NULL,'needs_resolution','fulfillment_kind_must_be_resolved'),
        ('measurements.default.not_applicable',10,'technical_requirement','measurements_confirmation','always',NULL,NULL,'not_applicable','measurements_not_required_by_default'),
        ('negotiation.always.optional',10,'commercial_gate','negotiation','always',NULL,NULL,'optional','negotiation_only_when_material'),
        ('payment.always.required',10,'commercial_gate','payment','always',NULL,NULL,'required','commercial_sale_requires_payment_resolution'),
        ('post_sale.always.required',10,'commercial_gate','post_sale','always',NULL,NULL,'required','commercial_opportunity_requires_post_sale'),
        ('qualification.always.required',10,'commercial_gate','qualification','always',NULL,NULL,'required','commercial_opportunity_requires_qualification'),
        ('quote.default.optional',10,'commercial_gate','quote','always',NULL,NULL,'optional','quote_optional_by_default'),
        ('site_assessment.default.not_applicable',10,'technical_requirement','site_assessment','always',NULL,NULL,'not_applicable','site_assessment_not_required_by_default'),
        ('technical_visit.default.not_applicable',10,'commercial_gate','technical_visit','always',NULL,NULL,'not_applicable','technical_visit_not_required_by_default')
    ) AS r(
        rule_key, priority, item_kind, item_key,
        match_mode, component_kind, execution_kind,
        state, reason
    );

    IF jsonb_array_length(v_rules) IS DISTINCT FROM 28 THEN
        RAISE EXCEPTION 'GATE_POLICY_BOOTSTRAP_BASELINE_INVALID';
    END IF;

    v_fingerprint := encode(
        extensions.digest(
            convert_to(v_rules::text, 'UTF8'),
            'sha256'
        ), 'hex'
    );

    SELECT *
    INTO STRICT v_result
    FROM public.write_store_opportunity_gate_policy_internal(
        p_organization_id,
        p_store_id,
        'p19a:initial_gate_policy:v1',
        v_fingerprint,
        v_rules,
        'system',
        NULL,
        'system_bootstrap',
        'initial_commercial_gate_policy',
        'p19a_gate_policy_bootstrap_v1',
        '{"baseline_version":1}'::jsonb
    );

    IF v_result.version_number IS DISTINCT FROM 1
       OR v_result.rule_count IS DISTINCT FROM 28
       OR v_result.changed IS DISTINCT FROM true
       OR v_result.policy_version_id IS NULL THEN
        RAISE EXCEPTION 'GATE_POLICY_BOOTSTRAP_RESULT_INVALID';
    END IF;

    RETURN jsonb_build_object(
        'status', 'created',
        'policy_version_id', v_result.policy_version_id,
        'rule_count', v_result.rule_count
    );
END;
$function$;

ALTER FUNCTION public.ensure_store_opportunity_gate_policy_by_system(uuid,uuid)
OWNER TO postgres;

REVOKE ALL ON FUNCTION
    public.ensure_store_opportunity_gate_policy_by_system(uuid,uuid)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    public.ensure_store_opportunity_gate_policy_by_system(uuid,uuid)
TO service_role;


DO $preflight$
BEGIN
    IF (SELECT md5(btrim(replace(prosrc, chr(13), ''), chr(10))) FROM pg_proc WHERE oid = to_regprocedure('public.ensure_store_opportunity_gate_policy_by_system(uuid,uuid)')) IS DISTINCT FROM 'f6c8c2c6445dbe64c0cd22f5ecb1f38c' THEN
        RAISE EXCEPTION 'T4K_SOURCE_DIVERGENCE: public.ensure_store_opportunity_gate_policy_by_system(uuid,uuid)';
    END IF;
    IF (SELECT md5(btrim(replace(prosrc, chr(13), ''), chr(10))) FROM pg_proc WHERE oid = to_regprocedure('public.zion_admin_provision_account(uuid,text,text)')) IS DISTINCT FROM '4d3b96910c9a1a9b27f7115bea5f8524' THEN
        RAISE EXCEPTION 'T4K_SOURCE_DIVERGENCE: public.zion_admin_provision_account(uuid,text,text)';
    END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.ensure_store_opportunity_gate_policy_by_system(
    p_organization_id uuid,
    p_store_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp, public, extensions
SET row_security = off
AS $function$
DECLARE
    v_current uuid;
    v_rules jsonb;
    v_count integer;
    v_fingerprint text;
    v_result record;
BEGIN
    IF public.zion_resolve_request_role_internal()
        IS DISTINCT FROM 'service_role'
       AND NOT (
           public.zion_resolve_request_role_internal() IS NOT DISTINCT FROM 'postgres'
           AND session_user = 'postgres'
       )
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'GATE_POLICY_BOOTSTRAP_NOT_AUTHORIZED';
    END IF;

    IF p_organization_id IS NULL OR p_store_id IS NULL THEN
        RAISE EXCEPTION 'GATE_POLICY_BOOTSTRAP_SCOPE_REQUIRED';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'zion:p9:gate-policy-writer:v1:' ||
            p_organization_id::text || ':' ||
            p_store_id::text, 0
        )
    );

    PERFORM 1
    FROM public.stores s
    WHERE s.id = p_store_id
      AND s.organization_id = p_organization_id
    FOR KEY SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'GATE_POLICY_BOOTSTRAP_SCOPE_INVALID';
    END IF;

    SELECT c.current_policy_version_id
    INTO v_current
    FROM public.store_opportunity_gate_policy_current c
    WHERE c.organization_id = p_organization_id
      AND c.store_id = p_store_id
    FOR UPDATE;

    IF FOUND THEN
        IF NOT EXISTS (
            SELECT 1
            FROM public.store_opportunity_gate_policy_versions v
            WHERE v.id = v_current
              AND v.organization_id = p_organization_id
              AND v.store_id = p_store_id
        ) THEN
            RAISE EXCEPTION 'GATE_POLICY_BOOTSTRAP_CURRENT_INVALID';
        END IF;

        SELECT count(*)::integer
        INTO v_count
        FROM public.store_opportunity_gate_policy_rules r
        WHERE r.policy_version_id = v_current
          AND r.organization_id = p_organization_id
          AND r.store_id = p_store_id;

        IF v_count = 0 THEN
            RAISE EXCEPTION 'GATE_POLICY_BOOTSTRAP_RULES_MISSING';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM public.store_opportunity_gate_policy_rules r
            WHERE r.policy_version_id = v_current
              AND r.organization_id = p_organization_id
              AND r.store_id = p_store_id
            GROUP BY r.item_key
            HAVING count(DISTINCT r.item_kind) > 1
        ) THEN
            RAISE EXCEPTION 'GATE_POLICY_BOOTSTRAP_RULES_AMBIGUOUS';
        END IF;

        RETURN jsonb_build_object(
            'status', 'preserved',
            'policy_version_id', v_current,
            'rule_count', v_count
        );
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.store_opportunity_gate_policy_versions v
        WHERE v.organization_id = p_organization_id
          AND v.store_id = p_store_id
    ) THEN
        RAISE EXCEPTION 'GATE_POLICY_BOOTSTRAP_HISTORY_WITHOUT_CURRENT';
    END IF;

    SELECT jsonb_agg(
        jsonb_build_object(
            'rule_key', r.rule_key,
            'rule_priority', r.priority,
            'item_kind', r.item_kind,
            'item_key', r.item_key,
            'match_mode', r.match_mode,
            'component_kind', r.component_kind,
            'execution_kind', r.execution_kind,
            'applicability_state', r.state,
            'reason_code', r.reason,
            'metadata', '{}'::jsonb
        )
        ORDER BY r.priority DESC, r.rule_key
    )
    INTO v_rules
    FROM (
        VALUES
        ('address.delivery.required',70,'technical_requirement','address_confirmation','execution',NULL,'delivery','required','delivery_requires_address_confirmation'),
        ('address.installation.required',70,'technical_requirement','address_confirmation','execution',NULL,'installation','required','installation_requires_address_confirmation'),
        ('address.service_execution.required',70,'technical_requirement','address_confirmation','execution',NULL,'service_execution','required','service_execution_requires_address_confirmation'),
        ('fulfillment.delivery.required',70,'commercial_gate','fulfillment','execution',NULL,'delivery','required','delivery_requires_fulfillment'),
        ('fulfillment.installation.required',70,'commercial_gate','fulfillment','execution',NULL,'installation','required','installation_requires_fulfillment'),
        ('fulfillment.pickup.required',70,'commercial_gate','fulfillment','execution',NULL,'pickup','required','pickup_requires_fulfillment'),
        ('fulfillment.service_execution.required',70,'commercial_gate','fulfillment','execution',NULL,'service_execution','required','service_execution_requires_fulfillment'),
        ('measurements.installation.required',70,'technical_requirement','measurements_confirmation','execution',NULL,'installation','required','installation_requires_measurements_confirmation'),
        ('site_assessment.installation.needs_resolution',70,'technical_requirement','site_assessment','execution',NULL,'installation','needs_resolution','installation_site_assessment_requirement_unresolved'),
        ('technical_visit.installation.needs_resolution',70,'commercial_gate','technical_visit','execution',NULL,'installation','needs_resolution','installation_visit_requirement_unresolved'),
        ('measurements.pool.required',60,'technical_requirement','measurements_confirmation','component','pool',NULL,'required','pool_requires_measurements_confirmation'),
        ('quote.custom.required',60,'commercial_gate','quote','component','custom',NULL,'required','custom_sale_requires_quote'),
        ('quote.pool.required',60,'commercial_gate','quote','component','pool',NULL,'required','pool_sale_requires_quote'),
        ('compatibility.catalog_item.needs_resolution',50,'technical_requirement','compatibility_confirmation','component','catalog_item',NULL,'needs_resolution','catalog_item_compatibility_requirement_unresolved'),
        ('quote.service.needs_resolution',50,'commercial_gate','quote','component','service',NULL,'needs_resolution','service_quote_requirement_unresolved'),
        ('quote.catalog_item.optional',40,'commercial_gate','quote','component','catalog_item',NULL,'optional','catalog_item_quote_optional'),
        ('address.default.not_applicable',10,'technical_requirement','address_confirmation','always',NULL,NULL,'not_applicable','address_confirmation_not_required_by_default'),
        ('compatibility.default.not_applicable',10,'technical_requirement','compatibility_confirmation','always',NULL,NULL,'not_applicable','compatibility_not_required_by_default'),
        ('contract.always.needs_resolution',10,'commercial_gate','contract','always',NULL,NULL,'needs_resolution','contract_applicability_not_configured'),
        ('fulfillment.default.needs_resolution',10,'commercial_gate','fulfillment','always',NULL,NULL,'needs_resolution','fulfillment_kind_must_be_resolved'),
        ('measurements.default.not_applicable',10,'technical_requirement','measurements_confirmation','always',NULL,NULL,'not_applicable','measurements_not_required_by_default'),
        ('negotiation.always.optional',10,'commercial_gate','negotiation','always',NULL,NULL,'optional','negotiation_only_when_material'),
        ('payment.always.required',10,'commercial_gate','payment','always',NULL,NULL,'required','commercial_sale_requires_payment_resolution'),
        ('post_sale.always.required',10,'commercial_gate','post_sale','always',NULL,NULL,'required','commercial_opportunity_requires_post_sale'),
        ('qualification.always.required',10,'commercial_gate','qualification','always',NULL,NULL,'required','commercial_opportunity_requires_qualification'),
        ('quote.default.optional',10,'commercial_gate','quote','always',NULL,NULL,'optional','quote_optional_by_default'),
        ('site_assessment.default.not_applicable',10,'technical_requirement','site_assessment','always',NULL,NULL,'not_applicable','site_assessment_not_required_by_default'),
        ('technical_visit.default.not_applicable',10,'commercial_gate','technical_visit','always',NULL,NULL,'not_applicable','technical_visit_not_required_by_default')
    ) AS r(
        rule_key, priority, item_kind, item_key,
        match_mode, component_kind, execution_kind,
        state, reason
    );

    IF jsonb_array_length(v_rules) IS DISTINCT FROM 28 THEN
        RAISE EXCEPTION 'GATE_POLICY_BOOTSTRAP_BASELINE_INVALID';
    END IF;

    v_fingerprint := encode(
        extensions.digest(
            convert_to(v_rules::text, 'UTF8'),
            'sha256'
        ), 'hex'
    );

    SELECT *
    INTO STRICT v_result
    FROM public.write_store_opportunity_gate_policy_internal(
        p_organization_id,
        p_store_id,
        'p19a:initial_gate_policy:v1',
        v_fingerprint,
        v_rules,
        'system',
        NULL,
        'system_bootstrap',
        'initial_commercial_gate_policy',
        'p19a_gate_policy_bootstrap_v1',
        '{"baseline_version":1}'::jsonb
    );

    IF v_result.version_number IS DISTINCT FROM 1
       OR v_result.rule_count IS DISTINCT FROM 28
       OR v_result.changed IS DISTINCT FROM true
       OR v_result.policy_version_id IS NULL THEN
        RAISE EXCEPTION 'GATE_POLICY_BOOTSTRAP_RESULT_INVALID';
    END IF;

    RETURN jsonb_build_object(
        'status', 'created',
        'policy_version_id', v_result.policy_version_id,
        'rule_count', v_result.rule_count
    );
END;
$function$;


CREATE OR REPLACE FUNCTION public.zion_admin_provision_account(p_user_id uuid, p_responsible_name text, p_store_name text)
 RETURNS TABLE(provisioning_status text, issue_code text, issue_message text, profile_user_id uuid, organization_id uuid, membership_id uuid, store_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
 SET row_security TO 'off'
AS $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_responsible_name text := nullif(pg_catalog.btrim(coalesce(p_responsible_name, '')), '');
  v_store_name text := nullif(pg_catalog.btrim(coalesce(p_store_name, '')), '');
  v_now timestamptz := now();
  v_profile_count integer := 0;
  v_membership_count integer := 0;
  v_distinct_org_count integer := 0;
  v_store_count integer := 0;
  v_subscription_count integer := 0;
  v_profile_user_id uuid;
  v_organization_id uuid;
  v_membership_id uuid;
  v_store_id uuid;
begin
  if coalesce(v_request_role, '') not in (
    'service_role',
    'postgres'
  ) then
    raise exception using
      errcode = '42501',
      message = 'account provisioning is not authorized';
  end if;

  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_user_id is required for zion_admin_provision_account';
  end if;

  if v_responsible_name is null then
    raise exception using
      errcode = '22023',
      message = 'p_responsible_name is required for zion_admin_provision_account';
  end if;

  if v_store_name is null then
    raise exception using
      errcode = '22023',
      message = 'p_store_name is required for zion_admin_provision_account';
  end if;

  if not exists (
    select 1
    from auth.users user_row
    where user_row.id = p_user_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'auth user not found for account provisioning';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  select count(*)
  into v_profile_count
  from public.profiles p
  where p.user_id = p_user_id;

  if v_profile_count > 0 then
    v_profile_user_id := p_user_id;
  else
    v_profile_user_id := null;
  end if;

  select
    count(*),
    count(distinct m.organization_id)
  into
    v_membership_count,
    v_distinct_org_count
  from public.memberships m
  where m.user_id = p_user_id;

  if v_membership_count = 0 then
    if v_profile_count > 0 then
      return query
      select
        'requires_manual_intervention'::text,
        'profile_exists_without_tenant'::text,
        'The user already has a profile row without a valid tenant and requires manual review.'::text,
        v_profile_user_id,
        null::uuid,
        null::uuid,
        null::uuid;
      return;
    end if;

    insert into public.profiles (user_id, full_name)
    values (p_user_id, v_responsible_name)
    returning user_id
    into v_profile_user_id;

    insert into public.organizations (name, subscription_status)
    values (v_store_name, 'active')
    returning id
    into v_organization_id;

    insert into public.memberships (organization_id, user_id, role)
    values (v_organization_id, p_user_id, 'owner')
    returning id
    into v_membership_id;

    insert into public.stores (organization_id, name)
    values (v_organization_id, v_store_name)
    returning id
    into v_store_id;

    insert into public.subscriptions (
      organization_id,
      plan_code,
      status,
      current_period_start,
      current_period_end,
      past_due_since,
      grace_until,
      suspended_at,
      canceled_at,
      token_limit_mensal,
      token_consumido_atual,
      alert_at_percent,
      econ_mode_at_percent
    )
    values (
      v_organization_id,
      'pilot_full_access',
      'active',
      v_now,
      v_now + interval '2 months',
      null,
      null,
      null,
      null,
      1000000,
      0,
      80,
      95
    );

    -- P19-A: initialize commercial policy in the same transaction.
    perform public.ensure_store_opportunity_gate_policy_by_system(
      v_organization_id, v_store_id
    );

    return query
    select
      'provisioned'::text,
      null::text,
      null::text,
      v_profile_user_id,
      v_organization_id,
      v_membership_id,
      v_store_id;
    return;
  end if;

  if v_profile_count = 0 then
    return query
    select
      'requires_manual_intervention'::text,
      'tenant_exists_without_profile'::text,
      'The user already has tenant structure without a valid profile row.'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::uuid;
    return;
  end if;

  if v_membership_count > 1 or v_distinct_org_count > 1 then
    return query
    select
      'requires_manual_intervention'::text,
      'user_linked_to_multiple_organizations'::text,
      'The user already has multiple organization links and cannot be reprovisioned automatically.'::text,
      v_profile_user_id,
      null::uuid,
      null::uuid,
      null::uuid;
    return;
  end if;

  select m.id, m.organization_id
  into v_membership_id, v_organization_id
  from public.memberships m
  where m.user_id = p_user_id
  order by m.created_at asc, m.id asc
  limit 1;

  if v_membership_id is null or v_organization_id is null then
    return query
    select
      'requires_manual_intervention'::text,
      'membership_resolution_failed'::text,
      'The existing membership could not be resolved safely.'::text,
      v_profile_user_id,
      null::uuid,
      null::uuid,
      null::uuid;
    return;
  end if;

  if not exists (
    select 1
    from public.organizations o
    where o.id = v_organization_id
  ) then
    return query
    select
      'requires_manual_intervention'::text,
      'organization_missing'::text,
      'The user membership points to a missing organization.'::text,
      v_profile_user_id,
      v_organization_id,
      v_membership_id,
      null::uuid;
    return;
  end if;

  select count(*)
  into v_store_count
  from public.stores s
  where s.organization_id = v_organization_id;

  select s.id
  into v_store_id
  from public.stores s
  where s.organization_id = v_organization_id
  order by s.id asc
  limit 1;

  if v_store_count > 1 then
    return query
    select
      'requires_manual_intervention'::text,
      'multiple_stores_already_exist'::text,
      'The user already belongs to an organization with multiple stores.'::text,
      v_profile_user_id,
      v_organization_id,
      v_membership_id,
      null::uuid;
    return;
  end if;

  select count(*)
  into v_subscription_count
  from public.subscriptions subscription_row
  where subscription_row.organization_id = v_organization_id;

  if v_subscription_count > 1 then
    return query
    select
      'requires_manual_intervention'::text,
      'multiple_subscriptions_found'::text,
      'The organization already has multiple subscription rows and cannot be reprovisioned automatically.'::text,
      v_profile_user_id,
      v_organization_id,
      v_membership_id,
      v_store_id;
    return;
  end if;

  if v_store_count = 0 then
    return query
    select
      'requires_manual_intervention'::text,
      case
        when v_subscription_count = 0
          then 'membership_missing_store_and_subscription'
        else 'subscription_exists_without_store'
      end::text,
      case
        when v_subscription_count = 0
          then 'The account has an organization membership without store or subscription and requires manual review.'
        else 'The account has a subscription row without a matching store and requires manual review.'
      end::text,
      v_profile_user_id,
      v_organization_id,
      v_membership_id,
      null::uuid;
    return;
  end if;

  if v_subscription_count = 0 then
    return query
    select
      'requires_manual_intervention'::text,
      'subscription_missing_for_existing_store'::text,
      'The organization already has a store but is missing a subscription and cannot be reprovisioned automatically.'::text,
      v_profile_user_id,
      v_organization_id,
      v_membership_id,
      v_store_id;
    return;
  end if;

  if v_subscription_count = 1 then
    return query
    select
      'already_provisioned'::text,
      null::text,
      null::text,
      v_profile_user_id,
      v_organization_id,
      v_membership_id,
      v_store_id;
    return;
  end if;

  return query
  select
    'requires_manual_intervention'::text,
    'tenant_state_unrecognized'::text,
    'The existing tenant state is not recognized safely and requires manual review.'::text,
    v_profile_user_id,
    v_organization_id,
    v_membership_id,
    v_store_id;
end;
$function$;

DO $acl$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        WHERE p.oid IN (
            'public.ensure_store_opportunity_gate_policy_by_system(uuid,uuid)'::regprocedure,
            'public.zion_admin_provision_account(uuid,text,text)'::regprocedure
        ) AND (pg_get_userbyid(p.proowner) <> 'postgres' OR NOT p.prosecdef
            OR has_function_privilege('anon', p.oid, 'EXECUTE')
            OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
            OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
    ) THEN RAISE EXCEPTION 'T4K_ACL_MISMATCH'; END IF;
END;
$acl$;

COMMIT;

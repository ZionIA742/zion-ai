-- Manual checks for the P19-A discount counterpart policy.
-- Run only after:
--   1) 20261005103000_p19a_discount_counterpart_policy.sql
--   2) 20261005180000_p19a_discount_counterpart_policy_scope_repair.sql
--
-- This runner uses an existing organization/store dynamically and rolls back
-- every data mutation at the end. It does not depend on hard-coded tenant IDs.

begin;

do $manual_checks$
declare
  v_org uuid;
  v_store uuid;
  v_wrong_org uuid;
  v_row_count integer;
  v_policy public.store_discount_counterpart_policy;
  v_previous_claim_role text;
  v_cross_scope_blocked boolean := false;
  v_invalid_token_blocked boolean := false;
begin
  if pg_catalog.to_regclass('public.store_discount_counterpart_policy') is null then
    raise exception using
      errcode = 'P0001',
      message = 'counterpart policy table is missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.read_store_discount_counterpart_policy_scoped(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.upsert_store_discount_counterpart_policy_scoped(uuid,uuid,boolean,text[],boolean,text,numeric,bigint,boolean,integer)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'counterpart policy scoped RPCs are missing';
  end if;

  select
    store_row.organization_id,
    store_row.id
  into
    v_org,
    v_store
  from public.stores store_row
  where store_row.organization_id is not null
  order by store_row.organization_id, store_row.id
  limit 1;

  if v_org is null or v_store is null then
    raise exception using
      errcode = 'P0001',
      message = 'manual check fixture missing: at least one existing store is required';
  end if;

  -- Exercise the server-side branch explicitly, regardless of how SQL Editor
  -- represents its own request role.
  v_previous_claim_role := nullif(
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );

  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'service_role',
    true
  );

  if public.zion_resolve_request_role_internal() <> 'service_role' then
    raise exception using
      errcode = 'P0001',
      message = 'manual check precondition failed: service_role claim was not resolved';
  end if;

  -- --------------------------------------------------------------------------
  -- 1. First upsert.
  -- --------------------------------------------------------------------------
  perform public.upsert_store_discount_counterpart_policy_scoped(
    v_org,
    v_store,
    true,
    array['pix']::text[],
    false,
    null,
    null,
    null,
    false,
    null
  );

  raise notice 'UPSERT_FIRST=PASS';

  -- --------------------------------------------------------------------------
  -- 2. Replay the same upsert. The PK/upsert contract must keep one row.
  -- --------------------------------------------------------------------------
  perform public.upsert_store_discount_counterpart_policy_scoped(
    v_org,
    v_store,
    true,
    array['pix']::text[],
    false,
    null,
    null,
    null,
    false,
    null
  );

  raise notice 'UPSERT_REPLAY=PASS';

  select count(*)
  into v_row_count
  from public.read_store_discount_counterpart_policy_scoped(v_org, v_store);

  if v_row_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'upsert is not idempotent: expected 1 row, got %s',
        v_row_count
      );
  end if;

  raise notice 'ROW_COUNT_AFTER_REPLAY=1';

  select policy_row.*
  into v_policy
  from public.read_store_discount_counterpart_policy_scoped(v_org, v_store)
       as policy_row;

  if v_policy.organization_id <> v_org
     or v_policy.store_id <> v_store
     or v_policy.enabled is not true
     or v_policy.allowed_payment_methods <> array['pix']::text[]
     or v_policy.higher_down_payment_enabled is not false
     or v_policy.fewer_installments_enabled is not false then
    raise exception using
      errcode = 'P0001',
      message = 'read after upsert returned unexpected policy data';
  end if;

  raise notice 'READ_AFTER_UPSERT=PASS';

  -- --------------------------------------------------------------------------
  -- 3. Cross-scope must fail closed.
  -- Use a derived, non-hard-coded organization UUID that cannot match the
  -- selected store's organization for this test.
  -- --------------------------------------------------------------------------
  v_wrong_org := pg_catalog.md5(v_org::text || ':wrong-org')::uuid;

  if v_wrong_org = v_org then
    v_wrong_org := pg_catalog.md5(v_org::text || ':wrong-org-2')::uuid;
  end if;

  begin
    perform public.read_store_discount_counterpart_policy_scoped(
      v_wrong_org,
      v_store
    );
  exception
    when insufficient_privilege then
      v_cross_scope_blocked := true;
  end;

  if v_cross_scope_blocked is not true then
    raise exception using
      errcode = 'P0001',
      message = 'cross-scope read was not blocked';
  end if;

  raise notice 'CROSS_SCOPE_BLOCKED=PASS';

  -- --------------------------------------------------------------------------
  -- 4. Unknown payment token must be rejected by the canonical DB constraint.
  -- --------------------------------------------------------------------------
  begin
    perform public.upsert_store_discount_counterpart_policy_scoped(
      v_org,
      v_store,
      true,
      array['invalid_token']::text[],
      false,
      null,
      null,
      null,
      false,
      null
    );
  exception
    when check_violation then
      v_invalid_token_blocked := true;
  end;

  if v_invalid_token_blocked is not true then
    raise exception using
      errcode = 'P0001',
      message = 'invalid payment token was not blocked';
  end if;

  raise notice 'INVALID_PAYMENT_TOKEN_BLOCKED=PASS';

  -- Restore the previous claim value inside this transaction for cleanliness.
  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    coalesce(v_previous_claim_role, ''),
    true
  );

  raise notice 'P19A_DISCOUNT_COUNTERPART_POLICY_MANUAL_CHECKS=PASS';
end;
$manual_checks$;

rollback;

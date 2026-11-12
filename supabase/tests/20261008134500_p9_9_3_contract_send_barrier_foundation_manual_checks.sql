-- ZION / P9 / 9.3-B - Foundation verification without commercial fixtures.
-- This runner deliberately DOES NOT fabricate a customer-accepted proposal,
-- a contract, a contract version, a PDF, or an outbound WhatsApp message.
-- It proves real catalog guarantees and executes safe negative SQL tests.
-- It DOES NOT prove successful barrier activation, actual UPDATE/DELETE trigger
-- execution, the send/finalize flow, or concurrency across two sessions.
-- All tests run in one transaction, which MUST finish with ROLLBACK.

begin;

-- --------------------------------------------------------------------------
-- A. Installed foundation: constraints, FK targets, indexes, RLS and ACLs.
-- --------------------------------------------------------------------------
do $foundation_structure$
declare
  v_missing text;
  v_bad text;
  v_count integer;
begin
  if to_regclass('public.p9_sales_contract_send_barriers') is null then
    raise exception using message = 'P9_9_3_BARRIER_TABLE_MISSING';
  end if;

  -- Every FK must reference its intended parent and already be validated.
  with expected(name, parent) as (
    values
      ('p9_contract_send_barriers_store_scope_fkey', 'public.stores'),
      ('p9_contract_send_barriers_contract_scope_fkey', 'public.sales_contracts'),
      ('p9_contract_send_barriers_contract_quote_lineage_fkey', 'public.sales_contracts'),
      ('p9_contract_send_barriers_contract_version_scope_fkey', 'public.sales_contract_versions'),
      ('p9_contract_send_barriers_quote_opportunity_scope_fkey', 'public.sales_quotes'),
      ('p9_contract_send_barriers_quote_version_scope_fkey', 'public.sales_quote_versions'),
      ('p9_contract_send_barriers_opportunity_scope_fkey', 'public.commercial_opportunities'),
      ('p9_contract_send_barriers_message_scope_fkey', 'public.messages')
  )
  select string_agg(e.name, ', ' order by e.name) into v_missing
    from expected e
    left join pg_catalog.pg_constraint co
      on co.conrelid = 'public.p9_sales_contract_send_barriers'::regclass
     and co.conname = e.name
     and co.contype = 'f'
     and co.convalidated
     and co.confrelid = to_regclass(e.parent)
   where co.oid is null;
  if v_missing is not null then
    raise exception using message = 'P9_9_3_BARRIER_FK_TARGET_OR_VALIDATION_INVALID',
      detail = v_missing;
  end if;

  -- Check that every expected index belongs to the correct table, is usable,
  -- and has the expected uniqueness/partial-index properties.
  with expected(name, parent, must_be_unique, must_be_partial) as (
    values
      ('p9_contract_send_barriers_operation_uidx', 'public.p9_sales_contract_send_barriers', true, false),
      ('p9_contract_send_barriers_message_uidx', 'public.p9_sales_contract_send_barriers', true, false),
      ('p9_contract_send_barriers_contract_version_uidx', 'public.p9_sales_contract_send_barriers', true, false),
      ('p9_contract_send_barriers_active_contract_uidx', 'public.p9_sales_contract_send_barriers', true, true),
      ('p9_contract_send_barriers_active_opportunity_idx', 'public.p9_sales_contract_send_barriers', false, true),
      ('p9_messages_id_organization_store_uidx', 'public.messages', true, false),
      ('p9_sales_contracts_id_quote_lineage_scope_uidx', 'public.sales_contracts', true, false)
  )
  select string_agg(e.name, ', ' order by e.name) into v_bad
    from expected e
    left join pg_catalog.pg_class i
      on i.oid = to_regclass('public.' || e.name) and i.relkind = 'i'
    left join pg_catalog.pg_index ix on ix.indexrelid = i.oid
   where ix.indexrelid is null
      or ix.indrelid is distinct from to_regclass(e.parent)
      or not coalesce(ix.indisvalid, false)
      or not coalesce(ix.indisready, false)
      or (e.must_be_unique and not coalesce(ix.indisunique, false))
      or (e.must_be_partial and ix.indpred is null)
      or (not e.must_be_partial and ix.indpred is not null);
  if v_bad is not null then
    raise exception using message = 'P9_9_3_BARRIER_INDEX_MISSING_OR_INVALID',
      detail = v_bad;
  end if;

  select count(*) into v_count
    from pg_catalog.pg_constraint
   where conrelid = 'public.p9_sales_contract_send_barriers'::regclass
     and contype = 'c' and convalidated
     and conname in (
       'p9_sales_contract_send_barriers_key_ck',
       'p9_sales_contract_send_barriers_release_ck',
       'p9_sales_contract_send_barriers_scope_identity_ck'
     );
  if v_count <> 3 then
    raise exception using message = 'P9_9_3_BARRIER_VALIDATED_CHECKS_MISSING';
  end if;

  -- Ensure the installed repair is present before running the copied CHECK
  -- tests. The original CHECK accepted missing release fields as UNKNOWN.
  if not exists (
    select 1 from pg_catalog.pg_constraint co
     where co.conrelid = 'public.p9_sales_contract_send_barriers'::regclass
       and co.conname = 'p9_sales_contract_send_barriers_release_ck'
       and co.convalidated
       and position('release_reason is not null' in lower(pg_get_constraintdef(co.oid))) > 0
       and position('release_evidence is not null' in lower(pg_get_constraintdef(co.oid))) > 0
  ) then
    raise exception using message = 'P9_9_3_RELEASE_CHECK_REPAIR_NOT_INSTALLED';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class
     where oid = 'public.p9_sales_contract_send_barriers'::regclass
       and relrowsecurity and relforcerowsecurity
  ) then
    raise exception using message = 'P9_9_3_BARRIER_RLS_NOT_FORCED';
  end if;

  -- The foundation has no RLS policies and grants no table access to app roles.
  if exists (
    select 1 from pg_catalog.pg_policy
     where polrelid = 'public.p9_sales_contract_send_barriers'::regclass
  ) then
    raise exception using message = 'P9_9_3_BARRIER_UNEXPECTED_RLS_POLICY';
  end if;

  if has_table_privilege('public', 'public.p9_sales_contract_send_barriers', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('anon', 'public.p9_sales_contract_send_barriers', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated', 'public.p9_sales_contract_send_barriers', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('service_role', 'public.p9_sales_contract_send_barriers', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception using message = 'P9_9_3_BARRIER_APP_TABLE_GRANT_UNEXPECTED';
  end if;

  if has_function_privilege('public', 'public.p9_acquire_sales_contract_send_domain_lock(uuid,uuid,uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.p9_acquire_sales_contract_send_domain_lock(uuid,uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.p9_acquire_sales_contract_send_domain_lock(uuid,uuid,uuid)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.p9_acquire_sales_contract_send_domain_lock(uuid,uuid,uuid)', 'EXECUTE')
    or has_function_privilege('public', 'public.p9_read_active_sales_contract_send_barriers_by_contract(uuid,uuid,uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.p9_read_active_sales_contract_send_barriers_by_contract(uuid,uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.p9_read_active_sales_contract_send_barriers_by_contract(uuid,uuid,uuid)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.p9_read_active_sales_contract_send_barriers_by_contract(uuid,uuid,uuid)', 'EXECUTE')
    or has_function_privilege('public', 'public.p9_read_active_sales_contract_send_barriers_by_opportunity(uuid,uuid,uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.p9_read_active_sales_contract_send_barriers_by_opportunity(uuid,uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.p9_read_active_sales_contract_send_barriers_by_opportunity(uuid,uuid,uuid)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.p9_read_active_sales_contract_send_barriers_by_opportunity(uuid,uuid,uuid)', 'EXECUTE') then
    raise exception using message = 'P9_9_3_BARRIER_HELPER_GRANT_UNEXPECTED';
  end if;

  -- BEFORE UPDATE OR DELETE FOR EACH ROW, enabled, attached to the correct table.
  if not exists (
    select 1 from pg_catalog.pg_trigger t
     where t.tgrelid = 'public.p9_sales_contract_send_barriers'::regclass
       and t.tgname = 'p9_contract_send_barrier_immutability_guard'
       and not t.tgisinternal
       and t.tgenabled in ('O','A')
       and t.tgtype = 27
       and t.tgfoid = to_regprocedure('public.p9_guard_sales_contract_send_barrier_immutability()')
  ) then
    raise exception using message = 'P9_9_3_BARRIER_IMMUTABILITY_TRIGGER_MISSING';
  end if;

  -- SECURITY DEFINER and owner/configuration of all four internal helpers.
  with expected(signature) as (
    values
      ('public.p9_acquire_sales_contract_send_domain_lock(uuid,uuid,uuid)'),
      ('public.p9_read_active_sales_contract_send_barriers_by_contract(uuid,uuid,uuid)'),
      ('public.p9_read_active_sales_contract_send_barriers_by_opportunity(uuid,uuid,uuid)'),
      ('public.p9_guard_sales_contract_send_barrier_immutability()')
  )
  select string_agg(e.signature, ', ' order by e.signature) into v_bad
    from expected e
    left join pg_catalog.pg_proc p on p.oid = to_regprocedure(e.signature)
    left join pg_catalog.pg_roles r on r.oid = p.proowner
   where p.oid is null or not coalesce(p.prosecdef, false)
      or r.rolname is distinct from 'postgres'
      or not ('row_security=off' = any(coalesce(p.proconfig, array[]::text[])));
  if v_bad is not null then
    raise exception using message = 'P9_9_3_BARRIER_HELPER_SECURITY_INVALID', detail = v_bad;
  end if;

  raise notice 'P9_9_3 FOUNDATION STRUCTURAL PASS: 8 validated FK targets, indexes, 3 checks, RLS, grants, trigger, helpers';
end
$foundation_structure$;

-- --------------------------------------------------------------------------
-- B. Isolated schema behavior. The TEMP table copies the live NOT NULL,
-- CHECK, UNIQUE and partial-index definitions. It does NOT copy foreign keys.
-- This allows CHECK behavior to be tested without inventing real commercial
-- entities. These are NOT tests of a valid canonical barrier INSERT.
-- The actual immutable trigger function is attached to the TEMP clone.
-- --------------------------------------------------------------------------
create temp table p9_9_3_barrier_schema_fixture
  (like public.p9_sales_contract_send_barriers
    including defaults including constraints including indexes)
  on commit drop;

create trigger p9_9_3_temp_barrier_immutability_guard
  before update or delete on pg_temp.p9_9_3_barrier_schema_fixture
  for each row
  execute function public.p9_guard_sales_contract_send_barrier_immutability();

do $foundation_schema_behavior$
declare
  v_org uuid := gen_random_uuid();
  v_store uuid := gen_random_uuid();
  v_contract_a uuid := gen_random_uuid();
  v_contract_b uuid := gen_random_uuid();
  v_contract_c uuid := gen_random_uuid();
  v_version_a uuid := gen_random_uuid();
  v_version_b uuid := gen_random_uuid();
  v_version_c uuid := gen_random_uuid();
  v_quote uuid := gen_random_uuid();
  v_quote_version uuid := gen_random_uuid();
  v_opportunity uuid := gen_random_uuid();
  v_message_a uuid := gen_random_uuid();
  v_message_b uuid := gen_random_uuid();
  v_message_c uuid := gen_random_uuid();
  v_barrier_id uuid;
  v_constraint text;
  v_column text;
  v_error text;
  v_count integer := 0;
begin
  -- 1. Positive schema INSERT (not a valid commercial/foreign-key fixture).
  insert into pg_temp.p9_9_3_barrier_schema_fixture (
    organization_id, store_id, sales_contract_id, sales_contract_version_id,
    sales_quote_id, sales_quote_version_id, commercial_opportunity_id,
    message_id, outbound_idempotency_key
  ) values (
    v_org, v_store, v_contract_a, v_version_a,
    v_quote, v_quote_version, v_opportunity, v_message_a, 'p9:barrier:fixture:a'
  ) returning id into v_barrier_id;
  if v_barrier_id is null then
    raise exception using message='P9_9_3_SCHEMA_FIXTURE_INSERT_FAILED';
  end if;
  v_count := v_count + 1;

  -- 2. NOT NULL identity check, independent of commercial foreign keys.
  v_column := null;
  begin
    insert into pg_temp.p9_9_3_barrier_schema_fixture(outbound_idempotency_key)
      values ('p9:barrier:incomplete');
  exception when not_null_violation then
    get stacked diagnostics v_column = column_name;
  end;
  if v_column is distinct from 'organization_id' then
    raise exception using message='P9_9_3_FIXTURE_NOT_NULL_NOT_ENFORCED',
      detail=coalesce(v_column, 'no exception');
  end if;
  v_count := v_count + 1;

  -- 3. Blank idempotency key must fail the copied live CHECK.
  v_constraint := null;
  begin
    insert into pg_temp.p9_9_3_barrier_schema_fixture (
      organization_id, store_id, sales_contract_id, sales_contract_version_id,
      sales_quote_id, sales_quote_version_id, commercial_opportunity_id,
      message_id, outbound_idempotency_key
    ) values (
      v_org, v_store, v_contract_c, v_version_c,
      v_quote, v_quote_version, v_opportunity, v_message_c, ''
    );
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
  end;
  if v_constraint is distinct from 'p9_sales_contract_send_barriers_key_ck' then
    raise exception using message='P9_9_3_FIXTURE_KEY_CHECK_NOT_ENFORCED',
      detail=coalesce(v_constraint, 'no exception');
  end if;
  v_count := v_count + 1;

  -- 4. Released timestamp without reason/evidence. This was the prior bug:
  -- the old PostgreSQL CHECK evaluated to UNKNOWN and accepted the row.
  v_constraint := null;
  begin
    insert into pg_temp.p9_9_3_barrier_schema_fixture (
      organization_id, store_id, sales_contract_id, sales_contract_version_id,
      sales_quote_id, sales_quote_version_id, commercial_opportunity_id,
      message_id, outbound_idempotency_key, released_at
    ) values (
      v_org, v_store, v_contract_c, v_version_c,
      v_quote, v_quote_version, v_opportunity, v_message_c,
      'p9:barrier:missing-reason', clock_timestamp()
    );
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
  end;
  if v_constraint is distinct from 'p9_sales_contract_send_barriers_release_ck' then
    raise exception using message='P9_9_3_FIXTURE_MISSING_RELEASE_REASON_ACCEPTED',
      detail=coalesce(v_constraint, 'no exception');
  end if;
  v_count := v_count + 1;

  -- 5. A release with a valid reason but absent evidence must also fail.
  v_constraint := null;
  begin
    insert into pg_temp.p9_9_3_barrier_schema_fixture (
      organization_id, store_id, sales_contract_id, sales_contract_version_id,
      sales_quote_id, sales_quote_version_id, commercial_opportunity_id,
      message_id, outbound_idempotency_key, released_at, release_reason
    ) values (
      v_org, v_store, v_contract_c, v_version_c,
      v_quote, v_quote_version, v_opportunity, v_message_c,
      'p9:barrier:missing-evidence', clock_timestamp(), 'finalized'
    );
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
  end;
  if v_constraint is distinct from 'p9_sales_contract_send_barriers_release_ck' then
    raise exception using message='P9_9_3_FIXTURE_MISSING_RELEASE_EVIDENCE_ACCEPTED',
      detail=coalesce(v_constraint, 'no exception');
  end if;
  v_count := v_count + 1;

  -- 6. Evidence must be an object, not an array.
  v_constraint := null;
  begin
    insert into pg_temp.p9_9_3_barrier_schema_fixture (
      organization_id, store_id, sales_contract_id, sales_contract_version_id,
      sales_quote_id, sales_quote_version_id, commercial_opportunity_id,
      message_id, outbound_idempotency_key,
      activated_at, released_at, release_reason, release_evidence
    ) values (
      v_org, v_store, v_contract_c, v_version_c,
      v_quote, v_quote_version, v_opportunity, v_message_c,
      'p9:barrier:bad-evidence', clock_timestamp()-interval '2 seconds',
      clock_timestamp(), 'finalized', '[]'::jsonb
    );
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
  end;
  if v_constraint is distinct from 'p9_sales_contract_send_barriers_release_ck' then
    raise exception using message='P9_9_3_FIXTURE_NON_OBJECT_EVIDENCE_ACCEPTED',
      detail=coalesce(v_constraint, 'no exception');
  end if;
  v_count := v_count + 1;

  -- 7. Release must not predate activation.
  v_constraint := null;
  begin
    insert into pg_temp.p9_9_3_barrier_schema_fixture (
      organization_id, store_id, sales_contract_id, sales_contract_version_id,
      sales_quote_id, sales_quote_version_id, commercial_opportunity_id,
      message_id, outbound_idempotency_key,
      activated_at, released_at, release_reason, release_evidence
    ) values (
      v_org, v_store, v_contract_c, v_version_c,
      v_quote, v_quote_version, v_opportunity, v_message_c,
      'p9:barrier:early-release', clock_timestamp(),
      clock_timestamp()-interval '10 seconds', 'finalized', '{}'::jsonb
    );
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
  end;
  if v_constraint is distinct from 'p9_sales_contract_send_barriers_release_ck' then
    raise exception using message='P9_9_3_FIXTURE_EARLY_RELEASE_ACCEPTED',
      detail=coalesce(v_constraint, 'no exception');
  end if;
  v_count := v_count + 1;

  -- 8. Coherent release fields satisfy the copied release CHECK.
  insert into pg_temp.p9_9_3_barrier_schema_fixture (
    organization_id, store_id, sales_contract_id, sales_contract_version_id,
    sales_quote_id, sales_quote_version_id, commercial_opportunity_id,
    message_id, outbound_idempotency_key,
    activated_at, released_at, release_reason, release_evidence
  ) values (
    v_org, v_store, v_contract_b, v_version_b,
    v_quote, v_quote_version, v_opportunity, v_message_b,
    'p9:barrier:fixture:released', clock_timestamp()-interval '2 seconds',
    clock_timestamp(), 'finalized', '{}'::jsonb
  );
  v_count := v_count + 1;

  -- 9. Same idempotency key with a different message/contract is rejected.
  v_constraint := null;
  begin
    insert into pg_temp.p9_9_3_barrier_schema_fixture (
      organization_id, store_id, sales_contract_id, sales_contract_version_id,
      sales_quote_id, sales_quote_version_id, commercial_opportunity_id,
      message_id, outbound_idempotency_key
    ) values (
      v_org, v_store, v_contract_c, v_version_c,
      v_quote, v_quote_version, v_opportunity, v_message_c,
      'p9:barrier:fixture:a'
    );
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
  end;
  if v_constraint is null then
    raise exception using message='P9_9_3_FIXTURE_DUPLICATE_OPERATION_ACCEPTED';
  end if;
  v_count := v_count + 1;

  -- 10. Reusing a message for a different contract is rejected.
  v_constraint := null;
  begin
    insert into pg_temp.p9_9_3_barrier_schema_fixture (
      organization_id, store_id, sales_contract_id, sales_contract_version_id,
      sales_quote_id, sales_quote_version_id, commercial_opportunity_id,
      message_id, outbound_idempotency_key
    ) values (
      v_org, v_store, v_contract_c, v_version_c,
      v_quote, v_quote_version, v_opportunity, v_message_a,
      'p9:barrier:duplicate-message'
    );
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
  end;
  if v_constraint is null then
    raise exception using message='P9_9_3_FIXTURE_DUPLICATE_MESSAGE_ACCEPTED';
  end if;
  v_count := v_count + 1;

  -- 11. Second active version of the same contract is rejected.
  v_constraint := null;
  begin
    insert into pg_temp.p9_9_3_barrier_schema_fixture (
      organization_id, store_id, sales_contract_id, sales_contract_version_id,
      sales_quote_id, sales_quote_version_id, commercial_opportunity_id,
      message_id, outbound_idempotency_key
    ) values (
      v_org, v_store, v_contract_a, v_version_c,
      v_quote, v_quote_version, v_opportunity, v_message_c,
      'p9:barrier:second-active'
    );
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
  end;
  if v_constraint is null then
    raise exception using message='P9_9_3_FIXTURE_SECOND_ACTIVE_BARRIER_ACCEPTED';
  end if;
  v_count := v_count + 1;

  -- 12. Invoke the installed immutability trigger FUNCTION on a TEMP row.
  v_error := null;
  begin
    update pg_temp.p9_9_3_barrier_schema_fixture
       set release_reason = 'finalized'
     where id = v_barrier_id;
  exception when insufficient_privilege then
    get stacked diagnostics v_error = message_text;
  end;
  if v_error is distinct from 'P9_9_3_CONTRACT_SEND_BARRIER_UPDATE_AUTHORITY_NOT_INSTALLED' then
    raise exception using message='P9_9_3_FIXTURE_UPDATE_GUARD_INVALID',
      detail=coalesce(v_error, 'no exception');
  end if;
  v_count := v_count + 1;

  -- 13. Delete is also forbidden by the very same installed trigger function.
  v_error := null;
  begin
    delete from pg_temp.p9_9_3_barrier_schema_fixture
     where id = v_barrier_id;
  exception when insufficient_privilege then
    get stacked diagnostics v_error = message_text;
  end;
  if v_error is distinct from 'P9_9_3_CONTRACT_SEND_BARRIER_DELETE_FORBIDDEN' then
    raise exception using message='P9_9_3_FIXTURE_DELETE_GUARD_INVALID',
      detail=coalesce(v_error, 'no exception');
  end if;
  v_count := v_count + 1;

  if v_count <> 13 then
    raise exception using message='P9_9_3_FIXTURE_SCHEMA_TEST_COUNT_MISMATCH';
  end if;
  raise notice 'P9_9_3 FOUNDATION ISOLATED SCHEMA PASS: % checks on TEMP clone; not commercial FK integration', v_count;
end
$foundation_schema_behavior$;

-- --------------------------------------------------------------------------
-- C. Actual installed table: reject a barrier whose referenced parents do
-- not exist. FK trigger evaluation order is not a contract: ANY of the eight
-- validated FKs may reject first. No valid message/contract is inserted.
-- Internal helper fail-closed behavior is also tested without business data.
-- --------------------------------------------------------------------------
do $foundation_real_negative_checks$
declare
  v_absent uuid := gen_random_uuid();
  v_constraint text;
  v_count integer := 0;
begin
  if exists (select 1 from public.stores where id = v_absent) then
    raise exception using message='P9_9_3_TEST_UUID_ALREADY_EXISTS';
  end if;

  v_constraint := null;
  begin
    insert into public.p9_sales_contract_send_barriers (
      organization_id, store_id, sales_contract_id, sales_contract_version_id,
      sales_quote_id, sales_quote_version_id, commercial_opportunity_id,
      message_id, outbound_idempotency_key
    ) values (
      v_absent, v_absent, v_absent, v_absent, v_absent, v_absent,
      v_absent, v_absent, 'p9:barrier:negative:missing-store'
    );
  exception when foreign_key_violation then
    get stacked diagnostics v_constraint = constraint_name;
  end;
  if v_constraint is null or not exists (
    select 1 from pg_catalog.pg_constraint co
     where co.conrelid = 'public.p9_sales_contract_send_barriers'::regclass
       and co.conname = v_constraint
       and co.contype = 'f'
       and co.convalidated
  ) then
    raise exception using message='P9_9_3_REAL_FK_REJECTION_NOT_ENFORCED',
      detail=coalesce(v_constraint, 'no exception');
  end if;
  v_count := v_count + 1;

  begin
    perform * from public.p9_read_active_sales_contract_send_barriers_by_contract(
      null::uuid, v_absent, v_absent
    );
    raise exception using message='P9_9_3_REAL_READ_NULL_ARGUMENT_ACCEPTED';
  exception when invalid_parameter_value then
    v_count := v_count + 1;
  end;

  begin
    perform public.p9_acquire_sales_contract_send_domain_lock(
      v_absent, null::uuid, v_absent
    );
    raise exception using message='P9_9_3_REAL_LOCK_NULL_ARGUMENT_ACCEPTED';
  exception when invalid_parameter_value then
    v_count := v_count + 1;
  end;

  if v_count <> 3 then
    raise exception using message='P9_9_3_REAL_NEGATIVE_TEST_COUNT_MISMATCH';
  end if;
  raise notice 'P9_9_3 FOUNDATION REAL NEGATIVE PASS: % checks (1 FK + 2 fail-closed arguments)', v_count;
end
$foundation_real_negative_checks$;

-- --------------------------------------------------------------------------
-- C. Honest coverage report. The installed 9.3-B foundation cannot be tested
-- with a valid barrier until a linked contract/opportunity/quote/version
-- exists; we do not manufacture a false accepted commercial proposal.
-- --------------------------------------------------------------------------
do $foundation_coverage$
declare
  v_eligible bigint;
  v_barriers bigint;
begin
  select count(*) into v_eligible
    from public.sales_contracts c
    join public.sales_contract_versions cv
      on cv.id = c.current_version_id and cv.contract_id = c.id
     and cv.organization_id = c.organization_id and cv.store_id = c.store_id
    join public.sales_quotes q
      on q.id = c.quote_id and q.organization_id = c.organization_id
     and q.store_id = c.store_id
    join public.sales_quote_versions qv
      on qv.id = c.quote_version_id and qv.quote_id = q.id
     and qv.organization_id = c.organization_id and qv.store_id = c.store_id
    join public.commercial_opportunities o
      on o.id = q.commercial_opportunity_id
     and o.organization_id = c.organization_id and o.store_id = c.store_id
    join public.conversations cvn
      on cvn.id = c.conversation_id and cvn.organization_id = c.organization_id
    join public.leads l
      on l.id = cvn.lead_id and l.organization_id = c.organization_id
     and l.store_id = c.store_id;

  select count(*) into v_barriers from public.p9_sales_contract_send_barriers;
  raise notice 'P9_9_3 COVERAGE: existing eligible linked contracts=%, persisted barriers=%',
    v_eligible, v_barriers;
  raise notice 'P9_9_3 NOT TESTED: successful INSERT/replay, UPDATE/DELETE trigger behavior, atomic activation, finalization, and 2-session concurrency';
  raise notice 'P9_9_3 FOUNDATION RESULT: STRUCTURAL PASS + 13 TEMP schema checks + 3 real negative checks ONLY; full integration is NOT approved';
end
$foundation_coverage$;

-- Mandatory: no data or lock from this runner persists.
rollback;

-- Read-only result projection AFTER rollback for SQL Editor visibility.
-- These PASS labels are displayed only if all preceding assertions completed.
-- No table, message, contract or barrier data is changed by this SELECT.
select 'foundation_structure'::text as verification,
       'PASS'::text as result,
       '8 validated FKs, indexes, RLS, ACLs, trigger and internal helpers'::text as coverage
union all
select 'isolated_schema_checks', 'PASS',
       '13 isolated schema tests on a TEMP clone; no canonical fixture required'
union all
select 'real_fk_and_helper_fail_closed', 'PASS',
       '1 real-table FK rejection (any installed FK) + 2 helper invalid-argument checks'
union all
select 'valid_barrier_insert_and_replay', 'PENDING',
       'Requires full canonical lineage; deliberately not tested by this runner'
union all
select 'send_activation_and_finalization', 'PENDING',
       'Future integration migration and behavioral fixtures required'
union all
select 'concurrency_two_sessions', 'PENDING',
       'Requires independent database sessions';

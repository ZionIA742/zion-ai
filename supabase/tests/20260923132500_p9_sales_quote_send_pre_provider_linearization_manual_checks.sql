begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

-- ============================================================================
-- P9 / Bloco 6 / Etapa 6.6
-- Sales Quote Send Pre-provider Linearization Manual Checks
--
-- Proves:
--   1. quote-aware gate v2 is service-only / SECURITY DEFINER;
--   2. pending outbound does not freeze quote revision;
--   3. if revision wins first, queued old version is blocked before provider;
--   4. if final SEND gate wins first, attempt is persisted as uncertain;
--   5. after gate wins, new quote version is refused;
--   6. processing pre-attempt also serializes against version creation;
--   7. deterministic failed-before-attempt does not freeze revisions;
--   8. failed state retaining attempt evidence remains reconciliation-blocked;
--   9. provider accepted/sent evidence blocks revision;
--  10. expiration is re-read immediately before provider boundary;
--  11. idempotency/version identity mismatch fails closed pre-provider;
--  12. non-quote transport still delegates to the canonical legacy gate;
--  13. explicit quote-kind readiness reader remains wired into final boundary;
--  14. lock ordering is advisory -> quote -> version -> conversation -> message.
--
-- Everything is rolled back.
-- ============================================================================


-- ============================================================================
-- Result harness
-- ============================================================================

create temp table pg_temp._p9_66_results (
  scenario integer primary key,
  name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL')),
  detail text
) on commit preserve rows;

create or replace function pg_temp._p9_66_record(
  p_scenario integer,
  p_name text,
  p_status text,
  p_detail text default null
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_66_results(scenario, name, status, detail)
  values (p_scenario, p_name, p_status, p_detail)
  on conflict (scenario) do update
    set name = excluded.name,
        status = excluded.status,
        detail = excluded.detail;
end;
$function$;


-- Execute one SQL expression under an explicit API role and always restore
-- request identity before returning to the harness.
create or replace function pg_temp._p9_66_exec_json(
  p_role text,
  p_sql text
)
returns table (
  operation_succeeded boolean,
  value_json jsonb,
  returned_sqlstate text,
  message_text text
)
language plpgsql
as $function$
declare
  v_text text;
  v_state text;
  v_message text;
  v_ok boolean := false;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    return query
    select false, null::jsonb, 'P0001'::text,
      'runner helper caller is not postgres'::text;
    return;
  end if;

  if p_role not in ('service_role', 'authenticated', 'anon') then
    return query
    select false, null::jsonb, 'P0001'::text,
      'unsupported runner role'::text;
    return;
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claim.role', p_role, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('role', p_role)::text,
    true
  );

  execute pg_catalog.format('set local role %I', p_role);

  begin
    execute p_sql into v_text;
    v_ok := true;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text;
      v_ok := false;
  end;

  execute 'reset role';

  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claim.role', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '', true);

  return query
  select
    v_ok,
    case
      when v_ok and v_text is not null then v_text::jsonb
      else null::jsonb
    end,
    v_state,
    v_message;

exception
  when others then
    begin
      execute 'reset role';
    exception
      when others then null;
    end;

    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config('request.jwt.claim.role', '', true);
    perform pg_catalog.set_config('request.jwt.claims', '', true);

    return query
    select false, null::jsonb, sqlstate::text, sqlerrm::text;
end;
$function$;


-- ============================================================================
-- Fixtures
-- ============================================================================

create temp table pg_temp._p9_66_ctx (
  singleton boolean primary key default true check (singleton),
  org_id uuid not null,
  store_id uuid not null,
  user_id uuid not null,
  customer_id uuid not null,
  lead_id uuid not null,
  conversation_id uuid not null
) on commit preserve rows;

create temp table pg_temp._p9_66_fixture (
  label text primary key,
  opportunity_id uuid not null,
  quote_id uuid not null,
  version_id uuid not null,
  store_file_id uuid not null,
  message_id uuid
) on commit preserve rows;

do $fixtures$
declare
  v_org uuid := gen_random_uuid();
  v_store uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();
  v_lead uuid := gen_random_uuid();
  v_conversation uuid := gen_random_uuid();
begin
  insert into pg_temp._p9_66_ctx(
    org_id,
    store_id,
    user_id,
    customer_id,
    lead_id,
    conversation_id
  )
  values (
    v_org,
    v_store,
    v_user,
    v_customer,
    v_lead,
    v_conversation
  );

  insert into auth.users(id)
  values (v_user);

  insert into public.organizations(id, name, subscription_status)
  values (v_org, 'P9 6.6 Runner Org', 'active');

  insert into public.stores(id, organization_id, name)
  values (v_store, v_org, 'P9 6.6 Runner Store');

  insert into public.customers(id, organization_id, display_name)
  values (v_customer, v_org, 'P9 6.6 Runner Customer');

  insert into public.memberships(
    organization_id,
    user_id,
    role,
    is_active
  )
  values (v_org, v_user, 'admin', true);

  insert into public.leads(
    id,
    organization_id,
    store_id,
    name,
    phone,
    state
  )
  values (
    v_lead,
    v_org,
    v_store,
    'P9 6.6 Runner Lead',
    '5511999999999',
    'orcamento'
  );

  insert into public.conversations(
    id,
    organization_id,
    lead_id,
    status,
    is_human_active,
    created_at
  )
  values (
    v_conversation,
    v_org,
    v_lead,
    'active',
    true,
    clock_timestamp()
  );

  insert into pg_temp._p9_66_fixture(
    label,
    opportunity_id,
    quote_id,
    version_id,
    store_file_id
  )
  values
    ('version_wins', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()),
    ('gate_wins', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()),
    ('processing', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()),
    ('failed_pre', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()),
    ('failed_post', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()),
    ('provider_sent', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()),
    ('expiration', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()),
    ('identity', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid());

  insert into public.commercial_opportunities(
    id,
    organization_id,
    store_id,
    customer_id,
    stage
  )
  select
    fixture.opportunity_id,
    v_org,
    v_store,
    v_customer,
    'orcamento'
  from pg_temp._p9_66_fixture fixture;

  insert into public.sales_quotes(
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    conversation_id,
    lead_id,
    quote_number,
    title,
    status,
    customer_name,
    customer_phone,
    valid_until,
    subtotal_cents,
    discount_cents,
    total_cents,
    current_version_id,
    approved_at,
    approved_by,
    metadata
  )
  select
    fixture.quote_id,
    v_org,
    v_store,
    fixture.opportunity_id,
    v_conversation,
    v_lead,
    'P966-' || row_number() over (order by fixture.label),
    'P9 6.6 ' || fixture.label,
    'approved',
    'Cliente Runner',
    '5511999999999',
    ((now() at time zone 'UTC')::date + 30),
    10000,
    0,
    10000,
    null,
    clock_timestamp(),
    v_user,
    '{}'::jsonb
  from pg_temp._p9_66_fixture fixture;

  insert into public.store_files(
    id,
    organization_id,
    store_id,
    file_kind,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    uploaded_by
  )
  select
    fixture.store_file_id,
    v_org,
    v_store,
    'sales_quote_pdf',
    'zion-store-files',
    v_org::text || '/' || v_store::text ||
      '/sales-quotes/' || fixture.quote_id::text ||
      '/p9-6-6-' || fixture.label || '-v1.pdf',
    'p9-6-6-' || fixture.label || '-v1.pdf',
    'application/pdf',
    100,
    'system'
  from pg_temp._p9_66_fixture fixture;

  insert into public.sales_quote_versions(
    id,
    organization_id,
    store_id,
    quote_id,
    version_number,
    status,
    quote_kind,
    store_file_id,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    generated_by,
    quote_snapshot
  )
  select
    fixture.version_id,
    v_org,
    v_store,
    fixture.quote_id,
    1,
    'approved',
    null,
    fixture.store_file_id,
    'zion-store-files',
    v_org::text || '/' || v_store::text ||
      '/sales-quotes/' || fixture.quote_id::text ||
      '/p9-6-6-' || fixture.label || '-v1.pdf',
    'p9-6-6-' || fixture.label || '-v1.pdf',
    'application/pdf',
    100,
    'system',
    '{}'::jsonb
  from pg_temp._p9_66_fixture fixture;

  update public.sales_quotes quote_row
     set current_version_id = fixture.version_id
    from pg_temp._p9_66_fixture fixture
   where quote_row.id = fixture.quote_id
     and quote_row.organization_id = v_org
     and quote_row.store_id = v_store;
end;
$fixtures$;


-- ============================================================================
-- Helpers over the canonical writers
-- ============================================================================

create or replace function pg_temp._p9_66_key(p_label text)
returns text
language plpgsql
stable
as $function$
declare
  ctx pg_temp._p9_66_ctx%rowtype;
  fixture pg_temp._p9_66_fixture%rowtype;
begin
  select * into ctx
    from pg_temp._p9_66_ctx
   where singleton;

  select * into fixture
    from pg_temp._p9_66_fixture
   where label = p_label;

  return
    'sales_quote_send:'
    || ctx.org_id::text || ':'
    || ctx.store_id::text || ':'
    || fixture.opportunity_id::text || ':'
    || fixture.quote_id::text || ':'
    || fixture.version_id::text;
end;
$function$;


create or replace function pg_temp._p9_66_materialize(p_label text)
returns uuid
language plpgsql
as $function$
declare
  ctx pg_temp._p9_66_ctx%rowtype;
  fixture pg_temp._p9_66_fixture%rowtype;
  v_row record;
begin
  select * into ctx
    from pg_temp._p9_66_ctx
   where singleton;

  select * into fixture
    from pg_temp._p9_66_fixture
   where label = p_label;

  select *
    into v_row
    from public.materialize_sales_quote_send_by_system(
      ctx.org_id,
      ctx.store_id,
      fixture.opportunity_id,
      ctx.conversation_id,
      fixture.quote_id,
      fixture.version_id,
      'Segue o orcamento',
      '{}'::jsonb,
      pg_temp._p9_66_key(p_label),
      'sales_quote_send_route'
    );

  update pg_temp._p9_66_fixture
     set message_id = v_row.message_id
   where label = p_label;

  return v_row.message_id;
end;
$function$;


create or replace function pg_temp._p9_66_create_v2(p_label text)
returns uuid
language plpgsql
as $function$
declare
  ctx pg_temp._p9_66_ctx%rowtype;
  fixture pg_temp._p9_66_fixture%rowtype;
  v_file uuid := gen_random_uuid();
  v_row record;
begin
  select * into ctx
    from pg_temp._p9_66_ctx
   where singleton;

  select * into fixture
    from pg_temp._p9_66_fixture
   where label = p_label;

  insert into public.store_files(
    id,
    organization_id,
    store_id,
    file_kind,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    uploaded_by
  )
  values (
    v_file,
    ctx.org_id,
    ctx.store_id,
    'sales_quote_pdf',
    'zion-store-files',
    ctx.org_id::text || '/' || ctx.store_id::text ||
      '/sales-quotes/' || fixture.quote_id::text ||
      '/p9-6-6-' || p_label || '-v2.pdf',
    'p9-6-6-' || p_label || '-v2.pdf',
    'application/pdf',
    100,
    'system'
  );

  select *
    into v_row
    from public.create_sales_quote_version_by_system(
      ctx.org_id,
      ctx.store_id,
      fixture.quote_id,
      'generated',
      'pending_review',
      null,
      v_file,
      'zion-store-files',
      ctx.org_id::text || '/' || ctx.store_id::text ||
        '/sales-quotes/' || fixture.quote_id::text ||
        '/p9-6-6-' || p_label || '-v2.pdf',
      'p9-6-6-' || p_label || '-v2.pdf',
      'application/pdf',
      100,
      '{}'::jsonb
    );

  return v_row.id;
end;
$function$;


-- ============================================================================
-- Scenarios
-- ============================================================================

do $scenarios$
declare
  ctx pg_temp._p9_66_ctx%rowtype;
  fixture pg_temp._p9_66_fixture%rowtype;

  v_message uuid;
  v_version_2 uuid;
  v_current uuid;
  v_old_status text;
  v_state text;
  v_attempt timestamptz;
  v_external text;
  v_provider timestamptz;
  v_caught boolean;
  v_exec record;
  v_json jsonb;
  v_definition text;
  v_count integer;
  v_manual_message record;
  v_manual_key text;
begin
  select * into ctx
    from pg_temp._p9_66_ctx
   where singleton;

  -- --------------------------------------------------------------------------
  -- 1. Gate v2 hardening / ACL / trigger installation.
  -- --------------------------------------------------------------------------
  select pg_catalog.pg_get_functiondef(
    'public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)'::regprocedure
  )
  into v_definition;

  perform pg_temp._p9_66_record(
    1,
    'gate v2 e trigger estao instalados e service-only',
    case
      when v_definition is not null
       and exists (
         select 1
           from pg_catalog.pg_proc proc_row
           join pg_catalog.pg_namespace namespace_row
             on namespace_row.oid = proc_row.pronamespace
          where namespace_row.nspname = 'public'
            and proc_row.proname =
                  'validate_or_cancel_whatsapp_external_send_v2_by_system'
            and proc_row.prosecdef
       )
       and not pg_catalog.has_function_privilege(
         'public',
         'public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)',
         'execute'
       )
       and not pg_catalog.has_function_privilege(
         'anon',
         'public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)',
         'execute'
       )
       and not pg_catalog.has_function_privilege(
         'authenticated',
         'public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)',
         'execute'
       )
       and pg_catalog.has_function_privilege(
         'service_role',
         'public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)',
         'execute'
       )
       and exists (
         select 1
           from pg_catalog.pg_trigger trigger_row
          where trigger_row.tgrelid =
                'public.sales_quote_versions'::regclass
            and trigger_row.tgname =
                  'trg_sales_quote_version_external_send_linearization'
            and not trigger_row.tgisinternal
       )
      then 'PASS'
      else 'SUT_FAIL'
    end,
    'security definer + ACL + BEFORE INSERT invariant'
  );

  -- --------------------------------------------------------------------------
  -- 2. Pending loses to a new version: revision remains allowed before attempt.
  -- --------------------------------------------------------------------------
  select * into fixture
    from pg_temp._p9_66_fixture
   where label = 'version_wins';

  v_message := pg_temp._p9_66_materialize('version_wins');
  v_version_2 := pg_temp._p9_66_create_v2('version_wins');

  select current_version_id
    into v_current
    from public.sales_quotes
   where id = fixture.quote_id;

  select status
    into v_old_status
    from public.sales_quote_versions
   where id = fixture.version_id;

  select outbound_delivery_state
    into v_state
    from public.messages
   where id = v_message;

  perform pg_temp._p9_66_record(
    2,
    'pending ainda permite criar v2 e invalida v1 corrente',
    case
      when v_version_2 is not null
       and v_current = v_version_2
       and v_old_status = 'superseded'
       and v_state = 'pending'
      then 'PASS'
      else 'SUT_FAIL'
    end,
    pg_catalog.format(
      'v1=%s v2=%s current=%s old_status=%s message=%s',
      fixture.version_id,
      v_version_2,
      v_current,
      v_old_status,
      v_state
    )
  );

  -- --------------------------------------------------------------------------
  -- 3. If v2 wins first, stale queued v1 is terminally blocked before provider.
  -- --------------------------------------------------------------------------
  update public.messages
     set outbound_delivery_state = 'processing',
         outbound_claimed_at = clock_timestamp(),
         outbound_claimed_by = 'p9-6.6-runner'
   where id = v_message;

  select *
    into v_exec
    from pg_temp._p9_66_exec_json(
      'service_role',
      pg_catalog.format(
        'select public.validate_or_cancel_whatsapp_external_send_v2_by_system(%L::uuid,%L::uuid,%L::uuid)::text',
        ctx.org_id,
        ctx.store_id,
        v_message
      )
    );

  select outbound_delivery_state, outbound_attempt_started_at
    into v_state, v_attempt
    from public.messages
   where id = v_message;

  perform pg_temp._p9_66_record(
    3,
    'v2 vence primeiro e v1 stale e bloqueada antes do POST',
    case
      when v_exec.operation_succeeded
       and v_exec.value_json ->> 'decision' = 'blocked'
       and v_exec.value_json ->> 'reason' = 'sales_quote_send_version_stale'
       and v_state = 'failed'
       and v_attempt is null
      then 'PASS'
      else 'SUT_FAIL'
    end,
    pg_catalog.format(
      'result=%s state=%s attempt=%s error=%s',
      coalesce(v_exec.value_json::text, '<null>'),
      coalesce(v_state, '<null>'),
      coalesce(v_attempt::text, '<null>'),
      coalesce(v_exec.message_text, '<null>')
    )
  );

  -- --------------------------------------------------------------------------
  -- 4. Gate wins first: processing becomes uncertain/attempt-started.
  -- --------------------------------------------------------------------------
  select * into fixture
    from pg_temp._p9_66_fixture
   where label = 'gate_wins';

  v_message := pg_temp._p9_66_materialize('gate_wins');

  update public.messages
     set outbound_delivery_state = 'processing',
         outbound_claimed_at = clock_timestamp(),
         outbound_claimed_by = 'p9-6.6-runner'
   where id = v_message;

  select *
    into v_exec
    from pg_temp._p9_66_exec_json(
      'service_role',
      pg_catalog.format(
        'select public.validate_or_cancel_whatsapp_external_send_v2_by_system(%L::uuid,%L::uuid,%L::uuid)::text',
        ctx.org_id,
        ctx.store_id,
        v_message
      )
    );

  select outbound_delivery_state, outbound_attempt_started_at
    into v_state, v_attempt
    from public.messages
   where id = v_message;

  perform pg_temp._p9_66_record(
    4,
    'gate v1 vence e persiste attempt antes do provider',
    case
      when v_exec.operation_succeeded
       and v_exec.value_json ->> 'decision' = 'send'
       and v_state = 'uncertain'
       and v_attempt is not null
      then 'PASS'
      else 'SUT_FAIL'
    end,
    pg_catalog.format(
      'result=%s state=%s attempt=%s',
      coalesce(v_exec.value_json::text, '<null>'),
      coalesce(v_state, '<null>'),
      coalesce(v_attempt::text, '<null>')
    )
  );

  -- --------------------------------------------------------------------------
  -- 5. Once gate wins, creation of v2 is refused.
  -- --------------------------------------------------------------------------
  v_caught := false;

  begin
    perform pg_temp._p9_66_create_v2('gate_wins');
  exception
    when sqlstate '23514' then
      if sqlerrm =
        'ZION_SALES_QUOTE_VERSION_EXTERNAL_SEND_IN_FLIGHT_OR_REQUIRES_RECONCILIATION' then
        v_caught := true;
      end if;
  end;

  select current_version_id
    into v_current
    from public.sales_quotes
   where id = fixture.quote_id;

  perform pg_temp._p9_66_record(
    5,
    'attempt iniciado impede nova versao concorrente',
    case
      when v_caught
       and v_current = fixture.version_id
      then 'PASS'
      else 'SUT_FAIL'
    end,
    pg_catalog.format(
      'caught=%s current=%s expected=%s',
      v_caught,
      v_current,
      fixture.version_id
    )
  );

  -- --------------------------------------------------------------------------
  -- 6. Processing pre-attempt also freezes revision until worker resolves claim.
  -- --------------------------------------------------------------------------
  select * into fixture
    from pg_temp._p9_66_fixture
   where label = 'processing';

  v_message := pg_temp._p9_66_materialize('processing');

  update public.messages
     set outbound_delivery_state = 'processing',
         outbound_claimed_at = clock_timestamp(),
         outbound_claimed_by = 'p9-6.6-runner',
         outbound_attempt_started_at = null
   where id = v_message;

  v_caught := false;

  begin
    perform pg_temp._p9_66_create_v2('processing');
  exception
    when sqlstate '23514' then
      if sqlerrm =
        'ZION_SALES_QUOTE_VERSION_EXTERNAL_SEND_IN_FLIGHT_OR_REQUIRES_RECONCILIATION' then
        v_caught := true;
      end if;
  end;

  select current_version_id
    into v_current
    from public.sales_quotes
   where id = fixture.quote_id;

  perform pg_temp._p9_66_record(
    6,
    'processing sem attempt serializa criacao de nova versao',
    case
      when v_caught
       and v_current = fixture.version_id
      then 'PASS'
      else 'SUT_FAIL'
    end,
    pg_catalog.format(
      'caught=%s current=%s',
      v_caught,
      v_current
    )
  );

  -- --------------------------------------------------------------------------
  -- 7. Failed before any provider attempt does NOT permanently freeze revision.
  -- --------------------------------------------------------------------------
  select * into fixture
    from pg_temp._p9_66_fixture
   where label = 'failed_pre';

  v_message := pg_temp._p9_66_materialize('failed_pre');

  update public.messages
     set outbound_delivery_state = 'failed',
         outbound_claimed_at = null,
         outbound_claimed_by = null,
         outbound_attempt_started_at = null,
         outbound_uncertain_at = null,
         outbound_provider_accepted_at = null,
         external_message_id = null,
         outbound_error_text = 'runner deterministic pre-attempt failure'
   where id = v_message;

  v_version_2 := pg_temp._p9_66_create_v2('failed_pre');

  select current_version_id
    into v_current
    from public.sales_quotes
   where id = fixture.quote_id;

  perform pg_temp._p9_66_record(
    7,
    'failed pre-attempt libera nova versao',
    case
      when v_version_2 is not null
       and v_current = v_version_2
      then 'PASS'
      else 'SUT_FAIL'
    end,
    pg_catalog.format(
      'v2=%s current=%s',
      v_version_2,
      v_current
    )
  );

  -- --------------------------------------------------------------------------
  -- 8. Failed retaining attempt evidence remains reconciliation-blocked.
  -- --------------------------------------------------------------------------
  select * into fixture
    from pg_temp._p9_66_fixture
   where label = 'failed_post';

  v_message := pg_temp._p9_66_materialize('failed_post');

  update public.messages
     set outbound_delivery_state = 'failed',
         outbound_claimed_at = null,
         outbound_claimed_by = null,
         outbound_attempt_started_at = clock_timestamp(),
         outbound_uncertain_at = clock_timestamp(),
         outbound_error_text = 'runner failure after attempt'
   where id = v_message;

  v_caught := false;

  begin
    perform pg_temp._p9_66_create_v2('failed_post');
  exception
    when sqlstate '23514' then
      if sqlerrm =
        'ZION_SALES_QUOTE_VERSION_EXTERNAL_SEND_IN_FLIGHT_OR_REQUIRES_RECONCILIATION' then
        v_caught := true;
      end if;
  end;

  perform pg_temp._p9_66_record(
    8,
    'failed com attempt evidence continua bloqueado para reconciliacao',
    case when v_caught then 'PASS' else 'SUT_FAIL' end,
    'attempt_started_at is historical evidence and cannot be bypassed'
  );

  -- --------------------------------------------------------------------------
  -- 9. Provider acceptance / sent evidence blocks revision even before
  --    commercial finalization.
  -- --------------------------------------------------------------------------
  select * into fixture
    from pg_temp._p9_66_fixture
   where label = 'provider_sent';

  v_message := pg_temp._p9_66_materialize('provider_sent');

  update public.messages
     set outbound_delivery_state = 'sent',
         outbound_claimed_at = null,
         outbound_claimed_by = null,
         outbound_attempt_started_at = clock_timestamp() - interval '1 second',
         outbound_uncertain_at = clock_timestamp() - interval '1 second',
         outbound_provider_accepted_at = clock_timestamp(),
         external_message_id = 'wamid-p9-6-6-provider-sent'
   where id = v_message;

  v_caught := false;

  begin
    perform pg_temp._p9_66_create_v2('provider_sent');
  exception
    when sqlstate '23514' then
      if sqlerrm =
        'ZION_SALES_QUOTE_VERSION_EXTERNAL_SEND_IN_FLIGHT_OR_REQUIRES_RECONCILIATION' then
        v_caught := true;
      end if;
  end;

  perform pg_temp._p9_66_record(
    9,
    'provider accepted/sent impede revisao concorrente',
    case when v_caught then 'PASS' else 'SUT_FAIL' end,
    'provider fact wins even before downstream commercial finalization'
  );

  -- --------------------------------------------------------------------------
  -- 10. Expiration is re-read after queueing and before provider POST.
  -- --------------------------------------------------------------------------
  select * into fixture
    from pg_temp._p9_66_fixture
   where label = 'expiration';

  v_message := pg_temp._p9_66_materialize('expiration');

  update public.sales_quotes
     set valid_until = (now() at time zone 'UTC')::date - 1
   where id = fixture.quote_id;

  update public.messages
     set outbound_delivery_state = 'processing',
         outbound_claimed_at = clock_timestamp(),
         outbound_claimed_by = 'p9-6.6-runner'
   where id = v_message;

  select *
    into v_exec
    from pg_temp._p9_66_exec_json(
      'service_role',
      pg_catalog.format(
        'select public.validate_or_cancel_whatsapp_external_send_v2_by_system(%L::uuid,%L::uuid,%L::uuid)::text',
        ctx.org_id,
        ctx.store_id,
        v_message
      )
    );

  select outbound_delivery_state, outbound_attempt_started_at
    into v_state, v_attempt
    from public.messages
   where id = v_message;

  perform pg_temp._p9_66_record(
    10,
    'expiracao surgida apos queue bloqueia antes do provider',
    case
      when v_exec.operation_succeeded
       and v_exec.value_json ->> 'decision' = 'blocked'
       and v_exec.value_json ->> 'reason' = 'sales_quote_send_version_expired'
       and v_state = 'failed'
       and v_attempt is null
      then 'PASS'
      else 'SUT_FAIL'
    end,
    pg_catalog.format(
      'result=%s state=%s',
      coalesce(v_exec.value_json::text, '<null>'),
      coalesce(v_state, '<null>')
    )
  );

  -- --------------------------------------------------------------------------
  -- 11. Exact idempotency identity mismatch fails closed pre-provider.
  -- --------------------------------------------------------------------------
  select * into fixture
    from pg_temp._p9_66_fixture
   where label = 'identity';

  v_message := pg_temp._p9_66_materialize('identity');

  update public.messages
     set outbound_delivery_state = 'processing',
         outbound_claimed_at = clock_timestamp(),
         outbound_claimed_by = 'p9-6.6-runner',
         outbound_idempotency_key =
           pg_temp._p9_66_key('identity') || ':tampered'
   where id = v_message;

  select *
    into v_exec
    from pg_temp._p9_66_exec_json(
      'service_role',
      pg_catalog.format(
        'select public.validate_or_cancel_whatsapp_external_send_v2_by_system(%L::uuid,%L::uuid,%L::uuid)::text',
        ctx.org_id,
        ctx.store_id,
        v_message
      )
    );

  select outbound_delivery_state, outbound_attempt_started_at
    into v_state, v_attempt
    from public.messages
   where id = v_message;

  perform pg_temp._p9_66_record(
    11,
    'idempotency/version identity divergente falha fechado',
    case
      when v_exec.operation_succeeded
       and v_exec.value_json ->> 'decision' = 'blocked'
       and v_exec.value_json ->> 'reason' =
             'sales_quote_send_idempotency_identity_mismatch'
       and v_state = 'failed'
       and v_attempt is null
      then 'PASS'
      else 'SUT_FAIL'
    end,
    pg_catalog.format(
      'result=%s state=%s',
      coalesce(v_exec.value_json::text, '<null>'),
      coalesce(v_state, '<null>')
    )
  );

  -- --------------------------------------------------------------------------
  -- 12. Non-quote human/manual outbound remains delegated to canonical gate.
  -- --------------------------------------------------------------------------
  select *
    into v_manual_message
    from public.insert_message(
      ctx.conversation_id,
      'human',
      'outgoing',
      'text',
      'P9 6.6 manual non-quote transport',
      null,
      null,
      pg_catalog.jsonb_build_object(
        'source', 'p9_6_6_manual_runner',
        'external_channel', 'whatsapp',
        'send_external', true,
        'outbound_origin', 'manual_runner'
      )
    );

  v_manual_key := 'p9_6_6_manual:' || v_manual_message.id::text;

  update public.messages
     set outbound_idempotency_key = v_manual_key,
         outbound_delivery_state = 'processing',
         outbound_claimed_at = clock_timestamp(),
         outbound_claimed_by = 'p9-6.6-runner',
         outbound_attempt_started_at = null,
         outbound_uncertain_at = null
   where id = v_manual_message.id;

  select *
    into v_exec
    from pg_temp._p9_66_exec_json(
      'service_role',
      pg_catalog.format(
        'select public.validate_or_cancel_whatsapp_external_send_v2_by_system(%L::uuid,%L::uuid,%L::uuid)::text',
        ctx.org_id,
        ctx.store_id,
        v_manual_message.id
      )
    );

  select outbound_delivery_state, outbound_attempt_started_at
    into v_state, v_attempt
    from public.messages
   where id = v_manual_message.id;

  perform pg_temp._p9_66_record(
    12,
    'non-quote continua delegado ao gate canonico sem regressao',
    case
      when v_exec.operation_succeeded
       and v_exec.value_json ->> 'decision' = 'send'
       and v_state = 'uncertain'
       and v_attempt is not null
      then 'PASS'
      else 'SUT_FAIL'
    end,
    pg_catalog.format(
      'result=%s state=%s attempt=%s',
      coalesce(v_exec.value_json::text, '<null>'),
      coalesce(v_state, '<null>'),
      coalesce(v_attempt::text, '<null>')
    )
  );

  -- --------------------------------------------------------------------------
  -- 13. Final gate remains explicitly wired to mutable quote-kind readiness.
  --     The canonical reader has its own dedicated behavioral suite; 6.6 proves
  --     that the provider boundary consumes it rather than trusting queue-time
  --     readiness.
  -- --------------------------------------------------------------------------
  select pg_catalog.pg_get_functiondef(
    'public.validate_or_cancel_whatsapp_external_send_v2_by_system(uuid,uuid,uuid)'::regprocedure
  )
  into v_definition;

  perform pg_temp._p9_66_record(
    13,
    'final boundary reconsome readiness canonica de quote kind',
    case
      when pg_catalog.strpos(
             v_definition,
             'read_quote_kind_send_readiness_scoped'
           ) > 0
       and pg_catalog.strpos(
             v_definition,
             'sales_quote_send_quote_kind_not_ready'
           ) > 0
       and pg_catalog.strpos(
             v_definition,
             'sales_quote_version_is_expired'
           ) > 0
       and pg_catalog.strpos(
             v_definition,
             'validate_or_cancel_whatsapp_external_send_by_system'
           ) > 0
      then 'PASS'
      else 'SUT_FAIL'
    end,
    'readiness + expiration + canonical transport delegate are all present'
  );

  -- --------------------------------------------------------------------------
  -- 14. Lock ordering contract.
  --
  -- Initial message identity discovery is intentionally unlocked. Once the
  -- exact sales_quote_send key is known, the mutating boundary must follow:
  --
  -- advisory operation -> quote -> version -> conversation -> fresh message.
  -- --------------------------------------------------------------------------
  perform pg_temp._p9_66_record(
    14,
    'gate v2 preserva ordem canonica de locks do envio',
    case
      when pg_catalog.strpos(
             v_definition,
             'pg_advisory_xact_lock'
           ) > 0
       and pg_catalog.strpos(
             v_definition,
             'from public.sales_quotes quote_row'
           ) > pg_catalog.strpos(
             v_definition,
             'pg_advisory_xact_lock'
           )
       and pg_catalog.strpos(
             v_definition,
             'from public.sales_quote_versions version_row'
           ) > pg_catalog.strpos(
             v_definition,
             'from public.sales_quotes quote_row'
           )
       and pg_catalog.strpos(
             v_definition,
             'private_acquire_sales_contract_conversation_xact_lock'
           ) > pg_catalog.strpos(
             v_definition,
             'from public.sales_quote_versions version_row'
           )
       and pg_catalog.strpos(
             v_definition,
             'into v_fresh_message'
           ) > pg_catalog.strpos(
             v_definition,
             'private_acquire_sales_contract_conversation_xact_lock'
           )
      then 'PASS'
      else 'SUT_FAIL'
    end,
    'expected=advisory->quote->version->conversation->fresh_message'
  );

  -- --------------------------------------------------------------------------
  -- 15. Coverage count.
  -- --------------------------------------------------------------------------
  select count(*)
    into v_count
    from pg_temp._p9_66_results;

  perform pg_temp._p9_66_record(
    15,
    'runner registra cobertura minima da linearizacao pre-provider',
    case when v_count >= 14 then 'PASS' else 'SUT_FAIL' end,
    'recorded_before_coverage=' || v_count::text
  );
end;
$scenarios$;


-- ============================================================================
-- Results + fail closed
-- ============================================================================

select *
from pg_temp._p9_66_results
order by scenario;

do $assertions$
declare
  v_failures integer;
  v_details text;
begin
  select count(*)
    into v_failures
    from pg_temp._p9_66_results
   where status <> 'PASS';

  if v_failures > 0 then
    select string_agg(
      scenario::text || ':' || name || ' => ' ||
      coalesce(detail, '<no detail>'),
      E'\n'
      order by scenario
    )
      into v_details
      from pg_temp._p9_66_results
     where status <> 'PASS';

    raise exception using
      errcode = 'P0001',
      message = 'P9 6.6 pre-provider linearization runner failed',
      detail = v_details;
  end if;
end;
$assertions$;

rollback;
begin;

set transaction isolation level repeatable read;
set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, public, pg_temp, auth, extensions;

create temp table pg_temp._p9_cross_sell_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;

create temp table pg_temp._p9_cross_sell_ctx (
  singleton boolean primary key default true check (singleton),
  org_a uuid not null,
  org_b uuid not null,
  store_a uuid not null,
  store_b uuid not null,
  user_a uuid not null,
  customer_a uuid not null,
  lead_a uuid not null,
  conversation_a uuid not null,
  conversation_b uuid not null,
  opp_a uuid not null,
  opp_b uuid not null,
  pool_base uuid not null,
  pool_cross uuid not null,
  pool_other uuid not null,
  catalog_a uuid not null,
  catalog_stale uuid not null,
  catalog_other uuid not null,
  suggestion_msg_a1 uuid not null,
  suggestion_msg_a2 uuid not null,
  suggestion_msg_a3 uuid not null,
  suggestion_msg_b uuid not null,
  evidence_msg_a uuid not null,
  evidence_msg_b uuid not null,
  early_msg_a uuid not null,
  quote_a uuid not null,
  quote_b uuid not null
) on commit preserve rows;

insert into pg_temp._p9_cross_sell_ctx (
  org_a, org_b, store_a, store_b, user_a, customer_a, lead_a,
  conversation_a, conversation_b, opp_a, opp_b,
  pool_base, pool_cross, pool_other,
  catalog_a, catalog_stale, catalog_other,
  suggestion_msg_a1, suggestion_msg_a2, suggestion_msg_a3, suggestion_msg_b,
  evidence_msg_a, evidence_msg_b, early_msg_a,
  quote_a, quote_b
)
values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid()
);

create or replace function pg_temp._p9_cross_sell_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text default null
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_cross_sell_results (
    scenario_number, scenario_name, status, detail
  )
  values (
    p_scenario_number, p_scenario_name, p_status, coalesce(p_detail, '<null>')
  )
  on conflict (scenario_number) do update
  set scenario_name = excluded.scenario_name,
      status = excluded.status,
      detail = excluded.detail;
end;
$function$;

create or replace function pg_temp._p9_cross_sell_exec_json(
  p_role text,
  p_user_id uuid,
  p_sql text
)
returns table (
  operation_succeeded boolean,
  value_json jsonb,
  returned_sqlstate text,
  message_text text,
  constraint_name text
)
language plpgsql
as $function$
declare
  v_value jsonb;
  v_state text;
  v_message text;
  v_constraint text;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    return query
    select false, null::jsonb, null::text, 'runner helper must start as postgres'::text, null::text;
    return;
  end if;

  if p_role <> 'postgres' then
    perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
    perform set_config('request.jwt.claim.role', p_role, true);
    perform set_config(
      'request.jwt.claims',
      pg_catalog.jsonb_build_object(
        'sub', coalesce(p_user_id::text, ''),
        'role', p_role
      )::text,
      true
    );
    execute pg_catalog.format('set local role %I', p_role);
  end if;

  begin
    execute pg_catalog.format(
      'select to_jsonb(result_row) from (%s) result_row',
      p_sql
    )
    into v_value;

    if p_role <> 'postgres' then
      execute 'reset role';
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.role', '', true);
      perform set_config('request.jwt.claims', '', true);
    end if;

    return query
    select true, v_value, null::text, null::text, null::text;
  exception when others then
    get stacked diagnostics
      v_state = returned_sqlstate,
      v_message = message_text,
      v_constraint = constraint_name;

    if p_role <> 'postgres' then
      begin execute 'reset role'; exception when others then null; end;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.role', '', true);
      perform set_config('request.jwt.claims', '', true);
    end if;

    return query
    select false, null::jsonb, v_state, v_message, v_constraint;
  end;
exception when others then
  begin execute 'reset role'; exception when others then null; end;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
  return query
  select false, null::jsonb, sqlstate::text, ('runner helper error: ' || sqlerrm)::text, null::text;
end;
$function$;

create or replace function pg_temp._p9_cross_sell_expect_fail(
  p_scenario_number integer,
  p_scenario_name text,
  p_role text,
  p_user_id uuid,
  p_sql text,
  p_expected_message text
)
returns void
language plpgsql
as $function$
declare
  v_result record;
begin
  select *
  into v_result
  from pg_temp._p9_cross_sell_exec_json(p_role, p_user_id, p_sql);

  if v_result.operation_succeeded then
    perform pg_temp._p9_cross_sell_record(
      p_scenario_number,
      p_scenario_name,
      'SUT_FAIL',
      'operation succeeded but failure was expected'
    );
    return;
  end if;

  if coalesce(v_result.message_text, '') ilike '%' || p_expected_message || '%'
     or coalesce(v_result.constraint_name, '') ilike '%' || p_expected_message || '%' then
    perform pg_temp._p9_cross_sell_record(
      p_scenario_number,
      p_scenario_name,
      'PASS',
      coalesce(v_result.constraint_name, v_result.message_text, 'failed as expected')
    );
  else
    perform pg_temp._p9_cross_sell_record(
      p_scenario_number,
      p_scenario_name,
      'SUT_FAIL',
      'unexpected failure: ' || coalesce(v_result.message_text, '<null>') ||
      ' [constraint=' || coalesce(v_result.constraint_name, '<null>') || ']'
    );
  end if;
end;
$function$;

create or replace function pg_temp._p9_cross_sell_empty_intents()
returns jsonb
language sql
immutable
as $function$
  select '[]'::jsonb;
$function$;

do $fixtures$
declare
  ctx pg_temp._p9_cross_sell_ctx%rowtype;
begin
  select * into ctx from pg_temp._p9_cross_sell_ctx where singleton;

  insert into auth.users(id)
  values (ctx.user_a);

  insert into public.organizations (id, name, subscription_status)
  values
    (ctx.org_a, 'P9 6.1-C Org A', 'active'),
    (ctx.org_b, 'P9 6.1-C Org B', 'active');

  insert into public.stores (id, organization_id, name)
  values
    (ctx.store_a, ctx.org_a, 'P9 6.1-C Store A'),
    (ctx.store_b, ctx.org_b, 'P9 6.1-C Store B');

  insert into public.memberships (organization_id, user_id, role, is_active)
  values (ctx.org_a, ctx.user_a, 'admin', true);

  insert into public.customers (id, organization_id, display_name)
  values (ctx.customer_a, ctx.org_a, 'P9 Cross Sell Customer');

  insert into public.customer_store_links (organization_id, store_id, customer_id)
  values (ctx.org_a, ctx.store_a, ctx.customer_a);

  insert into public.leads (
    id, organization_id, store_id, name, phone, state, created_at, updated_at
  )
  values (
    ctx.lead_a, ctx.org_a, ctx.store_a,
    'P9 Cross Sell Lead', '+55000000000', 'negociacao', now(), now()
  );

  insert into public.conversations (
    id, organization_id, lead_id, status, is_human_active, created_at
  )
  values
    (ctx.conversation_a, ctx.org_a, ctx.lead_a, 'open', false, now()),
    (ctx.conversation_b, ctx.org_a, ctx.lead_a, 'open', false, now());

  insert into public.commercial_opportunities (
    id, organization_id, store_id, customer_id,
    origin_lead_id, primary_conversation_id, stage
  )
  values
    (
      ctx.opp_a, ctx.org_a, ctx.store_a, ctx.customer_a,
      ctx.lead_a, ctx.conversation_a, 'orcamento'
    ),
    (
      ctx.opp_b, ctx.org_a, ctx.store_a, ctx.customer_a,
      ctx.lead_a, ctx.conversation_b, 'orcamento'
    );

  insert into public.pools (
    id, organization_id, store_id, name,
    width_m, length_m, depth_m, shape, material,
    max_capacity_l, weight_kg, price, price_status,
    description, is_active, track_stock, stock_quantity, stock_status
  )
  values
    (
      ctx.pool_base, ctx.org_a, ctx.store_a, 'Piscina Base',
      2, 3, 1, 'retangular', 'fibra',
      1000, 120, 1234.56, 'valid',
      'Pool already in Profile A', true, false, null, 'not_tracked'
    ),
    (
      ctx.pool_cross, ctx.org_a, ctx.store_a, 'Piscina Cross Sell',
      2, 4, 1, 'retangular', 'fibra',
      1500, 150, 2234.56, 'valid',
      'Pool accepted as cross sell', true, false, null, 'not_tracked'
    ),
    (
      ctx.pool_other, ctx.org_b, ctx.store_b, 'Piscina Outro Escopo',
      2, 3, 1, 'retangular', 'fibra',
      1000, 120, 1234.56, 'valid',
      'Other scope', true, false, null, 'not_tracked'
    );

  insert into public.store_catalog_items (
    id, organization_id, store_id, sku, name, description,
    price_cents, price_status, currency, is_active,
    track_stock, stock_quantity, stock_status, metadata
  )
  values
    (
      ctx.catalog_a, ctx.org_a, ctx.store_a,
      'CS-A', 'Capa termica', 'Capa',
      150000, 'valid', 'BRL', true,
      false, null, 'not_tracked', '{}'::jsonb
    ),
    (
      ctx.catalog_stale, ctx.org_a, ctx.store_a,
      'CS-ST', 'Item que ficara inativo', 'Stale candidate',
      21000, 'valid', 'BRL', true,
      false, null, 'not_tracked', '{}'::jsonb
    ),
    (
      ctx.catalog_other, ctx.org_b, ctx.store_b,
      'CS-OTHER', 'Outro item', 'Other scope',
      90000, 'valid', 'BRL', true,
      false, null, 'not_tracked', '{}'::jsonb
    );

  perform set_config('app.insert_via_function', 'true', true);

  insert into public.messages (
    id, organization_id, store_id, lead_id, conversation_id,
    sender, direction, message_type, content, metadata, created_at
  )
  values
    (
      ctx.early_msg_a, ctx.org_a, ctx.store_a, ctx.lead_a, ctx.conversation_a,
      'user', 'incoming', 'text', 'sim antes',
      '{}'::jsonb, '2026-09-19 10:00:00+00'
    ),
    (
      ctx.suggestion_msg_a1, ctx.org_a, ctx.store_a, ctx.lead_a, ctx.conversation_a,
      'ai', 'outgoing', 'text', 'Sugestao A1',
      '{}'::jsonb, '2026-09-19 10:01:00+00'
    ),
    (
      ctx.suggestion_msg_a2, ctx.org_a, ctx.store_a, ctx.lead_a, ctx.conversation_a,
      'ai', 'outgoing', 'text', 'Sugestao A2',
      '{}'::jsonb, '2026-09-19 10:02:00+00'
    ),
    (
      ctx.suggestion_msg_a3, ctx.org_a, ctx.store_a, ctx.lead_a, ctx.conversation_a,
      'ai', 'outgoing', 'text', 'Sugestao A3',
      '{}'::jsonb, '2026-09-19 10:03:00+00'
    ),
    (
      ctx.suggestion_msg_b, ctx.org_a, ctx.store_a, ctx.lead_a, ctx.conversation_b,
      'ai', 'outgoing', 'text', 'Sugestao B',
      '{}'::jsonb, '2026-09-19 10:04:00+00'
    ),
    (
      ctx.evidence_msg_a, ctx.org_a, ctx.store_a, ctx.lead_a, ctx.conversation_a,
      'user', 'incoming', 'text', 'quero esse complemento',
      '{}'::jsonb, '2026-09-19 10:05:00+00'
    ),
    (
      ctx.evidence_msg_b, ctx.org_a, ctx.store_a, ctx.lead_a, ctx.conversation_b,
      'user', 'incoming', 'text', 'sim, quero',
      '{}'::jsonb, '2026-09-19 10:06:00+00'
    );

  perform set_config('app.insert_via_function', '', true);

  insert into public.sales_quotes (
    id, organization_id, store_id, commercial_opportunity_id,
    conversation_id, lead_id, quote_number, title, status,
    customer_name, customer_phone, customer_notes, internal_notes,
    subtotal_cents, discount_cents, total_cents, current_version_id, metadata
  )
  values
    (
      ctx.quote_a, ctx.org_a, ctx.store_a, ctx.opp_a,
      ctx.conversation_a, ctx.lead_a, 'P9-6-1-C-A',
      'Quote A before cross sell', 'draft',
      'P9 Customer', '+55000000000', null, null,
      0, 0, 0, null, '{}'::jsonb
    ),
    (
      ctx.quote_b, ctx.org_a, ctx.store_a, ctx.opp_b,
      ctx.conversation_b, ctx.lead_a, 'P9-6-1-C-B',
      'Quote B for materialization', 'draft',
      'P9 Customer', '+55000000000', null, null,
      0, 0, 0, null, '{}'::jsonb
    );
end;
$fixtures$;

do $scenarios$
declare
  ctx pg_temp._p9_cross_sell_ctx%rowtype;
  r record;
  q text;
  v_suggestion_pool uuid;
  v_suggestion_catalog uuid;
  v_suggestion_stale uuid;
  v_suggestion_rejected uuid;
  v_suggestion_superseded uuid;
  v_suggestion_pool_b uuid;
  v_profile_a_before uuid;
  v_profile_a_after_catalog uuid;
  v_profile_b_before uuid;
  v_profile_b_after uuid;
  v_profile_before_fail uuid;
  v_profile_after_fail uuid;
  v_service_origin_b uuid;
  v_component_id uuid;
  v_count integer;
  v_count_2 integer;
  v_quote_count integer;
  v_ok boolean;
  v_value jsonb;
  v_function_record text;
  v_function_status text;
  v_function_accept text;
  v_function_single text;
  v_config text[];
begin
  select * into ctx from pg_temp._p9_cross_sell_ctx where singleton;

  -- 1. Baseline Profile A (pool) and Profile B (human-authorized service).
  q := pg_catalog.format(
    $sql$
      select *
      from public.write_commercial_opportunity_profile_by_user(
        %L::uuid,%L::uuid,%L::uuid,
        'p9-6-1-c-base-a',%L,'resolved',
        %L::jsonb,%L::jsonb,'manual_check','{}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, repeat('1', 64),
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'component_key','base_pool',
        'component_kind','pool',
        'component_state','resolved',
        'pool_id',ctx.pool_base
      )
    )::text,
    pg_temp._p9_cross_sell_empty_intents()::text
  );

  select * into r
  from pg_temp._p9_cross_sell_exec_json('authenticated', ctx.user_a, q);

  if not r.operation_succeeded then
    perform pg_temp._p9_cross_sell_record(
      1, 'baseline Profiles exist before cross-sell acceptance',
      'SUT_FAIL', coalesce(r.message_text, '<null>')
    );
  else
    v_profile_a_before := (r.value_json ->> 'profile_version_id')::uuid;

    q := pg_catalog.format(
      $sql$
        select *
        from public.write_commercial_opportunity_profile_by_user(
          %L::uuid,%L::uuid,%L::uuid,
          'p9-6-1-c-base-b',%L,'resolved',
          %L::jsonb,%L::jsonb,'manual_check','{}'::jsonb
        )
      $sql$,
      ctx.org_a, ctx.store_a, ctx.opp_b, repeat('2', 64),
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'component_key','service_authorized',
          'component_kind','service',
          'component_state','resolved',
          'reference_text','Servico definido pelo humano',
          'quote_item_name','Servico humano preservado',
          'quote_item_description','Descricao humana',
          'quote_item_quantity',2,
          'quote_item_unit_price_cents',1500,
          'quote_terms_authority_type','human',
          'quote_terms_authority_user_id',ctx.user_a
        )
      )::text,
      pg_temp._p9_cross_sell_empty_intents()::text
    );

    select * into r
    from pg_temp._p9_cross_sell_exec_json('authenticated', ctx.user_a, q);

    if not r.operation_succeeded then
      perform pg_temp._p9_cross_sell_record(
        1, 'baseline Profiles exist before cross-sell acceptance',
        'SUT_FAIL', coalesce(r.message_text, '<null>')
      );
    else
      v_profile_b_before := (r.value_json ->> 'profile_version_id')::uuid;

      select component_row.id
      into v_service_origin_b
      from public.commercial_opportunity_profile_components component_row
      where component_row.profile_version_id = v_profile_b_before
        and component_row.component_key = 'service_authorized';

      perform pg_temp._p9_cross_sell_record(
        1,
        'baseline Profiles exist before cross-sell acceptance',
        case
          when v_profile_a_before is not null
           and v_profile_b_before is not null
           and v_service_origin_b is not null
          then 'PASS' else 'SUT_FAIL'
        end,
        pg_catalog.format(
          'profile_a=%s profile_b=%s service_origin=%s',
          v_profile_a_before, v_profile_b_before, v_service_origin_b
        )
      );
    end if;
  end if;

  -- 2. Valid pool suggestion.
  q := pg_catalog.format(
    $sql$
      select *
      from public.record_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'pool',%L::uuid,null,
        'p9-6-1-c-suggest-pool',%L,'{}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, ctx.conversation_a, ctx.suggestion_msg_a1,
    ctx.pool_base, repeat('3', 64)
  );
  select * into r
  from pg_temp._p9_cross_sell_exec_json('service_role', null, q);
  if r.operation_succeeded then
    v_suggestion_pool := (r.value_json ->> 'suggestion_id')::uuid;
  end if;
  perform pg_temp._p9_cross_sell_record(
    2, 'pool suggestion is recorded against an exact outbound AI message',
    case when r.operation_succeeded and v_suggestion_pool is not null then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.message_text, r.value_json::text, '<null>')
  );

  -- 3. Valid catalog suggestion.
  q := pg_catalog.format(
    $sql$
      select *
      from public.record_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'catalog_item',null,%L::uuid,
        'p9-6-1-c-suggest-catalog',%L,'{"suggestion":"catalog"}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, ctx.conversation_a, ctx.suggestion_msg_a2,
    ctx.catalog_a, repeat('4', 64)
  );
  select * into r
  from pg_temp._p9_cross_sell_exec_json('service_role', null, q);
  if r.operation_succeeded then
    v_suggestion_catalog := (r.value_json ->> 'suggestion_id')::uuid;
  end if;
  perform pg_temp._p9_cross_sell_record(
    3, 'catalog suggestion is recorded against an exact outbound AI message',
    case when r.operation_succeeded and v_suggestion_catalog is not null then 'PASS' else 'SUT_FAIL' end,
    coalesce(r.message_text, r.value_json::text, '<null>')
  );

  -- 4. Suggestion replay returns same row.
  select * into r
  from pg_temp._p9_cross_sell_exec_json('service_role', null, q);
  perform pg_temp._p9_cross_sell_record(
    4, 'suggestion replay is idempotent',
    case
      when r.operation_succeeded
       and (r.value_json ->> 'suggestion_id')::uuid = v_suggestion_catalog
       and (r.value_json ->> 'replayed')::boolean
      then 'PASS' else 'SUT_FAIL'
    end,
    coalesce(r.message_text, r.value_json::text, '<null>')
  );

  -- 5. Pool outside tenant/store is rejected.
  q := pg_catalog.format(
    $sql$
      select *
      from public.record_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'pool',%L::uuid,null,'pool-other-scope',%L,'{}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, ctx.conversation_a, ctx.suggestion_msg_a1,
    ctx.pool_other, repeat('5', 64)
  );
  perform pg_temp._p9_cross_sell_expect_fail(
    5, 'pool candidate outside tenant/store fails closed',
    'service_role', null, q, 'POOL_SCOPE_INVALID'
  );

  -- 6. Catalog outside tenant/store is rejected.
  q := pg_catalog.format(
    $sql$
      select *
      from public.record_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'catalog_item',null,%L::uuid,'catalog-other-scope',%L,'{}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, ctx.conversation_a, ctx.suggestion_msg_a1,
    ctx.catalog_other, repeat('6', 64)
  );
  perform pg_temp._p9_cross_sell_expect_fail(
    6, 'catalog candidate outside tenant/store fails closed',
    'service_role', null, q, 'CATALOG_ITEM_SCOPE_INVALID'
  );

  -- 7. Automatic service candidate is unsupported.
  q := pg_catalog.format(
    $sql$
      select *
      from public.record_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'service',null,null,'service-not-supported',%L,'{}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, ctx.conversation_a, ctx.suggestion_msg_a1,
    repeat('7', 64)
  );
  perform pg_temp._p9_cross_sell_expect_fail(
    7, 'automatic service cross-sell is rejected',
    'service_role', null, q, 'CANDIDATE_KIND_INVALID'
  );

  -- 8. Automatic custom candidate is unsupported.
  q := replace(q, '''service''', '''custom''');
  q := replace(q, 'service-not-supported', 'custom-not-supported');
  perform pg_temp._p9_cross_sell_expect_fail(
    8, 'automatic custom cross-sell is rejected',
    'service_role', null, q, 'CANDIDATE_KIND_INVALID'
  );

  -- 9. Opportunity primary conversation is authoritative.
  q := pg_catalog.format(
    $sql$
      select *
      from public.record_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'catalog_item',null,%L::uuid,'wrong-primary-conversation',%L,'{}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, ctx.conversation_b, ctx.suggestion_msg_b,
    ctx.catalog_a, repeat('8', 64)
  );
  perform pg_temp._p9_cross_sell_expect_fail(
    9, 'suggestion conversation must equal opportunity primary conversation',
    'service_role', null, q, 'CONVERSATION_NOT_OPPORTUNITY_PRIMARY'
  );

  -- 10. Message must belong to the exact conversation.
  q := pg_catalog.format(
    $sql$
      select *
      from public.record_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'catalog_item',null,%L::uuid,'wrong-message-conversation',%L,'{}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, ctx.conversation_a, ctx.suggestion_msg_b,
    ctx.catalog_a, repeat('9', 64)
  );
  perform pg_temp._p9_cross_sell_expect_fail(
    10, 'suggestion message outside the exact conversation fails closed',
    'service_role', null, q, 'SUGGESTION_MESSAGE_SCOPE_INVALID'
  );

  -- 11. Inbound user message cannot masquerade as suggestion message.
  q := pg_catalog.format(
    $sql$
      select *
      from public.record_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'catalog_item',null,%L::uuid,'not-ai-outbound',%L,'{}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, ctx.conversation_a, ctx.evidence_msg_a,
    ctx.catalog_a, repeat('a', 64)
  );
  perform pg_temp._p9_cross_sell_expect_fail(
    11, 'suggestion message must be AI outbound',
    'service_role', null, q, 'SUGGESTION_MESSAGE_NOT_AI_OUTBOUND'
  );

  -- 12. Metadata cannot invent missing candidate identity.
  q := pg_catalog.format(
    $sql$
      select *
      from public.record_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'pool',null,null,'metadata-cannot-invent',%L,
        %L::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, ctx.conversation_a, ctx.suggestion_msg_a1,
    repeat('b', 64),
    pg_catalog.jsonb_build_object('pool_id', ctx.pool_base)::text
  );
  perform pg_temp._p9_cross_sell_expect_fail(
    12, 'metadata cannot invent candidate identity',
    'service_role', null, q, 'CANDIDATE_SHAPE_INVALID'
  );

  -- 13. Same suggestion operation key with different payload fails.
  q := pg_catalog.format(
    $sql$
      select *
      from public.record_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'catalog_item',null,%L::uuid,
        'p9-6-1-c-suggest-pool',%L,'{}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, ctx.conversation_a, ctx.suggestion_msg_a1,
    ctx.catalog_a, repeat('c', 64)
  );
  perform pg_temp._p9_cross_sell_expect_fail(
    13, 'suggestion operation key cannot be reused with different payload',
    'service_role', null, q, 'SUGGESTION_OPERATION_KEY_REUSED'
  );

  -- 14. Evidence must be after suggestion.
  q := pg_catalog.format(
    $sql$
      select *
      from public.accept_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'early-evidence',%L,'{}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, v_suggestion_pool, ctx.early_msg_a,
    repeat('d', 64)
  );
  perform pg_temp._p9_cross_sell_expect_fail(
    14, 'customer evidence before suggestion fails closed',
    'service_role', null, q, 'EVIDENCE_NOT_AFTER_SUGGESTION'
  );

  -- 15. Evidence must be in exact conversation.
  q := pg_catalog.format(
    $sql$
      select *
      from public.accept_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'wrong-evidence-conversation',%L,'{}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, v_suggestion_pool, ctx.evidence_msg_b,
    repeat('e', 64)
  );
  perform pg_temp._p9_cross_sell_expect_fail(
    15, 'customer evidence outside suggestion conversation fails closed',
    'service_role', null, q, 'EVIDENCE_MESSAGE_INVALID'
  );

  -- 16. Acceptance is tenant/store/opportunity scoped.
  q := pg_catalog.format(
    $sql$
      select *
      from public.accept_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'wrong-scope-accept',%L,'{}'::jsonb
      )
    $sql$,
    ctx.org_b, ctx.store_b, ctx.opp_a, v_suggestion_pool, ctx.evidence_msg_a,
    repeat('f', 64)
  );
  perform pg_temp._p9_cross_sell_expect_fail(
    16, 'acceptance tenant/store/opportunity mismatch fails closed',
    'service_role', null, q, 'SUGGESTION_SCOPE_INVALID'
  );

  -- 17. Explicit catalog acceptance appends Profile.
  q := pg_catalog.format(
    $sql$
      select *
      from public.accept_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'p9-6-1-c-accept-catalog',%L,%L::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, v_suggestion_catalog, ctx.evidence_msg_a,
    repeat('0', 64),
    '{"proof":"explicit-catalog"}'
  );
  select * into r
  from pg_temp._p9_cross_sell_exec_json('service_role', null, q);
  if r.operation_succeeded then
    v_profile_a_after_catalog := (r.value_json ->> 'accepted_profile_version_id')::uuid;
    v_component_id := (r.value_json ->> 'accepted_profile_component_id')::uuid;
  end if;
  perform pg_temp._p9_cross_sell_record(
    17, 'explicit catalog acceptance appends a new Profile version',
    case
      when r.operation_succeeded
       and (r.value_json ->> 'profile_changed')::boolean
       and v_profile_a_after_catalog is distinct from v_profile_a_before
      then 'PASS' else 'SUT_FAIL'
    end,
    coalesce(r.message_text, r.value_json::text, '<null>')
  );

  -- 18. Accepted ledger has exact Profile/candidate/evidence lineage.
  select count(*)::integer
  into v_count
  from public.commercial_opportunity_cross_sell_suggestions suggestion_row
  join public.commercial_opportunity_profile_components component_row
    on component_row.id = suggestion_row.accepted_profile_component_id
   and component_row.profile_version_id = suggestion_row.accepted_profile_version_id
   and component_row.organization_id = suggestion_row.organization_id
   and component_row.store_id = suggestion_row.store_id
   and component_row.commercial_opportunity_id = suggestion_row.commercial_opportunity_id
   and component_row.component_kind = suggestion_row.candidate_kind
   and component_row.catalog_item_id = suggestion_row.catalog_item_id
  where suggestion_row.id = v_suggestion_catalog
    and suggestion_row.status = 'accepted'
    and suggestion_row.customer_evidence_message_id = ctx.evidence_msg_a
    and suggestion_row.acceptance_metadata = '{"proof":"explicit-catalog"}'::jsonb
    and suggestion_row.accepted_profile_version_id = v_profile_a_after_catalog
    and suggestion_row.accepted_profile_component_id = v_component_id;

  perform pg_temp._p9_cross_sell_record(
    18, 'accepted ledger preserves exact candidate evidence and Profile lineage',
    case when v_count = 1 then 'PASS' else 'SUT_FAIL' end,
    'matching_rows=' || coalesce(v_count::text, '<null>')
  );

  -- 19. Acceptance never writes quote items directly.
  select count(*)::integer
  into v_quote_count
  from public.sales_quote_items
  where quote_id = ctx.quote_a;

  perform pg_temp._p9_cross_sell_record(
    19, 'cross-sell acceptance does not mutate an existing quote directly',
    case when v_quote_count = 0 then 'PASS' else 'SUT_FAIL' end,
    'quote_items=' || coalesce(v_quote_count::text, '<null>')
  );

  -- 20. Exact acceptance replay is idempotent.
  select * into r
  from pg_temp._p9_cross_sell_exec_json('service_role', null, q);
  perform pg_temp._p9_cross_sell_record(
    20, 'acceptance replay returns same Profile lineage without duplication',
    case
      when r.operation_succeeded
       and (r.value_json ->> 'replayed')::boolean
       and (r.value_json ->> 'accepted_profile_version_id')::uuid = v_profile_a_after_catalog
       and (r.value_json ->> 'accepted_profile_component_id')::uuid = v_component_id
      then 'PASS' else 'SUT_FAIL'
    end,
    coalesce(r.message_text, r.value_json::text, '<null>')
  );

  -- 21. Same acceptance key/fingerprint/evidence but different metadata is not replay.
  q := pg_catalog.format(
    $sql$
      select *
      from public.accept_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'p9-6-1-c-accept-catalog',%L,%L::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, v_suggestion_catalog, ctx.evidence_msg_a,
    repeat('0', 64),
    '{"proof":"different"}'
  );
  perform pg_temp._p9_cross_sell_expect_fail(
    21, 'acceptance operation key replay rejects changed metadata',
    'service_role', null, q, 'ACCEPTANCE_OPERATION_KEY_REUSED'
  );

  -- 22. Rejected suggestion cannot be accepted.
  q := pg_catalog.format(
    $sql$
      select *
      from public.record_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'catalog_item',null,%L::uuid,
        'p9-6-1-c-suggest-rejected',%L,'{}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, ctx.conversation_a, ctx.suggestion_msg_a1,
    ctx.catalog_a, repeat('1a', 32)
  );
  select * into r
  from pg_temp._p9_cross_sell_exec_json('service_role', null, q);
  if r.operation_succeeded then
    v_suggestion_rejected := (r.value_json ->> 'suggestion_id')::uuid;
  end if;

  q := pg_catalog.format(
    $sql$
      select *
      from public.set_commercial_cross_sell_suggestion_status_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'rejected','p9-6-1-c-reject',%L
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, v_suggestion_rejected, repeat('2a', 32)
  );
  perform pg_temp._p9_cross_sell_exec_json('service_role', null, q);

  q := pg_catalog.format(
    $sql$
      select *
      from public.accept_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'accept-rejected',%L,'{}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, v_suggestion_rejected, ctx.evidence_msg_a,
    repeat('3a', 32)
  );
  perform pg_temp._p9_cross_sell_expect_fail(
    22, 'rejected suggestion cannot write Profile',
    'service_role', null, q, 'SUGGESTION_NOT_ACTIVE'
  );

  -- 23. Superseded suggestion cannot be accepted.
  q := pg_catalog.format(
    $sql$
      select *
      from public.record_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'catalog_item',null,%L::uuid,
        'p9-6-1-c-suggest-superseded',%L,'{}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, ctx.conversation_a, ctx.suggestion_msg_a1,
    ctx.catalog_a, repeat('4a', 32)
  );
  select * into r
  from pg_temp._p9_cross_sell_exec_json('service_role', null, q);
  if r.operation_succeeded then
    v_suggestion_superseded := (r.value_json ->> 'suggestion_id')::uuid;
  end if;

  q := pg_catalog.format(
    $sql$
      select *
      from public.set_commercial_cross_sell_suggestion_status_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'superseded','p9-6-1-c-supersede',%L
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, v_suggestion_superseded, repeat('5a', 32)
  );
  perform pg_temp._p9_cross_sell_exec_json('service_role', null, q);

  q := pg_catalog.format(
    $sql$
      select *
      from public.accept_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'accept-superseded',%L,'{}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, v_suggestion_superseded, ctx.evidence_msg_a,
    repeat('6a', 32)
  );
  perform pg_temp._p9_cross_sell_expect_fail(
    23, 'superseded suggestion cannot write Profile',
    'service_role', null, q, 'SUGGESTION_NOT_ACTIVE'
  );

  -- 24. Generic acceptance with zero active suggestions fails closed.
  q := pg_catalog.format(
    $sql$
      select *
      from public.accept_commercial_cross_sell_single_active_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'p9-6-1-c-zero-active',%L,'{}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_b, ctx.conversation_b, ctx.evidence_msg_b,
    repeat('7a', 32)
  );
  perform pg_temp._p9_cross_sell_expect_fail(
    24, 'generic acceptance with zero active suggestions fails closed',
    'service_role', null, q, 'NO_ACTIVE_SUGGESTION'
  );

  -- Record a second active suggestion on A so generic evidence is ambiguous.
  q := pg_catalog.format(
    $sql$
      select *
      from public.record_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'catalog_item',null,%L::uuid,
        'p9-6-1-c-suggest-stale',%L,'{}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, ctx.conversation_a, ctx.suggestion_msg_a3,
    ctx.catalog_stale, repeat('8a', 32)
  );
  select * into r
  from pg_temp._p9_cross_sell_exec_json('service_role', null, q);
  if r.operation_succeeded then
    v_suggestion_stale := (r.value_json ->> 'suggestion_id')::uuid;
  end if;

  -- 25. Two active suggestions + generic affirmative is ambiguous.
  q := pg_catalog.format(
    $sql$
      select *
      from public.accept_commercial_cross_sell_single_active_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'p9-6-1-c-ambiguous',%L,'{}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, ctx.conversation_a, ctx.evidence_msg_a,
    repeat('9a', 32)
  );
  perform pg_temp._p9_cross_sell_expect_fail(
    25, 'generic acceptance with multiple active suggestions is ambiguous',
    'service_role', null, q, 'AMBIGUOUS_ACTIVE_SUGGESTION'
  );

  -- 26. Candidate already in current Profile is accepted as no-op, never duplicated.
  q := pg_catalog.format(
    $sql$
      select *
      from public.accept_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'p9-6-1-c-accept-existing-pool',%L,'{}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, v_suggestion_pool, ctx.evidence_msg_a,
    repeat('aa', 32)
  );
  select * into r
  from pg_temp._p9_cross_sell_exec_json('service_role', null, q);

  if r.operation_succeeded then
    select count(*)::integer
    into v_count
    from public.commercial_opportunity_profile_components component_row
    where component_row.profile_version_id =
          (r.value_json ->> 'accepted_profile_version_id')::uuid
      and component_row.component_kind = 'pool'
      and component_row.pool_id = ctx.pool_base;
  else
    v_count := null;
  end if;

  perform pg_temp._p9_cross_sell_record(
    26, 'accepted candidate already present in current Profile is a no-op without duplication',
    case
      when r.operation_succeeded
       and not (r.value_json ->> 'profile_changed')::boolean
       and v_count = 1
      then 'PASS' else 'SUT_FAIL'
    end,
    coalesce(r.message_text, r.value_json::text, '<null>') ||
    ' count=' || coalesce(v_count::text, '<null>')
  );

  -- 27. Source that becomes unusable cannot be accepted and leaves zero partial effects.
  select current_profile_version_id
  into v_profile_before_fail
  from public.commercial_opportunity_profile_current
  where organization_id = ctx.org_a
    and store_id = ctx.store_a
    and commercial_opportunity_id = ctx.opp_a;

  update public.store_catalog_items
  set is_active = false
  where id = ctx.catalog_stale;

  q := pg_catalog.format(
    $sql$
      select *
      from public.accept_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'p9-6-1-c-stale-source',%L,'{}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_a, v_suggestion_stale, ctx.evidence_msg_a,
    repeat('ba', 32)
  );

  select * into r
  from pg_temp._p9_cross_sell_exec_json('service_role', null, q);

  select current_profile_version_id
  into v_profile_after_fail
  from public.commercial_opportunity_profile_current
  where organization_id = ctx.org_a
    and store_id = ctx.store_a
    and commercial_opportunity_id = ctx.opp_a;

  select count(*)::integer
  into v_count
  from public.commercial_opportunity_cross_sell_suggestions
  where id = v_suggestion_stale
    and status = 'suggested'
    and customer_evidence_message_id is null
    and accepted_profile_version_id is null;

  perform pg_temp._p9_cross_sell_record(
    27, 'stale candidate fails atomically and leaves suggestion/Profile unchanged',
    case
      when not r.operation_succeeded
       and coalesce(r.message_text, '') ilike '%CATALOG_SOURCE_NOT_USABLE%'
       and v_count = 1
       and v_profile_after_fail = v_profile_before_fail
      then 'PASS' else 'SUT_FAIL'
    end,
    coalesce(r.message_text, '<null>') ||
    ' suggestion_unchanged=' || coalesce(v_count::text, '<null>') ||
    ' profile_unchanged=' || coalesce((v_profile_after_fail = v_profile_before_fail)::text, '<null>')
  );

  -- 28. Exactly one active suggestion can be accepted; service/custom human terms carry forward exactly.
  q := pg_catalog.format(
    $sql$
      select *
      from public.record_commercial_cross_sell_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'pool',%L::uuid,null,
        'p9-6-1-c-suggest-pool-b',%L,'{}'::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_b, ctx.conversation_b, ctx.suggestion_msg_b,
    ctx.pool_cross, repeat('ca', 32)
  );
  select * into r
  from pg_temp._p9_cross_sell_exec_json('service_role', null, q);
  if r.operation_succeeded then
    v_suggestion_pool_b := (r.value_json ->> 'suggestion_id')::uuid;
  end if;

  q := pg_catalog.format(
    $sql$
      select *
      from public.accept_commercial_cross_sell_single_active_suggestion_by_system(
        %L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,
        'p9-6-1-c-single-active-b',%L,%L::jsonb
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.opp_b, ctx.conversation_b, ctx.evidence_msg_b,
    repeat('da', 32),
    '{"proof":"single-active"}'
  );
  select * into r
  from pg_temp._p9_cross_sell_exec_json('service_role', null, q);

  if r.operation_succeeded then
    v_profile_b_after := (r.value_json ->> 'accepted_profile_version_id')::uuid;

    select count(*)::integer
    into v_count
    from public.commercial_opportunity_profile_components component_row
    where component_row.profile_version_id = v_profile_b_after
      and component_row.component_key = 'service_authorized'
      and component_row.component_kind = 'service'
      and component_row.component_state = 'resolved'
      and component_row.quote_item_name = 'Servico humano preservado'
      and component_row.quote_item_description = 'Descricao humana'
      and component_row.quote_item_quantity = 2
      and component_row.quote_item_unit_price_cents = 1500
      and component_row.quote_terms_authority_type = 'human'
      and component_row.quote_terms_authority_user_id = ctx.user_a
      and component_row.quote_terms_origin_component_id = v_service_origin_b;

    select count(*)::integer
    into v_count_2
    from public.commercial_opportunity_profile_components component_row
    where component_row.profile_version_id = v_profile_b_after
      and component_row.component_kind = 'pool'
      and component_row.pool_id = ctx.pool_cross
      and component_row.component_state = 'resolved';
  else
    v_count := null;
    v_count_2 := null;
  end if;

  perform pg_temp._p9_cross_sell_record(
    28, 'single-active pool acceptance appends Profile and preserves human service terms exactly',
    case
      when r.operation_succeeded
       and (r.value_json ->> 'profile_changed')::boolean
       and v_profile_b_after is distinct from v_profile_b_before
       and v_count = 1
       and v_count_2 = 1
      then 'PASS' else 'SUT_FAIL'
    end,
    coalesce(r.message_text, r.value_json::text, '<null>') ||
    ' service=' || coalesce(v_count::text, '<null>') ||
    ' pool=' || coalesce(v_count_2::text, '<null>')
  );

  -- 29. New Profile version is consumable by the existing 6.1-A/B materializer.
  q := pg_catalog.format(
    $sql$
      select *
      from public.materialize_sales_quote_items_from_current_profile_by_system(
        %L::uuid,%L::uuid,%L::uuid
      )
    $sql$,
    ctx.org_a, ctx.store_a, ctx.quote_b
  );
  select * into r
  from pg_temp._p9_cross_sell_exec_json('service_role', null, q);

  select count(*)::integer
  into v_count
  from public.sales_quote_items
  where quote_id = ctx.quote_b
    and profile_component_id is not null;

  select count(*)::integer
  into v_count_2
  from public.sales_quote_items
  where quote_id = ctx.quote_b
    and (
      (item_type = 'service' and name = 'Servico humano preservado' and unit_price_cents = 1500)
      or (item_type = 'pool' and pool_id = ctx.pool_cross)
    );

  perform pg_temp._p9_cross_sell_record(
    29, 'accepted cross-sell Profile materializes through existing canonical quote-item materializer',
    case
      when r.operation_succeeded
       and (r.value_json ->> 'item_count')::integer = 2
       and v_count = 2
       and v_count_2 = 2
      then 'PASS' else 'SUT_FAIL'
    end,
    coalesce(r.message_text, r.value_json::text, '<null>') ||
    ' items=' || coalesce(v_count::text, '<null>') ||
    ' expected_shapes=' || coalesce(v_count_2::text, '<null>')
  );

  -- 30. Permissions are service-role writer only.
  select
    pg_catalog.has_function_privilege(
      'service_role',
      'public.record_commercial_cross_sell_suggestion_by_system(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,jsonb)',
      'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.set_commercial_cross_sell_suggestion_status_by_system(uuid,uuid,uuid,uuid,text,text,text)',
      'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.accept_commercial_cross_sell_suggestion_by_system(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)',
      'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.accept_commercial_cross_sell_single_active_suggestion_by_system(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.record_commercial_cross_sell_suggestion_by_system(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,jsonb)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.accept_commercial_cross_sell_suggestion_by_system(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)',
      'EXECUTE'
    )
    and not pg_catalog.has_table_privilege(
      'service_role',
      'public.commercial_opportunity_cross_sell_suggestions',
      'INSERT'
    )
    and not pg_catalog.has_table_privilege(
      'service_role',
      'public.commercial_opportunity_cross_sell_suggestions',
      'UPDATE'
    )
    and not pg_catalog.has_table_privilege(
      'authenticated',
      'public.commercial_opportunity_cross_sell_suggestions',
      'INSERT'
    )
    and not pg_catalog.has_table_privilege(
      'authenticated',
      'public.commercial_opportunity_cross_sell_suggestions',
      'UPDATE'
    )
  into v_ok;

  perform pg_temp._p9_cross_sell_record(
    30, 'cross-sell ledger and writers are service-role gated',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    v_ok::text
  );

  -- 31. Structural race/idempotency/lineage hardening.
  select pg_catalog.pg_get_functiondef(
    'public.record_commercial_cross_sell_suggestion_by_system(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,jsonb)'::pg_catalog.regprocedure
  )
  into v_function_record;

  select pg_catalog.pg_get_functiondef(
    'public.set_commercial_cross_sell_suggestion_status_by_system(uuid,uuid,uuid,uuid,text,text,text)'::pg_catalog.regprocedure
  )
  into v_function_status;

  select pg_catalog.pg_get_functiondef(
    'public.accept_commercial_cross_sell_suggestion_by_system(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)'::pg_catalog.regprocedure
  )
  into v_function_accept;

  select pg_catalog.pg_get_functiondef(
    'public.accept_commercial_cross_sell_single_active_suggestion_by_system(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)'::pg_catalog.regprocedure
  )
  into v_function_single;

  v_ok :=
    position('pg_advisory_xact_lock' in lower(coalesce(v_function_record, ''))) > 0
    and position('pg_advisory_xact_lock' in lower(coalesce(v_function_status, ''))) > 0
    and position('pg_advisory_xact_lock' in lower(coalesce(v_function_accept, ''))) > 0
    and position('pg_advisory_xact_lock' in lower(coalesce(v_function_single, ''))) > 0
    and position('min(suggestion_row.id)' in lower(coalesce(v_function_single, ''))) = 0
    and position('acceptance_metadata is not distinct from v_metadata' in lower(coalesce(v_function_accept, ''))) > 0
    and exists (
      select 1
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid =
            'public.commercial_opportunity_cross_sell_suggestions'::pg_catalog.regclass
        and constraint_row.conname =
            'p9_cross_sell_suggestions_profile_component_version_kind_fk'
    )
    and exists (
      select 1
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid =
            'public.commercial_opportunity_cross_sell_suggestions'::pg_catalog.regclass
        and constraint_row.conname =
            'p9_cross_sell_suggestions_profile_component_pool_fk'
    )
    and exists (
      select 1
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid =
            'public.commercial_opportunity_cross_sell_suggestions'::pg_catalog.regclass
        and constraint_row.conname =
            'p9_cross_sell_suggestions_profile_component_catalog_fk'
    )
    and exists (
      select 1
      from pg_catalog.pg_attribute column_row
      where column_row.attrelid =
            'public.commercial_opportunity_cross_sell_suggestions'::pg_catalog.regclass
        and column_row.attname = 'acceptance_metadata'
        and not column_row.attisdropped
    )
    and (
      select count(*) = 0
      from public.sales_quote_items
      where quote_id = ctx.quote_a
    );

  perform pg_temp._p9_cross_sell_record(
    31,
    'cross-sell writers serialize races preserve acceptance idempotency and enforce exact Profile lineage',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    case when v_ok then
      'advisory locks + no min(uuid) + acceptance metadata + exact Profile FKs + quote A untouched'
    else
      'one or more structural hardening checks failed'
    end
  );

exception when others then
  perform pg_temp._p9_cross_sell_record(
    999,
    'runner uncaught error',
    'HARNESS_ERROR',
    sqlstate || ' ' || sqlerrm
  );
end;
$scenarios$;

select *
from pg_temp._p9_cross_sell_results
order by scenario_number;

do $assertions$
declare
  v_failed integer;
  v_missing integer;
  v_detail text;
begin
  select count(*) filter (where status <> 'PASS')
  into v_failed
  from pg_temp._p9_cross_sell_results
  where scenario_number between 1 and 31;

  select count(*)
  into v_missing
  from generate_series(1, 31) as scenario_row(scenario_number)
  where not exists (
    select 1
    from pg_temp._p9_cross_sell_results result_row
    where result_row.scenario_number = scenario_row.scenario_number
  );

  if coalesce(v_failed, 0) > 0 or coalesce(v_missing, 0) > 0
     or exists (
       select 1
       from pg_temp._p9_cross_sell_results
       where scenario_number not between 1 and 31
          or status <> 'PASS'
     ) then
    select string_agg(
      pg_catalog.format(
        '#%s %s => %s (%s)',
        result_row.scenario_number,
        result_row.scenario_name,
        result_row.status,
        result_row.detail
      ),
      E'\n'
      order by result_row.scenario_number
    )
    into v_detail
    from pg_temp._p9_cross_sell_results result_row
    where result_row.status <> 'PASS'
       or result_row.scenario_number not between 1 and 31;

    raise exception using
      errcode = 'P0001',
      message = 'P9 6.1-C cross-sell acceptance manual checks failed',
      detail = pg_catalog.format(
        'failed=%s missing=%s%s%s',
        coalesce(v_failed, 0),
        coalesce(v_missing, 0),
        E'\n',
        coalesce(v_detail, '<no failure rows>')
      );
  end if;
end;
$assertions$;

rollback;

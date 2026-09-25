begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_68_results (
  scenario_number integer primary key,
  scenario text not null,
  status text not null
    check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text null
) on commit drop;

create or replace function pg_temp._p9_68_record(
  p_number integer,
  p_scenario text,
  p_ok boolean,
  p_detail text default null,
  p_harness boolean default false
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_68_results (
    scenario_number,
    scenario,
    status,
    detail
  )
  values (
    p_number,
    p_scenario,
    case
      when p_harness then 'HARNESS_ERROR'
      when p_ok then 'PASS'
      else 'SUT_FAIL'
    end,
    p_detail
  );
end;
$function$;


create temp table pg_temp._p9_68_ctx (
  org_a uuid not null,
  org_b uuid not null,

  store_a uuid not null,
  store_b_same_org uuid not null,
  store_c_other_org uuid not null,

  user_active uuid not null,
  user_inactive uuid not null,

  customer_a uuid not null,

  lead_a uuid not null,

  conv_main uuid not null,
  conv_other uuid not null,
  conv_past uuid not null,

  session_main uuid not null,
  session_other uuid not null,
  session_past uuid not null,

  opp_main uuid not null,
  opp_none uuid not null,
  opp_other uuid not null,
  opp_past uuid not null,
  opp_notsent uuid not null,

  quote_main uuid not null,
  quote_past uuid not null,
  quote_notsent uuid not null,

  main_v1 uuid not null,
  main_v2 uuid not null,
  past_v1 uuid not null,
  notsent_v1 uuid not null,

  message_valid_v1 uuid null,
  message_other_opp uuid null,
  message_outbound uuid null,
  message_past uuid null,
  message_valid_v2 uuid null
) on commit drop;

insert into pg_temp._p9_68_ctx (
  org_a,
  org_b,
  store_a,
  store_b_same_org,
  store_c_other_org,
  user_active,
  user_inactive,
  customer_a,
  lead_a,
  conv_main,
  conv_other,
  conv_past,
  session_main,
  session_other,
  session_past,
  opp_main,
  opp_none,
  opp_other,
  opp_past,
  opp_notsent,
  quote_main,
  quote_past,
  quote_notsent,
  main_v1,
  main_v2,
  past_v1,
  notsent_v1
)
select
  gen_random_uuid(),
  gen_random_uuid(),

  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),

  gen_random_uuid(),
  gen_random_uuid(),

  gen_random_uuid(),

  gen_random_uuid(),

  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),

  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),

  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),

  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),

  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid();


create or replace function pg_temp._p9_68_exec_json_sql(
  p_role text,
  p_user_id uuid,
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
  v_value jsonb;
  v_state text;
  v_message text;
begin
  if current_user <> 'postgres'
     or session_user <> 'postgres' then
    return query
    select
      false,
      null::jsonb,
      null::text,
      'runner helper must start as postgres'::text;
    return;
  end if;

  if p_role not in (
    'postgres',
    'authenticated',
    'service_role',
    'anon'
  ) then
    return query
    select
      false,
      null::jsonb,
      null::text,
      'unsupported test role'::text;
    return;
  end if;

  if p_role <> 'postgres' then
    perform pg_catalog.set_config(
      'request.jwt.claim.sub',
      coalesce(p_user_id::text, ''),
      true
    );

    perform pg_catalog.set_config(
      'request.jwt.claim.role',
      p_role,
      true
    );

    perform pg_catalog.set_config(
      'request.jwt.claims',
      pg_catalog.jsonb_build_object(
        'sub',
        coalesce(p_user_id::text, ''),
        'role',
        p_role
      )::text,
      true
    );

    execute pg_catalog.format(
      'set local role %I',
      p_role
    );
  end if;

  begin
    execute pg_catalog.format(
      'with result_row as (%s)
       select to_jsonb(result_row)
       from result_row',
      p_sql
    )
    into v_value;

    if p_role <> 'postgres' then
      execute 'reset role';
    end if;

    perform pg_catalog.set_config(
      'request.jwt.claim.sub',
      '',
      true
    );

    perform pg_catalog.set_config(
      'request.jwt.claim.role',
      '',
      true
    );

    perform pg_catalog.set_config(
      'request.jwt.claims',
      '',
      true
    );

    return query
    select
      true,
      v_value,
      null::text,
      null::text;

    return;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text;

      begin
        if p_role <> 'postgres' then
          execute 'reset role';
        end if;
      exception
        when others then
          null;
      end;

      perform pg_catalog.set_config(
        'request.jwt.claim.sub',
        '',
        true
      );

      perform pg_catalog.set_config(
        'request.jwt.claim.role',
        '',
        true
      );

      perform pg_catalog.set_config(
        'request.jwt.claims',
        '',
        true
      );

      return query
      select
        false,
        null::jsonb,
        v_state,
        v_message;

      return;
  end;
end;
$function$;


create or replace function pg_temp._p9_68_call_acceptance(
  p_user_id uuid,
  p_org uuid,
  p_store uuid,
  p_opportunity uuid,
  p_lifecycle integer,
  p_quote uuid,
  p_version uuid,
  p_message uuid
)
returns table (
  operation_succeeded boolean,
  value_json jsonb,
  returned_sqlstate text,
  message_text text
)
language sql
as $function$
  select *
  from pg_temp._p9_68_exec_json_sql(
    'authenticated',
    p_user_id,
    pg_catalog.format(
      $sql$
        select *
        from public.accept_current_commercial_proposal_customer_signal_by_user(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %s,
          %L::uuid,
          %L::uuid,
          %L::uuid
        )
      $sql$,
      p_org,
      p_store,
      p_opportunity,
      p_lifecycle,
      p_quote,
      p_version,
      p_message
    )
  );
$function$;


create or replace function pg_temp._p9_68_call_reader(
  p_role text,
  p_user_id uuid,
  p_org uuid,
  p_store uuid,
  p_opportunity uuid
)
returns table (
  operation_succeeded boolean,
  value_json jsonb,
  returned_sqlstate text,
  message_text text
)
language sql
as $function$
  select *
  from pg_temp._p9_68_exec_json_sql(
    p_role,
    p_user_id,
    pg_catalog.format(
      $sql$
        select *
        from public.read_current_commercial_proposal_acceptance_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid
        )
      $sql$,
      p_org,
      p_store,
      p_opportunity
    )
  );
$function$;


/* ============================================================================
 * Fixtures
 * ========================================================================== */

do $fixtures$
declare
  c pg_temp._p9_68_ctx%rowtype;
  v_link public.commercial_session_context_links;
  v_message public.messages;
  v_lead_link uuid := gen_random_uuid();

  v_message_valid_v1 uuid;
  v_message_other_opp uuid;
  v_message_outbound uuid;
  v_message_past uuid;

  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  select *
  into c
  from pg_temp._p9_68_ctx;

  insert into public.organizations (
    id,
    name,
    subscription_status
  )
  values
    (
      c.org_a,
      'P9 6.8 Acceptance Org A',
      'active'
    ),
    (
      c.org_b,
      'P9 6.8 Acceptance Org B',
      'active'
    );

  insert into public.stores (
    id,
    organization_id,
    name
  )
  values
    (
      c.store_a,
      c.org_a,
      'P9 6.8 Store A'
    ),
    (
      c.store_b_same_org,
      c.org_a,
      'P9 6.8 Store B'
    ),
    (
      c.store_c_other_org,
      c.org_b,
      'P9 6.8 Store C'
    );

  insert into auth.users (id)
  values
    (c.user_active),
    (c.user_inactive);

  insert into public.memberships (
    organization_id,
    user_id,
    role,
    is_active
  )
  values
    (
      c.org_a,
      c.user_active,
      'owner'::public.app_role,
      true
    ),
    (
      c.org_a,
      c.user_inactive,
      'owner'::public.app_role,
      false
    );

  insert into public.customers (
    id,
    organization_id,
    display_name,
    normalized_name
  )
  values (
    c.customer_a,
    c.org_a,
    'P9 6.8 Customer',
    'p9 6 8 customer'
  );

  insert into public.customer_store_links (
    organization_id,
    store_id,
    customer_id
  )
  values (
    c.org_a,
    c.store_a,
    c.customer_a
  );

  insert into public.leads (
    id,
    organization_id,
    store_id,
    name,
    phone,
    state,
    created_at,
    updated_at
  )
  values (
    c.lead_a,
    c.org_a,
    c.store_a,
    'P9 6.8 Lead',
    '5511996800001',
    'orcamento',
    v_now,
    v_now
  );

  insert into public.lead_customer_links (
    id,
    organization_id,
    store_id,
    lead_id,
    customer_id,
    status,
    source,
    linked_by_actor_type,
    linked_at,
    metadata
  )
  values (
    v_lead_link,
    c.org_a,
    c.store_a,
    c.lead_a,
    c.customer_a,
    'active',
    'manual',
    'migration',
    v_now,
    '{}'::jsonb
  );

  insert into public.conversations (
    id,
    organization_id,
    lead_id,
    status,
    is_human_active,
    created_at
  )
  values
    (
      c.conv_main,
      c.org_a,
      c.lead_a,
      'open',
      false,
      v_now
    ),
    (
      c.conv_other,
      c.org_a,
      c.lead_a,
      'open',
      false,
      v_now
    ),
    (
      c.conv_past,
      c.org_a,
      c.lead_a,
      'open',
      false,
      v_now
    );

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    origin_lead_id,
    primary_conversation_id,
    stage,
    lifecycle_cycle
  )
  values
    (
      c.opp_main,
      c.org_a,
      c.store_a,
      c.customer_a,
      c.lead_a,
      c.conv_main,
      'orcamento',
      1
    ),
    (
      c.opp_none,
      c.org_a,
      c.store_a,
      c.customer_a,
      c.lead_a,
      c.conv_main,
      'orcamento',
      1
    ),
    (
      c.opp_other,
      c.org_a,
      c.store_a,
      c.customer_a,
      c.lead_a,
      c.conv_other,
      'orcamento',
      1
    ),
    (
      c.opp_past,
      c.org_a,
      c.store_a,
      c.customer_a,
      c.lead_a,
      c.conv_past,
      'orcamento',
      1
    ),
    (
      c.opp_notsent,
      c.org_a,
      c.store_a,
      c.customer_a,
      c.lead_a,
      c.conv_main,
      'orcamento',
      1
    );

  insert into public.conversation_sessions (
    id,
    organization_id,
    store_id,
    conversation_id,
    status
  )
  values
    (
      c.session_main,
      c.org_a,
      c.store_a,
      c.conv_main,
      'active'
    ),
    (
      c.session_other,
      c.org_a,
      c.store_a,
      c.conv_other,
      'active'
    ),
    (
      c.session_past,
      c.org_a,
      c.store_a,
      c.conv_past,
      'active'
    );

  select *
  into v_link
  from public.link_commercial_session_context(
    c.org_a,
    c.store_a,
    c.session_main,
    c.customer_a,
    c.opp_main,
    v_lead_link,
    'migration',
    'migration',
    null,
    'p9-6-8-main-context',
    'p9-6-8-main-context',
    null,
    '{}'::jsonb,
    null
  );

  select *
  into v_link
  from public.link_commercial_session_context(
    c.org_a,
    c.store_a,
    c.session_other,
    c.customer_a,
    c.opp_other,
    v_lead_link,
    'migration',
    'migration',
    null,
    'p9-6-8-other-context',
    'p9-6-8-other-context',
    null,
    '{}'::jsonb,
    null
  );

  select *
  into v_link
  from public.link_commercial_session_context(
    c.org_a,
    c.store_a,
    c.session_past,
    c.customer_a,
    c.opp_past,
    v_lead_link,
    'migration',
    'migration',
    null,
    'p9-6-8-past-context',
    'p9-6-8-past-context',
    null,
    '{}'::jsonb,
    null
  );

  insert into public.sales_quotes (
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
    customer_notes,
    internal_notes,
    subtotal_cents,
    discount_cents,
    total_cents,
    current_version_id,
    metadata
  )
  values
    (
      c.quote_main,
      c.org_a,
      c.store_a,
      c.opp_main,
      c.conv_main,
      c.lead_a,
      'P968-MAIN-' || pg_catalog.replace(c.quote_main::text, '-', ''),
      'P9 6.8 Main',
      'sent',
      'P9 6.8 Customer',
      null,
      null,
      null,
      100000,
      0,
      100000,
      null,
      '{"runner":"p9.6.8","case":"main"}'::jsonb
    ),
    (
      c.quote_past,
      c.org_a,
      c.store_a,
      c.opp_past,
      c.conv_past,
      c.lead_a,
      'P968-PAST-' || pg_catalog.replace(c.quote_past::text, '-', ''),
      'P9 6.8 Predate',
      'sent',
      'P9 6.8 Customer',
      null,
      null,
      null,
      200000,
      0,
      200000,
      null,
      '{"runner":"p9.6.8","case":"past"}'::jsonb
    ),
    (
      c.quote_notsent,
      c.org_a,
      c.store_a,
      c.opp_notsent,
      c.conv_main,
      c.lead_a,
      'P968-NOTSENT-' || pg_catalog.replace(c.quote_notsent::text, '-', ''),
      'P9 6.8 Not Sent',
      'sent',
      'P9 6.8 Customer',
      null,
      null,
      null,
      300000,
      0,
      300000,
      null,
      '{"runner":"p9.6.8","case":"notsent"}'::jsonb
    );

  insert into public.sales_quote_versions (
    id,
    organization_id,
    store_id,
    quote_id,
    version_number,
    status,
    quote_kind,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    generated_by,
    quote_snapshot,
    created_at,
    sent_at
  )
  values
    (
      c.main_v1,
      c.org_a,
      c.store_a,
      c.quote_main,
      1,
      'sent',
      'definitive',
      'zion-store-files',
      'p9/6-8/main-v1.pdf',
      'main-v1.pdf',
      'application/pdf',
      100,
      'system',
      pg_catalog.jsonb_build_object(
        'quote',
        pg_catalog.jsonb_build_object(
          'id', c.quote_main::text,
          'quoteNumber', 'P968-SNAPSHOT-V1',
          'title', 'P9 6.8 Snapshot V1',
          'status', 'sent',
          'quoteKind', 'definitive',
          'quoteKindNotice', null,
          'customerName', 'Snapshot Customer V1',
          'customerPhone', '5511991111111',
          'customerNotes', 'Snapshot customer notes V1',
          'internalNotes', 'Snapshot internal notes V1',
          'paymentTerms', 'PIX snapshot V1',
          'deliveryTerms', 'Entrega snapshot V1',
          'warrantyTerms', 'Garantia snapshot V1',
          'validUntil', '2026-12-31',
          'createdAt', '2026-09-24T12:00:00.000Z',
          'subtotalCents', 111000,
          'discountCents', 1000,
          'totalCents', 110000
        ),
        'store',
        pg_catalog.jsonb_build_object(
          'id', c.store_a::text,
          'name', 'Snapshot Store V1'
        ),
        'lead',
        pg_catalog.jsonb_build_object(
          'id', c.lead_a::text,
          'name', 'Snapshot Lead V1',
          'phone', '5511991111111'
        ),
        'items',
        pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'id', null,
            'name', 'Snapshot Item V1',
            'description', 'Item frozen in accepted V1',
            'quantity', 2,
            'unitPriceCents', 60000,
            'discountCents', 10000,
            'subtotalCents', 120000,
            'totalCents', 110000,
            'sku', 'SNAP-V1',
            'sortOrder', 1,
            'metadata', '{}'::jsonb
          )
        ),
        'settings', '{}'::jsonb,
        'generatedAt', '2026-09-24T12:00:00.000Z'
      ),
      v_now - interval '15 minutes',
      v_now - interval '10 minutes'
    ),
    (
      c.main_v2,
      c.org_a,
      c.store_a,
      c.quote_main,
      2,
      'generated',
      'definitive',
      'zion-store-files',
      'p9/6-8/main-v2.pdf',
      'main-v2.pdf',
      'application/pdf',
      100,
      'system',
      pg_catalog.jsonb_build_object(
        'quote',
        pg_catalog.jsonb_build_object(
          'id', c.quote_main::text,
          'quoteNumber', 'P968-SNAPSHOT-V2',
          'title', 'P9 6.8 Snapshot V2',
          'status', 'sent',
          'quoteKind', 'definitive',
          'quoteKindNotice', null,
          'customerName', 'Snapshot Customer V2',
          'customerPhone', '5511992222222',
          'customerNotes', 'Snapshot customer notes V2',
          'internalNotes', 'Snapshot internal notes V2',
          'paymentTerms', 'Cartao snapshot V2',
          'deliveryTerms', 'Entrega snapshot V2',
          'warrantyTerms', 'Garantia snapshot V2',
          'validUntil', '2027-01-31',
          'createdAt', '2026-09-24T13:00:00.000Z',
          'subtotalCents', 222000,
          'discountCents', 2000,
          'totalCents', 220000
        ),
        'store',
        pg_catalog.jsonb_build_object(
          'id', c.store_a::text,
          'name', 'Snapshot Store V2'
        ),
        'lead',
        pg_catalog.jsonb_build_object(
          'id', c.lead_a::text,
          'name', 'Snapshot Lead V2',
          'phone', '5511992222222'
        ),
        'items',
        pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'id', null,
            'name', 'Snapshot Item V2',
            'description', 'Item frozen in accepted V2',
            'quantity', 2,
            'unitPriceCents', 120000,
            'discountCents', 20000,
            'subtotalCents', 240000,
            'totalCents', 220000,
            'sku', 'SNAP-V2',
            'sortOrder', 1,
            'metadata', '{}'::jsonb
          )
        ),
        'settings', '{}'::jsonb,
        'generatedAt', '2026-09-24T13:00:00.000Z'
      ),
      v_now - interval '5 minutes',
      null
    ),
    (
      c.past_v1,
      c.org_a,
      c.store_a,
      c.quote_past,
      1,
      'sent',
      'definitive',
      'zion-store-files',
      'p9/6-8/past-v1.pdf',
      'past-v1.pdf',
      'application/pdf',
      100,
      'system',
      '{}'::jsonb,
      v_now,
      v_now + interval '10 minutes'
    ),
    (
      c.notsent_v1,
      c.org_a,
      c.store_a,
      c.quote_notsent,
      1,
      'generated',
      'definitive',
      'zion-store-files',
      'p9/6-8/notsent-v1.pdf',
      'notsent-v1.pdf',
      'application/pdf',
      100,
      'system',
      '{}'::jsonb,
      v_now,
      null
    );

  update public.sales_quotes
  set current_version_id = case id
    when c.quote_main then c.main_v1
    when c.quote_past then c.past_v1
    when c.quote_notsent then c.notsent_v1
    else current_version_id
  end
  where id in (
    c.quote_main,
    c.quote_past,
    c.quote_notsent
  );

  perform *
  from public.set_current_commercial_proposal_from_sent_quote_by_system(
    c.org_a,
    c.store_a,
    c.opp_main,
    c.quote_main,
    c.main_v1,
    'current_commercial_proposal:'
      || c.opp_main::text
      || ':'
      || c.quote_main::text
      || ':'
      || c.main_v1::text,
    'p9_6_8_acceptance_runner_v1'
  );

  /*
   * Fixtures deliberadamente estruturais:
   * servem para testar predate e version-not-sent no writer de acceptance.
   */
  update public.commercial_opportunities
  set
    current_quote_id = c.quote_past,
    current_quote_version_id = c.past_v1
  where id = c.opp_past;

  update public.commercial_opportunities
  set
    current_quote_id = c.quote_notsent,
    current_quote_version_id = c.notsent_v1
  where id = c.opp_notsent;

  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'service_role',
    true
  );

  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'role',
      'service_role'
    )::text,
    true
  );

  execute 'set local role service_role';

  select *
  into v_message
  from public.insert_message(
    c.conv_main,
    'user',
    'incoming',
    'text',
    'aceito o orçamento',
    'p9-6-8-main-v1-' || c.conv_main::text,
    null,
    '{}'::jsonb
  );

  v_message_valid_v1 := v_message.id;

  select *
  into v_message
  from public.insert_message(
    c.conv_other,
    'user',
    'incoming',
    'text',
    'aceito outra oportunidade',
    'p9-6-8-other-' || c.conv_other::text,
    null,
    '{}'::jsonb
  );

  v_message_other_opp := v_message.id;

  select *
  into v_message
  from public.insert_message(
    c.conv_main,
    'ai',
    'outgoing',
    'text',
    'mensagem outbound',
    'p9-6-8-outbound-' || c.conv_main::text,
    null,
    '{}'::jsonb
  );

  v_message_outbound := v_message.id;

  select *
  into v_message
  from public.insert_message(
    c.conv_past,
    'user',
    'incoming',
    'text',
    'aceito antes do envio',
    'p9-6-8-past-' || c.conv_past::text,
    null,
    '{}'::jsonb
  );

  v_message_past := v_message.id;

  execute 'reset role';

  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    '',
    true
  );

  perform pg_catalog.set_config(
    'request.jwt.claims',
    '',
    true
  );

  /*
   * A temp table pertence ao postgres que executa o runner.
   * Só gravamos nela depois de RESET ROLE para não contaminar
   * o teste com grants artificiais ao service_role.
   */
  update pg_temp._p9_68_ctx
  set
    message_valid_v1 = v_message_valid_v1,
    message_other_opp = v_message_other_opp,
    message_outbound = v_message_outbound,
    message_past = v_message_past;
end;
$fixtures$;

-- ============================================================================
-- P9 6.8 / create_contract readiness integration
--
-- Reuse the exact canonical proposal/acceptance fixtures above, then build the
-- commercial Checklist/Progress through their canonical materializers.
-- ============================================================================

create temporary table pg_temp._p9_68_readiness_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  detail text not null
) on commit drop;

create or replace function pg_temp._p9_68_readiness_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_passed boolean,
  p_detail text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_68_readiness_results (
    scenario_number,
    scenario_name,
    status,
    detail
  )
  values (
    p_scenario_number,
    p_scenario_name,
    case when p_passed then 'PASS' else 'SUT_FAIL' end,
    coalesce(p_detail, '')
  )
  on conflict (scenario_number) do update
  set scenario_name = excluded.scenario_name,
      status = excluded.status,
      detail = excluded.detail;
end;
$function$;


-- ============================================================================
-- P9 6.8 / atomic contract writer behavioral results
-- ============================================================================

create temporary table pg_temp._p9_68_contract_writer_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (
    status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')
  ),
  detail text not null
) on commit drop;

create or replace function pg_temp._p9_68_contract_writer_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_passed boolean,
  p_detail text default null,
  p_harness_error boolean default false
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_68_contract_writer_results (
    scenario_number,
    scenario_name,
    status,
    detail
  )
  values (
    p_scenario_number,
    p_scenario_name,
    case
      when p_harness_error then 'HARNESS_ERROR'
      when p_passed then 'PASS'
      else 'SUT_FAIL'
    end,
    coalesce(p_detail, '')
  )
  on conflict (scenario_number) do update
  set scenario_name = excluded.scenario_name,
      status = excluded.status,
      detail = excluded.detail;
end;
$function$;

do $readiness_projection$
declare
  c pg_temp._p9_68_ctx%rowtype;

  v_rules jsonb;
  v_policy record;
  v_profile record;
  v_checklist record;
  v_progress record;
begin
  select *
  into c
  from pg_temp._p9_68_ctx;

  execute 'reset role';

  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    '',
    true
  );

  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    '',
    true
  );

  /*
   * Match the canonical readiness fixture:
   * quote and technical_visit are explicit optional commercial gates.
   *
   * create_contract still requires the completed quote progress, while an
   * optional technical visit does not become a mandatory prerequisite.
   */
  update public.store_operation_settings
  set offers_technical_visit = true
  where organization_id = c.org_a
    and store_id = c.store_a;

  /*
   * p968 readiness contract settings fixture
   *
   * The Checklist materializer treats store_contract_settings as the canonical
   * authority for whether the contract feature exists. Missing Settings must
   * fail closed, so this rollback-only fixture explicitly enables contracts.
   */
  update public.store_contract_settings
  set contract_enabled = true
  where organization_id = c.org_a
    and store_id = c.store_a;

  if not found then
    insert into public.store_contract_settings (
      organization_id,
      store_id,
      contract_enabled
    )
    values (
      c.org_a,
      c.store_a,
      true
    );
  end if;

  v_rules := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'rule_key',
        'p968.readiness.quote.always.optional',
      'rule_priority',
        10,
      'item_kind',
        'commercial_gate',
      'item_key',
        'quote',
      'match_mode',
        'always',
      'component_kind',
        null,
      'execution_kind',
        null,
      'applicability_state',
        'optional',
      'reason_code',
        'p968_readiness_quote_optional',
      'metadata',
        '{}'::jsonb
    ),
    pg_catalog.jsonb_build_object(
      'rule_key',
        'p968.readiness.contract.always.optional',
      'rule_priority',
        10,
      'item_kind',
        'commercial_gate',
      'item_key',
        'contract',
      'match_mode',
        'always',
      'component_kind',
        null,
      'execution_kind',
        null,
      'applicability_state',
        'optional',
      'reason_code',
        'p968_readiness_contract_optional',
      'metadata',
        '{}'::jsonb
    ),
    pg_catalog.jsonb_build_object(
      'rule_key',
        'p968.readiness.technical_visit.always.optional',
      'rule_priority',
        10,
      'item_kind',
        'commercial_gate',
      'item_key',
        'technical_visit',
      'match_mode',
        'always',
      'component_kind',
        null,
      'execution_kind',
        null,
      'applicability_state',
        'optional',
      'reason_code',
        'p968_readiness_technical_visit_optional',
      'metadata',
        '{}'::jsonb
    )
  );

  select *
  into v_policy
  from public.write_store_opportunity_gate_policy_internal(
    c.org_a,
    c.store_a,
    'p9:6.8:create-contract-acceptance-readiness:policy:v2',
    repeat('e', 64),
    v_rules,
    'system',
    null,
    'manual_check_runner',
    'p9_68_acceptance_readiness_policy',
    'p9_68_acceptance_readiness_runner',
    '{"runner":true,"scope":"p9.6.8.create_contract_acceptance"}'::jsonb
  );

  if not coalesce(v_policy.changed, false) then
    raise exception using
      errcode = 'P0001',
      message =
        'HARNESS_ERROR: readiness integration gate policy was not created';
  end if;

  /*
   * P9 6.1-B authority contract:
   * resolved service/custom quote terms are human-authorized facts.
   *
   * Therefore this readiness fixture must create its resolved custom Profile
   * through the authenticated human writer. The system writer must not invent
   * quote terms.
   */
  select *
  into v_profile
  from pg_temp._p9_68_exec_json_sql(
    'authenticated',
    c.user_active,
    pg_catalog.format(
      $sql$
        select *
        from public.write_commercial_opportunity_profile_by_user(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'p9:6.8:create-contract-acceptance-readiness:profile',
          %L,
          'resolved',
          %L::jsonb,
          '[]'::jsonb,
          'manual_check',
          '{"runner":true,"scope":"p9.6.8.create_contract_acceptance"}'::jsonb
        )
      $sql$,
      c.org_a,
      c.store_a,
      c.opp_main,
      repeat('f', 64),
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'component_key',
            'p968_readiness_custom',
          'component_kind',
            'custom',
          'component_state',
            'resolved',
          'pool_id',
            null,
          'catalog_item_id',
            null,
          'reference_text',
            'P9 6.8 create_contract acceptance readiness',
          'metadata',
            '{}'::jsonb,
          'quote_item_name',
            'P9 6.8 readiness custom item',
          'quote_item_description',
            'Fixture comercial para readiness de create_contract',
          'quote_item_quantity',
            1,
          'quote_item_unit_price_cents',
            100000,
          'quote_terms_authority_type',
            'human',
          'quote_terms_authority_user_id',
            c.user_active
        )
      )::text
    )
  );

  if not coalesce(v_profile.operation_succeeded, false) then
    raise exception using
      errcode = 'P0001',
      message =
        'HARNESS_ERROR: authenticated readiness Profile was not created',
      detail =
        coalesce(
          v_profile.message_text,
          v_profile.returned_sqlstate,
          v_profile.value_json::text,
          'unknown profile writer failure'
        );
  end if;

  /*
   * Checklist/Progress remain system-owned projections.
   */
  execute 'set local role service_role';

  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'service_role',
    true
  );

  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    '',
    true
  );
  select *
  into v_checklist
  from public.materialize_commercial_opportunity_checklist_by_system(
    c.org_a,
    c.store_a,
    c.opp_main,
    'p9:6.8:create-contract-acceptance-readiness:checklist'
  );

  select *
  into v_progress
  from public.materialize_commercial_opportunity_checklist_progress_by_system(
    c.org_a,
    c.store_a,
    c.opp_main,
    'p9:6.8:create-contract-acceptance-readiness:progress'
  );

  if v_checklist.current_checklist_version_id is null
     or v_progress.current_progress_version_id is null then
    raise exception using
      errcode = 'P0001',
      message =
        'HARNESS_ERROR: readiness integration current projections missing';
  end if;

  execute 'reset role';

  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    '',
    true
  );

  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    '',
    true
  );
end;
$readiness_projection$;


-- ============================================================================
-- R1. Sent/current proposal exists, but no acceptance exists yet.
--     create_contract must fail closed as BLOCKED.
-- ============================================================================

do $readiness_without_acceptance$
declare
  c pg_temp._p9_68_ctx%rowtype;
  r record;
begin
  select *
  into c
  from pg_temp._p9_68_ctx;

  select *
  into r
  from public.p9_resolve_commercial_action_readiness_internal(
    c.org_a,
    c.store_a,
    c.opp_main,
    'create_contract'
  );

  perform pg_temp._p9_68_readiness_record(
    1,
    'create_contract bloqueia proposal vigente ainda nao aceita',
    r.readiness_state = 'blocked'
      and r.reason_code =
        'create_contract_current_proposal_not_accepted'
      and r.resolver_key = 'commercial_action_readiness'
      and r.resolver_version = 2
      and r.readiness_basis->>'schema' =
        'p9_commercial_action_readiness_v2'
      and r.readiness_basis->'details'
          ->>'proposal_acceptance_state' = 'none'
      and r.readiness_basis->'details'
          ->>'proposal_acceptance_reason_code' =
            'current_proposal_not_accepted',
    pg_catalog.to_jsonb(r)::text
  );
exception
  when others then
    perform pg_temp._p9_68_readiness_record(
      1,
      'create_contract bloqueia proposal vigente ainda nao aceita',
      false,
      sqlstate || ' ' || sqlerrm
    );
end;
$readiness_without_acceptance$;

-- ============================================================================
-- W5. Current Proposal without acceptance must fail closed at the atomic
--     contract writer itself, not only at the readiness layer.
-- ============================================================================

do $contract_writer_without_acceptance$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;

  v_before_count bigint;
  v_after_count bigint;

  v_contract_number text;
begin
  select *
  into c
  from pg_temp._p9_68_ctx;

  select pg_catalog.count(*)
  into v_before_count
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1;

  v_contract_number :=
    'P968-NO-ACCEPTANCE-'
    || pg_catalog.replace(c.main_v1::text, '-', '');

  select *
  into x
  from pg_temp._p9_68_exec_json_sql(
    'service_role',
    null,
    pg_catalog.format(
      $sql$
        select *
        from public.create_sales_contract_from_current_accepted_proposal_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::text
        )
      $sql$,
      c.org_a,
      c.store_a,
      c.opp_main,
      c.quote_main,
      c.main_v1,
      v_contract_number
    )
  );

  select pg_catalog.count(*)
  into v_after_count
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1;

  perform pg_temp._p9_68_contract_writer_record(
    5,
    'proposal vigente sem acceptance não pode criar contrato',

    not x.operation_succeeded

      and x.returned_sqlstate = 'P0001'

      and x.message_text =
        'ZION_CONTRACT_CREATE_ACCEPTANCE_NOT_CURRENT'

      and v_before_count = 0
      and v_after_count = 0,

    pg_catalog.jsonb_build_object(
      'operation_succeeded', x.operation_succeeded,
      'returned_sqlstate', x.returned_sqlstate,
      'message_text', x.message_text,
      'quote_id', c.quote_main,
      'quote_version_id', c.main_v1,
      'contracts_before', v_before_count,
      'contracts_after', v_after_count
    )::text
  );

exception
  when others then
    perform pg_temp._p9_68_contract_writer_record(
      5,
      'proposal vigente sem acceptance não pode criar contrato',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$contract_writer_without_acceptance$;



/* ============================================================================
 * 1. Authority, grants, RLS and append-only contract.
 * ========================================================================== */

do $s1$
declare
  v_writer oid;
  v_reader oid;
  v_ok boolean;
begin
  v_writer := pg_catalog.to_regprocedure(
    'public.accept_current_commercial_proposal_customer_signal_by_user(uuid,uuid,uuid,integer,uuid,uuid,uuid)'
  );

  v_reader := pg_catalog.to_regprocedure(
    'public.read_current_commercial_proposal_acceptance_by_system(uuid,uuid,uuid)'
  );

  select
    pg_catalog.to_regclass(
      'public.commercial_proposal_acceptance_events'
    ) is not null
    and v_writer is not null
    and v_reader is not null
    and exists (
      select 1
      from pg_catalog.pg_class relation_row
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = relation_row.relnamespace
      where namespace_row.nspname = 'public'
        and relation_row.relname =
          'commercial_proposal_acceptance_events'
        and relation_row.relrowsecurity
    )
    and pg_catalog.has_function_privilege(
      'authenticated',
      v_writer,
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role',
      v_writer,
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'anon',
      v_writer,
      'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'service_role',
      v_reader,
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      v_reader,
      'EXECUTE'
    )
    and not pg_catalog.has_table_privilege(
      'authenticated',
      'public.commercial_proposal_acceptance_events',
      'INSERT'
    )
    and not pg_catalog.has_table_privilege(
      'service_role',
      'public.commercial_proposal_acceptance_events',
      'INSERT'
    )
    and exists (
      select 1
      from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_class relation_row
        on relation_row.oid = trigger_row.tgrelid
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = relation_row.relnamespace
      where namespace_row.nspname = 'public'
        and relation_row.relname =
          'commercial_proposal_acceptance_events'
        and trigger_row.tgname =
          'commercial_proposal_acceptance_events_append_only'
        and not trigger_row.tgisinternal
    )
  into v_ok;

  perform pg_temp._p9_68_record(
    1,
    'authority possui RLS ACLs e append-only canônicos',
    v_ok
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      1,
      'authority possui RLS ACLs e append-only canônicos',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s1$;


/* ============================================================================
 * 2. Current proposal exists but is not accepted yet.
 * ========================================================================== */

do $s2$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;
begin
  select * into c from pg_temp._p9_68_ctx;

  select *
  into x
  from pg_temp._p9_68_call_reader(
    'service_role',
    null,
    c.org_a,
    c.store_a,
    c.opp_main
  );

  perform pg_temp._p9_68_record(
    2,
    'reader retorna current proposal ainda não aceita',
    x.operation_succeeded
      and x.value_json->>'acceptance_state' = 'none'
      and x.value_json->>'reason_code' =
        'current_proposal_not_accepted'
      and (x.value_json->>'stale_acceptance_count')::bigint = 0,
    coalesce(
      x.message_text,
      x.value_json::text
    )
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      2,
      'reader retorna current proposal ainda não aceita',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s2$;


/* ============================================================================
 * 3. No quote artifacts propagates canonical current_proposal_unknown.
 * ========================================================================== */

do $s3$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;
begin
  select * into c from pg_temp._p9_68_ctx;

  select *
  into x
  from pg_temp._p9_68_call_reader(
    'service_role',
    null,
    c.org_a,
    c.store_a,
    c.opp_none
  );

  perform pg_temp._p9_68_record(
    3,
    'sem quote enviada e sem pointer propaga current_proposal_unknown',
    x.operation_succeeded
      and x.value_json->>'acceptance_state' = 'none'
      and x.value_json->>'reason_code' =
        'current_proposal_unknown',
    coalesce(
      x.message_text,
      x.value_json::text
    )
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      3,
      'sem quote enviada e sem pointer propaga current_proposal_unknown',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s3$;


/* ============================================================================
 * 4. Valid active human confirmation writes exact v1 acceptance.
 * ========================================================================== */

do $s4$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;
  v_count bigint;
begin
  select * into c from pg_temp._p9_68_ctx;

  select *
  into x
  from pg_temp._p9_68_call_acceptance(
    c.user_active,
    c.org_a,
    c.store_a,
    c.opp_main,
    1,
    c.quote_main,
    c.main_v1,
    c.message_valid_v1
  );

  select pg_catalog.count(*)
  into v_count
  from public.commercial_proposal_acceptance_events e
  where e.organization_id = c.org_a
    and e.store_id = c.store_a
    and e.commercial_opportunity_id = c.opp_main
    and e.lifecycle_cycle = 1
    and e.quote_id = c.quote_main
    and e.quote_version_id = c.main_v1
    and e.source_message_id = c.message_valid_v1
    and e.confirmed_by_user_id = c.user_active;

  perform pg_temp._p9_68_record(
    4,
    'aceite válido grava exact current quote/version',
    x.operation_succeeded
      and x.value_json->>'outcome' = 'accepted'
      and x.value_json->>'quote_id' = c.quote_main::text
      and x.value_json->>'quote_version_id' = c.main_v1::text
      and x.value_json->>'source_message_id' =
        c.message_valid_v1::text
      and x.value_json->>'confirmed_by_user_id' =
        c.user_active::text
      and v_count = 1,
    coalesce(
      x.message_text,
      x.value_json::text
    )
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      4,
      'aceite válido grava exact current quote/version',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s4$;

-- ============================================================================
-- R2. Exact current proposal v1 was just accepted.
--     create_contract must now become READY.
-- ============================================================================

do $readiness_exact_acceptance$
declare
  c pg_temp._p9_68_ctx%rowtype;
  r record;
begin
  select *
  into c
  from pg_temp._p9_68_ctx;

  select *
  into r
  from public.p9_resolve_commercial_action_readiness_internal(
    c.org_a,
    c.store_a,
    c.opp_main,
    'create_contract'
  );

  perform pg_temp._p9_68_readiness_record(
    2,
    'create_contract libera somente acceptance exata da proposal vigente',
    r.readiness_state = 'ready'
      and r.reason_code =
        'create_contract_commercial_prerequisites_ready'
      and r.resolver_key = 'commercial_action_readiness'
      and r.resolver_version = 2
      and r.readiness_basis->>'schema' =
        'p9_commercial_action_readiness_v2'
      and r.readiness_basis->'details'
          ->>'proposal_acceptance_state' = 'accepted'
      and r.readiness_basis->'details'
          ->>'proposal_acceptance_reason_code' =
            'current_proposal_accepted'
      and r.readiness_basis->'details'
          ->>'proposal_acceptance_event_id' is not null
      and r.readiness_basis->'details'
          ->>'current_proposal_quote_id' =
            c.quote_main::text
      and r.readiness_basis->'details'
          ->>'current_proposal_quote_version_id' =
            c.main_v1::text,
    pg_catalog.to_jsonb(r)::text
  );
exception
  when others then
    perform pg_temp._p9_68_readiness_record(
      2,
      'create_contract libera somente acceptance exata da proposal vigente',
      false,
      sqlstate || ' ' || sqlerrm
    );
end;
$readiness_exact_acceptance$;



-- ============================================================================
-- W1. Exact accepted Current Proposal V1 creates contract from immutable
--     sales_quote_versions.quote_snapshot, never mutable sales_quotes content.
-- ============================================================================

do $contract_writer_v1_snapshot$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;

  v_contract public.sales_contracts%rowtype;
  v_acceptance_event_id uuid;

  v_mutable_subtotal integer;
  v_mutable_discount integer;
  v_mutable_total integer;

  v_contract_number text;
begin
  select *
  into c
  from pg_temp._p9_68_ctx;

  v_contract_number :=
    'P968-V1-'
    || pg_catalog.replace(c.main_v1::text, '-', '');

  select *
  into x
  from pg_temp._p9_68_exec_json_sql(
    'service_role',
    null,
    pg_catalog.format(
      $sql$
        select *
        from public.create_sales_contract_from_current_accepted_proposal_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::text
        )
      $sql$,
      c.org_a,
      c.store_a,
      c.opp_main,
      c.quote_main,
      c.main_v1,
      v_contract_number
    )
  );

  if not x.operation_succeeded then
    perform pg_temp._p9_68_contract_writer_record(
      1,
      'accepted V1 cria contrato com conteúdo do snapshot imutável exato',
      false,
      coalesce(
        x.returned_sqlstate || ' ' || x.message_text,
        x.message_text,
        '<writer failed without detail>'
      )
    );

    return;
  end if;

  if x.value_json->>'contract_id' is null then
    perform pg_temp._p9_68_contract_writer_record(
      1,
      'accepted V1 cria contrato com conteúdo do snapshot imutável exato',
      false,
      'writer returned success without contract_id'
    );

    return;
  end if;

  select contract_row.*
  into v_contract
  from public.sales_contracts contract_row
  where contract_row.id =
    (x.value_json->>'contract_id')::uuid;

  if not found then
    perform pg_temp._p9_68_contract_writer_record(
      1,
      'accepted V1 cria contrato com conteúdo do snapshot imutável exato',
      false,
      'writer returned contract_id that was not persisted'
    );

    return;
  end if;

  select
    quote_row.subtotal_cents,
    quote_row.discount_cents,
    quote_row.total_cents
  into
    v_mutable_subtotal,
    v_mutable_discount,
    v_mutable_total
  from public.sales_quotes quote_row
  where quote_row.id = c.quote_main;

  select acceptance_row.id
  into v_acceptance_event_id
  from public.commercial_proposal_acceptance_events acceptance_row
  where acceptance_row.organization_id = c.org_a
    and acceptance_row.store_id = c.store_a
    and acceptance_row.commercial_opportunity_id = c.opp_main
    and acceptance_row.lifecycle_cycle = 1
    and acceptance_row.quote_id = c.quote_main
    and acceptance_row.quote_version_id = c.main_v1;

  perform pg_temp._p9_68_contract_writer_record(
    1,
    'accepted V1 cria contrato com conteúdo do snapshot imutável exato',

    x.value_json->>'outcome' = 'created'

      and x.value_json->>'quote_id' =
        c.quote_main::text

      and x.value_json->>'quote_version_id' =
        c.main_v1::text

      and x.value_json->>'acceptance_event_id' =
        v_acceptance_event_id::text

      and v_contract.organization_id = c.org_a
      and v_contract.store_id = c.store_a
      and v_contract.quote_id = c.quote_main
      and v_contract.quote_version_id = c.main_v1

      and v_contract.status = 'pending_review'

      and v_contract.title =
        'Contrato - P9 6.8 Snapshot V1'

      and v_contract.customer_name =
        'Snapshot Customer V1'

      and v_contract.customer_phone =
        '5511991111111'

      and v_contract.subtotal_cents = 111000
      and v_contract.discount_cents = 1000
      and v_contract.total_cents = 110000

      and v_contract.payment_terms =
        'PIX snapshot V1'

      and v_contract.delivery_terms =
        'Entrega snapshot V1'

      and v_contract.warranty_terms =
        'Garantia snapshot V1'

      and v_contract.valid_until =
        '2026-12-31'::date

      and v_contract.metadata->>'source' =
        'accepted_quote_version_snapshot'

      and v_contract.metadata->>'quote_version_id' =
        c.main_v1::text

      and v_contract.metadata->>'proposal_acceptance_event_id' =
        v_acceptance_event_id::text

      /*
       * Explicit proof that the mutable quote header differs.
       * If the contract had read sales_quotes instead of quote_snapshot,
       * these assertions above would be 100000 / 0 / 100000 instead.
       */
      and v_mutable_subtotal = 100000
      and v_mutable_discount = 0
      and v_mutable_total = 100000
      and v_contract.total_cents <> v_mutable_total,

    pg_catalog.jsonb_build_object(
      'writer_result', x.value_json,
      'contract_id', v_contract.id,
      'contract_quote_id', v_contract.quote_id,
      'contract_quote_version_id', v_contract.quote_version_id,
      'contract_title', v_contract.title,
      'contract_customer_name', v_contract.customer_name,
      'contract_subtotal_cents', v_contract.subtotal_cents,
      'contract_discount_cents', v_contract.discount_cents,
      'contract_total_cents', v_contract.total_cents,
      'mutable_quote_subtotal_cents', v_mutable_subtotal,
      'mutable_quote_discount_cents', v_mutable_discount,
      'mutable_quote_total_cents', v_mutable_total,
      'acceptance_event_id', v_acceptance_event_id,
      'metadata', v_contract.metadata
    )::text
  );

exception
  when others then
    perform pg_temp._p9_68_contract_writer_record(
      1,
      'accepted V1 cria contrato com conteúdo do snapshot imutável exato',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$contract_writer_v1_snapshot$;

-- ============================================================================
-- W2. Replay of the exact same quote/version lineage is idempotent.
--     A different caller-generated contract number must NOT create or rename.
-- ============================================================================

do $contract_writer_v1_replay$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;

  v_existing public.sales_contracts%rowtype;

  v_before_count bigint;
  v_after_count bigint;

  v_replay_contract_number text;
begin
  select *
  into c
  from pg_temp._p9_68_ctx;

  select pg_catalog.count(*)
  into v_before_count
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
    and contract_row.status not in (
      'cancelled',
      'expired',
      'failed'
    );

  select contract_row.*
  into v_existing
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
    and contract_row.status not in (
      'cancelled',
      'expired',
      'failed'
    )
  limit 1;

  if not found then
    perform pg_temp._p9_68_contract_writer_record(
      2,
      'replay da mesma quote/version retorna contrato existente sem duplicar',
      false,
      'W1 contract was not found before replay',
      true
    );

    return;
  end if;

  v_replay_contract_number :=
    'P968-V1-REPLAY-'
    || pg_catalog.replace(c.main_v1::text, '-', '');

  select *
  into x
  from pg_temp._p9_68_exec_json_sql(
    'service_role',
    null,
    pg_catalog.format(
      $sql$
        select *
        from public.create_sales_contract_from_current_accepted_proposal_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::text
        )
      $sql$,
      c.org_a,
      c.store_a,
      c.opp_main,
      c.quote_main,
      c.main_v1,
      v_replay_contract_number
    )
  );

  select pg_catalog.count(*)
  into v_after_count
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
    and contract_row.status not in (
      'cancelled',
      'expired',
      'failed'
    );

  perform pg_temp._p9_68_contract_writer_record(
    2,
    'replay da mesma quote/version retorna contrato existente sem duplicar',

    x.operation_succeeded

      and x.value_json->>'outcome' =
        'already_exists'

      and x.value_json->>'contract_id' =
        v_existing.id::text

      and x.value_json->>'quote_id' =
        c.quote_main::text

      and x.value_json->>'quote_version_id' =
        c.main_v1::text

      and x.value_json->>'contract_number' =
        v_existing.contract_number

      and v_existing.contract_number <>
        v_replay_contract_number

      and v_before_count = 1
      and v_after_count = 1,

    pg_catalog.jsonb_build_object(
      'writer_result', x.value_json,
      'existing_contract_id', v_existing.id,
      'existing_contract_number', v_existing.contract_number,
      'replay_requested_contract_number', v_replay_contract_number,
      'active_count_before', v_before_count,
      'active_count_after', v_after_count
    )::text
  );

exception
  when others then
    perform pg_temp._p9_68_contract_writer_record(
      2,
      'replay da mesma quote/version retorna contrato existente sem duplicar',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$contract_writer_v1_replay$;


/* ============================================================================
 * 5. Replay is idempotent and preserves first fact.
 * ========================================================================== */
do $s5$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;
  v_count bigint;
begin
  select * into c from pg_temp._p9_68_ctx;

  select *
  into x
  from pg_temp._p9_68_call_acceptance(
    c.user_active,
    c.org_a,
    c.store_a,
    c.opp_main,
    1,
    c.quote_main,
    c.main_v1,
    c.message_valid_v1
  );

  select pg_catalog.count(*)
  into v_count
  from public.commercial_proposal_acceptance_events e
  where e.organization_id = c.org_a
    and e.store_id = c.store_a
    and e.commercial_opportunity_id = c.opp_main
    and e.lifecycle_cycle = 1
    and e.quote_id = c.quote_main
    and e.quote_version_id = c.main_v1;

  perform pg_temp._p9_68_record(
    5,
    'replay não duplica aceite da mesma proposal exata',
    x.operation_succeeded
      and x.value_json->>'outcome' = 'already_accepted'
      and v_count = 1,
    coalesce(
      x.message_text,
      x.value_json::text
    )
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      5,
      'replay não duplica aceite da mesma proposal exata',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s5$;


/* ============================================================================
 * 6. Inactive membership cannot confirm acceptance.
 * ========================================================================== */

do $s6$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;
begin
  select * into c from pg_temp._p9_68_ctx;

  select *
  into x
  from pg_temp._p9_68_call_acceptance(
    c.user_inactive,
    c.org_a,
    c.store_a,
    c.opp_main,
    1,
    c.quote_main,
    c.main_v1,
    c.message_valid_v1
  );

  perform pg_temp._p9_68_record(
    6,
    'membership inativa não confirma aceite',
    not x.operation_succeeded
      and x.returned_sqlstate = '42501',
    x.message_text
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      6,
      'membership inativa não confirma aceite',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s6$;


/* ============================================================================
 * 7. Lifecycle mismatch fails closed.
 * ========================================================================== */

do $s7$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;
begin
  select * into c from pg_temp._p9_68_ctx;

  select *
  into x
  from pg_temp._p9_68_call_acceptance(
    c.user_active,
    c.org_a,
    c.store_a,
    c.opp_main,
    2,
    c.quote_main,
    c.main_v1,
    c.message_valid_v1
  );

  perform pg_temp._p9_68_record(
    7,
    'lifecycle stale falha fechado',
    not x.operation_succeeded
      and x.returned_sqlstate = '23514'
      and x.message_text =
        'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_LIFECYCLE_STALE',
    x.message_text
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      7,
      'lifecycle stale falha fechado',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s7$;


/* ============================================================================
 * 8. Non-current quote/version pair fails closed.
 * ========================================================================== */

do $s8$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;
begin
  select * into c from pg_temp._p9_68_ctx;

  select *
  into x
  from pg_temp._p9_68_call_acceptance(
    c.user_active,
    c.org_a,
    c.store_a,
    c.opp_main,
    1,
    c.quote_main,
    c.main_v2,
    c.message_valid_v1
  );

  perform pg_temp._p9_68_record(
    8,
    'proposal não vigente não pode ser aceita',
    not x.operation_succeeded
      and x.returned_sqlstate = '23514'
      and x.message_text =
        'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_PROPOSAL_STALE',
    x.message_text
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      8,
      'proposal não vigente não pode ser aceita',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s8$;


/* ============================================================================
 * 9. Message resolved/captured for another opportunity is rejected.
 * ========================================================================== */

do $s9$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;
begin
  select * into c from pg_temp._p9_68_ctx;

  select *
  into x
  from pg_temp._p9_68_call_acceptance(
    c.user_active,
    c.org_a,
    c.store_a,
    c.opp_main,
    1,
    c.quote_main,
    c.main_v1,
    c.message_other_opp
  );

  perform pg_temp._p9_68_record(
    9,
    'evidence de outra opportunity é rejeitada',
    not x.operation_succeeded
      and x.returned_sqlstate = '23514',
    x.message_text
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      9,
      'evidence de outra opportunity é rejeitada',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s9$;


/* ============================================================================
 * 10. Outbound/AI message cannot be customer acceptance evidence.
 * ========================================================================== */

do $s10$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;
begin
  select * into c from pg_temp._p9_68_ctx;

  select *
  into x
  from pg_temp._p9_68_call_acceptance(
    c.user_active,
    c.org_a,
    c.store_a,
    c.opp_main,
    1,
    c.quote_main,
    c.main_v1,
    c.message_outbound
  );

  perform pg_temp._p9_68_record(
    10,
    'somente customer inbound pode provar aceite',
    not x.operation_succeeded
      and x.returned_sqlstate = '23514'
      and x.message_text =
        'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_MESSAGE_NOT_CUSTOMER_INBOUND',
    x.message_text
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      10,
      'somente customer inbound pode provar aceite',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s10$;


/* ============================================================================
 * 11. Message before proposal send cannot accept proposal.
 * ========================================================================== */

do $s11$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;
begin
  select * into c from pg_temp._p9_68_ctx;

  select *
  into x
  from pg_temp._p9_68_call_acceptance(
    c.user_active,
    c.org_a,
    c.store_a,
    c.opp_past,
    1,
    c.quote_past,
    c.past_v1,
    c.message_past
  );

  perform pg_temp._p9_68_record(
    11,
    'mensagem anterior ao envio não pode aceitar proposta',
    not x.operation_succeeded
      and x.returned_sqlstate = '23514'
      and x.message_text =
        'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_MESSAGE_PREDATES_PROPOSAL',
    x.message_text
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      11,
      'mensagem anterior ao envio não pode aceitar proposta',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s11$;


/* ============================================================================
 * 12. Current pointer to an unsent version cannot be accepted.
 * ========================================================================== */

do $s12$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;
begin
  select * into c from pg_temp._p9_68_ctx;

  select *
  into x
  from pg_temp._p9_68_call_acceptance(
    c.user_active,
    c.org_a,
    c.store_a,
    c.opp_notsent,
    1,
    c.quote_notsent,
    c.notsent_v1,
    c.message_valid_v1
  );

  perform pg_temp._p9_68_record(
    12,
    'versão não enviada não pode ser aceita',
    not x.operation_succeeded
      and x.returned_sqlstate = '23514'
      and x.message_text =
        'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_VERSION_NOT_SENT',
    x.message_text
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      12,
      'versão não enviada não pode ser aceita',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s12$;


/* ============================================================================
 * 13. Wrong store scope fails closed.
 * ========================================================================== */

do $s13$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;
begin
  select * into c from pg_temp._p9_68_ctx;

  select *
  into x
  from pg_temp._p9_68_call_acceptance(
    c.user_active,
    c.org_a,
    c.store_b_same_org,
    c.opp_main,
    1,
    c.quote_main,
    c.main_v1,
    c.message_valid_v1
  );

  perform pg_temp._p9_68_record(
    13,
    'store scope incorreto falha fechado',
    not x.operation_succeeded
      and x.returned_sqlstate = '23514',
    x.message_text
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      13,
      'store scope incorreto falha fechado',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s13$;


/* ============================================================================
 * 14. Acceptance facts are append-only.
 * ========================================================================== */

do $s14$
declare
  c pg_temp._p9_68_ctx%rowtype;
  v_blocked boolean := false;
begin
  select * into c from pg_temp._p9_68_ctx;

  begin
    update public.commercial_proposal_acceptance_events
    set accepted_at = pg_catalog.clock_timestamp()
    where organization_id = c.org_a
      and store_id = c.store_a
      and commercial_opportunity_id = c.opp_main
      and lifecycle_cycle = 1
      and quote_id = c.quote_main
      and quote_version_id = c.main_v1;
  exception
    when others then
      v_blocked :=
        sqlstate = 'P0001'
        and sqlerrm =
          'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_APPEND_ONLY';
  end;

  perform pg_temp._p9_68_record(
    14,
    'evento de acceptance é append-only',
    v_blocked
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      14,
      'evento de acceptance é append-only',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s14$;


/* ============================================================================
 * 15. Reader resolves v1 as currently accepted.
 * ========================================================================== */

do $s15$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;
begin
  select * into c from pg_temp._p9_68_ctx;

  select *
  into x
  from pg_temp._p9_68_call_reader(
    'service_role',
    null,
    c.org_a,
    c.store_a,
    c.opp_main
  );

  perform pg_temp._p9_68_record(
    15,
    'reader resolve v1 aceita enquanto ela é current',
    x.operation_succeeded
      and x.value_json->>'acceptance_state' = 'accepted'
      and x.value_json->>'reason_code' =
        'current_proposal_accepted'
      and x.value_json->>'current_quote_id' =
        c.quote_main::text
      and x.value_json->>'current_quote_version_id' =
        c.main_v1::text
      and x.value_json->>'source_message_id' =
        c.message_valid_v1::text
      and (x.value_json->>'stale_acceptance_count')::bigint = 0,
    coalesce(
      x.message_text,
      x.value_json::text
    )
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      15,
      'reader resolve v1 aceita enquanto ela é current',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s15$;


/* ============================================================================
 * 16. New canonical send advances pointer and automatically stales v1.
 * ========================================================================== */

do $s16$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;
begin
  select * into c from pg_temp._p9_68_ctx;

  update public.sales_quote_versions
  set
    status = 'sent',
    sent_at = pg_catalog.clock_timestamp() - interval '1 second'
  where id = c.main_v2;

  update public.sales_quotes
  set
    status = 'sent',
    current_version_id = c.main_v2
  where id = c.quote_main;

  perform *
  from public.set_current_commercial_proposal_from_sent_quote_by_system(
    c.org_a,
    c.store_a,
    c.opp_main,
    c.quote_main,
    c.main_v2,
    'current_commercial_proposal:'
      || c.opp_main::text
      || ':'
      || c.quote_main::text
      || ':'
      || c.main_v2::text,
    'p9_6_8_acceptance_runner_v2'
  );

  select *
  into x
  from pg_temp._p9_68_call_reader(
    'service_role',
    null,
    c.org_a,
    c.store_a,
    c.opp_main
  );

  perform pg_temp._p9_68_record(
    16,
    'novo envio torna acceptance anterior stale sem apagar histórico',
    x.operation_succeeded
      and x.value_json->>'acceptance_state' = 'none'
      and x.value_json->>'reason_code' =
        'current_proposal_acceptance_stale'
      and x.value_json->>'current_quote_version_id' =
        c.main_v2::text
      and (x.value_json->>'stale_acceptance_count')::bigint = 1,
    coalesce(
      x.message_text,
      x.value_json::text
    )
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      16,
      'novo envio torna acceptance anterior stale sem apagar histórico',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s16$;

-- ============================================================================
-- R3. Current Proposal advanced to v2 while only v1 was accepted.
--     Historical v1 acceptance must become stale and block create_contract.
-- ============================================================================

do $readiness_stale_acceptance$
declare
  c pg_temp._p9_68_ctx%rowtype;
  r record;
begin
  select *
  into c
  from pg_temp._p9_68_ctx;

  select *
  into r
  from public.p9_resolve_commercial_action_readiness_internal(
    c.org_a,
    c.store_a,
    c.opp_main,
    'create_contract'
  );

  perform pg_temp._p9_68_readiness_record(
    3,
    'nova proposal invalida acceptance antiga para create_contract',
    r.readiness_state = 'blocked'
      and r.reason_code =
        'create_contract_current_proposal_acceptance_stale'
      and r.resolver_key = 'commercial_action_readiness'
      and r.resolver_version = 2
      and r.readiness_basis->>'schema' =
        'p9_commercial_action_readiness_v2'
      and r.readiness_basis->'details'
          ->>'proposal_acceptance_state' = 'none'
      and r.readiness_basis->'details'
          ->>'proposal_acceptance_reason_code' =
            'current_proposal_acceptance_stale'
      and (
        r.readiness_basis->'details'
          ->>'proposal_acceptance_stale_count'
      )::bigint >= 1
      and r.readiness_basis->'details'
          ->>'current_proposal_quote_id' =
            c.quote_main::text
      and r.readiness_basis->'details'
          ->>'current_proposal_quote_version_id' =
            c.main_v2::text,
    pg_catalog.to_jsonb(r)::text
  );
exception
  when others then
    perform pg_temp._p9_68_readiness_record(
      3,
      'nova proposal invalida acceptance antiga para create_contract',
      false,
      sqlstate || ' ' || sqlerrm
    );
end;
$readiness_stale_acceptance$;

-- ============================================================================
-- W3. After Current Proposal advances to V2, old accepted V1 is stale and
--     cannot create/replay a contract through the canonical writer.
-- ============================================================================

do $contract_writer_stale_v1$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;

  v_before_count bigint;
  v_after_count bigint;

  v_contract_number text;
begin
  select *
  into c
  from pg_temp._p9_68_ctx;

  select pg_catalog.count(*)
  into v_before_count
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
    and contract_row.status not in (
      'cancelled',
      'expired',
      'failed'
    );

  v_contract_number :=
    'P968-STALE-V1-'
    || pg_catalog.replace(c.main_v1::text, '-', '');

  select *
  into x
  from pg_temp._p9_68_exec_json_sql(
    'service_role',
    null,
    pg_catalog.format(
      $sql$
        select *
        from public.create_sales_contract_from_current_accepted_proposal_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::text
        )
      $sql$,
      c.org_a,
      c.store_a,
      c.opp_main,
      c.quote_main,
      c.main_v1,
      v_contract_number
    )
  );

  select pg_catalog.count(*)
  into v_after_count
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
    and contract_row.status not in (
      'cancelled',
      'expired',
      'failed'
    );

  perform pg_temp._p9_68_contract_writer_record(
    3,
    'V1 stale é rejeitada depois que V2 vira Current Proposal',

    not x.operation_succeeded

      and x.returned_sqlstate = 'P0001'

      and x.message_text =
        'ZION_CONTRACT_CREATE_PROPOSAL_STALE'

      and v_before_count = 1
      and v_after_count = 1,

    pg_catalog.jsonb_build_object(
      'operation_succeeded', x.operation_succeeded,
      'returned_sqlstate', x.returned_sqlstate,
      'message_text', x.message_text,
      'requested_quote_id', c.quote_main,
      'requested_quote_version_id', c.main_v1,
      'current_quote_version_id', c.main_v2,
      'active_v1_contracts_before', v_before_count,
      'active_v1_contracts_after', v_after_count
    )::text
  );

exception
  when others then
    perform pg_temp._p9_68_contract_writer_record(
      3,
      'V1 stale é rejeitada depois que V2 vira Current Proposal',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$contract_writer_stale_v1$;



/* ============================================================================
 * 17. After v2 becomes current, v1 cannot be accepted again.
 * ========================================================================== */

do $s17$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;
begin
  select * into c from pg_temp._p9_68_ctx;

  select *
  into x
  from pg_temp._p9_68_call_acceptance(
    c.user_active,
    c.org_a,
    c.store_a,
    c.opp_main,
    1,
    c.quote_main,
    c.main_v1,
    c.message_valid_v1
  );

  perform pg_temp._p9_68_record(
    17,
    'v1 stale não pode voltar a ser current acceptance',
    not x.operation_succeeded
      and x.returned_sqlstate = '23514'
      and x.message_text =
        'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_PROPOSAL_STALE',
    x.message_text
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      17,
      'v1 stale não pode voltar a ser current acceptance',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s17$;


/* ============================================================================
 * 18. New inbound after v2 send can accept exact v2.
 * ========================================================================== */

do $s18$
declare
  c pg_temp._p9_68_ctx%rowtype;
  v_message public.messages;
  x record;
  v_count bigint;
begin
  select * into c from pg_temp._p9_68_ctx;

  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'service_role',
    true
  );

  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'role',
      'service_role'
    )::text,
    true
  );

  execute 'set local role service_role';

  select *
  into v_message
  from public.insert_message(
    c.conv_main,
    'user',
    'incoming',
    'text',
    'aceito a versão nova',
    'p9-6-8-main-v2-' || c.conv_main::text,
    null,
    '{}'::jsonb
  );

  execute 'reset role';

  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    '',
    true
  );

  perform pg_catalog.set_config(
    'request.jwt.claims',
    '',
    true
  );

  update pg_temp._p9_68_ctx
  set message_valid_v2 = v_message.id;

  select * into c from pg_temp._p9_68_ctx;

  select *
  into x
  from pg_temp._p9_68_call_acceptance(
    c.user_active,
    c.org_a,
    c.store_a,
    c.opp_main,
    1,
    c.quote_main,
    c.main_v2,
    c.message_valid_v2
  );

  select pg_catalog.count(*)
  into v_count
  from public.commercial_proposal_acceptance_events e
  where e.organization_id = c.org_a
    and e.store_id = c.store_a
    and e.commercial_opportunity_id = c.opp_main;

  perform pg_temp._p9_68_record(
    18,
    'novo inbound aceita exatamente v2 vigente',
    x.operation_succeeded
      and x.value_json->>'outcome' = 'accepted'
      and x.value_json->>'quote_version_id' = c.main_v2::text
      and x.value_json->>'source_message_id' =
        c.message_valid_v2::text
      and v_count = 2,
    coalesce(
      x.message_text,
      x.value_json::text
    )
  );
exception
  when others then
    begin
      execute 'reset role';
    exception
      when others then
        null;
    end;

    perform pg_catalog.set_config(
      'request.jwt.claim.role',
      '',
      true
    );

    perform pg_catalog.set_config(
      'request.jwt.claims',
      '',
      true
    );

    perform pg_temp._p9_68_record(
      18,
      'novo inbound aceita exatamente v2 vigente',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s18$;


/* ============================================================================
 * 19. Reader resolves v2 and preserves one stale historical v1.
 * ========================================================================== */

do $s19$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;
begin
  select * into c from pg_temp._p9_68_ctx;

  select *
  into x
  from pg_temp._p9_68_call_reader(
    'service_role',
    null,
    c.org_a,
    c.store_a,
    c.opp_main
  );

  perform pg_temp._p9_68_record(
    19,
    'reader retorna v2 aceita e mantém v1 apenas como stale',
    x.operation_succeeded
      and x.value_json->>'acceptance_state' = 'accepted'
      and x.value_json->>'reason_code' =
        'current_proposal_accepted'
      and x.value_json->>'current_quote_version_id' =
        c.main_v2::text
      and x.value_json->>'source_message_id' =
        c.message_valid_v2::text
      and (x.value_json->>'stale_acceptance_count')::bigint = 1,
    coalesce(
      x.message_text,
      x.value_json::text
    )
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      19,
      'reader retorna v2 aceita e mantém v1 apenas como stale',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s19$;

-- ============================================================================
-- W4. Accepted Current Proposal V2 creates its own exact-lineage contract.
--     Existing active V1 contract must not block a different accepted version.
-- ============================================================================

do $contract_writer_v2_exact_lineage$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;

  v_contract public.sales_contracts%rowtype;

  v_v1_count_before bigint;
  v_v2_count_before bigint;

  v_v1_count_after bigint;
  v_v2_count_after bigint;
  v_quote_active_count_after bigint;

  v_contract_number text;
begin
  select *
  into c
  from pg_temp._p9_68_ctx;

  select pg_catalog.count(*)
  into v_v1_count_before
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
    and contract_row.status not in (
      'cancelled',
      'expired',
      'failed'
    );

  select pg_catalog.count(*)
  into v_v2_count_before
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v2
    and contract_row.status not in (
      'cancelled',
      'expired',
      'failed'
    );

  v_contract_number :=
    'P968-V2-'
    || pg_catalog.replace(c.main_v2::text, '-', '');

  select *
  into x
  from pg_temp._p9_68_exec_json_sql(
    'service_role',
    null,
    pg_catalog.format(
      $sql$
        select *
        from public.create_sales_contract_from_current_accepted_proposal_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::text
        )
      $sql$,
      c.org_a,
      c.store_a,
      c.opp_main,
      c.quote_main,
      c.main_v2,
      v_contract_number
    )
  );

  if not x.operation_succeeded then
    perform pg_temp._p9_68_contract_writer_record(
      4,
      'V2 aceita cria contrato próprio sem ser bloqueada pelo contrato V1',
      false,
      coalesce(
        x.returned_sqlstate || ' ' || x.message_text,
        x.message_text,
        '<writer failed without detail>'
      )
    );

    return;
  end if;

  if x.value_json->>'contract_id' is null then
    perform pg_temp._p9_68_contract_writer_record(
      4,
      'V2 aceita cria contrato próprio sem ser bloqueada pelo contrato V1',
      false,
      'writer returned success without contract_id'
    );

    return;
  end if;

  select contract_row.*
  into v_contract
  from public.sales_contracts contract_row
  where contract_row.id =
    (x.value_json->>'contract_id')::uuid;

  if not found then
    perform pg_temp._p9_68_contract_writer_record(
      4,
      'V2 aceita cria contrato próprio sem ser bloqueada pelo contrato V1',
      false,
      'V2 contract_id was not persisted'
    );

    return;
  end if;

  select pg_catalog.count(*)
  into v_v1_count_after
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
    and contract_row.status not in (
      'cancelled',
      'expired',
      'failed'
    );

  select pg_catalog.count(*)
  into v_v2_count_after
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v2
    and contract_row.status not in (
      'cancelled',
      'expired',
      'failed'
    );

  select pg_catalog.count(*)
  into v_quote_active_count_after
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.status not in (
      'cancelled',
      'expired',
      'failed'
    );

  perform pg_temp._p9_68_contract_writer_record(
    4,
    'V2 aceita cria contrato próprio sem ser bloqueada pelo contrato V1',

    x.value_json->>'outcome' = 'created'

      and x.value_json->>'quote_id' =
        c.quote_main::text

      and x.value_json->>'quote_version_id' =
        c.main_v2::text

      and v_contract.quote_id = c.quote_main
      and v_contract.quote_version_id = c.main_v2

      and v_contract.status = 'pending_review'

      and v_contract.title =
        'Contrato - P9 6.8 Snapshot V2'

      and v_contract.customer_name =
        'Snapshot Customer V2'

      and v_contract.customer_phone =
        '5511992222222'

      and v_contract.subtotal_cents = 222000
      and v_contract.discount_cents = 2000
      and v_contract.total_cents = 220000

      and v_contract.payment_terms =
        'Cartao snapshot V2'

      and v_contract.delivery_terms =
        'Entrega snapshot V2'

      and v_contract.warranty_terms =
        'Garantia snapshot V2'

      and v_contract.valid_until =
        '2027-01-31'::date

      and v_contract.metadata->>'source' =
        'accepted_quote_version_snapshot'

      and v_contract.metadata->>'quote_version_id' =
        c.main_v2::text

      /*
       * Exact-version duplicate semantics:
       * V1 remains a historical downstream artifact,
       * but it cannot block creation for accepted/current V2.
       */
      and v_v1_count_before = 1
      and v_v2_count_before = 0
      and v_v1_count_after = 1
      and v_v2_count_after = 1
      and v_quote_active_count_after = 2,

    pg_catalog.jsonb_build_object(
      'writer_result', x.value_json,
      'contract_id', v_contract.id,
      'contract_quote_version_id', v_contract.quote_version_id,
      'contract_title', v_contract.title,
      'contract_total_cents', v_contract.total_cents,
      'v1_active_before', v_v1_count_before,
      'v2_active_before', v_v2_count_before,
      'v1_active_after', v_v1_count_after,
      'v2_active_after', v_v2_count_after,
      'quote_active_contracts_after', v_quote_active_count_after,
      'metadata', v_contract.metadata
    )::text
  );

exception
  when others then
    perform pg_temp._p9_68_contract_writer_record(
      4,
      'V2 aceita cria contrato próprio sem ser bloqueada pelo contrato V1',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$contract_writer_v2_exact_lineage$;


/* ============================================================================
 * 20. Composite FKs structurally reject mixed tenant/store lineage.
 * ========================================================================== */

do $s20$
declare
  c pg_temp._p9_68_ctx%rowtype;
  v_blocked boolean := false;
begin
  select * into c from pg_temp._p9_68_ctx;

  begin
    insert into public.commercial_proposal_acceptance_events (
      organization_id,
      store_id,
      commercial_opportunity_id,
      customer_id,
      lifecycle_cycle,
      quote_id,
      quote_version_id,
      source_message_id,
      signal_kind,
      customer_signal_at,
      confirmed_by_user_id,
      accepted_at
    )
    values (
      c.org_a,
      c.store_b_same_org,
      c.opp_main,
      c.customer_a,
      1,
      c.quote_main,
      c.main_v2,
      c.message_valid_v2,
      'customer_accepted_quote',
      pg_catalog.clock_timestamp(),
      c.user_active,
      pg_catalog.clock_timestamp()
    );
  exception
    when foreign_key_violation then
      v_blocked := true;
  end;

  perform pg_temp._p9_68_record(
    20,
    'FKs compostas impedem lineage multi-tenant/store inconsistente',
    v_blocked
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      20,
      'FKs compostas impedem lineage multi-tenant/store inconsistente',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s20$;


/* ============================================================================
 * 21. Reopened lifecycle remains unanchored exactly as defined by P9 6.7.
 * ========================================================================== */

do $s21$
declare
  c pg_temp._p9_68_ctx%rowtype;

  v_opp_cycle2 uuid := gen_random_uuid();
  v_quote_cycle2 uuid := gen_random_uuid();
  v_version_cycle2 uuid := gen_random_uuid();

  x_reader record;
  x_writer record;

  v_cycle2_count bigint;
begin
  select * into c from pg_temp._p9_68_ctx;

  /*
   * Fixture estrutural legítima:
   * nasce diretamente em lifecycle_cycle=2 para testar o comportamento
   * fail-closed da Current Commercial Proposal sem violar o writer
   * canônico de lifecycle.
   */
  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    origin_lead_id,
    primary_conversation_id,
    stage,
    lifecycle_cycle
  )
  values (
    v_opp_cycle2,
    c.org_a,
    c.store_a,
    c.customer_a,
    c.lead_a,
    c.conv_main,
    'orcamento',
    2
  );

  insert into public.sales_quotes (
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
    customer_notes,
    internal_notes,
    subtotal_cents,
    discount_cents,
    total_cents,
    current_version_id,
    metadata
  )
  values (
    v_quote_cycle2,
    c.org_a,
    c.store_a,
    v_opp_cycle2,
    c.conv_main,
    c.lead_a,
    'P968-CYCLE2-' ||
      pg_catalog.replace(v_quote_cycle2::text, '-', ''),
    'P9 6.8 Cycle 2',
    'sent',
    'P9 6.8 Customer',
    null,
    null,
    null,
    400000,
    0,
    400000,
    null,
    '{"runner":"p9.6.8","case":"cycle2"}'::jsonb
  );

  insert into public.sales_quote_versions (
    id,
    organization_id,
    store_id,
    quote_id,
    version_number,
    status,
    quote_kind,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    generated_by,
    quote_snapshot,
    created_at,
    sent_at
  )
  values (
    v_version_cycle2,
    c.org_a,
    c.store_a,
    v_quote_cycle2,
    1,
    'sent',
    'definitive',
    'zion-store-files',
    'p9/6-8/cycle2-v1.pdf',
    'cycle2-v1.pdf',
    'application/pdf',
    100,
    'system',
    '{}'::jsonb,
    pg_catalog.clock_timestamp() - interval '2 minutes',
    pg_catalog.clock_timestamp() - interval '1 minute'
  );

  update public.sales_quotes
  set current_version_id = v_version_cycle2
  where id = v_quote_cycle2;

  /*
   * Os dois campos são escritos juntos, respeitando
   * commercial_opportunities_current_quote_pair_check.
   */
  update public.commercial_opportunities
  set
    current_quote_id = v_quote_cycle2,
    current_quote_version_id = v_version_cycle2
  where id = v_opp_cycle2;

  select *
  into x_reader
  from pg_temp._p9_68_call_reader(
    'service_role',
    null,
    c.org_a,
    c.store_a,
    v_opp_cycle2
  );

  select *
  into x_writer
  from pg_temp._p9_68_call_acceptance(
    c.user_active,
    c.org_a,
    c.store_a,
    v_opp_cycle2,
    2,
    v_quote_cycle2,
    v_version_cycle2,
    c.message_valid_v2
  );

  select pg_catalog.count(*)
  into v_cycle2_count
  from public.commercial_proposal_acceptance_events e
  where e.organization_id = c.org_a
    and e.store_id = c.store_a
    and e.commercial_opportunity_id = v_opp_cycle2
    and e.lifecycle_cycle = 2;

  perform pg_temp._p9_68_record(
    21,
    'lifecycle reaberto sem proposal-cycle lineage permanece fail-closed',
    x_reader.operation_succeeded
      and x_reader.value_json->>'acceptance_state' =
        'needs_resolution'
      and x_reader.value_json->>'reason_code' =
        'current_proposal_cycle_unanchored'
      and (x_reader.value_json->>'stale_acceptance_count')::bigint = 0
      and not x_writer.operation_succeeded
      and x_writer.returned_sqlstate = '23514'
      and x_writer.message_text =
        'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_CURRENT_PROPOSAL_CYCLE_UNANCHORED'
      and v_cycle2_count = 0,
    'reader='
      || coalesce(
           x_reader.message_text,
           x_reader.value_json::text,
           'null'
         )
      || ' writer='
      || coalesce(
           x_writer.message_text,
           x_writer.value_json::text,
           'null'
         )
      || ' cycle2_events='
      || v_cycle2_count::text
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      21,
      'lifecycle reaberto sem proposal-cycle lineage permanece fail-closed',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s21$;

/* ============================================================================
 * 22. Sent quote without explicit pointer propagates 6.7 needs_resolution.
 * ========================================================================== */

do $s22$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;
begin
  select * into c from pg_temp._p9_68_ctx;

  /*
   * O cenário de predate já terminou no s11.
   * Mantemos a quote/version enviada historicamente e removemos somente
   * o pointer da opportunity.
   */
  update public.commercial_opportunities
  set
    current_quote_id = null,
    current_quote_version_id = null
  where id = c.opp_past;

  select *
  into x
  from pg_temp._p9_68_call_reader(
    'service_role',
    null,
    c.org_a,
    c.store_a,
    c.opp_past
  );

  perform pg_temp._p9_68_record(
    22,
    'quote enviada sem pointer propaga needs_resolution da 6.7',
    x.operation_succeeded
      and x.value_json->>'acceptance_state' = 'needs_resolution'
      and x.value_json->>'reason_code' =
        'quote_sent_without_current_proposal'
      and x.value_json->>'current_quote_id' is null
      and x.value_json->>'current_quote_version_id' is null,
    coalesce(
      x.message_text,
      x.value_json::text
    )
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      22,
      'quote enviada sem pointer propaga needs_resolution da 6.7',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s22$;


/* ============================================================================
 * 23. Complete pointer without canonical sent evidence propagates CONFLICT.
 * ========================================================================== */

do $s23$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;
begin
  select * into c from pg_temp._p9_68_ctx;

  /*
   * opp_notsent já possui:
   *   current_quote_id = quote_notsent
   *   current_quote_version_id = notsent_v1
   *
   * A version existe, porém está generated e sent_at=NULL.
   */
  select *
  into x
  from pg_temp._p9_68_call_reader(
    'service_role',
    null,
    c.org_a,
    c.store_a,
    c.opp_notsent
  );

  perform pg_temp._p9_68_record(
    23,
    'pointer sem sent evidence propaga conflict da 6.7',
    x.operation_succeeded
      and x.value_json->>'acceptance_state' = 'conflict'
      and x.value_json->>'reason_code' =
        'current_proposal_sent_evidence_conflict'
      and x.value_json->>'current_quote_id' =
        c.quote_notsent::text
      and x.value_json->>'current_quote_version_id' =
        c.notsent_v1::text,
    coalesce(
      x.message_text,
      x.value_json::text
    )
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      23,
      'pointer sem sent evidence propaga conflict da 6.7',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s23$;


/* ============================================================================
 * 24. Incomplete current proposal pair propagates canonical pair conflict.
 * ========================================================================== */

do $s24$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;

  v_blocked boolean := false;
  v_constraint text;
  v_state text;
  v_message text;
begin
  select * into c from pg_temp._p9_68_ctx;

  /*
   * current_proposal_pair_conflict permanece um estado defensivo
   * reconhecido pela authority 6.7, mas um banco íntegro não permite
   * fabricar esse estado: quote_id/version_id precisam ser null/null
   * ou ambos preenchidos.
   */
  begin
    update public.commercial_opportunities
    set current_quote_id = c.quote_main
    where id = c.opp_none;

  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;

      v_blocked :=
        v_state = '23514'
        and v_constraint =
          'commercial_opportunities_current_quote_pair_check';
  end;

  /*
   * A subtransaction acima reverte o UPDATE inválido.
   * A opportunity deve continuar sem pointer e o reader deve continuar
   * refletindo current_proposal_unknown.
   */
  select *
  into x
  from pg_temp._p9_68_call_reader(
    'service_role',
    null,
    c.org_a,
    c.store_a,
    c.opp_none
  );

  perform pg_temp._p9_68_record(
    24,
    'pointer incompleto é estruturalmente impossível no schema canônico',
    v_blocked
      and x.operation_succeeded
      and x.value_json->>'acceptance_state' = 'none'
      and x.value_json->>'reason_code' =
        'current_proposal_unknown'
      and x.value_json->>'current_quote_id' is null
      and x.value_json->>'current_quote_version_id' is null,
    'blocked='
      || v_blocked::text
      || ' constraint='
      || coalesce(v_constraint, 'null')
      || ' error='
      || coalesce(v_message, 'null')
      || ' reader='
      || coalesce(
           x.message_text,
           x.value_json::text,
           'null'
         )
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      24,
      'pointer incompleto é estruturalmente impossível no schema canônico',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$s24$;

/* ============================================================================
 * Final report
 * ========================================================================== */

table pg_temp._p9_68_results
order by scenario_number;

select
  pg_catalog.count(*) filter (
    where status = 'PASS'
  ) as passed,

  pg_catalog.count(*) filter (
    where status = 'SUT_FAIL'
  ) as sut_failed,

  pg_catalog.count(*) filter (
    where status = 'HARNESS_ERROR'
  ) as harness_errors,

  pg_catalog.count(*) as total,

  pg_catalog.count(*) filter (
    where status <> 'PASS'
  ) as failed_scenarios,

  (
    pg_catalog.count(*) filter (
      where status = 'PASS'
    ) = 24
  ) as all_24_passed,

  coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'scenario_number',
        scenario_number,
        'scenario',
        scenario,
        'status',
        status,
        'detail',
        detail
      )
      order by scenario_number
    ) filter (
      where status <> 'PASS'
    ),
    '[]'::jsonb
  ) as failures
from pg_temp._p9_68_results;



select
  scenario_number,
  scenario_name,
  status,
  detail
from pg_temp._p9_68_readiness_results
order by scenario_number;

select
  count(*) as total,
  count(*) filter (
    where status = 'PASS'
  ) as passed,
  count(*) filter (
    where status <> 'PASS'
  ) as failed,
  case
    when count(*) = 3
     and count(*) filter (
       where status = 'PASS'
     ) = 3
      then true
    else false
  end as all_3_passed,
  coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'scenario_number', scenario_number,
        'scenario_name', scenario_name,
        'status', status,
        'detail', detail
      )
      order by scenario_number
    ) filter (
      where status <> 'PASS'
    ),
    '[]'::jsonb
  ) as failures
from pg_temp._p9_68_readiness_results;


-- P9_68_COMBINED_FINAL_SUMMARY
select
  (
    select pg_catalog.count(*)
    from pg_temp._p9_68_results
    where status = 'PASS'
  ) as acceptance_passed,

  (
    select pg_catalog.count(*)
    from pg_temp._p9_68_results
    where status = 'SUT_FAIL'
  ) as acceptance_sut_failed,

  (
    select pg_catalog.count(*)
    from pg_temp._p9_68_results
    where status = 'HARNESS_ERROR'
  ) as acceptance_harness_errors,

  (
    select pg_catalog.count(*)
    from pg_temp._p9_68_results
  ) as acceptance_total,

  (
    select pg_catalog.count(*)
    from pg_temp._p9_68_results
    where status <> 'PASS'
  ) as acceptance_failed,

  (
    select
      pg_catalog.count(*) = 24
      and pg_catalog.count(*) filter (
        where status = 'PASS'
      ) = 24
    from pg_temp._p9_68_results
  ) as all_24_passed,

  (
    select pg_catalog.count(*)
    from pg_temp._p9_68_readiness_results
  ) as readiness_total,

  (
    select pg_catalog.count(*)
    from pg_temp._p9_68_readiness_results
    where status = 'PASS'
  ) as readiness_passed,

  (
    select pg_catalog.count(*)
    from pg_temp._p9_68_readiness_results
    where status <> 'PASS'
  ) as readiness_failed,

  (
    select
      pg_catalog.count(*) = 3
      and pg_catalog.count(*) filter (
        where status = 'PASS'
      ) = 3
    from pg_temp._p9_68_readiness_results
  ) as all_3_passed,

  coalesce(
    (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'scenario_number', scenario_number,
          'scenario', scenario,
          'status', status,
          'detail', detail
        )
        order by scenario_number
      )
      from pg_temp._p9_68_results
      where status <> 'PASS'
    ),
    '[]'::jsonb
  ) as acceptance_failures,

  coalesce(
    (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'scenario_number', scenario_number,
          'scenario_name', scenario_name,
          'status', status,
          'detail', detail
        )
        order by scenario_number
      )
      from pg_temp._p9_68_readiness_results
      where status <> 'PASS'
    ),
    '[]'::jsonb
  ) as readiness_failures;
-- ============================================================================
-- P9 6.8 combined acceptance + readiness + atomic writer summary
-- ============================================================================

select
  (
    select pg_catalog.count(*)
    from pg_temp._p9_68_results
    where status = 'PASS'
  ) as acceptance_passed,

  (
    select pg_catalog.count(*)
    from pg_temp._p9_68_results
    where status = 'SUT_FAIL'
  ) as acceptance_sut_failed,

  (
    select pg_catalog.count(*)
    from pg_temp._p9_68_results
    where status = 'HARNESS_ERROR'
  ) as acceptance_harness_errors,

  (
    select pg_catalog.count(*)
    from pg_temp._p9_68_results
    where status <> 'PASS'
  ) as acceptance_failed,

  coalesce(
    (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'scenario_number', scenario_number,
          'scenario', scenario,
          'status', status,
          'detail', detail
        )
        order by scenario_number
      )
      from pg_temp._p9_68_results
      where status <> 'PASS'
    ),
    '[]'::jsonb
  ) as acceptance_failures,

  (
    select pg_catalog.count(*) = 24
       and pg_catalog.count(*) filter (
         where status = 'PASS'
       ) = 24
    from pg_temp._p9_68_results
  ) as all_24_passed,

  (
    select pg_catalog.count(*)
    from pg_temp._p9_68_readiness_results
  ) as readiness_total,

  (
    select pg_catalog.count(*)
    from pg_temp._p9_68_readiness_results
    where status = 'PASS'
  ) as readiness_passed,

  (
    select pg_catalog.count(*)
    from pg_temp._p9_68_readiness_results
    where status <> 'PASS'
  ) as readiness_failed,

  (
    select pg_catalog.count(*) = 3
       and pg_catalog.count(*) filter (
         where status = 'PASS'
       ) = 3
    from pg_temp._p9_68_readiness_results
  ) as all_3_passed,

  (
    select pg_catalog.count(*)
    from pg_temp._p9_68_contract_writer_results
  ) as writer_total,

  (
    select pg_catalog.count(*)
    from pg_temp._p9_68_contract_writer_results
    where status = 'PASS'
  ) as writer_passed,

  (
    select pg_catalog.count(*)
    from pg_temp._p9_68_contract_writer_results
    where status <> 'PASS'
  ) as writer_failed,

  (
    select pg_catalog.count(*) = 5
       and pg_catalog.count(*) filter (
         where status = 'PASS'
       ) = 5
    from pg_temp._p9_68_contract_writer_results
  ) as all_5_writer_passed,

  coalesce(
    (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'scenario_number', scenario_number,
          'scenario_name', scenario_name,
          'status', status,
          'detail', detail
        )
        order by scenario_number
      )
      from pg_temp._p9_68_contract_writer_results
      where status <> 'PASS'
    ),
    '[]'::jsonb
  ) as writer_failures;
rollback;

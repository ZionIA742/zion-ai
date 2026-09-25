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
    'aceito o orÃƒÂ§amento',
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
   * SÃƒÂ³ gravamos nela depois de RESET ROLE para nÃƒÂ£o contaminar
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
    'proposal vigente sem acceptance nÃƒÂ£o pode criar contrato',

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
      'proposal vigente sem acceptance nÃƒÂ£o pode criar contrato',
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
    'authority possui RLS ACLs e append-only canÃƒÂ´nicos',
    v_ok
  );
exception
  when others then
    perform pg_temp._p9_68_record(
      1,
      'authority possui RLS ACLs e append-only canÃƒÂ´nicos',
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
    'reader retorna current proposal ainda nÃƒÂ£o aceita',
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
      'reader retorna current proposal ainda nÃƒÂ£o aceita',
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
    'aceite vÃƒÂ¡lido grava exact current quote/version',
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
      'aceite vÃƒÂ¡lido grava exact current quote/version',
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

-- ============================================================================
-- P9 6.8 / Atomic contract creation + contract_record_created event boundary
--
-- This derived runner intentionally stops before the legacy W1-W5 contract
-- writer scenarios. It reuses their validated fixture until exact V1 acceptance
-- is READY, then exercises the new atomic/reconcilable boundary.
--
-- ROLLBACK ONLY.
-- ============================================================================

create temporary table pg_temp._p9_68_event_boundary_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  detail text not null
) on commit drop;


create or replace function pg_temp._p9_68_event_boundary_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_passed boolean,
  p_detail text,
  p_harness_error boolean default false
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_68_event_boundary_results (
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


-- ============================================================================
-- B1. Exact accepted V1 creates contract and business event atomically.
-- ============================================================================

do $b1$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;

  v_contract_id uuid;
  v_event_id uuid;

  v_contract_count bigint;
  v_event_count bigint;

  v_contract_number text;
  v_event public.store_business_events%rowtype;
begin
  select *
  into c
  from pg_temp._p9_68_ctx;

  v_contract_number :=
    'P968-EVENT-V1-'
    || pg_catalog.replace(c.main_v1::text, '-', '');

  select *
  into x
  from pg_temp._p9_68_exec_json_sql(
    'service_role',
    null,
    pg_catalog.format(
      $sql$
        select *
        from public.create_sales_contract_with_current_acceptance_event_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::text,
          %L::uuid
        )
      $sql$,
      c.org_a,
      c.store_a,
      c.opp_main,
      c.quote_main,
      c.main_v1,
      v_contract_number,
      c.user_active
    )
  );

  if not x.operation_succeeded then
    perform pg_temp._p9_68_event_boundary_record(
      1,
      'criacao exata materializa contrato e contract_record_created juntos',
      false,
      coalesce(
        x.returned_sqlstate || ' ' || x.message_text,
        x.message_text,
        '<boundary failed without detail>'
      )
    );

    return;
  end if;

  v_contract_id := (x.value_json ->> 'contract_id')::uuid;
  v_event_id := (x.value_json ->> 'business_event_id')::uuid;

  select pg_catalog.count(*)
  into v_contract_count
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
    and contract_row.status not in ('cancelled', 'expired', 'failed');

  select pg_catalog.count(*)
  into v_event_count
  from public.store_business_events event_row
  where event_row.organization_id = c.org_a
    and event_row.store_id = c.store_a
    and event_row.event_key = 'contrato_gerado'
    and event_row.event_payload ->> 'stage' = 'contract_record_created'
    and event_row.event_payload ->> 'contract_id' = v_contract_id::text;

  select event_row.*
  into v_event
  from public.store_business_events event_row
  where event_row.id = v_event_id;

  perform pg_temp._p9_68_event_boundary_record(
    1,
    'criacao exata materializa contrato e contract_record_created juntos',
    x.value_json ->> 'outcome' = 'created'
      and x.value_json ->> 'business_event_outcome' = 'created'
      and v_contract_id is not null
      and v_event_id is not null
      and v_contract_count = 1
      and v_event_count = 1
      and v_event.actor_type = 'human'
      and v_event.actor_user_id = c.user_active
      and v_event.event_payload ->> 'quote_id' = c.quote_main::text
      and v_event.event_payload ->> 'quote_version_id' = c.main_v1::text
      and v_event.event_payload ->> 'commercial_opportunity_id' = c.opp_main::text,
    pg_catalog.jsonb_build_object(
      'rpc', x.value_json,
      'contract_count', v_contract_count,
      'event_count', v_event_count,
      'event', pg_catalog.to_jsonb(v_event)
    )::text
  );
exception
  when others then
    perform pg_temp._p9_68_event_boundary_record(
      1,
      'criacao exata materializa contrato e contract_record_created juntos',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$b1$;


-- ============================================================================
-- B2. Exact replay returns same contract/event and does not duplicate either.
-- ============================================================================

do $b2$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;

  v_existing_contract public.sales_contracts%rowtype;
  v_existing_event public.store_business_events%rowtype;

  v_contract_count bigint;
  v_event_count bigint;

  v_replay_number text;
begin
  select *
  into c
  from pg_temp._p9_68_ctx;

  select contract_row.*
  into v_existing_contract
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
    and contract_row.status not in ('cancelled', 'expired', 'failed');

  if not found then
    perform pg_temp._p9_68_event_boundary_record(
      2,
      'replay exato nao duplica contrato nem business event',
      false,
      'B1 contract not found',
      true
    );

    return;
  end if;

  select event_row.*
  into v_existing_event
  from public.store_business_events event_row
  where event_row.organization_id = c.org_a
    and event_row.store_id = c.store_a
    and event_row.event_key = 'contrato_gerado'
    and event_row.event_payload ->> 'stage' = 'contract_record_created'
    and event_row.event_payload ->> 'contract_id' =
          v_existing_contract.id::text;

  if not found then
    perform pg_temp._p9_68_event_boundary_record(
      2,
      'replay exato nao duplica contrato nem business event',
      false,
      'B1 event not found',
      true
    );

    return;
  end if;

  v_replay_number :=
    'P968-EVENT-V1-REPLAY-'
    || pg_catalog.replace(c.main_v1::text, '-', '');

  select *
  into x
  from pg_temp._p9_68_exec_json_sql(
    'service_role',
    null,
    pg_catalog.format(
      $sql$
        select *
        from public.create_sales_contract_with_current_acceptance_event_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::text,
          %L::uuid
        )
      $sql$,
      c.org_a,
      c.store_a,
      c.opp_main,
      c.quote_main,
      c.main_v1,
      v_replay_number,
      c.user_active
    )
  );

  select pg_catalog.count(*)
  into v_contract_count
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
    and contract_row.status not in ('cancelled', 'expired', 'failed');

  select pg_catalog.count(*)
  into v_event_count
  from public.store_business_events event_row
  where event_row.organization_id = c.org_a
    and event_row.store_id = c.store_a
    and event_row.event_key = 'contrato_gerado'
    and event_row.event_payload ->> 'stage' = 'contract_record_created'
    and event_row.event_payload ->> 'contract_id' =
          v_existing_contract.id::text;

  perform pg_temp._p9_68_event_boundary_record(
    2,
    'replay exato nao duplica contrato nem business event',
    x.operation_succeeded
      and x.value_json ->> 'outcome' = 'already_exists'
      and x.value_json ->> 'business_event_outcome' = 'already_exists'
      and x.value_json ->> 'contract_id' = v_existing_contract.id::text
      and x.value_json ->> 'business_event_id' = v_existing_event.id::text
      and x.value_json ->> 'contract_number' =
            v_existing_contract.contract_number
      and v_contract_count = 1
      and v_event_count = 1,
    coalesce(
      x.message_text,
      pg_catalog.jsonb_build_object(
        'rpc', x.value_json,
        'contract_count', v_contract_count,
        'event_count', v_event_count
      )::text
    )
  );
exception
  when others then
    perform pg_temp._p9_68_event_boundary_record(
      2,
      'replay exato nao duplica contrato nem business event',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$b2$;


-- ============================================================================
-- B3. Existing contract with missing creation event is reconciled on replay.
--     The event deletion is test-only and is rolled back with the whole runner.
-- ============================================================================

do $b3$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;

  v_existing_contract public.sales_contracts%rowtype;

  v_deleted_event_count bigint;
  v_contract_count bigint;
  v_event_count bigint;

  v_replay_number text;
begin
  select *
  into c
  from pg_temp._p9_68_ctx;

  select contract_row.*
  into v_existing_contract
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
    and contract_row.status not in ('cancelled', 'expired', 'failed');

  if not found then
    perform pg_temp._p9_68_event_boundary_record(
      3,
      'replay reconcilia evento ausente sem duplicar contrato',
      false,
      'existing contract not found before reconciliation',
      true
    );

    return;
  end if;

  with deleted as (
    delete from public.store_business_events event_row
    where event_row.organization_id = c.org_a
      and event_row.store_id = c.store_a
      and event_row.event_key = 'contrato_gerado'
      and event_row.event_payload ->> 'stage' = 'contract_record_created'
      and event_row.event_payload ->> 'contract_id' =
            v_existing_contract.id::text
    returning event_row.id
  )
  select pg_catalog.count(*)
  into v_deleted_event_count
  from deleted;

  if v_deleted_event_count <> 1 then
    perform pg_temp._p9_68_event_boundary_record(
      3,
      'replay reconcilia evento ausente sem duplicar contrato',
      false,
      'expected exactly one event to remove before reconciliation; removed='
        || v_deleted_event_count::text,
      true
    );

    return;
  end if;

  v_replay_number :=
    'P968-EVENT-V1-RECONCILE-'
    || pg_catalog.replace(c.main_v1::text, '-', '');

  select *
  into x
  from pg_temp._p9_68_exec_json_sql(
    'service_role',
    null,
    pg_catalog.format(
      $sql$
        select *
        from public.create_sales_contract_with_current_acceptance_event_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::text,
          %L::uuid
        )
      $sql$,
      c.org_a,
      c.store_a,
      c.opp_main,
      c.quote_main,
      c.main_v1,
      v_replay_number,
      c.user_active
    )
  );

  select pg_catalog.count(*)
  into v_contract_count
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
    and contract_row.status not in ('cancelled', 'expired', 'failed');

  select pg_catalog.count(*)
  into v_event_count
  from public.store_business_events event_row
  where event_row.organization_id = c.org_a
    and event_row.store_id = c.store_a
    and event_row.event_key = 'contrato_gerado'
    and event_row.event_payload ->> 'stage' = 'contract_record_created'
    and event_row.event_payload ->> 'contract_id' =
          v_existing_contract.id::text;

  perform pg_temp._p9_68_event_boundary_record(
    3,
    'replay reconcilia evento ausente sem duplicar contrato',
    x.operation_succeeded
      and x.value_json ->> 'outcome' = 'already_exists'
      and x.value_json ->> 'business_event_outcome' = 'reconciled'
      and x.value_json ->> 'contract_id' = v_existing_contract.id::text
      and (x.value_json ->> 'business_event_id') is not null
      and v_contract_count = 1
      and v_event_count = 1,
    coalesce(
      x.message_text,
      pg_catalog.jsonb_build_object(
        'rpc', x.value_json,
        'deleted_event_count', v_deleted_event_count,
        'contract_count', v_contract_count,
        'event_count', v_event_count
      )::text
    )
  );
exception
  when others then
    perform pg_temp._p9_68_event_boundary_record(
      3,
      'replay reconcilia evento ausente sem duplicar contrato',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$b3$;


-- ============================================================================
-- B4. Inactive human actor is rejected before mutation.
-- ============================================================================

do $b4$
declare
  c pg_temp._p9_68_ctx%rowtype;
  x record;

  v_contract public.sales_contracts%rowtype;

  v_contract_count_before bigint;
  v_contract_count_after bigint;

  v_event_count_before bigint;
  v_event_count_after bigint;
begin
  select *
  into c
  from pg_temp._p9_68_ctx;

  select contract_row.*
  into v_contract
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
    and contract_row.status not in ('cancelled', 'expired', 'failed');

  select pg_catalog.count(*)
  into v_contract_count_before
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1;

  select pg_catalog.count(*)
  into v_event_count_before
  from public.store_business_events event_row
  where event_row.organization_id = c.org_a
    and event_row.store_id = c.store_a
    and event_row.event_key = 'contrato_gerado'
    and event_row.event_payload ->> 'stage' = 'contract_record_created'
    and event_row.event_payload ->> 'contract_id' = v_contract.id::text;

  select *
  into x
  from pg_temp._p9_68_exec_json_sql(
    'service_role',
    null,
    pg_catalog.format(
      $sql$
        select *
        from public.create_sales_contract_with_current_acceptance_event_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::text,
          %L::uuid
        )
      $sql$,
      c.org_a,
      c.store_a,
      c.opp_main,
      c.quote_main,
      c.main_v1,
      'P968-INACTIVE-ACTOR',
      c.user_inactive
    )
  );

  select pg_catalog.count(*)
  into v_contract_count_after
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1;

  select pg_catalog.count(*)
  into v_event_count_after
  from public.store_business_events event_row
  where event_row.organization_id = c.org_a
    and event_row.store_id = c.store_a
    and event_row.event_key = 'contrato_gerado'
    and event_row.event_payload ->> 'stage' = 'contract_record_created'
    and event_row.event_payload ->> 'contract_id' = v_contract.id::text;

  perform pg_temp._p9_68_event_boundary_record(
    4,
    'ator humano inativo falha fechado sem mutacao',
    not x.operation_succeeded
      and x.returned_sqlstate = '42501'
      and x.message_text =
            'ZION_CONTRACT_CREATE_EVENT_ACTOR_NOT_AUTHORIZED'
      and v_contract_count_after = v_contract_count_before
      and v_event_count_after = v_event_count_before,
    pg_catalog.jsonb_build_object(
      'sqlstate', x.returned_sqlstate,
      'message', x.message_text,
      'contracts_before', v_contract_count_before,
      'contracts_after', v_contract_count_after,
      'events_before', v_event_count_before,
      'events_after', v_event_count_after
    )::text
  );
exception
  when others then
    perform pg_temp._p9_68_event_boundary_record(
      4,
      'ator humano inativo falha fechado sem mutacao',
      false,
      sqlstate || ' ' || sqlerrm,
      true
    );
end;
$b4$;


-- ============================================================================
-- Results
-- ============================================================================

select
  scenario_number,
  scenario_name,
  status,
  detail
from pg_temp._p9_68_event_boundary_results
order by scenario_number;

select
  pg_catalog.count(*) as total,
  pg_catalog.count(*) filter (
    where status = 'PASS'
  ) as passed,
  pg_catalog.count(*) filter (
    where status <> 'PASS'
  ) as failed,
  (
    pg_catalog.count(*) = 4
    and pg_catalog.count(*) filter (
      where status = 'PASS'
    ) = 4
  ) as all_4_passed,
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
      from pg_temp._p9_68_event_boundary_results
      where status <> 'PASS'
    ),
    '[]'::jsonb
  ) as failures
from pg_temp._p9_68_event_boundary_results;


-- ============================================================================
-- P9 6.8 / Downstream Current Commercial Proposal lineage guard
--
-- Reuses the validated 6.8 fixture and canonical V1 contract created by B1.
-- ROLLBACK ONLY.
-- ============================================================================

create temporary table pg_temp._p9_68_downstream_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null
    check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit drop;


create or replace function pg_temp._p9_68_downstream_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_passed boolean,
  p_detail text,
  p_harness_error boolean default false
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_68_downstream_results (
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


-- ============================================================================
-- D1. Canonical contract is CURRENT while its exact proposal/acceptance is current.
-- ============================================================================

do $d1$
declare
  c pg_temp._p9_68_ctx%rowtype;
  v_contract public.sales_contracts%rowtype;
  r record;
begin
  select * into c from pg_temp._p9_68_ctx;

  select contract_row.*
  into v_contract
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
    and contract_row.status not in ('cancelled', 'expired', 'failed')
  limit 1;

  if not found then
    perform pg_temp._p9_68_downstream_record(
      1,
      'contrato canonico vigente resolve lineage current',
      false,
      'canonical contract from B1 not found',
      true
    );
    return;
  end if;

  select *
  into r
  from public.p9_assert_sales_contract_current_proposal_lineage_internal(
    c.org_a,
    c.store_a,
    v_contract.id
  );

  perform pg_temp._p9_68_downstream_record(
    1,
    'contrato canonico vigente resolve lineage current',
    r.guard_state = 'current'
      and r.commercial_opportunity_id = c.opp_main
      and r.quote_id = c.quote_main
      and r.quote_version_id = c.main_v1
      and r.acceptance_event_id is not null,
    pg_catalog.to_jsonb(r)::text
  );
exception
  when others then
    perform pg_temp._p9_68_downstream_record(
      1,
      'contrato canonico vigente resolve lineage current',
      false,
      sqlstate || ' ' || sqlerrm
    );
end;
$d1$;


-- ============================================================================
-- D2. Current canonical contract can create its first contract PDF/version.
-- ============================================================================

do $d2$
declare
  c pg_temp._p9_68_ctx%rowtype;
  v_contract public.sales_contracts%rowtype;
  v_version_id uuid := gen_random_uuid();
  v_count bigint;
  v_current_version uuid;
begin
  select * into c from pg_temp._p9_68_ctx;

  select contract_row.*
  into v_contract
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
    and contract_row.status not in ('cancelled', 'expired', 'failed')
  limit 1;

  if not found then
    perform pg_temp._p9_68_downstream_record(
      2,
      'lineage vigente permite criar versao de contrato',
      false,
      'canonical contract not found',
      true
    );
    return;
  end if;

  insert into public.sales_contract_versions (
    id,
    contract_id,
    organization_id,
    store_id,
    version_number,
    status,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    contract_snapshot
  )
  values (
    v_version_id,
    v_contract.id,
    c.org_a,
    c.store_a,
    1,
    'generated',
    'p9-runner',
    'p9-runner/' || v_version_id::text || '.pdf',
    'p9-6-8-downstream-current.pdf',
    'application/pdf',
    10,
    pg_catalog.jsonb_build_object(
      'runner', 'p9_6_8_downstream',
      'quote_id', c.quote_main,
      'quote_version_id', c.main_v1
    )
  );

  update public.sales_contracts
  set current_version_id = v_version_id
  where id = v_contract.id;

  select pg_catalog.count(*)
  into v_count
  from public.sales_contract_versions version_row
  where version_row.id = v_version_id
    and version_row.contract_id = v_contract.id;

  select contract_row.current_version_id
  into v_current_version
  from public.sales_contracts contract_row
  where contract_row.id = v_contract.id;

  perform pg_temp._p9_68_downstream_record(
    2,
    'lineage vigente permite criar versao de contrato',
    v_count = 1
      and v_current_version = v_version_id,
    pg_catalog.jsonb_build_object(
      'contract_id', v_contract.id,
      'version_id', v_version_id,
      'version_count', v_count,
      'current_version_id', v_current_version
    )::text
  );
exception
  when others then
    perform pg_temp._p9_68_downstream_record(
      2,
      'lineage vigente permite criar versao de contrato',
      false,
      sqlstate || ' ' || sqlerrm
    );
end;
$d2$;


-- ============================================================================
-- D3. Canonical lineage cannot be downgraded/tampered after creation.
-- ============================================================================

do $d3$
declare
  c pg_temp._p9_68_ctx%rowtype;
  v_contract public.sales_contracts%rowtype;
  v_metadata_blocked boolean := false;
  v_version_blocked boolean := false;
  v_metadata_error text := null;
  v_version_error text := null;
begin
  select * into c from pg_temp._p9_68_ctx;

  select contract_row.*
  into v_contract
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
  limit 1;

  if not found then
    perform pg_temp._p9_68_downstream_record(
      3,
      'lineage canonica e imutavel',
      false,
      'canonical contract not found',
      true
    );
    return;
  end if;

  begin
    update public.sales_contracts
    set metadata = metadata - 'proposal_acceptance_event_id'
    where id = v_contract.id;

    v_metadata_error := 'metadata tamper unexpectedly succeeded';
  exception
    when others then
      v_metadata_blocked :=
        sqlstate = 'P0001'
        and sqlerrm =
          'ZION_CONTRACT_DOWNSTREAM_LINEAGE_METADATA_IMMUTABLE';

      v_metadata_error := sqlstate || ' ' || sqlerrm;
  end;

  begin
    update public.sales_contracts
    set quote_version_id = c.main_v2
    where id = v_contract.id;

    v_version_error := 'quote_version_id tamper unexpectedly succeeded';
  exception
    when others then
      v_version_blocked :=
        sqlstate = 'P0001'
        and sqlerrm =
          'ZION_CONTRACT_DOWNSTREAM_LINEAGE_IMMUTABLE';

      v_version_error := sqlstate || ' ' || sqlerrm;
  end;

  perform pg_temp._p9_68_downstream_record(
    3,
    'lineage canonica e imutavel',
    v_metadata_blocked and v_version_blocked,
    pg_catalog.jsonb_build_object(
      'metadata_guard', v_metadata_error,
      'quote_version_guard', v_version_error
    )::text
  );
exception
  when others then
    perform pg_temp._p9_68_downstream_record(
      3,
      'lineage canonica e imutavel',
      false,
      sqlstate || ' ' || sqlerrm
    );
end;
$d3$;


-- ============================================================================
-- D4. Advancing Current Proposal to V2 makes V1 contract lineage stale.
-- ============================================================================

do $d4$
declare
  c pg_temp._p9_68_ctx%rowtype;
  v_contract public.sales_contracts%rowtype;
  v_blocked boolean := false;
  v_error text := null;
begin
  select * into c from pg_temp._p9_68_ctx;

  select contract_row.*
  into v_contract
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
  limit 1;

  if not found then
    perform pg_temp._p9_68_downstream_record(
      4,
      'nova Current Proposal torna contrato V1 stale',
      false,
      'canonical contract not found',
      true
    );
    return;
  end if;

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
    'p9_6_8_downstream_guard_runner_v2'
  );

  begin
    perform *
    from public.p9_assert_sales_contract_current_proposal_lineage_internal(
      c.org_a,
      c.store_a,
      v_contract.id
    );

    v_error := 'stale helper unexpectedly succeeded';
  exception
    when others then
      v_blocked :=
        sqlstate = 'P0001'
        and sqlerrm = 'ZION_CONTRACT_DOWNSTREAM_PROPOSAL_STALE';

      v_error := sqlstate || ' ' || sqlerrm;
  end;

  perform pg_temp._p9_68_downstream_record(
    4,
    'nova Current Proposal torna contrato V1 stale',
    v_blocked,
    v_error
  );
exception
  when others then
    perform pg_temp._p9_68_downstream_record(
      4,
      'nova Current Proposal torna contrato V1 stale',
      false,
      sqlstate || ' ' || sqlerrm
    );
end;
$d4$;


-- ============================================================================
-- D5. Stale contract cannot generate another PDF/version.
-- ============================================================================

do $d5$
declare
  c pg_temp._p9_68_ctx%rowtype;
  v_contract public.sales_contracts%rowtype;
  v_version_id uuid := gen_random_uuid();
  v_before bigint;
  v_after bigint;
  v_blocked boolean := false;
  v_error text := null;
begin
  select * into c from pg_temp._p9_68_ctx;

  select contract_row.*
  into v_contract
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
  limit 1;

  select pg_catalog.count(*)
  into v_before
  from public.sales_contract_versions version_row
  where version_row.contract_id = v_contract.id;

  begin
    insert into public.sales_contract_versions (
      id,
      contract_id,
      organization_id,
      store_id,
      version_number,
      status,
      storage_bucket,
      storage_path,
      original_filename,
      mime_type,
      size_bytes,
      contract_snapshot
    )
    values (
      v_version_id,
      v_contract.id,
      c.org_a,
      c.store_a,
      2,
      'generated',
      'p9-runner',
      'p9-runner/' || v_version_id::text || '.pdf',
      'p9-6-8-downstream-stale.pdf',
      'application/pdf',
      10,
      '{}'::jsonb
    );

    v_error := 'stale contract version unexpectedly inserted';
  exception
    when others then
      v_blocked :=
        sqlstate = 'P0001'
        and sqlerrm = 'ZION_CONTRACT_DOWNSTREAM_PROPOSAL_STALE';

      v_error := sqlstate || ' ' || sqlerrm;
  end;

  select pg_catalog.count(*)
  into v_after
  from public.sales_contract_versions version_row
  where version_row.contract_id = v_contract.id;

  perform pg_temp._p9_68_downstream_record(
    5,
    'contrato stale nao gera novo PDF/version',
    v_blocked and v_after = v_before,
    pg_catalog.jsonb_build_object(
      'error', v_error,
      'before', v_before,
      'after', v_after
    )::text
  );
exception
  when others then
    perform pg_temp._p9_68_downstream_record(
      5,
      'contrato stale nao gera novo PDF/version',
      false,
      sqlstate || ' ' || sqlerrm
    );
end;
$d5$;


-- ============================================================================
-- D6. Stale contract cannot transition into approved.
-- ============================================================================

do $d6$
declare
  c pg_temp._p9_68_ctx%rowtype;
  v_contract public.sales_contracts%rowtype;
  v_status text;
  v_blocked boolean := false;
  v_error text := null;
begin
  select * into c from pg_temp._p9_68_ctx;

  select contract_row.*
  into v_contract
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
  limit 1;

  begin
    update public.sales_contracts
    set status = 'approved'
    where id = v_contract.id;

    v_error := 'stale contract approval unexpectedly succeeded';
  exception
    when others then
      v_blocked :=
        sqlstate = 'P0001'
        and sqlerrm = 'ZION_CONTRACT_DOWNSTREAM_PROPOSAL_STALE';

      v_error := sqlstate || ' ' || sqlerrm;
  end;

  select contract_row.status
  into v_status
  from public.sales_contracts contract_row
  where contract_row.id = v_contract.id;

  perform pg_temp._p9_68_downstream_record(
    6,
    'contrato stale nao pode ser aprovado',
    v_blocked and v_status = 'pending_review',
    pg_catalog.jsonb_build_object(
      'error', v_error,
      'status_after', v_status
    )::text
  );
exception
  when others then
    perform pg_temp._p9_68_downstream_record(
      6,
      'contrato stale nao pode ser aprovado',
      false,
      sqlstate || ' ' || sqlerrm
    );
end;
$d6$;


-- ============================================================================
-- D7. Stale contract cannot materialize outgoing contract-PDF message.
-- ============================================================================

do $d7$
declare
  c pg_temp._p9_68_ctx%rowtype;
  v_contract public.sales_contracts%rowtype;
  v_before bigint;
  v_after bigint;
  v_blocked boolean := false;
  v_error text := null;
begin
  select * into c from pg_temp._p9_68_ctx;

  select contract_row.*
  into v_contract
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
  limit 1;

  select pg_catalog.count(*)
  into v_before
  from public.messages message_row
  where message_row.organization_id = c.org_a
    and message_row.store_id = c.store_a
    and message_row.metadata ->> 'contract_id' = v_contract.id::text
    and message_row.metadata ->> 'file_kind' = 'sales_contract_pdf';

  begin
    perform *
    from public.insert_message(
      c.conv_main,
      'human',
      'outgoing',
      'text',
      'P9 6.8 stale contract send guard',
      'p9-6-8-downstream-stale-send-' || v_contract.id::text,
      null,
      pg_catalog.jsonb_build_object(
        'file_kind', 'sales_contract_pdf',
        'contract_id', v_contract.id,
        'contract_version_id', v_contract.current_version_id,
        'quote_id', v_contract.quote_id,
        'quote_version_id', v_contract.quote_version_id,
        'source', 'p9_6_8_downstream_guard_runner'
      )
    );

    v_error := 'stale contract message unexpectedly inserted';
  exception
    when others then
      v_blocked :=
        sqlstate = 'P0001'
        and sqlerrm = 'ZION_CONTRACT_DOWNSTREAM_PROPOSAL_STALE';

      v_error := sqlstate || ' ' || sqlerrm;
  end;

  select pg_catalog.count(*)
  into v_after
  from public.messages message_row
  where message_row.organization_id = c.org_a
    and message_row.store_id = c.store_a
    and message_row.metadata ->> 'contract_id' = v_contract.id::text
    and message_row.metadata ->> 'file_kind' = 'sales_contract_pdf';

  perform pg_temp._p9_68_downstream_record(
    7,
    'contrato stale nao pode ser enviado',
    v_blocked and v_after = v_before,
    pg_catalog.jsonb_build_object(
      'error', v_error,
      'before', v_before,
      'after', v_after
    )::text
  );
exception
  when others then
    perform pg_temp._p9_68_downstream_record(
      7,
      'contrato stale nao pode ser enviado',
      false,
      sqlstate || ' ' || sqlerrm
    );
end;
$d7$;


-- ============================================================================
-- D8. Stale contract cannot receive customer signature.
-- ============================================================================

do $d8$
declare
  c pg_temp._p9_68_ctx%rowtype;
  v_contract public.sales_contracts%rowtype;
  v_before bigint;
  v_after bigint;
  v_blocked boolean := false;
  v_error text := null;
begin
  select * into c from pg_temp._p9_68_ctx;

  select contract_row.*
  into v_contract
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
  limit 1;

  select pg_catalog.count(*)
  into v_before
  from public.sales_contract_signatures signature_row
  where signature_row.contract_id = v_contract.id
    and signature_row.signer_type = 'customer';

  begin
    insert into public.sales_contract_signatures (
      contract_id,
      contract_version_id,
      organization_id,
      store_id,
      signer_type,
      signer_name,
      status,
      signed_at,
      acceptance_text,
      metadata
    )
    values (
      v_contract.id,
      v_contract.current_version_id,
      c.org_a,
      c.store_a,
      'customer',
      'Cliente P9 6.8 Runner',
      'signed',
      pg_catalog.clock_timestamp(),
      'Aceito',
      pg_catalog.jsonb_build_object(
        'source',
        'p9_6_8_downstream_guard_runner'
      )
    );

    v_error := 'stale customer signature unexpectedly inserted';
  exception
    when others then
      v_blocked :=
        sqlstate = 'P0001'
        and sqlerrm = 'ZION_CONTRACT_DOWNSTREAM_PROPOSAL_STALE';

      v_error := sqlstate || ' ' || sqlerrm;
  end;

  select pg_catalog.count(*)
  into v_after
  from public.sales_contract_signatures signature_row
  where signature_row.contract_id = v_contract.id
    and signature_row.signer_type = 'customer';

  perform pg_temp._p9_68_downstream_record(
    8,
    'contrato stale nao aceita assinatura do cliente',
    v_blocked and v_after = v_before,
    pg_catalog.jsonb_build_object(
      'error', v_error,
      'before', v_before,
      'after', v_after
    )::text
  );
exception
  when others then
    perform pg_temp._p9_68_downstream_record(
      8,
      'contrato stale nao aceita assinatura do cliente',
      false,
      sqlstate || ' ' || sqlerrm
    );
end;
$d8$;


-- ============================================================================
-- D9. Stale contract cannot receive store signature.
-- ============================================================================

do $d9$
declare
  c pg_temp._p9_68_ctx%rowtype;
  v_contract public.sales_contracts%rowtype;
  v_before bigint;
  v_after bigint;
  v_blocked boolean := false;
  v_error text := null;
begin
  select * into c from pg_temp._p9_68_ctx;

  select contract_row.*
  into v_contract
  from public.sales_contracts contract_row
  where contract_row.organization_id = c.org_a
    and contract_row.store_id = c.store_a
    and contract_row.quote_id = c.quote_main
    and contract_row.quote_version_id = c.main_v1
  limit 1;

  select pg_catalog.count(*)
  into v_before
  from public.sales_contract_signatures signature_row
  where signature_row.contract_id = v_contract.id
    and signature_row.signer_type = 'store';

  begin
    insert into public.sales_contract_signatures (
      contract_id,
      contract_version_id,
      organization_id,
      store_id,
      signer_type,
      signer_user_id,
      signer_name,
      status,
      signed_at,
      acceptance_text,
      metadata
    )
    values (
      v_contract.id,
      v_contract.current_version_id,
      c.org_a,
      c.store_a,
      'store',
      c.user_active,
      'Loja P9 6.8 Runner',
      'signed',
      pg_catalog.clock_timestamp(),
      'Confirmado pela loja',
      pg_catalog.jsonb_build_object(
        'source',
        'p9_6_8_downstream_guard_runner'
      )
    );

    v_error := 'stale store signature unexpectedly inserted';
  exception
    when others then
      v_blocked :=
        sqlstate = 'P0001'
        and sqlerrm = 'ZION_CONTRACT_DOWNSTREAM_PROPOSAL_STALE';

      v_error := sqlstate || ' ' || sqlerrm;
  end;

  select pg_catalog.count(*)
  into v_after
  from public.sales_contract_signatures signature_row
  where signature_row.contract_id = v_contract.id
    and signature_row.signer_type = 'store';

  perform pg_temp._p9_68_downstream_record(
    9,
    'contrato stale nao aceita confirmacao da loja',
    v_blocked and v_after = v_before,
    pg_catalog.jsonb_build_object(
      'error', v_error,
      'before', v_before,
      'after', v_after
    )::text
  );
exception
  when others then
    perform pg_temp._p9_68_downstream_record(
      9,
      'contrato stale nao aceita confirmacao da loja',
      false,
      sqlstate || ' ' || sqlerrm
    );
end;
$d9$;


-- ============================================================================
-- D10. Legacy contracts remain compatible and are not retroactively blocked.
-- ============================================================================

do $d10$
declare
  c pg_temp._p9_68_ctx%rowtype;

  v_contract_id uuid := gen_random_uuid();
  v_version_id uuid := gen_random_uuid();

  r record;

  v_contract_count bigint;
  v_version_count bigint;
begin
  select * into c from pg_temp._p9_68_ctx;

  insert into public.sales_contracts (
    id,
    organization_id,
    store_id,
    lead_id,
    conversation_id,
    current_version_id,
    contract_number,
    status,
    title,
    customer_name,
    customer_phone,
    currency,
    subtotal_cents,
    discount_cents,
    total_cents,
    payment_terms,
    contract_terms,
    valid_until,
    metadata
  )
  values (
    v_contract_id,
    c.org_a,
    c.store_a,
    c.lead_a,
    c.conv_main,
    null,
    'P968-LEGACY-' ||
      pg_catalog.replace(v_contract_id::text, '-', ''),
    'pending_review',
    'Legacy downstream compatibility fixture',
    'Cliente Legacy',
    '5599999999999',
    'BRL',
    1000,
    0,
    1000,
    'avista',
    'runner',
    (pg_catalog.clock_timestamp() + interval '7 days')::date,
    pg_catalog.jsonb_build_object(
      'runner',
      'p9_6_8_legacy_compatibility'
    )
  );

  select *
  into r
  from public.p9_assert_sales_contract_current_proposal_lineage_internal(
    c.org_a,
    c.store_a,
    v_contract_id
  );

  insert into public.sales_contract_versions (
    id,
    contract_id,
    organization_id,
    store_id,
    version_number,
    status,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    contract_snapshot
  )
  values (
    v_version_id,
    v_contract_id,
    c.org_a,
    c.store_a,
    1,
    'generated',
    'p9-runner',
    'p9-runner/' || v_version_id::text || '.pdf',
    'p9-6-8-legacy.pdf',
    'application/pdf',
    10,
    '{}'::jsonb
  );

  update public.sales_contracts
  set current_version_id = v_version_id
  where id = v_contract_id;

  select pg_catalog.count(*)
  into v_contract_count
  from public.sales_contracts contract_row
  where contract_row.id = v_contract_id;

  select pg_catalog.count(*)
  into v_version_count
  from public.sales_contract_versions version_row
  where version_row.id = v_version_id
    and version_row.contract_id = v_contract_id;

  perform pg_temp._p9_68_downstream_record(
    10,
    'contrato legado continua compativel',
    r.guard_state = 'legacy_not_guarded'
      and v_contract_count = 1
      and v_version_count = 1,
    pg_catalog.jsonb_build_object(
      'guard', pg_catalog.to_jsonb(r),
      'contract_count', v_contract_count,
      'version_count', v_version_count
    )::text
  );
exception
  when others then
    perform pg_temp._p9_68_downstream_record(
      10,
      'contrato legado continua compativel',
      false,
      sqlstate || ' ' || sqlerrm
    );
end;
$d10$;


-- ============================================================================
-- DOWNSTREAM RESULTS
-- ============================================================================

select
  scenario_number,
  scenario_name,
  status,
  detail
from pg_temp._p9_68_downstream_results
order by scenario_number;


select
  pg_catalog.count(*) as total,
  pg_catalog.count(*) filter (
    where status = 'PASS'
  ) as passed,
  pg_catalog.count(*) filter (
    where status <> 'PASS'
  ) as failed,
  (
    pg_catalog.count(*) = 10
    and pg_catalog.count(*) filter (
      where status = 'PASS'
    ) = 10
  ) as all_10_passed,
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
      from pg_temp._p9_68_downstream_results
      where status <> 'PASS'
    ),
    '[]'::jsonb
  ) as failures
from pg_temp._p9_68_downstream_results;

rollback;

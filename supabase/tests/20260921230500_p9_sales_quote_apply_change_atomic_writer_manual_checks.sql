begin;



set transaction isolation level repeatable read;

set local lock_timeout = '5s';

set local statement_timeout = '300s';

set local idle_in_transaction_session_timeout = '300s';

set local search_path = pg_catalog, pg_temp, public, auth, extensions;



create temp table pg_temp._p9_apply_change_atomic_results (

  scenario_number integer primary key,

  scenario_name text not null,

  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),

  detail text not null

) on commit preserve rows;



create or replace function pg_temp._p9_apply_change_atomic_record(

  p_scenario_number integer,

  p_scenario_name text,

  p_status text,

  p_detail text default null

)

returns void

language plpgsql

as $function$

begin

  insert into pg_temp._p9_apply_change_atomic_results(

    scenario_number, scenario_name, status, detail

  ) values (

    p_scenario_number, p_scenario_name, p_status, coalesce(p_detail, '<null>')

  )

  on conflict (scenario_number) do update

  set scenario_name = excluded.scenario_name,

      status = excluded.status,

      detail = excluded.detail;

end;

$function$;



create or replace function pg_temp._p9_apply_change_atomic_exec_json(

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

  if current_user <> 'postgres' or session_user <> 'postgres' then

    return query select false, null::jsonb, null::text, 'runner helper must start as postgres'::text;

    return;

  end if;



  if p_role <> 'postgres' then

    perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);

    perform set_config('request.jwt.claim.role', p_role, true);

    perform set_config(

      'request.jwt.claims',

      pg_catalog.jsonb_build_object('sub', coalesce(p_user_id::text, ''), 'role', p_role)::text,

      true

    );

    execute pg_catalog.format('set local role %I', p_role);

  end if;



  begin

    execute pg_catalog.format('select to_jsonb(result_row) from (%s) result_row', p_sql)

      into v_value;



    if p_role <> 'postgres' then

      execute 'reset role';

    end if;



    return query select true, v_value, null::text, null::text;

  exception when others then

    get stacked diagnostics

      v_state = returned_sqlstate,

      v_message = message_text;



    if p_role <> 'postgres' then

      execute 'reset role';

    end if;



    return query select false, null::jsonb, v_state, v_message;

  end;

end;

$function$;



do $fixtures$

declare

  v_org uuid := gen_random_uuid();

  v_store uuid := gen_random_uuid();

  v_user uuid := gen_random_uuid();

  v_customer uuid := gen_random_uuid();

  v_opp_a uuid := gen_random_uuid();

  v_opp_b uuid := gen_random_uuid();

  v_opp_c uuid := gen_random_uuid();

  v_quote_a uuid := gen_random_uuid();

  v_quote_b uuid := gen_random_uuid();

  v_quote_c uuid := gen_random_uuid();

begin

  create temp table pg_temp._p9_apply_change_atomic_ctx (

    singleton boolean primary key default true check (singleton),

    org_id uuid not null,

    store_id uuid not null,

    user_id uuid not null,

    quote_a uuid not null,

    quote_b uuid not null,

    quote_c uuid not null

  ) on commit preserve rows;



  insert into pg_temp._p9_apply_change_atomic_ctx(

    org_id, store_id, user_id, quote_a, quote_b, quote_c

  ) values (

    v_org, v_store, v_user, v_quote_a, v_quote_b, v_quote_c

  );



  insert into auth.users(id) values (v_user);

  insert into public.organizations (id, name, subscription_status)

  values (v_org, 'P9 Apply Change Atomic Org', 'active');

  insert into public.stores (id, organization_id, name)

  values (v_store, v_org, 'P9 Apply Change Atomic Store');

  insert into public.memberships (organization_id, user_id, role, is_active)

  values (v_org, v_user, 'admin', true);

  insert into public.customers (id, organization_id, display_name)

  values (v_customer, v_org, 'P9 Apply Change Atomic Customer');

  insert into public.commercial_opportunities (id, organization_id, store_id, customer_id, stage)

  values

    (v_opp_a, v_org, v_store, v_customer, 'orcamento'),

    (v_opp_b, v_org, v_store, v_customer, 'orcamento'),

    (v_opp_c, v_org, v_store, v_customer, 'orcamento');



  insert into public.sales_quotes (

    id, organization_id, store_id, commercial_opportunity_id,

    conversation_id, lead_id, quote_number, title, status,

    customer_name, customer_phone, customer_notes, internal_notes,

    subtotal_cents, discount_cents, total_cents, current_version_id, metadata

  ) values

    (v_quote_a, v_org, v_store, v_opp_a, null, null, 'AC-AT-1', 'Atomic A', 'draft', 'Atomic A', null, null, null, 30000, 1000, 29000, null, '{}'::jsonb),

    (v_quote_b, v_org, v_store, v_opp_b, null, null, 'AC-AT-2', 'Atomic B', 'draft', 'Atomic B', null, null, null, 30000, 1000, 29000, null, '{}'::jsonb),

    (v_quote_c, v_org, v_store, v_opp_c, null, null, 'AC-AT-3', 'Atomic C', 'draft', 'Atomic C', null, null, null, 30000, 1000, 29000, null, '{}'::jsonb);



  insert into public.sales_quote_items (

    id, quote_id, organization_id, store_id, item_type, name, description,

    quantity, unit_price_cents, discount_cents, subtotal_cents, total_cents,

    sort_order, sku, metadata

  ) values

    (gen_random_uuid(), v_quote_a, v_org, v_store, 'custom', 'Old A', null, 3, 10000, 1000, 30000, 29000, 1, null, '{}'::jsonb),

    (gen_random_uuid(), v_quote_b, v_org, v_store, 'custom', 'Old B', null, 3, 10000, 1000, 30000, 29000, 1, null, '{}'::jsonb),

    (gen_random_uuid(), v_quote_c, v_org, v_store, 'custom', 'Old C', null, 3, 10000, 1000, 30000, 29000, 1, null, '{}'::jsonb);

end;

$fixtures$;



do $scenarios$

declare

  ctx pg_temp._p9_apply_change_atomic_ctx%rowtype;

  r record;

  q text;

  v_duplicate_item_id uuid;

  v_quote_subtotal integer;

  v_quote_discount integer;

  v_quote_total integer;

  v_item_count integer;

  v_sum_subtotal integer;

  v_sum_discount integer;

  v_sum_total integer;

begin

  select * into ctx from pg_temp._p9_apply_change_atomic_ctx where singleton;



  q := pg_catalog.format(

    $sql$

      select * from public.apply_sales_quote_change_money_and_items_by_system(

        %L::uuid, %L::uuid, %L::uuid,

        'Atomic A updated'::text, 'pending_review'::text,

        25000::integer, 2000::integer, 23000::integer,

        'customer note'::text, 'internal note'::text,

        null::text, null::text, null::text, null::date, '{}'::jsonb,

        %L::jsonb

      )

    $sql$,

    ctx.org_id,

    ctx.store_id,

    ctx.quote_a,

    pg_catalog.jsonb_build_array(

      pg_catalog.jsonb_build_object('item_type','custom','name','New A','quantity',2,'unit_price_cents',10000,'discount_cents',1500,'subtotal_cents',20000,'total_cents',18500,'sort_order',1,'metadata','{}'::jsonb),

      pg_catalog.jsonb_build_object('item_type','service','name','New B','quantity',1,'unit_price_cents',5000,'discount_cents',500,'subtotal_cents',5000,'total_cents',4500,'sort_order',2,'metadata','{}'::jsonb)

    )::text

  );



  select * into r from pg_temp._p9_apply_change_atomic_exec_json('service_role', null, q);



  select

    quote_row.subtotal_cents,

    quote_row.discount_cents,

    quote_row.total_cents,

    pg_catalog.count(item_row.id)::integer,

    coalesce(pg_catalog.sum(item_row.subtotal_cents), 0)::integer,

    coalesce(pg_catalog.sum(item_row.discount_cents), 0)::integer,

    coalesce(pg_catalog.sum(item_row.total_cents), 0)::integer

  into

    v_quote_subtotal,

    v_quote_discount,

    v_quote_total,

    v_item_count,

    v_sum_subtotal,

    v_sum_discount,

    v_sum_total

  from public.sales_quotes quote_row

  join public.sales_quote_items item_row

    on item_row.quote_id = quote_row.id

   and item_row.organization_id = quote_row.organization_id

   and item_row.store_id = quote_row.store_id

  where quote_row.id = ctx.quote_a

  group by quote_row.id;



  perform pg_temp._p9_apply_change_atomic_record(

    1,

    'apply-change atomic writer replaces items and header coherently',

    case

      when r.operation_succeeded

       and v_item_count = 2

       and v_quote_subtotal = 25000

       and v_quote_discount = 2000

       and v_quote_total = 23000

       and v_sum_subtotal = 25000

       and v_sum_discount = 2000

       and v_sum_total = 23000

       and v_quote_total = v_quote_subtotal - v_quote_discount

      then 'PASS' else 'SUT_FAIL'

    end,

    pg_catalog.format('result=%s quote=%s/%s/%s sums=%s/%s/%s items=%s', coalesce(r.message_text, r.value_json::text), v_quote_subtotal, v_quote_discount, v_quote_total, v_sum_subtotal, v_sum_discount, v_sum_total, v_item_count)

  );



  v_duplicate_item_id := gen_random_uuid();



  q := pg_catalog.format(

    $sql$

      select * from public.apply_sales_quote_change_money_and_items_by_system(

        %L::uuid, %L::uuid, %L::uuid,

        'Atomic B updated'::text, 'pending_review'::text,

        2000::integer, 0::integer, 2000::integer,

        null::text, null::text, null::text, null::text, null::text, null::date, '{}'::jsonb,

        %L::jsonb

      )

    $sql$,

    ctx.org_id,

    ctx.store_id,

    ctx.quote_b,

    pg_catalog.jsonb_build_array(

      pg_catalog.jsonb_build_object('id',v_duplicate_item_id,'item_type','custom','name','Dup A','quantity',1,'unit_price_cents',1000,'discount_cents',0,'subtotal_cents',1000,'total_cents',1000,'sort_order',1,'metadata','{}'::jsonb),

      pg_catalog.jsonb_build_object('id',v_duplicate_item_id,'item_type','custom','name','Dup B','quantity',1,'unit_price_cents',1000,'discount_cents',0,'subtotal_cents',1000,'total_cents',1000,'sort_order',2,'metadata','{}'::jsonb)

    )::text

  );



  select * into r from pg_temp._p9_apply_change_atomic_exec_json('service_role', null, q);



  select quote_row.subtotal_cents, quote_row.discount_cents, quote_row.total_cents, pg_catalog.count(item_row.id)::integer

  into v_quote_subtotal, v_quote_discount, v_quote_total, v_item_count

  from public.sales_quotes quote_row

  join public.sales_quote_items item_row

    on item_row.quote_id = quote_row.id

   and item_row.organization_id = quote_row.organization_id

   and item_row.store_id = quote_row.store_id

  where quote_row.id = ctx.quote_b

  group by quote_row.id;



  perform pg_temp._p9_apply_change_atomic_record(

    2,

    'apply-change atomic writer rolls back delete/update when insert fails',

    case

      when not r.operation_succeeded

       and r.returned_sqlstate = '23505'

       and v_item_count = 1

       and v_quote_subtotal = 30000

       and v_quote_discount = 1000

       and v_quote_total = 29000

      then 'PASS' else 'SUT_FAIL'

    end,

    pg_catalog.format('state=%s message=%s quote=%s/%s/%s items=%s', coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>'), v_quote_subtotal, v_quote_discount, v_quote_total, v_item_count)

  );



  q := pg_catalog.format(

    $sql$

      select * from public.apply_sales_quote_change_money_and_items_by_system(

        %L::uuid, %L::uuid, %L::uuid,

        'Atomic C updated'::text, 'pending_review'::text,

        2147483647::integer, 0::integer, 2147483647::integer,

        null::text, null::text, null::text, null::text, null::text, null::date, '{}'::jsonb,

        %L::jsonb

      )

    $sql$,

    ctx.org_id,

    ctx.store_id,

    ctx.quote_c,

    pg_catalog.jsonb_build_array(

      pg_catalog.jsonb_build_object('item_type','custom','name','Overflow A','quantity',1,'unit_price_cents',1073741824,'discount_cents',0,'subtotal_cents',1073741824,'total_cents',1073741824,'sort_order',1,'metadata','{}'::jsonb),

      pg_catalog.jsonb_build_object('item_type','custom','name','Overflow B','quantity',1,'unit_price_cents',1073741824,'discount_cents',0,'subtotal_cents',1073741824,'total_cents',1073741824,'sort_order',2,'metadata','{}'::jsonb)

    )::text

  );



  select * into r from pg_temp._p9_apply_change_atomic_exec_json('service_role', null, q);



  select quote_row.subtotal_cents, quote_row.discount_cents, quote_row.total_cents, pg_catalog.count(item_row.id)::integer

  into v_quote_subtotal, v_quote_discount, v_quote_total, v_item_count

  from public.sales_quotes quote_row

  join public.sales_quote_items item_row

    on item_row.quote_id = quote_row.id

   and item_row.organization_id = quote_row.organization_id

   and item_row.store_id = quote_row.store_id

  where quote_row.id = ctx.quote_c

  group by quote_row.id;



  perform pg_temp._p9_apply_change_atomic_record(

    3,

    'apply-change atomic writer rejects aggregate overflow before mutation',

    case

      when not r.operation_succeeded

       and coalesce(r.message_text,'') ilike '%MONEY_OUT_OF_RANGE%'

       and v_item_count = 1

       and v_quote_subtotal = 30000

       and v_quote_discount = 1000

       and v_quote_total = 29000

      then 'PASS' else 'SUT_FAIL'

    end,

    pg_catalog.format('state=%s message=%s quote=%s/%s/%s items=%s', coalesce(r.returned_sqlstate,'<null>'), coalesce(r.message_text,'<null>'), v_quote_subtotal, v_quote_discount, v_quote_total, v_item_count)

  );

exception when others then

  perform pg_temp._p9_apply_change_atomic_record(999, 'runner uncaught error', 'HARNESS_ERROR', sqlstate || ' ' || sqlerrm);

end;

$scenarios$;



do $assertions$

declare

  v_failed integer;

  v_passed integer;

  v_missing integer;

  v_detail text;

begin

  select count(*) filter (where status = 'PASS'),

         count(*) filter (where status <> 'PASS')

  into v_passed, v_failed

  from pg_temp._p9_apply_change_atomic_results

  where scenario_number between 1 and 3;



  select count(*)

  into v_missing

  from generate_series(1, 3) as scenario_row(scenario_number)

  where not exists (

    select 1

    from pg_temp._p9_apply_change_atomic_results result_row

    where result_row.scenario_number = scenario_row.scenario_number

  );



  if v_failed > 0 or v_missing > 0 then

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

    from pg_temp._p9_apply_change_atomic_results result_row

    where result_row.status <> 'PASS'

       or result_row.scenario_number not between 1 and 3;



    raise exception using

      errcode = 'P0001',

      message = 'P9 6.2 apply-change atomic writer manual checks failed',

      detail = pg_catalog.format(

        'passed=%s failed=%s missing=%s%s%s',

        coalesce(v_passed, 0),

        coalesce(v_failed, 0),

        coalesce(v_missing, 0),

        E'\n',

        coalesce(v_detail, '<no failure rows>')

      );

  end if;



  raise notice 'P9 6.2 apply-change atomic writer manual checks passed: % scenarios', v_passed;

end;

$assertions$;



rollback;

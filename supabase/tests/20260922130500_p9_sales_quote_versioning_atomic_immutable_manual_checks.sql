begin;



set transaction isolation level repeatable read;

set local lock_timeout = '5s';

set local statement_timeout = '300s';

set local idle_in_transaction_session_timeout = '300s';

set local search_path = pg_catalog, pg_temp, public, auth, extensions;



create temp table pg_temp._p9_quote_versioning_results (

  scenario_number integer primary key,

  scenario_name text not null,

  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),

  detail text not null

) on commit preserve rows;



create or replace function pg_temp._p9_quote_versioning_record(

  p_scenario_number integer,

  p_scenario_name text,

  p_status text,

  p_detail text default null

)

returns void

language plpgsql

as $function$

begin

  insert into pg_temp._p9_quote_versioning_results(

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



create or replace function pg_temp._p9_quote_versioning_exec_json(

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

    execute pg_catalog.format(
      'with result_row as (%s) select to_jsonb(result_row) from result_row',
      p_sql
    )

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



create or replace function pg_temp._p9_quote_versioning_send_key(

  p_organization_id uuid,

  p_store_id uuid,

  p_commercial_opportunity_id uuid,

  p_sales_quote_id uuid,

  p_sales_quote_version_id uuid

)

returns text

language sql

stable

as $function$

  select

    'sales_quote_send:'

    || p_organization_id::text

    || ':'

    || p_store_id::text

    || ':'

    || p_commercial_opportunity_id::text

    || ':'

    || p_sales_quote_id::text

    || ':'

    || p_sales_quote_version_id::text;

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

  v_lead_a uuid := gen_random_uuid();

  v_conv_a uuid := gen_random_uuid();

  v_quote_a uuid := gen_random_uuid();

  v_quote_b uuid := gen_random_uuid();

  v_quote_c uuid := gen_random_uuid();

  v_file_a uuid := gen_random_uuid();

  v_file_b uuid := gen_random_uuid();

  v_file_c uuid := gen_random_uuid();

  v_file_d uuid := gen_random_uuid();

  v_file_e uuid := gen_random_uuid();

begin

  create temp table pg_temp._p9_quote_versioning_ctx (

    singleton boolean primary key default true check (singleton),

    org_id uuid not null,

    store_id uuid not null,

    user_id uuid not null,

    quote_a uuid not null,

    quote_b uuid not null,

    quote_c uuid not null,

    lead_a uuid not null,

    conv_a uuid not null,

    file_a uuid not null,

    file_b uuid not null,

    file_c uuid not null,

    file_d uuid not null,

    file_e uuid not null

  ) on commit preserve rows;



  insert into pg_temp._p9_quote_versioning_ctx(

    org_id, store_id, user_id, quote_a, quote_b, quote_c, lead_a, conv_a, file_a, file_b, file_c, file_d, file_e

  ) values (

    v_org, v_store, v_user, v_quote_a, v_quote_b, v_quote_c, v_lead_a, v_conv_a, v_file_a, v_file_b, v_file_c, v_file_d, v_file_e

  );



  insert into auth.users(id) values (v_user);

  insert into public.organizations (id, name, subscription_status)

  values (v_org, 'P9 Quote Versioning Org', 'active');

  insert into public.stores (id, organization_id, name)

  values (v_store, v_org, 'P9 Quote Versioning Store');

  insert into public.memberships (organization_id, user_id, role, is_active)

  values (v_org, v_user, 'admin', true);

  insert into public.customers (id, organization_id, display_name)

  values (v_customer, v_org, 'P9 Quote Versioning Customer');

  insert into public.leads (id, organization_id, store_id, name, phone, state)

  values (v_lead_a, v_org, v_store, 'P9 Quote Versioning Lead', '5511999990000', 'orcamento');

  insert into public.conversations (id, organization_id, lead_id, status, is_human_active)

  values (v_conv_a, v_org, v_lead_a, 'orcamento', false);



  perform set_config('app.allow_state_update', 'true', true);



  update public.conversation_states as conversation_state_row

  set state = 'orcamento',

      entered_at = clock_timestamp(),

      updated_at = clock_timestamp()

  where conversation_state_row.organization_id = v_org

    and conversation_state_row.conversation_id = v_conv_a;



  perform set_config('app.allow_state_update', 'false', true);



  insert into public.commercial_opportunities (id, organization_id, store_id, customer_id, stage)

  values

    (v_opp_a, v_org, v_store, v_customer, 'orcamento'),

    (v_opp_b, v_org, v_store, v_customer, 'orcamento'),

    (v_opp_c, v_org, v_store, v_customer, 'orcamento');



  insert into public.store_files (

    id, organization_id, store_id, file_kind, storage_bucket, storage_path,

    original_filename, mime_type, size_bytes, uploaded_by

  ) values

    (v_file_a, v_org, v_store, 'sales_quote_pdf', 'zion-store-files', 'p9/quote-a-v1.pdf', 'quote-a-v1.pdf', 'application/pdf', 100, 'system'),

    (v_file_b, v_org, v_store, 'sales_quote_pdf', 'zion-store-files', 'p9/quote-a-v2.pdf', 'quote-a-v2.pdf', 'application/pdf', 200, 'system'),

    (v_file_c, v_org, v_store, 'sales_quote_pdf', 'zion-store-files', 'p9/quote-b-v1.pdf', 'quote-b-v1.pdf', 'application/pdf', 300, 'system'),

    (v_file_d, v_org, v_store, 'sales_quote_pdf', 'zion-store-files', 'p9/quote-c-v1.pdf', 'quote-c-v1.pdf', 'application/pdf', 400, 'system'),

    (v_file_e, v_org, v_store, 'sales_quote_pdf', 'zion-store-files', 'p9/duplicate.pdf', 'duplicate.pdf', 'application/pdf', 10, 'system');



  insert into public.sales_quotes (

    id, organization_id, store_id, commercial_opportunity_id,

    conversation_id, lead_id, quote_number, title, status,

    customer_name, customer_phone, customer_notes, internal_notes,

    payment_terms, delivery_terms, warranty_terms, valid_until,

    subtotal_cents, discount_cents, total_cents, current_version_id, metadata

  ) values

    (v_quote_a, v_org, v_store, v_opp_a, v_conv_a, v_lead_a, 'V63-1', 'Versioned A', 'draft', 'Customer A', '1191', null, null, 'Pix', '10 dias', '12 meses', '2026-10-01', 10000, 1000, 9000, null, '{}'::jsonb),

    (v_quote_b, v_org, v_store, v_opp_b, null, null, 'V63-2', 'Rollback B', 'draft', 'Customer B', '1192', null, null, null, null, null, null, 10000, 0, 10000, null, '{}'::jsonb),

    (v_quote_c, v_org, v_store, v_opp_c, null, null, 'V63-3', 'Scope C', 'draft', 'Customer C', '1193', null, null, null, null, null, null, 10000, 0, 10000, null, '{}'::jsonb);

end;

$fixtures$;



do $scenarios$

declare

  ctx pg_temp._p9_quote_versioning_ctx%rowtype;

  r record;

  v_version_1 uuid;

  v_version_2 uuid;

  v_failed_version uuid;

  v_current uuid;

  v_count integer;

  v_title text;

  v_status text;

  v_message_id uuid;

  v_sent_at timestamptz;

  v_provider_at timestamptz;

  v_key text;

begin

  select * into ctx from pg_temp._p9_quote_versioning_ctx where singleton;



  select *

  into r

  from pg_temp._p9_quote_versioning_exec_json(

    'service_role',

    ctx.user_id,

    pg_catalog.format(

      $sql$

        select * from public.create_sales_quote_version_by_system(

          %L::uuid, %L::uuid, %L::uuid,

          'generated', 'pending_review', 'preliminary',

          %L::uuid, 'zion-store-files', 'p9/quote-a-v1.pdf',

          'quote-a-v1.pdf', 'application/pdf', 100,

          '{"quote":{"title":"Versioned A","customerName":"Customer A","paymentTerms":"Pix"},"items":[],"settings":{}}'::jsonb

        )

      $sql$,

      ctx.org_id, ctx.store_id, ctx.quote_a, ctx.file_a

    )

  );



  if r.operation_succeeded and (r.value_json ->> 'version_number')::integer = 1 then

    v_version_1 := (r.value_json ->> 'id')::uuid;

    perform pg_temp._p9_quote_versioning_record(1, 'versao 1 gerada', 'PASS', r.value_json::text);

  else

    perform pg_temp._p9_quote_versioning_record(1, 'versao 1 gerada', 'SUT_FAIL', coalesce(r.message_text, r.value_json::text));

  end if;



  update public.sales_quotes

  set title = 'Versioned A v2'

  where id = ctx.quote_a

    and organization_id = ctx.org_id

    and store_id = ctx.store_id;



  select *

  into r

  from pg_temp._p9_quote_versioning_exec_json(

    'service_role',

    ctx.user_id,

    pg_catalog.format(

      $sql$

        select * from public.create_sales_quote_version_by_system(

          %L::uuid, %L::uuid, %L::uuid,

          'generated', 'pending_review', 'definitive',

          %L::uuid, 'zion-store-files', 'p9/quote-a-v2.pdf',

          'quote-a-v2.pdf', 'application/pdf', 200,

          '{"quote":{"title":"Versioned A v2","customerName":"Customer A","paymentTerms":"Pix"},"items":[],"settings":{}}'::jsonb

        )

      $sql$,

      ctx.org_id, ctx.store_id, ctx.quote_a, ctx.file_b

    )

  );



  if r.operation_succeeded and (r.value_json ->> 'version_number')::integer = 2 then

    v_version_2 := (r.value_json ->> 'id')::uuid;

    perform pg_temp._p9_quote_versioning_record(2, 'versao 2 gerada', 'PASS', r.value_json::text);

  else

    perform pg_temp._p9_quote_versioning_record(2, 'versao 2 gerada', 'SUT_FAIL', coalesce(r.message_text, r.value_json::text));

  end if;



  select current_version_id

  into v_current

  from public.sales_quotes

  where id = ctx.quote_a

    and organization_id = ctx.org_id

    and store_id = ctx.store_id;



  if v_current = v_version_2 then

    perform pg_temp._p9_quote_versioning_record(3, 'current_version_id aponta para v2', 'PASS', v_current::text);

  else

    perform pg_temp._p9_quote_versioning_record(3, 'current_version_id aponta para v2', 'SUT_FAIL', coalesce(v_current::text, '<null>'));

  end if;



  select quote_snapshot #>> '{quote,title}', status

  into v_title, v_status

  from public.sales_quote_versions

  where id = v_version_1;



  if v_title = 'Versioned A' and v_status = 'superseded' then

    perform pg_temp._p9_quote_versioning_record(4, 'snapshot v1 intacto e superseded', 'PASS', v_title || '/' || v_status);

  else

    perform pg_temp._p9_quote_versioning_record(4, 'snapshot v1 intacto e superseded', 'SUT_FAIL', coalesce(v_title, '<null>') || '/' || coalesce(v_status, '<null>'));

  end if;



  select *

  into r

  from pg_temp._p9_quote_versioning_exec_json(

    'postgres',

    null,

    pg_catalog.format(

      $sql$

        insert into public.sales_quote_versions (

          quote_id, organization_id, store_id, version_number, status,

          store_file_id, storage_bucket, storage_path, original_filename,

          mime_type, size_bytes, quote_snapshot

        ) values (

          %L::uuid, %L::uuid, %L::uuid, 2, 'generated',

          %L::uuid, 'zion-store-files', 'p9/duplicate.pdf',

          'duplicate.pdf', 'application/pdf', 10, '{}'::jsonb

        )

        returning id

      $sql$,

      ctx.quote_a, ctx.org_id, ctx.store_id, ctx.file_e

    )

  );



  if not r.operation_succeeded and r.returned_sqlstate = '23505' then

    perform pg_temp._p9_quote_versioning_record(5, 'unique quote/version_number impede colisao', 'PASS', r.message_text);

  else

    perform pg_temp._p9_quote_versioning_record(5, 'unique quote/version_number impede colisao', 'SUT_FAIL', coalesce(r.value_json::text, r.message_text));

  end if;



  create or replace function pg_temp._p9_quote_versioning_fail_after_insert()

  returns trigger

  language plpgsql

  as $function$

  begin

    if new.quote_id = (select quote_b from pg_temp._p9_quote_versioning_ctx where singleton)

       and new.status = 'generated' then

      raise exception using

        errcode = 'P0001',

        message = 'P9_TEST_FORCED_VERSION_WRITER_FAILURE';

    end if;



    return new;

  end;

  $function$;



  create trigger p9_quote_versioning_fail_after_insert

  after insert on public.sales_quote_versions

  for each row

  execute function pg_temp._p9_quote_versioning_fail_after_insert();



  select *

  into r

  from pg_temp._p9_quote_versioning_exec_json(

    'service_role',

    ctx.user_id,

    pg_catalog.format(

      $sql$

        select * from public.create_sales_quote_version_by_system(

          %L::uuid, %L::uuid, %L::uuid,

          'generated', 'pending_review', null,

          %L::uuid, 'zion-store-files', 'p9/quote-b-v1.pdf',

          'quote-b-v1.pdf', 'application/pdf', 300, '{}'::jsonb

        )

      $sql$,

      ctx.org_id, ctx.store_id, ctx.quote_b, ctx.file_c

    )

  );



  drop trigger p9_quote_versioning_fail_after_insert on public.sales_quote_versions;



  select pg_catalog.count(*)

  into v_count

  from public.sales_quote_versions

  where quote_id = ctx.quote_b

    and organization_id = ctx.org_id

    and store_id = ctx.store_id;



  select current_version_id

  into v_current

  from public.sales_quotes

  where id = ctx.quote_b

    and organization_id = ctx.org_id

    and store_id = ctx.store_id;



  if not r.operation_succeeded

     and r.message_text = 'P9_TEST_FORCED_VERSION_WRITER_FAILURE'

     and v_count = 0

     and v_current is null then

    perform pg_temp._p9_quote_versioning_record(6, 'rollback real dentro do writer', 'PASS', r.message_text);

  else

    perform pg_temp._p9_quote_versioning_record(6, 'rollback real dentro do writer', 'SUT_FAIL', pg_catalog.format('ok=%s count=%s current=%s message=%s', r.operation_succeeded, v_count, v_current, r.message_text));

  end if;



  select *

  into r

  from pg_temp._p9_quote_versioning_exec_json(

    'service_role',

    ctx.user_id,

    pg_catalog.format(

      $sql$

        select * from public.create_sales_quote_version_by_system(

          %L::uuid, %L::uuid, %L::uuid,

          'failed', null, null,

          null, null, null, null, null, null,

          '{"generationError":"boom"}'::jsonb

        )

      $sql$,

      ctx.org_id, ctx.store_id, ctx.quote_a

    )

  );



  v_failed_version := null;

  if r.operation_succeeded then

    v_failed_version := (r.value_json ->> 'id')::uuid;

  end if;



  select current_version_id

  into v_current

  from public.sales_quotes

  where id = ctx.quote_a

    and organization_id = ctx.org_id

    and store_id = ctx.store_id;



  select status

  into v_status

  from public.sales_quote_versions

  where id = v_version_2;



  if r.operation_succeeded

     and (r.value_json ->> 'version_number')::integer = 3

     and (r.value_json ->> 'status') = 'failed'

     and v_current = v_version_2

     and v_status = 'generated' then

    perform pg_temp._p9_quote_versioning_record(7, 'versao failed nao vira current nem supersede', 'PASS', r.value_json::text);

  else

    perform pg_temp._p9_quote_versioning_record(
      7,
      'versao failed nao vira current nem supersede',
      'SUT_FAIL',
      pg_catalog.format(
        'ok=%s row=%s current=%s v2_status=%s failed=%s sqlstate=%s message=%s',
        r.operation_succeeded,
        r.value_json,
        v_current,
        v_status,
        v_failed_version,
        r.returned_sqlstate,
        r.message_text
      )
    );

  end if;



  select *

  into r

  from pg_temp._p9_quote_versioning_exec_json(

    'postgres',

    null,

    pg_catalog.format(

      $sql$

        update public.sales_quote_versions

        set quote_snapshot = '{"mutated":true}'::jsonb

        where id = %L::uuid

        returning id

      $sql$,

      v_version_1

    )

  );



  if not r.operation_succeeded and r.message_text = 'ZION_SALES_QUOTE_VERSION_IMMUTABLE_FIELD_UPDATE_FORBIDDEN' then

    perform pg_temp._p9_quote_versioning_record(8, 'update quote_snapshot negado', 'PASS', r.message_text);

  else

    perform pg_temp._p9_quote_versioning_record(8, 'update quote_snapshot negado', 'SUT_FAIL', coalesce(r.value_json::text, r.message_text));

  end if;



  select *

  into r

  from pg_temp._p9_quote_versioning_exec_json(

    'postgres',

    null,

    pg_catalog.format(

      $sql$

        delete from public.sales_quote_versions

        where id = %L::uuid

        returning id

      $sql$,

      v_failed_version

    )

  );



  if not r.operation_succeeded and r.message_text = 'ZION_SALES_QUOTE_VERSION_DELETE_FORBIDDEN' then

    perform pg_temp._p9_quote_versioning_record(9, 'delete de versao negado', 'PASS', r.message_text);

  else

    perform pg_temp._p9_quote_versioning_record(9, 'delete de versao negado', 'SUT_FAIL', coalesce(r.value_json::text, r.message_text));

  end if;



  select *

  into r

  from pg_temp._p9_quote_versioning_exec_json(

    'service_role',

    ctx.user_id,

    pg_catalog.format(

      $sql$

        select * from public.approve_sales_quote_version_by_system(

          %L::uuid, %L::uuid, %L::uuid, %L::uuid

        )

      $sql$,

      ctx.org_id, ctx.store_id, ctx.quote_a, v_version_2

    )

  );



  if r.operation_succeeded

     and r.value_json ->> 'status' = 'approved'

     and nullif(r.value_json ->> 'sent_at', '') is null then

    perform pg_temp._p9_quote_versioning_record(10, 'aprovacao canonica nao cria sent_at', 'PASS', r.value_json::text);

  else

    perform pg_temp._p9_quote_versioning_record(10, 'aprovacao canonica nao cria sent_at', 'SUT_FAIL', coalesce(r.value_json::text, r.message_text));

  end if;



  v_key := pg_temp._p9_quote_versioning_send_key(

    ctx.org_id,

    ctx.store_id,

    (select commercial_opportunity_id from public.sales_quotes where id = ctx.quote_a),

    ctx.quote_a,

    v_version_2

  );



  select *

  into r

  from pg_temp._p9_quote_versioning_exec_json(

    'service_role',

    ctx.user_id,

    pg_catalog.format(

      $sql$

        select * from public.materialize_sales_quote_send_by_system(

          %L::uuid, %L::uuid,

          (select commercial_opportunity_id from public.sales_quotes where id = %L::uuid),

          %L::uuid, %L::uuid, %L::uuid,

          'Segue o orcamento.'::text,

          '{"runner":"p9_6_3"}'::jsonb,

          %L::text,

          'sales_quote_send_route'::text

        )

      $sql$,

      ctx.org_id,

      ctx.store_id,

      ctx.quote_a,

      ctx.conv_a,

      ctx.quote_a,

      v_version_2,

      v_key

    )

  );



  if r.operation_succeeded then

    v_message_id := (r.value_json ->> 'message_id')::uuid;

    v_provider_at := clock_timestamp();



    update public.messages

    set external_message_id = 'wamid.p9-6-3-versioning',

        outbound_delivery_state = 'sent',

        outbound_provider_accepted_at = v_provider_at

    where id = v_message_id

      and organization_id = ctx.org_id

      and store_id = ctx.store_id;



    select *

    into r

    from pg_temp._p9_quote_versioning_exec_json(

      'service_role',

      ctx.user_id,

      pg_catalog.format(

        $sql$

          select * from public.finalize_sales_quote_send_by_system(

            %L::uuid, %L::uuid,

            (select commercial_opportunity_id from public.sales_quotes where id = %L::uuid),

            %L::uuid, %L::uuid, %L::uuid,

            %L::text,

            'system_quote_send_reconciliation'::text

          )

        $sql$,

        ctx.org_id,

        ctx.store_id,

        ctx.quote_a,

        ctx.quote_a,

        v_version_2,

        v_message_id,

        v_key

      )

    );

  end if;



  select sent_at

  into v_sent_at

  from public.sales_quote_versions

  where id = v_version_2

    and quote_id = ctx.quote_a

    and organization_id = ctx.org_id

    and store_id = ctx.store_id;



  if r.operation_succeeded and v_sent_at is not null then

    perform pg_temp._p9_quote_versioning_record(11, 'envio canonico preenche sent_at', 'PASS', r.value_json::text);

  else

    perform pg_temp._p9_quote_versioning_record(11, 'envio canonico preenche sent_at', 'SUT_FAIL', pg_catalog.format('row=%s sent_at=%s message=%s', r.value_json, v_sent_at, r.message_text));

  end if;



  select *

  into r

  from pg_temp._p9_quote_versioning_exec_json(

    'postgres',

    null,

    pg_catalog.format(

      $sql$

        update public.sales_quote_versions

        set sent_at = null

        where id = %L::uuid

        returning id

      $sql$,

      v_version_2

    )

  );



  if not r.operation_succeeded and r.message_text = 'ZION_SALES_QUOTE_VERSION_SENT_AT_IMMUTABLE' then

    perform pg_temp._p9_quote_versioning_record(12, 'sent_at preenchido nao pode ser apagado', 'PASS', r.message_text);

  else

    perform pg_temp._p9_quote_versioning_record(12, 'sent_at preenchido nao pode ser apagado', 'SUT_FAIL', coalesce(r.value_json::text, r.message_text));

  end if;



  select *

  into r

  from pg_temp._p9_quote_versioning_exec_json(

    'postgres',

    null,

    pg_catalog.format(

      $sql$

        update public.sales_quote_versions

        set sent_at = clock_timestamp() + interval '1 hour'

        where id = %L::uuid

        returning id

      $sql$,

      v_version_2

    )

  );



  if not r.operation_succeeded and r.message_text = 'ZION_SALES_QUOTE_VERSION_SENT_AT_IMMUTABLE' then

    perform pg_temp._p9_quote_versioning_record(13, 'sent_at preenchido nao pode ser regravado', 'PASS', r.message_text);

  else

    perform pg_temp._p9_quote_versioning_record(13, 'sent_at preenchido nao pode ser regravado', 'SUT_FAIL', coalesce(r.value_json::text, r.message_text));

  end if;



  select *

  into r

  from pg_temp._p9_quote_versioning_exec_json(

    'authenticated',

    ctx.user_id,

    pg_catalog.format(

      $sql$

        insert into public.sales_quote_versions (

          quote_id, organization_id, store_id, version_number, status, quote_snapshot

        ) values (

          %L::uuid, %L::uuid, %L::uuid, 99, 'generated', '{}'::jsonb

        )

        returning id

      $sql$,

      ctx.quote_a, ctx.org_id, ctx.store_id

    )

  );



  if not r.operation_succeeded and r.returned_sqlstate = '42501' then

    perform pg_temp._p9_quote_versioning_record(14, 'authenticated nao insere versao direto', 'PASS', r.returned_sqlstate || ':' || r.message_text);

  else

    perform pg_temp._p9_quote_versioning_record(14, 'authenticated nao insere versao direto', 'SUT_FAIL', r.value_json::text);

  end if;



  select *

  into r

  from pg_temp._p9_quote_versioning_exec_json(

    'authenticated',

    ctx.user_id,

    pg_catalog.format(

      $sql$

        update public.sales_quote_versions

        set status = 'approved',

            sent_at = clock_timestamp()

        where id = %L::uuid

        returning id

      $sql$,

      v_failed_version

    )

  );



  if not r.operation_succeeded and r.returned_sqlstate = '42501' then

    perform pg_temp._p9_quote_versioning_record(15, 'authenticated nao atualiza status/sent_at direto', 'PASS', r.returned_sqlstate || ':' || r.message_text);

  else

    perform pg_temp._p9_quote_versioning_record(15, 'authenticated nao atualiza status/sent_at direto', 'SUT_FAIL', r.value_json::text);

  end if;



  select *

  into r

  from pg_temp._p9_quote_versioning_exec_json(

    'authenticated',

    ctx.user_id,

    pg_catalog.format(

      $sql$

        delete from public.sales_quote_versions

        where id = %L::uuid

        returning id

      $sql$,

      v_failed_version

    )

  );



  if not r.operation_succeeded and r.returned_sqlstate = '42501' then

    perform pg_temp._p9_quote_versioning_record(16, 'authenticated nao deleta versao direto', 'PASS', r.returned_sqlstate || ':' || r.message_text);

  else

    perform pg_temp._p9_quote_versioning_record(16, 'authenticated nao deleta versao direto', 'SUT_FAIL', r.value_json::text);

  end if;



  select *

  into r

  from pg_temp._p9_quote_versioning_exec_json(

    'anon',

    null,

    pg_catalog.format(

      $sql$

        insert into public.sales_quote_versions (

          quote_id, organization_id, store_id, version_number, status, quote_snapshot

        ) values (

          %L::uuid, %L::uuid, %L::uuid, 100, 'generated', '{}'::jsonb

        )

        returning id

      $sql$,

      ctx.quote_a, ctx.org_id, ctx.store_id

    )

  );



  if not r.operation_succeeded and r.returned_sqlstate = '42501' then

    perform pg_temp._p9_quote_versioning_record(17, 'anon nao escreve versao', 'PASS', r.returned_sqlstate || ':' || r.message_text);

  else

    perform pg_temp._p9_quote_versioning_record(17, 'anon nao escreve versao', 'SUT_FAIL', r.value_json::text);

  end if;



  select *

  into r

  from pg_temp._p9_quote_versioning_exec_json(

    'service_role',

    ctx.user_id,

    pg_catalog.format(

      $sql$

        insert into public.sales_quote_versions (

          quote_id, organization_id, store_id, version_number, status, quote_snapshot

        ) values (

          %L::uuid, %L::uuid, %L::uuid, 101, 'generated', '{}'::jsonb

        )

        returning id

      $sql$,

      ctx.quote_a, ctx.org_id, ctx.store_id

    )

  );



  if not r.operation_succeeded and r.returned_sqlstate = '42501' then

    perform pg_temp._p9_quote_versioning_record(18, 'service_role nao insere versao direto', 'PASS', r.returned_sqlstate || ':' || r.message_text);

  else

    perform pg_temp._p9_quote_versioning_record(18, 'service_role nao insere versao direto', 'SUT_FAIL', r.value_json::text);

  end if;



  select *

  into r

  from pg_temp._p9_quote_versioning_exec_json(

    'service_role',

    ctx.user_id,

    pg_catalog.format(

      $sql$

        delete from public.sales_quote_versions

        where id = %L::uuid

        returning id

      $sql$,

      v_failed_version

    )

  );



  if not r.operation_succeeded and r.returned_sqlstate = '42501' then

    perform pg_temp._p9_quote_versioning_record(19, 'service_role nao deleta versao direto', 'PASS', r.returned_sqlstate || ':' || r.message_text);

  else

    perform pg_temp._p9_quote_versioning_record(19, 'service_role nao deleta versao direto', 'SUT_FAIL', r.value_json::text);

  end if;



  if not has_table_privilege('anon', 'public.sales_quote_versions', 'TRUNCATE')

     and not has_table_privilege('authenticated', 'public.sales_quote_versions', 'TRUNCATE')

     and not has_table_privilege('service_role', 'public.sales_quote_versions', 'TRUNCATE') then

    perform pg_temp._p9_quote_versioning_record(20, 'papeis de aplicacao sem TRUNCATE', 'PASS', 'anon/authenticated/service_role');

  else

    perform pg_temp._p9_quote_versioning_record(20, 'papeis de aplicacao sem TRUNCATE', 'SUT_FAIL', 'TRUNCATE privilege present');

  end if;



  select *

  into r

  from pg_temp._p9_quote_versioning_exec_json(

    'service_role',

    ctx.user_id,

    pg_catalog.format(

      $sql$

        select * from public.create_sales_quote_version_by_system(

          %L::uuid, gen_random_uuid(), %L::uuid,

          'generated', 'pending_review', null,

          %L::uuid, 'zion-store-files', 'p9/quote-c-v1.pdf',

          'quote-c-v1.pdf', 'application/pdf', 400, '{}'::jsonb

        )

      $sql$,

      ctx.org_id, ctx.quote_c, ctx.file_d

    )

  );



  select pg_catalog.count(*)

  into v_count

  from public.sales_quote_versions

  where quote_id = ctx.quote_c;



  if not r.operation_succeeded

     and r.message_text = 'ZION_SALES_QUOTE_VERSION_QUOTE_NOT_FOUND'

     and v_count = 0 then

    perform pg_temp._p9_quote_versioning_record(21, 'escopo divergente falha fechado', 'PASS', r.message_text);

  else

    perform pg_temp._p9_quote_versioning_record(21, 'escopo divergente falha fechado', 'SUT_FAIL', pg_catalog.format('ok=%s count=%s message=%s', r.operation_succeeded, v_count, r.message_text));

  end if;



  if pg_catalog.pg_get_functiondef(

       'public.create_sales_quote_version_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text,text,text,integer,jsonb)'::regprocedure

     ) ilike '%for update%' then

    perform pg_temp._p9_quote_versioning_record(22, 'concorrencia: writer usa FOR UPDATE; UNIQUE cobre replay sequencial', 'PASS', 'multi-sessao nao exercitado neste runner');

  else

    perform pg_temp._p9_quote_versioning_record(22, 'concorrencia: writer usa FOR UPDATE; UNIQUE cobre replay sequencial', 'SUT_FAIL', 'FOR UPDATE ausente da definicao');

  end if;

end;

$scenarios$;



do $assertions$

declare

  v_passed integer;

  v_failed integer;

  v_missing integer;

  v_detail text;

begin

  select count(*) filter (where status = 'PASS'),

         count(*) filter (where status <> 'PASS')

  into v_passed, v_failed

  from pg_temp._p9_quote_versioning_results;



  select count(*)

  into v_missing

  from generate_series(1, 22) scenario_row(scenario_number)

  where not exists (

    select 1

    from pg_temp._p9_quote_versioning_results result_row

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

    from pg_temp._p9_quote_versioning_results result_row

    where result_row.status <> 'PASS';



    raise exception using

      errcode = 'P0001',

      message = 'P9 6.3 sales quote versioning atomic immutable manual checks failed',

      detail = pg_catalog.format(

        'passed=%s failed=%s missing=%s%s%s',

        coalesce(v_passed, 0),

        coalesce(v_failed, 0),

        coalesce(v_missing, 0),

        E'\n',

        coalesce(v_detail, '<no failure rows>')

      );

  end if;



  raise notice 'P9 6.3 sales quote versioning atomic immutable manual checks passed: % scenarios', v_passed;

end;

$assertions$;



rollback;

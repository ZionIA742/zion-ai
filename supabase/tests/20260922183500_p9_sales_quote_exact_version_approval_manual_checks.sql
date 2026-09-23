begin;



create temp table pg_temp._p9_exact_approval_results (

  scenario integer primary key,

  name text not null,

  status text not null check (status in ('PASS', 'SUT_FAIL')),

  detail text

) on commit preserve rows;



create or replace function pg_temp._p9_exact_approval_record(

  p_scenario integer,

  p_name text,

  p_status text,

  p_detail text default null

)

returns void

language plpgsql

as $$

begin

  insert into pg_temp._p9_exact_approval_results(scenario, name, status, detail)

  values (p_scenario, p_name, p_status, p_detail)

  on conflict (scenario) do update

    set name = excluded.name,

        status = excluded.status,

        detail = excluded.detail;

end;

$$;



do $fixtures$

declare

  v_org uuid := gen_random_uuid();

  v_store uuid := gen_random_uuid();

  v_user uuid := gen_random_uuid();

  v_customer uuid := gen_random_uuid();

  v_other_org uuid := gen_random_uuid();

  v_other_store uuid := gen_random_uuid();

  v_quote_success uuid := gen_random_uuid();

  v_quote_other uuid := gen_random_uuid();

  v_quote_stale uuid := gen_random_uuid();

  v_quote_expired uuid := gen_random_uuid();

  v_quote_replay uuid := gen_random_uuid();

  v_quote_scope uuid := gen_random_uuid();

  v_quote_create_blocker uuid := gen_random_uuid();

  v_fixture record;

begin

  create temp table pg_temp._p9_exact_approval_ctx (

    singleton boolean primary key default true check (singleton),

    org_id uuid not null,

    store_id uuid not null,

    user_id uuid not null,

    other_org_id uuid not null,

    other_store_id uuid not null,

    quote_success uuid not null,

    quote_other uuid not null,

    quote_stale uuid not null,

    quote_expired uuid not null,

    quote_replay uuid not null,

    quote_scope uuid not null,

    quote_create_blocker uuid not null

  ) on commit preserve rows;



  insert into pg_temp._p9_exact_approval_ctx(

    org_id, store_id, user_id, other_org_id, other_store_id,

    quote_success, quote_other, quote_stale, quote_expired, quote_replay,

    quote_scope, quote_create_blocker

  ) values (

    v_org, v_store, v_user, v_other_org, v_other_store,

    v_quote_success, v_quote_other, v_quote_stale, v_quote_expired,

    v_quote_replay, v_quote_scope, v_quote_create_blocker

  );



  insert into auth.users(id) values (v_user);

  insert into public.organizations (id, name, subscription_status)

  values

    (v_org, 'P9 Exact Approval Org', 'active'),

    (v_other_org, 'P9 Exact Approval Other Org', 'active');

  insert into public.stores (id, organization_id, name)

  values

    (v_store, v_org, 'P9 Exact Approval Store'),

    (v_other_store, v_other_org, 'P9 Exact Approval Other Store');

  insert into public.customers (id, organization_id, display_name)

  values (v_customer, v_org, 'P9 Exact Approval Customer');

  insert into public.memberships (organization_id, user_id, role, is_active)

  values (v_org, v_user, 'admin', true);



  delete from public.event_state_rules

  where event_type = 'orcamento_aprovado'

    and state in ('orcamento', 'qualificacao');

  insert into public.event_state_rules(event_type, state, is_allowed)

  values

    ('orcamento_aprovado', 'orcamento', true),

    ('orcamento_aprovado', 'qualificacao', false);



  create temp table pg_temp._p9_exact_approval_fixture (

    quote_id uuid primary key,

    lead_id uuid not null,

    conversation_id uuid not null,

    opportunity_id uuid not null

  ) on commit preserve rows;



  insert into pg_temp._p9_exact_approval_fixture(quote_id, lead_id, conversation_id, opportunity_id)

  values

    (v_quote_success, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()),

    (v_quote_other, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()),

    (v_quote_stale, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()),

    (v_quote_expired, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()),

    (v_quote_replay, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()),

    (v_quote_scope, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()),

    (v_quote_create_blocker, gen_random_uuid(), gen_random_uuid(), gen_random_uuid());



  insert into public.leads(id, organization_id, store_id, name, phone, state)

  select fixture.lead_id, v_org, v_store, 'P9 Exact Approval Lead', '5511999999999', 'orcamento'

    from pg_temp._p9_exact_approval_fixture fixture;



  insert into public.conversations(id, organization_id, lead_id, status, is_human_active, created_at)

  select fixture.conversation_id, v_org, fixture.lead_id, 'active', true, clock_timestamp()

    from pg_temp._p9_exact_approval_fixture fixture;



  -- The conversation trigger initializes every fixture in novo_lead. Move the

  -- fixtures through the canonical transition writer so conversation_states

  -- and the temporary leads.state compatibility bridge remain coherent.

  for v_fixture in

    select * from pg_temp._p9_exact_approval_fixture

  loop

    perform public.transition_conversation_state_internal(

      p_conversation_id => v_fixture.conversation_id,

      p_to_state => 'qualificacao',

      p_reason => 'p9_6_5_runner_fixture',

      p_actor_type => 'system',

      p_source => 'p9_exact_approval_manual_checks',

      p_event_key => 'p9:6.5:fixture:' || v_fixture.conversation_id::text || ':qualificacao',

      p_metadata => pg_catalog.jsonb_build_object('runner', 'p9_6_5')

    );



    perform public.transition_conversation_state_internal(

      p_conversation_id => v_fixture.conversation_id,

      p_to_state => 'orcamento',

      p_reason => 'p9_6_5_runner_fixture',

      p_actor_type => 'system',

      p_source => 'p9_exact_approval_manual_checks',

      p_event_key => 'p9:6.5:fixture:' || v_fixture.conversation_id::text || ':orcamento',

      p_metadata => pg_catalog.jsonb_build_object('runner', 'p9_6_5')

    );

  end loop;



  insert into public.commercial_opportunities(id, organization_id, store_id, customer_id, stage)

  select fixture.opportunity_id, v_org, v_store, v_customer, 'orcamento'

    from pg_temp._p9_exact_approval_fixture fixture;



  insert into public.sales_quotes (

    id, organization_id, store_id, commercial_opportunity_id,

    conversation_id, lead_id, quote_number, title, status,

    customer_name, customer_phone, valid_until,

    subtotal_cents, discount_cents, total_cents, current_version_id, metadata

  )

  select

    fixture.quote_id,

    v_org,

    v_store,

    fixture.opportunity_id,

    fixture.conversation_id,

    fixture.lead_id,

    'EA-' || row_number() over (order by fixture.quote_id),

    'P9 Exact Approval',

    'pending_review',

    'Cliente',

    '5511999999999',

    ((now() at time zone 'UTC')::date + 30),

    10000,

    0,

    10000,

    null,

    '{}'::jsonb

  from pg_temp._p9_exact_approval_fixture fixture;

end;

$fixtures$;



do $versions$

declare

  ctx pg_temp._p9_exact_approval_ctx%rowtype;

  fixture record;

  v_version uuid;

  v_version_2 uuid;

  v_valid_until date;

begin

  select * into ctx from pg_temp._p9_exact_approval_ctx where singleton;



  create temp table pg_temp._p9_exact_approval_versions (

    label text primary key,

    quote_id uuid not null,

    version_id uuid not null

  ) on commit preserve rows;



  for fixture in select * from pg_temp._p9_exact_approval_fixture loop

    v_version := gen_random_uuid();

    v_valid_until := case
      when fixture.quote_id = ctx.quote_expired
        then (now() at time zone 'UTC')::date - 1
      else (now() at time zone 'UTC')::date + 30
    end;

    insert into public.sales_quote_versions (

      id, organization_id, store_id, quote_id, version_number, status, quote_kind,

      storage_bucket, storage_path, original_filename, mime_type, size_bytes,

      generated_by, quote_snapshot

    ) values (

      v_version,

      ctx.org_id,

      ctx.store_id,

      fixture.quote_id,

      1,

      'pending_review',

      'definitive',

      'zion-store-files',

      'p9/exact-approval-' || fixture.quote_id::text || '-v1.pdf',

      'exact-approval-v1.pdf',

      'application/pdf',

      100,

      'system',

      jsonb_build_object('quote', jsonb_build_object('validUntil', v_valid_until::text))

    );

    insert into pg_temp._p9_exact_approval_versions(label, quote_id, version_id)

    values (fixture.quote_id::text || ':v1', fixture.quote_id, v_version);

    update public.sales_quotes

       set current_version_id = v_version

     where id = fixture.quote_id;

  end loop;



  select version_id into v_version

    from pg_temp._p9_exact_approval_versions

   where quote_id = ctx.quote_stale;

  v_version_2 := gen_random_uuid();

  insert into public.sales_quote_versions (

    id, organization_id, store_id, quote_id, version_number, status, quote_kind,

    storage_bucket, storage_path, original_filename, mime_type, size_bytes,

    generated_by, quote_snapshot

  ) values (

    v_version_2, ctx.org_id, ctx.store_id, ctx.quote_stale, 2, 'pending_review',

    'definitive', 'zion-store-files', 'p9/exact-approval-stale-v2.pdf',

    'exact-approval-stale-v2.pdf', 'application/pdf', 100, 'system',

    jsonb_build_object('quote', jsonb_build_object('validUntil', ((now() at time zone 'UTC')::date + 30)::text))

  );

  insert into pg_temp._p9_exact_approval_versions(label, quote_id, version_id)

  values ('stale:v2', ctx.quote_stale, v_version_2);

  update public.sales_quotes set current_version_id = v_version_2 where id = ctx.quote_stale;



end;

$versions$;



do $scenarios$

declare

  ctx pg_temp._p9_exact_approval_ctx%rowtype;

  v_success_version uuid;

  v_other_quote_version uuid;

  v_stale_v1 uuid;

  v_expired_version uuid;

  v_replay_version uuid;

  v_scope_version uuid;

  v_blocker_version uuid;

  v_new_version uuid;

  v_count integer;

  v_quote_status text;

  v_version_status text;

  v_approved_at timestamptz;

  v_approved_by uuid;

  v_caught boolean;

  v_old_event_count integer;

  v_new_event_count integer;

  v_old_version_status text;

  v_new_version_status text;

  v_after_approved_file_id uuid := gen_random_uuid();

  v_after_sent_file_id uuid := gen_random_uuid();

  r record;

begin

  select * into ctx from pg_temp._p9_exact_approval_ctx where singleton;

  select version_id into v_success_version from pg_temp._p9_exact_approval_versions where quote_id = ctx.quote_success;

  select version_id into v_other_quote_version from pg_temp._p9_exact_approval_versions where quote_id = ctx.quote_success;

  select version_id into v_stale_v1 from pg_temp._p9_exact_approval_versions where label = ctx.quote_stale::text || ':v1';

  select version_id into v_expired_version from pg_temp._p9_exact_approval_versions where quote_id = ctx.quote_expired;

  select version_id into v_replay_version from pg_temp._p9_exact_approval_versions where quote_id = ctx.quote_replay;

  select version_id into v_scope_version from pg_temp._p9_exact_approval_versions where quote_id = ctx.quote_scope;

  select version_id into v_blocker_version from pg_temp._p9_exact_approval_versions where quote_id = ctx.quote_create_blocker;



  if pg_catalog.to_regprocedure(

       'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid,uuid)'

     ) is not null

     and pg_catalog.to_regprocedure(

       'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid)'

     ) is null

     and not has_function_privilege(

       'authenticated',

       'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid,uuid)',

       'execute'

     )

     and has_function_privilege(

       'service_role',

       'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid,uuid)',

       'execute'

     ) then

    perform pg_temp._p9_exact_approval_record(1, 'signature/grants/old overload', 'PASS', '5-arg service-role writer only');

  else

    perform pg_temp._p9_exact_approval_record(1, 'signature/grants/old overload', 'SUT_FAIL', 'approval writer grant/signature contract changed');

  end if;



  select * into r

    from public.approve_sales_quote_version_by_system(

      ctx.org_id, ctx.store_id, ctx.quote_success, v_success_version, ctx.user_id

    );



  if r.id = v_success_version

     and r.quote_id = ctx.quote_success

     and r.status = 'approved' then

    perform pg_temp._p9_exact_approval_record(2, 'exact quote/version approves', 'PASS', r.id::text);

  else

    perform pg_temp._p9_exact_approval_record(2, 'exact quote/version approves', 'SUT_FAIL', coalesce(r.id::text, '<null>'));

  end if;



  update public.sales_quotes

     set current_version_id = v_other_quote_version

   where id = ctx.quote_other;



  v_caught := false;

  begin

    perform *

      from public.approve_sales_quote_version_by_system(

        ctx.org_id, ctx.store_id, ctx.quote_other, v_other_quote_version, ctx.user_id

      );

  exception

    when sqlstate '23514' then

      if sqlerrm = 'ZION_SALES_QUOTE_VERSION_APPROVAL_VERSION_QUOTE_MISMATCH' then

        v_caught := true;

      end if;

  end;

  perform pg_temp._p9_exact_approval_record(

    3,

    'version de outro quote rejeitada',

    case when v_caught then 'PASS' else 'SUT_FAIL' end,

    'expected VERSION_QUOTE_MISMATCH'

  );



  v_caught := false;

  begin

    update public.sales_quotes

       set current_version_id = gen_random_uuid()

     where id = ctx.quote_other;

    perform *

      from public.approve_sales_quote_version_by_system(

        ctx.org_id,

        ctx.store_id,

        ctx.quote_other,

        (select current_version_id from public.sales_quotes where id = ctx.quote_other),

        ctx.user_id

      );

  exception

    when sqlstate 'P0001' then

      if sqlerrm = 'ZION_SALES_QUOTE_VERSION_APPROVAL_VERSION_NOT_FOUND' then

        v_caught := true;

      end if;

    when foreign_key_violation then

      v_caught := true;

  end;

  perform pg_temp._p9_exact_approval_record(

    4,

    'versao inexistente rejeitada',

    case when v_caught then 'PASS' else 'SUT_FAIL' end,

    'missing current version cannot approve'

  );



  v_caught := false;

  begin

    perform *

      from public.approve_sales_quote_version_by_system(

        ctx.org_id, ctx.store_id, ctx.quote_stale, v_stale_v1, ctx.user_id

      );

  exception

    when sqlstate '23514' then

      if sqlerrm = 'ZION_SALES_QUOTE_VERSION_APPROVAL_REQUIRES_CURRENT_VERSION' then

        v_caught := true;

      end if;

  end;

  perform pg_temp._p9_exact_approval_record(

    5,

    'stale version rejeitada',

    case when v_caught then 'PASS' else 'SUT_FAIL' end,

    'v1 lost to v2'

  );



  select status into v_quote_status from public.sales_quotes where id = ctx.quote_stale;

  select status into v_version_status from public.sales_quote_versions where id = v_stale_v1;

  select count(*) into v_count

    from public.conversation_events

   where event_type = 'orcamento_aprovado'

     and payload ->> 'quote_id' = ctx.quote_stale::text;

  perform pg_temp._p9_exact_approval_record(

    6,

    'stale nao altera quote/version/evento',

    case when v_quote_status = 'pending_review' and v_version_status = 'pending_review' and v_count = 0 then 'PASS' else 'SUT_FAIL' end,

    format('quote=%s version=%s events=%s', v_quote_status, v_version_status, v_count)

  );



  v_caught := false;

  begin

    perform *

      from public.approve_sales_quote_version_by_system(

        ctx.org_id, ctx.store_id, ctx.quote_expired, v_expired_version, ctx.user_id

      );

  exception

    when sqlstate '23514' then

      if sqlerrm = 'ZION_SALES_QUOTE_VERSION_EXPIRED' then

        v_caught := true;

      end if;

  end;

  select status into v_quote_status from public.sales_quotes where id = ctx.quote_expired;

  select status into v_version_status from public.sales_quote_versions where id = v_expired_version;

  perform pg_temp._p9_exact_approval_record(

    7,

    'expirado continua bloqueado sem mutacao',

    case when v_caught and v_quote_status = 'pending_review' and v_version_status = 'pending_review' then 'PASS' else 'SUT_FAIL' end,

    format('caught=%s quote=%s version=%s', v_caught, v_quote_status, v_version_status)

  );



  perform *

    from public.approve_sales_quote_version_by_system(

      ctx.org_id, ctx.store_id, ctx.quote_replay, v_replay_version, ctx.user_id

    );



  select status, approved_at, approved_by

    into v_quote_status, v_approved_at, v_approved_by

    from public.sales_quotes

   where id = ctx.quote_replay;

  select status into v_version_status

    from public.sales_quote_versions

   where id = v_replay_version;

  select count(*) into v_count

    from public.conversation_events

   where organization_id = ctx.org_id

     and event_type = 'orcamento_aprovado'

     and payload ->> 'quote_id' = ctx.quote_replay::text

     and payload ->> 'version_id' = v_replay_version::text;

  perform pg_temp._p9_exact_approval_record(

    8,

    'quote/version/evento/auditoria atomicos',

    case when v_quote_status = 'approved' and v_version_status = 'approved' and v_approved_at is not null and v_approved_by = ctx.user_id and v_count = 1 then 'PASS' else 'SUT_FAIL' end,

    format('quote=%s version=%s approved_by=%s events=%s', v_quote_status, v_version_status, v_approved_by, v_count)

  );



  perform *

    from public.approve_sales_quote_version_by_system(

      ctx.org_id, ctx.store_id, ctx.quote_replay, v_replay_version, ctx.user_id

    );

  select count(*) into v_count

    from public.conversation_events

   where organization_id = ctx.org_id

     and event_type = 'orcamento_aprovado'

     and payload ->> 'quote_id' = ctx.quote_replay::text

     and payload ->> 'version_id' = v_replay_version::text;

  perform pg_temp._p9_exact_approval_record(

    9,

    'replay idempotente nao duplica evento',

    case when v_count = 1 then 'PASS' else 'SUT_FAIL' end,

    format('events=%s', v_count)

  );



  v_caught := false;

  begin

    perform *

      from public.approve_sales_quote_version_by_system(

        ctx.other_org_id, ctx.store_id, ctx.quote_scope, v_scope_version, ctx.user_id

      );

  exception

    when others then

      v_caught := true;

  end;

  perform pg_temp._p9_exact_approval_record(

    10,

    'cross-org/store rejeitado',

    case when v_caught then 'PASS' else 'SUT_FAIL' end,

    'wrong tenant scope cannot approve'

  );



  update public.event_state_rules

     set is_allowed = false

   where event_type = 'orcamento_aprovado'

     and state = 'orcamento';

  v_caught := false;

  begin

    perform *

      from public.approve_sales_quote_version_by_system(

        ctx.org_id, ctx.store_id, ctx.quote_scope, v_scope_version, ctx.user_id

      );

  exception

    when sqlstate 'P0001' then

      if sqlerrm = 'ZION_QUOTE_APPROVAL_EVENT_NOT_ALLOWED' then

        v_caught := true;

      end if;

  end;

  perform pg_temp._p9_exact_approval_record(

    11,

    'event_state_rules negando bloqueia tudo',

    case when v_caught then 'PASS' else 'SUT_FAIL' end,

    'approval event denied'

  );



  update public.event_state_rules

     set is_allowed = true

   where event_type = 'orcamento_aprovado'

     and state = 'orcamento';

  perform *

    from public.approve_sales_quote_version_by_system(

      ctx.org_id, ctx.store_id, ctx.quote_scope, v_scope_version, ctx.user_id

    );

  perform pg_temp._p9_exact_approval_record(12, 'approval valida apos regra permitida', 'PASS', ctx.quote_scope::text);



  if not has_function_privilege(

       'public',

       'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid,uuid)',

       'execute'

     )

     and not has_function_privilege(

       'anon',

       'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid,uuid)',

       'execute'

     )

     and not has_function_privilege(

       'authenticated',

       'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid,uuid)',

       'execute'

     ) then

    perform pg_temp._p9_exact_approval_record(13, 'public/grants nao reabrem escrita direta', 'PASS', 'public anon authenticated denied');

  else

    perform pg_temp._p9_exact_approval_record(13, 'public/grants nao reabrem escrita direta', 'SUT_FAIL', 'unexpected execute grant');

  end if;



  -- Scenario 14 uses the already-approved success fixture. sent_at is one-way
  -- immutable, so this fixture is never reused for a pending-review approval.
  update public.sales_quote_versions

     set status = 'sent',

         sent_at = clock_timestamp()

   where id = v_success_version;

  v_caught := false;

  begin

    perform *

      from public.approve_sales_quote_version_by_system(

        ctx.org_id, ctx.store_id, ctx.quote_success, v_success_version, ctx.user_id

      );

  exception

    when sqlstate '23514' then

      if sqlerrm = 'ZION_SALES_QUOTE_VERSION_APPROVAL_STATUS_INVALID' then

        v_caught := true;

      end if;

  end;

  perform pg_temp._p9_exact_approval_record(

    14,

    'version sent nao reaprova',

    case when v_caught then 'PASS' else 'SUT_FAIL' end,

    'sent evidence rejected without reversing sent_at'

  );



  -- Keep a separate untouched fixture for the approval-wins-first path.
  perform *

    from public.approve_sales_quote_version_by_system(

      ctx.org_id, ctx.store_id, ctx.quote_create_blocker, v_blocker_version, ctx.user_id

    );

  perform pg_temp._p9_exact_approval_record(15, 'aprovacao current vence lock e persiste', 'PASS', ctx.quote_create_blocker::text);



  v_caught := false;

  insert into public.store_files (

    id, organization_id, store_id, file_kind, storage_bucket, storage_path,

    original_filename, mime_type, size_bytes, uploaded_by

  ) values (

    v_after_approved_file_id,

    ctx.org_id,

    ctx.store_id,

    'sales_quote_pdf',

    'zion-store-files',

    'p9/exact-approval-after-approved.pdf',

    'after-approved.pdf',

    'application/pdf',

    100,

    'system'

  );

  begin

    perform *

      from public.create_sales_quote_version_by_system(

        ctx.org_id,

        ctx.store_id,

        ctx.quote_create_blocker,

        'generated',

        'pending_review',

        'definitive',

        v_after_approved_file_id,

        'zion-store-files',

        'p9/exact-approval-after-approved.pdf',

        'after-approved.pdf',

        'application/pdf',

        100,

        jsonb_build_object('quote', jsonb_build_object('validUntil', ((now() at time zone 'UTC')::date + 30)::text))

      );

  exception

    when others then

      v_caught := true;

  end;

  select current_version_id, status, approved_at, approved_by

    into v_new_version, v_quote_status, v_approved_at, v_approved_by

    from public.sales_quotes

   where id = ctx.quote_create_blocker;

  select status into v_old_version_status

    from public.sales_quote_versions

   where id = v_blocker_version;

  select status into v_new_version_status

    from public.sales_quote_versions

   where id = v_new_version;

  select count(*) into v_old_event_count

    from public.conversation_events

   where organization_id = ctx.org_id

     and event_type = 'orcamento_aprovado'

     and payload ->> 'quote_id' = ctx.quote_create_blocker::text

     and payload ->> 'version_id' = v_blocker_version::text;

  select count(*) into v_new_event_count

    from public.conversation_events

   where organization_id = ctx.org_id

     and event_type = 'orcamento_aprovado'

     and payload ->> 'quote_id' = ctx.quote_create_blocker::text

     and payload ->> 'version_id' = v_new_version::text;

  perform pg_temp._p9_exact_approval_record(

    16,

    'nova versao apos approved invalida aprovacao corrente',

    case

      when not v_caught

       and v_new_version is distinct from v_blocker_version

       and v_quote_status = 'pending_review'

       and v_approved_at is null

       and v_approved_by is null

       and v_old_version_status = 'superseded'

       and v_new_version_status = 'generated'

       and v_old_event_count = 1

       and v_new_event_count = 0

      then 'PASS'

      else 'SUT_FAIL'

    end,

    format(

      'caught=%s current=%s quote=%s approved_at=%s approved_by=%s old_version=%s new_version=%s old_events=%s new_events=%s',

      v_caught,

      v_new_version,

      v_quote_status,

      v_approved_at,

      v_approved_by,

      v_old_version_status,

      v_new_version_status,

      v_old_event_count,

      v_new_event_count

    )

  );



  -- Reuse the dedicated sent fixture from scenario 14 for the quote-level
  -- post-send immutability check. This leaves the approval->new-version
  -- fixture from scenarios 15/16 untouched.
  update public.sales_quotes

     set status = 'sent'

   where id = ctx.quote_success;

  v_caught := false;

  insert into public.store_files (

    id, organization_id, store_id, file_kind, storage_bucket, storage_path,

    original_filename, mime_type, size_bytes, uploaded_by

  ) values (

    v_after_sent_file_id,

    ctx.org_id,

    ctx.store_id,

    'sales_quote_pdf',

    'zion-store-files',

    'p9/exact-approval-after-sent.pdf',

    'after-sent.pdf',

    'application/pdf',

    100,

    'system'

  );

  begin

    perform *

      from public.create_sales_quote_version_by_system(

        ctx.org_id,

        ctx.store_id,

        ctx.quote_success,

        'generated',

        'pending_review',

        'definitive',

        v_after_sent_file_id,

        'zion-store-files',

        'p9/exact-approval-after-sent.pdf',

        'after-sent.pdf',

        'application/pdf',

        100,

        jsonb_build_object('quote', jsonb_build_object('validUntil', ((now() at time zone 'UTC')::date + 30)::text))

      );

  exception

    when sqlstate '23514' then

      if sqlerrm = 'ZION_SALES_QUOTE_VERSION_QUOTE_SENT_IMMUTABLE' then

        v_caught := true;

      end if;

  end;

  perform pg_temp._p9_exact_approval_record(

    17,

    'sent permanece imutavel para nova versao',

    case when v_caught then 'PASS' else 'SUT_FAIL' end,

    'sent quote cannot generate a new version'

  );



  select count(*) into v_count from pg_temp._p9_exact_approval_results;

  perform pg_temp._p9_exact_approval_record(

    18,

    'runner tem cobertura minima registrada',

    case when v_count >= 17 then 'PASS' else 'SUT_FAIL' end,

    format('recorded=%s', v_count)

  );



  perform pg_temp._p9_exact_approval_record(19, 'rollback total do runner', 'PASS', 'outer transaction ends with rollback');

end;

$scenarios$;



select *

from pg_temp._p9_exact_approval_results

order by scenario;



do $assertions$

declare

  v_failures integer;

  v_details text;

begin

  select count(*), string_agg(format('%s:%s', scenario, detail), '; ' order by scenario)

    into v_failures, v_details

    from pg_temp._p9_exact_approval_results

   where status <> 'PASS';



  if v_failures > 0 then

    raise exception 'P9 exact approval manual checks failed: %', v_details;

  end if;

end;

$assertions$;



rollback;

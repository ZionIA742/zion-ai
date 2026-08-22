begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public;

create temp table pg_temp._p9_current_proposal_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  details text not null
);

create or replace function pg_temp._p9_current_proposal_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_details text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_current_proposal_results (
    scenario_number,
    scenario_name,
    status,
    details
  )
  values (
    p_scenario_number,
    p_scenario_name,
    p_status,
    p_details
  )
  on conflict (scenario_number) do update
  set scenario_name = excluded.scenario_name,
      status = excluded.status,
      details = excluded.details;
end;
$function$;

create or replace function pg_temp._p9_current_proposal_exec_json_sql(
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
  v_value_json jsonb;
  v_state text;
  v_message text;
  v_constraint text;
  v_operation_succeeded boolean := false;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    return query
    select
      false,
      null::jsonb,
      null::text,
      'runner helper must start as postgres'::text,
      null::text;
    return;
  end if;

  if p_role not in ('authenticated', 'service_role', 'anon') then
    return query
    select
      false,
      null::jsonb,
      null::text,
      'unsupported test role'::text,
      null::text;
    return;
  end if;

  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform set_config(
    'request.jwt.claims',
    case
      when p_user_id is null
        then pg_catalog.jsonb_build_object('role', p_role)::text
      else pg_catalog.jsonb_build_object(
        'role', p_role,
        'sub', p_user_id::text
      )::text
    end,
    true
  );

  execute format('set local role %I', p_role);

  begin
    execute format(
      'select to_jsonb(result_row) from (%s) as result_row',
      p_sql
    )
    into v_value_json;
    v_operation_succeeded := true;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;
      v_operation_succeeded := false;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  return query
  select
    v_operation_succeeded,
    v_value_json,
    v_state,
    v_message,
    v_constraint;
exception
  when others then
    begin
      execute 'reset role';
    exception
      when others then
        null;
    end;

    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);

    return query
    select
      false,
      null::jsonb,
      sqlstate::text,
      ('runner helper error: ' || sqlerrm)::text,
      null::text;
end;
$function$;

create or replace function pg_temp._p9_current_proposal_call_writer(
  p_role text,
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_sales_quote_id uuid,
  p_sales_quote_version_id uuid,
  p_idempotency_key text,
  p_source text
)
returns table (
  operation_succeeded boolean,
  value_json jsonb,
  returned_sqlstate text,
  message_text text,
  constraint_name text
)
language sql
as $function$
  select *
  from pg_temp._p9_current_proposal_exec_json_sql(
    p_role,
    null,
    format(
      $sql$
        select *
        from public.set_current_commercial_proposal_from_sent_quote_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L,
          %L
        )
      $sql$,
      p_organization_id,
      p_store_id,
      p_commercial_opportunity_id,
      p_sales_quote_id,
      p_sales_quote_version_id,
      case
        -- Preserva propositalmente whitespace para o cenário de argumento vazio.
        when p_idempotency_key is not null
             and pg_catalog.btrim(p_idempotency_key) = '' then
          p_idempotency_key
        -- Sentinel exclusivo do runner para provar rejeição de chave não canônica.
        when p_idempotency_key = '__INVALID__' then
          'runner-invalid-idempotency-key'
        else
          'current_commercial_proposal:'
          || p_commercial_opportunity_id::text
          || ':'
          || p_sales_quote_id::text
          || ':'
          || p_sales_quote_version_id::text
      end,
      p_source
    )
  )
$function$;

do $runner$
declare
  v_run_id uuid := gen_random_uuid();
  v_now timestamptz := pg_catalog.clock_timestamp();

  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_store_a uuid := gen_random_uuid();
  v_store_b uuid := gen_random_uuid();
  v_customer_a uuid := gen_random_uuid();
  v_customer_b uuid := gen_random_uuid();

  -- Fluxo principal A: A/v1 -> A/v2 -> B/v1 -> B/v2.
  v_opp_main uuid := gen_random_uuid();
  v_quote_a uuid := gen_random_uuid();
  v_quote_b uuid := gen_random_uuid();
  v_version_a_v1 uuid := gen_random_uuid();
  v_version_a_v2 uuid := gen_random_uuid();
  v_version_b_v1 uuid := gen_random_uuid();
  v_version_b_v2 uuid := gen_random_uuid();

  -- Reconcile de versão enviada que depois virou superseded.
  v_opp_reconcile uuid := gen_random_uuid();
  v_quote_reconcile uuid := gen_random_uuid();
  v_version_reconcile_v1 uuid := gen_random_uuid();
  v_version_reconcile_v2 uuid := gen_random_uuid();

  -- Ponteiro NULL com proposta antiga + proposta posterior já enviadas.
  v_opp_stale_null uuid := gen_random_uuid();
  v_quote_stale_old uuid := gen_random_uuid();
  v_quote_stale_new uuid := gen_random_uuid();
  v_version_stale_old uuid := gen_random_uuid();
  v_version_stale_new uuid := gen_random_uuid();

  -- Empate de sent_at.
  v_opp_tie uuid := gen_random_uuid();
  v_quote_tie_a uuid := gen_random_uuid();
  v_quote_tie_b uuid := gen_random_uuid();
  v_version_tie_a uuid := gen_random_uuid();
  v_version_tie_b uuid := gen_random_uuid();

  -- Scope/constraint fixtures.
  v_opp_b uuid := gen_random_uuid();
  v_quote_opp_b uuid := gen_random_uuid();
  v_quote_opp_b_2 uuid := gen_random_uuid();
  v_version_opp_b uuid := gen_random_uuid();
  v_version_opp_b_2 uuid := gen_random_uuid();

  v_opp_other_tenant uuid := gen_random_uuid();
  v_quote_other_tenant uuid := gen_random_uuid();
  v_version_other_tenant uuid := gen_random_uuid();

  v_quote_null_opp uuid := gen_random_uuid();
  v_version_null_opp uuid := gen_random_uuid();

  v_quote_no_sent_at uuid := gen_random_uuid();
  v_version_no_sent_at uuid := gen_random_uuid();

  v_exec record;
  v_definition text;
  v_proc_oid oid;
  v_constraint_count integer;
  v_before_quote uuid;
  v_before_version uuid;
begin
  -- --------------------------------------------------------------------------
  -- Fixtures base
  -- --------------------------------------------------------------------------
  insert into public.organizations (id, name)
  values
    (v_org_a, 'Runner P9 current proposal Org A ' || v_run_id::text),
    (v_org_b, 'Runner P9 current proposal Org B ' || v_run_id::text);

  insert into public.stores (id, organization_id, name, created_at)
  values
    (v_store_a, v_org_a, 'Runner P9 current proposal Store A ' || v_run_id::text, v_now),
    (v_store_b, v_org_b, 'Runner P9 current proposal Store B ' || v_run_id::text, v_now);

  insert into public.customers (id, organization_id, display_name, normalized_name)
  values
    (
      v_customer_a,
      v_org_a,
      'Runner P9 Current Proposal A',
      'runner-p9-current-proposal-a-' || replace(v_run_id::text, '-', '')
    ),
    (
      v_customer_b,
      v_org_b,
      'Runner P9 Current Proposal B',
      'runner-p9-current-proposal-b-' || replace(v_run_id::text, '-', '')
    );

  insert into public.customer_store_links (organization_id, store_id, customer_id)
  values
    (v_org_a, v_store_a, v_customer_a),
    (v_org_b, v_store_b, v_customer_b);

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    stage
  )
  values
    (v_opp_main, v_org_a, v_store_a, v_customer_a, 'qualificacao'),
    (v_opp_reconcile, v_org_a, v_store_a, v_customer_a, 'qualificacao'),
    (v_opp_stale_null, v_org_a, v_store_a, v_customer_a, 'qualificacao'),
    (v_opp_tie, v_org_a, v_store_a, v_customer_a, 'qualificacao'),
    (v_opp_b, v_org_a, v_store_a, v_customer_a, 'qualificacao'),
    (v_opp_other_tenant, v_org_b, v_store_b, v_customer_b, 'qualificacao');

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
    (v_quote_a, v_org_a, v_store_a, v_opp_main, null, null, 'QA-' || replace(v_quote_a::text, '-', ''), 'Quote A', 'draft', 'Runner A', null, null, null, 1000, 0, 1000, null, pg_catalog.jsonb_build_object('runner', 'p9.current', 'quote', 'a')),
    (v_quote_b, v_org_a, v_store_a, v_opp_main, null, null, 'QB-' || replace(v_quote_b::text, '-', ''), 'Quote B', 'draft', 'Runner A', null, null, null, 2000, 0, 2000, null, pg_catalog.jsonb_build_object('runner', 'p9.current', 'quote', 'b')),
    (v_quote_reconcile, v_org_a, v_store_a, v_opp_reconcile, null, null, 'QR-' || replace(v_quote_reconcile::text, '-', ''), 'Quote Reconcile', 'pending_review', 'Runner A', null, null, null, 3000, 0, 3000, null, pg_catalog.jsonb_build_object('runner', 'p9.current', 'quote', 'reconcile')),
    (v_quote_stale_old, v_org_a, v_store_a, v_opp_stale_null, null, null, 'QSO-' || replace(v_quote_stale_old::text, '-', ''), 'Quote Stale Old', 'sent', 'Runner A', null, null, null, 4000, 0, 4000, null, pg_catalog.jsonb_build_object('runner', 'p9.current', 'quote', 'stale_old')),
    (v_quote_stale_new, v_org_a, v_store_a, v_opp_stale_null, null, null, 'QSN-' || replace(v_quote_stale_new::text, '-', ''), 'Quote Stale New', 'sent', 'Runner A', null, null, null, 5000, 0, 5000, null, pg_catalog.jsonb_build_object('runner', 'p9.current', 'quote', 'stale_new')),
    (v_quote_tie_a, v_org_a, v_store_a, v_opp_tie, null, null, 'QTA-' || replace(v_quote_tie_a::text, '-', ''), 'Quote Tie A', 'sent', 'Runner A', null, null, null, 6000, 0, 6000, null, pg_catalog.jsonb_build_object('runner', 'p9.current', 'quote', 'tie_a')),
    (v_quote_tie_b, v_org_a, v_store_a, v_opp_tie, null, null, 'QTB-' || replace(v_quote_tie_b::text, '-', ''), 'Quote Tie B', 'sent', 'Runner A', null, null, null, 7000, 0, 7000, null, pg_catalog.jsonb_build_object('runner', 'p9.current', 'quote', 'tie_b')),
    (v_quote_opp_b, v_org_a, v_store_a, v_opp_b, null, null, 'QOB-' || replace(v_quote_opp_b::text, '-', ''), 'Quote Opp B', 'sent', 'Runner A', null, null, null, 8000, 0, 8000, null, pg_catalog.jsonb_build_object('runner', 'p9.current', 'quote', 'opp_b')),
    (v_quote_opp_b_2, v_org_a, v_store_a, v_opp_b, null, null, 'QOB2-' || replace(v_quote_opp_b_2::text, '-', ''), 'Quote Opp B 2', 'sent', 'Runner A', null, null, null, 9000, 0, 9000, null, pg_catalog.jsonb_build_object('runner', 'p9.current', 'quote', 'opp_b_2')),
    (v_quote_other_tenant, v_org_b, v_store_b, v_opp_other_tenant, null, null, 'QOT-' || replace(v_quote_other_tenant::text, '-', ''), 'Quote Other Tenant', 'sent', 'Runner B', null, null, null, 10000, 0, 10000, null, pg_catalog.jsonb_build_object('runner', 'p9.current', 'quote', 'other_tenant')),
    (v_quote_null_opp, v_org_a, v_store_a, null, null, null, 'QNO-' || replace(v_quote_null_opp::text, '-', ''), 'Quote Null Opp', 'sent', 'Runner A', null, null, null, 11000, 0, 11000, null, pg_catalog.jsonb_build_object('runner', 'p9.current', 'quote', 'null_opp')),
    (v_quote_no_sent_at, v_org_a, v_store_a, v_opp_b, null, null, 'QNS-' || replace(v_quote_no_sent_at::text, '-', ''), 'Quote No Sent At', 'sent', 'Runner A', null, null, null, 12000, 0, 12000, null, pg_catalog.jsonb_build_object('runner', 'p9.current', 'quote', 'no_sent_at'));

  -- IMPORTANTE: o estado inicial válido de uma versão ainda não enviada é
  -- generated. "draft" NÃO é status aceito por sales_quote_versions.
  insert into public.sales_quote_versions (
    id,
    quote_id,
    organization_id,
    store_id,
    version_number,
    status,
    store_file_id,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    quote_snapshot,
    created_at,
    sent_at
  )
  values
    (v_version_a_v1, v_quote_a, v_org_a, v_store_a, 1, 'generated', null, 'runner', 'quotes/a-v1.pdf', 'a-v1.pdf', 'application/pdf', 100, '{}'::jsonb, v_now, null),
    (v_version_a_v2, v_quote_a, v_org_a, v_store_a, 2, 'generated', null, 'runner', 'quotes/a-v2.pdf', 'a-v2.pdf', 'application/pdf', 100, '{}'::jsonb, v_now + interval '1 second', null),
    (v_version_b_v1, v_quote_b, v_org_a, v_store_a, 1, 'generated', null, 'runner', 'quotes/b-v1.pdf', 'b-v1.pdf', 'application/pdf', 100, '{}'::jsonb, v_now, null),
    (v_version_b_v2, v_quote_b, v_org_a, v_store_a, 2, 'generated', null, 'runner', 'quotes/b-v2.pdf', 'b-v2.pdf', 'application/pdf', 100, '{}'::jsonb, v_now + interval '1 second', null),

    (v_version_reconcile_v1, v_quote_reconcile, v_org_a, v_store_a, 1, 'superseded', null, 'runner', 'quotes/reconcile-v1.pdf', 'reconcile-v1.pdf', 'application/pdf', 100, '{}'::jsonb, v_now, v_now + interval '10 minutes'),
    (v_version_reconcile_v2, v_quote_reconcile, v_org_a, v_store_a, 2, 'generated', null, 'runner', 'quotes/reconcile-v2.pdf', 'reconcile-v2.pdf', 'application/pdf', 100, '{}'::jsonb, v_now + interval '11 minutes', null),

    (v_version_stale_old, v_quote_stale_old, v_org_a, v_store_a, 1, 'sent', null, 'runner', 'quotes/stale-old.pdf', 'stale-old.pdf', 'application/pdf', 100, '{}'::jsonb, v_now, v_now + interval '20 minutes'),
    (v_version_stale_new, v_quote_stale_new, v_org_a, v_store_a, 1, 'sent', null, 'runner', 'quotes/stale-new.pdf', 'stale-new.pdf', 'application/pdf', 100, '{}'::jsonb, v_now, v_now + interval '21 minutes'),

    (v_version_tie_a, v_quote_tie_a, v_org_a, v_store_a, 1, 'sent', null, 'runner', 'quotes/tie-a.pdf', 'tie-a.pdf', 'application/pdf', 100, '{}'::jsonb, v_now, v_now + interval '30 minutes'),
    (v_version_tie_b, v_quote_tie_b, v_org_a, v_store_a, 1, 'sent', null, 'runner', 'quotes/tie-b.pdf', 'tie-b.pdf', 'application/pdf', 100, '{}'::jsonb, v_now, v_now + interval '30 minutes'),

    (v_version_opp_b, v_quote_opp_b, v_org_a, v_store_a, 1, 'sent', null, 'runner', 'quotes/opp-b.pdf', 'opp-b.pdf', 'application/pdf', 100, '{}'::jsonb, v_now, v_now + interval '40 minutes'),
    (v_version_opp_b_2, v_quote_opp_b_2, v_org_a, v_store_a, 1, 'sent', null, 'runner', 'quotes/opp-b-2.pdf', 'opp-b-2.pdf', 'application/pdf', 100, '{}'::jsonb, v_now, v_now + interval '41 minutes'),

    (v_version_other_tenant, v_quote_other_tenant, v_org_b, v_store_b, 1, 'sent', null, 'runner', 'quotes/other-tenant.pdf', 'other-tenant.pdf', 'application/pdf', 100, '{}'::jsonb, v_now, v_now + interval '50 minutes'),

    (v_version_null_opp, v_quote_null_opp, v_org_a, v_store_a, 1, 'sent', null, 'runner', 'quotes/null-opp.pdf', 'null-opp.pdf', 'application/pdf', 100, '{}'::jsonb, v_now, v_now + interval '60 minutes'),

    (v_version_no_sent_at, v_quote_no_sent_at, v_org_a, v_store_a, 1, 'sent', null, 'runner', 'quotes/no-sent-at.pdf', 'no-sent-at.pdf', 'application/pdf', 100, '{}'::jsonb, v_now, null);

  update public.sales_quotes
  set current_version_id = case id
    when v_quote_a then v_version_a_v1
    when v_quote_b then v_version_b_v1
    when v_quote_reconcile then v_version_reconcile_v2
    when v_quote_stale_old then v_version_stale_old
    when v_quote_stale_new then v_version_stale_new
    when v_quote_tie_a then v_version_tie_a
    when v_quote_tie_b then v_version_tie_b
    when v_quote_opp_b then v_version_opp_b
    when v_quote_opp_b_2 then v_version_opp_b_2
    when v_quote_other_tenant then v_version_other_tenant
    when v_quote_null_opp then v_version_null_opp
    when v_quote_no_sent_at then v_version_no_sent_at
    else current_version_id
  end
  where id in (
    v_quote_a,
    v_quote_b,
    v_quote_reconcile,
    v_quote_stale_old,
    v_quote_stale_new,
    v_quote_tie_a,
    v_quote_tie_b,
    v_quote_opp_b,
    v_quote_opp_b_2,
    v_quote_other_tenant,
    v_quote_null_opp,
    v_quote_no_sent_at
  );

  -- --------------------------------------------------------------------------
  -- 1. Estrutura das colunas + constraints validadas.
  -- --------------------------------------------------------------------------
  begin
    select count(*)
    into v_constraint_count
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_opportunities'::pg_catalog.regclass
      and constraint_row.conname in (
        'commercial_opportunities_current_quote_pair_check',
        'commercial_opportunities_current_quote_opportunity_scope_fkey',
        'commercial_opportunities_current_quote_version_scope_fkey'
      )
      and constraint_row.convalidated;

    if (
      select count(*)
      from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = 'commercial_opportunities'
        and column_row.column_name in ('current_quote_id', 'current_quote_version_id')
        and column_row.data_type = 'uuid'
        and column_row.is_nullable = 'YES'
    ) = 2
    and v_constraint_count = 3 then
      perform pg_temp._p9_current_proposal_record(
        1,
        'estrutura current proposal existe e constraints estao validadas',
        'PASS',
        '2 colunas uuid nullable + 3 constraints validadas'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        1,
        'estrutura current proposal existe e constraints estao validadas',
        'SUT_FAIL',
        format('validated_constraints=%s', v_constraint_count)
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        1,
        'estrutura current proposal existe e constraints estao validadas',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 2. Owner / SECURITY DEFINER / configs / grants.
  -- --------------------------------------------------------------------------
  begin
    v_proc_oid := pg_catalog.to_regprocedure(
      'public.set_current_commercial_proposal_from_sent_quote_by_system(uuid,uuid,uuid,uuid,uuid,text,text)'
    );

    if v_proc_oid is not null
       and exists (
         select 1
         from pg_catalog.pg_proc proc_row
         join pg_catalog.pg_roles owner_row
           on owner_row.oid = proc_row.proowner
         where proc_row.oid = v_proc_oid
           and owner_row.rolname = 'postgres'
           and proc_row.prosecdef
           and exists (
             select 1
             from pg_catalog.unnest(coalesce(proc_row.proconfig, array[]::text[])) config_row
             where config_row = 'search_path=pg_catalog, pg_temp, public'
           )
           and exists (
             select 1
             from pg_catalog.unnest(coalesce(proc_row.proconfig, array[]::text[])) config_row
             where config_row = 'row_security=off'
           )
       )
       and pg_catalog.has_function_privilege('service_role', v_proc_oid, 'EXECUTE')
       and not pg_catalog.has_function_privilege('authenticated', v_proc_oid, 'EXECUTE')
       and not pg_catalog.has_function_privilege('anon', v_proc_oid, 'EXECUTE')
       and not exists (
         select 1
         from pg_catalog.pg_proc proc_row
         cross join lateral pg_catalog.aclexplode(
           coalesce(proc_row.proacl, pg_catalog.acldefault('f', proc_row.proowner))
         ) acl_row
         where proc_row.oid = v_proc_oid
           and acl_row.grantee = 0
           and acl_row.privilege_type = 'EXECUTE'
       )
       and not pg_catalog.has_column_privilege(
         'authenticated',
         'public.commercial_opportunities',
         'current_quote_id',
         'UPDATE'
       )
       and not pg_catalog.has_column_privilege(
         'authenticated',
         'public.commercial_opportunities',
         'current_quote_version_id',
         'UPDATE'
       )
       and not pg_catalog.has_column_privilege(
         'service_role',
         'public.commercial_opportunities',
         'current_quote_id',
         'UPDATE'
       )
       and not pg_catalog.has_column_privilege(
         'service_role',
         'public.commercial_opportunities',
         'current_quote_version_id',
         'UPDATE'
       )
       and not pg_catalog.has_column_privilege(
         'anon',
         'public.commercial_opportunities',
         'current_quote_id',
         'UPDATE'
       )
       and not pg_catalog.has_column_privilege(
         'anon',
         'public.commercial_opportunities',
         'current_quote_version_id',
         'UPDATE'
       ) then
      perform pg_temp._p9_current_proposal_record(
        2,
        'writer system e colunas possuem contrato de seguranca correto',
        'PASS',
        'postgres/security definer/row_security off/apenas service_role; colunas sem UPDATE direto'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        2,
        'writer system e colunas possuem contrato de seguranca correto',
        'SUT_FAIL',
        'metadata ou grants divergentes'
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        2,
        'writer system e colunas possuem contrato de seguranca correto',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 3. authenticated não executa writer.
  -- --------------------------------------------------------------------------
  begin
    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'authenticated',
      v_org_a,
      v_store_a,
      v_opp_main,
      v_quote_a,
      v_version_a_v1,
      'runner-auth-denied',
      'manual-check-auth-denied'
    );

    if not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '42501' then
      perform pg_temp._p9_current_proposal_record(
        3,
        'authenticated nao executa writer system',
        'PASS',
        '42501 como esperado'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        3,
        'authenticated nao executa writer system',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'authenticated accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        3,
        'authenticated nao executa writer system',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 4. anon não executa writer.
  -- --------------------------------------------------------------------------
  begin
    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'anon',
      v_org_a,
      v_store_a,
      v_opp_main,
      v_quote_a,
      v_version_a_v1,
      'runner-anon-denied',
      'manual-check-anon-denied'
    );

    if not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '42501' then
      perform pg_temp._p9_current_proposal_record(
        4,
        'anon nao executa writer system',
        'PASS',
        '42501 como esperado'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        4,
        'anon nao executa writer system',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'anon accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        4,
        'anon nao executa writer system',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 5. idempotency key obrigatória.
  -- --------------------------------------------------------------------------
  begin
    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'service_role',
      v_org_a,
      v_store_a,
      v_opp_main,
      v_quote_a,
      v_version_a_v1,
      '   ',
      'manual-check-blank-key'
    );

    if not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '22023'
       and v_exec.message_text = 'ZION_CURRENT_PROPOSAL_ARGUMENTS_REQUIRED' then
      perform pg_temp._p9_current_proposal_record(
        5,
        'idempotency key vazia e rejeitada',
        'PASS',
        '22023 como esperado'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        5,
        'idempotency key vazia e rejeitada',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'blank key accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        5,
        'idempotency key vazia e rejeitada',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 6. source obrigatória.
  -- --------------------------------------------------------------------------
  begin
    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'service_role',
      v_org_a,
      v_store_a,
      v_opp_main,
      v_quote_a,
      v_version_a_v1,
      'runner-blank-source',
      ' '
    );

    if not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '22023'
       and v_exec.message_text = 'ZION_CURRENT_PROPOSAL_ARGUMENTS_REQUIRED' then
      perform pg_temp._p9_current_proposal_record(
        6,
        'source vazia e rejeitada',
        'PASS',
        '22023 como esperado'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        6,
        'source vazia e rejeitada',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'blank source accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        6,
        'source vazia e rejeitada',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 7. status sent sem sent_at NÃO é evidência canônica.
  -- --------------------------------------------------------------------------
  begin
    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'service_role',
      v_org_a,
      v_store_a,
      v_opp_b,
      v_quote_no_sent_at,
      v_version_no_sent_at,
      'runner-no-sent-at',
      'manual-check-no-sent-at'
    );

    if not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '23514'
       and v_exec.message_text = 'sales quote version has no canonical sent evidence' then
      perform pg_temp._p9_current_proposal_record(
        7,
        'status sent sem sent_at nao materializa proposta',
        'PASS',
        'sent_at obrigatorio'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        7,
        'status sent sem sent_at nao materializa proposta',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'missing sent_at accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        7,
        'status sent sem sent_at nao materializa proposta',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 8. A/v1 enviada torna-se vigente.
  -- --------------------------------------------------------------------------
  update public.sales_quotes
  set status = 'sent',
      current_version_id = v_version_a_v1
  where id = v_quote_a;

  update public.sales_quote_versions
  set status = 'sent',
      sent_at = v_now + interval '1 minute'
  where id = v_version_a_v1;

  begin
    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'service_role',
      v_org_a,
      v_store_a,
      v_opp_main,
      v_quote_a,
      v_version_a_v1,
      'runner-main-a-v1',
      'manual-check-main-a-v1'
    );

    if v_exec.operation_succeeded
       and v_exec.value_json->>'current_quote_id' = v_quote_a::text
       and v_exec.value_json->>'current_quote_version_id' = v_version_a_v1::text
       and (v_exec.value_json->>'changed')::boolean
       and v_exec.value_json->>'outcome' = 'current_proposal_updated' then
      perform pg_temp._p9_current_proposal_record(
        8,
        'A v1 enviada torna-se proposta vigente',
        'PASS',
        'A/v1 vigente'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        8,
        'A v1 enviada torna-se proposta vigente',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'unexpected result')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        8,
        'A v1 enviada torna-se proposta vigente',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 9. retry da mesma identidade é noop.
  -- --------------------------------------------------------------------------
  begin
    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'service_role',
      v_org_a,
      v_store_a,
      v_opp_main,
      v_quote_a,
      v_version_a_v1,
      'runner-main-a-v1-retry',
      'manual-check-main-a-v1-retry'
    );

    if v_exec.operation_succeeded
       and not (v_exec.value_json->>'changed')::boolean
       and v_exec.value_json->>'outcome' = 'already_current_proposal'
       and v_exec.value_json->>'current_quote_version_id' = v_version_a_v1::text then
      perform pg_temp._p9_current_proposal_record(
        9,
        'retry da mesma proposta vigente e noop',
        'PASS',
        'already_current_proposal'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        9,
        'retry da mesma proposta vigente e noop',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'retry changed state')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        9,
        'retry da mesma proposta vigente e noop',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 10. revisão A/v2 generated: A/v1 continua vigente.
  -- --------------------------------------------------------------------------
  update public.sales_quote_versions
  set status = 'superseded'
  where id = v_version_a_v1;

  update public.sales_quotes
  set status = 'pending_review',
      current_version_id = v_version_a_v2
  where id = v_quote_a;

  begin
    if exists (
      select 1
      from public.commercial_opportunities opportunity_row
      where opportunity_row.id = v_opp_main
        and opportunity_row.current_quote_id = v_quote_a
        and opportunity_row.current_quote_version_id = v_version_a_v1
    ) then
      perform pg_temp._p9_current_proposal_record(
        10,
        'revisao generated nao substitui proposta apresentada',
        'PASS',
        'A/v1 continua vigente enquanto A/v2 nao foi enviada'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        10,
        'revisao generated nao substitui proposta apresentada',
        'SUT_FAIL',
        'ponteiro mudou sem envio'
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        10,
        'revisao generated nao substitui proposta apresentada',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 11. aprovação interna A/v2 não substitui.
  -- --------------------------------------------------------------------------
  update public.sales_quote_versions
  set status = 'approved'
  where id = v_version_a_v2;

  update public.sales_quotes
  set status = 'approved'
  where id = v_quote_a;

  begin
    if exists (
      select 1
      from public.commercial_opportunities opportunity_row
      where opportunity_row.id = v_opp_main
        and opportunity_row.current_quote_id = v_quote_a
        and opportunity_row.current_quote_version_id = v_version_a_v1
    ) then
      perform pg_temp._p9_current_proposal_record(
        11,
        'aprovacao interna nao substitui proposta apresentada',
        'PASS',
        'A/v1 continua vigente'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        11,
        'aprovacao interna nao substitui proposta apresentada',
        'SUT_FAIL',
        'approval moveu ponteiro'
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        11,
        'aprovacao interna nao substitui proposta apresentada',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 12. A/v2 enviada depois substitui A/v1.
  -- --------------------------------------------------------------------------
  update public.sales_quote_versions
  set status = 'sent',
      sent_at = v_now + interval '2 minutes'
  where id = v_version_a_v2;

  update public.sales_quotes
  set status = 'sent'
  where id = v_quote_a;

  begin
    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'service_role',
      v_org_a,
      v_store_a,
      v_opp_main,
      v_quote_a,
      v_version_a_v2,
      'runner-main-a-v2',
      'manual-check-main-a-v2'
    );

    if v_exec.operation_succeeded
       and (v_exec.value_json->>'changed')::boolean
       and v_exec.value_json->>'outcome' = 'current_proposal_updated'
       and v_exec.value_json->>'current_quote_id' = v_quote_a::text
       and v_exec.value_json->>'current_quote_version_id' = v_version_a_v2::text then
      perform pg_temp._p9_current_proposal_record(
        12,
        'A v2 enviada substitui A v1',
        'PASS',
        'A/v2 vigente'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        12,
        'A v2 enviada substitui A v1',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'A/v2 not projected')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        12,
        'A v2 enviada substitui A v1',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 13. Quote irmã B/v1 generated não move.
  -- --------------------------------------------------------------------------
  begin
    if exists (
      select 1
      from public.commercial_opportunities opportunity_row
      where opportunity_row.id = v_opp_main
        and opportunity_row.current_quote_id = v_quote_a
        and opportunity_row.current_quote_version_id = v_version_a_v2
    ) then
      perform pg_temp._p9_current_proposal_record(
        13,
        'quote irma generated nao move proposta vigente',
        'PASS',
        'A/v2 continua vigente'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        13,
        'quote irma generated nao move proposta vigente',
        'SUT_FAIL',
        'ponteiro mudou sem envio de B'
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        13,
        'quote irma generated nao move proposta vigente',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 14. B/v1 enviada depois substitui A/v2.
  -- --------------------------------------------------------------------------
  update public.sales_quote_versions
  set status = 'sent',
      sent_at = v_now + interval '3 minutes'
  where id = v_version_b_v1;

  update public.sales_quotes
  set status = 'sent',
      current_version_id = v_version_b_v1
  where id = v_quote_b;

  begin
    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'service_role',
      v_org_a,
      v_store_a,
      v_opp_main,
      v_quote_b,
      v_version_b_v1,
      'runner-main-b-v1',
      'manual-check-main-b-v1'
    );

    if v_exec.operation_succeeded
       and (v_exec.value_json->>'changed')::boolean
       and v_exec.value_json->>'outcome' = 'current_proposal_updated'
       and v_exec.value_json->>'current_quote_id' = v_quote_b::text
       and v_exec.value_json->>'current_quote_version_id' = v_version_b_v1::text then
      perform pg_temp._p9_current_proposal_record(
        14,
        'quote irma B v1 enviada substitui proposta anterior',
        'PASS',
        'B/v1 vigente'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        14,
        'quote irma B v1 enviada substitui proposta anterior',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'B/v1 not projected')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        14,
        'quote irma B v1 enviada substitui proposta anterior',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 15. Replay DIRETO de A/v2 depois de B/v1 não pode regredir.
  -- --------------------------------------------------------------------------
  begin
    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'service_role',
      v_org_a,
      v_store_a,
      v_opp_main,
      v_quote_a,
      v_version_a_v2,
      'runner-main-stale-a-v2',
      'manual-check-direct-stale-replay'
    );

    if v_exec.operation_succeeded
       and not (v_exec.value_json->>'changed')::boolean
       and v_exec.value_json->>'outcome' = 'stale_sent_proposal_ignored'
       and v_exec.value_json->>'current_quote_id' = v_quote_b::text
       and v_exec.value_json->>'current_quote_version_id' = v_version_b_v1::text then
      perform pg_temp._p9_current_proposal_record(
        15,
        'replay direto obsoleto nao regride proposta vigente',
        'PASS',
        'A/v2 ignorada; B/v1 preservada'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        15,
        'replay direto obsoleto nao regride proposta vigente',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'stale replay changed pointer')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        15,
        'replay direto obsoleto nao regride proposta vigente',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 16. Current pode ficar superseded por nascer revisão em draft e ainda ser
  --     reconhecido como a proposta apresentada vigente.
  -- --------------------------------------------------------------------------
  update public.sales_quote_versions
  set status = 'superseded'
  where id = v_version_b_v1;

  update public.sales_quotes
  set status = 'pending_review',
      current_version_id = v_version_b_v2
  where id = v_quote_b;

  begin
    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'service_role',
      v_org_a,
      v_store_a,
      v_opp_main,
      v_quote_b,
      v_version_b_v1,
      'runner-main-b-v1-superseded-retry',
      'manual-check-superseded-current'
    );

    if v_exec.operation_succeeded
       and not (v_exec.value_json->>'changed')::boolean
       and v_exec.value_json->>'outcome' = 'already_current_proposal'
       and v_exec.value_json->>'current_quote_version_id' = v_version_b_v1::text then
      perform pg_temp._p9_current_proposal_record(
        16,
        'versao enviada depois superseded continua current ate novo envio',
        'PASS',
        'B/v1 preservada durante revisao B/v2'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        16,
        'versao enviada depois superseded continua current ate novo envio',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'superseded current rejected')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        16,
        'versao enviada depois superseded continua current ate novo envio',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 17. B/v2 realmente enviada passa a ser current.
  -- --------------------------------------------------------------------------
  update public.sales_quote_versions
  set status = 'sent',
      sent_at = v_now + interval '4 minutes'
  where id = v_version_b_v2;

  update public.sales_quotes
  set status = 'sent'
  where id = v_quote_b;

  begin
    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'service_role',
      v_org_a,
      v_store_a,
      v_opp_main,
      v_quote_b,
      v_version_b_v2,
      'runner-main-b-v2',
      'manual-check-main-b-v2'
    );

    if v_exec.operation_succeeded
       and (v_exec.value_json->>'changed')::boolean
       and v_exec.value_json->>'current_quote_id' = v_quote_b::text
       and v_exec.value_json->>'current_quote_version_id' = v_version_b_v2::text
       and v_exec.value_json->>'outcome' = 'current_proposal_updated' then
      perform pg_temp._p9_current_proposal_record(
        17,
        'nova revisao so substitui current quando efetivamente enviada',
        'PASS',
        'B/v2 vigente'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        17,
        'nova revisao so substitui current quando efetivamente enviada',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'B/v2 not current')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        17,
        'nova revisao so substitui current quando efetivamente enviada',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 18. Reconcile: versão enviada/superseded com quote pending_review pode
  --     materializar pointer se NÃO existe envio posterior.
  -- --------------------------------------------------------------------------
  begin
    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'service_role',
      v_org_a,
      v_store_a,
      v_opp_reconcile,
      v_quote_reconcile,
      v_version_reconcile_v1,
      'runner-reconcile-superseded',
      'manual-check-reconcile-superseded'
    );

    if v_exec.operation_succeeded
       and (v_exec.value_json->>'changed')::boolean
       and v_exec.value_json->>'outcome' = 'current_proposal_updated'
       and v_exec.value_json->>'current_quote_id' = v_quote_reconcile::text
       and v_exec.value_json->>'current_quote_version_id' = v_version_reconcile_v1::text then
      perform pg_temp._p9_current_proposal_record(
        18,
        'projection perdida pode reconciliar versao enviada que virou superseded',
        'PASS',
        'reconcile sem depender do status atual da quote'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        18,
        'projection perdida pode reconciliar versao enviada que virou superseded',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'reconcile failed')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        18,
        'projection perdida pode reconciliar versao enviada que virou superseded',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 19. Pointer NULL + candidate antiga + fato posterior já enviado:
  --     não escolhe/inferre; apenas rejeita a candidate stale e mantém NULL.
  -- --------------------------------------------------------------------------
  begin
    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'service_role',
      v_org_a,
      v_store_a,
      v_opp_stale_null,
      v_quote_stale_old,
      v_version_stale_old,
      'runner-stale-null-old',
      'manual-check-stale-null-old'
    );

    if v_exec.operation_succeeded
       and not (v_exec.value_json->>'changed')::boolean
       and v_exec.value_json->>'outcome' = 'stale_sent_proposal_ignored'
       and v_exec.value_json->>'current_quote_id' is null
       and v_exec.value_json->>'current_quote_version_id' is null then
      perform pg_temp._p9_current_proposal_record(
        19,
        'candidate antiga nao preenche pointer null quando existe envio posterior',
        'PASS',
        'fail-closed sem inferir proposta posterior'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        19,
        'candidate antiga nao preenche pointer null quando existe envio posterior',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'old candidate incorrectly materialized')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        19,
        'candidate antiga nao preenche pointer null quando existe envio posterior',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 20. Caller fornece explicitamente a proposta posterior -> materializa.
  -- --------------------------------------------------------------------------
  begin
    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'service_role',
      v_org_a,
      v_store_a,
      v_opp_stale_null,
      v_quote_stale_new,
      v_version_stale_new,
      'runner-stale-null-new',
      'manual-check-stale-null-new'
    );

    if v_exec.operation_succeeded
       and (v_exec.value_json->>'changed')::boolean
       and v_exec.value_json->>'current_quote_id' = v_quote_stale_new::text
       and v_exec.value_json->>'current_quote_version_id' = v_version_stale_new::text then
      perform pg_temp._p9_current_proposal_record(
        20,
        'proposta posterior explicita materializa pointer sem latest first',
        'PASS',
        'candidate explícita posterior aplicada'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        20,
        'proposta posterior explicita materializa pointer sem latest first',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'new explicit candidate failed')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        20,
        'proposta posterior explicita materializa pointer sem latest first',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 21. Empate de sent_at entre propostas distintas é ambíguo/fail-closed.
  -- --------------------------------------------------------------------------
  begin
    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'service_role',
      v_org_a,
      v_store_a,
      v_opp_tie,
      v_quote_tie_a,
      v_version_tie_a,
      'runner-tie',
      'manual-check-tie'
    );

    if not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '23514'
       and v_exec.message_text = 'ZION_CURRENT_PROPOSAL_SEND_ORDER_AMBIGUOUS'
       and exists (
         select 1
         from public.commercial_opportunities opportunity_row
         where opportunity_row.id = v_opp_tie
           and opportunity_row.current_quote_id is null
           and opportunity_row.current_quote_version_id is null
       ) then
      perform pg_temp._p9_current_proposal_record(
        21,
        'empate de sent_at entre propostas distintas falha fechado',
        'PASS',
        'nenhum pointer escolhido por heuristica'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        21,
        'empate de sent_at entre propostas distintas falha fechado',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'tie was not blocked')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        21,
        'empate de sent_at entre propostas distintas falha fechado',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 22. Quote de outra opportunity, mesmo tenant, é bloqueada.
  -- --------------------------------------------------------------------------
  begin
    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'service_role',
      v_org_a,
      v_store_a,
      v_opp_main,
      v_quote_opp_b,
      v_version_opp_b,
      'runner-wrong-opportunity',
      'manual-check-wrong-opportunity'
    );

    if not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '23514'
       and v_exec.message_text = 'sales quote opportunity mismatch' then
      perform pg_temp._p9_current_proposal_record(
        22,
        'quote de outra opportunity e bloqueada',
        'PASS',
        'opportunity mismatch'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        22,
        'quote de outra opportunity e bloqueada',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'wrong opportunity accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        22,
        'quote de outra opportunity e bloqueada',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 23. Quote cross-tenant é bloqueada.
  -- --------------------------------------------------------------------------
  begin
    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'service_role',
      v_org_a,
      v_store_a,
      v_opp_main,
      v_quote_other_tenant,
      v_version_other_tenant,
      'runner-cross-tenant-quote',
      'manual-check-cross-tenant-quote'
    );

    if not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '23514'
       and v_exec.message_text = 'sales quote scope mismatch' then
      perform pg_temp._p9_current_proposal_record(
        23,
        'quote cross tenant e bloqueada',
        'PASS',
        'scope mismatch'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        23,
        'quote cross tenant e bloqueada',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'cross tenant quote accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        23,
        'quote cross tenant e bloqueada',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 24. Version cross-tenant é testada explicitamente.
  -- --------------------------------------------------------------------------
  begin
    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'service_role',
      v_org_a,
      v_store_a,
      v_opp_main,
      v_quote_a,
      v_version_other_tenant,
      'runner-cross-tenant-version',
      'manual-check-cross-tenant-version'
    );

    if not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '23514'
       and v_exec.message_text = 'sales quote version scope mismatch' then
      perform pg_temp._p9_current_proposal_record(
        24,
        'version cross tenant e bloqueada',
        'PASS',
        'version scope mismatch'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        24,
        'version cross tenant e bloqueada',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'cross tenant version accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        24,
        'version cross tenant e bloqueada',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 25. Version de outra quote, mesmo tenant, é bloqueada.
  -- --------------------------------------------------------------------------
  begin
    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'service_role',
      v_org_a,
      v_store_a,
      v_opp_b,
      v_quote_opp_b,
      v_version_opp_b_2,
      'runner-wrong-version-link',
      'manual-check-wrong-version-link'
    );

    if not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '23514'
       and v_exec.message_text = 'sales quote version does not belong to the provided quote' then
      perform pg_temp._p9_current_proposal_record(
        25,
        'version de outra quote e bloqueada',
        'PASS',
        'version/quote mismatch'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        25,
        'version de outra quote e bloqueada',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'wrong version accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        25,
        'version de outra quote e bloqueada',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 26. Quote sem commercial_opportunity_id tem fixture própria e falha closed.
  -- --------------------------------------------------------------------------
  begin
    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'service_role',
      v_org_a,
      v_store_a,
      v_opp_b,
      v_quote_null_opp,
      v_version_null_opp,
      'runner-null-opportunity',
      'manual-check-null-opportunity'
    );

    if not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '23514'
       and v_exec.message_text = 'sales quote is not linked to a commercial opportunity' then
      perform pg_temp._p9_current_proposal_record(
        26,
        'quote sem commercial opportunity explicita e bloqueada',
        'PASS',
        'sem fallback'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        26,
        'quote sem commercial opportunity explicita e bloqueada',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'null opportunity accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        26,
        'quote sem commercial opportunity explicita e bloqueada',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 27. Pair CHECK impede half-null.
  -- --------------------------------------------------------------------------
  begin
    begin
      update public.commercial_opportunities
      set current_quote_id = v_quote_opp_b,
          current_quote_version_id = null
      where id = v_opp_b;

      perform pg_temp._p9_current_proposal_record(
        27,
        'pair check bloqueia current quote sem version',
        'SUT_FAIL',
        'half-null update foi aceito'
      );
    exception
      when check_violation then
        if sqlerrm like '%commercial_opportunities_current_quote_pair_check%' then
          perform pg_temp._p9_current_proposal_record(
            27,
            'pair check bloqueia current quote sem version',
            'PASS',
            'check_violation esperado'
          );
        else
          perform pg_temp._p9_current_proposal_record(
            27,
            'pair check bloqueia current quote sem version',
            'SUT_FAIL',
            sqlerrm
          );
        end if;
    end;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        27,
        'pair check bloqueia current quote sem version',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 28. FK opportunity-scope impede quote de outra opportunity em DML direto.
  -- --------------------------------------------------------------------------
  begin
    begin
      update public.commercial_opportunities
      set current_quote_id = v_quote_a,
          current_quote_version_id = v_version_a_v2
      where id = v_opp_b;

      perform pg_temp._p9_current_proposal_record(
        28,
        'fk bloqueia pointer para quote de outra opportunity',
        'SUT_FAIL',
        'wrong opportunity pointer accepted by table constraints'
      );
    exception
      when foreign_key_violation then
        perform pg_temp._p9_current_proposal_record(
          28,
          'fk bloqueia pointer para quote de outra opportunity',
          'PASS',
          coalesce(sqlerrm, 'foreign_key_violation')
        );
    end;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        28,
        'fk bloqueia pointer para quote de outra opportunity',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 29. FK version-scope impede version pertencente a outra quote da mesma opp.
  -- --------------------------------------------------------------------------
  begin
    begin
      update public.commercial_opportunities
      set current_quote_id = v_quote_opp_b,
          current_quote_version_id = v_version_opp_b_2
      where id = v_opp_b;

      perform pg_temp._p9_current_proposal_record(
        29,
        'fk bloqueia version que nao pertence a current quote',
        'SUT_FAIL',
        'wrong version pointer accepted by table constraints'
      );
    exception
      when foreign_key_violation then
        perform pg_temp._p9_current_proposal_record(
          29,
          'fk bloqueia version que nao pertence a current quote',
          'PASS',
          coalesce(sqlerrm, 'foreign_key_violation')
        );
    end;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        29,
        'fk bloqueia version que nao pertence a current quote',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 30. Definição: sem recência/inferência e com guards anti-replay.
  -- --------------------------------------------------------------------------
  begin
    select lower(regexp_replace(
      pg_catalog.pg_get_functiondef(
        pg_catalog.to_regprocedure(
          'public.set_current_commercial_proposal_from_sent_quote_by_system(uuid,uuid,uuid,uuid,uuid,text,text)'
        )
      ),
      '\s+',
      ' ',
      'g'
    ))
    into v_definition;

    if v_definition not like '%order by%'
       and v_definition not like '%limit 1%'
       and v_definition not like '%updated_at desc%'
       and v_definition not like '%created_at desc%'
       and v_definition not like '%conversation_id%'
       and v_definition not like '%lead_id%'
       and v_definition like '%sent_at%'
       and v_definition like '%later_version.sent_at > v_sales_quote_version.sent_at%'
       and v_definition like '%stale_sent_proposal_ignored%'
       and v_definition like '%zion_current_proposal_send_order_ambiguous%'
       and v_definition like '%zion_current_proposal_idempotency_key_invalid%'
       and v_definition like '%for update%' then
      perform pg_temp._p9_current_proposal_record(
        30,
        'writer nao usa latest first e possui guard anti replay',
        'PASS',
        'sem heuristica proibida + sent_at/lock/stale guard'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        30,
        'writer nao usa latest first e possui guard anti replay',
        'SUT_FAIL',
        'definicao nao satisfaz contrato'
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        30,
        'writer nao usa latest first e possui guard anti replay',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 31. Estado final do fluxo principal permanece B/v2 após todos os replays.
  -- --------------------------------------------------------------------------
  begin
    select current_quote_id, current_quote_version_id
    into v_before_quote, v_before_version
    from public.commercial_opportunities
    where id = v_opp_main;

    if v_before_quote = v_quote_b
       and v_before_version = v_version_b_v2 then
      perform pg_temp._p9_current_proposal_record(
        31,
        'estado final principal preserva a ultima proposta explicitamente enviada',
        'PASS',
        'B/v2 preservada'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        31,
        'estado final principal preserva a ultima proposta explicitamente enviada',
        'SUT_FAIL',
        format(
          'current_quote=%s current_version=%s',
          coalesce(v_before_quote::text, '<null>'),
          coalesce(v_before_version::text, '<null>')
        )
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        31,
        'estado final principal preserva a ultima proposta explicitamente enviada',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- --------------------------------------------------------------------------
  -- 32. Chave de idempotência não canônica é rejeitada sem alterar o ponteiro.
  -- --------------------------------------------------------------------------
  begin
    select current_quote_id, current_quote_version_id
    into v_before_quote, v_before_version
    from public.commercial_opportunities
    where id = v_opp_main;

    select *
    into v_exec
    from pg_temp._p9_current_proposal_call_writer(
      'service_role',
      v_org_a,
      v_store_a,
      v_opp_main,
      v_quote_b,
      v_version_b_v2,
      '__INVALID__',
      'manual-check-invalid-idempotency-key'
    );

    if not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '22023'
       and v_exec.message_text = 'ZION_CURRENT_PROPOSAL_IDEMPOTENCY_KEY_INVALID'
       and (
         select current_quote_id = v_before_quote
                and current_quote_version_id = v_before_version
         from public.commercial_opportunities
         where id = v_opp_main
       ) then
      perform pg_temp._p9_current_proposal_record(
        32,
        'idempotency key diferente da identidade explicita e rejeitada',
        'PASS',
        '22023 sem alteracao de pointer'
      );
    else
      perform pg_temp._p9_current_proposal_record(
        32,
        'idempotency key diferente da identidade explicita e rejeitada',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'invalid idempotency key accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_current_proposal_record(
        32,
        'idempotency key diferente da identidade explicita e rejeitada',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;
end;
$runner$;

select *
from pg_temp._p9_current_proposal_results
order by scenario_number;

do $gate$
declare
  v_total_count integer;
  v_non_pass_count integer;
  v_non_pass_details text;
begin
  select count(*)
  into v_total_count
  from pg_temp._p9_current_proposal_results;

  if v_total_count <> 32 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'manual check failed: expected 32 scenarios but found %s',
        v_total_count
      );
  end if;

  select count(*)
  into v_non_pass_count
  from pg_temp._p9_current_proposal_results
  where status <> 'PASS';

  if v_non_pass_count > 0 then
    select string_agg(
             format(
               '#%s [%s] %s - %s',
               scenario_number,
               status,
               scenario_name,
               details
             ),
             E'\n'
             order by scenario_number
           )
    into v_non_pass_details
    from pg_temp._p9_current_proposal_results
    where status <> 'PASS';

    raise exception using
      errcode = 'P0001',
      message = format(
        'manual check failed: %s scenario(s) did not pass:%s%s',
        v_non_pass_count,
        E'\n',
        coalesce(v_non_pass_details, '<no failure details captured>')
      );
  end if;
end;
$gate$;

rollback;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public;

-- ============================================================================
-- P9 / Bloco 6 / Etapa 6.7
-- Manual checks: canonical Current Commercial Proposal system reader.
--
-- This runner is fully transactional and rolls back all fixtures.
-- ============================================================================

create temp table pg_temp._p9_67_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  detail text not null
);

create or replace function pg_temp._p9_67_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_67_results (
    scenario_number,
    scenario_name,
    status,
    detail
  )
  values (
    p_scenario_number,
    p_scenario_name,
    p_status,
    p_detail
  )
  on conflict (scenario_number) do update
  set scenario_name = excluded.scenario_name,
      status = excluded.status,
      detail = excluded.detail;
end;
$function$;

create or replace function pg_temp._p9_67_exec_json_sql(
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
  v_value_json jsonb;
  v_state text;
  v_message text;
  v_operation_succeeded boolean := false;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    return query
    select
      false,
      null::jsonb,
      null::text,
      'runner helper must start as postgres'::text;
    return;
  end if;

  if p_role not in ('authenticated', 'service_role', 'anon') then
    return query
    select
      false,
      null::jsonb,
      null::text,
      'unsupported test role'::text;
    return;
  end if;

  perform pg_catalog.set_config('request.jwt.claim.role', p_role, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('role', p_role)::text,
    true
  );

  execute pg_catalog.format('set local role %I', p_role);

  begin
    execute pg_catalog.format(
      'select to_jsonb(result_row) from (%s) as result_row',
      p_sql
    )
    into v_value_json;

    v_operation_succeeded := true;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text;

      v_operation_succeeded := false;
  end;

  execute 'reset role';

  perform pg_catalog.set_config('request.jwt.claim.role', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '', true);

  return query
  select
    v_operation_succeeded,
    v_value_json,
    v_state,
    v_message;

exception
  when others then
    begin
      execute 'reset role';
    exception
      when others then
        null;
    end;

    perform pg_catalog.set_config('request.jwt.claim.role', '', true);
    perform pg_catalog.set_config('request.jwt.claims', '', true);

    return query
    select
      false,
      null::jsonb,
      sqlstate::text,
      ('runner helper error: ' || sqlerrm)::text;
end;
$function$;

create or replace function pg_temp._p9_67_call_reader(
  p_role text,
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
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
  from pg_temp._p9_67_exec_json_sql(
    p_role,
    pg_catalog.format(
      $sql$
        select *
        from public.read_current_commercial_proposal_by_system(
          %L::uuid,
          %L::uuid,
          %L::uuid
        )
      $sql$,
      p_organization_id,
      p_store_id,
      p_commercial_opportunity_id
    )
  );
$function$;

do $runner$
declare
  v_run_id uuid := gen_random_uuid();
  v_now timestamptz := pg_catalog.clock_timestamp();

  v_org uuid := gen_random_uuid();
  v_store uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();

  -- Current proposal main flow.
  v_opp_main uuid := gen_random_uuid();
  v_quote_main uuid := gen_random_uuid();
  v_main_v1 uuid := gen_random_uuid();
  v_main_v2 uuid := gen_random_uuid();

  -- Sent quote exists, but opportunity has no current-proposal pointer.
  v_opp_none uuid := gen_random_uuid();
  v_quote_none uuid := gen_random_uuid();
  v_none_v1 uuid := gen_random_uuid();

  -- No pointer and no canonical sent fact at all.
  v_opp_empty uuid := gen_random_uuid();

  -- Pointer exists, but immutable sent evidence is invalid.
  v_opp_conflict uuid := gen_random_uuid();
  v_quote_conflict uuid := gen_random_uuid();
  v_conflict_v1 uuid := gen_random_uuid();

  -- Current proposal exists after commercial reopen.
  v_opp_cycle2 uuid := gen_random_uuid();
  v_quote_cycle2 uuid := gen_random_uuid();
  v_cycle2_v1 uuid := gen_random_uuid();

  v_exec record;
  v_proc_oid oid;
  v_definition text;
  v_pass_count integer;
begin
  -- ==========================================================================
  -- Fixtures
  -- ==========================================================================

  insert into public.organizations (
    id,
    name
  )
  values (
    v_org,
    'Runner P9 6.7 Org ' || v_run_id::text
  );

  insert into public.stores (
    id,
    organization_id,
    name,
    created_at
  )
  values (
    v_store,
    v_org,
    'Runner P9 6.7 Store ' || v_run_id::text,
    v_now
  );

  insert into public.customers (
    id,
    organization_id,
    display_name,
    normalized_name
  )
  values (
    v_customer,
    v_org,
    'Runner P9 6.7 Customer',
    'runner-p9-67-' || pg_catalog.replace(v_run_id::text, '-', '')
  );

  insert into public.customer_store_links (
    organization_id,
    store_id,
    customer_id
  )
  values (
    v_org,
    v_store,
    v_customer
  );

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    stage,
    lifecycle_cycle
  )
  values
    (
      v_opp_main,
      v_org,
      v_store,
      v_customer,
      'orcamento',
      1
    ),
    (
      v_opp_none,
      v_org,
      v_store,
      v_customer,
      'orcamento',
      1
    ),
    (
      v_opp_empty,
      v_org,
      v_store,
      v_customer,
      'orcamento',
      1
    ),
    (
      v_opp_conflict,
      v_org,
      v_store,
      v_customer,
      'orcamento',
      1
    ),
    (
      v_opp_cycle2,
      v_org,
      v_store,
      v_customer,
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
  values
    (
      v_quote_main,
      v_org,
      v_store,
      v_opp_main,
      null,
      null,
      'P967-MAIN-' || pg_catalog.replace(v_quote_main::text, '-', ''),
      'P9 6.7 Main',
      'sent',
      'Runner P9 6.7',
      null,
      null,
      null,
      100000,
      0,
      100000,
      null,
      pg_catalog.jsonb_build_object('runner', 'p9.6.7', 'case', 'main')
    ),
    (
      v_quote_none,
      v_org,
      v_store,
      v_opp_none,
      null,
      null,
      'P967-NONE-' || pg_catalog.replace(v_quote_none::text, '-', ''),
      'P9 6.7 None',
      'sent',
      'Runner P9 6.7',
      null,
      null,
      null,
      200000,
      0,
      200000,
      null,
      pg_catalog.jsonb_build_object('runner', 'p9.6.7', 'case', 'none')
    ),
    (
      v_quote_conflict,
      v_org,
      v_store,
      v_opp_conflict,
      null,
      null,
      'P967-CONFLICT-' || pg_catalog.replace(v_quote_conflict::text, '-', ''),
      'P9 6.7 Conflict',
      'approved',
      'Runner P9 6.7',
      null,
      null,
      null,
      300000,
      0,
      300000,
      null,
      pg_catalog.jsonb_build_object('runner', 'p9.6.7', 'case', 'conflict')
    ),
    (
      v_quote_cycle2,
      v_org,
      v_store,
      v_opp_cycle2,
      null,
      null,
      'P967-CYCLE-' || pg_catalog.replace(v_quote_cycle2::text, '-', ''),
      'P9 6.7 Cycle 2',
      'sent',
      'Runner P9 6.7',
      null,
      null,
      null,
      400000,
      0,
      400000,
      null,
      pg_catalog.jsonb_build_object('runner', 'p9.6.7', 'case', 'cycle2')
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
      v_main_v1,
      v_org,
      v_store,
      v_quote_main,
      1,
      'sent',
      'definitive',
      'zion-store-files',
      'p9/6-7/main-v1.pdf',
      'main-v1.pdf',
      'application/pdf',
      100,
      'system',
      '{}'::jsonb,
      v_now,
      v_now + interval '1 minute'
    ),
    (
      v_main_v2,
      v_org,
      v_store,
      v_quote_main,
      2,
      'generated',
      'definitive',
      'zion-store-files',
      'p9/6-7/main-v2.pdf',
      'main-v2.pdf',
      'application/pdf',
      100,
      'system',
      '{}'::jsonb,
      v_now + interval '2 minutes',
      null
    ),
    (
      v_none_v1,
      v_org,
      v_store,
      v_quote_none,
      1,
      'sent',
      'definitive',
      'zion-store-files',
      'p9/6-7/none-v1.pdf',
      'none-v1.pdf',
      'application/pdf',
      100,
      'system',
      '{}'::jsonb,
      v_now,
      v_now + interval '3 minutes'
    ),
    (
      v_conflict_v1,
      v_org,
      v_store,
      v_quote_conflict,
      1,
      'approved',
      'definitive',
      'zion-store-files',
      'p9/6-7/conflict-v1.pdf',
      'conflict-v1.pdf',
      'application/pdf',
      100,
      'system',
      '{}'::jsonb,
      v_now,
      null
    ),
    (
      v_cycle2_v1,
      v_org,
      v_store,
      v_quote_cycle2,
      1,
      'sent',
      'definitive',
      'zion-store-files',
      'p9/6-7/cycle2-v1.pdf',
      'cycle2-v1.pdf',
      'application/pdf',
      100,
      'system',
      '{}'::jsonb,
      v_now,
      v_now + interval '4 minutes'
    );

  update public.sales_quotes
  set current_version_id = case id
    when v_quote_main then v_main_v1
    when v_quote_none then v_none_v1
    when v_quote_conflict then v_conflict_v1
    when v_quote_cycle2 then v_cycle2_v1
    else current_version_id
  end
  where id in (
    v_quote_main,
    v_quote_none,
    v_quote_conflict,
    v_quote_cycle2
  );

  -- Main pointer is established by the canonical writer.
  perform *
  from public.set_current_commercial_proposal_from_sent_quote_by_system(
    v_org,
    v_store,
    v_opp_main,
    v_quote_main,
    v_main_v1,
    'current_commercial_proposal:'
      || v_opp_main::text
      || ':'
      || v_quote_main::text
      || ':'
      || v_main_v1::text,
    'p9_6_7_reader_runner'
  );

  -- These two fixtures intentionally exercise reader fail-closed states.
  -- The pointer pair remains structurally valid and scoped by the DB FKs.
  update public.commercial_opportunities
  set current_quote_id = v_quote_conflict,
      current_quote_version_id = v_conflict_v1
  where id = v_opp_conflict;

  update public.commercial_opportunities
  set current_quote_id = v_quote_cycle2,
      current_quote_version_id = v_cycle2_v1
  where id = v_opp_cycle2;

  -- ==========================================================================
  -- 1. Function metadata, grants and anti-heuristic contract.
  -- ==========================================================================

  begin
    v_proc_oid := pg_catalog.to_regprocedure(
      'public.read_current_commercial_proposal_by_system(uuid,uuid,uuid)'
    );

    if v_proc_oid is not null then
      select pg_catalog.lower(
        pg_catalog.regexp_replace(
          pg_catalog.pg_get_functiondef(v_proc_oid),
          '\s+',
          ' ',
          'g'
        )
      )
      into v_definition;
    end if;

    if v_proc_oid is not null
       and exists (
         select 1
         from pg_catalog.pg_proc proc_row
         join pg_catalog.pg_roles owner_row
           on owner_row.oid = proc_row.proowner
         where proc_row.oid = v_proc_oid
           and owner_row.rolname = 'postgres'
           and proc_row.prosecdef
           and proc_row.provolatile = 's'::"char"
           and exists (
             select 1
             from pg_catalog.unnest(
               coalesce(proc_row.proconfig, array[]::text[])
             ) config_row
             where config_row = 'search_path=pg_catalog, pg_temp, public'
           )
           and exists (
             select 1
             from pg_catalog.unnest(
               coalesce(proc_row.proconfig, array[]::text[])
             ) config_row
             where config_row = 'row_security=off'
           )
       )
       and pg_catalog.has_function_privilege(
         'service_role',
         v_proc_oid,
         'EXECUTE'
       )
       and not pg_catalog.has_function_privilege(
         'authenticated',
         v_proc_oid,
         'EXECUTE'
       )
       and not pg_catalog.has_function_privilege(
         'anon',
         v_proc_oid,
         'EXECUTE'
       )
       and not exists (
         select 1
         from pg_catalog.pg_proc proc_row
         cross join lateral pg_catalog.aclexplode(
           coalesce(
             proc_row.proacl,
             pg_catalog.acldefault('f', proc_row.proowner)
           )
         ) acl_row
         where proc_row.oid = v_proc_oid
           and acl_row.grantee = 0
           and acl_row.privilege_type = 'EXECUTE'
       )
       and v_definition like '%current_quote_id%'
       and v_definition like '%current_quote_version_id%'
       and v_definition like '%v_version.sent_at is not null%'
       and v_definition like '%lifecycle_cycle > 1%'
       and v_definition not like '%order by%'
       and v_definition not like '%limit %'
       and v_definition not like '%created_at%'
       and v_definition not like '%updated_at%'
       and v_definition not like '%v_quote.status%'
       and v_definition not like '%v_quote.total_cents%'
       and v_definition not like '%v_quote.current_version_id%'
       and v_definition not like '%v_quote.customer_name%' then
      perform pg_temp._p9_67_record(
        1,
        'reader possui authority grants e anti-recency canonicos',
        'PASS',
        'postgres/security definer/stable/service_role only; sem latest/order/limit'
      );
    else
      perform pg_temp._p9_67_record(
        1,
        'reader possui authority grants e anti-recency canonicos',
        'SUT_FAIL',
        coalesce(v_definition, 'function metadata missing')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_67_record(
        1,
        'reader possui authority grants e anti-recency canonicos',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- ==========================================================================
  -- 2. Sent facts without explicit pointer remain NONE; reader never infers.
  -- ==========================================================================

  begin
    select *
    into v_exec
    from pg_temp._p9_67_call_reader(
      'service_role',
      v_org,
      v_store,
      v_opp_none
    );

    if v_exec.operation_succeeded
       and v_exec.value_json->>'proposal_state' = 'needs_resolution'
       and v_exec.value_json->>'reason_code' = 'quote_sent_without_current_proposal'
       and v_exec.value_json->>'current_quote_id' is null
       and v_exec.value_json->>'current_quote_version_id' is null then
      perform pg_temp._p9_67_record(
        2,
        'quote enviada sem pointer nao e inferida como proposta vigente',
        'PASS',
        'sent fact existe; reader falha fechado sem inferir qual proposta e vigente'
      );
    else
      perform pg_temp._p9_67_record(
        2,
        'quote enviada sem pointer nao e inferida como proposta vigente',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'unexpected result')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_67_record(
        2,
        'quote enviada sem pointer nao e inferida como proposta vigente',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- ==========================================================================
  -- 3. Explicit sent v1 is available.
  -- ==========================================================================

  begin
    select *
    into v_exec
    from pg_temp._p9_67_call_reader(
      'service_role',
      v_org,
      v_store,
      v_opp_main
    );

    if v_exec.operation_succeeded
       and v_exec.value_json->>'proposal_state' = 'available'
       and v_exec.value_json->>'current_quote_id' = v_quote_main::text
       and v_exec.value_json->>'current_quote_version_id' = v_main_v1::text
       and v_exec.value_json->>'reason_code' = 'current_proposal_authority_valid' then
      perform pg_temp._p9_67_record(
        3,
        'v1 enviada e lida como proposta vigente',
        'PASS',
        'authority explicita aponta para a versao apresentada v1'
      );
    else
      perform pg_temp._p9_67_record(
        3,
        'v1 enviada e lida como proposta vigente',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'unexpected result')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_67_record(
        3,
        'v1 enviada e lida como proposta vigente',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- ==========================================================================
  -- 4. Internal generated v2 must NOT replace presented v1.
  -- ==========================================================================

  update public.sales_quotes
  set status = 'pending_review',
      current_version_id = v_main_v2
  where id = v_quote_main;

  begin
    select *
    into v_exec
    from pg_temp._p9_67_call_reader(
      'service_role',
      v_org,
      v_store,
      v_opp_main
    );

    if v_exec.operation_succeeded
       and v_exec.value_json->>'proposal_state' = 'available'
       and v_exec.value_json->>'current_quote_id' = v_quote_main::text
       and v_exec.value_json->>'current_quote_version_id' = v_main_v1::text
       and v_exec.value_json->>'version_status' = 'sent'
       and exists (
         select 1
         from public.sales_quotes quote_row
         where quote_row.id = v_quote_main
           and quote_row.organization_id = v_org
           and quote_row.store_id = v_store
           and quote_row.current_version_id = v_main_v2
           and quote_row.status = 'pending_review'
       ) then
      perform pg_temp._p9_67_record(
        4,
        'nova versao interna generated nao substitui proposta apresentada',
        'PASS',
        'reader=v1 enquanto sales_quotes.current_version_id=v2 pending_review'
      );
    else
      perform pg_temp._p9_67_record(
        4,
        'nova versao interna generated nao substitui proposta apresentada',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'v2 incorrectly selected')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_67_record(
        4,
        'nova versao interna generated nao substitui proposta apresentada',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- ==========================================================================
  -- 5. Presented v1 may become superseded and still remain current.
  -- ==========================================================================

  update public.sales_quote_versions
  set status = 'superseded'
  where id = v_main_v1;

  begin
    select *
    into v_exec
    from pg_temp._p9_67_call_reader(
      'service_role',
      v_org,
      v_store,
      v_opp_main
    );

    if v_exec.operation_succeeded
       and v_exec.value_json->>'proposal_state' = 'available'
       and v_exec.value_json->>'current_quote_version_id' = v_main_v1::text
       and v_exec.value_json->>'version_status' = 'superseded'
       and exists (
         select 1
         from public.sales_quotes quote_row
         where quote_row.id = v_quote_main
           and quote_row.current_version_id = v_main_v2
       ) then
      perform pg_temp._p9_67_record(
        5,
        'versao apresentada superseded continua vigente ate novo envio',
        'PASS',
        'v1 superseded permanece current proposal'
      );
    else
      perform pg_temp._p9_67_record(
        5,
        'versao apresentada superseded continua vigente ate novo envio',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'superseded v1 lost authority')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_67_record(
        5,
        'versao apresentada superseded continua vigente ate novo envio',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- ==========================================================================
  -- 6. Once v2 is canonically sent, writer advances pointer and reader uses v2.
  -- ==========================================================================

  update public.sales_quote_versions
  set status = 'sent',
      sent_at = v_now + interval '5 minutes'
  where id = v_main_v2;

  update public.sales_quotes
  set status = 'sent'
  where id = v_quote_main;

  perform *
  from public.set_current_commercial_proposal_from_sent_quote_by_system(
    v_org,
    v_store,
    v_opp_main,
    v_quote_main,
    v_main_v2,
    'current_commercial_proposal:'
      || v_opp_main::text
      || ':'
      || v_quote_main::text
      || ':'
      || v_main_v2::text,
    'p9_6_7_reader_runner_v2'
  );

  begin
    select *
    into v_exec
    from pg_temp._p9_67_call_reader(
      'service_role',
      v_org,
      v_store,
      v_opp_main
    );

    if v_exec.operation_succeeded
       and v_exec.value_json->>'proposal_state' = 'available'
       and v_exec.value_json->>'current_quote_id' = v_quote_main::text
       and v_exec.value_json->>'current_quote_version_id' = v_main_v2::text
       and v_exec.value_json->>'version_status' = 'sent' then
      perform pg_temp._p9_67_record(
        6,
        'novo envio canonico substitui proposta vigente',
        'PASS',
        'v2 enviada move authority para v2'
      );
    else
      perform pg_temp._p9_67_record(
        6,
        'novo envio canonico substitui proposta vigente',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'v2 did not become current')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_67_record(
        6,
        'novo envio canonico substitui proposta vigente',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- ==========================================================================
  -- 7. Structurally valid pointer without sent_at/status evidence fails closed.
  -- ==========================================================================

  begin
    select *
    into v_exec
    from pg_temp._p9_67_call_reader(
      'service_role',
      v_org,
      v_store,
      v_opp_conflict
    );

    if v_exec.operation_succeeded
       and v_exec.value_json->>'proposal_state' = 'conflict'
       and v_exec.value_json->>'reason_code' = 'current_proposal_sent_evidence_conflict'
       and v_exec.value_json->>'current_quote_id' = v_quote_conflict::text
       and v_exec.value_json->>'current_quote_version_id' = v_conflict_v1::text then
      perform pg_temp._p9_67_record(
        7,
        'pointer sem evidencia canonica de envio falha fechado',
        'PASS',
        'approved sem sent_at => conflict'
      );
    else
      perform pg_temp._p9_67_record(
        7,
        'pointer sem evidencia canonica de envio falha fechado',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'invalid sent evidence accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_67_record(
        7,
        'pointer sem evidencia canonica de envio falha fechado',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- ==========================================================================
  -- 8. Lifecycle cycle > 1 is explicitly unanchored and needs resolution.
  -- ==========================================================================

  begin
    select *
    into v_exec
    from pg_temp._p9_67_call_reader(
      'service_role',
      v_org,
      v_store,
      v_opp_cycle2
    );

    if v_exec.operation_succeeded
       and v_exec.value_json->>'proposal_state' = 'needs_resolution'
       and v_exec.value_json->>'reason_code' = 'current_proposal_cycle_unanchored'
       and v_exec.value_json->>'current_quote_id' = v_quote_cycle2::text
       and v_exec.value_json->>'current_quote_version_id' = v_cycle2_v1::text then
      perform pg_temp._p9_67_record(
        8,
        'reabertura sem lineage de quote falha fechado',
        'PASS',
        'lifecycle_cycle=2 => needs_resolution'
      );
    else
      perform pg_temp._p9_67_record(
        8,
        'reabertura sem lineage de quote falha fechado',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'cycle 2 incorrectly accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_67_record(
        8,
        'reabertura sem lineage de quote falha fechado',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- ==========================================================================
  -- 9. authenticated cannot execute the system reader.
  -- ==========================================================================

  begin
    select *
    into v_exec
    from pg_temp._p9_67_call_reader(
      'authenticated',
      v_org,
      v_store,
      v_opp_main
    );

    if not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '42501' then
      perform pg_temp._p9_67_record(
        9,
        'authenticated nao executa reader system',
        'PASS',
        '42501 como esperado'
      );
    else
      perform pg_temp._p9_67_record(
        9,
        'authenticated nao executa reader system',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'authenticated accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_67_record(
        9,
        'authenticated nao executa reader system',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- ==========================================================================
  -- 10. anon cannot execute the system reader.
  -- ==========================================================================

  begin
    select *
    into v_exec
    from pg_temp._p9_67_call_reader(
      'anon',
      v_org,
      v_store,
      v_opp_main
    );

    if not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '42501' then
      perform pg_temp._p9_67_record(
        10,
        'anon nao executa reader system',
        'PASS',
        '42501 como esperado'
      );
    else
      perform pg_temp._p9_67_record(
        10,
        'anon nao executa reader system',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'anon accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_67_record(
        10,
        'anon nao executa reader system',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- ==========================================================================
  -- 11. Wrong organization/store scope does not resolve another opportunity.
  -- ==========================================================================

  begin
    select *
    into v_exec
    from pg_temp._p9_67_call_reader(
      'service_role',
      gen_random_uuid(),
      v_store,
      v_opp_main
    );

    if not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = 'P0002'
       and v_exec.message_text = 'P9_CURRENT_PROPOSAL_READER_OPPORTUNITY_NOT_FOUND' then
      perform pg_temp._p9_67_record(
        11,
        'escopo divergente nao le proposta de outra authority',
        'PASS',
        'P0002 opportunity not found'
      );
    else
      perform pg_temp._p9_67_record(
        11,
        'escopo divergente nao le proposta de outra authority',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'wrong scope accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_67_record(
        11,
        'escopo divergente nao le proposta de outra authority',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;

  -- ==========================================================================
  -- 12. Required arguments fail closed.
  -- ==========================================================================

  begin
    select *
    into v_exec
    from pg_temp._p9_67_call_reader(
      'service_role',
      v_org,
      v_store,
      null
    );

    if not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '22023'
       and v_exec.message_text = 'P9_CURRENT_PROPOSAL_READER_ARGUMENTS_REQUIRED' then
      perform pg_temp._p9_67_record(
        12,
        'argumentos obrigatorios sao validados',
        'PASS',
        '22023 como esperado'
      );
    else
      perform pg_temp._p9_67_record(
        12,
        'argumentos obrigatorios sao validados',
        'SUT_FAIL',
        coalesce(v_exec.message_text, v_exec.value_json::text, 'null argument accepted')
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_67_record(
        12,
        'argumentos obrigatorios sao validados',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;


  -- ==========================================================================
  -- 13. No pointer + no canonical sent fact is a true NONE state.
  -- ==========================================================================

  begin
    select *
    into v_exec
    from pg_temp._p9_67_call_reader(
      'service_role',
      v_org,
      v_store,
      v_opp_empty
    );

    if v_exec.operation_succeeded
       and v_exec.value_json->>'proposal_state' = 'none'
       and v_exec.value_json->>'reason_code' = 'current_proposal_unknown'
       and v_exec.value_json->>'current_quote_id' is null
       and v_exec.value_json->>'current_quote_version_id' is null then
      perform pg_temp._p9_67_record(
        13,
        'oportunidade sem pointer e sem envio possui estado none',
        'PASS',
        'nenhuma proposta apresentada existe para inferir ou resolver'
      );
    else
      perform pg_temp._p9_67_record(
        13,
        'oportunidade sem pointer e sem envio possui estado none',
        'SUT_FAIL',
        coalesce(
          v_exec.message_text,
          v_exec.value_json::text,
          'empty opportunity did not return none'
        )
      );
    end if;
  exception
    when others then
      perform pg_temp._p9_67_record(
        13,
        'oportunidade sem pointer e sem envio possui estado none',
        'HARNESS_ERROR',
        sqlerrm
      );
  end;
  select count(*)
  into v_pass_count
  from pg_temp._p9_67_results
  where status = 'PASS';

  if v_pass_count <> 13 then
    perform pg_temp._p9_67_record(
      99,
      'suite summary',
      'SUT_FAIL',
      pg_catalog.format('expected 13 PASS, got %s', v_pass_count)
    );
  end if;
end;
$runner$;

select
  scenario_number,
  scenario_name,
  status,
  detail
from pg_temp._p9_67_results
order by scenario_number;

select
  count(*) filter (where scenario_number between 1 and 13) as scenario_count,
  count(*) filter (
    where scenario_number between 1 and 13
      and status = 'PASS'
  ) as pass_count,
  count(*) filter (
    where scenario_number between 1 and 13
      and status <> 'PASS'
  ) as failure_count,
  case
    when count(*) filter (
      where scenario_number between 1 and 13
    ) = 13
    and count(*) filter (
      where scenario_number between 1 and 13
        and status = 'PASS'
    ) = 13
      then 'PASS'
    else 'FAIL'
  end as suite_status
from pg_temp._p9_67_results;

rollback;

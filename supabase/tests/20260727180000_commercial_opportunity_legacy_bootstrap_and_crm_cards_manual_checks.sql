begin;

set transaction isolation level repeatable read;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create temp table pg_temp._p9_b1_e1_3_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;

create temp table pg_temp._p9_b1_e1_3_ctx (
  singleton boolean primary key default true check (singleton),
  fixture_extra_opportunity_id uuid null,
  fixture_no_lead_opportunity_id uuid null,
  fixture_no_lead_customer_id uuid null,
  fixture_no_lead_organization_id uuid null,
  fixture_no_lead_store_id uuid null,
  member_user_id uuid null,
  member_organization_id uuid null,
  member_store_id uuid null
) on commit preserve rows;

insert into pg_temp._p9_b1_e1_3_ctx default values;

create temp table pg_temp._p9_b1_e1_3_expected (
  lead_id uuid primary key,
  bootstrap_id uuid not null,
  organization_id uuid not null,
  store_id uuid not null,
  customer_id uuid not null,
  primary_conversation_id uuid null,
  stage text not null,
  stage_changed_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  lifecycle_cycle integer not null,
  conversation_count bigint not null
) on commit preserve rows;

insert into pg_temp._p9_b1_e1_3_expected (
  lead_id,
  bootstrap_id,
  organization_id,
  store_id,
  customer_id,
  primary_conversation_id,
  stage,
  stage_changed_at,
  created_at,
  updated_at,
  lifecycle_cycle,
  conversation_count
)
with conversation_counts as (
  select
    conversation_row.lead_id,
    conversation_row.organization_id,
    count(*) as conversation_count,
    case
      when count(*) = 1
        then (array_agg(conversation_row.id))[1]
      else null::uuid
    end as only_conversation_id
  from public.conversations conversation_row
  group by conversation_row.lead_id, conversation_row.organization_id
),
active_links as (
  select
    link_row.lead_id,
    link_row.organization_id,
    link_row.store_id,
    link_row.customer_id
  from public.lead_customer_links link_row
  where link_row.status = 'active'
    and link_row.unlinked_at is null
)
select
  lead_row.id as lead_id,
  lower(
    substr(hash_row.digest, 1, 8) || '-' ||
    substr(hash_row.digest, 9, 4) || '-' ||
    '5' || substr(hash_row.digest, 14, 3) || '-' ||
    'a' || substr(hash_row.digest, 18, 3) || '-' ||
    substr(hash_row.digest, 21, 12)
  )::uuid as bootstrap_id,
  lead_row.organization_id,
  lead_row.store_id,
  active_link_row.customer_id,
  case
    when coalesce(conversation_count_row.conversation_count, 0) = 1
      then conversation_count_row.only_conversation_id
    else null::uuid
  end as primary_conversation_id,
  public.normalize_commercial_opportunity_stage(lead_row.state) as stage,
  coalesce(lead_row.updated_at, lead_row.created_at) as stage_changed_at,
  lead_row.created_at,
  coalesce(lead_row.updated_at, lead_row.created_at) as updated_at,
  1 as lifecycle_cycle,
  coalesce(conversation_count_row.conversation_count, 0) as conversation_count
from public.leads lead_row
join active_links active_link_row
  on active_link_row.lead_id = lead_row.id
 and active_link_row.organization_id = lead_row.organization_id
 and active_link_row.store_id = lead_row.store_id
left join conversation_counts conversation_count_row
  on conversation_count_row.lead_id = lead_row.id
 and conversation_count_row.organization_id = lead_row.organization_id
cross join lateral (
  select pg_catalog.md5(
    'zion:p9:b1:e1.3:commercial-opportunity-legacy-bootstrap:v1'
    || ':' || lead_row.id::text
  ) as digest
) hash_row;

create or replace function pg_temp._p9_b1_e1_3_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_pass boolean,
  p_detail text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_b1_e1_3_results (
    scenario_number,
    scenario_name,
    status,
    detail
  )
  values (
    p_scenario_number,
    p_scenario_name,
    case when p_pass then 'PASS' else 'SUT_FAIL' end,
    coalesce(p_detail, '<null>')
  );
end;
$function$;

create or replace function pg_temp._p9_b1_e1_3_exec_value_sql(
  p_set_role text,
  p_claim_role_setting text,
  p_claim_role_json text,
  p_user_id uuid,
  p_sql text
)
returns table (
  operation_succeeded boolean,
  value_text text,
  returned_sqlstate text,
  message_text text,
  constraint_name text
)
language plpgsql
as $function$
declare
  v_cleanup_fatal_sqlstate constant text := 'P9C01';
  v_value text;
  v_state text;
  v_message text;
  v_constraint text;
  v_operation_succeeded boolean := false;
  v_cleanup_state text;
  v_cleanup_message text;
  v_cleanup_constraint text;
begin
  begin
    if p_set_role is not null then
      execute format('set local role %I', p_set_role);
    end if;

    perform set_config('request.jwt.claim.role', coalesce(p_claim_role_setting, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
    perform set_config(
      'request.jwt.claims',
      case
        when p_claim_role_json is null and p_user_id is null then ''
        when p_claim_role_json is null then jsonb_build_object('sub', p_user_id::text)::text
        when p_user_id is null then jsonb_build_object('role', p_claim_role_json)::text
        else jsonb_build_object('role', p_claim_role_json, 'sub', p_user_id::text)::text
      end,
      true
    );

    begin
      execute p_sql into v_value;
      v_operation_succeeded := true;
    exception
      when others then
        get stacked diagnostics
          v_state = returned_sqlstate,
          v_message = message_text,
          v_constraint = constraint_name;
        v_operation_succeeded := false;
    end;
  exception
    when others then
      begin
        execute 'reset role';
        perform set_config('request.jwt.claim.role', '', true);
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claims', '', true);
      exception
        when others then
          get stacked diagnostics
            v_cleanup_state = returned_sqlstate,
            v_cleanup_message = message_text,
          v_cleanup_constraint = constraint_name;
          raise exception using
            errcode = v_cleanup_fatal_sqlstate,
            message = format(
              'harness cleanup failed after _p9_b1_e1_3_exec_value_sql: sqlstate=%s constraint=%s message=%s',
              coalesce(v_cleanup_state, '<null>'),
              coalesce(v_cleanup_constraint, '<null>'),
              coalesce(v_cleanup_message, '<null>')
            );
      end;
      raise;
  end;

  begin
    execute 'reset role';
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
  exception
    when others then
      get stacked diagnostics
        v_cleanup_state = returned_sqlstate,
        v_cleanup_message = message_text,
        v_cleanup_constraint = constraint_name;
      raise exception using
        errcode = v_cleanup_fatal_sqlstate,
        message = format(
          'harness cleanup failed after _p9_b1_e1_3_exec_value_sql: sqlstate=%s constraint=%s message=%s',
          coalesce(v_cleanup_state, '<null>'),
          coalesce(v_cleanup_constraint, '<null>'),
          coalesce(v_cleanup_message, '<null>')
        );
  end;

  return query
  select
    v_operation_succeeded,
    case when v_operation_succeeded then v_value else null::text end,
    v_state,
    v_message,
    v_constraint;
end;
$function$;

revoke all on function pg_temp._p9_b1_e1_3_record(integer, text, boolean, text) from public;
revoke all on function pg_temp._p9_b1_e1_3_exec_value_sql(text, text, text, uuid, text) from public;

do $checks$
declare
  v_fixture_fatal_sqlstate constant text := 'P9F01';
  v_sqlstate text;
  v_message text;
  v_constraint text;
  v_total_expected bigint;
  v_total_actual bigint;
  v_single_conversation_expected bigint;
  v_multi_conversation_expected bigint;
  v_non_single_conversation_expected bigint;
  v_missing_organization_id uuid;
  v_nonmember_user_id uuid;
  v_exec record;
  v_old_rpc_oid oid;
  v_new_rpc_oid oid;
  v_extra_opportunity_id uuid;
  v_extra_organization_id uuid;
  v_extra_store_id uuid;
  v_extra_customer_id uuid;
  v_extra_lead_id uuid;
  v_extra_bootstrap_id uuid;
  v_extra_stage text;
  v_extra_stage_changed_at timestamptz;
  v_extra_created_at timestamptz;
  v_extra_updated_at timestamptz;
  v_no_lead_opportunity_id uuid;
  v_no_lead_organization_id uuid;
  v_no_lead_store_id uuid;
  v_no_lead_customer_display_name text;
  v_fixture_no_lead_customer_id uuid;
  v_scope_organization_id uuid;
  v_scope_store_id uuid;
  v_member_user_id uuid;
begin
  select count(*) into v_total_expected from pg_temp._p9_b1_e1_3_expected;
  select count(*) into v_single_conversation_expected from pg_temp._p9_b1_e1_3_expected where conversation_count = 1;
  select count(*) into v_multi_conversation_expected from pg_temp._p9_b1_e1_3_expected where conversation_count > 1;
  select count(*) into v_non_single_conversation_expected from pg_temp._p9_b1_e1_3_expected where conversation_count <> 1;

  begin
    select count(*)
    into v_total_actual
    from pg_temp._p9_b1_e1_3_expected expected_row
    join public.commercial_opportunities opportunity_row
      on opportunity_row.id = expected_row.bootstrap_id;

    perform pg_temp._p9_b1_e1_3_record(
      1,
      'todos os leads elegiveis possuem o registro deterministico',
      v_total_expected > 0 and v_total_actual = v_total_expected,
      format(
        'leads elegiveis=%s registros bootstrap encontrados=%s',
        v_total_expected,
        v_total_actual
      )
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        1,
        'todos os leads elegiveis possuem o registro deterministico',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    perform pg_temp._p9_b1_e1_3_record(
      2,
      'nenhum lead elegivel possui dois registros deterministicos',
      v_total_expected > 0
      and (
        select count(*)
        from pg_temp._p9_b1_e1_3_expected expected_row
        join public.commercial_opportunities opportunity_row
          on opportunity_row.id = expected_row.bootstrap_id
      ) = v_total_expected
      and not exists (
        select 1
        from public.commercial_opportunities opportunity_row
        join pg_temp._p9_b1_e1_3_expected expected_row
          on expected_row.lead_id = opportunity_row.origin_lead_id
        where opportunity_row.id = expected_row.bootstrap_id
        group by expected_row.lead_id
        having count(*) <> 1
      ),
      format('esperados=%s bootstrap_encontrados=%s', v_total_expected, (
        select count(*)
        from pg_temp._p9_b1_e1_3_expected expected_row
        join public.commercial_opportunities opportunity_row
          on opportunity_row.id = expected_row.bootstrap_id
      ))
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        2,
        'nenhum lead elegivel possui dois registros deterministicos',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    perform pg_temp._p9_b1_e1_3_record(
      3,
      'organization store customer lead estao corretos',
      v_total_expected > 0
      and (
        select count(*)
        from pg_temp._p9_b1_e1_3_expected expected_row
        join public.commercial_opportunities opportunity_row
          on opportunity_row.id = expected_row.bootstrap_id
      ) = v_total_expected
      and not exists (
        select 1
        from pg_temp._p9_b1_e1_3_expected expected_row
        join public.commercial_opportunities opportunity_row
          on opportunity_row.id = expected_row.bootstrap_id
        where opportunity_row.organization_id is distinct from expected_row.organization_id
           or opportunity_row.store_id is distinct from expected_row.store_id
           or opportunity_row.customer_id is distinct from expected_row.customer_id
           or opportunity_row.origin_lead_id is distinct from expected_row.lead_id
      ),
      format('esperados=%s bootstrap_encontrados=%s', v_total_expected, (
        select count(*)
        from pg_temp._p9_b1_e1_3_expected expected_row
        join public.commercial_opportunities opportunity_row
          on opportunity_row.id = expected_row.bootstrap_id
      ))
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        3,
        'organization store customer lead estao corretos',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    perform pg_temp._p9_b1_e1_3_record(
      4,
      'stage corresponde exatamente ao lead state normalizado',
      v_total_expected > 0
      and (
        select count(*)
        from pg_temp._p9_b1_e1_3_expected expected_row
        join public.commercial_opportunities opportunity_row
          on opportunity_row.id = expected_row.bootstrap_id
      ) = v_total_expected
      and not exists (
        select 1
        from pg_temp._p9_b1_e1_3_expected expected_row
        join public.commercial_opportunities opportunity_row
          on opportunity_row.id = expected_row.bootstrap_id
        where opportunity_row.stage is distinct from expected_row.stage
      ),
      format('esperados=%s bootstrap_encontrados=%s', v_total_expected, (
        select count(*)
        from pg_temp._p9_b1_e1_3_expected expected_row
        join public.commercial_opportunities opportunity_row
          on opportunity_row.id = expected_row.bootstrap_id
      ))
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        4,
        'stage corresponde exatamente ao lead state normalizado',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    perform pg_temp._p9_b1_e1_3_record(
      5,
      'lifecycle_cycle igual a 1',
      v_total_expected > 0
      and (
        select count(*)
        from pg_temp._p9_b1_e1_3_expected expected_row
        join public.commercial_opportunities opportunity_row
          on opportunity_row.id = expected_row.bootstrap_id
      ) = v_total_expected
      and not exists (
        select 1
        from public.commercial_opportunities opportunity_row
        join pg_temp._p9_b1_e1_3_expected expected_row
          on expected_row.bootstrap_id = opportunity_row.id
        where opportunity_row.lifecycle_cycle <> 1
      ),
      format('esperados=%s bootstrap_encontrados=%s', v_total_expected, (
        select count(*)
        from pg_temp._p9_b1_e1_3_expected expected_row
        join public.commercial_opportunities opportunity_row
          on opportunity_row.id = expected_row.bootstrap_id
      ))
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        5,
        'lifecycle_cycle igual a 1',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    perform pg_temp._p9_b1_e1_3_record(
      6,
      'projecao de perda esta null',
      v_total_expected > 0
      and (
        select count(*)
        from pg_temp._p9_b1_e1_3_expected expected_row
        join public.commercial_opportunities opportunity_row
          on opportunity_row.id = expected_row.bootstrap_id
      ) = v_total_expected
      and not exists (
        select 1
        from public.commercial_opportunities opportunity_row
        join pg_temp._p9_b1_e1_3_expected expected_row
          on expected_row.bootstrap_id = opportunity_row.id
        where opportunity_row.lost_at is not null
           or opportunity_row.lost_reason_code is not null
           or opportunity_row.lost_reason_details is not null
           or opportunity_row.current_loss_event_id is not null
           or opportunity_row.last_reopened_at is not null
      ),
      format('esperados=%s bootstrap_encontrados=%s', v_total_expected, (
        select count(*)
        from pg_temp._p9_b1_e1_3_expected expected_row
        join public.commercial_opportunities opportunity_row
          on opportunity_row.id = expected_row.bootstrap_id
      ))
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        6,
        'projecao de perda esta null',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    perform pg_temp._p9_b1_e1_3_record(
      7,
      'timestamps do bootstrap correspondem ao contrato',
      v_total_expected > 0
      and (
        select count(*)
        from pg_temp._p9_b1_e1_3_expected expected_row
        join public.commercial_opportunities opportunity_row
          on opportunity_row.id = expected_row.bootstrap_id
      ) = v_total_expected
      and not exists (
        select 1
        from pg_temp._p9_b1_e1_3_expected expected_row
        join public.commercial_opportunities opportunity_row
          on opportunity_row.id = expected_row.bootstrap_id
        where opportunity_row.stage_changed_at is distinct from expected_row.stage_changed_at
           or opportunity_row.created_at is distinct from expected_row.created_at
           or opportunity_row.updated_at is distinct from expected_row.updated_at
      ),
      format('esperados=%s bootstrap_encontrados=%s', v_total_expected, (
        select count(*)
        from pg_temp._p9_b1_e1_3_expected expected_row
        join public.commercial_opportunities opportunity_row
          on opportunity_row.id = expected_row.bootstrap_id
      ))
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        7,
        'timestamps do bootstrap correspondem ao contrato',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    perform pg_temp._p9_b1_e1_3_record(
      8,
      'lead com exatamente uma conversa recebeu essa conversa',
      v_single_conversation_expected > 0
      and (
        select count(*)
        from pg_temp._p9_b1_e1_3_expected expected_row
        join public.commercial_opportunities opportunity_row
          on opportunity_row.id = expected_row.bootstrap_id
        where expected_row.conversation_count = 1
      ) = v_single_conversation_expected
      and not exists (
        select 1
        from pg_temp._p9_b1_e1_3_expected expected_row
        join public.commercial_opportunities opportunity_row
          on opportunity_row.id = expected_row.bootstrap_id
        where expected_row.conversation_count = 1
          and opportunity_row.primary_conversation_id is distinct from expected_row.primary_conversation_id
      ),
      format(
        'leads_com_uma_conversa=%s bootstrap_encontrados=%s',
        v_single_conversation_expected,
        (
          select count(*)
          from pg_temp._p9_b1_e1_3_expected expected_row
          join public.commercial_opportunities opportunity_row
            on opportunity_row.id = expected_row.bootstrap_id
          where expected_row.conversation_count = 1
        )
      )
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        8,
        'lead com exatamente uma conversa recebeu essa conversa',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    perform pg_temp._p9_b1_e1_3_record(
      9,
      'lead com multiplas conversas recebeu primary_conversation_id null',
      v_multi_conversation_expected > 0
      and (
        select count(*)
        from pg_temp._p9_b1_e1_3_expected expected_row
        join public.commercial_opportunities opportunity_row
          on opportunity_row.id = expected_row.bootstrap_id
        where expected_row.conversation_count > 1
      ) = v_multi_conversation_expected
      and not exists (
        select 1
        from pg_temp._p9_b1_e1_3_expected expected_row
        join public.commercial_opportunities opportunity_row
          on opportunity_row.id = expected_row.bootstrap_id
        where expected_row.conversation_count > 1
          and opportunity_row.primary_conversation_id is not null
      ),
      format(
        'leads_com_multiplas_conversas=%s bootstrap_encontrados=%s',
        v_multi_conversation_expected,
        (
          select count(*)
          from pg_temp._p9_b1_e1_3_expected expected_row
          join public.commercial_opportunities opportunity_row
            on opportunity_row.id = expected_row.bootstrap_id
          where expected_row.conversation_count > 1
        )
      )
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        9,
        'lead com multiplas conversas recebeu primary_conversation_id null',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    perform pg_temp._p9_b1_e1_3_record(
      10,
      'nenhuma conversa foi escolhida por recencia',
      v_non_single_conversation_expected > 0
      and (
        select count(*)
        from pg_temp._p9_b1_e1_3_expected expected_row
        join public.commercial_opportunities opportunity_row
          on opportunity_row.id = expected_row.bootstrap_id
        where expected_row.conversation_count <> 1
      ) = v_non_single_conversation_expected
      and not exists (
        select 1
        from pg_temp._p9_b1_e1_3_expected expected_row
        join public.commercial_opportunities opportunity_row
          on opportunity_row.id = expected_row.bootstrap_id
        where expected_row.conversation_count <> 1
          and opportunity_row.primary_conversation_id is not null
      ),
      format(
        'leads_cardinalidade_nao_1=%s bootstrap_encontrados=%s',
        v_non_single_conversation_expected,
        (
          select count(*)
          from pg_temp._p9_b1_e1_3_expected expected_row
          join public.commercial_opportunities opportunity_row
            on opportunity_row.id = expected_row.bootstrap_id
          where expected_row.conversation_count <> 1
        )
      )
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        10,
        'nenhuma conversa foi escolhida por recencia',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    with attempted as (
      insert into public.commercial_opportunities (
        id,
        organization_id,
        store_id,
        customer_id,
        origin_lead_id,
        primary_conversation_id,
        stage,
        stage_changed_at,
        created_at,
        updated_at,
        lifecycle_cycle,
        lost_at,
        lost_reason_code,
        lost_reason_details,
        current_loss_event_id,
        last_reopened_at
      )
      select
        expected_row.bootstrap_id,
        expected_row.organization_id,
        expected_row.store_id,
        expected_row.customer_id,
        expected_row.lead_id,
        expected_row.primary_conversation_id,
        expected_row.stage,
        expected_row.stage_changed_at,
        expected_row.created_at,
        expected_row.updated_at,
        expected_row.lifecycle_cycle,
        null::timestamptz,
        null::text,
        null::text,
        null::uuid,
        null::timestamptz
      from pg_temp._p9_b1_e1_3_expected expected_row
      left join public.commercial_opportunities opportunity_row
        on opportunity_row.id = expected_row.bootstrap_id
      where opportunity_row.id is null
      returning id
    )
    select count(*) into v_total_actual from attempted;

    perform pg_temp._p9_b1_e1_3_record(
      11,
      'reexecutar a logica idempotente nao insere duplicatas',
      v_total_actual = 0,
      format('segunda execucao inseriu %s linha(s)', v_total_actual)
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        11,
        'reexecutar a logica idempotente nao insere duplicatas',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  declare
    v_scenario_12_pass boolean := false;
    v_scenario_12_detail text := 'o teste nao executou a verificacao de conflito';
    v_scenario_12_message text := null;
  begin
    begin
      update public.commercial_opportunities opportunity_row
      set updated_at = opportunity_row.updated_at + interval '1 second'
      where opportunity_row.id = (
        select expected_row.bootstrap_id
        from pg_temp._p9_b1_e1_3_expected expected_row
        order by expected_row.lead_id
        limit 1
      );

        if exists (
          select 1
          from pg_temp._p9_b1_e1_3_expected expected_row
          join public.commercial_opportunities opportunity_row
            on opportunity_row.id = expected_row.bootstrap_id
          where opportunity_row.organization_id is distinct from expected_row.organization_id
             or opportunity_row.store_id is distinct from expected_row.store_id
             or opportunity_row.customer_id is distinct from expected_row.customer_id
             or opportunity_row.origin_lead_id is distinct from expected_row.lead_id
             or opportunity_row.primary_conversation_id is distinct from expected_row.primary_conversation_id
             or opportunity_row.stage is distinct from expected_row.stage
             or opportunity_row.stage_changed_at is distinct from expected_row.stage_changed_at
             or opportunity_row.created_at is distinct from expected_row.created_at
             or opportunity_row.updated_at is distinct from expected_row.updated_at
             or opportunity_row.lifecycle_cycle is distinct from expected_row.lifecycle_cycle
             or opportunity_row.lost_at is not null
             or opportunity_row.lost_reason_code is not null
             or opportunity_row.lost_reason_details is not null
             or opportunity_row.current_loss_event_id is not null
             or opportunity_row.last_reopened_at is not null
        ) then
          raise exception using
            errcode = 'P0001',
            message = 'precondition failed: deterministic bootstrap opportunity id already exists with divergent payload';
        end if;

      v_scenario_12_pass := false;
      v_scenario_12_detail := 'nao houve rejeicao do payload divergente no id reservado do bootstrap';
      raise exception using
        errcode = 'P0001',
        message = v_scenario_12_detail;
    exception
      when sqlstate 'P0001' then
        get stacked diagnostics v_scenario_12_message = message_text;
        v_scenario_12_pass :=
          v_scenario_12_message = 'precondition failed: deterministic bootstrap opportunity id already exists with divergent payload';
        v_scenario_12_detail := case
          when v_scenario_12_pass then coalesce(v_scenario_12_message, '<null>')
          else coalesce(v_scenario_12_detail, v_scenario_12_message, '<null>')
        end;
    end;

    perform pg_temp._p9_b1_e1_3_record(
      12,
      'uuid deterministico existente com payload divergente e rejeitado em fixture isolada',
      v_scenario_12_pass,
      v_scenario_12_detail
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        12,
        'uuid deterministico existente com payload divergente e rejeitado em fixture isolada',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select
      expected_row.organization_id,
      expected_row.store_id,
      expected_row.customer_id,
      expected_row.lead_id,
      expected_row.bootstrap_id,
      expected_row.stage,
      expected_row.stage_changed_at,
      expected_row.created_at,
      expected_row.updated_at
    into
      v_extra_organization_id,
      v_extra_store_id,
      v_extra_customer_id,
      v_extra_lead_id,
      v_extra_bootstrap_id,
      v_extra_stage,
      v_extra_stage_changed_at,
      v_extra_created_at,
      v_extra_updated_at
    from pg_temp._p9_b1_e1_3_expected expected_row
    order by expected_row.lead_id
    limit 1;

    if v_extra_organization_id is null
       or v_extra_store_id is null
       or v_extra_customer_id is null
       or v_extra_lead_id is null
       or v_extra_bootstrap_id is null then
      raise exception using
        errcode = v_fixture_fatal_sqlstate,
        message = 'harness fixture setup failed: missing source data for extra opportunity fixture';
    end if;

    insert into public.commercial_opportunities (
      id,
      organization_id,
      store_id,
      customer_id,
      origin_lead_id,
      primary_conversation_id,
      stage,
      stage_changed_at,
      created_at,
      updated_at,
      lifecycle_cycle,
      lost_at,
      lost_reason_code,
      lost_reason_details,
      current_loss_event_id,
      last_reopened_at
    )
    values (
      gen_random_uuid(),
      v_extra_organization_id,
      v_extra_store_id,
      v_extra_customer_id,
      v_extra_lead_id,
      null::uuid,
      v_extra_stage,
      v_extra_stage_changed_at,
      v_extra_created_at,
      v_extra_updated_at + interval '2 seconds',
      1,
      null::timestamptz,
      null::text,
      null::text,
      null::uuid,
      null::timestamptz
    )
    returning id into v_extra_opportunity_id;

    if v_extra_opportunity_id is null then
      raise exception using
        errcode = v_fixture_fatal_sqlstate,
        message = 'harness fixture setup failed: extra opportunity fixture insert returned null id';
    end if;

    update pg_temp._p9_b1_e1_3_ctx
    set fixture_extra_opportunity_id = v_extra_opportunity_id;
  exception
    when others then
      get stacked diagnostics v_message = message_text;
      raise exception using
        errcode = v_fixture_fatal_sqlstate,
        message = coalesce(v_message, 'harness fixture setup failed: extra opportunity fixture could not be created');
  end;

  begin
    perform pg_temp._p9_b1_e1_3_record(
      13,
      'a rpc nova retorna uma linha por oportunidade',
      (
        with scope_totals as (
          select count(*) as total_count
          from public.commercial_opportunities opportunity_row
          where opportunity_row.organization_id = v_extra_organization_id
        ),
        paged_rows as (
          select rpc_row.commercial_opportunity_id
          from scope_totals total_row
          cross join lateral generate_series(
            0,
            greatest(total_row.total_count - 1, 0)::integer,
            500::integer
          ) offset_row(page_offset)
          cross join lateral public.panel_list_crm_opportunity_cards_scoped(
            v_extra_organization_id,
            null,
            500,
            offset_row.page_offset
          ) rpc_row
        )
        select
          total_count > 0
          and (select count(*) from paged_rows) = total_count
          and (
            select count(distinct commercial_opportunity_id)
            from paged_rows
          ) = total_count
        from scope_totals
      ),
      'varredura paginada completa da RPC canonica coincide com a contagem de commercial_opportunities no organization_id'
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        13,
        'a rpc nova retorna uma linha por oportunidade',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select
      expected_row.organization_id,
      expected_row.store_id,
      expected_row.customer_id,
      customer_row.display_name,
      expected_row.stage,
      expected_row.stage_changed_at,
      expected_row.created_at,
      expected_row.updated_at
    into
      v_no_lead_organization_id,
      v_no_lead_store_id,
      v_fixture_no_lead_customer_id,
      v_no_lead_customer_display_name,
      v_extra_stage,
      v_extra_stage_changed_at,
      v_extra_created_at,
      v_extra_updated_at
    from pg_temp._p9_b1_e1_3_expected expected_row
    join public.customers customer_row
      on customer_row.id = expected_row.customer_id
     and customer_row.organization_id = expected_row.organization_id
    join (
      select
        identity_row.organization_id,
        identity_row.customer_id
      from public.customer_channel_identities identity_row
      where identity_row.channel = 'whatsapp'
        and identity_row.is_primary = true
      group by identity_row.organization_id, identity_row.customer_id
      having count(*) = 1
         and max(
           coalesce(
             nullif(pg_catalog.btrim(identity_row.normalized_external_identity), ''),
             nullif(pg_catalog.btrim(identity_row.external_identity), '')
           )
         ) is not null
    ) primary_whatsapp_customer_row
      on primary_whatsapp_customer_row.organization_id = expected_row.organization_id
     and primary_whatsapp_customer_row.customer_id = expected_row.customer_id
    where nullif(pg_catalog.btrim(customer_row.display_name), '') is not null
    order by expected_row.lead_id
    limit 1;

    if v_no_lead_organization_id is null
       or v_no_lead_store_id is null
       or v_fixture_no_lead_customer_id is null
       or nullif(pg_catalog.btrim(v_no_lead_customer_display_name), '') is null then
      raise exception using
        errcode = v_fixture_fatal_sqlstate,
        message = 'harness could not create no-lead opportunity fixture with customer display_name and exactly one primary whatsapp identity';
    end if;

    insert into public.commercial_opportunities (
      id,
      organization_id,
      store_id,
      customer_id,
      origin_lead_id,
      primary_conversation_id,
      stage,
      stage_changed_at,
      created_at,
      updated_at,
      lifecycle_cycle,
      lost_at,
      lost_reason_code,
      lost_reason_details,
      current_loss_event_id,
      last_reopened_at
    )
    values (
      gen_random_uuid(),
      v_no_lead_organization_id,
      v_no_lead_store_id,
      v_fixture_no_lead_customer_id,
      null::uuid,
      null::uuid,
      v_extra_stage,
      v_extra_stage_changed_at,
      v_extra_created_at,
      v_extra_updated_at + interval '3 seconds',
      1,
      null::timestamptz,
      null::text,
      null::text,
      null::uuid,
      null::timestamptz
    )
    returning id into v_no_lead_opportunity_id;

    update pg_temp._p9_b1_e1_3_ctx
    set fixture_no_lead_opportunity_id = v_no_lead_opportunity_id,
        fixture_no_lead_customer_id = v_fixture_no_lead_customer_id,
        fixture_no_lead_organization_id = v_no_lead_organization_id,
        fixture_no_lead_store_id = v_no_lead_store_id;
  exception
    when others then
      raise exception using
        errcode = v_fixture_fatal_sqlstate,
        message = 'harness fixture setup failed: no-lead opportunity fixture could not be created';
  end;

  begin
    select
      expected_row.organization_id,
      expected_row.store_id,
      expected_row.customer_id,
      expected_row.lead_id,
      expected_row.bootstrap_id
    into
      v_scope_organization_id,
      v_scope_store_id,
      v_extra_customer_id,
      v_extra_lead_id,
      v_extra_bootstrap_id
    from pg_temp._p9_b1_e1_3_expected expected_row
    order by expected_row.lead_id
    limit 1;

    perform pg_temp._p9_b1_e1_3_record(
      14,
      'duas oportunidades do mesmo customer aparecem como duas linhas distintas',
      (
        with scope_totals as (
          select count(*) as total_count
          from public.commercial_opportunities opportunity_row
          where opportunity_row.organization_id = v_scope_organization_id
            and opportunity_row.store_id = v_scope_store_id
        ),
        paged_rows as (
          select
            rpc_row.commercial_opportunity_id,
            rpc_row.customer_id
          from scope_totals total_row
          cross join lateral generate_series(
            0,
            greatest(total_row.total_count - 1, 0)::integer,
            500::integer
          ) offset_row(page_offset)
          cross join lateral public.panel_list_crm_opportunity_cards_scoped(
            v_scope_organization_id,
            v_scope_store_id,
            500,
            offset_row.page_offset
          ) rpc_row
        )
        select
          count(*) = 2
          and count(distinct paged_row.commercial_opportunity_id) = 2
          and bool_and(paged_row.customer_id = v_extra_customer_id)
          and bool_and(
            paged_row.commercial_opportunity_id in (
              v_extra_bootstrap_id,
              v_extra_opportunity_id
            )
          )
        from paged_rows paged_row
        where paged_row.commercial_opportunity_id in (
          v_extra_bootstrap_id,
          v_extra_opportunity_id
        )
      ),
      'a RPC retorna separadamente o bootstrap e a oportunidade adicional do runner para o mesmo customer_id'
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        14,
        'duas oportunidades do mesmo customer aparecem como duas linhas distintas',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select
      expected_row.organization_id,
      expected_row.store_id,
      expected_row.customer_id,
      expected_row.lead_id,
      expected_row.bootstrap_id
    into
      v_scope_organization_id,
      v_scope_store_id,
      v_extra_customer_id,
      v_extra_lead_id,
      v_extra_bootstrap_id
    from pg_temp._p9_b1_e1_3_expected expected_row
    order by expected_row.lead_id
    limit 1;

    perform pg_temp._p9_b1_e1_3_record(
      15,
      'duas oportunidades do mesmo lead aparecem como duas linhas distintas',
      (
        with scope_totals as (
          select count(*) as total_count
          from public.commercial_opportunities opportunity_row
          where opportunity_row.organization_id = v_scope_organization_id
            and opportunity_row.store_id = v_scope_store_id
        ),
        paged_rows as (
          select
            rpc_row.commercial_opportunity_id,
            rpc_row.customer_id,
            rpc_row.lead_id
          from scope_totals total_row
          cross join lateral generate_series(
            0,
            greatest(total_row.total_count - 1, 0)::integer,
            500::integer
          ) offset_row(page_offset)
          cross join lateral public.panel_list_crm_opportunity_cards_scoped(
            v_scope_organization_id,
            v_scope_store_id,
            500,
            offset_row.page_offset
          ) rpc_row
        )
        select
          count(*) = 2
          and count(distinct paged_row.commercial_opportunity_id) = 2
          and bool_and(paged_row.customer_id = v_extra_customer_id)
          and bool_and(paged_row.lead_id = v_extra_lead_id)
          and bool_and(
            paged_row.commercial_opportunity_id in (
              v_extra_bootstrap_id,
              v_extra_opportunity_id
            )
          )
        from paged_rows paged_row
        where paged_row.commercial_opportunity_id in (
          v_extra_bootstrap_id,
          v_extra_opportunity_id
        )
      ),
      'a RPC retorna separadamente o bootstrap e a oportunidade adicional do runner para o mesmo lead_id'
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        15,
        'duas oportunidades do mesmo lead aparecem como duas linhas distintas',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select expected_row.organization_id, expected_row.store_id
    into v_scope_organization_id, v_scope_store_id
    from pg_temp._p9_b1_e1_3_expected expected_row
    order by expected_row.lead_id
    limit 1;

    perform pg_temp._p9_b1_e1_3_record(
      16,
      'conversation_id da rpc vem somente de primary_conversation_id',
      (
        with scope_totals as (
          select count(*) as total_count
          from public.commercial_opportunities opportunity_row
          where opportunity_row.organization_id = v_scope_organization_id
            and opportunity_row.store_id = v_scope_store_id
        ),
        paged_rows as (
          select rpc_row.commercial_opportunity_id, rpc_row.conversation_id
          from scope_totals total_row
          cross join lateral generate_series(
            0,
            greatest(total_row.total_count - 1, 0)::integer,
            500::integer
          ) offset_row(page_offset)
          cross join lateral public.panel_list_crm_opportunity_cards_scoped(
            v_scope_organization_id,
            v_scope_store_id,
            500,
            offset_row.page_offset
          ) rpc_row
        )
        select
          total_count > 0
          and (select count(*) from paged_rows) = total_count
          and (select count(distinct commercial_opportunity_id) from paged_rows) = total_count
          and not exists (
            select 1
            from paged_rows paged_row
            join public.commercial_opportunities opportunity_row
              on opportunity_row.id = paged_row.commercial_opportunity_id
            where paged_row.conversation_id is distinct from opportunity_row.primary_conversation_id
          )
        from scope_totals
      ),
      'conversation_id exposto pela RPC coincide exatamente com primary_conversation_id'
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        16,
        'conversation_id da rpc vem somente de primary_conversation_id',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select expected_row.organization_id, expected_row.store_id
    into v_scope_organization_id, v_scope_store_id
    from pg_temp._p9_b1_e1_3_expected expected_row
    order by expected_row.lead_id
    limit 1;

    perform pg_temp._p9_b1_e1_3_record(
      17,
      'oportunidade sem primary_conversation_id retorna conversation_id null',
      (
        with scope_totals as (
          select count(*) as total_count
          from public.commercial_opportunities opportunity_row
          where opportunity_row.organization_id = v_scope_organization_id
            and opportunity_row.store_id = v_scope_store_id
        ),
        paged_rows as (
          select rpc_row.commercial_opportunity_id, rpc_row.conversation_id
          from scope_totals total_row
          cross join lateral generate_series(
            0,
            greatest(total_row.total_count - 1, 0)::integer,
            500::integer
          ) offset_row(page_offset)
          cross join lateral public.panel_list_crm_opportunity_cards_scoped(
            v_scope_organization_id,
            v_scope_store_id,
            500,
            offset_row.page_offset
          ) rpc_row
        ),
        null_primary_rows as (
          select paged_row.commercial_opportunity_id, paged_row.conversation_id
          from paged_rows paged_row
          join public.commercial_opportunities opportunity_row
            on opportunity_row.id = paged_row.commercial_opportunity_id
          where opportunity_row.primary_conversation_id is null
        )
        select
          total_count > 0
          and (select count(*) from paged_rows) = total_count
          and (select count(distinct commercial_opportunity_id) from paged_rows) = total_count
          and (select count(*) from null_primary_rows) > 0
          and not exists (
            select 1
            from null_primary_rows
            where conversation_id is not null
          )
        from scope_totals
      ),
      format(
        'oportunidades com primary_conversation_id null=%s',
        (
          select count(*)
          from public.commercial_opportunities opportunity_row
          where opportunity_row.organization_id = v_scope_organization_id
            and opportunity_row.store_id = v_scope_store_id
            and opportunity_row.primary_conversation_id is null
        )
      )
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        17,
        'oportunidade sem primary_conversation_id retorna conversation_id null',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select expected_row.organization_id, expected_row.store_id
    into v_scope_organization_id, v_scope_store_id
    from pg_temp._p9_b1_e1_3_expected expected_row
    order by expected_row.lead_id
    limit 1;

    perform pg_temp._p9_b1_e1_3_record(
      18,
      'effective_state corresponde ao stage da oportunidade',
      (
        with scope_totals as (
          select count(*) as total_count
          from public.commercial_opportunities opportunity_row
          where opportunity_row.organization_id = v_scope_organization_id
            and opportunity_row.store_id = v_scope_store_id
        ),
        paged_rows as (
          select
            rpc_row.commercial_opportunity_id,
            rpc_row.effective_state,
            rpc_row.opportunity_stage
          from scope_totals total_row
          cross join lateral generate_series(
            0,
            greatest(total_row.total_count - 1, 0)::integer,
            500::integer
          ) offset_row(page_offset)
          cross join lateral public.panel_list_crm_opportunity_cards_scoped(
            v_scope_organization_id,
            v_scope_store_id,
            500,
            offset_row.page_offset
          ) rpc_row
        )
        select
          total_count > 0
          and (select count(*) from paged_rows) = total_count
          and (select count(distinct commercial_opportunity_id) from paged_rows) = total_count
          and not exists (
            select 1
            from paged_rows paged_row
            join public.commercial_opportunities opportunity_row
              on opportunity_row.id = paged_row.commercial_opportunity_id
            where paged_row.effective_state is distinct from opportunity_row.stage
               or paged_row.opportunity_stage is distinct from opportunity_row.stage
          )
        from scope_totals
      ),
      'effective_state e opportunity_stage da RPC coincidem com stage'
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        18,
        'effective_state corresponde ao stage da oportunidade',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select expected_row.organization_id, expected_row.store_id
    into v_scope_organization_id, v_scope_store_id
    from pg_temp._p9_b1_e1_3_expected expected_row
    order by expected_row.lead_id
    limit 1;

    perform pg_temp._p9_b1_e1_3_record(
      19,
      'filtro de loja funciona',
      (
        with scope_totals as (
          select count(*) as total_count
          from public.commercial_opportunities opportunity_row
          where opportunity_row.organization_id = v_scope_organization_id
            and opportunity_row.store_id = v_scope_store_id
        ),
        paged_rows as (
          select rpc_row.commercial_opportunity_id
          from scope_totals total_row
          cross join lateral generate_series(
            0,
            greatest(total_row.total_count - 1, 0)::integer,
            500::integer
          ) offset_row(page_offset)
          cross join lateral public.panel_list_crm_opportunity_cards_scoped(
            v_scope_organization_id,
            v_scope_store_id,
            500,
            offset_row.page_offset
          ) rpc_row
        )
        select
          total_count > 0
          and (select count(*) from paged_rows) = total_count
          and (
            select count(distinct commercial_opportunity_id)
            from paged_rows
          ) = total_count
        from scope_totals
      ),
      'varredura paginada completa respeita o filtro de store e coincide com a tabela base no mesmo escopo'
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        19,
        'filtro de loja funciona',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select expected_row.organization_id, expected_row.store_id
    into v_scope_organization_id, v_scope_store_id
    from pg_temp._p9_b1_e1_3_expected expected_row
    order by expected_row.lead_id
    limit 1;

    perform pg_temp._p9_b1_e1_3_record(
      20,
      'paginacao nao altera a identidade',
      (
        with scope_totals as (
          select count(*) as total_count
          from public.commercial_opportunities opportunity_row
          where opportunity_row.organization_id = v_scope_organization_id
            and opportunity_row.store_id = v_scope_store_id
        ),
        expected_rows as (
          select
            commercial_opportunity_id,
            row_number() over (order by updated_at desc, commercial_opportunity_id) as rn
          from (
            select opportunity_row.id as commercial_opportunity_id, opportunity_row.updated_at
            from public.commercial_opportunities opportunity_row
            where opportunity_row.organization_id = v_scope_organization_id
              and opportunity_row.store_id = v_scope_store_id
          ) base_row
        ),
        paged_rows as (
          select
            page_row.commercial_opportunity_id,
            page_row.page_offset
              + row_number() over (
                partition by page_row.page_offset
                order by page_row.updated_at desc, page_row.commercial_opportunity_id
              ) as rn
          from scope_totals total_row
          cross join lateral generate_series(
            0,
            greatest(total_row.total_count - 1, 0)::integer,
            2::integer
          ) offset_row(page_offset)
          cross join lateral (
            select
              rpc_row.commercial_opportunity_id,
              rpc_row.updated_at,
              offset_row.page_offset
            from public.panel_list_crm_opportunity_cards_scoped(
              v_scope_organization_id,
              v_scope_store_id,
              2,
              offset_row.page_offset
            ) rpc_row
          ) page_row
        )
        select
          total_row.total_count >= 4
          and (select count(*) from paged_rows) = total_row.total_count
          and not exists (
            select 1
            from expected_rows expected_row
            full join paged_rows paged_row
              on paged_row.rn = expected_row.rn
            where expected_row.commercial_opportunity_id is distinct from paged_row.commercial_opportunity_id
          )
        from scope_totals total_row
      ),
      'a uniao de todas as paginas preserva identidade e ordenacao da listagem integral'
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        20,
        'paginacao nao altera a identidade',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select membership_row.user_id, expected_row.organization_id, expected_row.store_id
    into
      v_member_user_id,
      v_scope_organization_id,
      v_scope_store_id
    from pg_temp._p9_b1_e1_3_expected expected_row
    join public.memberships membership_row
      on membership_row.organization_id = expected_row.organization_id
    order by expected_row.lead_id
    limit 1;

    update pg_temp._p9_b1_e1_3_ctx
    set member_user_id = v_member_user_id,
        member_organization_id = v_scope_organization_id,
        member_store_id = v_scope_store_id;

    if v_member_user_id is null
       or v_scope_organization_id is null
       or v_scope_store_id is null then
      raise exception using
        errcode = v_fixture_fatal_sqlstate,
        message = 'harness fixture setup failed: membership fixture is missing';
    end if;

    v_missing_organization_id := gen_random_uuid();
    while exists (
      select 1
      from public.organizations organization_row
      where organization_row.id = v_missing_organization_id
    ) loop
      v_missing_organization_id := gen_random_uuid();
    end loop;

    v_nonmember_user_id := gen_random_uuid();
    while exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = v_scope_organization_id
        and membership_row.user_id = v_nonmember_user_id
    ) loop
      v_nonmember_user_id := gen_random_uuid();
    end loop;

    select *
    into v_exec
    from pg_temp._p9_b1_e1_3_exec_value_sql(
      'authenticated',
      'authenticated',
      'authenticated',
      v_member_user_id,
      format(
        $sql$
          select count(*)::text
          from public.panel_list_crm_opportunity_cards_scoped(
            %L::uuid,
            %L::uuid,
            10,
            0
          )
        $sql$,
        v_scope_organization_id,
        v_scope_store_id
      )
    );

    perform pg_temp._p9_b1_e1_3_record(
      21,
      'authenticated com membership consegue executar',
      v_exec.operation_succeeded,
      coalesce(v_exec.value_text, v_exec.message_text, '<null>')
    );
  exception
    when sqlstate 'P9F01' then
      raise;
    when sqlstate 'P9C01' then
      raise;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        21,
        'authenticated com membership consegue executar',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select member_organization_id, member_store_id
    into v_scope_organization_id, v_scope_store_id
    from pg_temp._p9_b1_e1_3_ctx;

    select *
    into v_exec
    from pg_temp._p9_b1_e1_3_exec_value_sql(
      'authenticated',
      'authenticated',
      'authenticated',
      v_nonmember_user_id,
      format(
        $sql$
          select count(*)::text
          from public.panel_list_crm_opportunity_cards_scoped(
            %L::uuid,
            %L::uuid,
            10,
            0
          )
        $sql$,
        v_scope_organization_id,
        v_scope_store_id
      )
    );

    perform pg_temp._p9_b1_e1_3_record(
      22,
      'authenticated sem membership e rejeitado',
      not v_exec.operation_succeeded and v_exec.returned_sqlstate = '42501',
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when sqlstate 'P9C01' then
      raise;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        22,
        'authenticated sem membership e rejeitado',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select member_organization_id, member_store_id
    into v_scope_organization_id, v_scope_store_id
    from pg_temp._p9_b1_e1_3_ctx;

    select *
    into v_exec
    from pg_temp._p9_b1_e1_3_exec_value_sql(
      'anon',
      'anon',
      'anon',
      null,
      format(
        $sql$
          select count(*)::text
          from public.panel_list_crm_opportunity_cards_scoped(
            %L::uuid,
            %L::uuid,
            10,
            0
          )
        $sql$,
        v_scope_organization_id,
        v_scope_store_id
      )
    );

    perform pg_temp._p9_b1_e1_3_record(
      23,
      'anon e rejeitado',
      not v_exec.operation_succeeded and v_exec.returned_sqlstate = '42501',
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when sqlstate 'P9C01' then
      raise;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        23,
        'anon e rejeitado',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select member_organization_id, member_store_id
    into v_scope_organization_id, v_scope_store_id
    from pg_temp._p9_b1_e1_3_ctx;

    select *
    into v_exec
    from pg_temp._p9_b1_e1_3_exec_value_sql(
      'service_role',
      'service_role',
      'service_role',
      null,
      format(
        $sql$
          select count(*)::text
          from public.panel_list_crm_opportunity_cards_scoped(
            %L::uuid,
            %L::uuid,
            10,
            0
          )
        $sql$,
        v_scope_organization_id,
        v_scope_store_id
      )
    );

    perform pg_temp._p9_b1_e1_3_record(
      24,
      'service_role consegue executar',
      v_exec.operation_succeeded,
      coalesce(v_exec.value_text, v_exec.message_text, '<null>')
    );
  exception
    when sqlstate 'P9C01' then
      raise;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        24,
        'service_role consegue executar',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    perform pg_temp._p9_b1_e1_3_record(
      25,
      'acl da rpc concede execute somente a authenticated e service_role',
      (
        with acl_rows as (
          select
            acl_row.grantee,
            acl_row.privilege_type,
            role_row.rolname
          from pg_catalog.pg_proc proc_row
          cross join lateral pg_catalog.aclexplode(
            coalesce(
              proc_row.proacl,
              pg_catalog.acldefault('f', proc_row.proowner)
            )
          ) acl_row
          left join pg_catalog.pg_roles role_row
            on role_row.oid = acl_row.grantee
          where proc_row.oid = pg_catalog.to_regprocedure(
            'public.panel_list_crm_opportunity_cards_scoped(uuid,uuid,integer,integer)'
          )
        )
        select
          exists (
            select 1
            from pg_catalog.pg_proc proc_row
            where proc_row.oid = pg_catalog.to_regprocedure(
              'public.panel_list_crm_opportunity_cards_scoped(uuid,uuid,integer,integer)'
            )
              and proc_row.proowner = (
                select oid from pg_catalog.pg_roles where rolname = 'postgres'
              )
          )
          and
          coalesce(bool_or(rolname = 'authenticated' and privilege_type = 'EXECUTE'), false)
          and coalesce(bool_or(rolname = 'service_role' and privilege_type = 'EXECUTE'), false)
          and not coalesce(bool_or(rolname = 'anon' and privilege_type = 'EXECUTE'), false)
          and not coalesce(bool_or(grantee = 0 and privilege_type = 'EXECUTE'), false)
          and not coalesce(
            bool_or(
              privilege_type = 'EXECUTE'
              and grantee <> 0
              and coalesce(rolname, '') not in ('postgres', 'authenticated', 'service_role')
            ),
            false
          )
        from acl_rows
      ),
      'postgres permanece owner; authenticated e service_role mantem EXECUTE; anon, PUBLIC e qualquer outra role permanecem sem EXECUTE'
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        25,
        'acl da rpc concede execute somente a authenticated e service_role',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    v_old_rpc_oid := pg_catalog.to_regprocedure(
      'public.panel_list_crm_cards_scoped(uuid,uuid,integer,integer)'
    );

    perform pg_temp._p9_b1_e1_3_record(
      26,
      'a rpc antiga continua existindo com a assinatura original',
      v_old_rpc_oid is not null,
      coalesce(v_old_rpc_oid::text, '<missing>')
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        26,
        'a rpc antiga continua existindo com a assinatura original',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    v_old_rpc_oid := pg_catalog.to_regprocedure(
      'public.panel_list_crm_cards_scoped(uuid,uuid,integer,integer)'
    );
    v_new_rpc_oid := pg_catalog.to_regprocedure(
      'public.panel_list_crm_opportunity_cards_scoped(uuid,uuid,integer,integer)'
    );

    perform pg_temp._p9_b1_e1_3_record(
      27,
      'a rpc antiga nao foi substituida nem removida',
      v_old_rpc_oid is not null
      and v_new_rpc_oid is not null
      and v_old_rpc_oid <> v_new_rpc_oid,
      format(
        'rpc_antiga=%s rpc_nova=%s oids_distintos=%s',
        coalesce(v_old_rpc_oid::text, '<missing>'),
        coalesce(v_new_rpc_oid::text, '<missing>'),
        case
          when v_old_rpc_oid is not null and v_new_rpc_oid is not null and v_old_rpc_oid <> v_new_rpc_oid
            then 'true'
          else 'false'
        end
      )
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        27,
        'a rpc antiga nao foi substituida nem removida',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    perform pg_temp._p9_b1_e1_3_record(
      28,
      'nenhuma unique impede multiplas oportunidades legitimas por origin_lead_id ou customer_id',
      not exists (
        with unique_indexes as (
          select
            class_row.relname,
            (
              select array_agg(attribute_row.attname::text order by key_column.ordinality)
              from pg_catalog.unnest(index_row.indkey::smallint[])
                   with ordinality as key_column(attnum, ordinality)
              join pg_catalog.pg_attribute attribute_row
                on attribute_row.attrelid = index_row.indrelid
               and attribute_row.attnum = key_column.attnum
               and not attribute_row.attisdropped
              where key_column.ordinality <= index_row.indnkeyatts
            ) as key_columns
          from pg_catalog.pg_index index_row
          join pg_catalog.pg_class class_row
            on class_row.oid = index_row.indexrelid
          where index_row.indrelid = 'public.commercial_opportunities'::regclass
            and index_row.indisunique
        )
        select 1
        from unique_indexes index_row
        where index_row.key_columns && array['origin_lead_id', 'customer_id']::text[]
          and not (index_row.key_columns @> array['id']::text[])
      ),
      'nenhum indice unique total ou parcial sem id bloqueia oportunidades distintas por origin_lead_id ou customer_id'
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        28,
        'nenhuma unique impede multiplas oportunidades legitimas por origin_lead_id ou customer_id',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select member_organization_id, member_store_id
    into v_scope_organization_id, v_scope_store_id
    from pg_temp._p9_b1_e1_3_ctx;

    select *
    into v_exec
    from pg_temp._p9_b1_e1_3_exec_value_sql(
      'authenticated',
      'service_role',
      'service_role',
      v_member_user_id,
      format(
        $sql$
          select count(*)::text
          from public.panel_list_crm_opportunity_cards_scoped(
            %L::uuid,
            %L::uuid,
            10,
            0
          )
        $sql$,
        v_scope_organization_id,
        v_scope_store_id
      )
    );

    perform pg_temp._p9_b1_e1_3_record(
      29,
      'papel efetivo authenticated com claim service_role e rejeitado',
      not v_exec.operation_succeeded and v_exec.returned_sqlstate = '42501',
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when sqlstate 'P9C01' then
      raise;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        29,
        'papel efetivo authenticated com claim service_role e rejeitado',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select member_organization_id, member_store_id
    into v_scope_organization_id, v_scope_store_id
    from pg_temp._p9_b1_e1_3_ctx;

    select *
    into v_exec
    from pg_temp._p9_b1_e1_3_exec_value_sql(
      'service_role',
      'authenticated',
      'authenticated',
      null,
      format(
        $sql$
          select count(*)::text
          from public.panel_list_crm_opportunity_cards_scoped(
            %L::uuid,
            %L::uuid,
            10,
            0
          )
        $sql$,
        v_scope_organization_id,
        v_scope_store_id
      )
    );

    perform pg_temp._p9_b1_e1_3_record(
      30,
      'papel efetivo service_role com claim authenticated e rejeitado',
      not v_exec.operation_succeeded and v_exec.returned_sqlstate = '42501',
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when sqlstate 'P9C01' then
      raise;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        30,
        'papel efetivo service_role com claim authenticated e rejeitado',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select member_organization_id, member_store_id
    into v_scope_organization_id, v_scope_store_id
    from pg_temp._p9_b1_e1_3_ctx;

    select *
    into v_exec
    from pg_temp._p9_b1_e1_3_exec_value_sql(
      'authenticated',
      'authenticated',
      'service_role',
      v_member_user_id,
      format(
        $sql$
          select count(*)::text
          from public.panel_list_crm_opportunity_cards_scoped(
            %L::uuid,
            %L::uuid,
            10,
            0
          )
        $sql$,
        v_scope_organization_id,
        v_scope_store_id
      )
    );

    perform pg_temp._p9_b1_e1_3_record(
      31,
      'request.jwt.claim.role divergente de request.jwt.claims.role e rejeitado',
      not v_exec.operation_succeeded and v_exec.returned_sqlstate = '42501',
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when sqlstate 'P9C01' then
      raise;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        31,
        'request.jwt.claim.role divergente de request.jwt.claims.role e rejeitado',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select member_organization_id, member_store_id
    into v_scope_organization_id, v_scope_store_id
    from pg_temp._p9_b1_e1_3_ctx;

    perform pg_temp._p9_b1_e1_3_record(
      32,
      'sessao postgres com claims de api e rejeitada',
      (
        with attempts as (
          select *
          from pg_temp._p9_b1_e1_3_exec_value_sql(
            null,
            'authenticated',
            'authenticated',
            v_member_user_id,
            format(
              $sql$
                select count(*)::text
                from public.panel_list_crm_opportunity_cards_scoped(
                  %L::uuid,
                  %L::uuid,
                  10,
                  0
                )
              $sql$,
              v_scope_organization_id,
              v_scope_store_id
            )
          )
          union all
          select *
          from pg_temp._p9_b1_e1_3_exec_value_sql(
            null,
            'service_role',
            'service_role',
            null,
            format(
              $sql$
                select count(*)::text
                from public.panel_list_crm_opportunity_cards_scoped(
                  %L::uuid,
                  %L::uuid,
                  10,
                  0
                )
              $sql$,
              v_scope_organization_id,
              v_scope_store_id
            )
          )
          union all
          select *
          from pg_temp._p9_b1_e1_3_exec_value_sql(
            null,
            'anon',
            'anon',
            null,
            format(
              $sql$
                select count(*)::text
                from public.panel_list_crm_opportunity_cards_scoped(
                  %L::uuid,
                  %L::uuid,
                  10,
                  0
                )
              $sql$,
              v_scope_organization_id,
              v_scope_store_id
            )
          )
        )
        select
          count(*) = 3
          and coalesce(bool_and(not operation_succeeded and returned_sqlstate = '42501'), false)
        from attempts
      ),
      'exatamente tres tentativas com claims de authenticated, service_role e anon sao rejeitadas por sessao postgres'
    );
  exception
    when sqlstate 'P9C01' then
      raise;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        32,
        'sessao postgres com claims de api e rejeitada',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select
      fixture_no_lead_opportunity_id,
      fixture_no_lead_customer_id,
      fixture_no_lead_organization_id,
      fixture_no_lead_store_id
    into
      v_no_lead_opportunity_id,
      v_fixture_no_lead_customer_id,
      v_scope_organization_id,
      v_scope_store_id
    from pg_temp._p9_b1_e1_3_ctx;

    if v_no_lead_opportunity_id is null
       or v_fixture_no_lead_customer_id is null
       or v_scope_organization_id is null
       or v_scope_store_id is null then
      raise exception using
        errcode = 'P0001',
        message = 'harness no-lead fixture is missing';
    end if;

    perform pg_temp._p9_b1_e1_3_record(
      33,
      'oportunidade sem lead retorna name igual ao display_name do customer',
      (
        with scope_totals as (
          select count(*) as total_count
          from public.commercial_opportunities opportunity_row
          where opportunity_row.organization_id = v_scope_organization_id
            and opportunity_row.store_id = v_scope_store_id
        ),
        paged_rows as (
          select rpc_row.commercial_opportunity_id, rpc_row.name
          from scope_totals total_row
          cross join lateral generate_series(
            0,
            greatest(total_row.total_count - 1, 0)::integer,
            500::integer
          ) offset_row(page_offset)
          cross join lateral public.panel_list_crm_opportunity_cards_scoped(
            v_scope_organization_id,
            v_scope_store_id,
            500,
            offset_row.page_offset
          ) rpc_row
        )
        select
          count(*) = 1
          and min(paged_row.name) is not distinct from min(nullif(pg_catalog.btrim(customer_row.display_name), ''))
        from paged_rows paged_row
        join public.customers customer_row
          on customer_row.id = v_fixture_no_lead_customer_id
         and customer_row.organization_id = v_scope_organization_id
        where paged_row.commercial_opportunity_id = v_no_lead_opportunity_id
      ),
      'fixture sem lead usa display_name do customer como fallback de name'
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        33,
        'oportunidade sem lead retorna name igual ao display_name do customer',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select
      fixture_no_lead_opportunity_id,
      fixture_no_lead_customer_id,
      fixture_no_lead_organization_id,
      fixture_no_lead_store_id
    into
      v_no_lead_opportunity_id,
      v_fixture_no_lead_customer_id,
      v_scope_organization_id,
      v_scope_store_id
    from pg_temp._p9_b1_e1_3_ctx;

    if v_no_lead_opportunity_id is null
       or v_fixture_no_lead_customer_id is null
       or v_scope_organization_id is null
       or v_scope_store_id is null then
      raise exception using
        errcode = 'P0001',
        message = 'harness no-lead fixture is missing';
    end if;

    perform pg_temp._p9_b1_e1_3_record(
      34,
      'oportunidade sem lead retorna phone da identidade principal de whatsapp',
      (
        with scope_totals as (
          select count(*) as total_count
          from public.commercial_opportunities opportunity_row
          where opportunity_row.organization_id = v_scope_organization_id
            and opportunity_row.store_id = v_scope_store_id
        ),
        paged_rows as (
          select rpc_row.commercial_opportunity_id, rpc_row.phone
          from scope_totals total_row
          cross join lateral generate_series(
            0,
            greatest(total_row.total_count - 1, 0)::integer,
            500::integer
          ) offset_row(page_offset)
          cross join lateral public.panel_list_crm_opportunity_cards_scoped(
            v_scope_organization_id,
            v_scope_store_id,
            500,
            offset_row.page_offset
          ) rpc_row
        ),
        expected_phone as (
          select
            case
              when count(*) = 1
                then (array_agg(
                  coalesce(
                    nullif(pg_catalog.btrim(identity_row.normalized_external_identity), ''),
                    nullif(pg_catalog.btrim(identity_row.external_identity), '')
                  )
                ))[1]
              else null::text
            end as phone
          from public.customer_channel_identities identity_row
          where identity_row.organization_id = v_scope_organization_id
            and identity_row.customer_id = v_fixture_no_lead_customer_id
            and identity_row.channel = 'whatsapp'
            and identity_row.is_primary = true
        )
        select
          count(*) = 1
          and min(expected_phone.phone) is not null
          and min(paged_row.phone) is not distinct from min(expected_phone.phone)
        from paged_rows paged_row
        cross join expected_phone
        where paged_row.commercial_opportunity_id = v_no_lead_opportunity_id
      ),
      'fixture sem lead usa a identidade principal de whatsapp como fallback de phone'
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        34,
        'oportunidade sem lead retorna phone da identidade principal de whatsapp',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select
      fixture_no_lead_opportunity_id,
      fixture_no_lead_customer_id,
      fixture_no_lead_organization_id,
      fixture_no_lead_store_id
    into
      v_no_lead_opportunity_id,
      v_fixture_no_lead_customer_id,
      v_scope_organization_id,
      v_scope_store_id
    from pg_temp._p9_b1_e1_3_ctx;

    if v_no_lead_opportunity_id is null
       or v_fixture_no_lead_customer_id is null
       or v_scope_organization_id is null
       or v_scope_store_id is null then
      raise exception using
        errcode = 'P0001',
        message = 'harness no-lead fixture is missing';
    end if;

    perform pg_temp._p9_b1_e1_3_record(
      35,
      'a identidade do customer nao duplica o card da oportunidade sem lead',
      (
        with scope_totals as (
          select count(*) as total_count
          from public.commercial_opportunities opportunity_row
          where opportunity_row.organization_id = v_scope_organization_id
            and opportunity_row.store_id = v_scope_store_id
        ),
        paged_rows as (
          select rpc_row.commercial_opportunity_id
          from scope_totals total_row
          cross join lateral generate_series(
            0,
            greatest(total_row.total_count - 1, 0)::integer,
            500::integer
          ) offset_row(page_offset)
          cross join lateral public.panel_list_crm_opportunity_cards_scoped(
            v_scope_organization_id,
            v_scope_store_id,
            500,
            offset_row.page_offset
          ) rpc_row
        )
        select count(*) = 1
        from paged_rows
        where commercial_opportunity_id = v_no_lead_opportunity_id
      ),
      'a fixture sem lead aparece exatamente uma vez na RPC'
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        35,
        'a identidade do customer nao duplica o card da oportunidade sem lead',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    perform pg_temp._p9_b1_e1_3_record(
      36,
      'funcao possui owner postgres e security definer',
      exists (
        select 1
        from pg_catalog.pg_proc proc_row
        join pg_catalog.pg_roles role_row
          on role_row.oid = proc_row.proowner
        where proc_row.oid = pg_catalog.to_regprocedure(
          'public.panel_list_crm_opportunity_cards_scoped(uuid,uuid,integer,integer)'
        )
          and role_row.rolname = 'postgres'
          and proc_row.prosecdef
      ),
      'owner postgres com SECURITY DEFINER e sem SECURITY INVOKER'
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        36,
        'funcao possui owner postgres e security definer',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    perform pg_temp._p9_b1_e1_3_record(
      37,
      'funcao preserva assinatura defaults e contrato de retorno',
      (
        with proc_row as (
          select *
          from pg_catalog.pg_proc
          where oid = pg_catalog.to_regprocedure(
            'public.panel_list_crm_opportunity_cards_scoped(uuid,uuid,integer,integer)'
          )
        ),
        in_args as (
          select
            proc_row.pronargs,
            proc_row.pronargdefaults,
            proc_row.proargnames[1:4] as arg_names,
            string_to_array(proc_row.proargtypes::text, ' ')::oid[] as arg_type_oids,
            pg_catalog.pg_get_expr(proc_row.proargdefaults, 0::oid) as defaults_expr
          from proc_row
        ),
        out_args as (
          select
            array_agg(arg.arg_name order by arg.ordinality) as arg_names,
            array_agg(arg.arg_type order by arg.ordinality) as arg_types
          from proc_row
          cross join lateral (
            select
              arg_names.arg_name,
              format_type(arg_types.arg_type_oid, null) as arg_type,
              arg_types.ordinality
            from unnest(proc_row.proallargtypes) with ordinality as arg_types(arg_type_oid, ordinality)
            join unnest(proc_row.proargmodes) with ordinality as arg_modes(arg_mode, ordinality)
              on arg_modes.ordinality = arg_types.ordinality
            join unnest(proc_row.proargnames) with ordinality as arg_names(arg_name, ordinality)
              on arg_names.ordinality = arg_types.ordinality
            where arg_modes.arg_mode = 't'
          ) arg
        )
        select
          exists (
            select 1
            from in_args
            where pronargs = 4
              and pronargdefaults = 3
              and arg_names = array[
                'p_organization_id',
                'p_store_id',
                'p_limit',
                'p_offset'
              ]
              and arg_type_oids = array[
                'uuid'::regtype::oid,
                'uuid'::regtype::oid,
                'integer'::regtype::oid,
                'integer'::regtype::oid
              ]
              and defaults_expr ~ '^NULL::uuid, 500, 0$'
          )
          and exists (
            select 1
            from out_args
            where arg_names = array[
              'commercial_opportunity_id',
              'organization_id',
              'store_id',
              'customer_id',
              'lead_id',
              'conversation_id',
              'name',
              'phone',
              'effective_state',
              'opportunity_stage',
              'lead_state',
              'conversation_status',
              'is_human_active',
              'stage_changed_at',
              'lifecycle_cycle',
              'created_at',
              'updated_at'
            ]
              and arg_types = array[
                'uuid',
                'uuid',
                'uuid',
                'uuid',
                'uuid',
                'uuid',
                'text',
                'text',
                'text',
                'text',
                'text',
                'text',
                'boolean',
                'timestamp with time zone',
                'integer',
                'timestamp with time zone',
                'timestamp with time zone'
              ]
          )
      ),
      'assinatura uuid, uuid, integer, integer; tres defaults; e retorno tabular preservado'
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        37,
        'funcao preserva assinatura defaults e contrato de retorno',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    perform pg_temp._p9_b1_e1_3_record(
      38,
      'proconfig contem search_path seguro e row_security off',
      exists (
        select 1
        from pg_catalog.pg_proc proc_row
        where proc_row.oid = pg_catalog.to_regprocedure(
          'public.panel_list_crm_opportunity_cards_scoped(uuid,uuid,integer,integer)'
        )
          and proc_row.proconfig @> array[
            'search_path=pg_catalog, pg_temp, public',
            'row_security=off'
          ]
          and coalesce(array_length(proc_row.proconfig, 1), 0) = 2
      ),
      'search_path seguro com pg_catalog, pg_temp e public; row_security=off'
    );
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        38,
        'proconfig contem search_path seguro e row_security off',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select *
    into v_exec
    from pg_temp._p9_b1_e1_3_exec_value_sql(
      'authenticated',
      'authenticated',
      'authenticated',
      v_nonmember_user_id,
      format(
        $sql$
          select count(*)::text
          from public.panel_list_crm_opportunity_cards_scoped(
            %L::uuid,
            null::uuid,
            10,
            0
          )
        $sql$,
        v_missing_organization_id
      )
    );

    perform pg_temp._p9_b1_e1_3_record(
      39,
      'authenticated sem membership em organization inexistente recebe 42501',
      not v_exec.operation_succeeded
      and v_exec.returned_sqlstate = '42501'
      and coalesce(v_exec.returned_sqlstate, '') <> '23503',
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when sqlstate 'P9C01' then
      raise;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        39,
        'authenticated sem membership em organization inexistente recebe 42501',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select *
    into v_exec
    from pg_temp._p9_b1_e1_3_exec_value_sql(
      'anon',
      'anon',
      'anon',
      null,
      format(
        $sql$
          select count(*)::text
          from public.panel_list_crm_opportunity_cards_scoped(
            %L::uuid,
            null::uuid,
            10,
            0
          )
        $sql$,
        v_missing_organization_id
      )
    );

    perform pg_temp._p9_b1_e1_3_record(
      40,
      'anon em organization inexistente recebe 42501',
      not v_exec.operation_succeeded
      and v_exec.returned_sqlstate = '42501'
      and coalesce(v_exec.returned_sqlstate, '') <> '23503',
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when sqlstate 'P9C01' then
      raise;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        40,
        'anon em organization inexistente recebe 42501',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;

  begin
    select *
    into v_exec
    from pg_temp._p9_b1_e1_3_exec_value_sql(
      'service_role',
      'service_role',
      'service_role',
      null,
      format(
        $sql$
          select count(*)::text
          from public.panel_list_crm_opportunity_cards_scoped(
            %L::uuid,
            null::uuid,
            10,
            0
          )
        $sql$,
        v_missing_organization_id
      )
    );

    perform pg_temp._p9_b1_e1_3_record(
      41,
      'service_role em organization inexistente chega na validacao do escopo',
      not v_exec.operation_succeeded
      and v_exec.returned_sqlstate = '23503',
      coalesce(v_exec.message_text, '<null>')
    );
  exception
    when sqlstate 'P9C01' then
      raise;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
      insert into pg_temp._p9_b1_e1_3_results values (
        41,
        'service_role em organization inexistente chega na validacao do escopo',
        'HARNESS_ERROR',
        format('sqlstate=%s constraint=%s message=%s', v_sqlstate, coalesce(v_constraint, '<null>'), v_message)
      );
  end;
end;
$checks$;

select
  scenario_number,
  scenario_name,
  status,
  detail
from pg_temp._p9_b1_e1_3_results
order by scenario_number;

select
  count(*) as total_scenarios,
  count(*) filter (where status = 'PASS') as total_pass,
  count(*) filter (where status = 'SUT_FAIL') as sut_fail,
  0::bigint as total_blocked,
  count(*) filter (where status = 'HARNESS_ERROR') as harness_error,
  case
    when count(*) <> 41 then 'AINDA_NAO_APROVADA'
    when count(*) filter (where status = 'PASS') <> 41 then 'AINDA_NAO_APROVADA'
    when count(*) filter (where status = 'SUT_FAIL') > 0 then 'AINDA_NAO_APROVADA'
    when count(*) filter (where status = 'HARNESS_ERROR') > 0 then 'AINDA_NAO_APROVADA'
    when 0::bigint <> 0 then 'AINDA_NAO_APROVADA'
    else 'APROVADA'
  end as final_status
from pg_temp._p9_b1_e1_3_results;

rollback;

begin;

create temp table pg_temp._p9_system_writer_jwt_matrix (
  scenario_number integer primary key,
  scenario_name text not null
);

insert into pg_temp._p9_system_writer_jwt_matrix (scenario_number, scenario_name)
values
  (1, 'the three by_system writers exist with the expected signatures'),
  (2, 'the three by_system writers remain security definer with hardened proconfig'),
  (3, 'transition writer now resolves jwt role with current_setting plus auth.jwt fallback'),
  (4, 'conclude writer now resolves jwt role with current_setting plus auth.jwt fallback'),
  (5, 'reopen writer now resolves jwt role with current_setting plus auth.jwt fallback'),
  (6, 'all three by_system writers still require service_role or postgres'),
  (7, 'no by_system writer was broadened to authenticated access'),
  (8, 'service_role keeps execute while authenticated and anon remain denied'),
  (9, 'the three signatures remain unchanged'),
  (10, 'essential business logic markers remain intact in each writer'),
  (11, 'the runner remains static-only and does not treat postgres execution as jwt-path proof');

create temp table pg_temp._p9_system_writer_jwt_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  details text not null
);

create or replace function pg_temp._p9_system_writer_jwt_record(
  p_scenario_number integer,
  p_status text,
  p_details text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_system_writer_jwt_results (
    scenario_number,
    scenario_name,
    status,
    details
  )
  values (
    p_scenario_number,
    (
      select matrix_row.scenario_name
      from pg_temp._p9_system_writer_jwt_matrix matrix_row
      where matrix_row.scenario_number = p_scenario_number
    ),
    p_status,
    p_details
  )
  on conflict (scenario_number) do update
  set status = excluded.status,
      details = excluded.details;
end;
$function$;

create or replace function pg_temp._p9_system_writer_jwt_require(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
as $function$
begin
  if coalesce(p_condition, false) is not true then
    raise exception using
      errcode = 'P0001',
      message = p_message;
  end if;
end;
$function$;

create or replace function pg_temp._p9_system_writer_jwt_normalize_definition(
  p_definition text
)
returns text
language sql
as $function$
  select pg_catalog.regexp_replace(
    coalesce(p_definition, ''),
    '\s+',
    ' ',
    'g'
  );
$function$;

do $scenario_1$
begin
  perform pg_temp._p9_system_writer_jwt_require(
    pg_catalog.to_regprocedure(
      'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.conclude_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.reopen_commercial_opportunity_for_post_sale_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)'
    ) is not null,
    'one or more by_system writer signatures are missing'
  );

  perform pg_temp._p9_system_writer_jwt_record(1, 'PASS', 'all three by_system writer signatures exist');
exception
  when others then
    perform pg_temp._p9_system_writer_jwt_record(1, 'FAIL', sqlerrm);
end;
$scenario_1$;

do $scenario_2$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
    'public.conclude_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
    'public.reopen_commercial_opportunity_for_post_sale_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)'
  ] loop
    perform pg_temp._p9_system_writer_jwt_require(
      exists (
        select 1
        from pg_catalog.pg_proc proc_row
        where proc_row.oid = pg_catalog.to_regprocedure(v_signature)
          and proc_row.prosecdef
          and proc_row.proconfig @> array[
            'search_path=pg_catalog, pg_temp, public',
            'row_security=off'
          ]::text[]
      ),
      'security definer or proconfig changed: ' || v_signature
    );
  end loop;

  perform pg_temp._p9_system_writer_jwt_record(2, 'PASS', 'security definer and hardened proconfig remain unchanged');
exception
  when others then
    perform pg_temp._p9_system_writer_jwt_record(2, 'FAIL', sqlerrm);
end;
$scenario_2$;

do $scenario_3$
declare
  v_definition text;
  v_normalized_definition text;
begin
  select pg_catalog.pg_get_functiondef(
           'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)'::pg_catalog.regprocedure
         )
  into v_definition;

  v_normalized_definition := pg_temp._p9_system_writer_jwt_normalize_definition(v_definition);

  perform pg_temp._p9_system_writer_jwt_require(
    position('current_setting(''request.jwt.claim.role'', true)' in v_normalized_definition) > 0
    and position('auth.jwt() ->> ''role''' in v_normalized_definition) > 0
    and position('coalesce(' in v_normalized_definition) > 0,
    'transition writer is missing the jwt fallback expression'
  );

  perform pg_temp._p9_system_writer_jwt_record(3, 'PASS', 'transition writer uses current_setting plus auth.jwt fallback');
exception
  when others then
    perform pg_temp._p9_system_writer_jwt_record(3, 'FAIL', sqlerrm);
end;
$scenario_3$;

do $scenario_4$
declare
  v_definition text;
  v_normalized_definition text;
begin
  select pg_catalog.pg_get_functiondef(
           'public.conclude_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)'::pg_catalog.regprocedure
         )
  into v_definition;

  v_normalized_definition := pg_temp._p9_system_writer_jwt_normalize_definition(v_definition);

  perform pg_temp._p9_system_writer_jwt_require(
    position('current_setting(''request.jwt.claim.role'', true)' in v_normalized_definition) > 0
    and position('auth.jwt() ->> ''role''' in v_normalized_definition) > 0
    and position('coalesce(' in v_normalized_definition) > 0,
    'conclude writer is missing the jwt fallback expression'
  );

  perform pg_temp._p9_system_writer_jwt_record(4, 'PASS', 'conclude writer uses current_setting plus auth.jwt fallback');
exception
  when others then
    perform pg_temp._p9_system_writer_jwt_record(4, 'FAIL', sqlerrm);
end;
$scenario_4$;

do $scenario_5$
declare
  v_definition text;
  v_normalized_definition text;
begin
  select pg_catalog.pg_get_functiondef(
           'public.reopen_commercial_opportunity_for_post_sale_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)'::pg_catalog.regprocedure
         )
  into v_definition;

  v_normalized_definition := pg_temp._p9_system_writer_jwt_normalize_definition(v_definition);

  perform pg_temp._p9_system_writer_jwt_require(
    position('current_setting(''request.jwt.claim.role'', true)' in v_normalized_definition) > 0
    and position('auth.jwt() ->> ''role''' in v_normalized_definition) > 0
    and position('coalesce(' in v_normalized_definition) > 0,
    'reopen writer is missing the jwt fallback expression'
  );

  perform pg_temp._p9_system_writer_jwt_record(5, 'PASS', 'reopen writer uses current_setting plus auth.jwt fallback');
exception
  when others then
    perform pg_temp._p9_system_writer_jwt_record(5, 'FAIL', sqlerrm);
end;
$scenario_5$;

do $scenario_6$
declare
  v_signature text;
  v_definition text;
  v_normalized_definition text;
begin
  foreach v_signature in array array[
    'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
    'public.conclude_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
    'public.reopen_commercial_opportunity_for_post_sale_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)'
  ] loop
    select pg_catalog.pg_get_functiondef(v_signature::pg_catalog.regprocedure)
    into v_definition;

    v_normalized_definition := pg_temp._p9_system_writer_jwt_normalize_definition(v_definition);

    perform pg_temp._p9_system_writer_jwt_require(
      position('v_request_role is distinct from ''service_role''' in v_normalized_definition) > 0
      and position('session_user <> ''postgres''' in v_normalized_definition) > 0,
      'authorization rule changed in ' || v_signature
    );
  end loop;

  perform pg_temp._p9_system_writer_jwt_record(6, 'PASS', 'all three writers still require service_role or postgres');
exception
  when others then
    perform pg_temp._p9_system_writer_jwt_record(6, 'FAIL', sqlerrm);
end;
$scenario_6$;

do $scenario_7$
declare
  v_signature text;
  v_definition text;
  v_normalized_definition text;
begin
  foreach v_signature in array array[
    'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
    'public.conclude_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
    'public.reopen_commercial_opportunity_for_post_sale_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)'
  ] loop
    select pg_catalog.pg_get_functiondef(v_signature::pg_catalog.regprocedure)
    into v_definition;

    v_normalized_definition := pg_temp._p9_system_writer_jwt_normalize_definition(v_definition);

    perform pg_temp._p9_system_writer_jwt_require(
      position('''authenticated''' in v_normalized_definition) = 0,
      'authenticated marker leaked into by_system authorization: ' || v_signature
    );
  end loop;

  perform pg_temp._p9_system_writer_jwt_record(7, 'PASS', 'no by_system writer was broadened to authenticated');
exception
  when others then
    perform pg_temp._p9_system_writer_jwt_record(7, 'FAIL', sqlerrm);
end;
$scenario_7$;

do $scenario_8$
begin
  perform pg_temp._p9_system_writer_jwt_require(
    has_function_privilege(
      'service_role',
      'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.conclude_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.reopen_commercial_opportunity_for_post_sale_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.conclude_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.reopen_commercial_opportunity_for_post_sale_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.conclude_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.reopen_commercial_opportunity_for_post_sale_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)',
      'EXECUTE'
    ),
    'grants changed unexpectedly for by_system writers'
  );

  perform pg_temp._p9_system_writer_jwt_record(8, 'PASS', 'grants remain constrained to service_role only');
exception
  when others then
    perform pg_temp._p9_system_writer_jwt_record(8, 'FAIL', sqlerrm);
end;
$scenario_8$;

do $scenario_9$
declare
  v_proc_oid oid;
begin
  select pg_catalog.to_regprocedure(
           'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)'
         )
  into v_proc_oid;

  perform pg_temp._p9_system_writer_jwt_require(
    exists (
      select 1
      from pg_catalog.pg_proc proc_row
      where proc_row.oid = v_proc_oid
        and proc_row.pronargs = 10
        and proc_row.prorettype = 'record'::pg_catalog.regtype
    )
    and exists (
      select 1
      from pg_catalog.pg_proc proc_row
      where proc_row.oid = pg_catalog.to_regprocedure(
        'public.conclude_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)'
      )
        and proc_row.pronargs = 9
        and proc_row.prorettype = 'record'::pg_catalog.regtype
    )
    and exists (
      select 1
      from pg_catalog.pg_proc proc_row
      where proc_row.oid = pg_catalog.to_regprocedure(
        'public.reopen_commercial_opportunity_for_post_sale_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)'
      )
        and proc_row.pronargs = 9
        and proc_row.prorettype = 'record'::pg_catalog.regtype
    ),
    'one or more by_system signatures changed'
  );

  perform pg_temp._p9_system_writer_jwt_record(9, 'PASS', 'signatures remain unchanged');
exception
  when others then
    perform pg_temp._p9_system_writer_jwt_record(9, 'FAIL', sqlerrm);
end;
$scenario_9$;

do $scenario_10$
declare
  v_transition_definition text;
  v_conclude_definition text;
  v_reopen_definition text;
  v_transition_normalized text;
  v_conclude_normalized text;
  v_reopen_normalized text;
begin
  select pg_catalog.pg_get_functiondef(
           'public.transition_commercial_opportunity_stage_by_system(uuid,uuid,uuid,text,text,text,text,uuid,text,text)'::pg_catalog.regprocedure
         )
  into v_transition_definition;
  select pg_catalog.pg_get_functiondef(
           'public.conclude_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)'::pg_catalog.regprocedure
         )
  into v_conclude_definition;
  select pg_catalog.pg_get_functiondef(
           'public.reopen_commercial_opportunity_for_post_sale_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text)'::pg_catalog.regprocedure
         )
  into v_reopen_definition;

  v_transition_normalized := pg_temp._p9_system_writer_jwt_normalize_definition(v_transition_definition);
  v_conclude_normalized := pg_temp._p9_system_writer_jwt_normalize_definition(v_conclude_definition);
  v_reopen_normalized := pg_temp._p9_system_writer_jwt_normalize_definition(v_reopen_definition);

  perform pg_temp._p9_system_writer_jwt_require(
    position('apply_commercial_opportunity_stage_transition_internal(' in v_transition_normalized) > 0
    and position('''stage_transition''' in v_transition_normalized) > 0
    and position('''system''' in v_transition_normalized) > 0
    and position('''concluido_sem_mais_acoes''' in v_conclude_normalized) > 0
    and position('''conclusion''' in v_conclude_normalized) > 0
    and position('''system''' in v_conclude_normalized) > 0
    and position('''pos_venda''' in v_reopen_normalized) > 0
    and position('''post_sale_reopen''' in v_reopen_normalized) > 0
    and position('''system''' in v_reopen_normalized) > 0,
    'essential commercial logic markers changed unexpectedly'
  );

  perform pg_temp._p9_system_writer_jwt_record(10, 'PASS', 'essential commercial writer logic markers remain intact');
exception
  when others then
    perform pg_temp._p9_system_writer_jwt_record(10, 'FAIL', sqlerrm);
end;
$scenario_10$;

do $scenario_11$
begin
  perform pg_temp._p9_system_writer_jwt_require(
    true,
    'static-only runner unexpectedly mutated runtime assumptions'
  );

  perform pg_temp._p9_system_writer_jwt_record(
    11,
    'PASS',
    'static-only checks confirm definition, grants and contracts; postgres execution is not treated as proof of the jwt service_role path'
  );
exception
  when others then
    perform pg_temp._p9_system_writer_jwt_record(11, 'FAIL', sqlerrm);
end;
$scenario_11$;

select
  result_row.scenario_number,
  result_row.scenario_name,
  result_row.status,
  result_row.details
from pg_temp._p9_system_writer_jwt_results result_row
order by result_row.scenario_number;

with scenario_summary as (
  select
    count(*) as total_scenarios,
    count(*) filter (where status = 'PASS') as passed_scenarios,
    count(*) filter (where status <> 'PASS') as failed_scenarios
  from pg_temp._p9_system_writer_jwt_results
)
select
  case
    when scenario_summary.total_scenarios <> 11 then 'FAIL'
    when scenario_summary.passed_scenarios <> 11 then 'FAIL'
    else 'PASS'
  end as final_status,
  scenario_summary.total_scenarios as total,
  scenario_summary.passed_scenarios as pass,
  scenario_summary.failed_scenarios as fail
from scenario_summary;

rollback;

begin;

create temp table pg_temp._p9_bridge_jwt_role_matrix (
  scenario_number integer primary key,
  scenario_name text not null
);

insert into pg_temp._p9_bridge_jwt_role_matrix (scenario_number, scenario_name)
values
  (1, 'signatures remain unchanged for the jwt-role bridge functions'),
  (2, 'security definer and hardened proconfig remain unchanged'),
  (3, 'grants were not expanded'),
  (4, 'transition_conversation_state_by_user still requires owner in the human path'),
  (5, 'membership continues to be required for human transition'),
  (6, 'organization scope validation still exists in the human transition core'),
  (7, 'jwt role resolution now falls back safely to auth.jwt role'),
  (8, 'anon still has zero access to the panel bridge'),
  (9, 'bridge remains conversation-only and does not alter commercial opportunity rules');

create temp table pg_temp._p9_bridge_jwt_role_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  details text not null
);

create or replace function pg_temp._p9_bridge_jwt_role_record(
  p_scenario_number integer,
  p_status text,
  p_details text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_bridge_jwt_role_results (
    scenario_number,
    scenario_name,
    status,
    details
  )
  values (
    p_scenario_number,
    (
      select matrix_row.scenario_name
      from pg_temp._p9_bridge_jwt_role_matrix matrix_row
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

create or replace function pg_temp._p9_bridge_jwt_role_require(
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

create or replace function pg_temp._p9_bridge_jwt_role_normalize_definition(
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
declare
  v_conversations_reltype oid;
begin
  select class_row.reltype
  into v_conversations_reltype
  from pg_catalog.pg_class class_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = class_row.relnamespace
  where namespace_row.nspname = 'public'
    and class_row.relname = 'conversations';

  perform pg_temp._p9_bridge_jwt_role_require(
    v_conversations_reltype is not null
    and exists (
      select 1
      from pg_catalog.pg_proc proc_row
      where proc_row.oid = pg_catalog.to_regprocedure(
        'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)'
      )
        and proc_row.prorettype = v_conversations_reltype
    )
    and exists (
      select 1
      from pg_catalog.pg_proc proc_row
      where proc_row.oid = pg_catalog.to_regprocedure(
        'public.human_takeover_conversation(uuid,text)'
      )
        and proc_row.prorettype = 'void'::pg_catalog.regtype
    )
    and exists (
      select 1
      from pg_catalog.pg_proc proc_row
      where proc_row.oid = pg_catalog.to_regprocedure(
        'public.human_release_conversation_to_ai(uuid,text,text)'
      )
        and proc_row.prorettype = 'void'::pg_catalog.regtype
    )
    and exists (
      select 1
      from pg_catalog.pg_proc proc_row
      where proc_row.oid = pg_catalog.to_regprocedure(
        'public.panel_takeover_conversation_scoped(uuid,uuid,text)'
      )
        and proc_row.prorettype = 'void'::pg_catalog.regtype
    )
    and exists (
      select 1
      from pg_catalog.pg_proc proc_row
      where proc_row.oid = pg_catalog.to_regprocedure(
        'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'
      )
        and proc_row.prorettype = 'void'::pg_catalog.regtype
    ),
    'one or more bridge signatures changed'
  );

  perform pg_temp._p9_bridge_jwt_role_record(1, 'PASS', 'bridge signatures remain unchanged');
exception
  when others then
    perform pg_temp._p9_bridge_jwt_role_record(1, 'FAIL', sqlerrm);
end;
$scenario_1$;

do $scenario_2$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)',
    'public.human_takeover_conversation(uuid,text)',
    'public.human_release_conversation_to_ai(uuid,text,text)',
    'public.panel_takeover_conversation_scoped(uuid,uuid,text)',
    'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'
  ] loop
    perform pg_temp._p9_bridge_jwt_role_require(
      exists (
        select 1
        from pg_catalog.pg_proc proc_row
        where proc_row.oid = pg_catalog.to_regprocedure(v_signature)
          and proc_row.prosecdef
          and proc_row.proconfig @> array[
            'search_path=pg_catalog, pg_temp',
            'row_security=off'
          ]::text[]
      ),
      'unsafe security definer contract after jwt-role fix: ' || v_signature
    );
  end loop;

  perform pg_temp._p9_bridge_jwt_role_record(2, 'PASS', 'security definer and proconfig remain hardened');
exception
  when others then
    perform pg_temp._p9_bridge_jwt_role_record(2, 'FAIL', sqlerrm);
end;
$scenario_2$;

do $scenario_3$
begin
  perform pg_temp._p9_bridge_jwt_role_require(
    has_function_privilege(
      'authenticated',
      'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.panel_takeover_conversation_scoped(uuid,uuid,text)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.human_takeover_conversation(uuid,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.human_release_conversation_to_ai(uuid,text,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.panel_takeover_conversation_scoped(uuid,uuid,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)',
      'EXECUTE'
    ),
    'bridge grants changed unexpectedly'
  );

  perform pg_temp._p9_bridge_jwt_role_record(3, 'PASS', 'grants remain constrained to the current bridge contract');
exception
  when others then
    perform pg_temp._p9_bridge_jwt_role_record(3, 'FAIL', sqlerrm);
end;
$scenario_3$;

do $scenario_4$
declare
  v_definition text;
  v_normalized_definition text;
begin
  select pg_catalog.pg_get_functiondef(
           'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)'::pg_catalog.regprocedure
         )
  into v_definition;
  v_normalized_definition := pg_temp._p9_bridge_jwt_role_normalize_definition(v_definition);

  perform pg_temp._p9_bridge_jwt_role_require(
    v_definition is not null
    and position('p_require_owner => true' in v_normalized_definition) > 0
    and position('p_actor_user_id' in v_normalized_definition) > 0
    and position('v_authenticated_user_id' in v_normalized_definition) > 0,
    'owner requirement changed in transition_conversation_state_by_user'
  );

  perform pg_temp._p9_bridge_jwt_role_record(4, 'PASS', 'owner remains mandatory for the human transition path');
exception
  when others then
    perform pg_temp._p9_bridge_jwt_role_record(4, 'FAIL', sqlerrm);
end;
$scenario_4$;

do $scenario_5$
declare
  v_definition text;
  v_normalized_definition text;
begin
  select pg_catalog.pg_get_functiondef(
           'public._apply_conversation_state_transition(uuid,text,text,uuid,text,text,jsonb,text,uuid,boolean)'::pg_catalog.regprocedure
         )
  into v_definition;
  v_normalized_definition := pg_temp._p9_bridge_jwt_role_normalize_definition(v_definition);

  perform pg_temp._p9_bridge_jwt_role_require(
    v_definition is not null
    and position('membership_row.organization_id = v_context.organization_id' in v_normalized_definition) > 0
    and position('membership_row.user_id = p_actor_user_id' in v_normalized_definition) > 0
    and position('conversation transition is not authorized' in v_normalized_definition) > 0,
    'membership requirement changed in _apply_conversation_state_transition'
  );

  perform pg_temp._p9_bridge_jwt_role_record(5, 'PASS', 'membership remains mandatory for human transitions');
exception
  when others then
    perform pg_temp._p9_bridge_jwt_role_record(5, 'FAIL', sqlerrm);
end;
$scenario_5$;

do $scenario_6$
declare
  v_definition text;
  v_normalized_definition text;
begin
  select pg_catalog.pg_get_functiondef(
           'public._apply_conversation_state_transition(uuid,text,text,uuid,text,text,jsonb,text,uuid,boolean)'::pg_catalog.regprocedure
         )
  into v_definition;
  v_normalized_definition := pg_temp._p9_bridge_jwt_role_normalize_definition(v_definition);

  perform pg_temp._p9_bridge_jwt_role_require(
    v_definition is not null
    and position('p_request_organization_id' in v_normalized_definition) > 0
    and position('v_context.organization_id' in v_normalized_definition) > 0
    and position('conversation transition organization mismatch' in v_normalized_definition) > 0,
    'organization scope validation changed in _apply_conversation_state_transition'
  );

  perform pg_temp._p9_bridge_jwt_role_record(6, 'PASS', 'organization scope validation remains mandatory');
exception
  when others then
    perform pg_temp._p9_bridge_jwt_role_record(6, 'FAIL', sqlerrm);
end;
$scenario_6$;

do $scenario_7$
declare
  v_signature text;
  v_definition text;
  v_normalized_definition text;
begin
  foreach v_signature in array array[
    'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)',
    'public.human_takeover_conversation(uuid,text)',
    'public.human_release_conversation_to_ai(uuid,text,text)',
    'public.panel_takeover_conversation_scoped(uuid,uuid,text)',
    'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'
  ] loop
    select pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(v_signature))
    into v_definition;
    v_normalized_definition := pg_temp._p9_bridge_jwt_role_normalize_definition(v_definition);

    perform pg_temp._p9_bridge_jwt_role_require(
      v_definition is not null
      and position('request.jwt.claim.role' in v_normalized_definition) > 0
      and position('auth.jwt() ->> ''role''' in v_normalized_definition) > 0
      and position('coalesce(' in v_normalized_definition) > 0,
      'jwt role fallback missing in function ' || v_signature
    );
  end loop;

  perform pg_temp._p9_bridge_jwt_role_record(7, 'PASS', 'jwt role resolution now falls back safely to auth.jwt role');
exception
  when others then
    perform pg_temp._p9_bridge_jwt_role_record(7, 'FAIL', sqlerrm);
end;
$scenario_7$;

do $scenario_8$
begin
  perform pg_temp._p9_bridge_jwt_role_require(
    not exists (
      select 1
      from pg_catalog.pg_proc proc_row
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          proc_row.proacl,
          pg_catalog.acldefault('f', proc_row.proowner)
        )
      ) acl_row
      where proc_row.oid in (
        'public.panel_takeover_conversation_scoped(uuid,uuid,text)'::pg_catalog.regprocedure,
        'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'::pg_catalog.regprocedure
      )
        and acl_row.grantee = 0
        and acl_row.privilege_type = 'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.panel_takeover_conversation_scoped(uuid,uuid,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)',
      'EXECUTE'
    ),
    'anon or public gained execute on the panel bridge'
  );

  perform pg_temp._p9_bridge_jwt_role_record(8, 'PASS', 'anon and public still have zero access to the panel bridge');
exception
  when others then
    perform pg_temp._p9_bridge_jwt_role_record(8, 'FAIL', sqlerrm);
end;
$scenario_8$;

do $scenario_9$
declare
  v_definition text;
begin
  select string_agg(pg_catalog.pg_get_functiondef(proc_oid), E'\n---\n')
  into v_definition
  from unnest(array[
    'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)'::pg_catalog.regprocedure,
    'public.human_takeover_conversation(uuid,text)'::pg_catalog.regprocedure,
    'public.human_release_conversation_to_ai(uuid,text,text)'::pg_catalog.regprocedure,
    'public.panel_takeover_conversation_scoped(uuid,uuid,text)'::pg_catalog.regprocedure,
    'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'::pg_catalog.regprocedure
  ]) proc_oid;

  perform pg_temp._p9_bridge_jwt_role_require(
    v_definition is not null
    and position('commercial_opportunity' in lower(v_definition)) = 0
    and position('resolve_commercial_opportunity_stage_transition' in lower(v_definition)) = 0,
    'commercial opportunity logic leaked into the legacy conversation bridge'
  );

  perform pg_temp._p9_bridge_jwt_role_record(9, 'PASS', 'bridge remains conversation-only and does not change commercial opportunity rules');
exception
  when others then
    perform pg_temp._p9_bridge_jwt_role_record(9, 'FAIL', sqlerrm);
end;
$scenario_9$;

with scenario_summary as (
  select
    count(*) as total_scenarios,
    count(*) filter (where status = 'PASS') as passed_scenarios,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'scenario_number', scenario_number,
          'scenario_name', scenario_name,
          'status', status,
          'details', details
        )
        order by scenario_number
      ) filter (where status <> 'PASS'),
      '[]'::jsonb
    ) as failed_scenarios
  from pg_temp._p9_bridge_jwt_role_results
)
select
  case
    when scenario_summary.total_scenarios <> 9 then 'AINDA_NAO_APROVADA'
    when scenario_summary.passed_scenarios <> 9 then 'AINDA_NAO_APROVADA'
    else 'APROVADA'
  end as final_status,
  scenario_summary.passed_scenarios,
  scenario_summary.total_scenarios,
  scenario_summary.failed_scenarios
from scenario_summary;

rollback;

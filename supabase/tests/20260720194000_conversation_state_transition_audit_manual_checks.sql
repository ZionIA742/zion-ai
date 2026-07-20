-- ZION / Pilar 9 / Fase 4 / 4.1B-3
-- Runner manual da correcao estrutural de transicao de estado e auditoria.
--
-- Regras:
-- - executar o arquivo inteiro uma unica vez no SQL Editor do Supabase;
-- - nao aplica migration nem faz db push;
-- - cria apenas conversations temporarias e logs associados ao proprio run_id;
-- - remove todas as fixtures antes do COMMIT;
-- - qualquer falha de cleanup aborta a transacao inteira.

begin;

set local lock_timeout = '3s';
set local statement_timeout = '240s';
set local idle_in_transaction_session_timeout = '240s';
set local search_path = pg_catalog, pg_temp, public, extensions;

drop table if exists pg_temp._p9_cst_results;
drop table if exists pg_temp._p9_cst_context;
drop table if exists pg_temp._p9_cst_state;

create temp table _p9_cst_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (
    status in (
      'PASS',
      'SUT_FAIL',
      'HARNESS_ERROR',
      'BLOCKED'
    )
  ),
  detail text not null
) on commit preserve rows;

create temp table _p9_cst_context (
  singleton boolean primary key default true check (singleton),
  run_id uuid not null,
  organization_id uuid null,
  store_id uuid null,
  owner_user_id uuid null,
  foreign_user_id uuid null,
  lead_id uuid null,
  conversation_id uuid null,
  second_conversation_id uuid null
) on commit preserve rows;

create temp table _p9_cst_state (
  state_key text primary key,
  value_uuid uuid null,
  value_text text null
) on commit preserve rows;

insert into _p9_cst_context(run_id) values (gen_random_uuid());

create or replace function pg_temp._p9_cst_exec_scalar(
  p_role text,
  p_user_id uuid,
  p_sql text
)
returns table (
  operation_succeeded boolean,
  value_text text,
  returned_sqlstate text,
  message_text text
)
language plpgsql
as $function$
declare
  v_value text;
  v_state text;
  v_message text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    case
      when p_user_id is null then json_build_object('role', p_role)::text
      else json_build_object('sub', p_user_id::text, 'role', p_role)::text
    end,
    true
  );

  execute format('set local role %I', p_role);

  begin
    execute p_sql into v_value;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    return query select true, v_value, null::text, null::text;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text;
      begin execute 'reset role'; exception when others then null; end;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.role', '', true);
      perform set_config('request.jwt.claims', '', true);
      return query select false, null::text, v_state, v_message;
  end;
end;
$function$;

revoke all on function pg_temp._p9_cst_exec_scalar(text, uuid, text) from public;

create or replace function pg_temp._p9_cst_public_execute_absent(
  p_function regprocedure
)
returns boolean
language sql
as $function$
  select not exists (
    select 1
    from pg_catalog.pg_proc procedure_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) privilege_row
    where procedure_row.oid = p_function
      and privilege_row.grantee = 0
      and privilege_row.privilege_type = 'EXECUTE'
  )
$function$;

revoke all on function pg_temp._p9_cst_public_execute_absent(regprocedure) from public;

do $setup$
declare
  v_org uuid;
  v_store uuid;
  v_owner uuid;
  v_foreign uuid;
  v_lead uuid;
  v_conversation uuid := gen_random_uuid();
  v_second_conversation uuid := gen_random_uuid();
begin
  select m.organization_id, l.store_id, m.user_id, l.id
  into v_org, v_store, v_owner, v_lead
  from public.memberships m
  join public.leads l
    on l.organization_id = m.organization_id
   and l.store_id is not null
  join public.stores s
    on s.id = l.store_id
   and s.organization_id = l.organization_id
  where m.user_id is not null
    and lower(coalesce(m.role, '')) = 'owner'
  order by m.created_at nulls first, l.created_at nulls first
  limit 1;

  select m.user_id
  into v_foreign
  from public.memberships m
  where m.user_id is not null
    and m.organization_id is distinct from v_org
  order by m.created_at nulls first
  limit 1;

  if v_org is null or v_store is null or v_owner is null or v_lead is null then
    raise exception using
      errcode = 'P0001',
      message = 'runner setup failed: no owner membership with canonical lead/store was found';
  end if;

  insert into public.conversations (
    id, organization_id, lead_id, status,
    is_human_active, last_status_reason, last_status_metadata
  ) values
    (v_conversation, v_org, v_lead, 'novo_lead', false, null, '{}'::jsonb),
    (v_second_conversation, v_org, v_lead, 'qualificacao', false, null, '{}'::jsonb);

  update pg_temp._p9_cst_context
  set organization_id = v_org,
      store_id = v_store,
      owner_user_id = v_owner,
      foreign_user_id = v_foreign,
      lead_id = v_lead,
      conversation_id = v_conversation,
      second_conversation_id = v_second_conversation;
end;
$setup$;

do $scenario_1$
declare
  v_ok boolean;
begin
  select
    to_regprocedure('public.panel_transition_conversation_state_scoped(uuid,uuid,text,text)') is not null
    and to_regprocedure('public.panel_takeover_conversation_scoped(uuid,uuid,text)') is not null
    and to_regprocedure('public.panel_release_conversation_to_ai_scoped(uuid,uuid,text)') is not null
    and to_regprocedure('public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)') is not null
    and to_regprocedure('public.transition_conversation_state(uuid,text,text)') is not null
    and to_regprocedure('public.transition_conversation_state_internal(uuid,text,text,text,text,text,jsonb)') is not null
    and to_regprocedure('public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)') is not null
    and to_regprocedure('public.log_state_transition(uuid,text,text,text,uuid,text,text,jsonb,text,uuid,uuid)') is not null
    and to_regprocedure('public.process_sla_violations()') is not null
    and to_regprocedure('public.process_stale_human_conversations()') is not null
    and to_regprocedure('public.archive_state_transition_log(interval)') is not null
    and to_regprocedure('public.panel_get_conversation_state_history_scoped(uuid,uuid)') is not null
    and to_regprocedure('public.trg_log_conversation_status_change()') is not null
  into v_ok;

  insert into pg_temp._p9_cst_results values
    (1, 'objetos canonicos presentes',
     case when v_ok then 'PASS' else 'SUT_FAIL' end,
     case when v_ok then 'all required functions are present' else 'one or more required functions are missing' end);
end;
$scenario_1$;

do $scenario_2$
declare
  v_result record;
begin
  select * into v_result
  from pg_temp._p9_cst_exec_scalar(
    'anon', null,
    format(
      'select (public.panel_transition_conversation_state_scoped(%L,%L,%L,%L)).id::text',
      (select organization_id from pg_temp._p9_cst_context),
      (select conversation_id from pg_temp._p9_cst_context),
      'qualificacao',
      'anon_probe'
    )
  );

  insert into pg_temp._p9_cst_results values
    (2, 'anon sem EXECUTE no painel',
     case when not v_result.operation_succeeded and v_result.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end,
     coalesce(v_result.message_text, '<no message>'));
end;
$scenario_2$;

do $scenario_3$
declare
  v_result record;
begin
  select * into v_result
  from pg_temp._p9_cst_exec_scalar(
    'authenticated',
    (select foreign_user_id from pg_temp._p9_cst_context),
    format(
      'select (public.panel_transition_conversation_state_scoped(%L,%L,%L,%L)).id::text',
      (select organization_id from pg_temp._p9_cst_context),
      (select conversation_id from pg_temp._p9_cst_context),
      'qualificacao',
      'foreign_org_probe'
    )
  );

  insert into pg_temp._p9_cst_results values
    (3, 'authenticated de outra organizacao negado',
     case when not v_result.operation_succeeded and v_result.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end,
     coalesce(v_result.message_text, '<no message>'));
end;
$scenario_3$;

do $scenario_4$
declare
  v_result record;
begin
  select * into v_result
  from pg_temp._p9_cst_exec_scalar(
    'service_role', null,
    format(
      'select (public.transition_conversation_state_by_user(%L,%L,null,%L,%L,%L,null,%L::jsonb)).id::text',
      (select conversation_id from pg_temp._p9_cst_context),
      'qualificacao',
      'missing_human_user',
      'quote_pdf_generation',
      (select organization_id from pg_temp._p9_cst_context),
      '{}' 
    )
  );

  insert into pg_temp._p9_cst_results values
    (4, 'human sem actor_user_id falha',
     case when not v_result.operation_succeeded and v_result.returned_sqlstate = '22023' then 'PASS' else 'SUT_FAIL' end,
     coalesce(v_result.message_text, '<no message>'));
end;
$scenario_4$;

do $scenario_5$
declare
  v_result record;
begin
  select * into v_result
  from pg_temp._p9_cst_exec_scalar(
    'service_role', null,
    format(
      'select (public.log_state_transition(%L,%L,%L,%L,%L,%L,%L,%L::jsonb,%L,%L,%L)).id::text',
      (select conversation_id from pg_temp._p9_cst_context),
      'novo_lead',
      'qualificacao',
      'ai',
      (select owner_user_id from pg_temp._p9_cst_context),
      'bad_actor_probe',
      'manual_probe',
      '{}',
      'runner:event:bad-actor',
      (select organization_id from pg_temp._p9_cst_context),
      (select store_id from pg_temp._p9_cst_context)
    )
  );

  insert into pg_temp._p9_cst_results values
    (5, 'ai/system com actor_user_id indevido falha',
     case when not v_result.operation_succeeded and v_result.returned_sqlstate = '22023' then 'PASS' else 'SUT_FAIL' end,
     coalesce(v_result.message_text, '<no message>'));
end;
$scenario_5$;

do $scenario_6$
declare
  v_result record;
begin
  select * into v_result
  from pg_temp._p9_cst_exec_scalar(
    'authenticated',
    (select owner_user_id from pg_temp._p9_cst_context),
    format(
      'select (public.panel_transition_conversation_state_scoped(%L,%L,%L,%L)).status',
      gen_random_uuid(),
      (select conversation_id from pg_temp._p9_cst_context),
      'qualificacao',
      'wrong_org_probe'
    )
  );

  insert into pg_temp._p9_cst_results values
    (6, 'organizacao errada falha',
     case when not v_result.operation_succeeded and v_result.returned_sqlstate = '23514' then 'PASS' else 'SUT_FAIL' end,
     coalesce(v_result.message_text, '<no message>'));
end;
$scenario_6$;

do $scenario_7$
declare
  v_result record;
  v_actor uuid;
  v_reason text;
begin
  select * into v_result
  from pg_temp._p9_cst_exec_scalar(
    'authenticated',
    (select owner_user_id from pg_temp._p9_cst_context),
    format(
      'select (public.panel_transition_conversation_state_scoped(%L,%L,%L,%L)).status',
      (select organization_id from pg_temp._p9_cst_context),
      (select conversation_id from pg_temp._p9_cst_context),
      'qualificacao',
      'manual_move_from_crm'
    )
  );

  select last_status_actor_user_id, last_status_reason
  into v_actor, v_reason
  from public.conversations
  where id = (select conversation_id from pg_temp._p9_cst_context);

  insert into pg_temp._p9_cst_results values
    (7, 'transicao humana preserva usuario e motivo',
     case when v_result.operation_succeeded
               and v_result.value_text = 'qualificacao'
               and v_actor = (select owner_user_id from pg_temp._p9_cst_context)
               and v_reason = 'manual_move_from_crm'
          then 'PASS' else 'SUT_FAIL' end,
     format('status=%s | actor=%s | reason=%s',
       coalesce(v_result.value_text, '<null>'),
       coalesce(v_actor::text, '<null>'),
       coalesce(v_reason, '<null>')));
end;
$scenario_7$;

do $scenario_8$
declare
  v_result record;
begin
  select * into v_result
  from pg_temp._p9_cst_exec_scalar(
    'authenticated',
    (select owner_user_id from pg_temp._p9_cst_context),
    format(
      'select (public.panel_takeover_conversation_scoped(%L,%L,%L)).status',
      (select organization_id from pg_temp._p9_cst_context),
      (select conversation_id from pg_temp._p9_cst_context),
      'manual_takeover_from_crm'
    )
  );

  insert into pg_temp._p9_cst_results values
    (8, 'takeover continua funcionando',
     case when v_result.operation_succeeded and v_result.value_text = 'humano_assumiu' then 'PASS' else 'SUT_FAIL' end,
     coalesce(v_result.value_text, '<null>'));
end;
$scenario_8$;

do $scenario_9$
declare
  v_result record;
  v_status text;
  v_actor uuid;
  v_reason text;
begin
  select * into v_result
  from pg_temp._p9_cst_exec_scalar(
    'authenticated',
    (select owner_user_id from pg_temp._p9_cst_context),
    format(
      'select (public.panel_release_conversation_to_ai_scoped(%L,%L,%L)).status',
      (select organization_id from pg_temp._p9_cst_context),
      (select conversation_id from pg_temp._p9_cst_context),
      'manual_release_from_crm'
    )
  );

  select status, last_status_actor_user_id, last_status_reason
  into v_status, v_actor, v_reason
  from public.conversations
  where id = (select conversation_id from pg_temp._p9_cst_context);

  insert into pg_temp._p9_cst_results values
    (9, 'release continua funcionando e preserva autoria',
     case when v_result.operation_succeeded
               and v_status = 'qualificacao'
               and v_actor = (select owner_user_id from pg_temp._p9_cst_context)
               and v_reason = 'manual_release_from_crm'
          then 'PASS' else 'SUT_FAIL' end,
     format('status=%s | actor=%s | reason=%s',
       coalesce(v_status, '<null>'),
       coalesce(v_actor::text, '<null>'),
       coalesce(v_reason, '<null>')));
end;
$scenario_9$;

do $scenario_10$
declare
  v_result record;
  v_event_key text;
  v_log_count integer;
  v_actor_type text;
  v_reason text;
begin
  select * into v_result
  from pg_temp._p9_cst_exec_scalar(
    'service_role', null,
    format(
      $sql$
      select (public.transition_conversation_state_internal(
        %L, %L, %L, %L, %L, null, %L::jsonb
      )).status
      $sql$,
      (select second_conversation_id from pg_temp._p9_cst_context),
      'orcamento',
      'auto_progress_from_ai_sales_quote_request',
      'ai',
      'ai_sales_auto_progress',
      '{"runner":true,"scenario":10}'
    )
  );

  select event_key, actor_type, reason
  into v_event_key, v_actor_type, v_reason
  from public.state_transition_log
  where conversation_id = (select second_conversation_id from pg_temp._p9_cst_context)
    and to_state = 'orcamento'
  order by created_at desc, id desc
  limit 1;

  select count(*)
  into v_log_count
  from public.state_transition_log
  where conversation_id = (select second_conversation_id from pg_temp._p9_cst_context)
    and to_state = 'orcamento';

  insert into pg_temp._p9_cst_results values
    (10, 'sem event_key explicita gera chave por ocorrencia',
     case when v_result.operation_succeeded
               and v_result.value_text = 'orcamento'
               and v_event_key is not null
               and v_log_count = 1
               and v_actor_type = 'ai'
               and v_reason = 'auto_progress_from_ai_sales_quote_request'
          then 'PASS' else 'SUT_FAIL' end,
     format('status=%s | event_key=%s | logs=%s | actor_type=%s | reason=%s',
       coalesce(v_result.value_text, '<null>'),
       coalesce(v_event_key, '<null>'),
       v_log_count,
       coalesce(v_actor_type, '<null>'),
       coalesce(v_reason, '<null>')));
end;
$scenario_10$;

do $scenario_11$
declare
  v_first record;
  v_second record;
begin
  select * into v_first
  from pg_temp._p9_cst_exec_scalar(
    'service_role', null,
    format(
      $sql$
      select (public.transition_conversation_state_internal(
        %L, %L, %L, %L, %L, %L, %L::jsonb
      )).status
      $sql$,
      (select second_conversation_id from pg_temp._p9_cst_context),
      'negociacao',
      'auto_progress_from_ai_sales_negotiation_signal',
      'ai',
      'ai_sales_auto_progress',
      'runner:event:ai-negociacao',
      '{"runner":true,"scenario":11}'
    )
  );

  select * into v_second
  from pg_temp._p9_cst_exec_scalar(
    'service_role', null,
    format(
      $sql$
      select (public.transition_conversation_state_internal(
        %L, %L, %L, %L, %L, %L, %L::jsonb
      )).status
      $sql$,
      (select second_conversation_id from pg_temp._p9_cst_context),
      'negociacao',
      'auto_progress_from_ai_sales_negotiation_signal',
      'ai',
      'ai_sales_auto_progress',
      'runner:event:ai-negociacao',
      '{"runner":true,"scenario":11,"retry":true}'
    )
  );

  insert into pg_temp._p9_cst_results values
    (11, 'evento idempotente explicito nao duplica',
     case when v_first.operation_succeeded
               and v_second.operation_succeeded
               and (select count(*) from public.state_transition_log where event_key = 'runner:event:ai-negociacao') = 1
          then 'PASS' else 'SUT_FAIL' end,
     format('first=%s | second=%s | count=%s',
       coalesce(v_first.value_text, '<null>'),
       coalesce(v_second.value_text, '<null>'),
       (select count(*) from public.state_transition_log where event_key = 'runner:event:ai-negociacao')));
end;
$scenario_11$;

do $scenario_12$
declare
  v_conversation uuid := gen_random_uuid();
  v_first record;
  v_middle record;
  v_second record;
  v_orcamento_count integer;
  v_distinct_event_keys integer;
begin
  insert into public.conversations (
    id, organization_id, lead_id, status,
    is_human_active, last_status_reason, last_status_metadata
  ) values (
    v_conversation,
    (select organization_id from pg_temp._p9_cst_context),
    (select lead_id from pg_temp._p9_cst_context),
    'qualificacao',
    false,
    null,
    '{}'::jsonb
  );

  insert into pg_temp._p9_cst_state(state_key, value_uuid)
  values ('scenario_12_conversation_id', v_conversation)
  on conflict (state_key) do update set value_uuid = excluded.value_uuid;

  select * into v_first
  from pg_temp._p9_cst_exec_scalar(
    'service_role', null,
    format(
      $sql$
      select (public.transition_conversation_state_internal(
        %L, %L, %L, %L, %L, null, %L::jsonb
      )).status
      $sql$,
      v_conversation,
      'orcamento',
      'auto_progress_from_ai_sales_quote_request',
      'ai',
      'ai_sales_auto_progress',
      '{"runner":true,"scenario":12}'
    )
  );

  select * into v_middle
  from pg_temp._p9_cst_exec_scalar(
    'service_role', null,
    format(
      $sql$
      select (public.transition_conversation_state_internal(
        %L, %L, %L, %L, %L, null, %L::jsonb
      )).status
      $sql$,
      v_conversation,
      'negociacao',
      'auto_progress_from_ai_sales_negotiation_signal',
      'ai',
      'ai_sales_auto_progress',
      '{"runner":true,"scenario":12,"step":"middle"}'
    )
  );

  select * into v_second
  from pg_temp._p9_cst_exec_scalar(
    'service_role', null,
    format(
      $sql$
      select (public.transition_conversation_state_internal(
        %L, %L, %L, %L, %L, null, %L::jsonb
      )).status
      $sql$,
      v_conversation,
      'orcamento',
      'auto_progress_from_ai_sales_quote_request',
      'ai',
      'ai_sales_auto_progress',
      '{"runner":true,"scenario":12,"step":"final"}'
    )
  );

  select count(*), count(distinct event_key)
  into v_orcamento_count, v_distinct_event_keys
  from public.state_transition_log
  where conversation_id = v_conversation
    and to_state = 'orcamento';

  insert into pg_temp._p9_cst_results values
    (12, 'duas transicoes legitimas iguais em momentos diferentes passam',
     case when v_first.operation_succeeded
               and v_middle.operation_succeeded
               and v_second.operation_succeeded
               and v_orcamento_count = 2
               and v_distinct_event_keys = 2
          then 'PASS' else 'SUT_FAIL' end,
     format('first=%s | middle=%s | second=%s | orcamento_logs=%s | distinct_event_keys=%s',
       coalesce(v_first.value_text, '<null>'),
       coalesce(v_middle.value_text, '<null>'),
       coalesce(v_second.value_text, '<null>'),
       v_orcamento_count,
       v_distinct_event_keys));
end;
$scenario_12$;

do $scenario_13$
declare
  v_result record;
begin
  select * into v_result
  from pg_temp._p9_cst_exec_scalar(
    'service_role', null,
    format(
      'select (public.log_state_transition(%L,%L,%L,%L,%L,%L,%L,%L::jsonb,%L,%L,%L)).id::text',
      (select second_conversation_id from pg_temp._p9_cst_context),
      'orcamento',
      'negociacao',
      'system',
      null,
      'wrong_store_probe',
      'sla_runtime',
      '{}',
      'runner:event:wrong-store',
      (select organization_id from pg_temp._p9_cst_context),
      gen_random_uuid()
    )
  );

  insert into pg_temp._p9_cst_results values
    (13, 'loja errada falha',
     case when not v_result.operation_succeeded and v_result.returned_sqlstate = '23514' then 'PASS' else 'SUT_FAIL' end,
     coalesce(v_result.message_text, '<no message>'));
end;
$scenario_13$;

do $scenario_14$
declare
  v_count integer;
begin
  insert into public.state_transition_log (
    organization_id, store_id, conversation_id, from_state, to_state,
    actor_type, actor_user_id, reason, source, metadata, event_key
  ) values (
    gen_random_uuid(),
    gen_random_uuid(),
    (select second_conversation_id from pg_temp._p9_cst_context),
    'negociacao',
    'fechamento_pagamento',
    'system',
    null,
    'canonical_scope_trigger_probe',
    'manual_probe',
    '{}'::jsonb,
    'runner:event:canonical-scope'
  );

  select count(*)
  into v_count
  from public.state_transition_log
  where event_key = 'runner:event:canonical-scope'
    and organization_id = (select organization_id from pg_temp._p9_cst_context)
    and store_id = (select store_id from pg_temp._p9_cst_context);

  insert into pg_temp._p9_cst_results values
    (14, 'trigger corrige tenant pelo caminho canonico',
     case when v_count = 1 then 'PASS' else 'SUT_FAIL' end,
     'matching_rows=' || v_count);
end;
$scenario_14$;

do $scenario_15$
declare
  v_result record;
begin
  select * into v_result
  from pg_temp._p9_cst_exec_scalar(
    'authenticated',
    (select owner_user_id from pg_temp._p9_cst_context),
    format(
      'select count(*)::text from public.panel_get_conversation_state_history_scoped(%L,%L)',
      (select organization_id from pg_temp._p9_cst_context),
      (select conversation_id from pg_temp._p9_cst_context)
    )
  );

  insert into pg_temp._p9_cst_results values
    (15, 'historico scoped autorizado para owner',
     case when v_result.operation_succeeded and v_result.value_text::integer >= 1 then 'PASS' else 'SUT_FAIL' end,
     coalesce(v_result.value_text, '<null>'));
end;
$scenario_15$;

do $scenario_16$
declare
  v_result record;
begin
  select * into v_result
  from pg_temp._p9_cst_exec_scalar(
    'authenticated',
    (select foreign_user_id from pg_temp._p9_cst_context),
    format(
      'select count(*)::text from public.panel_get_conversation_state_history_scoped(%L,%L)',
      (select organization_id from pg_temp._p9_cst_context),
      (select conversation_id from pg_temp._p9_cst_context)
    )
  );

  insert into pg_temp._p9_cst_results values
    (16, 'historico scoped negado para outra organizacao',
     case when not v_result.operation_succeeded and v_result.returned_sqlstate = '42501' then 'PASS' else 'SUT_FAIL' end,
     coalesce(v_result.message_text, '<no message>'));
end;
$scenario_16$;

do $scenario_17$
declare
  v_ok boolean;
begin
  select
    pg_temp._p9_cst_public_execute_absent('public.panel_transition_conversation_state_scoped(uuid,uuid,text,text)'::regprocedure)
    and not has_function_privilege('anon', 'public.panel_transition_conversation_state_scoped(uuid,uuid,text,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.panel_transition_conversation_state_scoped(uuid,uuid,text,text)', 'EXECUTE')
    and pg_temp._p9_cst_public_execute_absent('public.panel_takeover_conversation_scoped(uuid,uuid,text)'::regprocedure)
    and not has_function_privilege('anon', 'public.panel_takeover_conversation_scoped(uuid,uuid,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.panel_takeover_conversation_scoped(uuid,uuid,text)', 'EXECUTE')
    and pg_temp._p9_cst_public_execute_absent('public.panel_release_conversation_to_ai_scoped(uuid,uuid,text)'::regprocedure)
    and not has_function_privilege('anon', 'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text)', 'EXECUTE')
    and pg_temp._p9_cst_public_execute_absent('public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'::regprocedure)
    and not has_function_privilege('anon', 'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)', 'EXECUTE')
    and pg_temp._p9_cst_public_execute_absent('public.panel_get_conversation_state_history_scoped(uuid,uuid)'::regprocedure)
    and not has_function_privilege('anon', 'public.panel_get_conversation_state_history_scoped(uuid,uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.panel_get_conversation_state_history_scoped(uuid,uuid)', 'EXECUTE')
    and pg_temp._p9_cst_public_execute_absent('public.human_takeover_conversation(uuid,text)'::regprocedure)
    and not has_function_privilege('anon', 'public.human_takeover_conversation(uuid,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.human_takeover_conversation(uuid,text)', 'EXECUTE')
    and pg_temp._p9_cst_public_execute_absent('public.human_release_conversation_to_ai(uuid,text,text)'::regprocedure)
    and not has_function_privilege('anon', 'public.human_release_conversation_to_ai(uuid,text,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.human_release_conversation_to_ai(uuid,text,text)', 'EXECUTE')
    and
    pg_temp._p9_cst_public_execute_absent('public.update_conversation_state(uuid,text)'::regprocedure)
    and not has_function_privilege('anon', 'public.update_conversation_state(uuid,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.update_conversation_state(uuid,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.update_conversation_state(uuid,text)', 'EXECUTE')
    and pg_temp._p9_cst_public_execute_absent('public.update_conversation_state(uuid,text,text)'::regprocedure)
    and not has_function_privilege('anon', 'public.update_conversation_state(uuid,text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.update_conversation_state(uuid,text,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.update_conversation_state(uuid,text,text)', 'EXECUTE')
    and pg_temp._p9_cst_public_execute_absent('public.transition_conversation_state(uuid,text,text)'::regprocedure)
    and not has_function_privilege('anon', 'public.transition_conversation_state(uuid,text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.transition_conversation_state(uuid,text,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.transition_conversation_state(uuid,text,text)', 'EXECUTE')
    and pg_temp._p9_cst_public_execute_absent('public.transition_conversation_state_internal(uuid,text,text,text,text,text,jsonb)'::regprocedure)
    and not has_function_privilege('anon', 'public.transition_conversation_state_internal(uuid,text,text,text,text,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.transition_conversation_state_internal(uuid,text,text,text,text,text,jsonb)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.transition_conversation_state_internal(uuid,text,text,text,text,text,jsonb)', 'EXECUTE')
    and pg_temp._p9_cst_public_execute_absent('public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)'::regprocedure)
    and not has_function_privilege('anon', 'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)', 'EXECUTE')
    and pg_temp._p9_cst_public_execute_absent('public.process_sla_violations()'::regprocedure)
    and not has_function_privilege('anon', 'public.process_sla_violations()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.process_sla_violations()', 'EXECUTE')
    and has_function_privilege('service_role', 'public.process_sla_violations()', 'EXECUTE')
    and pg_temp._p9_cst_public_execute_absent('public.process_stale_human_conversations()'::regprocedure)
    and not has_function_privilege('anon', 'public.process_stale_human_conversations()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.process_stale_human_conversations()', 'EXECUTE')
    and has_function_privilege('service_role', 'public.process_stale_human_conversations()', 'EXECUTE')
    and pg_temp._p9_cst_public_execute_absent('public.archive_state_transition_log(interval)'::regprocedure)
    and not has_function_privilege('anon', 'public.archive_state_transition_log(interval)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.archive_state_transition_log(interval)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.archive_state_transition_log(interval)', 'EXECUTE')
  into v_ok;

  insert into pg_temp._p9_cst_results values
    (17, 'grants do fluxo e helpers internos endurecidos',
     case when v_ok then 'PASS' else 'SUT_FAIL' end,
     case when v_ok then 'panel, human RPCs, overloads legadas e helpers SLA/archive seguem o contrato de grants' else 'unexpected grants remain on panel, human, SLA or internal transition functions' end);
end;
$scenario_17$;

do $scenario_18$
declare
  v_timeout_conversation uuid := gen_random_uuid();
  v_takeover_log_id uuid;
  v_first_run record;
  v_second_run record;
  v_status text;
  v_actor_type text;
  v_actor_user_id uuid;
  v_reason text;
  v_source text;
begin
  insert into public.conversations (
    id, organization_id, lead_id, status,
    is_human_active, last_status_reason, last_status_metadata
  ) values (
    v_timeout_conversation,
    (select organization_id from pg_temp._p9_cst_context),
    (select lead_id from pg_temp._p9_cst_context),
    'humano_assumiu',
    true,
    'manual_takeover_timeout_probe',
    '{"source":"panel_takeover","origin":"panel_takeover"}'::jsonb
  );

  insert into pg_temp._p9_cst_state(state_key, value_uuid)
  values ('scenario_18_timeout_conversation_id', v_timeout_conversation)
  on conflict (state_key) do update set value_uuid = excluded.value_uuid;

  insert into public.state_transition_log (
    organization_id, store_id, conversation_id, from_state, to_state,
    actor_type, actor_user_id, reason, source, metadata, event_key, created_at
  ) values (
    (select organization_id from pg_temp._p9_cst_context),
    (select store_id from pg_temp._p9_cst_context),
    v_timeout_conversation,
    'qualificacao',
    'humano_assumiu',
    'human',
    (select owner_user_id from pg_temp._p9_cst_context),
    'manual_takeover_timeout_probe',
    'panel_takeover',
    '{"runner":true,"scenario":18,"step":"takeover"}'::jsonb,
    'runner:event:timeout-base',
    pg_catalog.clock_timestamp() - interval '11 minutes'
  )
  returning id into v_takeover_log_id;

  select * into v_first_run
  from pg_temp._p9_cst_exec_scalar(
    'service_role', null,
    'select public.process_stale_human_conversations()::text'
  );

  select * into v_second_run
  from pg_temp._p9_cst_exec_scalar(
    'service_role', null,
    'select public.process_stale_human_conversations()::text'
  );

  select status, last_status_actor_type, last_status_actor_user_id, last_status_reason
  into v_status, v_actor_type, v_actor_user_id, v_reason
  from public.conversations
  where id = v_timeout_conversation;

  select source
  into v_source
  from public.state_transition_log
  where event_key = 'auto_timeout_human:' || v_takeover_log_id::text;

  insert into pg_temp._p9_cst_results values
    (18, 'timeout de 10 minutos retorna para qualificacao como system',
     case when v_first_run.operation_succeeded
               and v_first_run.value_text = '1'
               and v_second_run.operation_succeeded
               and v_second_run.value_text = '0'
               and v_status = 'qualificacao'
               and v_actor_type = 'system'
               and v_actor_user_id is null
               and v_reason = 'auto_timeout_human'
               and v_source = 'human_timeout_auto_release'
          then 'PASS' else 'SUT_FAIL' end,
     format('first=%s | second=%s | status=%s | actor_type=%s | actor_user_id=%s | reason=%s | source=%s',
       coalesce(v_first_run.value_text, '<null>'),
       coalesce(v_second_run.value_text, '<null>'),
       coalesce(v_status, '<null>'),
       coalesce(v_actor_type, '<null>'),
       coalesce(v_actor_user_id::text, '<null>'),
       coalesce(v_reason, '<null>'),
       coalesce(v_source, '<null>')));
end;
$scenario_18$;

do $scenario_19$
declare
  v_ok boolean;
  v_remaining integer;
begin
  select
    strpos(lower(pg_get_functiondef('public.process_sla_violations()'::regprocedure)), '_conversation_transition_sla_event_key') > 0
    and strpos(lower(pg_get_functiondef('public.process_sla_violations()'::regprocedure)), 'sla_violation') > 0
    and strpos(lower(pg_get_functiondef('public.process_sla_violations()'::regprocedure)), 'first loja') = 0
  into v_ok;

  select count(*)
  into v_remaining
  from public.state_transition_log log_row
  join public.conversations conversation_row
    on conversation_row.id = log_row.conversation_id
  join public.leads lead_row
    on lead_row.id = conversation_row.lead_id
  where log_row.organization_id is distinct from lead_row.organization_id
     or log_row.store_id is distinct from lead_row.store_id;

  insert into pg_temp._p9_cst_results values
    (19, 'SLA canonico e reparo final sem divergencias',
     case when v_ok and v_remaining = 0 then 'PASS' else 'SUT_FAIL' end,
     format('sla_ok=%s | remaining=%s', v_ok, v_remaining));
end;
$scenario_19$;

do $scenario_20$
declare
  v_result record;
  v_status text;
  v_actor uuid;
  v_reason text;
  v_actor_type text;
  v_source text;
begin
  select * into v_result
  from pg_temp._p9_cst_exec_scalar(
    'service_role', null,
    format(
      'select (public.transition_conversation_state_by_user(%L,%L,%L,%L,%L,%L,%L,%L::jsonb)).status',
      (select conversation_id from pg_temp._p9_cst_context),
      'orcamento',
      (select owner_user_id from pg_temp._p9_cst_context),
      'manual_quote_pdf_prepare_budget',
      'quote_pdf_generation',
      (select organization_id from pg_temp._p9_cst_context),
      'runner:event:quote-budget',
      '{"runner":true,"scenario":20}'
    )
  );

  select status, last_status_actor_user_id, last_status_reason
  into v_status, v_actor, v_reason
  from public.conversations
  where id = (select conversation_id from pg_temp._p9_cst_context);

  select actor_type, source
  into v_actor_type, v_source
  from public.state_transition_log
  where event_key = 'runner:event:quote-budget';

  insert into pg_temp._p9_cst_results values
    (20, 'orcamento via service_role preserva autoria humana real',
     case when v_result.operation_succeeded
               and v_status = 'orcamento'
               and v_actor = (select owner_user_id from pg_temp._p9_cst_context)
               and v_reason = 'manual_quote_pdf_prepare_budget'
               and v_actor_type = 'human'
               and v_source = 'quote_pdf_generation'
          then 'PASS' else 'SUT_FAIL' end,
     format('status=%s | actor=%s | reason=%s | actor_type=%s | source=%s',
       coalesce(v_status, '<null>'),
       coalesce(v_actor::text, '<null>'),
       coalesce(v_reason, '<null>'),
       coalesce(v_actor_type, '<null>'),
       coalesce(v_source, '<null>')));
end;
$scenario_20$;

do $scenario_21$
declare
  v_live_before integer;
  v_live_after integer;
  v_archived_during integer := 0;
  v_archive_during integer := 0;
  v_archive_after integer := 0;
  v_update_state text;
  v_update_message text;
  v_delete_state text;
  v_delete_message text;
  v_insert_denied record;
begin
  select count(*)
  into v_live_before
  from public.state_transition_log
  where event_key like 'runner:event:%';

  begin
    select public.archive_state_transition_log(interval '1 microsecond')::integer
    into v_archived_during;

    select count(*)
    into v_archive_during
    from public.state_transition_log_archive
    where event_key like 'runner:event:%';

    begin
      update public.state_transition_log_archive
      set archive_reason = archive_reason
      where event_key like 'runner:event:%';
    exception
      when others then
        get stacked diagnostics
          v_update_state = returned_sqlstate,
          v_update_message = message_text;
    end;

    begin
      delete from public.state_transition_log_archive
      where event_key like 'runner:event:%';
    exception
      when others then
        get stacked diagnostics
          v_delete_state = returned_sqlstate,
          v_delete_message = message_text;
    end;

    raise exception using
      errcode = 'P0001',
      message = 'runner archive probe rollback';
  exception
    when others then
      if sqlstate <> 'P0001' or sqlerrm <> 'runner archive probe rollback' then
        raise;
      end if;
  end;

  select count(*)
  into v_live_after
  from public.state_transition_log
  where event_key like 'runner:event:%';

  select count(*)
  into v_archive_after
  from public.state_transition_log_archive
  where event_key like 'runner:event:%';

  select * into v_insert_denied
  from pg_temp._p9_cst_exec_scalar(
    'service_role', null,
    'with inserted as (
       insert into public.state_transition_log_archive (id)
       values (gen_random_uuid())
       returning 1
     )
     select ''ok'''
  );

  insert into pg_temp._p9_cst_results values
    (21, 'archive e imutavel sem DML direto do fluxo operacional',
     case when v_archived_during >= 1
               and v_archive_during >= 1
               and v_live_after = v_live_before
               and v_archive_after = 0
               and v_update_state = 'P0001'
               and v_update_message = 'state transition log archive is immutable'
               and v_delete_state = 'P0001'
               and v_delete_message = 'state transition log archive delete is not allowed'
               and not v_insert_denied.operation_succeeded
               and v_insert_denied.returned_sqlstate = '42501'
          then 'PASS' else 'SUT_FAIL' end,
     format('archived_during=%s | archive_during=%s | live_before=%s | live_after=%s | archive_after=%s | update=%s/%s | delete=%s/%s | service_insert=%s',
       v_archived_during,
       v_archive_during,
       v_live_before,
       v_live_after,
       v_archive_after,
       coalesce(v_update_state, '<none>'),
       coalesce(v_update_message, '<none>'),
       coalesce(v_delete_state, '<none>'),
       coalesce(v_delete_message, '<none>'),
       coalesce(v_insert_denied.returned_sqlstate, '<none>')));
end;
$scenario_21$;

do $scenario_22$
declare
  v_logs integer;
  v_archived_logs integer;
  v_conversations integer;
begin
  delete from public.state_transition_log
  where event_key like 'runner:event:%'
     or event_key like 'auto_timeout_human:%'
     or conversation_id in (
       (select value_uuid from pg_temp._p9_cst_state where state_key = 'scenario_12_conversation_id'),
       (select value_uuid from pg_temp._p9_cst_state where state_key = 'scenario_18_timeout_conversation_id')
     );

  delete from public.conversations
  where id in (
    (select conversation_id from pg_temp._p9_cst_context),
    (select second_conversation_id from pg_temp._p9_cst_context),
    (select value_uuid from pg_temp._p9_cst_state where state_key = 'scenario_12_conversation_id'),
    (select value_uuid from pg_temp._p9_cst_state where state_key = 'scenario_18_timeout_conversation_id')
  );

  select count(*) into v_logs
  from public.state_transition_log
  where event_key like 'runner:event:%'
     or event_key like 'auto_timeout_human:%';

  select count(*) into v_archived_logs
  from public.state_transition_log_archive
  where event_key like 'runner:event:%'
     or event_key like 'auto_timeout_human:%';

  select count(*) into v_conversations
  from public.conversations
  where id in (
    (select conversation_id from pg_temp._p9_cst_context),
    (select second_conversation_id from pg_temp._p9_cst_context),
    (select value_uuid from pg_temp._p9_cst_state where state_key = 'scenario_12_conversation_id'),
    (select value_uuid from pg_temp._p9_cst_state where state_key = 'scenario_18_timeout_conversation_id')
  );

  insert into pg_temp._p9_cst_results values
    (22, 'cleanup total das fixtures',
     case when v_logs = 0 and v_archived_logs = 0 and v_conversations = 0 then 'PASS' else 'SUT_FAIL' end,
     format('logs=%s | archived_logs=%s | conversations=%s', v_logs, v_archived_logs, v_conversations));
end;
$scenario_22$;

commit;

select *
from pg_temp._p9_cst_results
order by scenario_number;

begin;

set transaction isolation level repeatable read;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:b1:e1.4:commercial-message-session-context-writer:manual-checks:v1',
    0
  )
);

drop table if exists pg_temp._p9_e14_results;
drop table if exists pg_temp._p9_e14_matrix;
drop table if exists pg_temp._p9_e14_ctx;
drop table if exists pg_temp._p9_e14_harness_state;

create temp table pg_temp._p9_e14_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null,
  returned_sqlstate text null,
  constraint_name text null
) on commit preserve rows;

create temp table pg_temp._p9_e14_matrix (
  scenario_number integer primary key,
  scenario_name text not null,
  coverage_rule text not null,
  expected_outcome text not null
) on commit preserve rows;

create temp table pg_temp._p9_e14_harness_state (
  singleton boolean primary key default true check (singleton),
  setup_ok boolean not null,
  fatal_sqlstate text null,
  fatal_message text null,
  fatal_constraint text null
) on commit preserve rows;

create temp table pg_temp._p9_e14_ctx (
  singleton boolean primary key default true check (singleton),
  run_id uuid not null,
  org_a uuid not null,
  org_b uuid not null,
  store_a uuid not null,
  store_b uuid not null,
  member_user_id uuid not null,
  outsider_user_id uuid not null,
  lead_explicit uuid not null,
  lead_no_opp uuid not null,
  lead_multi_opp uuid not null,
  lead_multi_identity uuid not null,
  lead_mismatch_customer uuid not null,
  lead_closed_cycle uuid not null,
  lead_panel uuid not null,
  lead_panel_scoped uuid not null,
  conv_explicit uuid not null,
  conv_no_opp uuid not null,
  conv_multi_opp uuid not null,
  conv_multi_identity uuid not null,
  conv_mismatch_customer uuid not null,
  conv_closed_cycle uuid not null,
  conv_panel uuid not null,
  conv_panel_scoped uuid not null,
  customer_a uuid not null,
  customer_b uuid not null,
  customer_c uuid not null,
  customer_d uuid not null,
  customer_e uuid not null,
  customer_f uuid not null,
  customer_g uuid not null,
  lead_link_explicit uuid not null,
  lead_link_no_opp uuid not null,
  lead_link_multi_opp uuid not null,
  lead_link_multi_identity_a uuid not null,
  lead_link_multi_identity_b uuid not null,
  lead_link_mismatch uuid not null,
  lead_link_closed_cycle uuid not null,
  lead_link_panel uuid not null,
  lead_link_panel_scoped uuid not null,
  opp_explicit uuid not null,
  opp_multi_opp_a uuid not null,
  opp_multi_opp_b uuid not null,
  opp_mismatch_customer uuid not null,
  opp_panel uuid not null,
  opp_panel_scoped uuid not null
) on commit preserve rows;

insert into pg_temp._p9_e14_matrix (
  scenario_number,
  scenario_name,
  coverage_rule,
  expected_outcome
) values
  (1, 'helper contract', 'nova funcao SECURITY DEFINER owner postgres sem EXECUTE para anon/authenticated e com EXECUTE para service_role', 'PASS'),
  (2, 'insert_message contract', 'assinatura, retorno, ACL, owner, proconfig e SECURITY DEFINER preservados com chamada antes do INSERT', 'PASS'),
  (3, 'primeira chamada cria sessao pendente', 'helper cria conversation_session active quando nao ha contexto explicito seguro', 'PASS'),
  (4, 'segunda chamada reutiliza sessao', 'retry converge na mesma session active', 'PASS'),
  (5, 'sessao closed nao reabre e novo ciclo cria nova active', 'helper nunca reabre closed e cria nova active no ciclo seguinte', 'PASS'),
  (6, 'vinculo explicito unico cria captured uma vez', 'helper cria contexto apenas quando ha 1 identidade ativa e 1 oportunidade explicita com customer igual', 'PASS'),
  (7, 'retry do vinculo nao duplica contexto', 'mesma sessao fica com um unico contexto active', 'PASS'),
  (8, 'multiplas oportunidades explicitas ficam pending_context', 'helper nao escolhe oportunidade quando cardinalidade explicita > 1', 'PASS'),
  (9, 'indice de identidade ativa unica bloqueia duplicidade', 'o setup tenta criar o segundo lead_customer_link ativo, recebe unique_violation e preserva apenas um vinculo ativo', 'PASS'),
  (10, 'customer divergente fica pending_context', 'helper nao vincula oportunidade de customer diferente', 'PASS'),
  (11, 'contexto ativo preexistente nao e substituido', 'helper devolve existing_captured sem replace', 'PASS'),
  (12, 'insert_message apos vinculo gera captured', 'trigger existente grava captured depois do helper', 'PASS'),
  (13, 'insert_message sem vinculo gera pending_context', 'trigger existente grava pending_context quando ha sessao active sem contexto', 'PASS'),
  (14, 'snapshot permanece imutavel', 'update manual dos campos do snapshot falha', 'PASS'),
  (15, 'panel_send_message continua funcionando', 'RPC legado nao scoped continua funcionando como service_role', 'PASS'),
  (16, 'panel_send_message_scoped continua funcionando', 'RPC legado scoped continua persiste mensagem com contexto correto', 'PASS'),
  (17, 'service_role executa helper', 'service_role consegue chamar a nova funcao', 'PASS'),
  (18, 'anon rejeitado', 'anon falha exatamente com 42501', 'PASS'),
  (19, 'garantias estruturais de concorrencia', 'indice parcial de session active unica e indice de contexto active unico existem e o runner nao finge concorrencia real', 'PASS'),
  (20, 'objetos fora do escopo permanecem intactos', 'panel_send_message e panel_send_message_scoped mantem owner ACL proconfig e hashes remotos auditados', 'PASS'),
  (21, 'service_role com claim authenticated divergente e rejeitada', 'role efetiva service_role com claim role divergente falha antes de criar conversation_session', 'PASS'),
  (22, 'claims role divergentes sao rejeitadas', 'request.jwt.claim.role divergente de request.jwt.claims.role falha antes de criar conversation_session', 'PASS'),
  (23, 'sessao postgres administrativa sem claims funciona', 'session_user postgres sem claims de API consegue executar a helper', 'PASS'),
  (24, 'rejeicoes de autorizacao nao criam contexto', 'nenhuma rejeicao de autorizacao cria conversation_session ou context link', 'PASS'),
  (25, 'service_role cria contexto com ator system', 'o primeiro vinculo criado via service_role grava linked_by_actor_type system e linked_by_user_id null', 'PASS'),
  (26, 'panel_send_message_scoped autenticado cria contexto humano', 'o vinculo criado pelo fluxo scoped autenticado grava linked_by_actor_type human e linked_by_user_id do usuario autenticado', 'PASS'),
  (27, 'authenticated sem membership falha sem efeitos colaterais', 'o fluxo scoped autenticado sem membership retorna 42501 e nao cria sessao nem contexto', 'PASS'),
  (28, 'insert_message normaliza sender direction type e content', 'a redefinicao preserva normalizacao do contrato legado', 'PASS'),
  (29, 'mensagem de midia exige media_url', 'insert_message rejeita mensagem de midia sem media_url', 'PASS'),
  (30, 'mensagem de midia exige content', 'insert_message rejeita mensagem de midia sem content', 'PASS'),
  (31, 'texto com media_url e rejeitado', 'insert_message rejeita text com media_url', 'PASS'),
  (32, 'metadata do chamador e preservada sem app flag', 'metadata salva preserva apenas a carga do chamador e nao grava app.insert_via_function', 'PASS'),
  (33, 'insert_message continua passando pelo gate canonico', 'insert_message consegue inserir enquanto INSERT direto continua bloqueado apos reset explicito do app.insert_via_function', 'PASS');

insert into pg_temp._p9_e14_ctx (
  run_id,
  org_a,
  org_b,
  store_a,
  store_b,
  member_user_id,
  outsider_user_id,
  lead_explicit,
  lead_no_opp,
  lead_multi_opp,
  lead_multi_identity,
  lead_mismatch_customer,
  lead_closed_cycle,
  lead_panel,
  lead_panel_scoped,
  conv_explicit,
  conv_no_opp,
  conv_multi_opp,
  conv_multi_identity,
  conv_mismatch_customer,
  conv_closed_cycle,
  conv_panel,
  conv_panel_scoped,
  customer_a,
  customer_b,
  customer_c,
  customer_d,
  customer_e,
  customer_f,
  customer_g,
  lead_link_explicit,
  lead_link_no_opp,
  lead_link_multi_opp,
  lead_link_multi_identity_a,
  lead_link_multi_identity_b,
  lead_link_mismatch,
  lead_link_closed_cycle,
  lead_link_panel,
  lead_link_panel_scoped,
  opp_explicit,
  opp_multi_opp_a,
  opp_multi_opp_b,
  opp_mismatch_customer,
  opp_panel,
  opp_panel_scoped
)
values (
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
  gen_random_uuid()
);

create or replace function pg_temp._p9_e14_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_pass boolean,
  p_detail text,
  p_returned_sqlstate text default null,
  p_constraint_name text default null
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_e14_results (
    scenario_number,
    scenario_name,
    status,
    detail,
    returned_sqlstate,
    constraint_name
  )
  values (
    p_scenario_number,
    p_scenario_name,
    case when p_pass then 'PASS' else 'SUT_FAIL' end,
    coalesce(p_detail, '<null>'),
    p_returned_sqlstate,
    p_constraint_name
  );
exception
  when others then
    insert into pg_temp._p9_e14_results (
      scenario_number,
      scenario_name,
      status,
      detail,
      returned_sqlstate,
      constraint_name
    )
    values (
      p_scenario_number,
      p_scenario_name,
      'HARNESS_ERROR',
      'record helper failed: ' || coalesce(sqlerrm, '<null>'),
      sqlstate,
      null
    )
    on conflict (scenario_number) do nothing;
end;
$function$;

create or replace function pg_temp._p9_e14_exec_scalar(
  p_role text,
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
  v_value text;
  v_state text;
  v_message text;
  v_constraint text;
  v_ok boolean := false;
begin
  if p_role not in ('postgres', 'service_role', 'authenticated', 'anon') then
    return query
    select false, null::text, 'P0001'::text, 'unsupported role'::text, null::text;
    return;
  end if;

  if p_role <> 'postgres' then
    perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
    perform set_config('request.jwt.claim.role', p_role, true);
    perform set_config(
      'request.jwt.claims',
      case
        when p_user_id is null
          then jsonb_build_object('role', p_role)::text
        else jsonb_build_object('role', p_role, 'sub', p_user_id::text)::text
      end,
      true
    );
    execute format('set local role %I', p_role);
  end if;

  begin
    execute p_sql into v_value;
    v_ok := true;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;
      v_ok := false;
  end;

  begin
    execute 'reset role';
  exception
    when others then
      null;
  end;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);

  return query
  select
    v_ok,
    case when v_ok then v_value else null::text end,
    v_state,
    v_message,
    v_constraint;
end;
$function$;

revoke all on function pg_temp._p9_e14_record(integer, text, boolean, text, text, text) from public;
revoke all on function pg_temp._p9_e14_exec_scalar(text, uuid, text) from public;

do $setup$
declare
  v pg_temp._p9_e14_ctx;
  v_state text;
  v_message text;
  v_constraint text;
begin
  insert into pg_temp._p9_e14_harness_state (setup_ok, fatal_sqlstate, fatal_message, fatal_constraint)
  values (true, null, null, null)
  on conflict (singleton) do update
  set setup_ok = excluded.setup_ok,
      fatal_sqlstate = excluded.fatal_sqlstate,
      fatal_message = excluded.fatal_message,
      fatal_constraint = excluded.fatal_constraint;

  begin
    select * into strict v from pg_temp._p9_e14_ctx;

    insert into auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token,
    is_sso_user,
    is_anonymous
  )
  values
    (
      v.member_user_id,
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'runner-e14-member-' || v.run_id::text || '@example.test',
      '',
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('runner', true, 'key', 'member'),
      now(),
      now(),
      '',
      '',
      '',
      '',
      false,
      false
    ),
    (
      v.outsider_user_id,
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'runner-e14-outsider-' || v.run_id::text || '@example.test',
      '',
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('runner', true, 'key', 'outsider'),
      now(),
      now(),
      '',
      '',
      '',
      '',
      false,
      false
    );

  insert into public.organizations (id, name)
  values
    (v.org_a, 'Runner E14 Org A ' || v.run_id::text),
    (v.org_b, 'Runner E14 Org B ' || v.run_id::text);

  insert into public.stores (id, organization_id, name)
  values
    (v.store_a, v.org_a, 'Runner E14 Store A ' || v.run_id::text),
    (v.store_b, v.org_b, 'Runner E14 Store B ' || v.run_id::text);

  insert into public.memberships (organization_id, user_id, role)
  values
    (v.org_a, v.member_user_id, 'owner');

insert into public.customers (id, organization_id, display_name)
  values
    (v.customer_a, v.org_a, 'Runner Customer A'),
    (v.customer_b, v.org_a, 'Runner Customer B'),
    (v.customer_c, v.org_a, 'Runner Customer C'),
    (v.customer_d, v.org_a, 'Runner Customer D'),
    (v.customer_e, v.org_a, 'Runner Customer E'),
    (v.customer_f, v.org_a, 'Runner Customer F'),
    (v.customer_g, v.org_a, 'Runner Customer G');

  insert into public.customer_store_links (organization_id, store_id, customer_id)
  values
    (v.org_a, v.store_a, v.customer_a),
    (v.org_a, v.store_a, v.customer_b),
    (v.org_a, v.store_a, v.customer_c),
    (v.org_a, v.store_a, v.customer_d),
    (v.org_a, v.store_a, v.customer_e),
    (v.org_a, v.store_a, v.customer_f),
    (v.org_a, v.store_a, v.customer_g);

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
  values
    (v.lead_explicit, v.org_a, v.store_a, 'Lead explicit', '+55000000001', 'novo_lead', now(), now()),
    (v.lead_no_opp, v.org_a, v.store_a, 'Lead no opp', '+55000000002', 'novo_lead', now(), now()),
    (v.lead_multi_opp, v.org_a, v.store_a, 'Lead multi opp', '+55000000003', 'novo_lead', now(), now()),
    (v.lead_multi_identity, v.org_a, v.store_a, 'Lead multi identity', '+55000000004', 'novo_lead', now(), now()),
    (v.lead_mismatch_customer, v.org_a, v.store_a, 'Lead mismatch customer', '+55000000005', 'novo_lead', now(), now()),
    (v.lead_closed_cycle, v.org_a, v.store_a, 'Lead closed cycle', '+55000000006', 'novo_lead', now(), now()),
    (v.lead_panel, v.org_a, v.store_a, 'Lead panel', '+55000000007', 'novo_lead', now(), now()),
    (v.lead_panel_scoped, v.org_a, v.store_a, 'Lead panel scoped', '+55000000008', 'novo_lead', now(), now());

  insert into public.conversations (
    id,
    organization_id,
    lead_id,
    status,
    is_human_active,
    created_at
  )
  values
    (v.conv_explicit, v.org_a, v.lead_explicit, 'open', false, now()),
    (v.conv_no_opp, v.org_a, v.lead_no_opp, 'open', false, now()),
    (v.conv_multi_opp, v.org_a, v.lead_multi_opp, 'open', false, now()),
    (v.conv_multi_identity, v.org_a, v.lead_multi_identity, 'open', false, now()),
    (v.conv_mismatch_customer, v.org_a, v.lead_mismatch_customer, 'open', false, now()),
    (v.conv_closed_cycle, v.org_a, v.lead_closed_cycle, 'open', false, now()),
    (v.conv_panel, v.org_a, v.lead_panel, 'open', false, now()),
    (v.conv_panel_scoped, v.org_a, v.lead_panel_scoped, 'open', false, now());

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
  values
    (v.lead_link_explicit, v.org_a, v.store_a, v.lead_explicit, v.customer_a, 'active', 'manual', 'migration', now(), '{}'::jsonb),
    (v.lead_link_no_opp, v.org_a, v.store_a, v.lead_no_opp, v.customer_b, 'active', 'manual', 'migration', now(), '{}'::jsonb),
    (v.lead_link_multi_opp, v.org_a, v.store_a, v.lead_multi_opp, v.customer_b, 'active', 'manual', 'migration', now(), '{}'::jsonb),
    (v.lead_link_multi_identity_a, v.org_a, v.store_a, v.lead_multi_identity, v.customer_c, 'active', 'manual', 'migration', now(), '{}'::jsonb),
    (v.lead_link_mismatch, v.org_a, v.store_a, v.lead_mismatch_customer, v.customer_e, 'active', 'manual', 'migration', now(), '{}'::jsonb),
    (v.lead_link_closed_cycle, v.org_a, v.store_a, v.lead_closed_cycle, v.customer_f, 'active', 'manual', 'migration', now(), '{}'::jsonb),
    (v.lead_link_panel, v.org_a, v.store_a, v.lead_panel, v.customer_a, 'active', 'manual', 'migration', now(), '{}'::jsonb),
    (v.lead_link_panel_scoped, v.org_a, v.store_a, v.lead_panel_scoped, v.customer_b, 'active', 'manual', 'migration', now(), '{}'::jsonb);

    insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    origin_lead_id,
    primary_conversation_id,
    stage,
    lifecycle_cycle,
    created_at,
    updated_at
  )
  values
    (v.opp_explicit, v.org_a, v.store_a, v.customer_a, v.lead_explicit, v.conv_explicit, 'novo_lead', 1, now(), now()),
    (v.opp_multi_opp_a, v.org_a, v.store_a, v.customer_b, v.lead_multi_opp, v.conv_multi_opp, 'novo_lead', 1, now(), now()),
    (v.opp_multi_opp_b, v.org_a, v.store_a, v.customer_b, v.lead_multi_opp, v.conv_multi_opp, 'qualificacao', 1, now(), now()),
    (v.opp_mismatch_customer, v.org_a, v.store_a, v.customer_g, v.lead_mismatch_customer, v.conv_mismatch_customer, 'novo_lead', 1, now(), now()),
    (v.opp_panel, v.org_a, v.store_a, v.customer_a, v.lead_panel, v.conv_panel, 'novo_lead', 1, now(), now()),
    (v.opp_panel_scoped, v.org_a, v.store_a, v.customer_b, v.lead_panel_scoped, v.conv_panel_scoped, 'novo_lead', 1, now(), now());
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;

      update pg_temp._p9_e14_harness_state
      set setup_ok = false,
          fatal_sqlstate = v_state,
          fatal_message = v_message,
          fatal_constraint = v_constraint;
  end;
end;
$setup$;

do $scenarios$
declare
  v pg_temp._p9_e14_ctx;
  v_setup_ok boolean;
  v_value text;
  v_state text;
  v_message_text text;
  v_constraint text;
  v_message_id uuid;
  v_session_a uuid;
  v_session_b uuid;
  v_ctx_a uuid;
  v_before_session_count integer;
  v_after_session_count integer;
  v_before_context_count integer;
  v_after_context_count integer;
begin
  begin
    select setup_ok
    into v_setup_ok
    from pg_temp._p9_e14_harness_state;

    if not coalesce(v_setup_ok, false) then
      return;
    end if;

    select * into strict v from pg_temp._p9_e14_ctx;

  perform pg_temp._p9_e14_record(
    1,
    'helper contract',
    exists (
      select 1
      from pg_catalog.pg_proc proc_row
      join pg_catalog.pg_roles role_row
        on role_row.oid = proc_row.proowner
      where proc_row.oid = pg_catalog.to_regprocedure(
        'public.ensure_commercial_conversation_session_context(uuid,uuid,uuid)'
      )
        and role_row.rolname = 'postgres'
        and proc_row.prosecdef
        and proc_row.provolatile = 'v'
        and exists (
          select 1
          from pg_catalog.unnest(proc_row.proconfig) config_row
          where config_row = 'search_path=pg_catalog, pg_temp, public'
        )
        and exists (
          select 1
          from pg_catalog.unnest(proc_row.proconfig) config_row
          where config_row = 'row_security=off'
        )
        and has_function_privilege('service_role', proc_row.oid, 'EXECUTE')
        and not has_function_privilege('authenticated', proc_row.oid, 'EXECUTE')
        and not has_function_privilege('anon', proc_row.oid, 'EXECUTE')
    ),
    'helper security and ACL contract verified locally'
  );

  perform pg_temp._p9_e14_record(
    2,
    'insert_message contract',
    exists (
      select 1
      from pg_catalog.pg_proc proc_row
      join pg_catalog.pg_roles role_row
        on role_row.oid = proc_row.proowner
      where proc_row.oid = pg_catalog.to_regprocedure(
        'public.insert_message(uuid,text,text,text,text,text,text,jsonb)'
      )
        and role_row.rolname = 'postgres'
        and proc_row.prosecdef
        and proc_row.provolatile = 'v'
        and pg_catalog.pg_get_function_result(proc_row.oid) = 'messages'
        and pg_catalog.pg_get_functiondef(proc_row.oid) ilike '%set_config(''app.insert_via_function'', ''true'', true)%'
        and pg_catalog.pg_get_functiondef(proc_row.oid) ilike '%perform public.ensure_commercial_conversation_session_context%'
       and pg_catalog.strpos(
         pg_catalog.lower(pg_catalog.pg_get_functiondef(proc_row.oid)),
         'set_config(''app.insert_via_function'''
       ) < pg_catalog.strpos(
         pg_catalog.lower(pg_catalog.pg_get_functiondef(proc_row.oid)),
         'insert into public.messages'
       )
       and pg_catalog.strpos(
         pg_catalog.lower(pg_catalog.pg_get_functiondef(proc_row.oid)),
         'perform public.ensure_commercial_conversation_session_context'
       ) < pg_catalog.strpos(
         pg_catalog.lower(pg_catalog.pg_get_functiondef(proc_row.oid)),
         'insert into public.messages'
       )
    ),
    'insert_message keeps its contract and invokes the helper before inserting'
  );

  select value_text
  into v_value
  from pg_temp._p9_e14_exec_scalar(
    'service_role',
    null,
    format(
      $$select row_to_json(public.ensure_commercial_conversation_session_context('%s','%s','%s'))::text$$,
      v.org_a,
      v.store_a,
      v.conv_no_opp
    )
  );

  perform pg_temp._p9_e14_record(
    3,
    'primeira chamada cria sessao pendente',
    v_value is not null
    and (v_value::jsonb ->> 'commercial_context_state') = 'pending_context'
    and (v_value::jsonb ->> 'session_created') = 'true'
    and (v_value::jsonb ->> 'context_link_created') = 'false',
    coalesce(v_value, '<null>')
  );

  v_session_a := nullif(v_value::jsonb ->> 'conversation_session_id', '')::uuid;

  select value_text
  into v_value
  from pg_temp._p9_e14_exec_scalar(
    'service_role',
    null,
    format(
      $$select row_to_json(public.ensure_commercial_conversation_session_context('%s','%s','%s'))::text$$,
      v.org_a,
      v.store_a,
      v.conv_no_opp
    )
  );

  perform pg_temp._p9_e14_record(
    4,
    'segunda chamada reutiliza sessao',
    v_value is not null
    and nullif(v_value::jsonb ->> 'conversation_session_id', '')::uuid = v_session_a
    and (v_value::jsonb ->> 'session_created') = 'false',
    coalesce(v_value, '<null>')
  );

  update public.conversation_sessions
  set status = 'closed'
  where id = v_session_a;

  select value_text
  into v_value
  from pg_temp._p9_e14_exec_scalar(
    'service_role',
    null,
    format(
      $$select row_to_json(public.ensure_commercial_conversation_session_context('%s','%s','%s'))::text$$,
      v.org_a,
      v.store_a,
      v.conv_closed_cycle
    )
  );

  v_session_b := nullif(v_value::jsonb ->> 'conversation_session_id', '')::uuid;

  update public.conversation_sessions
  set status = 'closed'
  where id = v_session_b;

  select value_text
  into v_value
  from pg_temp._p9_e14_exec_scalar(
    'service_role',
    null,
    format(
      $$select row_to_json(public.ensure_commercial_conversation_session_context('%s','%s','%s'))::text$$,
      v.org_a,
      v.store_a,
      v.conv_closed_cycle
    )
  );

  perform pg_temp._p9_e14_record(
    5,
    'sessao closed nao reabre e novo ciclo cria nova active',
    v_value is not null
    and nullif(v_value::jsonb ->> 'conversation_session_id', '')::uuid <> v_session_b
    and (v_value::jsonb ->> 'session_created') = 'true'
    and (
      select count(*)
      from public.conversation_sessions session_row
      where session_row.conversation_id = v.conv_closed_cycle
        and session_row.status = 'active'
    ) = 1,
    coalesce(v_value, '<null>')
  );

  select value_text
  into v_value
  from pg_temp._p9_e14_exec_scalar(
    'service_role',
    null,
    format(
      $$select row_to_json(public.ensure_commercial_conversation_session_context('%s','%s','%s'))::text$$,
      v.org_a,
      v.store_a,
      v.conv_explicit
    )
  );

  v_ctx_a := nullif(v_value::jsonb ->> 'commercial_session_context_link_id', '')::uuid;

  perform pg_temp._p9_e14_record(
    6,
    'vinculo explicito unico cria captured uma vez',
    v_value is not null
    and (v_value::jsonb ->> 'commercial_context_state') = 'captured'
    and (v_value::jsonb ->> 'context_link_created') = 'true'
    and v_ctx_a is not null,
    coalesce(v_value, '<null>')
  );

  select value_text
  into v_value
  from pg_temp._p9_e14_exec_scalar(
    'service_role',
    null,
    format(
      $$select row_to_json(public.ensure_commercial_conversation_session_context('%s','%s','%s'))::text$$,
      v.org_a,
      v.store_a,
      v.conv_explicit
    )
  );

  perform pg_temp._p9_e14_record(
    7,
    'retry do vinculo nao duplica contexto',
    v_value is not null
    and nullif(v_value::jsonb ->> 'commercial_session_context_link_id', '')::uuid = v_ctx_a
    and (
      select count(*)
      from public.commercial_session_context_links context_row
      where context_row.conversation_session_id = nullif(v_value::jsonb ->> 'conversation_session_id', '')::uuid
        and context_row.status = 'active'
    ) = 1,
    coalesce(v_value, '<null>')
  );

  select value_text
  into v_value
  from pg_temp._p9_e14_exec_scalar(
    'service_role',
    null,
    format(
      $$select row_to_json(public.ensure_commercial_conversation_session_context('%s','%s','%s'))::text$$,
      v.org_a,
      v.store_a,
      v.conv_multi_opp
    )
  );

  perform pg_temp._p9_e14_record(
    8,
    'multiplas oportunidades explicitas ficam pending_context',
    (
      select count(*)
      from public.lead_customer_links link_row
      where link_row.organization_id = v.org_a
        and link_row.store_id = v.store_a
        and link_row.lead_id = v.lead_multi_opp
        and link_row.status = 'active'
        and link_row.unlinked_at is null
    ) = 1
    and (
      select count(*)
      from public.commercial_opportunities opportunity_row
      where opportunity_row.organization_id = v.org_a
        and opportunity_row.store_id = v.store_a
        and opportunity_row.primary_conversation_id = v.conv_multi_opp
        and opportunity_row.origin_lead_id = v.lead_multi_opp
        and opportunity_row.customer_id = v.customer_b
    ) = 2
    and
    v_value is not null
    and (v_value::jsonb ->> 'commercial_context_state') = 'pending_context'
    and (v_value::jsonb ->> 'commercial_session_context_link_id') is null,
    coalesce(v_value, '<null>')
  );

  begin
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
      v.lead_link_multi_identity_b,
      v.org_a,
      v.store_a,
      v.lead_multi_identity,
      v.customer_d,
      'active',
      'manual',
      'migration',
      now(),
      '{}'::jsonb
    );

    v_state := null;
    v_constraint := null;
  exception
    when unique_violation then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_constraint = constraint_name;
  end;

  perform pg_temp._p9_e14_record(
    9,
    'indice de identidade ativa unica bloqueia duplicidade',
    v_state = '23505'
    and coalesce(v_constraint, '') = 'lead_customer_links_one_active_per_lead_uidx'
    and (
      select count(*)
      from public.lead_customer_links link_row
      where link_row.organization_id = v.org_a
        and link_row.store_id = v.store_a
        and link_row.lead_id = v.lead_multi_identity
        and link_row.status = 'active'
        and link_row.unlinked_at is null
    ) = 1,
    format(
      'returned_sqlstate=%s | constraint_name=%s | active_link_count=%s',
      coalesce(v_state, '<null>'),
      coalesce(v_constraint, '<null>'),
      (
        select count(*)
        from public.lead_customer_links link_row
        where link_row.organization_id = v.org_a
          and link_row.store_id = v.store_a
          and link_row.lead_id = v.lead_multi_identity
          and link_row.status = 'active'
          and link_row.unlinked_at is null
      )
    ),
    v_state,
    v_constraint
  );

  select value_text
  into v_value
  from pg_temp._p9_e14_exec_scalar(
    'service_role',
    null,
    format(
      $$select row_to_json(public.ensure_commercial_conversation_session_context('%s','%s','%s'))::text$$,
      v.org_a,
      v.store_a,
      v.conv_mismatch_customer
    )
  );

  perform pg_temp._p9_e14_record(
    10,
    'customer divergente fica pending_context',
    v_value is not null
    and (v_value::jsonb ->> 'commercial_context_state') = 'pending_context'
    and (v_value::jsonb ->> 'commercial_opportunity_id') is null,
    coalesce(v_value, '<null>')
  );

  perform pg_temp._p9_e14_record(
    11,
    'contexto ativo preexistente nao e substituido',
    (
      select count(*)
      from public.commercial_session_context_links context_row
      where context_row.id = v_ctx_a
        and context_row.status = 'active'
    ) = 1,
    'existing_captured keeps the same active context link'
  );

  select value_text
  into v_value
  from pg_temp._p9_e14_exec_scalar(
    'service_role',
    null,
    format(
      $$select row_to_json(public.insert_message('%s','user','incoming','text','runner explicit message','ext-%s',null,'{"source":"runner_e14"}'::jsonb))::text$$,
      v.conv_explicit,
      v.run_id
    )
  );

  v_message_id := nullif(v_value::jsonb ->> 'id', '')::uuid;

  perform pg_temp._p9_e14_record(
    12,
    'insert_message apos vinculo gera captured',
    v_message_id is not null
    and exists (
      select 1
      from public.messages message_row
      where message_row.id = v_message_id
        and message_row.commercial_context_capture_state = 'captured'
    ),
    coalesce(v_value, '<null>')
  );

  select value_text
  into v_value
  from pg_temp._p9_e14_exec_scalar(
    'service_role',
    null,
    format(
      $$select row_to_json(public.insert_message('%s','user','incoming','text','runner pending message','ext-pending-%s',null,'{"source":"runner_e14"}'::jsonb))::text$$,
      v.conv_no_opp,
      v.run_id
    )
  );

  v_message_id := nullif(v_value::jsonb ->> 'id', '')::uuid;

  perform pg_temp._p9_e14_record(
    13,
    'insert_message sem vinculo gera pending_context',
    v_message_id is not null
    and exists (
      select 1
      from public.messages message_row
      where message_row.id = v_message_id
        and message_row.commercial_context_capture_state = 'pending_context'
    ),
    coalesce(v_value, '<null>')
  );

  begin
    update public.messages
    set commercial_context_capture_state = 'legacy_unknown'
    where id = v_message_id;

    perform pg_temp._p9_e14_record(
      14,
      'snapshot permanece imutavel',
      false,
      'update unexpectedly succeeded'
    );
  exception
    when others then
      perform pg_temp._p9_e14_record(
        14,
        'snapshot permanece imutavel',
        sqlstate = 'P0001',
        sqlerrm,
        sqlstate,
        null
      );
  end;

  select value_text
  into v_value
  from pg_temp._p9_e14_exec_scalar(
    'service_role',
    null,
    format(
      $$select public.panel_send_message('%s','runner panel message','human',null)::text$$,
      v.conv_panel
    )
  );

  perform pg_temp._p9_e14_record(
    15,
    'panel_send_message continua funcionando',
    nullif(v_value, '') is not null
    and exists (
      select 1
      from public.messages message_row
      where message_row.id = nullif(v_value, '')::uuid
        and message_row.commercial_context_capture_state = 'captured'
    ),
    coalesce(v_value, '<null>')
  );

  select value_text
  into v_value
  from pg_temp._p9_e14_exec_scalar(
    'authenticated',
    v.member_user_id,
    format(
      $$select public.panel_send_message_scoped('%s','%s','runner panel scoped message')::text$$,
      v.org_a,
      v.conv_panel_scoped
    )
  );

  perform pg_temp._p9_e14_record(
    16,
    'panel_send_message_scoped continua funcionando',
    nullif(v_value, '') is not null
    and exists (
      select 1
      from public.messages message_row
      where message_row.id = nullif(v_value, '')::uuid
        and message_row.commercial_context_capture_state = 'captured'
    ),
    coalesce(v_value, '<null>')
  );

  select value_text
  into v_value
  from pg_temp._p9_e14_exec_scalar(
    'service_role',
    null,
    format(
      $$select row_to_json(public.ensure_commercial_conversation_session_context('%s','%s','%s'))::text$$,
      v.org_a,
      v.store_a,
      v.conv_panel
    )
  );

  perform pg_temp._p9_e14_record(
    17,
    'service_role executa helper',
    v_value is not null,
    coalesce(v_value, '<null>')
  );

  select returned_sqlstate
  into v_value
  from pg_temp._p9_e14_exec_scalar(
    'anon',
    null,
    format(
      $$select row_to_json(public.ensure_commercial_conversation_session_context('%s','%s','%s'))::text$$,
      v.org_a,
      v.store_a,
      v.conv_panel
    )
  );

  perform pg_temp._p9_e14_record(
    18,
    'anon rejeitado',
    v_value = '42501',
    coalesce(v_value, '<null>')
  );

  perform pg_temp._p9_e14_record(
    19,
    'garantias estruturais de concorrencia',
    exists (
      select 1
      from pg_catalog.pg_class class_row
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = class_row.relnamespace
      where namespace_row.nspname = 'public'
        and class_row.relname = 'conversation_sessions_one_active_per_thread_uidx'
    )
    and exists (
      select 1
      from pg_catalog.pg_class class_row
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = class_row.relnamespace
      where namespace_row.nspname = 'public'
        and class_row.relname = 'commercial_session_context_links_one_active_per_session_uidx'
    ),
    'runner validates structural convergence only; it does not fake concurrent sessions inside one transaction'
  );

  perform pg_temp._p9_e14_record(
    20,
    'objetos fora do escopo permanecem intactos',
    exists (
      select 1
      from pg_catalog.pg_proc proc_row
      join pg_catalog.pg_roles role_row
        on role_row.oid = proc_row.proowner
      where proc_row.oid = pg_catalog.to_regprocedure('public.panel_send_message(uuid,text,text,text)')
        and role_row.rolname = 'postgres'
        and coalesce(pg_catalog.array_to_string(proc_row.proconfig, ','), '') = 'search_path=public, pg_temp'
        and md5(pg_catalog.pg_get_functiondef(proc_row.oid)) = '0349045b9f557c85ae2dbceab84a7efd'
        and has_function_privilege('service_role', proc_row.oid, 'EXECUTE')
        and not has_function_privilege('authenticated', proc_row.oid, 'EXECUTE')
        and not has_function_privilege('anon', proc_row.oid, 'EXECUTE')
        and not exists (
          select 1
          from pg_catalog.aclexplode(
            coalesce(proc_row.proacl, pg_catalog.acldefault('f', proc_row.proowner))
          ) acl_row
          where acl_row.grantee = 0
            and acl_row.privilege_type = 'EXECUTE'
        )
    )
    and exists (
      select 1
      from pg_catalog.pg_proc proc_row
      join pg_catalog.pg_roles role_row
        on role_row.oid = proc_row.proowner
      where proc_row.oid = pg_catalog.to_regprocedure('public.panel_send_message_scoped(uuid,uuid,text)')
        and role_row.rolname = 'postgres'
        and coalesce(pg_catalog.array_to_string(proc_row.proconfig, ','), '') = 'search_path=public, pg_temp'
        and md5(pg_catalog.pg_get_functiondef(proc_row.oid)) = '1877bd63fcb5a5f7885b708c237c6d30'
        and has_function_privilege('service_role', proc_row.oid, 'EXECUTE')
        and has_function_privilege('authenticated', proc_row.oid, 'EXECUTE')
        and not has_function_privilege('anon', proc_row.oid, 'EXECUTE')
        and not exists (
          select 1
          from pg_catalog.aclexplode(
            coalesce(proc_row.proacl, pg_catalog.acldefault('f', proc_row.proowner))
          ) acl_row
          where acl_row.grantee = 0
            and acl_row.privilege_type = 'EXECUTE'
        )
    ),
    'legacy panel RPCs keep owner, proconfig and remote baseline hashes'
  );

  select count(*)
  into v_before_session_count
  from public.conversation_sessions
  where organization_id = v.org_a
    and store_id = v.store_a
    and conversation_id = v.conv_panel;

  select count(*)
  into v_before_context_count
  from public.commercial_session_context_links context_row
  join public.conversation_sessions session_row
    on session_row.id = context_row.conversation_session_id
  where context_row.organization_id = v.org_a
    and context_row.store_id = v.store_a
    and session_row.conversation_id = v.conv_panel;

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated')::text,
    true
  );
  execute 'set local role service_role';

  begin
    perform public.ensure_commercial_conversation_session_context(
      v.org_a,
      v.store_a,
      v.conv_panel
    );
    v_state := null;
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp._p9_e14_record(
    21,
    'service_role com claim authenticated divergente e rejeitada',
    v_state = '42501',
    coalesce(v_state, '<null>'),
    v_state,
    null
  );

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated')::text,
    true
  );
  execute 'set local role service_role';

  begin
    perform public.ensure_commercial_conversation_session_context(
      v.org_a,
      v.store_a,
      v.conv_panel
    );
    v_state := null;
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp._p9_e14_record(
    22,
    'claims role divergentes sao rejeitadas',
    v_state = '42501',
    coalesce(v_state, '<null>'),
    v_state,
    null
  );

  begin
    perform public.ensure_commercial_conversation_session_context(
      v.org_a,
      v.store_a,
      v.conv_panel
    );
    v_value := 'ok';
  exception
    when others then
      v_value := null;
      get stacked diagnostics v_state = returned_sqlstate;
  end;

  perform pg_temp._p9_e14_record(
    23,
    'sessao postgres administrativa sem claims funciona',
    v_value = 'ok',
    coalesce(v_value, coalesce(v_state, '<null>'))
  );

  select count(*)
  into v_after_session_count
  from public.conversation_sessions
  where organization_id = v.org_a
    and store_id = v.store_a
    and conversation_id = v.conv_panel;

  select count(*)
  into v_after_context_count
  from public.commercial_session_context_links context_row
  join public.conversation_sessions session_row
    on session_row.id = context_row.conversation_session_id
  where context_row.organization_id = v.org_a
    and context_row.store_id = v.store_a
    and session_row.conversation_id = v.conv_panel;

  perform pg_temp._p9_e14_record(
    24,
    'rejeicoes de autorizacao nao criam contexto',
    v_after_session_count = v_before_session_count
    and v_after_context_count = v_before_context_count,
    format(
      'session_count_before=%s | session_count_after=%s | context_count_before=%s | context_count_after=%s',
      v_before_session_count,
      v_after_session_count,
      v_before_context_count,
      v_after_context_count
    )
  );

  perform pg_temp._p9_e14_record(
    25,
    'service_role cria contexto com ator system',
    exists (
      select 1
      from public.commercial_session_context_links context_row
      join public.conversation_sessions session_row
        on session_row.id = context_row.conversation_session_id
      where session_row.conversation_id = v.conv_panel
        and context_row.linked_by_actor_type = 'system'
        and context_row.linked_by_user_id is null
    ),
    'service_role path persisted a system context link'
  );

  perform pg_temp._p9_e14_record(
    26,
    'panel_send_message_scoped autenticado cria contexto humano',
    exists (
      select 1
      from public.commercial_session_context_links context_row
      join public.conversation_sessions session_row
        on session_row.id = context_row.conversation_session_id
      where session_row.conversation_id = v.conv_panel_scoped
        and context_row.linked_by_actor_type = 'human'
        and context_row.linked_by_user_id = v.member_user_id
    ),
    'authenticated scoped path persisted a human context link'
  );

  select count(*)
  into v_before_session_count
  from public.conversation_sessions
  where conversation_id = v.conv_no_opp;

  select count(*)
  into v_before_context_count
  from public.commercial_session_context_links context_row
  join public.conversation_sessions session_row
    on session_row.id = context_row.conversation_session_id
  where session_row.conversation_id = v.conv_no_opp;

  select returned_sqlstate
  into v_state
  from pg_temp._p9_e14_exec_scalar(
    'authenticated',
    v.outsider_user_id,
    format(
      $$select public.panel_send_message_scoped('%s','%s','runner outsider scoped message')::text$$,
      v.org_a,
      v.conv_no_opp
    )
  );

  select count(*)
  into v_after_session_count
  from public.conversation_sessions
  where conversation_id = v.conv_no_opp;

  select count(*)
  into v_after_context_count
  from public.commercial_session_context_links context_row
  join public.conversation_sessions session_row
    on session_row.id = context_row.conversation_session_id
  where session_row.conversation_id = v.conv_no_opp;

  perform pg_temp._p9_e14_record(
    27,
    'authenticated sem membership falha sem efeitos colaterais',
    v_state = '42501'
    and v_after_session_count = v_before_session_count
    and v_after_context_count = v_before_context_count,
    format(
      'returned_sqlstate=%s | session_count_before=%s | session_count_after=%s | context_count_before=%s | context_count_after=%s',
      coalesce(v_state, '<null>'),
      v_before_session_count,
      v_after_session_count,
      v_before_context_count,
      v_after_context_count
    ),
    v_state,
    null
  );

  select value_text
  into v_value
  from pg_temp._p9_e14_exec_scalar(
    'service_role',
    null,
    format(
      $$select row_to_json(public.insert_message('%s',' USER ',' OUTGOING ',' TEXT ','  runner normalized message  ',null,null,'{"k":"v"}'::jsonb))::text$$,
      v.conv_explicit
    )
  );

  perform pg_temp._p9_e14_record(
    28,
    'insert_message normaliza sender direction type e content',
    v_value is not null
    and (v_value::jsonb ->> 'sender') = 'user'
    and (v_value::jsonb ->> 'direction') = 'outgoing'
    and (v_value::jsonb ->> 'message_type') = 'text'
    and (v_value::jsonb ->> 'content') = 'runner normalized message',
    coalesce(v_value, '<null>')
  );

  select returned_sqlstate, message_text
  into v_state, v_message_text
  from pg_temp._p9_e14_exec_scalar(
    'service_role',
    null,
    format(
      $$select row_to_json(public.insert_message('%s','user','incoming','image','media without url',null,null,'{}'::jsonb))::text$$,
      v.conv_explicit
    )
  );

  perform pg_temp._p9_e14_record(
    29,
    'mensagem de midia exige media_url',
    v_state = 'P0001'
    and v_message_text = 'media_message_requires_media_url: image',
    format(
      'returned_sqlstate=%s | message_text=%s',
      coalesce(v_state, '<null>'),
      coalesce(v_message_text, '<null>')
    ),
    v_state,
    null
  );

  select returned_sqlstate, message_text
  into v_state, v_message_text
  from pg_temp._p9_e14_exec_scalar(
    'service_role',
    null,
    format(
      $$select row_to_json(public.insert_message('%s','user','incoming','image','   ',null,'https://example.test/x.png','{}'::jsonb))::text$$,
      v.conv_explicit
    )
  );

  perform pg_temp._p9_e14_record(
    30,
    'mensagem de midia exige content',
    v_state = 'P0001'
    and v_message_text = 'media_message_requires_content: image',
    format(
      'returned_sqlstate=%s | message_text=%s',
      coalesce(v_state, '<null>'),
      coalesce(v_message_text, '<null>')
    ),
    v_state,
    null
  );

  select returned_sqlstate, message_text
  into v_state, v_message_text
  from pg_temp._p9_e14_exec_scalar(
    'service_role',
    null,
    format(
      $$select row_to_json(public.insert_message('%s','user','incoming','text','text with media',null,'https://example.test/x.png','{}'::jsonb))::text$$,
      v.conv_explicit
    )
  );

  perform pg_temp._p9_e14_record(
    31,
    'texto com media_url e rejeitado',
    v_state = 'P0001'
    and v_message_text = 'text_message_cannot_have_media_url',
    format(
      'returned_sqlstate=%s | message_text=%s',
      coalesce(v_state, '<null>'),
      coalesce(v_message_text, '<null>')
    ),
    v_state,
    null
  );

  select value_text
  into v_value
  from pg_temp._p9_e14_exec_scalar(
    'service_role',
    null,
    format(
      $$select row_to_json(public.insert_message('%s','user','incoming','text','metadata preservation',null,null,'{"caller":"ok"}'::jsonb))::text$$,
      v.conv_explicit
    )
  );

  perform pg_temp._p9_e14_record(
    32,
    'metadata do chamador e preservada sem app flag',
    v_value is not null
    and (v_value::jsonb -> 'metadata' ->> 'caller') = 'ok'
    and not coalesce(((v_value::jsonb -> 'metadata') ? 'app.insert_via_function'), false),
    coalesce(v_value, '<null>')
  );

  select count(*)
  into v_before_session_count
  from public.messages
  where conversation_id = v.conv_explicit
    and content = 'direct insert blocked';

  perform set_config('app.insert_via_function', '', true);

  select returned_sqlstate, message_text
  into v_state, v_message_text
  from pg_temp._p9_e14_exec_scalar(
    'service_role',
    null,
    format(
      $$insert into public.messages (conversation_id,sender,content,organization_id,lead_id,store_id,message_type,direction,metadata) values ('%s','user','direct insert blocked','%s','%s','%s','text','incoming','{}'::jsonb) returning id::text$$,
      v.conv_explicit,
      v.org_a,
      v.lead_explicit,
      v.store_a
    )
  );

  select count(*)
  into v_after_session_count
  from public.messages
  where conversation_id = v.conv_explicit
    and content = 'direct insert blocked';

  perform pg_temp._p9_e14_record(
    33,
    'insert_message continua passando pelo gate canonico',
    v_state = 'P0001'
    and v_message_text = 'Direct INSERT into messages is not allowed. Use public.insert_message().'
    and v_after_session_count = v_before_session_count,
    format(
      'returned_sqlstate=%s | message_text=%s | message_count_before=%s | message_count_after=%s',
      coalesce(v_state, '<null>'),
      coalesce(v_message_text, '<null>'),
      v_before_session_count,
      v_after_session_count
    ),
    v_state,
    null
  );
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message_text = message_text,
        v_constraint = constraint_name;

      update pg_temp._p9_e14_harness_state
      set setup_ok = false,
          fatal_sqlstate = v_state,
          fatal_message = v_message_text,
          fatal_constraint = v_constraint;

      insert into pg_temp._p9_e14_results (
        scenario_number,
        scenario_name,
        status,
        detail,
        returned_sqlstate,
        constraint_name
      )
      values (
        0,
        'scenario fatal',
        'HARNESS_ERROR',
        coalesce(v_message_text, 'unexpected scenario failure'),
        v_state,
        v_constraint
      )
      on conflict (scenario_number) do update
      set status = excluded.status,
          detail = excluded.detail,
          returned_sqlstate = excluded.returned_sqlstate,
          constraint_name = excluded.constraint_name;
  end;
end;
$scenarios$;

insert into pg_temp._p9_e14_results (
  scenario_number,
  scenario_name,
  status,
  detail,
  returned_sqlstate,
  constraint_name
)
select
  0,
  'setup fatal',
  'HARNESS_ERROR',
  coalesce(fatal_message, 'setup failed without message'),
  fatal_sqlstate,
  fatal_constraint
from pg_temp._p9_e14_harness_state
where not setup_ok
on conflict (scenario_number) do nothing;

insert into pg_temp._p9_e14_results (
  scenario_number,
  scenario_name,
  status,
  detail,
  returned_sqlstate,
  constraint_name
)
select
  matrix_row.scenario_number,
  matrix_row.scenario_name,
  'HARNESS_ERROR',
  'scenario was not recorded by the runner',
  null,
  null
from pg_temp._p9_e14_matrix matrix_row
where not exists (
  select 1
  from pg_temp._p9_e14_results result_row
  where result_row.scenario_number = matrix_row.scenario_number
)
and coalesce((select setup_ok from pg_temp._p9_e14_harness_state), false);

with summary as (
  select
    (select count(*) from pg_temp._p9_e14_matrix) as total_scenarios,
    count(*) filter (where scenario_number > 0 and status = 'PASS') as total_pass,
    count(*) filter (where status = 'SUT_FAIL') as sut_fail,
    count(*) filter (where status = 'HARNESS_ERROR') as harness_error,
    count(*) filter (where scenario_number > 0) as recorded_scenarios,
    coalesce((select setup_ok from pg_temp._p9_e14_harness_state), false) as setup_ok
  from pg_temp._p9_e14_results
)
select
  result_row.scenario_number,
  result_row.scenario_name,
  result_row.status,
  result_row.detail,
  result_row.returned_sqlstate,
  result_row.constraint_name,
  summary.total_scenarios,
  summary.total_pass,
  summary.sut_fail,
  summary.harness_error,
  case
    when summary.recorded_scenarios = summary.total_scenarios
      and summary.total_pass = summary.total_scenarios
      and summary.sut_fail = 0
      and summary.harness_error = 0
      and summary.setup_ok
      then 'APROVADA'
    else 'REPROVADA'
  end as final_status
from pg_temp._p9_e14_results result_row
cross join summary
order by
  case result_row.status
    when 'HARNESS_ERROR' then 0
    when 'SUT_FAIL' then 1
    else 2
  end,
  result_row.scenario_number;

rollback;

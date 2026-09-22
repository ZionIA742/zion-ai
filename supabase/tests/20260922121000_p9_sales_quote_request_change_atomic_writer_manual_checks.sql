begin;
set transaction isolation level repeatable read;
set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;
create temp table pg_temp._p9_request_change_atomic_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null
) on commit preserve rows;
create or replace function pg_temp._p9_request_change_atomic_record(
  p_scenario_number integer,
  p_scenario_name text,
  p_status text,
  p_detail text default null
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p9_request_change_atomic_results(
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
create or replace function pg_temp._p9_request_change_atomic_exec_json(
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
create or replace function pg_temp._p9_request_change_atomic_sql(
  p_org uuid,
  p_store uuid,
  p_quote uuid,
  p_conversation uuid,
  p_lead uuid,
  p_text text
)
returns text
language sql
as $function$
  select pg_catalog.format(
    $sql$
      select * from public.request_sales_quote_change_by_system(
        %L::uuid, %L::uuid, %L::uuid, %L::uuid, %L::uuid, %L::text
      )
    $sql$,
    p_org, p_store, p_quote, p_conversation, p_lead, p_text
  );
$function$;
create or replace function pg_temp._p9_request_change_atomic_event_count(
  p_org uuid,
  p_conversation uuid,
  p_quote uuid,
  p_change_request uuid default null
)
returns integer
language sql
as $function$
  select pg_catalog.count(*)::integer
  from public.conversation_events event_row
  where event_row.organization_id = p_org
    and event_row.conversation_id = p_conversation
    and event_row.event_type = 'orcamento_alteracao_solicitada'
    and coalesce(event_row.payload ->> 'quote_id', '') = p_quote::text
    and (
      p_change_request is null
      or coalesce(event_row.payload ->> 'change_request_id', '') = p_change_request::text
    );
$function$;
do $fixtures$
declare
  v_org uuid := gen_random_uuid();
  v_store uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();
  v_other_org uuid := gen_random_uuid();
  v_other_store uuid := gen_random_uuid();
  v_other_customer uuid := gen_random_uuid();
  v_quote_success uuid := gen_random_uuid();
  v_quote_denied uuid := gen_random_uuid();
  v_quote_rollback uuid := gen_random_uuid();
  v_quote_scope uuid := gen_random_uuid();
  v_quote_replay uuid := gen_random_uuid();
  v_quote_inconsistent uuid := gen_random_uuid();
  v_quote_missing_event uuid := gen_random_uuid();
begin
  create temp table pg_temp._p9_request_change_atomic_ctx (
    singleton boolean primary key default true check (singleton),
    org_id uuid not null,
    store_id uuid not null,
    user_id uuid not null,
    other_org_id uuid not null,
    other_store_id uuid not null,
    quote_success uuid not null,
    quote_denied uuid not null,
    quote_rollback uuid not null,
    quote_scope uuid not null,
    quote_replay uuid not null,
    quote_inconsistent uuid not null,
    quote_missing_event uuid not null
  ) on commit preserve rows;
  insert into pg_temp._p9_request_change_atomic_ctx(
    org_id, store_id, user_id, other_org_id, other_store_id,
    quote_success, quote_denied, quote_rollback, quote_scope,
    quote_replay, quote_inconsistent, quote_missing_event
  ) values (
    v_org, v_store, v_user, v_other_org, v_other_store,
    v_quote_success, v_quote_denied, v_quote_rollback, v_quote_scope,
    v_quote_replay, v_quote_inconsistent, v_quote_missing_event
  );
  insert into auth.users(id) values (v_user);
  insert into public.organizations (id, name, subscription_status)
  values
    (v_org, 'P9 Request Change Atomic Org', 'active'),
    (v_other_org, 'P9 Request Change Atomic Other Org', 'active');
  insert into public.stores (id, organization_id, name)
  values
    (v_store, v_org, 'P9 Request Change Atomic Store'),
    (v_other_store, v_other_org, 'P9 Request Change Atomic Other Store');
  insert into public.memberships (organization_id, user_id, role, is_active)
  values (v_org, v_user, 'admin', true);
  insert into public.customers (id, organization_id, display_name)
  values
    (v_customer, v_org, 'P9 Request Change Atomic Customer'),
    (v_other_customer, v_other_org, 'P9 Request Change Atomic Other Customer');
  delete from public.event_state_rules
  where event_type = 'orcamento_alteracao_solicitada'
    and state in ('orcamento', 'qualificacao');
  insert into public.event_state_rules(event_type, state, is_allowed)
  values
    ('orcamento_alteracao_solicitada', 'orcamento', true),
    ('orcamento_alteracao_solicitada', 'qualificacao', false);
  create temp table pg_temp._p9_request_change_atomic_fixture (
    quote_id uuid primary key,
    lead_id uuid not null,
    conversation_id uuid not null,
    opportunity_id uuid not null
  ) on commit preserve rows;
  insert into pg_temp._p9_request_change_atomic_fixture(quote_id, lead_id, conversation_id, opportunity_id)
  values
    (v_quote_success, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()),
    (v_quote_denied, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()),
    (v_quote_rollback, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()),
    (v_quote_scope, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()),
    (v_quote_replay, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()),
    (v_quote_inconsistent, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()),
    (v_quote_missing_event, gen_random_uuid(), gen_random_uuid(), gen_random_uuid());
  insert into public.leads(id, organization_id, store_id, name, phone, state)
  select fixture.lead_id, v_org, v_store, 'P9 Request Change Lead', '5511999999999',
         case when fixture.quote_id = v_quote_denied then 'qualificacao' else 'orcamento' end
  from pg_temp._p9_request_change_atomic_fixture fixture;
  insert into public.conversations(id, organization_id, lead_id, status, is_human_active, created_at)
  select fixture.conversation_id, v_org, fixture.lead_id, 'active', true, pg_catalog.clock_timestamp()
  from pg_temp._p9_request_change_atomic_fixture fixture;

  -- The production route prepares conversation state before calling the writer.
  -- Conversation insert creates conversation_states as novo_lead, so seed these
  -- fixtures into the same post-preparation state expected by request-change.
  perform pg_catalog.set_config('app.allow_state_update', 'true', true);

  update public.conversation_states state_row
  set state = case
        when fixture.quote_id = v_quote_denied then 'qualificacao'
        else 'orcamento'
      end
  from pg_temp._p9_request_change_atomic_fixture fixture
  where state_row.conversation_id = fixture.conversation_id
    and state_row.organization_id = v_org;

  perform pg_catalog.set_config('app.allow_state_update', 'false', true);
  insert into public.commercial_opportunities (id, organization_id, store_id, customer_id, stage)
  select fixture.opportunity_id, v_org, v_store, v_customer, 'orcamento'
  from pg_temp._p9_request_change_atomic_fixture fixture;
  insert into public.sales_quotes (
    id, organization_id, store_id, commercial_opportunity_id,
    conversation_id, lead_id, quote_number, title, status,
    customer_name, customer_phone, customer_notes, internal_notes,
    subtotal_cents, discount_cents, total_cents, current_version_id, metadata
  )
  select
    fixture.quote_id, v_org, v_store, fixture.opportunity_id,
    fixture.conversation_id, fixture.lead_id, 'RC-' || right(fixture.quote_id::text, 6),
    'Request Change Atomic', 'draft',
    'P9 Request Change Customer', '5511999999999', null, null,
    30000, 0, 30000, null, '{}'::jsonb
  from pg_temp._p9_request_change_atomic_fixture fixture;
end;
$fixtures$;
do $scenarios$
declare
  ctx pg_temp._p9_request_change_atomic_ctx%rowtype;
  fx record;
  r record;
  q text;
  v_change_request_id uuid;
  v_request_count integer;
  v_event_count integer;
  v_quote_status text;
  v_quote_last_change_request_id uuid;
  v_before_status text;
  v_before_last_change_request_id uuid;
  v_open_id uuid;
  v_second_open_id uuid;
  v_definition text;
  v_normalized_definition text;
begin
  select * into ctx from pg_temp._p9_request_change_atomic_ctx where singleton;
  select * into fx from pg_temp._p9_request_change_atomic_fixture where quote_id = ctx.quote_success;
  q := pg_temp._p9_request_change_atomic_sql(ctx.org_id, ctx.store_id, fx.quote_id, fx.conversation_id, fx.lead_id, 'trocar item');
  select * into r from pg_temp._p9_request_change_atomic_exec_json('service_role', null, q);
  select id into v_change_request_id
  from public.sales_quote_change_requests
  where quote_id = fx.quote_id;
  select pg_catalog.count(*)::integer into v_request_count
  from public.sales_quote_change_requests
  where quote_id = fx.quote_id
    and status = 'open';
  select status, last_change_request_id
  into v_quote_status, v_quote_last_change_request_id
  from public.sales_quotes
  where id = fx.quote_id;
  v_event_count := pg_temp._p9_request_change_atomic_event_count(
    ctx.org_id, fx.conversation_id, fx.quote_id, v_change_request_id
  );
  if r.operation_succeeded
     and (r.value_json ->> 'change_request_id')::uuid = v_change_request_id
     and (r.value_json ->> 'status') = 'changes_requested'
     and (r.value_json ->> 'event_created')::boolean is true
     and (r.value_json ->> 'reused_existing_request')::boolean is false
     and v_request_count = 1
     and v_quote_status = 'changes_requested'
     and v_quote_last_change_request_id = v_change_request_id
     and v_event_count = 1 then
    perform pg_temp._p9_request_change_atomic_record(1, 'sucesso atomico cria request quote e evento', 'PASS', 'retorno e persistencia conferem');
  else
    perform pg_temp._p9_request_change_atomic_record(1, 'sucesso atomico cria request quote e evento', 'SUT_FAIL', coalesce(r.value_json::text, r.message_text, 'resultado divergente'));
  end if;
  select * into fx from pg_temp._p9_request_change_atomic_fixture where quote_id = ctx.quote_denied;
  q := pg_temp._p9_request_change_atomic_sql(ctx.org_id, ctx.store_id, fx.quote_id, fx.conversation_id, fx.lead_id, 'negado por estado');
  select * into r from pg_temp._p9_request_change_atomic_exec_json('service_role', null, q);
  select pg_catalog.count(*)::integer into v_request_count
  from public.sales_quote_change_requests
  where quote_id = fx.quote_id;
  v_event_count := pg_temp._p9_request_change_atomic_event_count(ctx.org_id, fx.conversation_id, fx.quote_id);
  select status, last_change_request_id into v_quote_status, v_quote_last_change_request_id
  from public.sales_quotes where id = fx.quote_id;
  if not r.operation_succeeded
     and r.message_text like '%ZION_QUOTE_EVENT_NOT_ALLOWED%'
     and v_request_count = 0
     and v_quote_status = 'draft'
     and v_quote_last_change_request_id is null
     and v_event_count = 0 then
    perform pg_temp._p9_request_change_atomic_record(2, 'event_state_rules negando nao muta', 'PASS', 'negou antes de request quote evento');
  else
    perform pg_temp._p9_request_change_atomic_record(2, 'event_state_rules negando nao muta', 'SUT_FAIL', coalesce(r.message_text, r.value_json::text, 'mutacao inesperada'));
  end if;
  select * into fx from pg_temp._p9_request_change_atomic_fixture where quote_id = ctx.quote_rollback;
  select status, last_change_request_id into v_before_status, v_before_last_change_request_id
  from public.sales_quotes where id = fx.quote_id;
  create or replace function pg_temp._p9_request_change_fail_event_insert()
  returns trigger
  language plpgsql
  as $trigger$
  begin
    if new.event_type = 'orcamento_alteracao_solicitada'
       and coalesce(new.payload ->> 'quote_id', '') = current_setting('p9.request_change_fail_quote_id', true) then
      raise exception using
        errcode = 'P0001',
        message = 'P9_REQUEST_CHANGE_FORCED_EVENT_INSERT_FAILURE';
    end if;
    return new;
  end;
  $trigger$;
  create trigger p9_request_change_fail_event_insert
  before insert on public.conversation_events
  for each row execute function pg_temp._p9_request_change_fail_event_insert();
  perform set_config('p9.request_change_fail_quote_id', fx.quote_id::text, true);
  q := pg_temp._p9_request_change_atomic_sql(ctx.org_id, ctx.store_id, fx.quote_id, fx.conversation_id, fx.lead_id, 'forcar rollback');
  select * into r from pg_temp._p9_request_change_atomic_exec_json('service_role', null, q);
  drop trigger p9_request_change_fail_event_insert on public.conversation_events;
  select pg_catalog.count(*)::integer into v_request_count
  from public.sales_quote_change_requests
  where quote_id = fx.quote_id;
  v_event_count := pg_temp._p9_request_change_atomic_event_count(ctx.org_id, fx.conversation_id, fx.quote_id);
  select status, last_change_request_id into v_quote_status, v_quote_last_change_request_id
  from public.sales_quotes where id = fx.quote_id;
  if not r.operation_succeeded
     and r.message_text like '%P9_REQUEST_CHANGE_FORCED_EVENT_INSERT_FAILURE%'
     and v_request_count = 0
     and v_quote_status = v_before_status
     and v_quote_last_change_request_id is not distinct from v_before_last_change_request_id
     and v_event_count = 0 then
    perform pg_temp._p9_request_change_atomic_record(3, 'falha real no insert do evento faz rollback completo', 'PASS', 'request quote e evento voltaram ao estado anterior');
  else
    perform pg_temp._p9_request_change_atomic_record(3, 'falha real no insert do evento faz rollback completo', 'SUT_FAIL', coalesce(r.message_text, r.value_json::text, 'rollback incompleto'));
  end if;
  select * into fx from pg_temp._p9_request_change_atomic_fixture where quote_id = ctx.quote_scope;
  q := pg_temp._p9_request_change_atomic_sql(ctx.other_org_id, ctx.other_store_id, fx.quote_id, fx.conversation_id, fx.lead_id, 'escopo divergente');
  select * into r from pg_temp._p9_request_change_atomic_exec_json('service_role', null, q);
  select pg_catalog.count(*)::integer into v_request_count
  from public.sales_quote_change_requests where quote_id = fx.quote_id;
  v_event_count := pg_temp._p9_request_change_atomic_event_count(ctx.org_id, fx.conversation_id, fx.quote_id);
  select status, last_change_request_id into v_quote_status, v_quote_last_change_request_id
  from public.sales_quotes where id = fx.quote_id;
  if not r.operation_succeeded
     and v_request_count = 0
     and v_event_count = 0
     and v_quote_status = 'draft'
     and v_quote_last_change_request_id is null then
    perform pg_temp._p9_request_change_atomic_record(4, 'escopo divergente falha sem mutacao', 'PASS', 'organization/store divergente negado');
  else
    perform pg_temp._p9_request_change_atomic_record(4, 'escopo divergente falha sem mutacao', 'SUT_FAIL', coalesce(r.message_text, r.value_json::text, 'mutacao inesperada'));
  end if;
  select * into fx from pg_temp._p9_request_change_atomic_fixture where quote_id = ctx.quote_replay;
  q := pg_temp._p9_request_change_atomic_sql(ctx.org_id, ctx.store_id, fx.quote_id, fx.conversation_id, fx.lead_id, 'primeira tentativa');
  select * into r from pg_temp._p9_request_change_atomic_exec_json('service_role', null, q);
  v_change_request_id := (r.value_json ->> 'change_request_id')::uuid;
  q := pg_temp._p9_request_change_atomic_sql(ctx.org_id, ctx.store_id, fx.quote_id, fx.conversation_id, fx.lead_id, 'segunda tentativa nao sobrescreve');
  select * into r from pg_temp._p9_request_change_atomic_exec_json('service_role', null, q);
  select pg_catalog.count(*)::integer into v_request_count
  from public.sales_quote_change_requests
  where quote_id = fx.quote_id
    and status = 'open';
  v_event_count := pg_temp._p9_request_change_atomic_event_count(ctx.org_id, fx.conversation_id, fx.quote_id, v_change_request_id);
  if r.operation_succeeded
     and (r.value_json ->> 'change_request_id')::uuid = v_change_request_id
     and (r.value_json ->> 'reused_existing_request')::boolean is true
     and (r.value_json ->> 'event_created')::boolean is false
     and v_request_count = 1
     and v_event_count = 1
     and exists (
       select 1 from public.sales_quote_change_requests change_request_row
       where change_request_row.id = v_change_request_id
         and change_request_row.request_text = 'primeira tentativa'
     ) then
    perform pg_temp._p9_request_change_atomic_record(5, 'replay coerente reusa request e nao duplica evento', 'PASS', 'mesmo change_request_id retornado');
  else
    perform pg_temp._p9_request_change_atomic_record(5, 'replay coerente reusa request e nao duplica evento', 'SUT_FAIL', coalesce(r.message_text, r.value_json::text, 'replay divergente'));
  end if;
  select * into fx from pg_temp._p9_request_change_atomic_fixture where quote_id = ctx.quote_missing_event;
  insert into public.sales_quote_change_requests(
    quote_id, organization_id, store_id, status, requested_by, request_text
  ) values (
    fx.quote_id, ctx.org_id, ctx.store_id, 'open', 'human', 'request legado sem evento'
  ) returning id into v_open_id;
  update public.sales_quotes
  set status = 'changes_requested', last_change_request_id = v_open_id
  where id = fx.quote_id;
  q := pg_temp._p9_request_change_atomic_sql(ctx.org_id, ctx.store_id, fx.quote_id, fx.conversation_id, fx.lead_id, 'retry recupera evento');
  select * into r from pg_temp._p9_request_change_atomic_exec_json('service_role', null, q);
  v_event_count := pg_temp._p9_request_change_atomic_event_count(ctx.org_id, fx.conversation_id, fx.quote_id, v_open_id);
  if r.operation_succeeded
     and (r.value_json ->> 'change_request_id')::uuid = v_open_id
     and (r.value_json ->> 'reused_existing_request')::boolean is true
     and (r.value_json ->> 'event_created')::boolean is true
     and v_event_count = 1 then
    perform pg_temp._p9_request_change_atomic_record(6, 'replay recupera evento ausente coerente', 'PASS', 'evento faltante inserido uma vez');
  else
    perform pg_temp._p9_request_change_atomic_record(6, 'replay recupera evento ausente coerente', 'SUT_FAIL', coalesce(r.message_text, r.value_json::text, 'recuperacao falhou'));
  end if;
  select * into fx from pg_temp._p9_request_change_atomic_fixture where quote_id = ctx.quote_inconsistent;
  insert into public.sales_quote_change_requests(
    quote_id, organization_id, store_id, status, requested_by, request_text
  ) values (
    fx.quote_id, ctx.org_id, ctx.store_id, 'open', 'human', 'open um'
  ) returning id into v_open_id;
  insert into public.sales_quote_change_requests(
    quote_id, organization_id, store_id, status, requested_by, request_text
  ) values (
    fx.quote_id, ctx.org_id, ctx.store_id, 'open', 'human', 'open dois'
  ) returning id into v_second_open_id;
  update public.sales_quotes
  set status = 'changes_requested', last_change_request_id = v_open_id
  where id = fx.quote_id;
  q := pg_temp._p9_request_change_atomic_sql(ctx.org_id, ctx.store_id, fx.quote_id, fx.conversation_id, fx.lead_id, 'retry incoerente');
  select * into r from pg_temp._p9_request_change_atomic_exec_json('service_role', null, q);
  select pg_catalog.count(*)::integer into v_request_count
  from public.sales_quote_change_requests
  where quote_id = fx.quote_id
    and status = 'open';
  v_event_count := pg_temp._p9_request_change_atomic_event_count(ctx.org_id, fx.conversation_id, fx.quote_id);
  if not r.operation_succeeded
     and r.message_text like '%ZION_SALES_QUOTE_CHANGE_REQUEST_INCONSISTENT_OPEN%'
     and v_request_count = 2
     and v_event_count = 0 then
    perform pg_temp._p9_request_change_atomic_record(7, 'estado open incoerente falha fechado', 'PASS', 'nenhuma nova mutacao criada');
  else
    perform pg_temp._p9_request_change_atomic_record(7, 'estado open incoerente falha fechado', 'SUT_FAIL', coalesce(r.message_text, r.value_json::text, 'inconsistencia nao bloqueada'));
  end if;
  if not pg_catalog.has_function_privilege('anon', 'public.request_sales_quote_change_by_system(uuid,uuid,uuid,uuid,uuid,text)', 'EXECUTE')
     and not pg_catalog.has_function_privilege('authenticated', 'public.request_sales_quote_change_by_system(uuid,uuid,uuid,uuid,uuid,text)', 'EXECUTE')
     and pg_catalog.has_function_privilege('service_role', 'public.request_sales_quote_change_by_system(uuid,uuid,uuid,uuid,uuid,text)', 'EXECUTE')
     and (
       select pg_catalog.pg_get_userbyid(proc_row.proowner)
       from pg_catalog.pg_proc proc_row
       where proc_row.oid = pg_catalog.to_regprocedure('public.request_sales_quote_change_by_system(uuid,uuid,uuid,uuid,uuid,text)')
     ) = 'postgres' then
    perform pg_temp._p9_request_change_atomic_record(8, 'grants restritos e owner postgres', 'PASS', 'anon/auth negados service_role permitido');
  else
    perform pg_temp._p9_request_change_atomic_record(8, 'grants restritos e owner postgres', 'SUT_FAIL', 'privilegios ou owner divergentes');
  end if;
  select pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.request_sales_quote_change_by_system(uuid,uuid,uuid,uuid,uuid,text)')
  ) into v_definition;
  v_normalized_definition := pg_catalog.lower(pg_catalog.regexp_replace(coalesce(v_definition, ''), '\s+', ' ', 'g'));
  if v_normalized_definition like '%for update%'
     and v_normalized_definition not like '%update public.leads%' then
    perform pg_temp._p9_request_change_atomic_record(9, 'serializacao por for update sem update direto em leads', 'PASS', 'runner nao exercita concorrencia multissessao; cobre lock e replay sequencial');
  else
    perform pg_temp._p9_request_change_atomic_record(9, 'serializacao por for update sem update direto em leads', 'SUT_FAIL', 'definicao sem lock esperado ou com update em leads');
  end if;
end;
$scenarios$;
select scenario_number, scenario_name, status, detail
from pg_temp._p9_request_change_atomic_results
order by scenario_number;
do $assert_all_passed$
declare
  v_failures text;
begin
  select pg_catalog.string_agg(
    scenario_number::text || ':' || scenario_name || ':' || status || ':' || detail,
    E'\n'
    order by scenario_number
  )
  into v_failures
  from pg_temp._p9_request_change_atomic_results
  where status <> 'PASS';
  if v_failures is not null then
    raise exception using
      errcode = 'P0001',
      message = 'p9 request-change atomic writer manual checks failed',
      detail = v_failures;
  end if;
end;
$assert_all_passed$;
rollback;

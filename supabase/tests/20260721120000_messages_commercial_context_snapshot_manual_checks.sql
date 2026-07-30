-- ZION / Pilar 9 / Fase 4
-- Runner manual do snapshot historico do contexto comercial em public.messages.
--
-- REGRAS:
-- - executar o arquivo inteiro uma unica vez no SQL Editor;
-- - nao executar junto com outros runners do Pilar 9;
-- - nao usa session_replication_role;
-- - nao insere diretamente em public.messages;
-- - cria mensagens somente via public.insert_message() executado como service_role;
-- - todo dado mutavel criado pelo runner e identificado por run_id exclusivo;
-- - cleanup restrito as fixtures do proprio runner;
-- - o trigger trg_conversations_last_message_sync e toggled nominalmente e restaurado.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:messages_commercial_context_snapshot_manual_checks',
    0
  )
);

drop table if exists pg_temp._p9_mccs_results;
drop table if exists pg_temp._p9_mccs_matrix;
drop table if exists pg_temp._p9_mccs_context;
drop table if exists pg_temp._p9_mccs_conversations;
drop table if exists pg_temp._p9_mccs_sessions;
drop table if exists pg_temp._p9_mccs_opportunities;
drop table if exists pg_temp._p9_mccs_state;
drop table if exists pg_temp._p9_mccs_owned_objects;
drop table if exists pg_temp._p9_mccs_baseline_messages;
drop table if exists pg_temp._p9_mccs_baseline_message_states;
drop table if exists pg_temp._p9_mccs_baseline_conversations;

create temp table _p9_mccs_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (
    status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR', 'BLOCKED', 'CLEANUP_FAIL')
  ),
  detail text not null,
  returned_sqlstate text null,
  constraint_name text null,
  postcondition text not null
) on commit preserve rows;

create temp table _p9_mccs_matrix (
  scenario_number integer primary key,
  scenario_name text not null,
  coverage_rule text not null,
  test_role text not null,
  expected_outcome text not null
) on commit preserve rows;

create temp table _p9_mccs_context (
  singleton boolean primary key default true check (singleton),
  run_id uuid not null,
  organization_id uuid null,
  store_id uuid null,
  member_user_id uuid null,
  setup_status text not null default 'NOT_RUN',
  setup_detail text not null default '',
  harness_preflight text not null default 'NOT_RUN',
  cleanup_status text not null default 'NOT_RUN',
  conversations_trigger_was_enabled boolean not null default false,
  context_trigger_was_enabled boolean not null default false,
  fixture_inventory text not null default '',
  object_fingerprint text not null default ''
) on commit preserve rows;

create temp table _p9_mccs_conversations (
  fixture_number integer primary key,
  conversation_id uuid not null unique,
  lead_id uuid not null,
  organization_id uuid not null,
  store_id uuid not null,
  customer_id uuid not null,
  lead_customer_link_id uuid not null
) on commit preserve rows;

create temp table _p9_mccs_sessions (
  fixture_number integer primary key,
  session_id uuid not null unique,
  conversation_id uuid not null unique
) on commit preserve rows;

create temp table _p9_mccs_opportunities (
  fixture_number integer primary key,
  opportunity_id uuid not null unique,
  customer_id uuid not null
) on commit preserve rows;

create temp table _p9_mccs_state (
  state_key text primary key,
  value_uuid uuid null,
  value_text text null
) on commit preserve rows;

create temp table _p9_mccs_owned_objects (
  object_type text not null,
  object_id uuid not null,
  primary key (object_type, object_id)
) on commit preserve rows;

create temp table _p9_mccs_baseline_messages (
  message_id uuid primary key,
  row_json jsonb not null,
  initial_capture_state text null,
  initial_session_id uuid null,
  initial_context_link_id uuid null
) on commit preserve rows;

create temp table _p9_mccs_baseline_message_states (
  capture_state text primary key,
  row_count bigint not null
) on commit preserve rows;

create temp table _p9_mccs_baseline_conversations (
  conversation_id uuid primary key,
  row_json jsonb not null
) on commit preserve rows;

insert into _p9_mccs_context (run_id) values (gen_random_uuid());

insert into _p9_mccs_matrix (
  scenario_number,
  scenario_name,
  coverage_rule,
  test_role,
  expected_outcome
) values
  (1, 'contrato estrutural', '20 colunas, 3 novas colunas, check completo, 2 FKs compostas, 3 indices exatos, trigger de fill enabled, 4 RPCs com assinatura e return type exatos', 'postgres', 'PASS quando o contrato estrutural aprovado permanece intacto'),
  (2, 'mensagens legadas', 'baseline completo de todas as mensagens preexistentes permanece identico; linhas inicialmente legacy_unknown mantem ids nulos', 'postgres', 'PASS quando nenhuma mensagem preexistente e alterada'),
  (3, 'nova mensagem sem sessao ativa', 'insert_message por service_role gera no_active_session sem ids historicos', 'service_role', 'PASS quando a linha sai sem sessao ativa'),
  (4, 'nova mensagem com sessao ativa e sem contexto', 'insert_message por service_role gera pending_context com session_id e sem context_link', 'service_role', 'PASS quando a linha captura apenas a sessao'),
  (5, 'nova mensagem com sessao e contexto ativo', 'insert_message por service_role gera captured com session_id e context_link corretos', 'service_role', 'PASS quando o snapshot nasce capturado'),
  (6, 'fechamento posterior do contexto', 'fechar o contexto depois do insert nao recalcula o snapshot ja capturado', 'service_role', 'PASS quando a mensagem preserva o mesmo context link'),
  (7, 'substituicao de contexto', 'mensagem antiga continua no contexto antigo; nova mensagem vai para o novo contexto', 'service_role', 'PASS quando exatamente um contexto ativo permanece'),
  (8, 'imutabilidade', 'tentativas separadas de alterar os 3 campos do snapshot falham com P0001 e mensagem exata', 'postgres', 'PASS quando o snapshot e imutavel'),
  (9, 'atualizacoes permitidas', 'mark_message_external_sent e delivery/read nao alteram o snapshot', 'service_role', 'PASS quando os campos operacionais seguem funcionando'),
  (10, 'idempotencia externa', 'segundo insert_message com mesmo external_message_id falha com 23505 e nao cria segunda mensagem', 'service_role', 'PASS quando a duplicidade e bloqueada sem segunda linha'),
  (11, 'escopo composto', 'catalogo das duas FKs compostas com ordem exata das colunas e tentativa cruzada bloqueada pela imutabilidade', 'postgres', 'PASS quando o escopo composto e a imutabilidade permanecem corretos'),
  (12, 'cleanup e fingerprint', 'remove apenas fixtures do runner, restaura dois triggers nominais e preserva fingerprint e baselines', 'postgres', 'PASS quando nao ha residuos');

create or replace function pg_temp._p9_mccs_identity_is_clean()
returns boolean
language sql
stable
as $function$
  select
    current_user = 'postgres'
    and session_user = 'postgres'
    and nullif(current_setting('request.jwt.claim.sub', true), '') is null
    and nullif(current_setting('request.jwt.claim.role', true), '') is null
    and nullif(current_setting('request.jwt.claims', true), '') is null
$function$;

create or replace function pg_temp._p9_mccs_exec_scalar(
  p_role text,
  p_user_id uuid,
  p_sql text
)
returns table (
  operation_succeeded boolean,
  value_text text,
  returned_sqlstate text,
  message_text text,
  detail_text text,
  hint_text text,
  constraint_name text,
  identity_clean boolean,
  harness_error text
)
language plpgsql
as $function$
declare
  v_value text;
  v_ok boolean := false;
  v_state text;
  v_message text;
  v_detail text;
  v_hint text;
  v_constraint text;
  v_identity_clean boolean := false;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    return query
    select false, null::text, null::text, null::text, null::text,
           null::text, null::text, false, 'helper caller is not postgres'::text;
    return;
  end if;

  if p_role not in ('postgres', 'service_role', 'authenticated', 'anon') then
    return query
    select false, null::text, null::text, null::text, null::text,
           null::text, null::text, true, 'unsupported test role'::text;
    return;
  end if;

  if p_role = 'authenticated' and p_user_id is null then
    return query
    select false, null::text, null::text, null::text, null::text,
           null::text, null::text, true, 'authenticated execution requires user id'::text;
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
        else jsonb_build_object('sub', p_user_id::text, 'role', p_role)::text
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
        v_detail = pg_exception_detail,
        v_hint = pg_exception_hint,
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

  v_identity_clean := pg_temp._p9_mccs_identity_is_clean();

  return query
  select
    v_ok,
    case when v_ok then v_value else null end,
    v_state,
    v_message,
    v_detail,
    v_hint,
    v_constraint,
    v_identity_clean,
    case when v_identity_clean then null else 'helper did not restore postgres identity' end;
exception
  when others then
    begin
      execute 'reset role';
    exception when others then null;
    end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    return query
    select false, null::text, null::text, null::text, null::text,
           null::text, null::text, pg_temp._p9_mccs_identity_is_clean(),
           'runner helper internal error: ' || sqlstate || ': ' || sqlerrm;
end;
$function$;

create or replace function pg_temp._p9_mccs_object_fingerprint()
returns text
language sql
stable
as $function$
  with fingerprint_parts as (
    select 'column'::text as object_type,
           column_name as object_name,
           concat_ws('|', ordinal_position::text, data_type, is_nullable, coalesce(column_default, '')) as definition
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'messages'

    union all

    select 'constraint',
           con.conname,
           pg_get_constraintdef(con.oid, true)
    from pg_constraint con
    where con.conrelid = 'public.messages'::regclass
      and con.conname in (
        'messages_commercial_context_state_check',
        'messages_conversation_session_scope_fkey',
        'messages_context_link_scope_fkey'
      )

    union all

    select 'index',
           indexname,
           indexdef
    from pg_indexes
    where schemaname = 'public'
      and (
        (tablename = 'messages' and indexname in (
          'messages_org_store_session_created_idx',
          'messages_org_store_ctx_link_created_idx'
        ))
        or (tablename = 'conversation_sessions' and indexname = 'conversation_sessions_id_org_store_conv_uidx')
      )

    union all

    select 'trigger',
           trigger_row.tgname,
           concat_ws('|',
             pg_get_triggerdef(trigger_row.oid, true),
             trigger_row.tgfoid::regprocedure::text,
             trigger_row.tgtype::text,
             trigger_row.tgenabled
           )
    from pg_trigger trigger_row
    where trigger_row.tgrelid in ('public.messages'::regclass, 'public.conversations'::regclass)
      and not trigger_row.tgisinternal
      and trigger_row.tgname in (
        'trg_fill_messages_lead_store',
        'trg_conversations_last_message_sync'
      )

    union all

    select 'trigger',
           trigger_row.tgname,
           concat_ws('|',
             pg_get_triggerdef(trigger_row.oid, true),
             trigger_row.tgfoid::regprocedure::text,
             trigger_row.tgtype::text,
             trigger_row.tgenabled
           )
    from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.commercial_session_context_links'::regclass
      and not trigger_row.tgisinternal
      and trigger_row.tgname = 'commercial_session_context_links_enforce_write_rules'

    union all

    select 'function',
           p.oid::regprocedure::text,
           pg_get_functiondef(p.oid)
    from pg_proc p
    join pg_namespace n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'fill_messages_lead_store_from_conversation',
        'insert_message',
        'panel_send_message',
        'panel_send_message_scoped',
        'mark_message_external_sent'
      )
  )
  select md5(string_agg(object_type || '|' || object_name || '|' || coalesce(definition, ''), '||' order by object_type, object_name))
  from fingerprint_parts
$function$;

do $setup$
declare
  v_run uuid;
  v_org uuid;
  v_store uuid;
  v_member uuid;
  v_selected integer;
  v_exec record;
  v_exec_fail record;
  v_ctx_3 uuid;
  v_ctx_4 uuid;
  v_ctx_5_old uuid;
  v_ctx_6 uuid;
  v_fp_before text;
  v_fp_after text;
  v_conv_trigger_enabled boolean;
  v_ctx_trigger_enabled boolean;
begin
  select run_id into v_run
  from pg_temp._p9_mccs_context;

  if not pg_temp._p9_mccs_identity_is_clean() then
    update pg_temp._p9_mccs_context
    set setup_status = 'BLOCKED',
        setup_detail = 'postgres identity is not clean before preflight',
        harness_preflight = 'BLOCKED';
    return;
  end if;

  if pg_catalog.to_regclass('public.messages') is null
     or pg_catalog.to_regclass('public.conversations') is null
     or pg_catalog.to_regclass('public.conversation_sessions') is null
     or pg_catalog.to_regclass('public.commercial_session_context_links') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regprocedure('public.insert_message(uuid,text,text,text,text,text,text,jsonb)') is null
     or pg_catalog.to_regprocedure('public.panel_send_message(uuid,text,text,text)') is null
     or pg_catalog.to_regprocedure('public.panel_send_message_scoped(uuid,uuid,text)') is null
     or pg_catalog.to_regprocedure('public.mark_message_external_sent(uuid,text)') is null
     or pg_catalog.to_regprocedure('public.link_commercial_session_context(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,uuid,jsonb,timestamp with time zone)') is null
     or pg_catalog.to_regprocedure('public.close_commercial_session_context_link(uuid,uuid,uuid,text,uuid,text,text,jsonb,uuid)') is null
     or pg_catalog.to_regprocedure('public.replace_commercial_session_context_link(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,uuid,jsonb,text,text,jsonb,timestamp with time zone)') is null then
    update pg_temp._p9_mccs_context
    set setup_status = 'BLOCKED',
        setup_detail = 'required tables, triggers or approved RPC signatures are missing',
        harness_preflight = 'BLOCKED';
    return;
  end if;

  select exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.conversations'::regclass
      and not tgisinternal
      and tgname = 'trg_conversations_last_message_sync'
      and tgenabled = 'O'
  ) into v_conv_trigger_enabled;

  select exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.commercial_session_context_links'::regclass
      and not tgisinternal
      and tgname = 'commercial_session_context_links_enforce_write_rules'
      and tgenabled = 'O'
  ) into v_ctx_trigger_enabled;

  if not v_conv_trigger_enabled or not v_ctx_trigger_enabled then
    update pg_temp._p9_mccs_context
    set setup_status = 'BLOCKED',
        setup_detail = 'required named triggers are missing or not enabled before preflight',
        harness_preflight = 'BLOCKED';
    return;
  end if;

  v_fp_before := pg_temp._p9_mccs_object_fingerprint();

  select * into v_exec
  from pg_temp._p9_mccs_exec_scalar(
    'service_role',
    null,
    $$select has_function_privilege(
         'service_role',
         'public.insert_message(uuid,text,text,text,text,text,text,jsonb)',
         'EXECUTE'
       )::text$$
  );

  select * into v_exec_fail
  from pg_temp._p9_mccs_exec_scalar(
    'service_role',
    null,
    'select (1/0)::text'
  );

  if v_exec.harness_error is not null
     or not v_exec.identity_clean
     or not v_exec.operation_succeeded
     or v_exec.value_text <> 'true'
     or v_exec_fail.harness_error is not null
     or not v_exec_fail.identity_clean
     or v_exec_fail.operation_succeeded
     or v_exec_fail.returned_sqlstate <> '22012' then
    update pg_temp._p9_mccs_context
    set setup_status = 'BLOCKED',
        setup_detail = 'helper or service_role execution preflight failed',
        harness_preflight = 'BLOCKED';
    return;
  end if;

  execute 'alter table public.conversations disable trigger trg_conversations_last_message_sync';
  execute 'alter table public.conversations enable trigger trg_conversations_last_message_sync';
  execute 'alter table public.commercial_session_context_links disable trigger commercial_session_context_links_enforce_write_rules';
  execute 'alter table public.commercial_session_context_links enable trigger commercial_session_context_links_enforce_write_rules';

  v_fp_after := pg_temp._p9_mccs_object_fingerprint();

  if v_fp_after is distinct from v_fp_before then
    update pg_temp._p9_mccs_context
    set setup_status = 'BLOCKED',
        setup_detail = 'trigger toggle preflight changed the structural fingerprint unexpectedly',
        harness_preflight = 'BLOCKED';
    return;
  end if;

  insert into pg_temp._p9_mccs_baseline_messages (
    message_id,
    row_json,
    initial_capture_state,
    initial_session_id,
    initial_context_link_id
  )
  select
    m.id,
    to_jsonb(m),
    m.commercial_context_capture_state,
    m.conversation_session_id,
    m.commercial_session_context_link_id
  from public.messages m;

  insert into pg_temp._p9_mccs_baseline_message_states (capture_state, row_count)
  select coalesce(m.commercial_context_capture_state, '<null>'), count(*)
  from public.messages m
  group by coalesce(m.commercial_context_capture_state, '<null>');

  with one_conversation_per_lead as (
    select
      c.id as conversation_id,
      l.id as lead_id,
      c.organization_id,
      l.store_id,
      link_row.id as lead_customer_link_id,
      link_row.customer_id,
      row_number() over (partition by l.id order by c.id) as lead_conversation_rank,
      row_number() over (partition by link_row.customer_id order by l.id, c.id) as customer_rank
    from public.conversations c
    join public.leads l
      on l.id = c.lead_id
     and l.organization_id = c.organization_id
    join public.lead_customer_links link_row
      on link_row.lead_id = l.id
     and link_row.organization_id = l.organization_id
     and link_row.store_id = l.store_id
     and link_row.status = 'active'
    join public.customers customer_row
      on customer_row.id = link_row.customer_id
     and customer_row.organization_id = link_row.organization_id
     and customer_row.merged_into_customer_id is null
    where l.store_id is not null
      and not exists (
        select 1
        from public.conversation_sessions session_row
        where session_row.organization_id = c.organization_id
          and session_row.store_id = l.store_id
          and session_row.conversation_id = c.id
          and session_row.status = 'active'
      )
  ),
  inventory as (
    select organization_id, store_id, count(*) as safe_count
    from one_conversation_per_lead
    where lead_conversation_rank = 1
      and customer_rank = 1
    group by organization_id, store_id
  )
  select inventory.organization_id, inventory.store_id
  into v_org, v_store
  from inventory
  where inventory.safe_count >= 6
    and exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = inventory.organization_id
        and membership_row.user_id is not null
    )
  order by inventory.safe_count desc, inventory.organization_id, inventory.store_id
  limit 1;

  if v_org is null or v_store is null then
    update pg_temp._p9_mccs_context
    set setup_status = 'BLOCKED',
        setup_detail = 'no safe org/store inventory with six distinct eligible conversations and membership',
        harness_preflight = 'BLOCKED';
    return;
  end if;

  with eligible as (
    select
      c.id as conversation_id,
      l.id as lead_id,
      c.organization_id,
      l.store_id,
      link_row.id as lead_customer_link_id,
      link_row.customer_id,
      row_number() over (partition by l.id order by c.id) as lead_conversation_rank,
      row_number() over (partition by link_row.customer_id order by l.id, c.id) as customer_rank
    from public.conversations c
    join public.leads l
      on l.id = c.lead_id
     and l.organization_id = c.organization_id
    join public.lead_customer_links link_row
      on link_row.lead_id = l.id
     and link_row.organization_id = l.organization_id
     and link_row.store_id = l.store_id
     and link_row.status = 'active'
    join public.customers customer_row
      on customer_row.id = link_row.customer_id
     and customer_row.organization_id = link_row.organization_id
     and customer_row.merged_into_customer_id is null
    where c.organization_id = v_org
      and l.store_id = v_store
      and not exists (
        select 1
        from public.conversation_sessions session_row
        where session_row.organization_id = c.organization_id
          and session_row.store_id = l.store_id
          and session_row.conversation_id = c.id
          and session_row.status = 'active'
      )
  ),
  selected as (
    select *
    from eligible
    where lead_conversation_rank = 1
      and customer_rank = 1
    order by lead_id, conversation_id
    limit 6
  )
  insert into pg_temp._p9_mccs_conversations (
    fixture_number,
    conversation_id,
    lead_id,
    organization_id,
    store_id,
    customer_id,
    lead_customer_link_id
  )
  select
    row_number() over (order by lead_id, conversation_id)::integer,
    conversation_id,
    lead_id,
    organization_id,
    store_id,
    customer_id,
    lead_customer_link_id
  from selected;

  select count(*) into v_selected
  from pg_temp._p9_mccs_conversations;

  if v_selected <> 6 then
    update pg_temp._p9_mccs_context
    set setup_status = 'BLOCKED',
        setup_detail = 'eligible conversation inventory changed during fixture selection',
        harness_preflight = 'BLOCKED';
    return;
  end if;

  insert into pg_temp._p9_mccs_baseline_conversations (conversation_id, row_json)
  select c.id, to_jsonb(c)
  from public.conversations c
  join pg_temp._p9_mccs_conversations fixture
    on fixture.conversation_id = c.id;

  select membership_row.user_id
  into v_member
  from public.memberships membership_row
  where membership_row.organization_id = v_org
    and membership_row.user_id is not null
  order by membership_row.created_at, membership_row.user_id
  limit 1;

  if v_member is null then
    update pg_temp._p9_mccs_context
    set setup_status = 'BLOCKED',
        setup_detail = 'target organization has no reusable membership user',
        harness_preflight = 'BLOCKED';
    return;
  end if;

  insert into pg_temp._p9_mccs_opportunities (fixture_number, opportunity_id, customer_id)
  select fixture_number, gen_random_uuid(), customer_id
  from pg_temp._p9_mccs_conversations;

  insert into pg_temp._p9_mccs_owned_objects
  select 'commercial_opportunities', opportunity_id
  from pg_temp._p9_mccs_opportunities;

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    origin_lead_id,
    primary_conversation_id,
    stage
  )
  select
    opportunity_id,
    v_org,
    v_store,
    customer_id,
    conversation_row.lead_id,
    conversation_row.conversation_id,
    'qualificacao'
  from pg_temp._p9_mccs_opportunities opportunity_row
  join pg_temp._p9_mccs_conversations conversation_row
    on conversation_row.fixture_number = opportunity_row.fixture_number;

  if (select count(*) from public.commercial_opportunities opportunity_row
      join pg_temp._p9_mccs_owned_objects owned
        on owned.object_type = 'commercial_opportunities'
       and owned.object_id = opportunity_row.id) <> 6 then
    update pg_temp._p9_mccs_context
    set setup_status = 'BLOCKED',
        setup_detail = 'runner-owned opportunities were not created correctly',
        harness_preflight = 'BLOCKED';
    return;
  end if;

  insert into pg_temp._p9_mccs_sessions (fixture_number, session_id, conversation_id)
  select fixture_number, gen_random_uuid(), conversation_id
  from pg_temp._p9_mccs_conversations
  where fixture_number between 2 and 6;

  insert into pg_temp._p9_mccs_owned_objects
  select 'conversation_sessions', session_id
  from pg_temp._p9_mccs_sessions;

  insert into public.conversation_sessions (
    id,
    organization_id,
    store_id,
    conversation_id,
    status
  )
  select session_id, v_org, v_store, conversation_id, 'active'
  from pg_temp._p9_mccs_sessions;

  if (select count(*) from public.conversation_sessions session_row
      join pg_temp._p9_mccs_owned_objects owned
        on owned.object_type = 'conversation_sessions'
       and owned.object_id = session_row.id) <> 5 then
    update pg_temp._p9_mccs_context
    set setup_status = 'BLOCKED',
        setup_detail = 'runner-owned sessions were not created correctly',
        harness_preflight = 'BLOCKED';
    return;
  end if;

  select * into v_exec
  from pg_temp._p9_mccs_exec_scalar(
    'authenticated',
    v_member,
    format($sql$
      select (
        public.link_commercial_session_context(
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, %L::uuid, %L::uuid,
          'manual', 'human', %L::uuid, 'runner fixture 3',
          %L, %L::uuid,
          jsonb_build_object('runner_run_id', %L, 'fixture', 3),
          clock_timestamp()
        )
      ).id::text
    $sql$,
      v_org,
      v_store,
      (select session_id from pg_temp._p9_mccs_sessions where fixture_number = 3),
      (select customer_id from pg_temp._p9_mccs_conversations where fixture_number = 3),
      (select opportunity_id from pg_temp._p9_mccs_opportunities where fixture_number = 3),
      (select lead_customer_link_id from pg_temp._p9_mccs_conversations where fixture_number = 3),
      v_member,
      'runner:' || v_run::text || ':ctx:3',
      v_run,
      v_run::text
    )
  );
  if v_exec.harness_error is not null or not v_exec.identity_clean or not v_exec.operation_succeeded or v_exec.value_text is null then
    update pg_temp._p9_mccs_context
    set setup_status = 'BLOCKED',
        setup_detail = 'context link fixture 3 creation failed',
        harness_preflight = 'BLOCKED';
    return;
  end if;
  v_ctx_3 := v_exec.value_text::uuid;
  insert into pg_temp._p9_mccs_state values ('context_3_id', v_ctx_3, v_exec.value_text);

  select * into v_exec
  from pg_temp._p9_mccs_exec_scalar(
    'authenticated',
    v_member,
    format($sql$
      select (
        public.link_commercial_session_context(
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, %L::uuid, %L::uuid,
          'manual', 'human', %L::uuid, 'runner fixture 4',
          %L, %L::uuid,
          jsonb_build_object('runner_run_id', %L, 'fixture', 4),
          clock_timestamp()
        )
      ).id::text
    $sql$,
      v_org,
      v_store,
      (select session_id from pg_temp._p9_mccs_sessions where fixture_number = 4),
      (select customer_id from pg_temp._p9_mccs_conversations where fixture_number = 4),
      (select opportunity_id from pg_temp._p9_mccs_opportunities where fixture_number = 4),
      (select lead_customer_link_id from pg_temp._p9_mccs_conversations where fixture_number = 4),
      v_member,
      'runner:' || v_run::text || ':ctx:4',
      v_run,
      v_run::text
    )
  );
  if v_exec.harness_error is not null or not v_exec.identity_clean or not v_exec.operation_succeeded or v_exec.value_text is null then
    update pg_temp._p9_mccs_context
    set setup_status = 'BLOCKED',
        setup_detail = 'context link fixture 4 creation failed',
        harness_preflight = 'BLOCKED';
    return;
  end if;
  v_ctx_4 := v_exec.value_text::uuid;
  insert into pg_temp._p9_mccs_state values ('context_4_id', v_ctx_4, v_exec.value_text);

  select * into v_exec
  from pg_temp._p9_mccs_exec_scalar(
    'authenticated',
    v_member,
    format($sql$
      select (
        public.link_commercial_session_context(
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, %L::uuid, %L::uuid,
          'manual', 'human', %L::uuid, 'runner fixture 5 old',
          %L, %L::uuid,
          jsonb_build_object('runner_run_id', %L, 'fixture', 5, 'phase', 'old'),
          clock_timestamp()
        )
      ).id::text
    $sql$,
      v_org,
      v_store,
      (select session_id from pg_temp._p9_mccs_sessions where fixture_number = 5),
      (select customer_id from pg_temp._p9_mccs_conversations where fixture_number = 5),
      (select opportunity_id from pg_temp._p9_mccs_opportunities where fixture_number = 5),
      (select lead_customer_link_id from pg_temp._p9_mccs_conversations where fixture_number = 5),
      v_member,
      'runner:' || v_run::text || ':ctx:5:old',
      v_run,
      v_run::text
    )
  );
  if v_exec.harness_error is not null or not v_exec.identity_clean or not v_exec.operation_succeeded or v_exec.value_text is null then
    update pg_temp._p9_mccs_context
    set setup_status = 'BLOCKED',
        setup_detail = 'context link fixture 5 creation failed',
        harness_preflight = 'BLOCKED';
    return;
  end if;
  v_ctx_5_old := v_exec.value_text::uuid;
  insert into pg_temp._p9_mccs_state values ('context_5_old_id', v_ctx_5_old, v_exec.value_text);

  select * into v_exec
  from pg_temp._p9_mccs_exec_scalar(
    'authenticated',
    v_member,
    format($sql$
      select (
        public.link_commercial_session_context(
          %L::uuid, %L::uuid, %L::uuid, %L::uuid, %L::uuid, %L::uuid,
          'manual', 'human', %L::uuid, 'runner fixture 6',
          %L, %L::uuid,
          jsonb_build_object('runner_run_id', %L, 'fixture', 6),
          clock_timestamp()
        )
      ).id::text
    $sql$,
      v_org,
      v_store,
      (select session_id from pg_temp._p9_mccs_sessions where fixture_number = 6),
      (select customer_id from pg_temp._p9_mccs_conversations where fixture_number = 6),
      (select opportunity_id from pg_temp._p9_mccs_opportunities where fixture_number = 6),
      (select lead_customer_link_id from pg_temp._p9_mccs_conversations where fixture_number = 6),
      v_member,
      'runner:' || v_run::text || ':ctx:6',
      v_run,
      v_run::text
    )
  );
  if v_exec.harness_error is not null or not v_exec.identity_clean or not v_exec.operation_succeeded or v_exec.value_text is null then
    update pg_temp._p9_mccs_context
    set setup_status = 'BLOCKED',
        setup_detail = 'context link fixture 6 creation failed',
        harness_preflight = 'BLOCKED';
    return;
  end if;
  v_ctx_6 := v_exec.value_text::uuid;
  insert into pg_temp._p9_mccs_state values ('context_6_id', v_ctx_6, v_exec.value_text);

  execute 'alter table public.conversations disable trigger trg_conversations_last_message_sync';

  update pg_temp._p9_mccs_context
  set organization_id = v_org,
      store_id = v_store,
      member_user_id = v_member,
      setup_status = 'PASS',
      setup_detail = 'preflight, baselines and fixtures created successfully',
      harness_preflight = 'PASS',
      conversations_trigger_was_enabled = true,
      context_trigger_was_enabled = true,
      fixture_inventory = format(
        'org=%s | store=%s | baseline_messages=%s | baseline_conversations=6 | opportunities=6 | sessions=5 | contexts=4 | run_id=%s',
        v_org,
        v_store,
        (select count(*) from pg_temp._p9_mccs_baseline_messages),
        v_run
      ),
      object_fingerprint = v_fp_before;
exception
  when others then
    begin
      execute 'alter table public.conversations enable trigger trg_conversations_last_message_sync';
    exception when others then null;
    end;
    begin
      execute 'alter table public.commercial_session_context_links enable trigger commercial_session_context_links_enforce_write_rules';
    exception when others then null;
    end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    update pg_temp._p9_mccs_context
    set setup_status = 'HARNESS_ERROR',
        setup_detail = 'setup error: ' || sqlstate || ': ' || sqlerrm,
        harness_preflight = 'HARNESS_ERROR';
end;
$setup$;

do $scenario_1$
declare
  v_ok boolean;
begin
  if (select setup_status from pg_temp._p9_mccs_context) <> 'PASS' then
    insert into pg_temp._p9_mccs_results values
      (1, 'contrato estrutural', 'BLOCKED',
       (select setup_detail from pg_temp._p9_mccs_context),
       null, null, 'preflight did not authorize structural validation');
    return;
  end if;

  select
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'messages') = 20
    and exists (
      select 1
      from (
        values
          ('conversation_session_id'::text, 'uuid'::text, 'YES'::text, null::text),
          ('commercial_session_context_link_id'::text, 'uuid'::text, 'YES'::text, null::text),
          ('commercial_context_capture_state'::text, 'text'::text, 'NO'::text, '''legacy_unknown''::text'::text)
      ) expected(column_name, data_type, is_nullable, default_value)
      join information_schema.columns column_row
        on column_row.table_schema = 'public'
       and column_row.table_name = 'messages'
       and column_row.column_name = expected.column_name
      where column_row.data_type = expected.data_type
        and column_row.is_nullable = expected.is_nullable
        and (
          (expected.default_value is null and column_row.column_default is null)
          or (expected.default_value is not null and lower(coalesce(column_row.column_default, '')) = lower(expected.default_value))
        )
      group by 1
      having count(*) = 3
    )
    and exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid = 'public.messages'::regclass
        and constraint_row.conname = 'messages_commercial_context_state_check'
        and constraint_row.contype = 'c'
        and strpos(lower(pg_get_constraintdef(constraint_row.oid)), 'legacy_unknown') > 0
        and strpos(lower(pg_get_constraintdef(constraint_row.oid)), 'no_active_session') > 0
        and strpos(lower(pg_get_constraintdef(constraint_row.oid)), 'pending_context') > 0
        and strpos(lower(pg_get_constraintdef(constraint_row.oid)), 'captured') > 0
        and strpos(lower(pg_get_constraintdef(constraint_row.oid)), 'conversation_session_id is null') > 0
        and strpos(lower(pg_get_constraintdef(constraint_row.oid)), 'commercial_session_context_link_id is null') > 0
        and strpos(lower(pg_get_constraintdef(constraint_row.oid)), 'conversation_session_id is not null') > 0
        and strpos(lower(pg_get_constraintdef(constraint_row.oid)), 'commercial_session_context_link_id is not null') > 0
    )
    and exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid = 'public.messages'::regclass
        and constraint_row.conname = 'messages_conversation_session_scope_fkey'
        and constraint_row.contype = 'f'
        and constraint_row.confrelid = 'public.conversation_sessions'::regclass
        and constraint_row.confdeltype = 'r'
        and (
          select array_agg(att.attname order by key_column.ordinality)
          from unnest(constraint_row.conkey) with ordinality as key_column(attnum, ordinality)
          join pg_attribute att
            on att.attrelid = constraint_row.conrelid
           and att.attnum = key_column.attnum
        ) = array['conversation_session_id', 'organization_id', 'store_id', 'conversation_id']::text[]
        and (
          select array_agg(att.attname order by key_column.ordinality)
          from unnest(constraint_row.confkey) with ordinality as key_column(attnum, ordinality)
          join pg_attribute att
            on att.attrelid = constraint_row.confrelid
           and att.attnum = key_column.attnum
        ) = array['id', 'organization_id', 'store_id', 'conversation_id']::text[]
    )
    and exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid = 'public.messages'::regclass
        and constraint_row.conname = 'messages_context_link_scope_fkey'
        and constraint_row.contype = 'f'
        and constraint_row.confrelid = 'public.commercial_session_context_links'::regclass
        and constraint_row.confdeltype = 'r'
        and (
          select array_agg(att.attname order by key_column.ordinality)
          from unnest(constraint_row.conkey) with ordinality as key_column(attnum, ordinality)
          join pg_attribute att
            on att.attrelid = constraint_row.conrelid
           and att.attnum = key_column.attnum
        ) = array['commercial_session_context_link_id', 'organization_id', 'store_id', 'conversation_session_id']::text[]
        and (
          select array_agg(att.attname order by key_column.ordinality)
          from unnest(constraint_row.confkey) with ordinality as key_column(attnum, ordinality)
          join pg_attribute att
            on att.attrelid = constraint_row.confrelid
           and att.attnum = key_column.attnum
        ) = array['id', 'organization_id', 'store_id', 'conversation_session_id']::text[]
    )
    and exists (
      select 1
      from pg_index index_row
      join pg_class index_relation on index_relation.oid = index_row.indexrelid
      where index_relation.relname = 'conversation_sessions_id_org_store_conv_uidx'
        and index_row.indisunique
        and index_row.indisvalid
        and index_row.indpred is null
        and (
          select array_agg(att.attname order by key_column.ordinality)
          from unnest(index_row.indkey::smallint[]) with ordinality as key_column(attnum, ordinality)
          join pg_attribute att on att.attrelid = index_row.indrelid and att.attnum = key_column.attnum
        ) = array['id', 'organization_id', 'store_id', 'conversation_id']::text[]
    )
    and exists (
      select 1
      from pg_index index_row
      join pg_class index_relation on index_relation.oid = index_row.indexrelid
      where index_relation.relname = 'messages_org_store_session_created_idx'
        and not index_row.indisunique
        and index_row.indisvalid
        and regexp_replace(lower(pg_get_expr(index_row.indpred, index_row.indrelid)), '[[:space:]()]', '', 'g') = 'conversation_session_idisnotnull'
        and (
          select array_agg(att.attname order by key_column.ordinality)
          from unnest(index_row.indkey::smallint[]) with ordinality as key_column(attnum, ordinality)
          join pg_attribute att on att.attrelid = index_row.indrelid and att.attnum = key_column.attnum
        ) = array['organization_id', 'store_id', 'conversation_session_id', 'created_at']::text[]
    )
    and exists (
      select 1
      from pg_index index_row
      join pg_class index_relation on index_relation.oid = index_row.indexrelid
      where index_relation.relname = 'messages_org_store_ctx_link_created_idx'
        and not index_row.indisunique
        and index_row.indisvalid
        and regexp_replace(lower(pg_get_expr(index_row.indpred, index_row.indrelid)), '[[:space:]()]', '', 'g') = 'commercial_session_context_link_idisnotnull'
        and (
          select array_agg(att.attname order by key_column.ordinality)
          from unnest(index_row.indkey::smallint[]) with ordinality as key_column(attnum, ordinality)
          join pg_attribute att on att.attrelid = index_row.indrelid and att.attnum = key_column.attnum
        ) = array['organization_id', 'store_id', 'commercial_session_context_link_id', 'created_at']::text[]
    )
    and exists (
      select 1
      from pg_trigger
      where tgrelid = 'public.messages'::regclass
        and not tgisinternal
        and tgname = 'trg_fill_messages_lead_store'
        and tgenabled = 'O'
    )
    and exists (
      select 1
      from pg_proc p
      where p.oid = 'public.fill_messages_lead_store_from_conversation()'::regprocedure
        and exists (
          select 1
          from unnest(coalesce(p.proconfig, '{}'::text[])) config_entry
          where config_entry = 'search_path=public, pg_temp'
        )
    )
    and not exists (
      select 1
      from (
        values
          (
            'public.insert_message(uuid,text,text,text,text,text,text,jsonb)'::text,
            'public.messages'::text
          ),
          (
            'public.panel_send_message(uuid,text,text,text)'::text,
            'uuid'::text
          ),
          (
            'public.panel_send_message_scoped(uuid,uuid,text)'::text,
            'public.messages'::text
          ),
          (
            'public.mark_message_external_sent(uuid,text)'::text,
            'jsonb'::text
          )
      ) expected(regprocedure_text, result_signature)
      full outer join (
        select
          p.oid::regprocedure::text as regprocedure_text,
          pg_get_function_result(p.oid) as result_signature
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in (
            'insert_message',
            'panel_send_message',
            'panel_send_message_scoped',
            'mark_message_external_sent'
          )
      ) actual
        on actual.regprocedure_text = expected.regprocedure_text
       and actual.result_signature = expected.result_signature
      where expected.regprocedure_text is null
         or actual.regprocedure_text is null
    )
  into v_ok;

  insert into pg_temp._p9_mccs_results values (
    1,
    'contrato estrutural',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    case when v_ok
      then 'approved structural contract remains intact'
      else 'one or more exact structural contract checks diverged'
    end,
    null,
    null,
    'schema, triggers, indexes and exact RPC signatures stay aligned with the approved contract'
  );
exception
  when others then
    insert into pg_temp._p9_mccs_results values
      (1, 'contrato estrutural', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'structural validation aborted unexpectedly');
end;
$scenario_1$;

do $scenario_2$
declare
  v_missing bigint;
  v_changed bigint;
  v_initial_legacy_invalid bigint;
begin
  if (select setup_status from pg_temp._p9_mccs_context) <> 'PASS' then
    insert into pg_temp._p9_mccs_results values
      (2, 'mensagens legadas', 'BLOCKED',
       (select setup_detail from pg_temp._p9_mccs_context),
       null, null, 'legacy validation not executed');
    return;
  end if;

  select count(*) into v_missing
  from pg_temp._p9_mccs_baseline_messages baseline
  left join public.messages m
    on m.id = baseline.message_id
  where m.id is null;

  select count(*) into v_changed
  from pg_temp._p9_mccs_baseline_messages baseline
  join public.messages m
    on m.id = baseline.message_id
  where to_jsonb(m) is distinct from baseline.row_json;

  select count(*) into v_initial_legacy_invalid
  from pg_temp._p9_mccs_baseline_messages baseline
  join public.messages m
    on m.id = baseline.message_id
  where baseline.initial_capture_state = 'legacy_unknown'
    and (m.conversation_session_id is not null or m.commercial_session_context_link_id is not null);

  insert into pg_temp._p9_mccs_results values (
    2,
    'mensagens legadas',
    case when v_missing = 0 and v_changed = 0 and v_initial_legacy_invalid = 0
      then 'PASS' else 'SUT_FAIL' end,
    format(
      'baseline_messages=%s | missing=%s | changed=%s | initial_legacy_rows_with_non_null_ids=%s',
      (select count(*) from pg_temp._p9_mccs_baseline_messages),
      v_missing,
      v_changed,
      v_initial_legacy_invalid
    ),
    null,
    null,
    'all preexisting messages still exist unchanged, and only rows that started as legacy_unknown are required to keep both historical ids null'
  );
exception
  when others then
    insert into pg_temp._p9_mccs_results values
      (2, 'mensagens legadas', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'legacy baseline comparison aborted unexpectedly');
end;
$scenario_2$;

do $scenario_3$
declare
  v_run uuid;
  v_exec record;
  v_message_id uuid;
begin
  if (select setup_status from pg_temp._p9_mccs_context) <> 'PASS' then
    insert into pg_temp._p9_mccs_results values
      (3, 'nova mensagem sem sessao ativa', 'BLOCKED',
       (select setup_detail from pg_temp._p9_mccs_context),
       null, null, 'insert_message not executed');
    return;
  end if;

  select run_id into v_run from pg_temp._p9_mccs_context;

  select * into v_exec
  from pg_temp._p9_mccs_exec_scalar(
    'service_role',
    null,
    format($sql$
      select (public.insert_message(
        %L::uuid,
        'human',
        'outgoing',
        'text',
        %L,
        null,
        null,
        jsonb_build_object('runner_run_id', %L, 'scenario', 3)
      )).id::text
    $sql$,
      (select conversation_id from pg_temp._p9_mccs_conversations where fixture_number = 1),
      'runner scenario 3 ' || v_run::text,
      v_run::text
    )
  );

  v_message_id := nullif(v_exec.value_text, '')::uuid;
  insert into pg_temp._p9_mccs_state values ('message_3_id', v_message_id, v_exec.value_text)
  on conflict (state_key) do update set value_uuid = excluded.value_uuid, value_text = excluded.value_text;

  insert into pg_temp._p9_mccs_results values (
    3,
    'nova mensagem sem sessao ativa',
    case when v_exec.harness_error is null
           and v_exec.identity_clean
           and v_exec.operation_succeeded
           and exists (
             select 1
             from public.messages
             where id = v_message_id
               and commercial_context_capture_state = 'no_active_session'
               and conversation_session_id is null
               and commercial_session_context_link_id is null
           )
         then 'PASS' else 'SUT_FAIL' end,
    format(
      'message_id=%s | helper_ok=%s | helper_state=%s',
      v_message_id,
      coalesce(v_exec.operation_succeeded::text, '<null>'),
      coalesce(v_exec.harness_error, '<null>')
    ),
    v_exec.returned_sqlstate,
    v_exec.constraint_name,
    'new outgoing message snapshots no_active_session with null historical ids'
  );
exception
  when others then
    insert into pg_temp._p9_mccs_results values
      (3, 'nova mensagem sem sessao ativa', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario 3 aborted unexpectedly');
end;
$scenario_3$;

do $scenario_4$
declare
  v_run uuid;
  v_exec record;
  v_message_id uuid;
  v_session_id uuid;
begin
  if (select setup_status from pg_temp._p9_mccs_context) <> 'PASS' then
    insert into pg_temp._p9_mccs_results values
      (4, 'nova mensagem com sessao ativa e sem contexto', 'BLOCKED',
       (select setup_detail from pg_temp._p9_mccs_context),
       null, null, 'insert_message not executed');
    return;
  end if;

  select run_id into v_run from pg_temp._p9_mccs_context;
  select session_id into v_session_id from pg_temp._p9_mccs_sessions where fixture_number = 2;

  select * into v_exec
  from pg_temp._p9_mccs_exec_scalar(
    'service_role',
    null,
    format($sql$
      select (public.insert_message(
        %L::uuid,
        'human',
        'outgoing',
        'text',
        %L,
        null,
        null,
        jsonb_build_object('runner_run_id', %L, 'scenario', 4)
      )).id::text
    $sql$,
      (select conversation_id from pg_temp._p9_mccs_conversations where fixture_number = 2),
      'runner scenario 4 ' || v_run::text,
      v_run::text
    )
  );

  v_message_id := nullif(v_exec.value_text, '')::uuid;
  insert into pg_temp._p9_mccs_state values ('message_4_id', v_message_id, v_exec.value_text)
  on conflict (state_key) do update set value_uuid = excluded.value_uuid, value_text = excluded.value_text;

  insert into pg_temp._p9_mccs_results values (
    4,
    'nova mensagem com sessao ativa e sem contexto',
    case when v_exec.harness_error is null
           and v_exec.identity_clean
           and v_exec.operation_succeeded
           and exists (
             select 1
             from public.messages
             where id = v_message_id
               and commercial_context_capture_state = 'pending_context'
               and conversation_session_id = v_session_id
               and commercial_session_context_link_id is null
           )
         then 'PASS' else 'SUT_FAIL' end,
    format('message_id=%s | expected_session_id=%s', v_message_id, v_session_id),
    v_exec.returned_sqlstate,
    v_exec.constraint_name,
    'new outgoing message snapshots the active session without an active context link'
  );
exception
  when others then
    insert into pg_temp._p9_mccs_results values
      (4, 'nova mensagem com sessao ativa e sem contexto', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario 4 aborted unexpectedly');
end;
$scenario_4$;

do $scenario_5$
declare
  v_run uuid;
  v_exec record;
  v_message_id uuid;
  v_session_id uuid;
  v_context_id uuid;
begin
  if (select setup_status from pg_temp._p9_mccs_context) <> 'PASS' then
    insert into pg_temp._p9_mccs_results values
      (5, 'nova mensagem com sessao e contexto ativo', 'BLOCKED',
       (select setup_detail from pg_temp._p9_mccs_context),
       null, null, 'insert_message not executed');
    return;
  end if;

  select run_id into v_run from pg_temp._p9_mccs_context;
  select session_id into v_session_id from pg_temp._p9_mccs_sessions where fixture_number = 3;
  select value_uuid into v_context_id from pg_temp._p9_mccs_state where state_key = 'context_3_id';

  select * into v_exec
  from pg_temp._p9_mccs_exec_scalar(
    'service_role',
    null,
    format($sql$
      select (public.insert_message(
        %L::uuid,
        'human',
        'outgoing',
        'text',
        %L,
        null,
        null,
        jsonb_build_object('runner_run_id', %L, 'scenario', 5)
      )).id::text
    $sql$,
      (select conversation_id from pg_temp._p9_mccs_conversations where fixture_number = 3),
      'runner scenario 5 ' || v_run::text,
      v_run::text
    )
  );

  v_message_id := nullif(v_exec.value_text, '')::uuid;
  insert into pg_temp._p9_mccs_state values ('message_5_id', v_message_id, v_exec.value_text)
  on conflict (state_key) do update set value_uuid = excluded.value_uuid, value_text = excluded.value_text;

  insert into pg_temp._p9_mccs_results values (
    5,
    'nova mensagem com sessao e contexto ativo',
    case when v_exec.harness_error is null
           and v_exec.identity_clean
           and v_exec.operation_succeeded
           and exists (
             select 1
             from public.messages
             where id = v_message_id
               and commercial_context_capture_state = 'captured'
               and conversation_session_id = v_session_id
               and commercial_session_context_link_id = v_context_id
           )
         then 'PASS' else 'SUT_FAIL' end,
    format('message_id=%s | expected_session_id=%s | expected_context_id=%s', v_message_id, v_session_id, v_context_id),
    v_exec.returned_sqlstate,
    v_exec.constraint_name,
    'new outgoing message snapshots both the active session and its active context link'
  );
exception
  when others then
    insert into pg_temp._p9_mccs_results values
      (5, 'nova mensagem com sessao e contexto ativo', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario 5 aborted unexpectedly');
end;
$scenario_5$;

do $scenario_6$
declare
  v_run uuid;
  v_exec_insert record;
  v_exec_close record;
  v_message_id uuid;
  v_context_id uuid;
begin
  if (select setup_status from pg_temp._p9_mccs_context) <> 'PASS' then
    insert into pg_temp._p9_mccs_results values
      (6, 'fechamento posterior do contexto', 'BLOCKED',
       (select setup_detail from pg_temp._p9_mccs_context),
       null, null, 'scenario 6 not executed');
    return;
  end if;

  select run_id into v_run from pg_temp._p9_mccs_context;
  select value_uuid into v_context_id from pg_temp._p9_mccs_state where state_key = 'context_4_id';

  select * into v_exec_insert
  from pg_temp._p9_mccs_exec_scalar(
    'service_role',
    null,
    format($sql$
      select (public.insert_message(
        %L::uuid,
        'human',
        'outgoing',
        'text',
        %L,
        null,
        null,
        jsonb_build_object('runner_run_id', %L, 'scenario', 6)
      )).id::text
    $sql$,
      (select conversation_id from pg_temp._p9_mccs_conversations where fixture_number = 4),
      'runner scenario 6 ' || v_run::text,
      v_run::text
    )
  );

  v_message_id := nullif(v_exec_insert.value_text, '')::uuid;

  select * into v_exec_close
  from pg_temp._p9_mccs_exec_scalar(
    'authenticated',
    (select member_user_id from pg_temp._p9_mccs_context),
    format($sql$
      select (
        public.close_commercial_session_context_link(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'human',
          %L::uuid,
          'runner_close',
          'runner scenario 6 close',
          jsonb_build_object('runner_run_id', %L, 'scenario', 6, 'phase', 'close'),
          %L::uuid
        )
      ).id::text
    $sql$,
      v_context_id,
      (select organization_id from pg_temp._p9_mccs_context),
      (select store_id from pg_temp._p9_mccs_context),
      (select member_user_id from pg_temp._p9_mccs_context),
      v_run::text,
      v_run
    )
  );

  insert into pg_temp._p9_mccs_results values (
    6,
    'fechamento posterior do contexto',
    case when v_exec_insert.harness_error is null
           and v_exec_insert.identity_clean
           and v_exec_insert.operation_succeeded
           and v_exec_close.harness_error is null
           and v_exec_close.identity_clean
           and v_exec_close.operation_succeeded
           and exists (
             select 1
             from public.messages
             where id = v_message_id
               and commercial_context_capture_state = 'captured'
               and commercial_session_context_link_id = v_context_id
           )
         then 'PASS' else 'SUT_FAIL' end,
    format('message_id=%s | closed_context_id=%s', v_message_id, v_context_id),
    coalesce(v_exec_close.returned_sqlstate, v_exec_insert.returned_sqlstate),
    coalesce(v_exec_close.constraint_name, v_exec_insert.constraint_name),
    'a captured message keeps the same context link after that context is later closed'
  );
exception
  when others then
    insert into pg_temp._p9_mccs_results values
      (6, 'fechamento posterior do contexto', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario 6 aborted unexpectedly');
end;
$scenario_6$;

do $scenario_7$
declare
  v_run uuid;
  v_exec_old record;
  v_exec_replace record;
  v_exec_new record;
  v_old_message uuid;
  v_new_message uuid;
  v_old_context uuid;
  v_new_context uuid;
  v_session_id uuid;
begin
  if (select setup_status from pg_temp._p9_mccs_context) <> 'PASS' then
    insert into pg_temp._p9_mccs_results values
      (7, 'substituicao de contexto', 'BLOCKED',
       (select setup_detail from pg_temp._p9_mccs_context),
       null, null, 'scenario 7 not executed');
    return;
  end if;

  select run_id into v_run from pg_temp._p9_mccs_context;
  select value_uuid into v_old_context from pg_temp._p9_mccs_state where state_key = 'context_5_old_id';
  select session_id into v_session_id from pg_temp._p9_mccs_sessions where fixture_number = 5;

  select * into v_exec_old
  from pg_temp._p9_mccs_exec_scalar(
    'service_role',
    null,
    format($sql$
      select (public.insert_message(
        %L::uuid,
        'human',
        'outgoing',
        'text',
        %L,
        null,
        null,
        jsonb_build_object('runner_run_id', %L, 'scenario', 7, 'phase', 'before_replace')
      )).id::text
    $sql$,
      (select conversation_id from pg_temp._p9_mccs_conversations where fixture_number = 5),
      'runner scenario 7 old ' || v_run::text,
      v_run::text
    )
  );
  v_old_message := nullif(v_exec_old.value_text, '')::uuid;

  select * into v_exec_replace
  from pg_temp._p9_mccs_exec_scalar(
    'authenticated',
    (select member_user_id from pg_temp._p9_mccs_context),
    format($sql$
      select (
        public.replace_commercial_session_context_link(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'manual',
          'human',
          %L::uuid,
          'runner scenario 7 replace',
          %L,
          %L::uuid,
          jsonb_build_object('runner_run_id', %L, 'scenario', 7, 'phase', 'new_link'),
          'runner_replace',
          'runner scenario 7 replacement',
          jsonb_build_object('runner_run_id', %L, 'scenario', 7, 'phase', 'close_old'),
          clock_timestamp()
        )
      ).id::text
    $sql$,
      v_old_context,
      (select organization_id from pg_temp._p9_mccs_context),
      (select store_id from pg_temp._p9_mccs_context),
      (select customer_id from pg_temp._p9_mccs_conversations where fixture_number = 5),
      (select opportunity_id from pg_temp._p9_mccs_opportunities where fixture_number = 5),
      (select lead_customer_link_id from pg_temp._p9_mccs_conversations where fixture_number = 5),
      (select member_user_id from pg_temp._p9_mccs_context),
      'runner:' || v_run::text || ':replace:5',
      v_run,
      v_run::text,
      v_run::text
    )
  );
  v_new_context := nullif(v_exec_replace.value_text, '')::uuid;
  insert into pg_temp._p9_mccs_state values ('context_5_new_id', v_new_context, v_exec_replace.value_text)
  on conflict (state_key) do update set value_uuid = excluded.value_uuid, value_text = excluded.value_text;

  select * into v_exec_new
  from pg_temp._p9_mccs_exec_scalar(
    'service_role',
    null,
    format($sql$
      select (public.insert_message(
        %L::uuid,
        'human',
        'outgoing',
        'text',
        %L,
        null,
        null,
        jsonb_build_object('runner_run_id', %L, 'scenario', 7, 'phase', 'after_replace')
      )).id::text
    $sql$,
      (select conversation_id from pg_temp._p9_mccs_conversations where fixture_number = 5),
      'runner scenario 7 new ' || v_run::text,
      v_run::text
    )
  );
  v_new_message := nullif(v_exec_new.value_text, '')::uuid;

  insert into pg_temp._p9_mccs_results values (
    7,
    'substituicao de contexto',
    case when v_exec_old.harness_error is null
           and v_exec_old.identity_clean
           and v_exec_old.operation_succeeded
           and v_exec_replace.harness_error is null
           and v_exec_replace.identity_clean
           and v_exec_replace.operation_succeeded
           and v_exec_new.harness_error is null
           and v_exec_new.identity_clean
           and v_exec_new.operation_succeeded
           and exists (
             select 1 from public.messages
             where id = v_old_message
               and commercial_session_context_link_id = v_old_context
               and conversation_session_id = v_session_id
           )
           and exists (
             select 1 from public.messages
             where id = v_new_message
               and commercial_session_context_link_id = v_new_context
               and conversation_session_id = v_session_id
           )
           and (select count(*) from public.commercial_session_context_links
                where organization_id = (select organization_id from pg_temp._p9_mccs_context)
                  and store_id = (select store_id from pg_temp._p9_mccs_context)
                  and conversation_session_id = v_session_id
                  and status = 'active') = 1
         then 'PASS' else 'SUT_FAIL' end,
    format(
      'old_message=%s | new_message=%s | old_context=%s | new_context=%s',
      v_old_message, v_new_message, v_old_context, v_new_context
    ),
    coalesce(v_exec_replace.returned_sqlstate, v_exec_new.returned_sqlstate, v_exec_old.returned_sqlstate),
    coalesce(v_exec_replace.constraint_name, v_exec_new.constraint_name, v_exec_old.constraint_name),
    'old message keeps the old context and the new message snapshots the replacement context'
  );
exception
  when others then
    insert into pg_temp._p9_mccs_results values
      (7, 'substituicao de contexto', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario 7 aborted unexpectedly');
end;
$scenario_7$;

do $scenario_8$
declare
  v_message_id uuid;
  v_session_id uuid;
  v_context_id uuid;
  v_state text;
  v_sqlstate_1 text;
  v_sqlstate_2 text;
  v_sqlstate_3 text;
  v_msg_1 text;
  v_msg_2 text;
  v_msg_3 text;
begin
  if (select setup_status from pg_temp._p9_mccs_context) <> 'PASS' then
    insert into pg_temp._p9_mccs_results values
      (8, 'imutabilidade', 'BLOCKED',
       (select setup_detail from pg_temp._p9_mccs_context),
       null, null, 'immutability checks not executed');
    return;
  end if;

  select value_uuid into v_message_id from pg_temp._p9_mccs_state where state_key = 'message_5_id';

  select conversation_session_id, commercial_session_context_link_id, commercial_context_capture_state
  into v_session_id, v_context_id, v_state
  from public.messages
  where id = v_message_id;

  begin
    update public.messages set conversation_session_id = null where id = v_message_id;
  exception when others then
    v_sqlstate_1 := sqlstate;
    v_msg_1 := sqlerrm;
  end;

  begin
    update public.messages set commercial_session_context_link_id = null where id = v_message_id;
  exception when others then
    v_sqlstate_2 := sqlstate;
    v_msg_2 := sqlerrm;
  end;

  begin
    update public.messages set commercial_context_capture_state = 'pending_context' where id = v_message_id;
  exception when others then
    v_sqlstate_3 := sqlstate;
    v_msg_3 := sqlerrm;
  end;

  insert into pg_temp._p9_mccs_results values (
    8,
    'imutabilidade',
    case when v_sqlstate_1 = 'P0001'
           and v_sqlstate_2 = 'P0001'
           and v_sqlstate_3 = 'P0001'
           and v_msg_1 = 'messages commercial context snapshot is immutable after insert'
           and v_msg_2 = 'messages commercial context snapshot is immutable after insert'
           and v_msg_3 = 'messages commercial context snapshot is immutable after insert'
           and exists (
             select 1
             from public.messages
             where id = v_message_id
               and conversation_session_id = v_session_id
               and commercial_session_context_link_id = v_context_id
               and commercial_context_capture_state = v_state
           )
         then 'PASS' else 'SUT_FAIL' end,
    format(
      'sqlstate_1=%s | sqlstate_2=%s | sqlstate_3=%s',
      coalesce(v_sqlstate_1, '<null>'),
      coalesce(v_sqlstate_2, '<null>'),
      coalesce(v_sqlstate_3, '<null>')
    ),
    coalesce(v_sqlstate_1, v_sqlstate_2, v_sqlstate_3),
    null,
    'all three immutable snapshot fields reject updates and the row remains unchanged'
  );
exception
  when others then
    insert into pg_temp._p9_mccs_results values
      (8, 'imutabilidade', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario 8 aborted unexpectedly');
end;
$scenario_8$;

do $scenario_9$
declare
  v_run uuid;
  v_exec_insert record;
  v_exec_mark record;
  v_message_id uuid;
  v_session_id uuid;
  v_context_id uuid;
  v_external_id text;
begin
  if (select setup_status from pg_temp._p9_mccs_context) <> 'PASS' then
    insert into pg_temp._p9_mccs_results values
      (9, 'atualizacoes permitidas', 'BLOCKED',
       (select setup_detail from pg_temp._p9_mccs_context),
       null, null, 'allowed updates not executed');
    return;
  end if;

  select run_id into v_run from pg_temp._p9_mccs_context;
  v_external_id := 'runner-ext-' || replace(v_run::text, '-', '') || '-09';

  select * into v_exec_insert
  from pg_temp._p9_mccs_exec_scalar(
    'service_role',
    null,
    format($sql$
      select (public.insert_message(
        %L::uuid,
        'human',
        'outgoing',
        'text',
        %L,
        null,
        null,
        jsonb_build_object('runner_run_id', %L, 'scenario', 9)
      )).id::text
    $sql$,
      (select conversation_id from pg_temp._p9_mccs_conversations where fixture_number = 3),
      'runner scenario 9 ' || v_run::text,
      v_run::text
    )
  );

  v_message_id := nullif(v_exec_insert.value_text, '')::uuid;

  select conversation_session_id, commercial_session_context_link_id
  into v_session_id, v_context_id
  from public.messages
  where id = v_message_id;

  select * into v_exec_mark
  from pg_temp._p9_mccs_exec_scalar(
    'service_role',
    null,
    format(
      'select public.mark_message_external_sent(%L::uuid, %L)::text',
      v_message_id,
      v_external_id
    )
  );

  update public.messages
  set delivered_at = clock_timestamp(),
      read_at = clock_timestamp() + interval '1 second'
  where id = v_message_id;

  insert into pg_temp._p9_mccs_results values (
    9,
    'atualizacoes permitidas',
    case when v_exec_insert.harness_error is null
           and v_exec_insert.identity_clean
           and v_exec_insert.operation_succeeded
           and v_exec_mark.harness_error is null
           and v_exec_mark.identity_clean
           and v_exec_mark.operation_succeeded
           and exists (
             select 1
             from public.messages
             where id = v_message_id
               and external_message_id = v_external_id
               and delivered_at is not null
               and read_at is not null
               and conversation_session_id = v_session_id
               and commercial_session_context_link_id = v_context_id
               and commercial_context_capture_state = 'captured'
           )
         then 'PASS' else 'SUT_FAIL' end,
    format('message_id=%s | external_id=%s', v_message_id, v_external_id),
    coalesce(v_exec_mark.returned_sqlstate, v_exec_insert.returned_sqlstate),
    coalesce(v_exec_mark.constraint_name, v_exec_insert.constraint_name),
    'mark_message_external_sent and delivery/read updates keep the historical snapshot stable'
  );
exception
  when others then
    insert into pg_temp._p9_mccs_results values
      (9, 'atualizacoes permitidas', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario 9 aborted unexpectedly');
end;
$scenario_9$;

do $scenario_10$
declare
  v_run uuid;
  v_exec_1 record;
  v_exec_2 record;
  v_message_1 uuid;
  v_external_id text;
begin
  if (select setup_status from pg_temp._p9_mccs_context) <> 'PASS' then
    insert into pg_temp._p9_mccs_results values
      (10, 'idempotencia externa', 'BLOCKED',
       (select setup_detail from pg_temp._p9_mccs_context),
       null, null, 'duplicate external id test not executed');
    return;
  end if;

  select run_id into v_run from pg_temp._p9_mccs_context;
  v_external_id := 'runner-ext-' || replace(v_run::text, '-', '') || '-dup';

  select * into v_exec_1
  from pg_temp._p9_mccs_exec_scalar(
    'service_role',
    null,
    format($sql$
      select (public.insert_message(
        %L::uuid,
        'human',
        'outgoing',
        'text',
        %L,
        %L,
        null,
        jsonb_build_object('runner_run_id', %L, 'scenario', 10, 'ordinal', 1)
      )).id::text
    $sql$,
      (select conversation_id from pg_temp._p9_mccs_conversations where fixture_number = 3),
      'runner scenario 10 first ' || v_run::text,
      v_external_id,
      v_run::text
    )
  );

  v_message_1 := nullif(v_exec_1.value_text, '')::uuid;

  select * into v_exec_2
  from pg_temp._p9_mccs_exec_scalar(
    'service_role',
    null,
    format($sql$
      select (public.insert_message(
        %L::uuid,
        'human',
        'outgoing',
        'text',
        %L,
        %L,
        null,
        jsonb_build_object('runner_run_id', %L, 'scenario', 10, 'ordinal', 2, 'payload', 'different')
      )).id::text
    $sql$,
      (select conversation_id from pg_temp._p9_mccs_conversations where fixture_number = 3),
      'runner scenario 10 second ' || v_run::text || ' DIFFERENT',
      v_external_id,
      v_run::text
    )
  );

  insert into pg_temp._p9_mccs_results values (
    10,
    'idempotencia externa',
    case when v_exec_1.harness_error is null
           and v_exec_1.identity_clean
           and v_exec_1.operation_succeeded
           and v_exec_2.harness_error is null
           and v_exec_2.identity_clean
           and not v_exec_2.operation_succeeded
           and v_exec_2.returned_sqlstate = '23505'
           and (select count(*) from public.messages where external_message_id = v_external_id) = 1
           and not exists (
             select 1
             from public.messages
             where metadata @> jsonb_build_object('runner_run_id', v_run::text, 'scenario', 10, 'ordinal', 2, 'payload', 'different')
           )
           and exists (
             select 1
             from public.messages
             where id = v_message_1
               and external_message_id = v_external_id
               and commercial_context_capture_state = 'captured'
           )
         then 'PASS' else 'SUT_FAIL' end,
    format(
      'message_1=%s | ext_id=%s | second_sqlstate=%s',
      v_message_1,
      v_external_id,
      coalesce(v_exec_2.returned_sqlstate, '<null>')
    ),
    v_exec_2.returned_sqlstate,
    v_exec_2.constraint_name,
    'the second insert with the same external_message_id fails with 23505 and does not create a second message'
  );
exception
  when others then
    insert into pg_temp._p9_mccs_results values
      (10, 'idempotencia externa', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario 10 aborted unexpectedly');
end;
$scenario_10$;

do $scenario_11$
declare
  v_message_id uuid;
  v_foreign_session uuid;
  v_foreign_context uuid;
  v_sqlstate text;
  v_message text;
  v_fk_ok boolean;
begin
  if (select setup_status from pg_temp._p9_mccs_context) <> 'PASS' then
    insert into pg_temp._p9_mccs_results values
      (11, 'escopo composto', 'BLOCKED',
       (select setup_detail from pg_temp._p9_mccs_context),
       null, null, 'scope protection not executed');
    return;
  end if;

  select value_uuid into v_message_id from pg_temp._p9_mccs_state where state_key = 'message_5_id';
  select session_id into v_foreign_session from pg_temp._p9_mccs_sessions where fixture_number = 6;
  select value_uuid into v_foreign_context from pg_temp._p9_mccs_state where state_key = 'context_6_id';

  select exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.messages'::regclass
      and constraint_row.conname = 'messages_conversation_session_scope_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.conversation_sessions'::regclass
      and constraint_row.confdeltype = 'r'
      and (
        select array_agg(att.attname order by key_column.ordinality)
        from unnest(constraint_row.conkey) with ordinality as key_column(attnum, ordinality)
        join pg_attribute att
          on att.attrelid = constraint_row.conrelid
         and att.attnum = key_column.attnum
      ) = array['conversation_session_id', 'organization_id', 'store_id', 'conversation_id']::text[]
      and (
        select array_agg(att.attname order by key_column.ordinality)
        from unnest(constraint_row.confkey) with ordinality as key_column(attnum, ordinality)
        join pg_attribute att
          on att.attrelid = constraint_row.confrelid
         and att.attnum = key_column.attnum
      ) = array['id', 'organization_id', 'store_id', 'conversation_id']::text[]
  )
  and exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.messages'::regclass
      and constraint_row.conname = 'messages_context_link_scope_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.commercial_session_context_links'::regclass
      and constraint_row.confdeltype = 'r'
      and (
        select array_agg(att.attname order by key_column.ordinality)
        from unnest(constraint_row.conkey) with ordinality as key_column(attnum, ordinality)
        join pg_attribute att
          on att.attrelid = constraint_row.conrelid
         and att.attnum = key_column.attnum
      ) = array['commercial_session_context_link_id', 'organization_id', 'store_id', 'conversation_session_id']::text[]
      and (
        select array_agg(att.attname order by key_column.ordinality)
        from unnest(constraint_row.confkey) with ordinality as key_column(attnum, ordinality)
        join pg_attribute att
          on att.attrelid = constraint_row.confrelid
         and att.attnum = key_column.attnum
      ) = array['id', 'organization_id', 'store_id', 'conversation_session_id']::text[]
  ) into v_fk_ok;

  begin
    update public.messages
    set conversation_session_id = v_foreign_session,
        commercial_session_context_link_id = v_foreign_context
    where id = v_message_id;
  exception
    when others then
      v_sqlstate := sqlstate;
      v_message := sqlerrm;
  end;

  insert into pg_temp._p9_mccs_results values (
    11,
    'escopo composto',
    case when v_fk_ok
           and v_sqlstate = 'P0001'
           and v_message = 'messages commercial context snapshot is immutable after insert'
         then 'PASS' else 'SUT_FAIL' end,
    format(
      'composite_fks_ok=%s | attempted_foreign_session=%s | attempted_foreign_context=%s | sqlstate=%s',
      v_fk_ok,
      v_foreign_session,
      v_foreign_context,
      coalesce(v_sqlstate, '<null>')
    ),
    v_sqlstate,
    null,
    'the catalog proves the two exact composite FKs and the cross-association update is blocked separately by the immutability trigger'
  );
exception
  when others then
    insert into pg_temp._p9_mccs_results values
      (11, 'escopo composto', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario 11 aborted unexpectedly');
end;
$scenario_11$;

do $scenario_12$
declare
  v_run uuid;
  v_fingerprint_before text;
  v_fingerprint_after text;
  v_messages_after integer;
  v_contexts_after integer;
  v_sessions_after integer;
  v_opps_after integer;
  v_preexisting_messages_changed integer;
  v_preexisting_messages_missing integer;
  v_reused_conversations_changed integer;
  v_context_trigger_enabled boolean;
  v_conv_trigger_enabled boolean;
begin
  select run_id, object_fingerprint
  into v_run, v_fingerprint_before
  from pg_temp._p9_mccs_context;

  begin
    begin execute 'reset role'; exception when others then null; end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);

    delete from public.messages
    where metadata ->> 'runner_run_id' = v_run::text;

    execute 'alter table public.commercial_session_context_links disable trigger commercial_session_context_links_enforce_write_rules';

    delete from public.commercial_session_context_links
    where correlation_id = v_run
      and replaces_link_id is not null;

    delete from public.commercial_session_context_links
    where correlation_id = v_run;

    execute 'alter table public.commercial_session_context_links enable trigger commercial_session_context_links_enforce_write_rules';
    execute 'alter table public.conversations enable trigger trg_conversations_last_message_sync';

    delete from public.conversation_sessions session_row
    using pg_temp._p9_mccs_owned_objects owned
    where owned.object_type = 'conversation_sessions'
      and owned.object_id = session_row.id;

    delete from public.commercial_opportunities opportunity_row
    using pg_temp._p9_mccs_owned_objects owned
    where owned.object_type = 'commercial_opportunities'
      and owned.object_id = opportunity_row.id;
  exception
    when others then
      begin execute 'alter table public.commercial_session_context_links enable trigger commercial_session_context_links_enforce_write_rules'; exception when others then null; end;
      begin execute 'alter table public.conversations enable trigger trg_conversations_last_message_sync'; exception when others then null; end;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.role', '', true);
      perform set_config('request.jwt.claims', '', true);
      update pg_temp._p9_mccs_context set cleanup_status = 'CLEANUP_FAIL';
      insert into pg_temp._p9_mccs_results values (
        12, 'cleanup e fingerprint', 'CLEANUP_FAIL',
        'cleanup error: ' || sqlstate || ': ' || sqlerrm,
        sqlstate, null, 'cleanup exception was captured and trigger restoration was attempted'
      );
      return;
  end;

  select count(*) into v_messages_after
  from public.messages
  where metadata ->> 'runner_run_id' = v_run::text;

  select count(*) into v_contexts_after
  from public.commercial_session_context_links
  where correlation_id = v_run;

  select count(*) into v_sessions_after
  from public.conversation_sessions session_row
  join pg_temp._p9_mccs_owned_objects owned
    on owned.object_type = 'conversation_sessions'
   and owned.object_id = session_row.id;

  select count(*) into v_opps_after
  from public.commercial_opportunities opportunity_row
  join pg_temp._p9_mccs_owned_objects owned
    on owned.object_type = 'commercial_opportunities'
   and owned.object_id = opportunity_row.id;

  select count(*) into v_preexisting_messages_missing
  from pg_temp._p9_mccs_baseline_messages baseline
  left join public.messages m
    on m.id = baseline.message_id
  where m.id is null;

  select count(*) into v_preexisting_messages_changed
  from pg_temp._p9_mccs_baseline_messages baseline
  join public.messages m
    on m.id = baseline.message_id
  where to_jsonb(m) is distinct from baseline.row_json;

  select count(*) into v_reused_conversations_changed
  from pg_temp._p9_mccs_baseline_conversations baseline
  join public.conversations c
    on c.id = baseline.conversation_id
  where to_jsonb(c) is distinct from baseline.row_json;

  select exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.commercial_session_context_links'::regclass
      and not tgisinternal
      and tgname = 'commercial_session_context_links_enforce_write_rules'
      and tgenabled = 'O'
  ) into v_context_trigger_enabled;

  select exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.conversations'::regclass
      and not tgisinternal
      and tgname = 'trg_conversations_last_message_sync'
      and tgenabled = 'O'
  ) into v_conv_trigger_enabled;

  v_fingerprint_after := pg_temp._p9_mccs_object_fingerprint();

  update pg_temp._p9_mccs_context
  set cleanup_status = case
    when v_messages_after = 0
     and v_contexts_after = 0
     and v_sessions_after = 0
     and v_opps_after = 0
     and v_preexisting_messages_missing = 0
     and v_preexisting_messages_changed = 0
     and v_reused_conversations_changed = 0
     and v_context_trigger_enabled
     and v_conv_trigger_enabled
     and pg_temp._p9_mccs_identity_is_clean()
     and v_fingerprint_after is not distinct from v_fingerprint_before
    then 'PASS' else 'CLEANUP_FAIL' end;

  insert into pg_temp._p9_mccs_results values (
    12,
    'cleanup e fingerprint',
    case when v_messages_after = 0
           and v_contexts_after = 0
           and v_sessions_after = 0
           and v_opps_after = 0
           and v_preexisting_messages_missing = 0
           and v_preexisting_messages_changed = 0
           and v_reused_conversations_changed = 0
           and v_context_trigger_enabled
           and v_conv_trigger_enabled
           and pg_temp._p9_mccs_identity_is_clean()
           and v_fingerprint_after is not distinct from v_fingerprint_before
         then 'PASS' else 'CLEANUP_FAIL' end,
    format(
      'runner_messages=%s | runner_contexts=%s | runner_sessions=%s | runner_opportunities=%s | baseline_missing=%s | baseline_changed=%s | reused_conversations_changed=%s | conversations_trigger_enabled=%s | context_trigger_enabled=%s | fingerprint_unchanged=%s',
      v_messages_after,
      v_contexts_after,
      v_sessions_after,
      v_opps_after,
      v_preexisting_messages_missing,
      v_preexisting_messages_changed,
      v_reused_conversations_changed,
      v_conv_trigger_enabled,
      v_context_trigger_enabled,
      v_fingerprint_after is not distinct from v_fingerprint_before
    ),
    null,
    null,
    'only runner-owned rows are removed, preexisting messages and reused conversations remain unchanged, both named triggers are enabled and the fingerprint is unchanged'
  );
exception
  when others then
    begin execute 'alter table public.commercial_session_context_links enable trigger commercial_session_context_links_enforce_write_rules'; exception when others then null; end;
    begin execute 'alter table public.conversations enable trigger trg_conversations_last_message_sync'; exception when others then null; end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    update pg_temp._p9_mccs_context set cleanup_status = 'CLEANUP_FAIL';
    insert into pg_temp._p9_mccs_results values
      (12, 'cleanup e fingerprint', 'CLEANUP_FAIL',
       'cleanup error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario 12 aborted unexpectedly and trigger restoration was attempted');
end;
$scenario_12$;

insert into pg_temp._p9_mccs_results (
  scenario_number,
  scenario_name,
  status,
  detail,
  returned_sqlstate,
  constraint_name,
  postcondition
)
select
  matrix.scenario_number,
  matrix.scenario_name,
  case when matrix.scenario_number = 12 then 'CLEANUP_FAIL' else 'HARNESS_ERROR' end,
  'runner did not emit a result for this scenario',
  null,
  null,
  'missing scenario result synthesized by final integrity check'
from pg_temp._p9_mccs_matrix matrix
where not exists (
  select 1
  from pg_temp._p9_mccs_results result
  where result.scenario_number = matrix.scenario_number
);

do $final_cleanup_safety$
declare
  v_run uuid;
  v_cleanup text;
  v_fp_before text;
  v_fp_after text;
  v_messages_after integer;
  v_contexts_after integer;
  v_sessions_after integer;
  v_opps_after integer;
  v_preexisting_messages_missing integer;
  v_preexisting_messages_changed integer;
  v_reused_conversations_changed integer;
  v_context_trigger_enabled boolean;
  v_conv_trigger_enabled boolean;
begin
  select run_id, cleanup_status, object_fingerprint
  into v_run, v_cleanup, v_fp_before
  from pg_temp._p9_mccs_context;

  select count(*) into v_messages_after
  from public.messages
  where metadata ->> 'runner_run_id' = v_run::text;

  select count(*) into v_contexts_after
  from public.commercial_session_context_links
  where correlation_id = v_run;

  select count(*) into v_sessions_after
  from public.conversation_sessions session_row
  join pg_temp._p9_mccs_owned_objects owned
    on owned.object_type = 'conversation_sessions'
   and owned.object_id = session_row.id;

  select count(*) into v_opps_after
  from public.commercial_opportunities opportunity_row
  join pg_temp._p9_mccs_owned_objects owned
    on owned.object_type = 'commercial_opportunities'
   and owned.object_id = opportunity_row.id;

  select count(*) into v_preexisting_messages_missing
  from pg_temp._p9_mccs_baseline_messages baseline
  left join public.messages m
    on m.id = baseline.message_id
  where m.id is null;

  select count(*) into v_preexisting_messages_changed
  from pg_temp._p9_mccs_baseline_messages baseline
  join public.messages m
    on m.id = baseline.message_id
  where to_jsonb(m) is distinct from baseline.row_json;

  select count(*) into v_reused_conversations_changed
  from pg_temp._p9_mccs_baseline_conversations baseline
  join public.conversations c
    on c.id = baseline.conversation_id
  where to_jsonb(c) is distinct from baseline.row_json;

  select exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.commercial_session_context_links'::regclass
      and not tgisinternal
      and tgname = 'commercial_session_context_links_enforce_write_rules'
      and tgenabled = 'O'
  ) into v_context_trigger_enabled;

  select exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.conversations'::regclass
      and not tgisinternal
      and tgname = 'trg_conversations_last_message_sync'
      and tgenabled = 'O'
  ) into v_conv_trigger_enabled;

  v_fp_after := pg_temp._p9_mccs_object_fingerprint();

  if v_cleanup <> 'PASS'
     or v_messages_after <> 0
     or v_contexts_after <> 0
     or v_sessions_after <> 0
     or v_opps_after <> 0
     or v_preexisting_messages_missing <> 0
     or v_preexisting_messages_changed <> 0
     or v_reused_conversations_changed <> 0
     or not v_context_trigger_enabled
     or not v_conv_trigger_enabled
     or not pg_temp._p9_mccs_identity_is_clean()
     or v_fp_after is distinct from v_fp_before then
    begin execute 'alter table public.commercial_session_context_links enable trigger commercial_session_context_links_enforce_write_rules'; exception when others then null; end;
    begin execute 'alter table public.conversations enable trigger trg_conversations_last_message_sync'; exception when others then null; end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    raise exception using
      errcode = 'P0001',
      message = format(
        'messages commercial context snapshot runner cleanup safety gate failed; transaction rolled back (cleanup_status=%s, runner_messages=%s, runner_contexts=%s, runner_sessions=%s, runner_opportunities=%s, baseline_missing=%s, baseline_changed=%s, reused_conversations_changed=%s, conversations_trigger_enabled=%s, context_trigger_enabled=%s, identity_clean=%s, fingerprint_unchanged=%s)',
        coalesce(v_cleanup, '<null>'),
        v_messages_after,
        v_contexts_after,
        v_sessions_after,
        v_opps_after,
        v_preexisting_messages_missing,
        v_preexisting_messages_changed,
        v_reused_conversations_changed,
        v_conv_trigger_enabled,
        v_context_trigger_enabled,
        pg_temp._p9_mccs_identity_is_clean(),
        v_fp_after is not distinct from v_fp_before
      );
  end if;
end;
$final_cleanup_safety$;

commit;

with summary as (
  select
    count(*) as scenario_count,
    count(*) filter (where status = 'PASS') as total_pass,
    count(*) filter (where status = 'SUT_FAIL') as total_sut_fail,
    count(*) filter (where status = 'HARNESS_ERROR') as total_harness_error,
    count(*) filter (where status = 'BLOCKED') as total_blocked,
    count(*) filter (where status = 'CLEANUP_FAIL') as total_cleanup_fail,
    case
      when count(*) <> 12 then 'HARNESS_ERROR'
      when count(*) filter (where status = 'CLEANUP_FAIL') > 0 then 'CLEANUP_FAIL'
      when count(*) filter (where status = 'HARNESS_ERROR') > 0 then 'HARNESS_ERROR'
      when count(*) filter (where status = 'SUT_FAIL') > 0 then 'SUT_FAIL'
      when count(*) filter (where status = 'BLOCKED') > 0 then 'BLOCKED'
      when (select cleanup_status from pg_temp._p9_mccs_context) <> 'PASS' then 'CLEANUP_FAIL'
      when (select harness_preflight from pg_temp._p9_mccs_context) <> 'PASS' then 'HARNESS_ERROR'
      else 'APROVADA'
    end as final_status
  from pg_temp._p9_mccs_results
),
report as (
  select
    'SCENARIO'::text as row_type,
    result.scenario_number,
    result.scenario_name,
    matrix.coverage_rule,
    matrix.test_role,
    matrix.expected_outcome,
    result.status,
    result.detail,
    result.returned_sqlstate,
    result.constraint_name,
    result.postcondition,
    null::bigint as scenario_count,
    null::bigint as total_pass,
    null::bigint as total_sut_fail,
    null::bigint as total_harness_error,
    null::bigint as total_blocked,
    null::bigint as total_cleanup_fail,
    null::text as cleanup_status,
    null::text as harness_preflight,
    null::text as fixture_inventory,
    null::text as object_fingerprint,
    null::text as final_status
  from pg_temp._p9_mccs_results result
  join pg_temp._p9_mccs_matrix matrix
    on matrix.scenario_number = result.scenario_number

  union all

  select
    'SUMMARY',
    null,
    'runner summary',
    '12-scenario approval contract',
    'postgres controller',
    'PASS only when every scenario passes and cleanup/preflight are PASS',
    summary.final_status,
    format(
      'scenario_count=%s | pass=%s | sut_fail=%s | harness_error=%s | blocked=%s | cleanup_fail=%s | final_status=%s',
      summary.scenario_count,
      summary.total_pass,
      summary.total_sut_fail,
      summary.total_harness_error,
      summary.total_blocked,
      summary.total_cleanup_fail,
      summary.final_status
    ),
    null,
    null,
    'see cleanup_status and harness_preflight columns',
    summary.scenario_count,
    summary.total_pass,
    summary.total_sut_fail,
    summary.total_harness_error,
    summary.total_blocked,
    summary.total_cleanup_fail,
    context.cleanup_status,
    context.harness_preflight,
    context.fixture_inventory,
    context.object_fingerprint,
    summary.final_status
  from summary
  cross join pg_temp._p9_mccs_context context
)
select
  row_type,
  scenario_number,
  scenario_name,
  coverage_rule,
  test_role,
  expected_outcome,
  status,
  detail,
  returned_sqlstate,
  constraint_name,
  postcondition,
  scenario_count,
  total_pass,
  total_sut_fail,
  total_harness_error,
  total_blocked,
  total_cleanup_fail,
  cleanup_status,
  harness_preflight,
  fixture_inventory,
  object_fingerprint,
  final_status
from report
order by case when row_type = 'SCENARIO' then 0 else 1 end,
         scenario_number nulls last;

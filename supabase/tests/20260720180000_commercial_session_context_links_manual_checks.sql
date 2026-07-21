-- ZION / Pilar 9 / Fase 4 / 4.1A-4
-- Runner definitivo V3 de validacao real de public.commercial_session_context_links.
--
-- REGRAS DE SEGURANCA:
-- - executar o arquivo inteiro uma unica vez no SQL Editor do Supabase;
-- - nao altera organizations, stores, conversations, leads, memberships ou auth.users;
-- - reutiliza somente parents reais e imutaveis ja existentes;
-- - cria apenas opportunities, conversation_sessions, um customer merged negativo,
--   um lead_customer_link inactive negativo e context links identificados pela execucao;
-- - nenhuma fixture permanente e adaptada ao teste;
-- - toda linha criada pelo runner possui UUID conhecido e/ou correlation_id exclusivo;
-- - o bypass de triggers usa somente os dois triggers de escrita nomeados,
--   restaura ambos como enabled e confere o fingerprint estrutural;
-- - falha de cleanup aborta a transacao inteira;
-- - exatamente 36 cenarios e uma linha SUMMARY sao emitidos ao final.

begin;

set local lock_timeout = '3s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, extensions;

-- --------------------------------------------------------------------------
-- Objetos temporarios.
-- --------------------------------------------------------------------------

drop table if exists pg_temp._p9_cscl_results;
drop table if exists pg_temp._p9_cscl_matrix;
drop table if exists pg_temp._p9_cscl_context;
drop table if exists pg_temp._p9_cscl_conversations;
drop table if exists pg_temp._p9_cscl_customers;
drop table if exists pg_temp._p9_cscl_sessions;
drop table if exists pg_temp._p9_cscl_opportunities;
drop table if exists pg_temp._p9_cscl_lead_links;
drop table if exists pg_temp._p9_cscl_state;
drop table if exists pg_temp._p9_cscl_owned_objects;

create temp table _p9_cscl_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (
    status in (
      'PASS',
      'SUT_FAIL',
      'HARNESS_ERROR',
      'BLOCKED_BY_FIXTURE_PREREQUISITE',
      'CLEANUP_FAIL'
    )
  ),
  detail text not null,
  returned_sqlstate text null,
  constraint_name text null,
  postcondition text not null
) on commit preserve rows;

create temp table _p9_cscl_matrix (
  scenario_number integer primary key,
  scenario_name text not null,
  coverage_rule text not null,
  test_role text not null,
  expected_outcome text not null
) on commit preserve rows;

create temp table _p9_cscl_context (
  singleton boolean primary key default true check (singleton),
  run_id uuid not null,
  setup_status text not null default 'NOT_RUN',
  setup_detail text not null default '',
  harness_preflight text not null default 'NOT_RUN',
  harness_detail text not null default '',
  cleanup_status text not null default 'NOT_RUN',
  organization_id uuid null,
  store_id uuid null,
  member_user_id uuid null,
  external_user_id uuid null,
  selected_conversation_count integer not null default 0,
  inventory_text text not null default '',
  object_fingerprint text not null default ''
) on commit preserve rows;

create temp table _p9_cscl_conversations (
  fixture_number integer primary key,
  conversation_id uuid not null unique,
  lead_id uuid not null unique,
  organization_id uuid not null,
  store_id uuid not null
) on commit preserve rows;

create temp table _p9_cscl_customers (
  fixture_number integer primary key,
  customer_id uuid not null,
  merged_into_customer_id uuid null
) on commit preserve rows;

create temp table _p9_cscl_sessions (
  fixture_number integer primary key,
  session_id uuid not null unique,
  conversation_id uuid not null unique,
  status text not null
) on commit preserve rows;

create temp table _p9_cscl_opportunities (
  fixture_number integer primary key,
  opportunity_id uuid not null unique,
  customer_id uuid not null
) on commit preserve rows;

create temp table _p9_cscl_lead_links (
  fixture_number integer primary key,
  link_id uuid not null unique,
  lead_id uuid not null,
  customer_id uuid not null,
  status text not null
) on commit preserve rows;

create temp table _p9_cscl_state (
  state_key text primary key,
  value_uuid uuid null,
  value_text text null
) on commit preserve rows;

create temp table _p9_cscl_owned_objects (
  object_type text not null,
  object_id uuid not null,
  primary key (object_type, object_id)
) on commit preserve rows;

insert into _p9_cscl_context (run_id) values (gen_random_uuid());

insert into _p9_cscl_matrix (
  scenario_number, scenario_name, coverage_rule, test_role, expected_outcome
) values
  (1,  'estrutura e hardening encontrados', 'tabela, colunas, constraints, indices, RLS, grants, funcoes e trigger', 'postgres', 'contrato estrutural completo'),
  (2,  'criacao valida por human autenticado', 'authenticated pode criar actor=human com membership e claim correto', 'authenticated', 'uma linha active correta'),
  (3,  'human sem user_id rejeitado', 'ator human exige user_id', 'authenticated', '22023 ator invalido'),
  (4,  'human com user_id divergente do claim rejeitado', 'ator human deve coincidir com auth.uid/sub', 'authenticated', '42501 nao autorizado'),
  (5,  'non-human com user_id rejeitado', 'ator nao-human proibe user_id', 'authenticated', '22023 ator invalido'),
  (6,  'anon rejeitado', 'anon nunca opera funcoes controladas', 'anon', '42501 nao autorizado'),
  (7,  'authenticated tentando actor system rejeitado', 'authenticated so opera como human', 'authenticated', '42501 nao autorizado'),
  (8,  'service_role tentando actor human rejeitado', 'service_role so opera actor ai/system/migration', 'service_role', '42501 nao autorizado'),
  (9,  'INSERT direto authenticated rejeitado', 'sem escrita direta por authenticated', 'authenticated', '42501 e nenhuma mutacao'),
  (10, 'INSERT direto service_role rejeitado', 'sem escrita direta por service_role', 'service_role', '42501 e nenhuma mutacao'),
  (11, 'UPDATE direto rejeitado', 'sem UPDATE direto', 'service_role', '42501 e nenhuma mutacao'),
  (12, 'DELETE direto rejeitado', 'sem DELETE direto', 'service_role', '42501 e nenhuma mutacao'),
  (13, 'sessao de outra organizacao ou loja rejeitada', 'sessao deve pertencer ao mesmo escopo', 'authenticated', '23514 generico'),
  (14, 'sessao closed rejeitada', 'session active obrigatoria no insert', 'authenticated', '23514 generico'),
  (15, 'oportunidade de outro customer rejeitada', 'opportunity deve coincidir com customer congelado', 'authenticated', '23514 generico'),
  (16, 'lead_customer_link de outro lead rejeitado', 'lead evidence deve apontar para o lead da sessao', 'authenticated', '23514 generico'),
  (17, 'lead_customer_link inactive rejeitado', 'evidencia deve estar active', 'authenticated', '23514 generico'),
  (18, 'customer merged rejeitado', 'customer fundido nao pode ser classificado', 'authenticated', '23514 generico'),
  (19, 'criacao valida por service_role actor system', 'service_role pode criar actor system', 'service_role', 'uma linha active correta'),
  (20, 'uma unica linha active por sessao', 'segunda linha active falha claramente', 'service_role', '23505 conflito de linha active'),
  (21, 'replay idempotente retorna o mesmo id', 'mesma key e mesmo payload nao duplicam', 'authenticated', 'mesmo id e uma linha'),
  (22, 'conflito de idempotency_key rejeitado', 'mesma key com payload diferente falha', 'authenticated', '23505 conflito deterministico'),
  (23, 'encerramento valido', 'active para inactive com auditoria', 'authenticated', 'linha encerrada corretamente'),
  (24, 'campos centrais imutaveis', 'UPDATE central sob postgres e bloqueado pelo trigger', 'postgres', 'P0001 e estado preservado'),
  (25, 'linha inactive imutavel', 'inactive nao aceita alteracoes posteriores', 'postgres', 'P0001 e estado preservado'),
  (26, 'substituicao valida e atomica', 'encerra contexto antigo e cria novo com replaces_link_id', 'authenticated', 'um antigo inactive e um novo active'),
  (27, 'metadata replacement reservada rejeitada', 'criacao normal nao pode simular replacement no metadata', 'service_role', '22023 input invalido'),
  (28, 'linked_at futuro rejeitado', 'timestamp futuro nao pode entrar nem por migration actor', 'service_role', '22023 input invalido'),
  (29, 'claims JSON nao-objeto rejeitadas', 'request.jwt.claims deve ser objeto JSON', 'service_role', '42501 nao autorizado'),
  (30, 'substituir vinculo inactive invalido e rejeitado', 'apenas active pode ser substituido', 'authenticated', 'P0001'),
  (31, 'vinculo antigo nao pode ser substituido duas vezes', 'segunda substituicao direta falha', 'authenticated', '23505 conflito deterministico'),
  (32, 'SELECT de membro autorizado', 'membership permite leitura', 'authenticated', '1 linha visivel'),
  (33, 'SELECT de usuario sem membership bloqueado', 'sem membership usuario ve zero', 'authenticated', '0 linha visivel'),
  (34, 'nenhuma policy de escrita', 'somente SELECT policy existe', 'postgres', 'catalogo coerente'),
  (35, 'nenhuma permissao direta de escrita', 'grants da tabela bloqueiam escrita direta', 'postgres', 'grants coerentes'),
  (36, 'zero residuos apos cleanup', 'nenhuma fixture residual do runner', 'postgres', 'cleanup total');

-- --------------------------------------------------------------------------
-- Helpers de execucao sob papel testado.
-- --------------------------------------------------------------------------

create or replace function pg_temp._p9_cscl_identity_is_clean()
returns boolean
language sql
as $function$
  select
    current_user = 'postgres'
    and session_user = 'postgres'
    and nullif(current_setting('request.jwt.claim.sub', true), '') is null
    and nullif(current_setting('request.jwt.claim.role', true), '') is null
    and nullif(current_setting('request.jwt.claims', true), '') is null
$function$;

revoke all on function pg_temp._p9_cscl_identity_is_clean() from public;

create or replace function pg_temp._p9_cscl_exec_dml(
  p_role text,
  p_user_id uuid,
  p_sql text
)
returns table (
  operation_succeeded boolean,
  affected_rows bigint,
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
  v_ok boolean := false;
  v_rows bigint := 0;
  v_state text;
  v_message text;
  v_detail text;
  v_hint text;
  v_constraint text;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    return query select false, 0::bigint, null::text, null::text, null::text,
      null::text, null::text, false, 'helper caller is not postgres'::text;
    return;
  end if;

  if p_role not in ('authenticated', 'service_role', 'anon') then
    return query select false, 0::bigint, null::text, null::text, null::text,
      null::text, null::text, true, 'unsupported test role'::text;
    return;
  end if;

  if p_role = 'authenticated' and p_user_id is null then
    return query select false, 0::bigint, null::text, null::text, null::text,
      null::text, null::text, true, 'authenticated execution requires user id'::text;
    return;
  end if;

  perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    case when p_user_id is null
      then json_build_object('role', p_role)::text
      else json_build_object('sub', p_user_id::text, 'role', p_role)::text
    end,
    true
  );

  execute format('set local role %I', p_role);

  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
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

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);

  if not pg_temp._p9_cscl_identity_is_clean() then
    raise exception using
      errcode = 'P0001',
      message = 'runner helper failed to restore postgres identity';
  end if;

  return query select v_ok, v_rows, v_state, v_message, v_detail, v_hint,
    v_constraint, pg_temp._p9_cscl_identity_is_clean(), null::text;
exception
  when others then
    begin execute 'reset role'; exception when others then null; end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    raise exception using
      errcode = 'P0001',
      message = 'runner helper internal error: ' || sqlstate || ': ' || sqlerrm;
end;
$function$;

revoke all on function pg_temp._p9_cscl_exec_dml(text, uuid, text) from public;

create or replace function pg_temp._p9_cscl_exec_scalar(
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
  v_ok boolean := false;
  v_value text;
  v_state text;
  v_message text;
  v_detail text;
  v_hint text;
  v_constraint text;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    return query select false, null::text, null::text, null::text, null::text,
      null::text, null::text, false, 'helper caller is not postgres'::text;
    return;
  end if;

  if p_role not in ('authenticated', 'service_role', 'anon') then
    return query select false, null::text, null::text, null::text, null::text,
      null::text, null::text, true, 'unsupported test role'::text;
    return;
  end if;

  if p_role = 'authenticated' and p_user_id is null then
    return query select false, null::text, null::text, null::text, null::text,
      null::text, null::text, true, 'authenticated execution requires user id'::text;
    return;
  end if;

  perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    case when p_user_id is null
      then json_build_object('role', p_role)::text
      else json_build_object('sub', p_user_id::text, 'role', p_role)::text
    end,
    true
  );

  execute format('set local role %I', p_role);

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

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);

  if not pg_temp._p9_cscl_identity_is_clean() then
    raise exception using
      errcode = 'P0001',
      message = 'runner helper failed to restore postgres identity';
  end if;

  return query select v_ok, v_value, v_state, v_message, v_detail, v_hint,
    v_constraint, pg_temp._p9_cscl_identity_is_clean(), null::text;
exception
  when others then
    begin execute 'reset role'; exception when others then null; end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    raise exception using
      errcode = 'P0001',
      message = 'runner helper internal error: ' || sqlstate || ': ' || sqlerrm;
end;
$function$;

revoke all on function pg_temp._p9_cscl_exec_scalar(text, uuid, text) from public;

create or replace function pg_temp._p9_cscl_exec_scalar_with_claims(
  p_role text,
  p_user_id uuid,
  p_claims_text text,
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
  v_ok boolean := false;
  v_value text;
  v_state text;
  v_message text;
  v_detail text;
  v_hint text;
  v_constraint text;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    raise exception using errcode = 'P0001', message = 'helper caller is not postgres';
  end if;

  if p_role not in ('authenticated', 'service_role', 'anon') then
    raise exception using errcode = 'P0001', message = 'unsupported test role';
  end if;

  perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims', coalesce(p_claims_text, ''), true);
  execute format('set local role %I', p_role);

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

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);

  if not pg_temp._p9_cscl_identity_is_clean() then
    raise exception using errcode = 'P0001', message = 'runner helper failed to restore postgres identity';
  end if;

  return query select v_ok, v_value, v_state, v_message, v_detail, v_hint,
    v_constraint, true, null::text;
exception
  when others then
    begin execute 'reset role'; exception when others then null; end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    raise exception using
      errcode = 'P0001',
      message = 'runner helper internal error: ' || sqlstate || ': ' || sqlerrm;
end;
$function$;

revoke all on function pg_temp._p9_cscl_exec_scalar_with_claims(text, uuid, text, text)
  from public;

create or replace function pg_temp._p9_cscl_object_fingerprint()
returns text
language sql
stable
as $function$
  with fingerprint_parts as (
    select 'table'::text as object_type,
      n.nspname || '.' || c.relname as object_name,
      concat_ws('|', c.relrowsecurity::text, c.relforcerowsecurity::text,
                pg_get_userbyid(c.relowner)) as definition
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'commercial_session_context_links'

    union all
    select 'function',
      n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
      pg_get_functiondef(p.oid) || '|' || coalesce(p.proacl::text, '<default>')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'enforce_commercial_session_context_link_write_rules',
        'link_commercial_session_context',
        'close_commercial_session_context_link',
        'replace_commercial_session_context_link'
      )

    union all
    select 'constraint', con.conname, pg_get_constraintdef(con.oid, true)
    from pg_constraint con
    where con.conrelid = to_regclass('public.commercial_session_context_links')

    union all
    select 'index', indexname, indexdef
    from pg_indexes
    where schemaname = 'public' and tablename = 'commercial_session_context_links'

    union all
    select 'policy', policyname,
      coalesce(qual, '') || '|' || coalesce(with_check, '') || '|' || cmd || '|' || roles::text
    from pg_policies
    where schemaname = 'public' and tablename = 'commercial_session_context_links'

    union all
    select 'trigger', t.tgname, pg_get_triggerdef(t.oid, true) || '|' || t.tgenabled::text
    from pg_trigger t
    where t.tgrelid = to_regclass('public.commercial_session_context_links')
      and not t.tgisinternal

    union all
    select 'grant', grantee || ':' || privilege_type, table_schema || '.' || table_name
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'commercial_session_context_links'
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  )
  select md5(string_agg(object_type || ':' || object_name || ':' || definition,
                        E'\n' order by object_type, object_name))
  from fingerprint_parts
$function$;

revoke all on function pg_temp._p9_cscl_object_fingerprint() from public;


-- --------------------------------------------------------------------------
-- Preflight do harness antes de qualquer fixture persistente.
-- --------------------------------------------------------------------------

do $preflight$
declare
  v_exec record;
begin
  if current_user <> 'postgres' or session_user <> 'postgres'
     or not pg_temp._p9_cscl_identity_is_clean() then
    update pg_temp._p9_cscl_context
    set harness_preflight = 'HARNESS_ERROR',
        harness_detail = 'runner must start as clean postgres identity';
    return;
  end if;

  if to_regclass('public.commercial_session_context_links') is null then
    update pg_temp._p9_cscl_context
    set harness_preflight = 'HARNESS_ERROR',
        harness_detail = 'commercial_session_context_links migration is not applied';
    return;
  end if;

  if not exists (
       select 1
       from pg_trigger trigger_row
       where trigger_row.tgrelid =
             to_regclass('public.commercial_session_context_links')
         and trigger_row.tgname =
             'commercial_session_context_links_enforce_write_rules'
         and not trigger_row.tgisinternal
         and trigger_row.tgenabled = 'O'
     )
     or not exists (
       select 1
       from pg_trigger trigger_row
       where trigger_row.tgrelid = to_regclass('public.lead_customer_links')
         and trigger_row.tgname = 'lead_customer_links_enforce_write_rules'
         and not trigger_row.tgisinternal
         and trigger_row.tgenabled = 'O'
     ) then
    update pg_temp._p9_cscl_context
    set harness_preflight = 'HARNESS_ERROR',
        harness_detail = 'required write-rule triggers are missing or not enabled';
    return;
  end if;

  update pg_temp._p9_cscl_context
  set object_fingerprint = coalesce(pg_temp._p9_cscl_object_fingerprint(), '<missing>');

  select * into v_exec
  from pg_temp._p9_cscl_exec_scalar(
    'authenticated', gen_random_uuid(), 'select (1 / 0)::text'
  );

  if v_exec.harness_error is not null
     or not v_exec.identity_clean
     or v_exec.operation_succeeded
     or v_exec.returned_sqlstate <> '22012' then
    update pg_temp._p9_cscl_context
    set harness_preflight = 'HARNESS_ERROR',
        harness_detail = format(
          'error capture or identity restoration failed | succeeded=%s | sqlstate=%s | clean=%s | helper=%s',
          v_exec.operation_succeeded, v_exec.returned_sqlstate,
          v_exec.identity_clean, coalesce(v_exec.harness_error, '<none>')
        );
    return;
  end if;

  begin
    execute 'alter table public.commercial_session_context_links disable trigger commercial_session_context_links_enforce_write_rules';
    execute 'alter table public.commercial_session_context_links enable trigger commercial_session_context_links_enforce_write_rules';
    execute 'alter table public.lead_customer_links disable trigger lead_customer_links_enforce_write_rules';
    execute 'alter table public.lead_customer_links enable trigger lead_customer_links_enforce_write_rules';
  exception
    when others then
      begin
        execute 'alter table public.commercial_session_context_links enable trigger commercial_session_context_links_enforce_write_rules';
      exception when others then null;
      end;
      begin
        execute 'alter table public.lead_customer_links enable trigger lead_customer_links_enforce_write_rules';
      exception when others then null;
      end;
      update pg_temp._p9_cscl_context
      set harness_preflight = 'HARNESS_ERROR',
          harness_detail = 'scoped trigger toggle capability unavailable: ' || sqlstate || ': ' || sqlerrm;
      return;
  end;

  if not exists (
       select 1
       from pg_trigger trigger_row
       where trigger_row.tgrelid =
             to_regclass('public.commercial_session_context_links')
         and trigger_row.tgname =
             'commercial_session_context_links_enforce_write_rules'
         and trigger_row.tgenabled = 'O'
     )
     or not exists (
       select 1
       from pg_trigger trigger_row
       where trigger_row.tgrelid = to_regclass('public.lead_customer_links')
         and trigger_row.tgname = 'lead_customer_links_enforce_write_rules'
         and trigger_row.tgenabled = 'O'
     ) then
    update pg_temp._p9_cscl_context
    set harness_preflight = 'HARNESS_ERROR',
        harness_detail = 'write-rule triggers did not return to enabled state';
    return;
  end if;

  update pg_temp._p9_cscl_context
  set harness_preflight = 'PASS',
      harness_detail = 'role switch, error capture, identity restoration and scoped named-trigger cleanup capability passed';
exception
  when others then
    begin execute 'reset role'; exception when others then null; end;
    begin
      execute 'alter table public.commercial_session_context_links enable trigger commercial_session_context_links_enforce_write_rules';
    exception when others then null;
    end;
    begin
      execute 'alter table public.lead_customer_links enable trigger lead_customer_links_enforce_write_rules';
    exception when others then null;
    end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    update pg_temp._p9_cscl_context
    set harness_preflight = 'HARNESS_ERROR',
        harness_detail = 'preflight failed with ' || sqlstate || ': ' || sqlerrm;
end;
$preflight$;

-- --------------------------------------------------------------------------
-- Setup: reutiliza parents reais e cria somente filhos identificados.
-- --------------------------------------------------------------------------

do $setup$
declare
  v_lock boolean := false;
  v_run uuid;
  v_org uuid;
  v_store uuid;
  v_member uuid;
  v_selected integer := 0;
  v_merged_customer uuid := gen_random_uuid();
  v_inactive_lcl uuid := gen_random_uuid();
  v_customer_1 uuid;
  v_lead_6 uuid;
  v_customer_6 uuid;
begin
  if (select harness_preflight from pg_temp._p9_cscl_context) <> 'PASS' then
    update pg_temp._p9_cscl_context
    set setup_status = 'HARNESS_ERROR',
        setup_detail = 'setup skipped because harness preflight did not pass';
    return;
  end if;

  select run_id into v_run from pg_temp._p9_cscl_context;

  select pg_try_advisory_xact_lock(
    hashtextextended('zion:p9:commercial_session_context_links:runner', 0)
  ) into v_lock;

  if not v_lock then
    update pg_temp._p9_cscl_context
    set setup_status = 'HARNESS_ERROR',
        setup_detail = 'another commercial_session_context_links runner holds the advisory lock';
    return;
  end if;

  with one_conversation_per_lead as (
    select
      c.id as conversation_id,
      l.id as lead_id,
      c.organization_id,
      l.store_id,
      lead_link.id as lead_customer_link_id,
      lead_link.customer_id,
      row_number() over (partition by l.id order by c.id) as lead_conversation_rank,
      row_number() over (partition by lead_link.customer_id order by l.id, c.id) as customer_rank
    from public.conversations c
    join public.leads l
      on l.id = c.lead_id
     and l.organization_id = c.organization_id
    join public.stores store_row
      on store_row.id = l.store_id
     and store_row.organization_id = l.organization_id
    join public.lead_customer_links lead_link
      on lead_link.lead_id = l.id
     and lead_link.organization_id = l.organization_id
     and lead_link.store_id = l.store_id
     and lead_link.status = 'active'
    join public.customers customer_row
      on customer_row.id = lead_link.customer_id
     and customer_row.organization_id = lead_link.organization_id
     and customer_row.merged_into_customer_id is null
    where l.store_id is not null
      and not exists (
        select 1
        from public.conversation_sessions session_row
        where session_row.conversation_id = c.id
          and session_row.organization_id = c.organization_id
          and session_row.store_id = l.store_id
          and session_row.status = 'active'
      )
  ), inventory as (
    select organization_id, store_id, count(*) as safe_count
    from one_conversation_per_lead
    where lead_conversation_rank = 1 and customer_rank = 1
    group by organization_id, store_id
  )
  select inventory.organization_id, inventory.store_id
  into v_org, v_store
  from inventory
  where inventory.safe_count >= 6
    and exists (
      select 1 from public.memberships membership_row
      where membership_row.organization_id = inventory.organization_id
        and membership_row.user_id is not null
    )
  order by inventory.safe_count desc, inventory.organization_id, inventory.store_id
  limit 1;

  if v_org is null or v_store is null then
    update pg_temp._p9_cscl_context
    set setup_status = 'BLOCKED_BY_FIXTURE_PREREQUISITE',
        setup_detail = 'no organization/store has six distinct leads/customers with active identity evidence, safe conversations and membership';
    return;
  end if;

  with eligible as (
    select
      c.id as conversation_id,
      l.id as lead_id,
      c.organization_id,
      l.store_id,
      lead_link.id as lead_customer_link_id,
      lead_link.customer_id,
      row_number() over (partition by l.id order by c.id) as lead_conversation_rank,
      row_number() over (partition by lead_link.customer_id order by l.id, c.id) as customer_rank
    from public.conversations c
    join public.leads l
      on l.id = c.lead_id
     and l.organization_id = c.organization_id
    join public.lead_customer_links lead_link
      on lead_link.lead_id = l.id
     and lead_link.organization_id = l.organization_id
     and lead_link.store_id = l.store_id
     and lead_link.status = 'active'
    join public.customers customer_row
      on customer_row.id = lead_link.customer_id
     and customer_row.organization_id = lead_link.organization_id
     and customer_row.merged_into_customer_id is null
    where c.organization_id = v_org
      and l.store_id = v_store
      and not exists (
        select 1
        from public.conversation_sessions session_row
        where session_row.conversation_id = c.id
          and session_row.organization_id = c.organization_id
          and session_row.store_id = l.store_id
          and session_row.status = 'active'
      )
  ), selected as (
    select *
    from eligible
    where lead_conversation_rank = 1 and customer_rank = 1
    order by lead_id, conversation_id
    limit 6
  )
  insert into pg_temp._p9_cscl_conversations (
    fixture_number, conversation_id, lead_id, organization_id, store_id
  )
  select row_number() over (order by lead_id, conversation_id)::integer,
         conversation_id, lead_id, organization_id, store_id
  from selected;

  select count(*) into v_selected from pg_temp._p9_cscl_conversations;
  if v_selected <> 6 then
    update pg_temp._p9_cscl_context
    set setup_status = 'BLOCKED_BY_FIXTURE_PREREQUISITE',
        setup_detail = 'safe fixture inventory changed while selecting six conversations';
    return;
  end if;

  insert into pg_temp._p9_cscl_lead_links (
    fixture_number, link_id, lead_id, customer_id, status
  )
  select fixture.fixture_number, lead_link.id, fixture.lead_id,
         lead_link.customer_id, lead_link.status
  from pg_temp._p9_cscl_conversations fixture
  join public.lead_customer_links lead_link
    on lead_link.lead_id = fixture.lead_id
   and lead_link.organization_id = fixture.organization_id
   and lead_link.store_id = fixture.store_id
   and lead_link.status = 'active';

  insert into pg_temp._p9_cscl_customers (
    fixture_number, customer_id, merged_into_customer_id
  )
  select fixture_number, customer_id, null
  from pg_temp._p9_cscl_lead_links
  where fixture_number between 1 and 6;

  select membership_row.user_id
  into v_member
  from public.memberships membership_row
  where membership_row.organization_id = v_org
    and membership_row.user_id is not null
  order by membership_row.created_at, membership_row.user_id
  limit 1;

  if v_member is null then
    update pg_temp._p9_cscl_context
    set setup_status = 'BLOCKED_BY_FIXTURE_PREREQUISITE',
        setup_detail = 'selected organization lost its membership fixture';
    return;
  end if;

  select customer_id into v_customer_1
  from pg_temp._p9_cscl_customers where fixture_number = 1;

  insert into pg_temp._p9_cscl_owned_objects values ('customers', v_merged_customer);
  insert into public.customers (
    id, organization_id, display_name, normalized_name, merged_into_customer_id
  ) values (
    v_merged_customer,
    v_org,
    'Runner CSCL merged ' || v_run::text,
    'runner cscl merged ' || v_run::text,
    v_customer_1
  );
  insert into pg_temp._p9_cscl_customers values (7, v_merged_customer, v_customer_1);

  insert into pg_temp._p9_cscl_opportunities (
    fixture_number, opportunity_id, customer_id
  )
  select fixture_number, gen_random_uuid(), customer_id
  from pg_temp._p9_cscl_customers
  where fixture_number between 1 and 7;

  insert into pg_temp._p9_cscl_owned_objects
  select 'commercial_opportunities', opportunity_id
  from pg_temp._p9_cscl_opportunities;

  insert into public.commercial_opportunities (
    id, organization_id, store_id, customer_id, stage
  )
  select opportunity_id, v_org, v_store, customer_id, 'qualificacao'
  from pg_temp._p9_cscl_opportunities;

  insert into pg_temp._p9_cscl_sessions (
    fixture_number, session_id, conversation_id, status
  )
  select fixture_number, gen_random_uuid(), conversation_id,
         case when fixture_number = 2 then 'closed' else 'active' end
  from pg_temp._p9_cscl_conversations
  where fixture_number in (1, 2, 3, 5, 6);

  insert into pg_temp._p9_cscl_owned_objects
  select 'conversation_sessions', session_id
  from pg_temp._p9_cscl_sessions;

  insert into public.conversation_sessions (
    id, organization_id, store_id, conversation_id, status, closed_at
  )
  select session_id, v_org, v_store, conversation_id, status,
         case when status = 'closed' then clock_timestamp() else null end
  from pg_temp._p9_cscl_sessions;

  select lead_id into v_lead_6
  from pg_temp._p9_cscl_conversations where fixture_number = 6;
  select customer_id into v_customer_6
  from pg_temp._p9_cscl_customers where fixture_number = 6;

  insert into pg_temp._p9_cscl_owned_objects values ('lead_customer_links', v_inactive_lcl);

  execute 'set constraints all immediate';
  execute 'alter table public.lead_customer_links disable trigger lead_customer_links_enforce_write_rules';
  begin
    insert into public.lead_customer_links (
      id, organization_id, store_id, lead_id, customer_id,
      source_identity_id, replaces_link_id, status, source,
      source_reference, idempotency_key, correlation_id,
      linked_at, linked_by_actor_type, linked_by_user_id,
      unlinked_at, unlinked_by_actor_type, unlinked_by_user_id,
      unlink_reason_code, unlink_reason, metadata
    ) values (
      v_inactive_lcl, v_org, v_store, v_lead_6, v_customer_6,
      null, null, 'inactive', 'system',
      'runner inactive evidence', 'runner:' || v_run::text || ':inactive-lcl', v_run,
      clock_timestamp() - interval '1 second', 'system', null,
      clock_timestamp(), 'system', null,
      'runner_inactive', 'runner-owned inactive evidence fixture',
      jsonb_build_object('runner', true, 'fixture', 'inactive-evidence')
    );
  exception
    when others then
      execute 'alter table public.lead_customer_links enable trigger lead_customer_links_enforce_write_rules';
      raise;
  end;
  execute 'alter table public.lead_customer_links enable trigger lead_customer_links_enforce_write_rules';

  insert into pg_temp._p9_cscl_lead_links values (
    7, v_inactive_lcl, v_lead_6, v_customer_6, 'inactive'
  );

  update pg_temp._p9_cscl_context
  set setup_status = 'PASS',
      setup_detail = 'existing parent fixtures selected; runner-owned child fixtures created',
      organization_id = v_org,
      store_id = v_store,
      member_user_id = v_member,
      external_user_id = gen_random_uuid(),
      selected_conversation_count = v_selected,
      inventory_text = format(
        'selected_conversations=%s | existing_active_lcl=6 | runner_opportunities=7 | runner_sessions=5 | runner_merged_customers=1 | runner_inactive_lcl=1',
        v_selected
      );
exception
  when others then
    begin execute 'reset role'; exception when others then null; end;
    begin
      execute 'alter table public.lead_customer_links enable trigger lead_customer_links_enforce_write_rules';
    exception when others then null;
    end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    update pg_temp._p9_cscl_context
    set setup_status = 'HARNESS_ERROR',
        setup_detail = 'setup failed with ' || sqlstate || ': ' || sqlerrm;
end;
$setup$;

-- --------------------------------------------------------------------------
-- Gate: falhas do harness/fixture nao podem virar falsos SUT_FAIL.
-- --------------------------------------------------------------------------

do $functional_gate$
declare
  v_setup text;
  v_preflight text;
  v_detail text;
begin
  select setup_status, harness_preflight,
         'preflight=' || harness_preflight || ' (' || harness_detail || ')' ||
         ' | setup=' || setup_status || ' (' || setup_detail || ')'
  into v_setup, v_preflight, v_detail
  from pg_temp._p9_cscl_context;

  if v_preflight <> 'PASS' or v_setup = 'HARNESS_ERROR' then
    insert into pg_temp._p9_cscl_results (
      scenario_number, scenario_name, status, detail,
      returned_sqlstate, constraint_name, postcondition
    )
    select scenario_number, scenario_name, 'HARNESS_ERROR', v_detail,
           null, null, 'functional scenario skipped because the harness was not trustworthy'
    from pg_temp._p9_cscl_matrix
    where scenario_number between 2 and 33;
  elsif v_setup <> 'PASS' then
    insert into pg_temp._p9_cscl_results (
      scenario_number, scenario_name, status, detail,
      returned_sqlstate, constraint_name, postcondition
    )
    select scenario_number, scenario_name, 'BLOCKED_BY_FIXTURE_PREREQUISITE', v_detail,
           null, null, 'functional scenario skipped because safe real fixtures were unavailable'
    from pg_temp._p9_cscl_matrix
    where scenario_number between 2 and 33;
  end if;
end;
$functional_gate$;

-- --------------------------------------------------------------------------
-- Cenario 1: estrutura e hardening.
-- --------------------------------------------------------------------------

do $scenario_1$
declare
  v_ok boolean := false;
  v_link_def text;
  v_replace_def text;
begin
  select lower(pg_get_functiondef(
    to_regprocedure('public.link_commercial_session_context(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,uuid,jsonb,timestamp with time zone)')
  )) into v_link_def;

  select lower(pg_get_functiondef(
    to_regprocedure('public.replace_commercial_session_context_link(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,uuid,jsonb,text,text,jsonb,timestamp with time zone)')
  )) into v_replace_def;

  select
    to_regclass('public.commercial_session_context_links') is not null
    and (select count(*) = 24 from information_schema.columns
         where table_schema = 'public' and table_name = 'commercial_session_context_links')
    and (select count(*) = 22 from pg_constraint
         where conrelid = to_regclass('public.commercial_session_context_links'))
    and (select count(*) = 10 from pg_indexes
         where schemaname = 'public' and tablename = 'commercial_session_context_links')
    and exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'commercial_session_context_links'
        and c.relrowsecurity and not c.relforcerowsecurity
        and pg_get_userbyid(c.relowner) = 'postgres'
    )
    and exists (select 1 from pg_roles where rolname = 'service_role' and rolbypassrls)
    and (select count(*) = 1 from pg_policies
         where schemaname = 'public' and tablename = 'commercial_session_context_links')
    and exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'commercial_session_context_links'
        and policyname = 'commercial_session_context_links_select_by_membership'
        and cmd = 'SELECT' and roles = array['authenticated']::name[]
        and with_check is null and strpos(lower(qual), 'memberships') > 0
        and strpos(lower(qual), 'auth.uid()') > 0
    )
    and has_table_privilege('authenticated', 'public.commercial_session_context_links', 'SELECT')
    and not has_table_privilege('authenticated', 'public.commercial_session_context_links', 'INSERT')
    and not has_table_privilege('authenticated', 'public.commercial_session_context_links', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.commercial_session_context_links', 'DELETE')
    and has_table_privilege('service_role', 'public.commercial_session_context_links', 'SELECT')
    and not has_table_privilege('service_role', 'public.commercial_session_context_links', 'INSERT')
    and not has_table_privilege('service_role', 'public.commercial_session_context_links', 'UPDATE')
    and not has_table_privilege('service_role', 'public.commercial_session_context_links', 'DELETE')
    and not has_table_privilege('anon', 'public.commercial_session_context_links', 'SELECT')
    and exists (
      select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      join pg_namespace n on n.oid = p.pronamespace
      where t.tgrelid = to_regclass('public.commercial_session_context_links')
        and t.tgname = 'commercial_session_context_links_enforce_write_rules'
        and t.tgtype = 31 and not t.tgisinternal and t.tgenabled = 'O'
        and n.nspname = 'public'
        and p.proname = 'enforce_commercial_session_context_link_write_rules'
    )
    and (select count(*) = 4 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in (
           'enforce_commercial_session_context_link_write_rules',
           'link_commercial_session_context',
           'close_commercial_session_context_link',
           'replace_commercial_session_context_link'))
    and (select count(*) = 3 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         join pg_roles r on r.oid = p.proowner
         where n.nspname = 'public'
           and p.proname in ('link_commercial_session_context','close_commercial_session_context_link','replace_commercial_session_context_link')
           and p.prosecdef and r.rolname = 'postgres'
           and p.proconfig @> array['search_path=pg_catalog, pg_temp','row_security=off']::text[]
           and has_function_privilege('authenticated', p.oid, 'EXECUTE')
           and has_function_privilege('service_role', p.oid, 'EXECUTE')
           and not has_function_privilege('anon', p.oid, 'EXECUTE'))
    and exists (
      select 1 from pg_constraint
      where conrelid = to_regclass('public.commercial_session_context_links')
        and conname = 'commercial_session_context_links_temporal_order_check'
        and regexp_replace(lower(pg_get_constraintdef(oid, true)), '[[:space:]()]', '', 'g') =
            'checkunlinked_atisnullorunlinked_at>=linked_at'
    )
    and exists (
      select 1 from pg_constraint
      where conrelid = to_regclass('public.commercial_session_context_links')
        and conname = 'commercial_session_context_links_metadata_state_check'
        and strpos(lower(pg_get_constraintdef(oid, true)), 'jsonb_typeof') > 0
        and strpos(lower(pg_get_constraintdef(oid, true)), 'unlink') > 0
    )
    and exists (
      select 1 from pg_indexes
      where schemaname='public' and tablename='commercial_session_context_links'
        and indexname='commercial_session_context_links_one_active_per_session_uidx'
        and regexp_replace(lower(indexdef), '[[:space:]()]', '', 'g') like '%wherestatus=''active''::text'
    )
    and exists (
      select 1 from pg_indexes
      where schemaname='public' and tablename='commercial_session_context_links'
        and indexname='commercial_session_context_links_idempotency_uidx'
        and regexp_replace(lower(indexdef), '[[:space:]()]', '', 'g') like '%whereidempotency_keyisnotnull'
    )
    and strpos(v_link_def, 'jsonb_typeof(v_claims) <> ''object''') > 0
    and strpos(v_link_def, 'v_metadata ? ''replacement''') > 0
    and strpos(v_link_def, 'v_effective_linked_at > pg_catalog.clock_timestamp()') > 0
    and strpos(v_replace_def, 'p_linked_at > pg_catalog.clock_timestamp()') > 0
    and strpos(v_replace_def, 'v_effective_linked_at := coalesce') > 0
    and strpos(v_replace_def, 'v_old.unlinked_at') > 0
  into v_ok;

  insert into pg_temp._p9_cscl_results values (
    1, 'estrutura e hardening encontrados',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    case when v_ok
      then '24 columns, 22 constraints, 10 indexes, exact partial predicates, RLS, BYPASSRLS, grants, functions, claims, metadata and temporal protections matched'
      else 'one or more structural, authorization, metadata or temporal contracts differ from the approved foundation'
    end,
    null, null,
    'full structural contract and newly hardened protections checked'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (1, 'estrutura e hardening encontrados', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_1$;

-- --------------------------------------------------------------------------
-- Cenarios 2 a 22: funcoes controladas e negativos funcionais.
-- --------------------------------------------------------------------------

do $scenario_2$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_opp uuid; v_lcl uuid;
  v_member uuid; v_run uuid; v_key text; v_exec record; v_id uuid; v_count integer;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 2) then return; end if;
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 1;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 1;
  select opportunity_id into v_opp from pg_temp._p9_cscl_opportunities where fixture_number = 1;
  select link_id into v_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 1;
  v_key := 'runner:' || v_run::text || ':auth-valid';

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'authenticated', v_member,
    format($sql$
      select (public.link_commercial_session_context(
        p_organization_id => %L, p_store_id => %L, p_conversation_session_id => %L,
        p_customer_id => %L, p_commercial_opportunity_id => %L,
        p_lead_customer_link_id => %L, p_source => 'manual',
        p_linked_by_actor_type => 'human', p_linked_by_user_id => %L,
        p_source_reference => 'runner scenario 2', p_idempotency_key => %L,
        p_correlation_id => %L, p_metadata => '{"runner":true,"scenario":2}'::jsonb
      )).id::text
    $sql$, v_org, v_store, v_session, v_customer, v_opp, v_lcl, v_member, v_key, v_run)
  );

  if v_exec.operation_succeeded then
    v_id := v_exec.value_text::uuid;
    insert into pg_temp._p9_cscl_state values ('auth_link_id', v_id, null)
    on conflict (state_key) do update set value_uuid = excluded.value_uuid;
    insert into pg_temp._p9_cscl_state values ('auth_link_key', null, v_key)
    on conflict (state_key) do update set value_text = excluded.value_text;
  end if;

  select count(*) into v_count
  from public.commercial_session_context_links
  where id = v_id
    and organization_id = v_org and store_id = v_store
    and conversation_session_id = v_session and customer_id = v_customer
    and commercial_opportunity_id = v_opp and lead_customer_link_id = v_lcl
    and status = 'active' and source = 'manual'
    and linked_by_actor_type = 'human' and linked_by_user_id = v_member
    and idempotency_key = v_key and correlation_id = v_run;

  insert into pg_temp._p9_cscl_results values (
    2, 'criacao valida por human autenticado',
    case when v_exec.operation_succeeded and v_count = 1 then 'PASS' else 'SUT_FAIL' end,
    format('created=%s | matching_rows=%s', v_exec.operation_succeeded, v_count),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'authenticated human member created exactly one active context row'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (2, 'criacao valida por human autenticado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_2$;

do $scenario_3$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_opp uuid; v_lcl uuid;
  v_member uuid; v_run uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 3) then return; end if;
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 1;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 1;
  select opportunity_id into v_opp from pg_temp._p9_cscl_opportunities where fixture_number = 1;
  select link_id into v_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 1;

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'authenticated', v_member,
    format($sql$
      select (public.link_commercial_session_context(
        p_organization_id => %L, p_store_id => %L, p_conversation_session_id => %L,
        p_customer_id => %L, p_commercial_opportunity_id => %L,
        p_lead_customer_link_id => %L, p_source => 'manual',
        p_linked_by_actor_type => 'human', p_linked_by_user_id => null,
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_session, v_customer, v_opp, v_lcl,
           'runner:' || v_run::text || ':human-no-user', v_run)
  );

  insert into pg_temp._p9_cscl_results values (
    3, 'human sem user_id rejeitado',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '22023'
              and v_exec.message_text = 'commercial session context link actor is invalid'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'human actor without user_id is rejected'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (3, 'human sem user_id rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_3$;

do $scenario_4$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_opp uuid; v_lcl uuid;
  v_member uuid; v_run uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 4) then return; end if;
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 1;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 1;
  select opportunity_id into v_opp from pg_temp._p9_cscl_opportunities where fixture_number = 1;
  select link_id into v_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 1;

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'authenticated', v_member,
    format($sql$
      select (public.link_commercial_session_context(
        p_organization_id => %L, p_store_id => %L, p_conversation_session_id => %L,
        p_customer_id => %L, p_commercial_opportunity_id => %L,
        p_lead_customer_link_id => %L, p_source => 'manual',
        p_linked_by_actor_type => 'human', p_linked_by_user_id => %L,
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_session, v_customer, v_opp, v_lcl,
           gen_random_uuid(), 'runner:' || v_run::text || ':wrong-claim', v_run)
  );

  insert into pg_temp._p9_cscl_results values (
    4, 'human com user_id divergente do claim rejeitado',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '42501'
              and v_exec.message_text = 'commercial session context link operation is not authorized'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'human actor user must match authenticated claim sub'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (4, 'human com user_id divergente do claim rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_4$;

do $scenario_5$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_opp uuid; v_lcl uuid;
  v_member uuid; v_run uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 5) then return; end if;
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 1;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 1;
  select opportunity_id into v_opp from pg_temp._p9_cscl_opportunities where fixture_number = 1;
  select link_id into v_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 1;

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'authenticated', v_member,
    format($sql$
      select (public.link_commercial_session_context(
        p_organization_id => %L, p_store_id => %L, p_conversation_session_id => %L,
        p_customer_id => %L, p_commercial_opportunity_id => %L,
        p_lead_customer_link_id => %L, p_source => 'manual',
        p_linked_by_actor_type => 'system', p_linked_by_user_id => %L,
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_session, v_customer, v_opp, v_lcl,
           v_member, 'runner:' || v_run::text || ':system-with-user', v_run)
  );

  insert into pg_temp._p9_cscl_results values (
    5, 'non-human com user_id rejeitado',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '22023'
              and v_exec.message_text = 'commercial session context link actor is invalid'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'non-human actor with user_id is rejected'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (5, 'non-human com user_id rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_5$;

do $scenario_6$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_opp uuid; v_lcl uuid;
  v_run uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 6) then return; end if;
  select organization_id, store_id, run_id
  into v_org, v_store, v_run from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 1;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 1;
  select opportunity_id into v_opp from pg_temp._p9_cscl_opportunities where fixture_number = 1;
  select link_id into v_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 1;

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'anon', null,
    format($sql$
      select (public.link_commercial_session_context(
        p_organization_id => %L, p_store_id => %L, p_conversation_session_id => %L,
        p_customer_id => %L, p_commercial_opportunity_id => %L,
        p_lead_customer_link_id => %L, p_source => 'system',
        p_linked_by_actor_type => 'system', p_linked_by_user_id => null,
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_session, v_customer, v_opp, v_lcl,
           'runner:' || v_run::text || ':anon', v_run)
  );

  insert into pg_temp._p9_cscl_results values (
    6, 'anon rejeitado',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '42501'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'anon cannot operate controlled functions'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (6, 'anon rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_6$;

do $scenario_7$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_opp uuid; v_lcl uuid;
  v_member uuid; v_run uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 7) then return; end if;
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 1;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 1;
  select opportunity_id into v_opp from pg_temp._p9_cscl_opportunities where fixture_number = 1;
  select link_id into v_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 1;

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'authenticated', v_member,
    format($sql$
      select (public.link_commercial_session_context(
        p_organization_id => %L, p_store_id => %L, p_conversation_session_id => %L,
        p_customer_id => %L, p_commercial_opportunity_id => %L,
        p_lead_customer_link_id => %L, p_source => 'system',
        p_linked_by_actor_type => 'system', p_linked_by_user_id => null,
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_session, v_customer, v_opp, v_lcl,
           'runner:' || v_run::text || ':auth-system', v_run)
  );

  insert into pg_temp._p9_cscl_results values (
    7, 'authenticated tentando actor system rejeitado',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '42501'
              and v_exec.message_text = 'commercial session context link operation is not authorized'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'authenticated users cannot operate non-human actors'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (7, 'authenticated tentando actor system rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_7$;

do $scenario_8$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_opp uuid; v_lcl uuid;
  v_member uuid; v_run uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 8) then return; end if;
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 1;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 1;
  select opportunity_id into v_opp from pg_temp._p9_cscl_opportunities where fixture_number = 1;
  select link_id into v_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 1;

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.link_commercial_session_context(
        p_organization_id => %L, p_store_id => %L, p_conversation_session_id => %L,
        p_customer_id => %L, p_commercial_opportunity_id => %L,
        p_lead_customer_link_id => %L, p_source => 'manual',
        p_linked_by_actor_type => 'human', p_linked_by_user_id => %L,
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_session, v_customer, v_opp, v_lcl,
           v_member, 'runner:' || v_run::text || ':service-human', v_run)
  );

  insert into pg_temp._p9_cscl_results values (
    8, 'service_role tentando actor human rejeitado',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '42501'
              and v_exec.message_text = 'commercial session context link operation is not authorized'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'service_role cannot operate human actors'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (8, 'service_role tentando actor human rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_8$;

do $scenario_9$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_member uuid;
  v_random uuid := gen_random_uuid(); v_exec record; v_count integer;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 9) then return; end if;
  select organization_id, store_id, member_user_id
  into v_org, v_store, v_member from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 1;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 1;

  select * into v_exec from pg_temp._p9_cscl_exec_dml(
    'authenticated', v_member,
    format($sql$
      insert into public.commercial_session_context_links (
        id, organization_id, store_id, conversation_session_id,
        customer_id, commercial_opportunity_id, lead_customer_link_id,
        status, source, linked_by_actor_type, metadata
      ) values (
        %L, %L, %L, %L, %L, %L, %L, 'active', 'manual', 'human', '{}'::jsonb
      )
    $sql$, v_random, v_org, v_store, v_session, v_customer, gen_random_uuid(), gen_random_uuid())
  );

  select count(*) into v_count from public.commercial_session_context_links where id = v_random;

  insert into pg_temp._p9_cscl_results values (
    9, 'INSERT direto authenticated rejeitado',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '42501'
              and v_count = 0
         then 'PASS' else 'SUT_FAIL' end,
    format('sqlstate=%s | inserted_rows=%s',
           coalesce(v_exec.returned_sqlstate, '<none>'), v_count),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'authenticated direct insert is blocked'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (9, 'INSERT direto authenticated rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_9$;

do $scenario_10$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid;
  v_random uuid := gen_random_uuid(); v_exec record; v_count integer;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 10) then return; end if;
  select organization_id, store_id
  into v_org, v_store from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 1;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 1;

  select * into v_exec from pg_temp._p9_cscl_exec_dml(
    'service_role', null,
    format($sql$
      insert into public.commercial_session_context_links (
        id, organization_id, store_id, conversation_session_id,
        customer_id, commercial_opportunity_id, lead_customer_link_id,
        status, source, linked_by_actor_type, metadata
      ) values (
        %L, %L, %L, %L, %L, %L, %L, 'active', 'system', 'system', '{}'::jsonb
      )
    $sql$, v_random, v_org, v_store, v_session, v_customer, gen_random_uuid(), gen_random_uuid())
  );

  select count(*) into v_count from public.commercial_session_context_links where id = v_random;

  insert into pg_temp._p9_cscl_results values (
    10, 'INSERT direto service_role rejeitado',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '42501'
              and v_count = 0
         then 'PASS' else 'SUT_FAIL' end,
    format('sqlstate=%s | inserted_rows=%s',
           coalesce(v_exec.returned_sqlstate, '<none>'), v_count),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'service_role direct insert is blocked'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (10, 'INSERT direto service_role rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_10$;

do $scenario_11$
declare
  v_target uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 11) then return; end if;
  select value_uuid into v_target from pg_temp._p9_cscl_state where state_key = 'auth_link_id';
  if v_target is null then
    insert into pg_temp._p9_cscl_results values
      (11, 'UPDATE direto rejeitado', 'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'scenario 2 did not create the base authenticated context row', null, null, 'no direct UPDATE attempted');
    return;
  end if;

  select * into v_exec from pg_temp._p9_cscl_exec_dml(
    'service_role', null,
    format('update public.commercial_session_context_links set metadata = metadata where id = %L', v_target)
  );

  insert into pg_temp._p9_cscl_results values (
    11, 'UPDATE direto rejeitado',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '42501'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.returned_sqlstate, '<none>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'service_role direct update is blocked'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (11, 'UPDATE direto rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_11$;

do $scenario_12$
declare
  v_target uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 12) then return; end if;
  select value_uuid into v_target from pg_temp._p9_cscl_state where state_key = 'auth_link_id';
  if v_target is null then
    insert into pg_temp._p9_cscl_results values
      (12, 'DELETE direto rejeitado', 'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'scenario 2 did not create the base authenticated context row', null, null, 'no direct DELETE attempted');
    return;
  end if;

  select * into v_exec from pg_temp._p9_cscl_exec_dml(
    'service_role', null,
    format('delete from public.commercial_session_context_links where id = %L', v_target)
  );

  insert into pg_temp._p9_cscl_results values (
    12, 'DELETE direto rejeitado',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '42501'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.returned_sqlstate, '<none>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'service_role direct delete is blocked'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (12, 'DELETE direto rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_12$;

do $scenario_13$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_opp uuid; v_lcl uuid;
  v_member uuid; v_run uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 13) then return; end if;
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 1;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 1;
  select opportunity_id into v_opp from pg_temp._p9_cscl_opportunities where fixture_number = 1;
  select link_id into v_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 1;

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'authenticated', v_member,
    format($sql$
      select (public.link_commercial_session_context(
        p_organization_id => %L, p_store_id => %L, p_conversation_session_id => %L,
        p_customer_id => %L, p_commercial_opportunity_id => %L,
        p_lead_customer_link_id => %L, p_source => 'manual',
        p_linked_by_actor_type => 'human', p_linked_by_user_id => %L,
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, gen_random_uuid(), v_session, v_customer, v_opp, v_lcl,
           v_member, 'runner:' || v_run::text || ':wrong-store', v_run)
  );

  insert into pg_temp._p9_cscl_results values (
    13, 'sessao de outra organizacao ou loja rejeitada',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '23514'
              and v_exec.message_text = 'commercial session context link relation mismatch'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'scope mismatch on organization/store is rejected generically'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (13, 'sessao de outra organizacao ou loja rejeitada', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_13$;

do $scenario_14$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_opp uuid; v_lcl uuid;
  v_member uuid; v_run uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 14) then return; end if;
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 2;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 2;
  select opportunity_id into v_opp from pg_temp._p9_cscl_opportunities where fixture_number = 2;
  select link_id into v_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 2;

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'authenticated', v_member,
    format($sql$
      select (public.link_commercial_session_context(
        p_organization_id => %L, p_store_id => %L, p_conversation_session_id => %L,
        p_customer_id => %L, p_commercial_opportunity_id => %L,
        p_lead_customer_link_id => %L, p_source => 'manual',
        p_linked_by_actor_type => 'human', p_linked_by_user_id => %L,
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_session, v_customer, v_opp, v_lcl,
           v_member, 'runner:' || v_run::text || ':closed-session', v_run)
  );

  insert into pg_temp._p9_cscl_results values (
    14, 'sessao closed rejeitada',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '23514'
              and v_exec.message_text = 'commercial session context link relation mismatch'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'closed session cannot be classified'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (14, 'sessao closed rejeitada', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_14$;

do $scenario_15$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_opp uuid; v_lcl uuid;
  v_member uuid; v_run uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 15) then return; end if;
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 1;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 1;
  select opportunity_id into v_opp from pg_temp._p9_cscl_opportunities where fixture_number = 2;
  select link_id into v_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 1;

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'authenticated', v_member,
    format($sql$
      select (public.link_commercial_session_context(
        p_organization_id => %L, p_store_id => %L, p_conversation_session_id => %L,
        p_customer_id => %L, p_commercial_opportunity_id => %L,
        p_lead_customer_link_id => %L, p_source => 'manual',
        p_linked_by_actor_type => 'human', p_linked_by_user_id => %L,
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_session, v_customer, v_opp, v_lcl,
           v_member, 'runner:' || v_run::text || ':wrong-opportunity', v_run)
  );

  insert into pg_temp._p9_cscl_results values (
    15, 'oportunidade de outro customer rejeitada',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '23514'
              and v_exec.message_text = 'commercial session context link relation mismatch'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'opportunity/customer mismatch is rejected generically'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (15, 'oportunidade de outro customer rejeitada', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_15$;

do $scenario_16$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_opp uuid; v_lcl uuid;
  v_member uuid; v_run uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 16) then return; end if;
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 1;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 4;
  select opportunity_id into v_opp from pg_temp._p9_cscl_opportunities where fixture_number = 4;
  select link_id into v_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 4;

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'authenticated', v_member,
    format($sql$
      select (public.link_commercial_session_context(
        p_organization_id => %L, p_store_id => %L, p_conversation_session_id => %L,
        p_customer_id => %L, p_commercial_opportunity_id => %L,
        p_lead_customer_link_id => %L, p_source => 'manual',
        p_linked_by_actor_type => 'human', p_linked_by_user_id => %L,
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_session, v_customer, v_opp, v_lcl,
           v_member, 'runner:' || v_run::text || ':other-lead', v_run)
  );

  insert into pg_temp._p9_cscl_results values (
    16, 'lead_customer_link de outro lead rejeitado',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '23514'
              and v_exec.message_text = 'commercial session context link relation mismatch'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'lead evidence from another lead is rejected generically'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (16, 'lead_customer_link de outro lead rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_16$;

do $scenario_17$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_opp uuid; v_lcl uuid;
  v_member uuid; v_run uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 17) then return; end if;
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 6;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 6;
  select opportunity_id into v_opp from pg_temp._p9_cscl_opportunities where fixture_number = 6;
  select link_id into v_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 7;

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'authenticated', v_member,
    format($sql$
      select (public.link_commercial_session_context(
        p_organization_id => %L, p_store_id => %L, p_conversation_session_id => %L,
        p_customer_id => %L, p_commercial_opportunity_id => %L,
        p_lead_customer_link_id => %L, p_source => 'manual',
        p_linked_by_actor_type => 'human', p_linked_by_user_id => %L,
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_session, v_customer, v_opp, v_lcl,
           v_member, 'runner:' || v_run::text || ':inactive-lcl', v_run)
  );

  insert into pg_temp._p9_cscl_results values (
    17, 'lead_customer_link inactive rejeitado',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '23514'
              and v_exec.message_text = 'commercial session context link relation mismatch'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'inactive evidence is rejected generically'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (17, 'lead_customer_link inactive rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_17$;

do $scenario_18$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_opp uuid; v_lcl uuid;
  v_member uuid; v_run uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 18) then return; end if;
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 1;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 7;
  select opportunity_id into v_opp from pg_temp._p9_cscl_opportunities where fixture_number = 7;
  select link_id into v_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 1;

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'authenticated', v_member,
    format($sql$
      select (public.link_commercial_session_context(
        p_organization_id => %L, p_store_id => %L, p_conversation_session_id => %L,
        p_customer_id => %L, p_commercial_opportunity_id => %L,
        p_lead_customer_link_id => %L, p_source => 'manual',
        p_linked_by_actor_type => 'human', p_linked_by_user_id => %L,
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_session, v_customer, v_opp, v_lcl,
           v_member, 'runner:' || v_run::text || ':merged-customer', v_run)
  );

  insert into pg_temp._p9_cscl_results values (
    18, 'customer merged rejeitado',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '23514'
              and v_exec.message_text = 'commercial session context link relation mismatch'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'merged customer cannot be linked into session context'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (18, 'customer merged rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_18$;

do $scenario_19$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_opp uuid; v_lcl uuid;
  v_run uuid; v_exec record; v_id uuid; v_count integer;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 19) then return; end if;
  select organization_id, store_id, run_id
  into v_org, v_store, v_run from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 5;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 5;
  select opportunity_id into v_opp from pg_temp._p9_cscl_opportunities where fixture_number = 5;
  select link_id into v_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 5;

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.link_commercial_session_context(
        p_organization_id => %L, p_store_id => %L, p_conversation_session_id => %L,
        p_customer_id => %L, p_commercial_opportunity_id => %L,
        p_lead_customer_link_id => %L, p_source => 'system',
        p_linked_by_actor_type => 'system', p_linked_by_user_id => null,
        p_idempotency_key => %L, p_correlation_id => %L,
        p_metadata => '{"runner":true,"scenario":19}'::jsonb
      )).id::text
    $sql$, v_org, v_store, v_session, v_customer, v_opp, v_lcl,
           'runner:' || v_run::text || ':service-valid', v_run)
  );

  if v_exec.operation_succeeded then
    v_id := v_exec.value_text::uuid;
    insert into pg_temp._p9_cscl_state values ('service_link_id', v_id, null)
    on conflict (state_key) do update set value_uuid = excluded.value_uuid;
  end if;

  select count(*) into v_count
  from public.commercial_session_context_links
  where id = v_id
    and status = 'active'
    and linked_by_actor_type = 'system'
    and linked_by_user_id is null;

  insert into pg_temp._p9_cscl_results values (
    19, 'criacao valida por service_role actor system',
    case when v_exec.operation_succeeded and v_count = 1 then 'PASS' else 'SUT_FAIL' end,
    format('created=%s | matching_rows=%s', v_exec.operation_succeeded, v_count),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'service_role system actor created exactly one active context row'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (19, 'criacao valida por service_role actor system', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_19$;

do $scenario_20$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_opp uuid; v_lcl uuid;
  v_run uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 20) then return; end if;
  select organization_id, store_id, run_id
  into v_org, v_store, v_run from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 5;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 5;
  select opportunity_id into v_opp from pg_temp._p9_cscl_opportunities where fixture_number = 5;
  select link_id into v_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 5;

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.link_commercial_session_context(
        p_organization_id => %L, p_store_id => %L, p_conversation_session_id => %L,
        p_customer_id => %L, p_commercial_opportunity_id => %L,
        p_lead_customer_link_id => %L, p_source => 'system',
        p_linked_by_actor_type => 'system', p_linked_by_user_id => null,
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_session, v_customer, v_opp, v_lcl,
           'runner:' || v_run::text || ':service-second', v_run)
  );

  insert into pg_temp._p9_cscl_results values (
    20, 'uma unica linha active por sessao',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '23505'
              and v_exec.message_text = 'commercial session already has an active context link'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'second active context on the same session is rejected clearly'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (20, 'uma unica linha active por sessao', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_20$;

do $scenario_21$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_opp uuid; v_lcl uuid;
  v_member uuid; v_run uuid; v_key text; v_expected uuid; v_exec record; v_count integer;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 21) then return; end if;
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 1;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 1;
  select opportunity_id into v_opp from pg_temp._p9_cscl_opportunities where fixture_number = 1;
  select link_id into v_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 1;
  select value_uuid into v_expected from pg_temp._p9_cscl_state where state_key = 'auth_link_id';
  select value_text into v_key from pg_temp._p9_cscl_state where state_key = 'auth_link_key';

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'authenticated', v_member,
    format($sql$
      select (public.link_commercial_session_context(
        p_organization_id => %L, p_store_id => %L, p_conversation_session_id => %L,
        p_customer_id => %L, p_commercial_opportunity_id => %L,
        p_lead_customer_link_id => %L, p_source => 'manual',
        p_linked_by_actor_type => 'human', p_linked_by_user_id => %L,
        p_source_reference => 'runner scenario 2', p_idempotency_key => %L,
        p_correlation_id => %L, p_metadata => '{"runner":true,"scenario":2}'::jsonb
      )).id::text
    $sql$, v_org, v_store, v_session, v_customer, v_opp, v_lcl, v_member, v_key, v_run)
  );

  select count(*) into v_count
  from public.commercial_session_context_links
  where organization_id = v_org and idempotency_key = v_key;

  insert into pg_temp._p9_cscl_results values (
    21, 'replay idempotente retorna o mesmo id',
    case when v_exec.operation_succeeded
              and v_exec.value_text::uuid = v_expected
              and v_count = 1
         then 'PASS' else 'SUT_FAIL' end,
    format('returned_id=%s | expected_id=%s | row_count=%s',
           coalesce(v_exec.value_text, '<null>'), v_expected, v_count),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'same idempotency key returned the original id and left exactly one row'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (21, 'replay idempotente retorna o mesmo id', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_21$;

do $scenario_22$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_opp uuid; v_lcl uuid;
  v_member uuid; v_run uuid; v_key text; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 22) then return; end if;
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 1;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 1;
  select opportunity_id into v_opp from pg_temp._p9_cscl_opportunities where fixture_number = 1;
  select link_id into v_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 1;
  select value_text into v_key from pg_temp._p9_cscl_state where state_key = 'auth_link_key';

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'authenticated', v_member,
    format($sql$
      select (public.link_commercial_session_context(
        p_organization_id => %L, p_store_id => %L, p_conversation_session_id => %L,
        p_customer_id => %L, p_commercial_opportunity_id => %L,
        p_lead_customer_link_id => %L, p_source => 'system',
        p_linked_by_actor_type => 'human', p_linked_by_user_id => %L,
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_session, v_customer, v_opp, v_lcl, v_member, v_key, v_run)
  );

  insert into pg_temp._p9_cscl_results values (
    22, 'conflito de idempotency_key rejeitado',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '23505'
              and v_exec.message_text = 'commercial session context link idempotency conflict'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'same key with a different logical payload must fail deterministically'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (22, 'conflito de idempotency_key rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_22$;

do $scenario_23$
declare
  v_org uuid; v_store uuid; v_run uuid; v_link uuid; v_member uuid; v_exec record; v_count integer;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 23) then return; end if;
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_cscl_context;
  select value_uuid into v_link from pg_temp._p9_cscl_state where state_key = 'auth_link_id';

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'authenticated', v_member,
    format($sql$
      select (public.close_commercial_session_context_link(
        p_link_id => %L, p_organization_id => %L, p_store_id => %L,
        p_unlinked_by_actor_type => 'human', p_unlinked_by_user_id => %L,
        p_unlink_reason_code => 'runner_close',
        p_unlink_reason => 'runner scenario 23',
        p_metadata => '{"runner":true,"scenario":23}'::jsonb,
        p_correlation_id => %L
      )).id::text
    $sql$, v_link, v_org, v_store, v_member, v_run)
  );

  if v_exec.operation_succeeded then
    insert into pg_temp._p9_cscl_state values ('closed_link_id', v_link, null)
    on conflict (state_key) do update set value_uuid = excluded.value_uuid;
  end if;

  select count(*) into v_count
  from public.commercial_session_context_links
  where id = v_link
    and status = 'inactive'
    and unlinked_at is not null
    and unlinked_by_actor_type = 'human'
    and unlinked_by_user_id = v_member
    and unlink_reason_code = 'runner_close';

  insert into pg_temp._p9_cscl_results values (
    23, 'encerramento valido',
    case when v_exec.operation_succeeded and v_count = 1 then 'PASS' else 'SUT_FAIL' end,
    format('closed=%s | matching_inactive=%s', v_exec.operation_succeeded, v_count),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'active context becomes inactive with audit fields preserved'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (23, 'encerramento valido', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_23$;

do $scenario_24$
declare
  v_link uuid; v_state text; v_message text; v_customer uuid;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 24) then return; end if;
  select value_uuid into v_link from pg_temp._p9_cscl_state where state_key = 'service_link_id';
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 2;

  if v_link is null then
    insert into pg_temp._p9_cscl_results values
      (24, 'campos centrais imutaveis', 'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'scenario 19 did not create the service_role active context row', null, null, 'no trigger probe executed');
    return;
  end if;

  begin
    update public.commercial_session_context_links
    set customer_id = v_customer
    where id = v_link;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;

  insert into pg_temp._p9_cscl_results values (
    24, 'campos centrais imutaveis',
    case when v_state = 'P0001'
              and v_message = 'commercial session context link core fields are immutable'
         then 'PASS' else 'SUT_FAIL' end,
    format('sqlstate=%s | message=%s',
           coalesce(v_state, '<none>'), coalesce(v_message, '<none>')),
    v_state, null,
    'core field mutation is rejected by the trigger'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (24, 'campos centrais imutaveis', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_24$;

do $scenario_25$
declare
  v_link uuid; v_state text; v_message text;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 25) then return; end if;
  select value_uuid into v_link from pg_temp._p9_cscl_state where state_key = 'closed_link_id';

  if v_link is null then
    insert into pg_temp._p9_cscl_results values
      (25, 'linha inactive imutavel', 'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'scenario 23 did not close the authenticated context row', null, null, 'no trigger probe executed');
    return;
  end if;

  begin
    update public.commercial_session_context_links
    set metadata = metadata || '{"tampered":true}'::jsonb
    where id = v_link;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;

  insert into pg_temp._p9_cscl_results values (
    25, 'linha inactive imutavel',
    case when v_state = 'P0001'
              and v_message = 'inactive commercial session context link is immutable'
         then 'PASS' else 'SUT_FAIL' end,
    format('sqlstate=%s | message=%s',
           coalesce(v_state, '<none>'), coalesce(v_message, '<none>')),
    v_state, null,
    'inactive row does not accept any later mutation'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (25, 'linha inactive imutavel', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_25$;

do $scenario_26$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_opp uuid; v_lcl uuid;
  v_member uuid; v_run uuid; v_old_exec record; v_replace record;
  v_old_id uuid; v_new_id uuid; v_valid_count integer;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 26) then return; end if;
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 3;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 3;
  select opportunity_id into v_opp from pg_temp._p9_cscl_opportunities where fixture_number = 3;
  select link_id into v_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 3;

  select * into v_old_exec from pg_temp._p9_cscl_exec_scalar(
    'authenticated', v_member,
    format($sql$
      select (public.link_commercial_session_context(
        p_organization_id => %L, p_store_id => %L, p_conversation_session_id => %L,
        p_customer_id => %L, p_commercial_opportunity_id => %L,
        p_lead_customer_link_id => %L, p_source => 'manual',
        p_linked_by_actor_type => 'human', p_linked_by_user_id => %L,
        p_source_reference => 'runner scenario 26 old', p_idempotency_key => %L,
        p_correlation_id => %L,
        p_metadata => '{"runner":true,"scenario":26,"phase":"old"}'::jsonb
      )).id::text
    $sql$, v_org, v_store, v_session, v_customer, v_opp, v_lcl,
           v_member, 'runner:' || v_run::text || ':replace-old-context', v_run)
  );

  if not v_old_exec.operation_succeeded then
    insert into pg_temp._p9_cscl_results values
      (26, 'substituicao valida e atomica', 'SUT_FAIL',
       'base context creation failed: ' || coalesce(v_old_exec.message_text, '<no message>'),
       v_old_exec.returned_sqlstate, v_old_exec.constraint_name, 'replacement not attempted');
    return;
  end if;
  v_old_id := v_old_exec.value_text::uuid;

  select * into v_replace from pg_temp._p9_cscl_exec_scalar(
    'authenticated', v_member,
    format($sql$
      select (public.replace_commercial_session_context_link(
        p_old_link_id => %L, p_organization_id => %L, p_store_id => %L,
        p_new_customer_id => %L, p_new_commercial_opportunity_id => %L,
        p_new_lead_customer_link_id => %L, p_source => 'manual',
        p_actor_type => 'human', p_actor_user_id => %L,
        p_source_reference => 'runner scenario 26 new', p_idempotency_key => %L,
        p_correlation_id => %L,
        p_link_metadata => '{"runner":true,"scenario":26,"phase":"new"}'::jsonb,
        p_unlink_reason_code => 'runner_context_correction',
        p_unlink_reason => 'runner context replacement',
        p_unlink_metadata => '{"runner":true,"scenario":26,"phase":"old"}'::jsonb
      )).id::text
    $sql$, v_old_id, v_org, v_store, v_customer, v_opp, v_lcl,
           v_member, 'runner:' || v_run::text || ':replace-context', v_run)
  );

  if v_replace.operation_succeeded then
    v_new_id := v_replace.value_text::uuid;
    insert into pg_temp._p9_cscl_state values ('replace_old_context_id', v_old_id, null)
      on conflict (state_key) do update set value_uuid = excluded.value_uuid;
    insert into pg_temp._p9_cscl_state values ('replacement_context_id', v_new_id, null)
      on conflict (state_key) do update set value_uuid = excluded.value_uuid;
  end if;

  select count(*) into v_valid_count
  from public.commercial_session_context_links old_link
  join public.commercial_session_context_links new_link
    on new_link.replaces_link_id = old_link.id
   and new_link.organization_id = old_link.organization_id
   and new_link.store_id = old_link.store_id
   and new_link.conversation_session_id = old_link.conversation_session_id
  where old_link.id = v_old_id
    and new_link.id = v_new_id
    and old_link.status = 'inactive'
    and old_link.unlinked_at is not null
    and new_link.status = 'active'
    and new_link.linked_at >= old_link.unlinked_at
    and old_link.unlink_reason_code = 'runner_context_correction'
    and new_link.metadata #>> '{replacement,replaces_link_id}' = old_link.id::text
    and (select count(*) from public.commercial_session_context_links active_row
         where active_row.organization_id = v_org and active_row.store_id = v_store
           and active_row.conversation_session_id = v_session and active_row.status = 'active') = 1;

  insert into pg_temp._p9_cscl_results values (
    26, 'substituicao valida e atomica',
    case when v_replace.operation_succeeded and v_valid_count = 1 then 'PASS' else 'SUT_FAIL' end,
    format('replacement_created=%s | full_chain_matches=%s | old=%s | new=%s',
           v_replace.operation_succeeded, v_valid_count, v_old_id, v_new_id),
    v_replace.returned_sqlstate, v_replace.constraint_name,
    'old inactive, new active, replaces chain, reason, temporal order and exactly one active row verified atomically'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (26, 'substituicao valida e atomica', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_26$;

do $scenario_27$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_opp uuid; v_lcl uuid;
  v_run uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 27) then return; end if;
  select organization_id, store_id, run_id into v_org, v_store, v_run
  from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 6;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 6;
  select opportunity_id into v_opp from pg_temp._p9_cscl_opportunities where fixture_number = 6;
  select link_id into v_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 6;

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.link_commercial_session_context(
        p_organization_id => %L, p_store_id => %L, p_conversation_session_id => %L,
        p_customer_id => %L, p_commercial_opportunity_id => %L,
        p_lead_customer_link_id => %L, p_source => 'system',
        p_linked_by_actor_type => 'system', p_linked_by_user_id => null,
        p_idempotency_key => %L, p_correlation_id => %L,
        p_metadata => '{"runner":true,"replacement":{"replaces_link_id":"00000000-0000-0000-0000-000000000000","reason_code":"fake"}}'::jsonb
      )).id::text
    $sql$, v_org, v_store, v_session, v_customer, v_opp, v_lcl,
           'runner:' || v_run::text || ':reserved-replacement', v_run)
  );

  insert into pg_temp._p9_cscl_results values (
    27, 'metadata replacement reservada rejeitada',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '22023'
              and v_exec.message_text = 'commercial session context link input is invalid'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'normal link operation cannot forge replacement audit metadata'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (27, 'metadata replacement reservada rejeitada', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_27$;

do $scenario_28$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_opp uuid; v_lcl uuid;
  v_run uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 28) then return; end if;
  select organization_id, store_id, run_id into v_org, v_store, v_run
  from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 6;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 6;
  select opportunity_id into v_opp from pg_temp._p9_cscl_opportunities where fixture_number = 6;
  select link_id into v_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 6;

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.link_commercial_session_context(
        p_organization_id => %L, p_store_id => %L, p_conversation_session_id => %L,
        p_customer_id => %L, p_commercial_opportunity_id => %L,
        p_lead_customer_link_id => %L, p_source => 'migration',
        p_linked_by_actor_type => 'migration', p_linked_by_user_id => null,
        p_idempotency_key => %L, p_correlation_id => %L,
        p_linked_at => clock_timestamp() + interval '1 day'
      )).id::text
    $sql$, v_org, v_store, v_session, v_customer, v_opp, v_lcl,
           'runner:' || v_run::text || ':future-linked-at', v_run)
  );

  insert into pg_temp._p9_cscl_results values (
    28, 'linked_at futuro rejeitado',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '22023'
              and v_exec.message_text = 'commercial session context link input is invalid'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'even migration actor cannot create a future linked_at'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (28, 'linked_at futuro rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_28$;

do $scenario_29$
declare
  v_org uuid; v_store uuid; v_session uuid; v_customer uuid; v_opp uuid; v_lcl uuid;
  v_run uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 29) then return; end if;
  select organization_id, store_id, run_id into v_org, v_store, v_run
  from pg_temp._p9_cscl_context;
  select session_id into v_session from pg_temp._p9_cscl_sessions where fixture_number = 6;
  select customer_id into v_customer from pg_temp._p9_cscl_customers where fixture_number = 6;
  select opportunity_id into v_opp from pg_temp._p9_cscl_opportunities where fixture_number = 6;
  select link_id into v_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 6;

  select * into v_exec from pg_temp._p9_cscl_exec_scalar_with_claims(
    'service_role', null, '[]',
    format($sql$
      select (public.link_commercial_session_context(
        p_organization_id => %L, p_store_id => %L, p_conversation_session_id => %L,
        p_customer_id => %L, p_commercial_opportunity_id => %L,
        p_lead_customer_link_id => %L, p_source => 'system',
        p_linked_by_actor_type => 'system', p_linked_by_user_id => null,
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_session, v_customer, v_opp, v_lcl,
           'runner:' || v_run::text || ':claims-array', v_run)
  );

  insert into pg_temp._p9_cscl_results values (
    29, 'claims JSON nao-objeto rejeitadas',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '42501'
              and v_exec.message_text = 'commercial session context link operation is not authorized'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'request.jwt.claims arrays or scalars are rejected instead of silently ignored'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (29, 'claims JSON nao-objeto rejeitadas', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_29$;

do $scenario_30$
declare
  v_org uuid; v_store uuid; v_old uuid; v_member uuid; v_run uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 30) then return; end if;
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_cscl_context;
  select value_uuid into v_old from pg_temp._p9_cscl_state where state_key = 'closed_link_id';

  if v_old is null then
    insert into pg_temp._p9_cscl_results values
      (30, 'substituir vinculo inactive invalido e rejeitado', 'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'scenario 23 did not produce an inactive context row', null, null, 'no replacement attempted');
    return;
  end if;

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'authenticated', v_member,
    format($sql$
      select (public.replace_commercial_session_context_link(
        p_old_link_id => %L, p_organization_id => %L, p_store_id => %L,
        p_new_customer_id => %L, p_new_commercial_opportunity_id => %L,
        p_new_lead_customer_link_id => %L, p_source => 'manual',
        p_actor_type => 'human', p_actor_user_id => %L,
        p_idempotency_key => %L, p_correlation_id => %L,
        p_unlink_reason_code => 'runner_invalid_replace'
      )).id::text
    $sql$, v_old, v_org, v_store,
           (select customer_id from pg_temp._p9_cscl_customers where fixture_number = 1),
           (select opportunity_id from pg_temp._p9_cscl_opportunities where fixture_number = 1),
           (select link_id from pg_temp._p9_cscl_lead_links where fixture_number = 1),
           v_member, 'runner:' || v_run::text || ':replace-inactive', v_run)
  );

  insert into pg_temp._p9_cscl_results values (
    30, 'substituir vinculo inactive invalido e rejeitado',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = 'P0001'
              and v_exec.message_text = 'only active commercial session context link can be replaced'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'inactive context without an existing replacement cannot be replaced again'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (30, 'substituir vinculo inactive invalido e rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_30$;

do $scenario_31$
declare
  v_org uuid; v_store uuid; v_old uuid; v_member uuid; v_run uuid; v_new_lcl uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 31) then return; end if;
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_cscl_context;
  select value_uuid into v_old from pg_temp._p9_cscl_state where state_key = 'replace_old_context_id';
  select link_id into v_new_lcl from pg_temp._p9_cscl_lead_links where fixture_number = 3;

  if v_old is null or v_new_lcl is null then
    insert into pg_temp._p9_cscl_results values
      (31, 'vinculo antigo nao pode ser substituido duas vezes', 'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'scenario 26 did not create replacement fixtures', null, null, 'no second replacement attempted');
    return;
  end if;

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'authenticated', v_member,
    format($sql$
      select (public.replace_commercial_session_context_link(
        p_old_link_id => %L, p_organization_id => %L, p_store_id => %L,
        p_new_customer_id => %L, p_new_commercial_opportunity_id => %L,
        p_new_lead_customer_link_id => %L, p_source => 'system',
        p_actor_type => 'human', p_actor_user_id => %L,
        p_idempotency_key => %L, p_correlation_id => %L,
        p_unlink_reason_code => 'runner_second_replace'
      )).id::text
    $sql$, v_old, v_org, v_store,
           (select customer_id from pg_temp._p9_cscl_customers where fixture_number = 3),
           (select opportunity_id from pg_temp._p9_cscl_opportunities where fixture_number = 3),
           v_new_lcl, v_member, 'runner:' || v_run::text || ':replace-context-second', v_run)
  );

  insert into pg_temp._p9_cscl_results values (
    31, 'vinculo antigo nao pode ser substituido duas vezes',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '23505'
              and v_exec.message_text = 'commercial session context link replacement conflict'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'same old context cannot be directly replaced twice with different payload'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (31, 'vinculo antigo nao pode ser substituido duas vezes', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_31$;

-- --------------------------------------------------------------------------
-- Cenarios 32 a 35: leitura e catalogo.
-- --------------------------------------------------------------------------

do $scenario_32$
declare
  v_member uuid; v_link uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 32) then return; end if;
  select member_user_id into v_member from pg_temp._p9_cscl_context;
  select value_uuid into v_link from pg_temp._p9_cscl_state where state_key = 'service_link_id';

  if v_link is null then
    insert into pg_temp._p9_cscl_results values
      (32, 'SELECT de membro autorizado', 'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'scenario 19 did not create the service_role active context row', null, null, 'no SELECT probe executed');
    return;
  end if;

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'authenticated', v_member,
    format('select count(*)::text from public.commercial_session_context_links where id = %L', v_link)
  );

  insert into pg_temp._p9_cscl_results values (
    32, 'SELECT de membro autorizado',
    case when v_exec.operation_succeeded and v_exec.value_text = '1'
         then 'PASS' else 'SUT_FAIL' end,
    'visible_rows=' || coalesce(v_exec.value_text, '<null>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'organization member sees the context row'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (32, 'SELECT de membro autorizado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_32$;

do $scenario_33$
declare
  v_external uuid; v_link uuid; v_exec record;
begin
  if exists (select 1 from pg_temp._p9_cscl_results where scenario_number = 33) then return; end if;
  select external_user_id into v_external from pg_temp._p9_cscl_context;
  select value_uuid into v_link from pg_temp._p9_cscl_state where state_key = 'service_link_id';

  if v_external is null or v_link is null then
    insert into pg_temp._p9_cscl_results values
      (33, 'SELECT de usuario sem membership bloqueado', 'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'external user or service context fixture is unavailable', null, null, 'no SELECT probe executed');
    return;
  end if;

  select * into v_exec from pg_temp._p9_cscl_exec_scalar(
    'authenticated', v_external,
    format('select count(*)::text from public.commercial_session_context_links where id = %L', v_link)
  );

  insert into pg_temp._p9_cscl_results values (
    33, 'SELECT de usuario sem membership bloqueado',
    case when v_exec.operation_succeeded and v_exec.value_text = '0'
         then 'PASS' else 'SUT_FAIL' end,
    'visible_rows=' || coalesce(v_exec.value_text, '<null>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'user without target-organization membership sees zero rows'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (33, 'SELECT de usuario sem membership bloqueado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_33$;

do $scenario_34$
declare
  v_ok boolean;
begin
  select
    (select count(*) = 1
     from pg_policies
     where schemaname = 'public'
       and tablename = 'commercial_session_context_links')
    and exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'commercial_session_context_links'
        and policyname = 'commercial_session_context_links_select_by_membership'
        and cmd = 'SELECT'
        and roles = array['authenticated']::name[]
    )
  into v_ok;

  insert into pg_temp._p9_cscl_results values (
    34, 'nenhuma policy de escrita',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    case when v_ok
      then 'only the authenticated SELECT policy exists'
      else 'unexpected write policy or missing SELECT policy detected'
    end,
    null, null,
    'no INSERT, UPDATE or DELETE policy is present'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (34, 'nenhuma policy de escrita', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_34$;

do $scenario_35$
declare
  v_ok boolean;
begin
  select
    not has_table_privilege('authenticated', 'public.commercial_session_context_links', 'INSERT')
    and not has_table_privilege('authenticated', 'public.commercial_session_context_links', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.commercial_session_context_links', 'DELETE')
    and has_table_privilege('authenticated', 'public.commercial_session_context_links', 'SELECT')
    and not has_table_privilege('service_role', 'public.commercial_session_context_links', 'INSERT')
    and not has_table_privilege('service_role', 'public.commercial_session_context_links', 'UPDATE')
    and not has_table_privilege('service_role', 'public.commercial_session_context_links', 'DELETE')
    and has_table_privilege('service_role', 'public.commercial_session_context_links', 'SELECT')
    and not has_table_privilege('anon', 'public.commercial_session_context_links', 'SELECT')
  into v_ok;

  insert into pg_temp._p9_cscl_results values (
    35, 'nenhuma permissao direta de escrita',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    case when v_ok
      then 'authenticated and service_role keep SELECT only; anon keeps no direct access'
      else 'unexpected table grant was detected'
    end,
    null, null,
    'table grants remain read-only for authenticated and service_role'
  );
exception
  when others then
    insert into pg_temp._p9_cscl_results values
      (35, 'nenhuma permissao direta de escrita', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_35$;

-- --------------------------------------------------------------------------
-- Cenario 36: cleanup total, restrito aos IDs da propria execucao.
-- --------------------------------------------------------------------------

do $scenario_36$
declare
  v_run uuid;
  v_context_links_after integer;
  v_owned_lcl_after integer;
  v_sessions_after integer;
  v_opps_after integer;
  v_customers_after integer;
  v_fingerprint_before text;
  v_fingerprint_after text;
  v_context_trigger_enabled boolean;
  v_lcl_trigger_enabled boolean;
begin
  begin execute 'reset role'; exception when others then null; end;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);

  if not pg_temp._p9_cscl_identity_is_clean() then
    update pg_temp._p9_cscl_context set cleanup_status = 'CLEANUP_FAIL';
    insert into pg_temp._p9_cscl_results values
      (36, 'zero residuos apos cleanup', 'CLEANUP_FAIL',
       'identity could not be restored before cleanup', null, null,
       'cleanup did not run under postgres');
    return;
  end if;

  select run_id, object_fingerprint into v_run, v_fingerprint_before
  from pg_temp._p9_cscl_context;

  begin
    execute 'set constraints all immediate';
    execute 'alter table public.commercial_session_context_links disable trigger commercial_session_context_links_enforce_write_rules';
    execute 'alter table public.lead_customer_links disable trigger lead_customer_links_enforce_write_rules';

    delete from public.commercial_session_context_links link_row
    where link_row.correlation_id = v_run;

    delete from public.lead_customer_links link_row
    using pg_temp._p9_cscl_owned_objects owned
    where owned.object_type = 'lead_customer_links'
      and link_row.id = owned.object_id;

    execute 'alter table public.lead_customer_links enable trigger lead_customer_links_enforce_write_rules';
    execute 'alter table public.commercial_session_context_links enable trigger commercial_session_context_links_enforce_write_rules';
  exception
    when others then
      begin
        execute 'alter table public.lead_customer_links enable trigger lead_customer_links_enforce_write_rules';
      exception when others then null;
      end;
      begin
        execute 'alter table public.commercial_session_context_links enable trigger commercial_session_context_links_enforce_write_rules';
      exception when others then null;
      end;
      raise;
  end;

  delete from public.conversation_sessions session_row
  using pg_temp._p9_cscl_owned_objects owned
  where owned.object_type = 'conversation_sessions'
    and session_row.id = owned.object_id;

  delete from public.commercial_opportunities opportunity_row
  using pg_temp._p9_cscl_owned_objects owned
  where owned.object_type = 'commercial_opportunities'
    and opportunity_row.id = owned.object_id;

  delete from public.customers customer_row
  using pg_temp._p9_cscl_owned_objects owned
  where owned.object_type = 'customers'
    and customer_row.id = owned.object_id;

  select count(*) into v_context_links_after
  from public.commercial_session_context_links
  where correlation_id = v_run;

  select count(*) into v_owned_lcl_after
  from public.lead_customer_links link_row
  join pg_temp._p9_cscl_owned_objects owned
    on owned.object_type = 'lead_customer_links'
   and owned.object_id = link_row.id;

  select count(*) into v_sessions_after
  from public.conversation_sessions session_row
  join pg_temp._p9_cscl_owned_objects owned
    on owned.object_type = 'conversation_sessions'
   and owned.object_id = session_row.id;

  select count(*) into v_opps_after
  from public.commercial_opportunities opportunity_row
  join pg_temp._p9_cscl_owned_objects owned
    on owned.object_type = 'commercial_opportunities'
   and owned.object_id = opportunity_row.id;

  select count(*) into v_customers_after
  from public.customers customer_row
  join pg_temp._p9_cscl_owned_objects owned
    on owned.object_type = 'customers'
   and owned.object_id = customer_row.id;

  select exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid =
          to_regclass('public.commercial_session_context_links')
      and trigger_row.tgname =
          'commercial_session_context_links_enforce_write_rules'
      and not trigger_row.tgisinternal
      and trigger_row.tgenabled = 'O'
  ) into v_context_trigger_enabled;

  select exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid = to_regclass('public.lead_customer_links')
      and trigger_row.tgname = 'lead_customer_links_enforce_write_rules'
      and not trigger_row.tgisinternal
      and trigger_row.tgenabled = 'O'
  ) into v_lcl_trigger_enabled;

  v_fingerprint_after := pg_temp._p9_cscl_object_fingerprint();

  update pg_temp._p9_cscl_context
  set cleanup_status = case
    when v_context_links_after = 0
     and v_owned_lcl_after = 0
     and v_sessions_after = 0
     and v_opps_after = 0
     and v_customers_after = 0
     and v_context_trigger_enabled
     and v_lcl_trigger_enabled
     and v_fingerprint_after is not distinct from v_fingerprint_before
    then 'PASS' else 'CLEANUP_FAIL' end;

  insert into pg_temp._p9_cscl_results values (
    36, 'zero residuos apos cleanup',
    case when v_context_links_after = 0
           and v_owned_lcl_after = 0
           and v_sessions_after = 0
           and v_opps_after = 0
           and v_customers_after = 0
           and v_context_trigger_enabled
           and v_lcl_trigger_enabled
           and v_fingerprint_after is not distinct from v_fingerprint_before
         then 'PASS' else 'CLEANUP_FAIL' end,
    format('context_links=%s | owned_inactive_lcl=%s | sessions=%s | opportunities=%s | customers=%s | context_trigger_enabled=%s | lcl_trigger_enabled=%s | fingerprint_unchanged=%s',
           v_context_links_after, v_owned_lcl_after, v_sessions_after,
           v_opps_after, v_customers_after,
           v_context_trigger_enabled, v_lcl_trigger_enabled,
           v_fingerprint_after is not distinct from v_fingerprint_before),
    null, null,
    'only runner-owned rows are absent, both named write-rule triggers are enabled and the SUT fingerprint is unchanged'
  );
exception
  when others then
    begin execute 'reset role'; exception when others then null; end;
    begin
      execute 'alter table public.lead_customer_links enable trigger lead_customer_links_enforce_write_rules';
    exception when others then null;
    end;
    begin
      execute 'alter table public.commercial_session_context_links enable trigger commercial_session_context_links_enforce_write_rules';
    exception when others then null;
    end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    update pg_temp._p9_cscl_context set cleanup_status = 'CLEANUP_FAIL';
    insert into pg_temp._p9_cscl_results values
      (36, 'zero residuos apos cleanup', 'CLEANUP_FAIL',
       'cleanup error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'cleanup exception was captured and named trigger restoration was attempted');
end;
$scenario_36$;

insert into pg_temp._p9_cscl_results (
  scenario_number, scenario_name, status, detail,
  returned_sqlstate, constraint_name, postcondition
)
select
  matrix.scenario_number,
  matrix.scenario_name,
  case when matrix.scenario_number = 36 then 'CLEANUP_FAIL' else 'HARNESS_ERROR' end,
  'runner did not emit a result for this scenario',
  null, null,
  'missing scenario result synthesized by final integrity check'
from pg_temp._p9_cscl_matrix matrix
where not exists (
  select 1
  from pg_temp._p9_cscl_results result
  where result.scenario_number = matrix.scenario_number
);

do $final_cleanup_safety$
declare
  v_cleanup text;
  v_run uuid;
  v_context_links integer;
  v_owned_rows integer;
  v_fingerprint_before text;
  v_fingerprint_after text;
  v_context_trigger_enabled boolean;
  v_lcl_trigger_enabled boolean;
begin
  select cleanup_status, run_id, object_fingerprint
  into v_cleanup, v_run, v_fingerprint_before
  from pg_temp._p9_cscl_context;

  select count(*) into v_context_links
  from public.commercial_session_context_links
  where correlation_id = v_run;

  select
    (select count(*) from public.lead_customer_links l
      join pg_temp._p9_cscl_owned_objects o on o.object_type='lead_customer_links' and o.object_id=l.id)
    + (select count(*) from public.conversation_sessions x
      join pg_temp._p9_cscl_owned_objects o on o.object_type='conversation_sessions' and o.object_id=x.id)
    + (select count(*) from public.commercial_opportunities x
      join pg_temp._p9_cscl_owned_objects o on o.object_type='commercial_opportunities' and o.object_id=x.id)
    + (select count(*) from public.customers x
      join pg_temp._p9_cscl_owned_objects o on o.object_type='customers' and o.object_id=x.id)
  into v_owned_rows;

  select exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid =
          to_regclass('public.commercial_session_context_links')
      and trigger_row.tgname =
          'commercial_session_context_links_enforce_write_rules'
      and not trigger_row.tgisinternal
      and trigger_row.tgenabled = 'O'
  ) into v_context_trigger_enabled;

  select exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid = to_regclass('public.lead_customer_links')
      and trigger_row.tgname = 'lead_customer_links_enforce_write_rules'
      and not trigger_row.tgisinternal
      and trigger_row.tgenabled = 'O'
  ) into v_lcl_trigger_enabled;

  v_fingerprint_after := pg_temp._p9_cscl_object_fingerprint();

  if v_cleanup <> 'PASS'
     or v_context_links <> 0
     or v_owned_rows <> 0
     or not v_context_trigger_enabled
     or not v_lcl_trigger_enabled
     or v_fingerprint_after is distinct from v_fingerprint_before then
    raise exception using
      errcode = 'P0001',
      message = format(
        'commercial_session_context_links runner cleanup safety gate failed; transaction rolled back (status=%s, context_links=%s, owned_rows=%s, context_trigger_enabled=%s, lcl_trigger_enabled=%s, fingerprint_unchanged=%s)',
        coalesce(v_cleanup, '<null>'), v_context_links, v_owned_rows,
        v_context_trigger_enabled, v_lcl_trigger_enabled,
        v_fingerprint_after is not distinct from v_fingerprint_before
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
    count(*) filter (where status = 'BLOCKED_BY_FIXTURE_PREREQUISITE') as total_blocked,
    count(*) filter (where status = 'CLEANUP_FAIL') as total_cleanup_fail,
    case
      when count(*) <> 36 then 'HARNESS_ERROR'
      when count(*) filter (where status = 'CLEANUP_FAIL') > 0 then 'CLEANUP_FAIL'
      when count(*) filter (where status = 'HARNESS_ERROR') > 0 then 'HARNESS_ERROR'
      when count(*) filter (where status = 'SUT_FAIL') > 0 then 'SUT_FAIL'
      when count(*) filter (where status = 'BLOCKED_BY_FIXTURE_PREREQUISITE') > 0
        then 'BLOCKED_BY_FIXTURE_PREREQUISITE'
      else 'APROVADA'
    end as final_status
  from pg_temp._p9_cscl_results
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
  from pg_temp._p9_cscl_results result
  join pg_temp._p9_cscl_matrix matrix
    on matrix.scenario_number = result.scenario_number

  union all

  select
    'SUMMARY', null, 'runner summary', '36-scenario approval contract',
    'postgres controller', 'classification with cleanup priority',
    summary.final_status,
    format('scenario_count=%s | pass=%s | sut_fail=%s | harness_error=%s | blocked=%s | cleanup_fail=%s | final_status=%s',
           summary.scenario_count, summary.total_pass, summary.total_sut_fail,
           summary.total_harness_error, summary.total_blocked,
           summary.total_cleanup_fail, summary.final_status),
    null, null, 'see cleanup_status and harness_preflight columns',
    summary.scenario_count, summary.total_pass, summary.total_sut_fail,
    summary.total_harness_error, summary.total_blocked,
    summary.total_cleanup_fail,
    context.cleanup_status, context.harness_preflight,
    context.inventory_text, context.object_fingerprint,
    summary.final_status
  from summary cross join pg_temp._p9_cscl_context context
)
select
  row_type, scenario_number, scenario_name, coverage_rule, test_role,
  expected_outcome, status, detail, returned_sqlstate, constraint_name,
  postcondition, scenario_count, total_pass, total_sut_fail,
  total_harness_error, total_blocked, total_cleanup_fail,
  cleanup_status, harness_preflight, fixture_inventory,
  object_fingerprint, final_status
from report
order by case when row_type = 'SCENARIO' then 0 else 1 end,
         scenario_number nulls last;

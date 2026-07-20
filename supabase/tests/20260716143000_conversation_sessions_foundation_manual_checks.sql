-- ZION / Pilar 9 / Fase 4 / 4.1B-2
-- Runner definitivo V7 de validacao real de public.conversation_sessions.
--
-- REGRAS DE SEGURANCA:
-- - execute o arquivo inteiro uma unica vez no SQL Editor do Supabase;
-- - nao cria, altera nem remove auth.users, organizations, stores, memberships,
--   leads, conversations ou qualquer outra fixture permanente;
-- - escreve somente em public.conversation_sessions e apenas com UUIDs gerados
--   e registrados pela propria execucao;
-- - cada cenario e independente e usa fixture propria quando disponivel;
-- - operacoes sob authenticated/service_role sao executadas por helpers de
--   pg_temp que capturam o resultado, restauram a identidade e so entao o
--   controlador postgres grava o relatorio;
-- - nenhum papel de teste recebe acesso as tabelas temporarias do relatorio;
-- - falha de cleanup tem prioridade maxima e reprova a execucao;
-- - exatamente 19 cenarios e uma linha SUMMARY sao emitidos no result set final.

begin;

set local lock_timeout = '3s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public, extensions;

-- --------------------------------------------------------------------------
-- Objetos temporarios da execucao.
-- --------------------------------------------------------------------------

drop table if exists pg_temp._p9_cs_results;
drop table if exists pg_temp._p9_cs_matrix;
drop table if exists pg_temp._p9_cs_context;
drop table if exists pg_temp._p9_cs_fixtures;
drop table if exists pg_temp._p9_cs_created_ids;

create temp table _p9_cs_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (
    status in (
      'PASS',
      'SUT_FAIL',
      'HARNESS_ERROR',
      'BLOCKED_BY_FIXTURE_PREREQUISITE',
      'CLEANUP_FAILURE'
    )
  ),
  detail text not null,
  returned_sqlstate text null,
  constraint_name text null,
  postcondition text not null
) on commit preserve rows;

create temp table _p9_cs_matrix (
  scenario_number integer primary key,
  scenario_name text not null,
  coverage_rule text not null,
  test_role text not null,
  expected_outcome text not null
) on commit preserve rows;

create temp table _p9_cs_context (
  singleton boolean primary key default true check (singleton),
  setup_status text not null default 'NOT_RUN',
  setup_detail text not null default '',
  harness_preflight text not null default 'NOT_RUN',
  harness_detail text not null default '',
  cleanup_status text not null default 'NOT_RUN',
  preferred_organization_id uuid null,
  member_user_id uuid null,
  mismatch_user_id uuid null,
  mismatch_current_org_id uuid null,
  external_user_id uuid null,
  safe_fixture_count integer not null default 0,
  safe_organization_count integer not null default 0,
  safe_store_count integer not null default 0,
  lead_without_store_count integer not null default 0,
  inventory_text text not null default '',
  object_fingerprint text not null default ''
) on commit preserve rows;

create temp table _p9_cs_fixtures (
  fixture_number integer primary key,
  organization_id uuid not null,
  store_id uuid not null,
  conversation_id uuid not null,
  unique (conversation_id)
) on commit preserve rows;

create temp table _p9_cs_created_ids (
  id uuid primary key,
  scenario_number integer not null,
  purpose text not null
) on commit preserve rows;

insert into _p9_cs_context default values;

insert into _p9_cs_matrix (
  scenario_number,
  scenario_name,
  coverage_rule,
  test_role,
  expected_outcome
) values
  (1,  'estrutura e hardening encontrados', 'schema, constraints, indexes, triggers, RLS, grants e funcoes endurecidas', 'postgres', 'estrutura completa e segura'),
  (2,  'authenticated multi-org cria sessao valida', 'membership valida funciona mesmo quando current_org_id aponta para outra organizacao', 'authenticated', 'INSERT e SELECT permitidos'),
  (3,  'status invalido rejeitado', 'status aceita somente active ou closed', 'service_role', 'CHECK 23514'),
  (4,  'active exige closed_at null', 'sessao active nao aceita closed_at preenchido', 'service_role', 'CHECK 23514'),
  (5,  'closed exige closed_at preenchido', 'sessao closed exige closed_at nao nulo', 'service_role', 'CHECK 23514'),
  (6,  'fechamento automatico preenche timestamps', 'active para closed preenche closed_at e avanca updated_at', 'service_role', 'UPDATE valido'),
  (7,  'closed_at nao pode ser falsificado', 'closed_at so muda junto da transicao de status', 'service_role', 'P0001 esperado'),
  (8,  'sessao fechada nao reabre', 'closed nunca retorna para active', 'service_role', 'P0001 esperado'),
  (9,  'organization_id imutavel por authenticated', 'authenticated nao troca a organizacao da sessao', 'authenticated', 'P0001 esperado'),
  (10, 'organization_id imutavel por service_role', 'service_role tambem respeita imutabilidade', 'service_role', 'P0001 esperado'),
  (11, 'apenas uma active por thread e loja', 'indice unico parcial bloqueia segunda active', 'service_role', '23505 esperado'),
  (12, 'nova active permitida apos fechamento', 'retomada cria nova sessao depois de fechar a anterior', 'service_role', 'fluxo valido'),
  (13, 'conversation e store incoerentes sao rejeitados', 'trigger valida conversation -> lead -> store', 'service_role', '23514 generico'),
  (14, 'usuario externo nao visualiza sessao', 'SELECT e isolado por membership da organizacao', 'authenticated', 'zero linhas'),
  (15, 'usuario externo nao insere nem recebe detalhes', 'barreira privilegiada autoriza antes da leitura relacional', 'authenticated', '42501 generico'),
  (16, 'authenticated nao executa delete', 'authenticated nao possui grant DELETE', 'authenticated', '42501 esperado'),
  (17, 'service_role possui DML completo', 'service_role executa INSERT SELECT UPDATE DELETE', 'service_role', 'DML completo'),
  (18, 'cleanup total dos registros do runner', 'nenhum UUID criado pelo runner permanece', 'postgres', 'zero residuos'),
  (19, 'lead sem loja e rejeitado', 'cadeia conversation -> lead -> store exige store', 'service_role', '23514 ou fixture bloqueada');

-- --------------------------------------------------------------------------
-- Helpers temporarios. Eles executam a operacao sob o papel testado, capturam
-- diagnosticos, restauram postgres e retornam o resultado ao controlador.
-- --------------------------------------------------------------------------

create or replace function pg_temp._p9_identity_is_clean()
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

revoke all on function pg_temp._p9_identity_is_clean() from public;

create or replace function pg_temp._p9_fixture_is_still_safe(
  p_fixture_number integer
)
returns boolean
language sql
stable
as $function$
  select exists (
    select 1
    from pg_temp._p9_cs_fixtures fixture
    join public.conversations c
      on c.id = fixture.conversation_id
     and c.organization_id = fixture.organization_id
    join public.leads l
      on l.id = c.lead_id
     and l.organization_id = c.organization_id
     and l.store_id = fixture.store_id
    join public.stores s
      on s.id = fixture.store_id
     and s.organization_id = fixture.organization_id
    where fixture.fixture_number = p_fixture_number
      and not exists (
        select 1
        from public.conversation_sessions existing_session
        where existing_session.organization_id = fixture.organization_id
          and existing_session.store_id = fixture.store_id
          and existing_session.conversation_id = fixture.conversation_id
          and existing_session.status = 'active'
      )
  )
$function$;

revoke all on function pg_temp._p9_fixture_is_still_safe(integer) from public;

create or replace function pg_temp._p9_exec_dml(
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
  table_name text,
  column_name text,
  identity_clean boolean,
  harness_error text
)
language plpgsql
as $function$
declare
  v_operation_succeeded boolean := false;
  v_affected_rows bigint := 0;
  v_returned_sqlstate text;
  v_message_text text;
  v_detail_text text;
  v_hint_text text;
  v_constraint_name text;
  v_table_name text;
  v_column_name text;
  v_identity_clean boolean := false;
  v_harness_error text;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    return query select
      false, 0::bigint, null::text, null::text, null::text, null::text,
      null::text, null::text, null::text, false,
      'helper caller is not postgres'::text;
    return;
  end if;

  if p_role not in ('authenticated', 'service_role') then
    return query select
      false, 0::bigint, null::text, null::text, null::text, null::text,
      null::text, null::text, null::text, true,
      'unsupported test role'::text;
    return;
  end if;

  if p_role = 'authenticated' and p_user_id is null then
    return query select
      false, 0::bigint, null::text, null::text, null::text, null::text,
      null::text, null::text, null::text, true,
      'authenticated execution requires a user id'::text;
    return;
  end if;

  perform set_config(
    'request.jwt.claim.sub',
    case when p_user_id is null then '' else p_user_id::text end,
    true
  );
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    case
      when p_user_id is null then
        pg_catalog.json_build_object('role', p_role)::text
      else
        pg_catalog.json_build_object(
          'sub', p_user_id::text,
          'role', p_role
        )::text
    end,
    true
  );

  execute pg_catalog.format('set local role %I', p_role);

  begin
    execute p_sql;
    get diagnostics v_affected_rows = row_count;
    v_operation_succeeded := true;
  exception
    when others then
      get stacked diagnostics
        v_returned_sqlstate = returned_sqlstate,
        v_message_text = message_text,
        v_detail_text = pg_exception_detail,
        v_hint_text = pg_exception_hint,
        v_constraint_name = constraint_name,
        v_table_name = table_name,
        v_column_name = column_name;
      v_operation_succeeded := false;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);

  v_identity_clean := pg_temp._p9_identity_is_clean();

  return query select
    v_operation_succeeded,
    v_affected_rows,
    v_returned_sqlstate,
    v_message_text,
    v_detail_text,
    v_hint_text,
    v_constraint_name,
    v_table_name,
    v_column_name,
    v_identity_clean,
    v_harness_error;
exception
  when others then
    begin
      execute 'reset role';
    exception
      when others then
        null;
    end;

    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);

    return query select
      false,
      0::bigint,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      pg_temp._p9_identity_is_clean(),
      ('helper internal error: ' || sqlstate || ': ' || sqlerrm)::text;
end;
$function$;

revoke all on function pg_temp._p9_exec_dml(text, uuid, text) from public;

create or replace function pg_temp._p9_exec_scalar(
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
  table_name text,
  column_name text,
  identity_clean boolean,
  harness_error text
)
language plpgsql
as $function$
declare
  v_operation_succeeded boolean := false;
  v_value_text text;
  v_returned_sqlstate text;
  v_message_text text;
  v_detail_text text;
  v_hint_text text;
  v_constraint_name text;
  v_table_name text;
  v_column_name text;
  v_identity_clean boolean := false;
  v_harness_error text;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    return query select
      false, null::text, null::text, null::text, null::text, null::text,
      null::text, null::text, null::text, false,
      'helper caller is not postgres'::text;
    return;
  end if;

  if p_role not in ('authenticated', 'service_role') then
    return query select
      false, null::text, null::text, null::text, null::text, null::text,
      null::text, null::text, null::text, true,
      'unsupported test role'::text;
    return;
  end if;

  if p_role = 'authenticated' and p_user_id is null then
    return query select
      false, null::text, null::text, null::text, null::text, null::text,
      null::text, null::text, null::text, true,
      'authenticated execution requires a user id'::text;
    return;
  end if;

  perform set_config(
    'request.jwt.claim.sub',
    case when p_user_id is null then '' else p_user_id::text end,
    true
  );
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    case
      when p_user_id is null then
        pg_catalog.json_build_object('role', p_role)::text
      else
        pg_catalog.json_build_object(
          'sub', p_user_id::text,
          'role', p_role
        )::text
    end,
    true
  );

  execute pg_catalog.format('set local role %I', p_role);

  begin
    execute p_sql into v_value_text;
    v_operation_succeeded := true;
  exception
    when others then
      get stacked diagnostics
        v_returned_sqlstate = returned_sqlstate,
        v_message_text = message_text,
        v_detail_text = pg_exception_detail,
        v_hint_text = pg_exception_hint,
        v_constraint_name = constraint_name,
        v_table_name = table_name,
        v_column_name = column_name;
      v_operation_succeeded := false;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);

  v_identity_clean := pg_temp._p9_identity_is_clean();

  return query select
    v_operation_succeeded,
    v_value_text,
    v_returned_sqlstate,
    v_message_text,
    v_detail_text,
    v_hint_text,
    v_constraint_name,
    v_table_name,
    v_column_name,
    v_identity_clean,
    v_harness_error;
exception
  when others then
    begin
      execute 'reset role';
    exception
      when others then
        null;
    end;

    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);

    return query select
      false,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      pg_temp._p9_identity_is_clean(),
      ('helper internal error: ' || sqlstate || ': ' || sqlerrm)::text;
end;
$function$;

revoke all on function pg_temp._p9_exec_scalar(text, uuid, text) from public;

-- --------------------------------------------------------------------------
-- Setup, inventario, fixtures e fingerprint.
-- --------------------------------------------------------------------------

do $setup$
declare
  v_lock_acquired boolean := false;
  v_preferred_org uuid;
  v_member_user uuid;
  v_mismatch_user uuid;
  v_mismatch_current_org uuid;
  v_external_user uuid;
  v_safe_fixture_count integer := 0;
  v_safe_org_count integer := 0;
  v_safe_store_count integer := 0;
  v_no_store_count integer := 0;
  v_candidate record;
  v_exec record;
  v_fingerprint text;
  v_inventory text;
begin
  select pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'zion:p9:conversation_sessions:runner',
      0
    )
  ) into v_lock_acquired;

  if not v_lock_acquired then
    update pg_temp._p9_cs_context
    set
      setup_status = 'HARNESS_ERROR',
      setup_detail = 'another conversation_sessions runner holds the advisory lock';
    return;
  end if;

  if current_user <> 'postgres' or session_user <> 'postgres' then
    update pg_temp._p9_cs_context
    set
      setup_status = 'HARNESS_ERROR',
      setup_detail = 'runner must start as postgres';
    return;
  end if;

  with safe_conversations as (
    select
      c.organization_id,
      l.store_id,
      c.id as conversation_id
    from public.conversations c
    join public.leads l
      on l.id = c.lead_id
     and l.organization_id = c.organization_id
    join public.stores s
      on s.id = l.store_id
     and s.organization_id = l.organization_id
    where c.organization_id is not null
      and l.store_id is not null
      and not exists (
        select 1
        from public.conversation_sessions existing_session
        where existing_session.organization_id = c.organization_id
          and existing_session.store_id = l.store_id
          and existing_session.conversation_id = c.id
          and existing_session.status = 'active'
      )
  )
  select
    count(*),
    count(distinct organization_id),
    count(distinct store_id)
  into
    v_safe_fixture_count,
    v_safe_org_count,
    v_safe_store_count
  from safe_conversations;

  with safe_by_org as (
    select
      c.organization_id,
      count(*) as safe_count
    from public.conversations c
    join public.leads l
      on l.id = c.lead_id
     and l.organization_id = c.organization_id
    join public.stores s
      on s.id = l.store_id
     and s.organization_id = l.organization_id
    where c.organization_id is not null
      and l.store_id is not null
      and not exists (
        select 1
        from public.conversation_sessions existing_session
        where existing_session.organization_id = c.organization_id
          and existing_session.store_id = l.store_id
          and existing_session.conversation_id = c.id
          and existing_session.status = 'active'
      )
    group by c.organization_id
  )
  select organization_id
  into v_preferred_org
  from safe_by_org
  order by safe_count desc, organization_id
  limit 1;

  if v_preferred_org is not null then
    insert into pg_temp._p9_cs_fixtures (
      fixture_number,
      organization_id,
      store_id,
      conversation_id
    )
    select
      row_number() over (
        order by l.store_id, c.id
      )::integer,
      c.organization_id,
      l.store_id,
      c.id
    from public.conversations c
    join public.leads l
      on l.id = c.lead_id
     and l.organization_id = c.organization_id
    join public.stores s
      on s.id = l.store_id
     and s.organization_id = l.organization_id
    where c.organization_id = v_preferred_org
      and l.store_id is not null
      and not exists (
        select 1
        from public.conversation_sessions existing_session
        where existing_session.organization_id = c.organization_id
          and existing_session.store_id = l.store_id
          and existing_session.conversation_id = c.id
          and existing_session.status = 'active'
      )
    order by l.store_id, c.id
    limit 16;

    select m.user_id
    into v_member_user
    from public.memberships m
    where m.organization_id = v_preferred_org
      and m.user_id is not null
    order by m.created_at, m.user_id
    limit 1;

    for v_candidate in
      select distinct
        m.user_id,
        min(m.created_at) as first_membership_at
      from public.memberships m
      where m.organization_id = v_preferred_org
        and m.user_id is not null
      group by m.user_id
      order by first_membership_at, m.user_id
    loop
      select *
      into v_exec
      from pg_temp._p9_exec_scalar(
        'authenticated',
        v_candidate.user_id,
        'select public.current_org_id()::text'
      );

      if v_exec.harness_error is not null
         or not v_exec.identity_clean then
        update pg_temp._p9_cs_context
        set
          setup_status = 'HARNESS_ERROR',
          setup_detail = coalesce(
            v_exec.harness_error,
            'identity was not restored while selecting mismatch fixture'
          );
        return;
      end if;

      if v_exec.operation_succeeded
         and v_exec.value_text is not null
         and v_exec.value_text::uuid is distinct from v_preferred_org then
        v_mismatch_user := v_candidate.user_id;
        v_mismatch_current_org := v_exec.value_text::uuid;
        exit;
      end if;
    end loop;

    select other_membership.user_id
    into v_external_user
    from public.memberships other_membership
    where other_membership.user_id is not null
      and not exists (
        select 1
        from public.memberships preferred_membership
        where preferred_membership.organization_id = v_preferred_org
          and preferred_membership.user_id = other_membership.user_id
      )
    order by other_membership.created_at, other_membership.user_id
    limit 1;
  end if;

  select count(*)
  into v_no_store_count
  from public.conversations c
  join public.leads l
    on l.id = c.lead_id
   and l.organization_id = c.organization_id
  where l.store_id is null;

  with fingerprint_parts as (
    select
      'function'::text as object_type,
      n.nspname || '.' || p.proname as object_name,
      pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'conversation_session_apply_write_rules',
        'prevent_conversation_session_organization_change'
      )

    union all

    select
      'policy',
      schemaname || '.' || tablename || '.' || policyname,
      coalesce(qual, '') || '|' || coalesce(with_check, '') || '|' || cmd || '|' || roles::text
    from pg_policies
    where schemaname = 'public'
      and tablename = 'conversation_sessions'

    union all

    select
      'index',
      schemaname || '.' || tablename || '.' || indexname,
      indexdef
    from pg_indexes
    where schemaname = 'public'
      and tablename in ('conversation_sessions', 'conversations')
      and indexname in (
        'conversations_id_organization_uidx',
        'conversation_sessions_one_active_per_thread_uidx'
      )

    union all

    select
      'constraint',
      n.nspname || '.' || c.relname || '.' || con.conname,
      pg_get_constraintdef(con.oid, true)
    from pg_constraint con
    join pg_class c
      on c.oid = con.conrelid
    join pg_namespace n
      on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'conversation_sessions'

    union all

    select
      'trigger',
      n.nspname || '.' || c.relname || '.' || t.tgname,
      pg_get_triggerdef(t.oid, true)
    from pg_trigger t
    join pg_class c
      on c.oid = t.tgrelid
    join pg_namespace n
      on n.oid = c.relnamespace
    where not t.tgisinternal
      and n.nspname = 'public'
      and c.relname = 'conversation_sessions'
  )
  select md5(
    string_agg(
      object_type || ':' || object_name || ':' || definition,
      E'\n'
      order by object_type, object_name
    )
  )
  into v_fingerprint
  from fingerprint_parts;

  v_inventory := pg_catalog.format(
    'safe_conversations=%s | safe_organizations=%s | safe_stores=%s | selected_fixtures=%s | member_user=%s | mismatch_user=%s | external_user=%s | lead_without_store=%s',
    v_safe_fixture_count,
    v_safe_org_count,
    v_safe_store_count,
    (select count(*) from pg_temp._p9_cs_fixtures),
    case when v_member_user is null then 'missing' else 'present' end,
    case when v_mismatch_user is null then 'missing' else 'present' end,
    case when v_external_user is null then 'missing' else 'present' end,
    v_no_store_count
  );

  update pg_temp._p9_cs_context
  set
    setup_status = 'PASS',
    setup_detail = 'fixture inventory and object fingerprint completed',
    preferred_organization_id = v_preferred_org,
    member_user_id = v_member_user,
    mismatch_user_id = v_mismatch_user,
    mismatch_current_org_id = v_mismatch_current_org,
    external_user_id = v_external_user,
    safe_fixture_count = v_safe_fixture_count,
    safe_organization_count = v_safe_org_count,
    safe_store_count = v_safe_store_count,
    lead_without_store_count = v_no_store_count,
    inventory_text = v_inventory,
    object_fingerprint = coalesce(v_fingerprint, '<missing>');
exception
  when others then
    begin
      execute 'reset role';
    exception
      when others then null;
    end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);

    update pg_temp._p9_cs_context
    set
      setup_status = 'HARNESS_ERROR',
      setup_detail = 'setup failed with ' || sqlstate || ': ' || sqlerrm;
end;
$setup$;

-- --------------------------------------------------------------------------
-- Preflight do proprio harness.
-- --------------------------------------------------------------------------

do $preflight$
declare
  v_exec record;
  v_probe_user uuid := gen_random_uuid();
  v_setup_status text;
begin
  select setup_status
  into v_setup_status
  from pg_temp._p9_cs_context;

  if v_setup_status <> 'PASS' then
    update pg_temp._p9_cs_context
    set
      harness_preflight = 'HARNESS_ERROR',
      harness_detail = 'setup did not pass: ' || setup_detail;
    return;
  end if;

  select *
  into v_exec
  from pg_temp._p9_exec_scalar(
    'authenticated',
    v_probe_user,
    'select (1 / 0)::text'
  );

  if v_exec.harness_error is not null
     or not v_exec.identity_clean
     or v_exec.operation_succeeded
     or v_exec.returned_sqlstate <> '22012' then
    update pg_temp._p9_cs_context
    set
      harness_preflight = 'HARNESS_ERROR',
      harness_detail = pg_catalog.format(
        'authenticated error-capture probe failed | succeeded=%s | sqlstate=%s | identity_clean=%s | helper=%s',
        v_exec.operation_succeeded,
        v_exec.returned_sqlstate,
        v_exec.identity_clean,
        coalesce(v_exec.harness_error, '<none>')
      );
    return;
  end if;

  if exists (
       select 1
       from pg_trigger t
       where t.tgrelid = 'public.conversation_sessions'::regclass
         and not t.tgisinternal
         and (t.tgtype & 1) = 0
     )
     or exists (
       select 1
       from pg_rewrite r
       where r.ev_class = 'public.conversation_sessions'::regclass
         and r.rulename <> '_RETURN'
     ) then
    update pg_temp._p9_cs_context
    set
      harness_preflight = 'HARNESS_ERROR',
      harness_detail = 'zero-row DML probe is unsafe because a statement trigger or rewrite rule exists';
    return;
  end if;

  select *
  into v_exec
  from pg_temp._p9_exec_dml(
    'service_role',
    null,
    'update public.conversation_sessions set updated_at = updated_at where false'
  );

  if v_exec.harness_error is not null
     or not v_exec.identity_clean
     or not v_exec.operation_succeeded
     or v_exec.affected_rows <> 0 then
    update pg_temp._p9_cs_context
    set
      harness_preflight = 'HARNESS_ERROR',
      harness_detail = pg_catalog.format(
        'service_role zero-row DML probe failed | succeeded=%s | rows=%s | sqlstate=%s | identity_clean=%s | helper=%s',
        v_exec.operation_succeeded,
        v_exec.affected_rows,
        v_exec.returned_sqlstate,
        v_exec.identity_clean,
        coalesce(v_exec.harness_error, '<none>')
      );
    return;
  end if;

  update pg_temp._p9_cs_context
  set
    harness_preflight = 'PASS',
    harness_detail = 'role switch, expected-error capture, role restoration and controller continuation passed';
exception
  when others then
    begin execute 'reset role'; exception when others then null; end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);

    update pg_temp._p9_cs_context
    set
      harness_preflight = 'HARNESS_ERROR',
      harness_detail = 'preflight failed with ' || sqlstate || ': ' || sqlerrm;
end;
$preflight$;

-- --------------------------------------------------------------------------
-- Cenario 1: estrutura e hardening.
-- --------------------------------------------------------------------------

do $scenario_1$
declare
  v_ok boolean := false;
  v_preflight text;
  v_detail text;
begin
  select harness_preflight
  into v_preflight
  from pg_temp._p9_cs_context;

  if v_preflight <> 'PASS' then
    insert into pg_temp._p9_cs_results values (
      1,
      'estrutura e hardening encontrados',
      'HARNESS_ERROR',
      'harness preflight did not pass',
      null,
      null,
      'scenario not executed'
    );
    return;
  end if;

  select
    -- Tabela e RLS.
    to_regclass('public.conversation_sessions') is not null
    and exists (
      select 1
      from pg_class c
      join pg_namespace n
        on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'conversation_sessions'
        and c.relkind in ('r', 'p')
        and c.relrowsecurity
        and not c.relforcerowsecurity
    )

    -- Exatamente nove colunas, na ordem e com os contratos essenciais.
    and (
      select count(*) = 9
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'conversation_sessions'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'conversation_sessions'
        and column_name = 'id' and ordinal_position = 1
        and data_type = 'uuid' and is_nullable = 'NO'
        and column_default ilike '%gen_random_uuid()%'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'conversation_sessions'
        and column_name = 'organization_id' and ordinal_position = 2
        and data_type = 'uuid' and is_nullable = 'NO'
        and column_default is null
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'conversation_sessions'
        and column_name = 'store_id' and ordinal_position = 3
        and data_type = 'uuid' and is_nullable = 'NO'
        and column_default is null
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'conversation_sessions'
        and column_name = 'conversation_id' and ordinal_position = 4
        and data_type = 'uuid' and is_nullable = 'NO'
        and column_default is null
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'conversation_sessions'
        and column_name = 'status' and ordinal_position = 5
        and data_type = 'text' and is_nullable = 'NO'
        and column_default = '''active''::text'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'conversation_sessions'
        and column_name = 'started_at' and ordinal_position = 6
        and data_type = 'timestamp with time zone' and is_nullable = 'NO'
        and column_default = 'now()'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'conversation_sessions'
        and column_name = 'closed_at' and ordinal_position = 7
        and data_type = 'timestamp with time zone' and is_nullable = 'YES'
        and column_default is null
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'conversation_sessions'
        and column_name = 'created_at' and ordinal_position = 8
        and data_type = 'timestamp with time zone' and is_nullable = 'NO'
        and column_default = 'now()'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'conversation_sessions'
        and column_name = 'updated_at' and ordinal_position = 9
        and data_type = 'timestamp with time zone' and is_nullable = 'NO'
        and column_default = 'now()'
    )

    -- Exatamente as seis constraints aprovadas.
    and (
      select count(*) = 6
      from pg_constraint con
      where con.conrelid = 'public.conversation_sessions'::regclass
    )
    and (
      select count(*) = 6
      from pg_constraint con
      where con.conrelid = 'public.conversation_sessions'::regclass
        and con.conname in (
          'conversation_sessions_pkey',
          'conversation_sessions_organization_fkey',
          'conversation_sessions_store_org_fkey',
          'conversation_sessions_conversation_org_fkey',
          'conversation_sessions_status_check',
          'conversation_sessions_status_closed_at_check'
        )
    )
    and exists (
      select 1 from pg_constraint con
      where con.conrelid = 'public.conversation_sessions'::regclass
        and con.conname = 'conversation_sessions_pkey'
        and con.contype = 'p'
        and pg_get_constraintdef(con.oid, true) = 'PRIMARY KEY (id)'
    )
    and exists (
      select 1 from pg_constraint con
      where con.conrelid = 'public.conversation_sessions'::regclass
        and con.conname = 'conversation_sessions_organization_fkey'
        and con.contype = 'f'
        and lower(pg_get_constraintdef(con.oid, true))
          like '%foreign key (organization_id)%references organizations(id)%on delete cascade%'
    )
    and exists (
      select 1 from pg_constraint con
      where con.conrelid = 'public.conversation_sessions'::regclass
        and con.conname = 'conversation_sessions_store_org_fkey'
        and con.contype = 'f'
        and lower(pg_get_constraintdef(con.oid, true))
          like '%foreign key (store_id, organization_id)%references stores(id, organization_id)%on delete restrict%'
    )
    and exists (
      select 1 from pg_constraint con
      where con.conrelid = 'public.conversation_sessions'::regclass
        and con.conname = 'conversation_sessions_conversation_org_fkey'
        and con.contype = 'f'
        and lower(pg_get_constraintdef(con.oid, true))
          like '%foreign key (conversation_id, organization_id)%references conversations(id, organization_id)%on delete restrict%'
    )
    and exists (
      select 1 from pg_constraint con
      where con.conrelid = 'public.conversation_sessions'::regclass
        and con.conname = 'conversation_sessions_status_check'
        and con.contype = 'c'
        and lower(pg_get_constraintdef(con.oid, true)) like '%status%active%closed%'
    )
    and exists (
      select 1 from pg_constraint con
      where con.conrelid = 'public.conversation_sessions'::regclass
        and con.conname = 'conversation_sessions_status_closed_at_check'
        and con.contype = 'c'
        and regexp_replace(
          lower(pg_get_constraintdef(con.oid, true)),
          '[[:space:]()]',
          '',
          'g'
        ) like '%status=''active''::textandclosed_atisnull%'
        and regexp_replace(
          lower(pg_get_constraintdef(con.oid, true)),
          '[[:space:]()]',
          '',
          'g'
        ) like '%status=''closed''::textandclosed_atisnotnull%'
    )

    -- Índices aprovados e suporte composto em conversations.
    and (
      select count(*) = 6
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'conversation_sessions'
    )
    and (
      select count(*) = 6
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'conversation_sessions'
        and indexname in (
          'conversation_sessions_pkey',
          'conversation_sessions_id_organization_uidx',
          'conversation_sessions_id_org_store_uidx',
          'conversation_sessions_one_active_per_thread_uidx',
          'conversation_sessions_org_conversation_started_idx',
          'conversation_sessions_org_store_status_updated_idx'
        )
    )
    and exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'conversations'
        and indexname = 'conversations_id_organization_uidx'
        and indexdef ilike '%unique%'
        and indexdef ilike '%(id, organization_id)%'
    )
    and exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'conversation_sessions'
        and indexname = 'conversation_sessions_one_active_per_thread_uidx'
        and indexdef ilike '%unique%'
        and indexdef ilike '%(organization_id, store_id, conversation_id)%'
        and indexdef ilike '%where%status%active%'
    )

    -- Exatamente três policies, todas limitadas a authenticated e sem
    -- dependência de conversations/current_org_id no caminho de escrita.
    and (
      select count(*) = 3
      from pg_policies
      where schemaname = 'public'
        and tablename = 'conversation_sessions'
    )
    and exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = 'conversation_sessions'
        and p.policyname = 'conversation_sessions_select_by_membership'
        and p.cmd = 'SELECT'
        and p.roles = array['authenticated']::name[]
        and position('memberships' in lower(p.qual)) > 0
        and position('auth.uid()' in lower(p.qual)) > 0
    )
    and exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = 'conversation_sessions'
        and p.policyname = 'conversation_sessions_insert_by_membership'
        and p.cmd = 'INSERT'
        and p.roles = array['authenticated']::name[]
        and position('memberships' in lower(p.with_check)) > 0
        and position('auth.uid()' in lower(p.with_check)) > 0
        and position('conversations' in lower(p.with_check)) = 0
        and position('leads' in lower(p.with_check)) = 0
        and position('stores' in lower(p.with_check)) = 0
        and position('current_org_id' in lower(p.with_check)) = 0
    )
    and exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = 'conversation_sessions'
        and p.policyname = 'conversation_sessions_update_by_membership'
        and p.cmd = 'UPDATE'
        and p.roles = array['authenticated']::name[]
        and position('memberships' in lower(p.qual)) > 0
        and position('memberships' in lower(p.with_check)) > 0
        and position('conversations' in lower(p.qual || p.with_check)) = 0
        and position('leads' in lower(p.qual || p.with_check)) = 0
        and position('stores' in lower(p.qual || p.with_check)) = 0
        and position('current_org_id' in lower(p.qual || p.with_check)) = 0
    )

    -- Grants por papel.
    and has_table_privilege('authenticated', 'public.conversation_sessions', 'SELECT')
    and has_table_privilege('authenticated', 'public.conversation_sessions', 'INSERT')
    and has_table_privilege('authenticated', 'public.conversation_sessions', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.conversation_sessions', 'DELETE')
    and not has_table_privilege('anon', 'public.conversation_sessions', 'SELECT')
    and not has_table_privilege('anon', 'public.conversation_sessions', 'INSERT')
    and not has_table_privilege('anon', 'public.conversation_sessions', 'UPDATE')
    and not has_table_privilege('anon', 'public.conversation_sessions', 'DELETE')
    and has_table_privilege('service_role', 'public.conversation_sessions', 'SELECT')
    and has_table_privilege('service_role', 'public.conversation_sessions', 'INSERT')
    and has_table_privilege('service_role', 'public.conversation_sessions', 'UPDATE')
    and has_table_privilege('service_role', 'public.conversation_sessions', 'DELETE')

    -- Função privilegiada: owner controlado, BYPASSRLS, configuração segura,
    -- autorização antes da leitura relacional e EXECUTE direto revogado.
    and exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner
      where n.nspname = 'public'
        and p.proname = 'conversation_session_apply_write_rules'
        and pg_get_function_identity_arguments(p.oid) = ''
        and p.prosecdef
        and r.rolname = 'postgres'
        and r.rolbypassrls
        and p.proconfig @> array[
          'search_path=pg_catalog, pg_temp',
          'row_security=off'
        ]::text[]
        and position(
          'from public.memberships'
          in lower(pg_get_functiondef(p.oid))
        ) > 0
        and position(
          'from public.conversations'
          in lower(pg_get_functiondef(p.oid))
        ) > position(
          'from public.memberships'
          in lower(pg_get_functiondef(p.oid))
        )
        and position(
          'conversation session write is not authorized'
          in lower(pg_get_functiondef(p.oid))
        ) > 0
        and position(
          'conversation session relation mismatch'
          in lower(pg_get_functiondef(p.oid))
        ) > 0
        and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and not has_function_privilege('anon', p.oid, 'EXECUTE')
        and not has_function_privilege('service_role', p.oid, 'EXECUTE')
    )
    and exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner
      where n.nspname = 'public'
        and p.proname = 'prevent_conversation_session_organization_change'
        and pg_get_function_identity_arguments(p.oid) = ''
        and not p.prosecdef
        and r.rolname = 'postgres'
        and p.proconfig = array['search_path=pg_catalog, pg_temp']::text[]
        and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and not has_function_privilege('anon', p.oid, 'EXECUTE')
        and not has_function_privilege('service_role', p.oid, 'EXECUTE')
    )

    -- Exatamente dois triggers de usuário, ativos e ligados às funções certas.
    and (
      select count(*) = 2
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal
        and n.nspname = 'public'
        and c.relname = 'conversation_sessions'
    )
    and exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      join pg_namespace pn on pn.oid = p.pronamespace
      where not t.tgisinternal
        and n.nspname = 'public'
        and c.relname = 'conversation_sessions'
        and t.tgname = 'conversation_sessions_apply_write_rules'
        and t.tgenabled = 'O'
        and pn.nspname = 'public'
        and p.proname = 'conversation_session_apply_write_rules'
    )
    and exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      join pg_namespace pn on pn.oid = p.pronamespace
      where not t.tgisinternal
        and n.nspname = 'public'
        and c.relname = 'conversation_sessions'
        and t.tgname = 'conversation_sessions_prevent_organization_change'
        and t.tgenabled = 'O'
        and pn.nspname = 'public'
        and p.proname = 'prevent_conversation_session_organization_change'
    )
  into v_ok;

  v_detail := case
    when v_ok then
      'table, columns, constraints, indexes, RLS, policies, grants, hardened functions and trigger bindings match the approved contract'
    else
      'one or more structural or security postconditions differ from the approved contract'
  end;

  insert into pg_temp._p9_cs_results values (
    1,
    'estrutura e hardening encontrados',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    v_detail,
    null,
    null,
    'complete structural contract evaluated as one deterministic predicate'
  );
exception
  when others then
    insert into pg_temp._p9_cs_results values (
      1,
      'estrutura e hardening encontrados',
      'HARNESS_ERROR',
      'scenario error: ' || sqlstate || ': ' || sqlerrm,
      sqlstate,
      null,
      'scenario rolled back'
    );
end;
$scenario_1$;

-- --------------------------------------------------------------------------
-- Cenario 2: authenticated multi-org cria sessao valida.
-- --------------------------------------------------------------------------

do $scenario_2$
declare
  v_fixture pg_temp._p9_cs_fixtures%rowtype;
  v_user uuid;
  v_current_org uuid;
  v_id uuid := gen_random_uuid();
  v_exec record;
  v_visible record;
  v_current_org_recheck record;
  v_count integer;
begin
  if (select harness_preflight from pg_temp._p9_cs_context) <> 'PASS' then
    insert into pg_temp._p9_cs_results values (2, 'authenticated multi-org cria sessao valida', 'HARNESS_ERROR', 'harness preflight did not pass', null, null, 'scenario not executed');
    return;
  end if;

  select * into v_fixture from pg_temp._p9_cs_fixtures where fixture_number = 1;
  select mismatch_user_id, mismatch_current_org_id into v_user, v_current_org from pg_temp._p9_cs_context;

  if v_fixture.conversation_id is null or v_user is null or v_current_org is null then
    insert into pg_temp._p9_cs_results values (
      2,
      'authenticated multi-org cria sessao valida',
      'BLOCKED_BY_FIXTURE_PREREQUISITE',
      'missing safe fixture or authenticated user whose current_org_id differs from the fixture organization',
      null,
      null,
      'fixture evidence recorded in SUMMARY inventory'
    );
    return;
  end if;

  if v_current_org = v_fixture.organization_id then
    insert into pg_temp._p9_cs_results values (2, 'authenticated multi-org cria sessao valida', 'HARNESS_ERROR', 'selected regression user does not have a divergent current_org_id', null, null, 'scenario not executed');
    return;
  end if;

  select *
  into v_current_org_recheck
  from pg_temp._p9_exec_scalar(
    'authenticated',
    v_user,
    'select public.current_org_id()::text'
  );

  if v_current_org_recheck.harness_error is not null
     or not v_current_org_recheck.identity_clean then
    insert into pg_temp._p9_cs_results values (2, 'authenticated multi-org cria sessao valida', 'HARNESS_ERROR', coalesce(v_current_org_recheck.harness_error, 'identity was not restored during current_org_id recheck'), v_current_org_recheck.returned_sqlstate, v_current_org_recheck.constraint_name, 'runner identity check failed');
    return;
  end if;

  if not v_current_org_recheck.operation_succeeded
     or v_current_org_recheck.value_text is null
     or v_current_org_recheck.value_text::uuid is distinct from v_current_org
     or v_current_org_recheck.value_text::uuid = v_fixture.organization_id then
    insert into pg_temp._p9_cs_results values (2, 'authenticated multi-org cria sessao valida', 'HARNESS_ERROR', 'multi-organization regression fixture changed after setup', v_current_org_recheck.returned_sqlstate, v_current_org_recheck.constraint_name, 'current_org_id must remain divergent immediately before INSERT');
    return;
  end if;

  if not pg_temp._p9_fixture_is_still_safe(1) then
    insert into pg_temp._p9_cs_results values (2, (select scenario_name from pg_temp._p9_cs_matrix where scenario_number = 2), 'HARNESS_ERROR', 'selected fixture changed after setup or acquired an active session', null, null, 'fixture was revalidated immediately before the first write');
    return;
  end if;

  insert into pg_temp._p9_cs_created_ids values (v_id, 2, 'valid authenticated closed session');

  select * into v_exec
  from pg_temp._p9_exec_dml(
    'authenticated',
    v_user,
    pg_catalog.format(
      'insert into public.conversation_sessions (id, organization_id, store_id, conversation_id, status, closed_at) values (%L, %L, %L, %L, ''closed'', pg_catalog.clock_timestamp())',
      v_id,
      v_fixture.organization_id,
      v_fixture.store_id,
      v_fixture.conversation_id
    )
  );

  if v_exec.harness_error is not null or not v_exec.identity_clean then
    insert into pg_temp._p9_cs_results values (2, 'authenticated multi-org cria sessao valida', 'HARNESS_ERROR', coalesce(v_exec.harness_error, 'identity was not restored'), v_exec.returned_sqlstate, v_exec.constraint_name, 'runner identity check failed');
    return;
  end if;

  if not v_exec.operation_succeeded or v_exec.affected_rows <> 1 then
    insert into pg_temp._p9_cs_results values (2, 'authenticated multi-org cria sessao valida', 'SUT_FAIL', 'valid authenticated insert failed: ' || coalesce(v_exec.message_text, '<no message>'), v_exec.returned_sqlstate, v_exec.constraint_name, 'expected exactly one inserted row');
    return;
  end if;

  select count(*) into v_count
  from public.conversation_sessions
  where id = v_id
    and organization_id = v_fixture.organization_id
    and store_id = v_fixture.store_id
    and conversation_id = v_fixture.conversation_id
    and status = 'closed'
    and closed_at is not null;

  select * into v_visible
  from pg_temp._p9_exec_scalar(
    'authenticated',
    v_user,
    pg_catalog.format(
      'select count(*)::text from public.conversation_sessions where id = %L',
      v_id
    )
  );

  if v_visible.harness_error is not null or not v_visible.identity_clean then
    insert into pg_temp._p9_cs_results values (2, 'authenticated multi-org cria sessao valida', 'HARNESS_ERROR', coalesce(v_visible.harness_error, 'identity was not restored after SELECT'), v_visible.returned_sqlstate, v_visible.constraint_name, 'runner identity check failed');
    return;
  end if;

  insert into pg_temp._p9_cs_results values (
    2,
    'authenticated multi-org cria sessao valida',
    case
      when v_count = 1
       and v_visible.operation_succeeded
       and v_visible.value_text = '1' then 'PASS'
      else 'SUT_FAIL'
    end,
    case
      when v_count = 1
       and v_visible.operation_succeeded
       and v_visible.value_text = '1'
        then 'membership-authorized user inserted and selected the session although current_org_id points elsewhere'
      else 'inserted state or authenticated visibility was not correct'
    end,
    v_visible.returned_sqlstate,
    v_visible.constraint_name,
    pg_catalog.format('postgres_row_count=%s | authenticated_visible=%s', v_count, coalesce(v_visible.value_text, '<null>'))
  );
exception
  when others then
    insert into pg_temp._p9_cs_results values (2, 'authenticated multi-org cria sessao valida', 'HARNESS_ERROR', 'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null, 'scenario rolled back');
end;
$scenario_2$;

-- --------------------------------------------------------------------------
-- Cenario 3: status invalido.
-- --------------------------------------------------------------------------

do $scenario_3$
declare
  v_fixture pg_temp._p9_cs_fixtures%rowtype;
  v_id uuid := gen_random_uuid();
  v_exec record;
  v_constraint_ok boolean := false;
  v_remaining integer;
begin
  if (select harness_preflight from pg_temp._p9_cs_context) <> 'PASS' then
    insert into pg_temp._p9_cs_results values (3, 'status invalido rejeitado', 'HARNESS_ERROR', 'harness preflight did not pass', null, null, 'scenario not executed');
    return;
  end if;

  select * into v_fixture from pg_temp._p9_cs_fixtures where fixture_number = 2;
  if v_fixture.conversation_id is null then
    insert into pg_temp._p9_cs_results values (3, 'status invalido rejeitado', 'BLOCKED_BY_FIXTURE_PREREQUISITE', 'fixture 2 is unavailable', null, null, 'no write attempted');
    return;
  end if;

  if not pg_temp._p9_fixture_is_still_safe(2) then
    insert into pg_temp._p9_cs_results values (3, (select scenario_name from pg_temp._p9_cs_matrix where scenario_number = 3), 'HARNESS_ERROR', 'selected fixture changed after setup or acquired an active session', null, null, 'fixture was revalidated immediately before the first write');
    return;
  end if;

  insert into pg_temp._p9_cs_created_ids values (v_id, 3, 'invalid status attempt');

  select * into v_exec
  from pg_temp._p9_exec_dml(
    'service_role',
    null,
    pg_catalog.format(
      'insert into public.conversation_sessions (id, organization_id, store_id, conversation_id, status) values (%L, %L, %L, %L, ''paused'')',
      v_id, v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id
    )
  );

  if v_exec.harness_error is not null or not v_exec.identity_clean then
    insert into pg_temp._p9_cs_results values (3, 'status invalido rejeitado', 'HARNESS_ERROR', coalesce(v_exec.harness_error, 'identity was not restored'), v_exec.returned_sqlstate, v_exec.constraint_name, 'runner identity check failed');
    return;
  end if;

  if v_exec.constraint_name is not null then
    select exists (
      select 1
      from pg_constraint con
      where con.conrelid = 'public.conversation_sessions'::regclass
        and con.conname = v_exec.constraint_name
        and con.contype = 'c'
        and lower(pg_get_constraintdef(con.oid)) like '%status%'
        and lower(pg_get_constraintdef(con.oid)) like '%active%'
        and lower(pg_get_constraintdef(con.oid)) like '%closed%'
    ) into v_constraint_ok;
  end if;

  select count(*) into v_remaining from public.conversation_sessions where id = v_id;

  insert into pg_temp._p9_cs_results values (
    3,
    'status invalido rejeitado',
    case
      when not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '23514'
       and v_constraint_ok
       and v_remaining = 0 then 'PASS'
      else 'SUT_FAIL'
    end,
    case
      when not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '23514'
       and v_constraint_ok
       and v_remaining = 0
        then 'invalid status was rejected by the expected check constraint'
      else 'invalid status was accepted or rejected by an unexpected cause'
    end,
    v_exec.returned_sqlstate,
    v_exec.constraint_name,
    'attempted row remaining=' || v_remaining
  );
exception
  when others then
    insert into pg_temp._p9_cs_results values (3, 'status invalido rejeitado', 'HARNESS_ERROR', 'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null, 'scenario rolled back');
end;
$scenario_3$;

-- --------------------------------------------------------------------------
-- Cenario 4: active exige closed_at null.
-- --------------------------------------------------------------------------

do $scenario_4$
declare
  v_fixture pg_temp._p9_cs_fixtures%rowtype;
  v_id uuid := gen_random_uuid();
  v_exec record;
  v_constraint_ok boolean := false;
  v_remaining integer;
begin
  if (select harness_preflight from pg_temp._p9_cs_context) <> 'PASS' then
    insert into pg_temp._p9_cs_results values (4, 'active exige closed_at null', 'HARNESS_ERROR', 'harness preflight did not pass', null, null, 'scenario not executed');
    return;
  end if;

  select * into v_fixture from pg_temp._p9_cs_fixtures where fixture_number = 3;
  if v_fixture.conversation_id is null then
    insert into pg_temp._p9_cs_results values (4, 'active exige closed_at null', 'BLOCKED_BY_FIXTURE_PREREQUISITE', 'fixture 3 is unavailable', null, null, 'no write attempted');
    return;
  end if;

  if not pg_temp._p9_fixture_is_still_safe(3) then
    insert into pg_temp._p9_cs_results values (4, (select scenario_name from pg_temp._p9_cs_matrix where scenario_number = 4), 'HARNESS_ERROR', 'selected fixture changed after setup or acquired an active session', null, null, 'fixture was revalidated immediately before the first write');
    return;
  end if;

  insert into pg_temp._p9_cs_created_ids values (v_id, 4, 'active with closed_at attempt');

  select * into v_exec
  from pg_temp._p9_exec_dml(
    'service_role',
    null,
    pg_catalog.format(
      'insert into public.conversation_sessions (id, organization_id, store_id, conversation_id, status, closed_at) values (%L, %L, %L, %L, ''active'', pg_catalog.clock_timestamp())',
      v_id, v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id
    )
  );

  if v_exec.harness_error is not null or not v_exec.identity_clean then
    insert into pg_temp._p9_cs_results values (4, 'active exige closed_at null', 'HARNESS_ERROR', coalesce(v_exec.harness_error, 'identity was not restored'), v_exec.returned_sqlstate, v_exec.constraint_name, 'runner identity check failed');
    return;
  end if;

  if v_exec.constraint_name is not null then
    select exists (
      select 1
      from pg_constraint con
      where con.conrelid = 'public.conversation_sessions'::regclass
        and con.conname = v_exec.constraint_name
        and con.contype = 'c'
        and lower(pg_get_constraintdef(con.oid)) like '%closed_at%'
        and lower(pg_get_constraintdef(con.oid)) like '%status%'
    ) into v_constraint_ok;
  end if;

  select count(*) into v_remaining from public.conversation_sessions where id = v_id;

  insert into pg_temp._p9_cs_results values (
    4,
    'active exige closed_at null',
    case when not v_exec.operation_succeeded and v_exec.returned_sqlstate = '23514' and v_constraint_ok and v_remaining = 0 then 'PASS' else 'SUT_FAIL' end,
    case when not v_exec.operation_succeeded and v_exec.returned_sqlstate = '23514' and v_constraint_ok and v_remaining = 0 then 'active row with closed_at was rejected by the state check' else 'active/closed_at rule did not fail by the expected cause' end,
    v_exec.returned_sqlstate,
    v_exec.constraint_name,
    'attempted row remaining=' || v_remaining
  );
exception
  when others then
    insert into pg_temp._p9_cs_results values (4, 'active exige closed_at null', 'HARNESS_ERROR', 'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null, 'scenario rolled back');
end;
$scenario_4$;

-- --------------------------------------------------------------------------
-- Cenario 5: closed exige closed_at.
-- --------------------------------------------------------------------------

do $scenario_5$
declare
  v_fixture pg_temp._p9_cs_fixtures%rowtype;
  v_id uuid := gen_random_uuid();
  v_exec record;
  v_constraint_ok boolean := false;
  v_remaining integer;
begin
  if (select harness_preflight from pg_temp._p9_cs_context) <> 'PASS' then
    insert into pg_temp._p9_cs_results values (5, 'closed exige closed_at preenchido', 'HARNESS_ERROR', 'harness preflight did not pass', null, null, 'scenario not executed');
    return;
  end if;

  select * into v_fixture from pg_temp._p9_cs_fixtures where fixture_number = 4;
  if v_fixture.conversation_id is null then
    insert into pg_temp._p9_cs_results values (5, 'closed exige closed_at preenchido', 'BLOCKED_BY_FIXTURE_PREREQUISITE', 'fixture 4 is unavailable', null, null, 'no write attempted');
    return;
  end if;

  if not pg_temp._p9_fixture_is_still_safe(4) then
    insert into pg_temp._p9_cs_results values (5, (select scenario_name from pg_temp._p9_cs_matrix where scenario_number = 5), 'HARNESS_ERROR', 'selected fixture changed after setup or acquired an active session', null, null, 'fixture was revalidated immediately before the first write');
    return;
  end if;

  insert into pg_temp._p9_cs_created_ids values (v_id, 5, 'closed without closed_at attempt');

  select * into v_exec
  from pg_temp._p9_exec_dml(
    'service_role',
    null,
    pg_catalog.format(
      'insert into public.conversation_sessions (id, organization_id, store_id, conversation_id, status) values (%L, %L, %L, %L, ''closed'')',
      v_id, v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id
    )
  );

  if v_exec.harness_error is not null or not v_exec.identity_clean then
    insert into pg_temp._p9_cs_results values (5, 'closed exige closed_at preenchido', 'HARNESS_ERROR', coalesce(v_exec.harness_error, 'identity was not restored'), v_exec.returned_sqlstate, v_exec.constraint_name, 'runner identity check failed');
    return;
  end if;

  if v_exec.constraint_name is not null then
    select exists (
      select 1
      from pg_constraint con
      where con.conrelid = 'public.conversation_sessions'::regclass
        and con.conname = v_exec.constraint_name
        and con.contype = 'c'
        and lower(pg_get_constraintdef(con.oid)) like '%closed_at%'
        and lower(pg_get_constraintdef(con.oid)) like '%status%'
    ) into v_constraint_ok;
  end if;

  select count(*) into v_remaining from public.conversation_sessions where id = v_id;

  insert into pg_temp._p9_cs_results values (
    5,
    'closed exige closed_at preenchido',
    case when not v_exec.operation_succeeded and v_exec.returned_sqlstate = '23514' and v_constraint_ok and v_remaining = 0 then 'PASS' else 'SUT_FAIL' end,
    case when not v_exec.operation_succeeded and v_exec.returned_sqlstate = '23514' and v_constraint_ok and v_remaining = 0 then 'closed row without closed_at was rejected by the state check' else 'closed/closed_at rule did not fail by the expected cause' end,
    v_exec.returned_sqlstate,
    v_exec.constraint_name,
    'attempted row remaining=' || v_remaining
  );
exception
  when others then
    insert into pg_temp._p9_cs_results values (5, 'closed exige closed_at preenchido', 'HARNESS_ERROR', 'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null, 'scenario rolled back');
end;
$scenario_5$;

-- --------------------------------------------------------------------------
-- Cenario 6: fechamento automatico.
-- --------------------------------------------------------------------------

do $scenario_6$
declare
  v_fixture pg_temp._p9_cs_fixtures%rowtype;
  v_id uuid := gen_random_uuid();
  v_insert record;
  v_update record;
  v_before_updated_at timestamptz;
  v_before_closed_at timestamptz;
  v_after_updated_at timestamptz;
  v_after_closed_at timestamptz;
  v_status text;
begin
  if (select harness_preflight from pg_temp._p9_cs_context) <> 'PASS' then
    insert into pg_temp._p9_cs_results values (6, 'fechamento automatico preenche timestamps', 'HARNESS_ERROR', 'harness preflight did not pass', null, null, 'scenario not executed');
    return;
  end if;

  select * into v_fixture from pg_temp._p9_cs_fixtures where fixture_number = 5;
  if v_fixture.conversation_id is null then
    insert into pg_temp._p9_cs_results values (6, 'fechamento automatico preenche timestamps', 'BLOCKED_BY_FIXTURE_PREREQUISITE', 'fixture 5 is unavailable', null, null, 'no write attempted');
    return;
  end if;

  if not pg_temp._p9_fixture_is_still_safe(5) then
    insert into pg_temp._p9_cs_results values (6, (select scenario_name from pg_temp._p9_cs_matrix where scenario_number = 6), 'HARNESS_ERROR', 'selected fixture changed after setup or acquired an active session', null, null, 'fixture was revalidated immediately before the first write');
    return;
  end if;

  insert into pg_temp._p9_cs_created_ids values (v_id, 6, 'automatic close fixture');

  select * into v_insert
  from pg_temp._p9_exec_dml(
    'service_role', null,
    pg_catalog.format(
      'insert into public.conversation_sessions (id, organization_id, store_id, conversation_id) values (%L, %L, %L, %L)',
      v_id, v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id
    )
  );

  if v_insert.harness_error is not null or not v_insert.identity_clean then
    insert into pg_temp._p9_cs_results values (6, 'fechamento automatico preenche timestamps', 'HARNESS_ERROR', coalesce(v_insert.harness_error, 'identity was not restored after insert'), v_insert.returned_sqlstate, v_insert.constraint_name, 'runner identity check failed');
    return;
  end if;

  if not v_insert.operation_succeeded or v_insert.affected_rows <> 1 then
    insert into pg_temp._p9_cs_results values (6, 'fechamento automatico preenche timestamps', 'SUT_FAIL', 'active fixture insert failed: ' || coalesce(v_insert.message_text, '<no message>'), v_insert.returned_sqlstate, v_insert.constraint_name, 'expected one inserted row');
    return;
  end if;

  select updated_at, closed_at into v_before_updated_at, v_before_closed_at
  from public.conversation_sessions where id = v_id;

  perform pg_catalog.pg_sleep(0.02);

  select * into v_update
  from pg_temp._p9_exec_dml(
    'service_role', null,
    pg_catalog.format(
      'update public.conversation_sessions set status = ''closed'' where id = %L',
      v_id
    )
  );

  if v_update.harness_error is not null or not v_update.identity_clean then
    insert into pg_temp._p9_cs_results values (6, 'fechamento automatico preenche timestamps', 'HARNESS_ERROR', coalesce(v_update.harness_error, 'identity was not restored after update'), v_update.returned_sqlstate, v_update.constraint_name, 'runner identity check failed');
    return;
  end if;

  select status, updated_at, closed_at
  into v_status, v_after_updated_at, v_after_closed_at
  from public.conversation_sessions where id = v_id;

  insert into pg_temp._p9_cs_results values (
    6,
    'fechamento automatico preenche timestamps',
    case
      when v_update.operation_succeeded
       and v_update.affected_rows = 1
       and v_before_closed_at is null
       and v_status = 'closed'
       and v_after_closed_at is not null
       and v_after_updated_at > v_before_updated_at then 'PASS'
      else 'SUT_FAIL'
    end,
    case
      when v_update.operation_succeeded
       and v_update.affected_rows = 1
       and v_before_closed_at is null
       and v_status = 'closed'
       and v_after_closed_at is not null
       and v_after_updated_at > v_before_updated_at
        then 'active to closed filled closed_at and advanced updated_at'
      else 'automatic close state or timestamps are incorrect'
    end,
    v_update.returned_sqlstate,
    v_update.constraint_name,
    pg_catalog.format('status=%s | closed_at_filled=%s | updated_at_advanced=%s', v_status, v_after_closed_at is not null, v_after_updated_at > v_before_updated_at)
  );
exception
  when others then
    insert into pg_temp._p9_cs_results values (6, 'fechamento automatico preenche timestamps', 'HARNESS_ERROR', 'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null, 'scenario rolled back');
end;
$scenario_6$;

-- --------------------------------------------------------------------------
-- Cenario 7: closed_at nao pode ser falsificado.
-- --------------------------------------------------------------------------

do $scenario_7$
declare
  v_fixture pg_temp._p9_cs_fixtures%rowtype;
  v_id uuid := gen_random_uuid();
  v_insert record;
  v_update record;
  v_before timestamptz;
  v_after timestamptz;
begin
  if (select harness_preflight from pg_temp._p9_cs_context) <> 'PASS' then
    insert into pg_temp._p9_cs_results values (7, 'closed_at nao pode ser falsificado', 'HARNESS_ERROR', 'harness preflight did not pass', null, null, 'scenario not executed');
    return;
  end if;

  select * into v_fixture from pg_temp._p9_cs_fixtures where fixture_number = 6;
  if v_fixture.conversation_id is null then
    insert into pg_temp._p9_cs_results values (7, 'closed_at nao pode ser falsificado', 'BLOCKED_BY_FIXTURE_PREREQUISITE', 'fixture 6 is unavailable', null, null, 'no write attempted');
    return;
  end if;

  if not pg_temp._p9_fixture_is_still_safe(6) then
    insert into pg_temp._p9_cs_results values (7, (select scenario_name from pg_temp._p9_cs_matrix where scenario_number = 7), 'HARNESS_ERROR', 'selected fixture changed after setup or acquired an active session', null, null, 'fixture was revalidated immediately before the first write');
    return;
  end if;

  insert into pg_temp._p9_cs_created_ids values (v_id, 7, 'closed_at tamper fixture');

  select * into v_insert from pg_temp._p9_exec_dml(
    'service_role', null,
    pg_catalog.format(
      'insert into public.conversation_sessions (id, organization_id, store_id, conversation_id, status, closed_at) values (%L, %L, %L, %L, ''closed'', pg_catalog.clock_timestamp())',
      v_id, v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id
    )
  );

  if v_insert.harness_error is not null or not v_insert.identity_clean then
    insert into pg_temp._p9_cs_results values (7, 'closed_at nao pode ser falsificado', 'HARNESS_ERROR', coalesce(v_insert.harness_error, 'identity was not restored after insert'), v_insert.returned_sqlstate, v_insert.constraint_name, 'runner identity check failed');
    return;
  end if;

  if not v_insert.operation_succeeded then
    insert into pg_temp._p9_cs_results values (7, 'closed_at nao pode ser falsificado', 'SUT_FAIL', 'closed fixture insert failed: ' || coalesce(v_insert.message_text, '<no message>'), v_insert.returned_sqlstate, v_insert.constraint_name, 'fixture not created');
    return;
  end if;

  select closed_at into v_before from public.conversation_sessions where id = v_id;

  select * into v_update from pg_temp._p9_exec_dml(
    'service_role', null,
    pg_catalog.format(
      'update public.conversation_sessions set closed_at = closed_at + interval ''1 day'' where id = %L',
      v_id
    )
  );

  if v_update.harness_error is not null or not v_update.identity_clean then
    insert into pg_temp._p9_cs_results values (7, 'closed_at nao pode ser falsificado', 'HARNESS_ERROR', coalesce(v_update.harness_error, 'identity was not restored after update'), v_update.returned_sqlstate, v_update.constraint_name, 'runner identity check failed');
    return;
  end if;

  select closed_at into v_after from public.conversation_sessions where id = v_id;

  insert into pg_temp._p9_cs_results values (
    7,
    'closed_at nao pode ser falsificado',
    case
      when not v_update.operation_succeeded
       and v_update.returned_sqlstate = 'P0001'
       and v_update.message_text = 'closed_at can only change when status changes for conversation_sessions'
       and v_after = v_before then 'PASS'
      else 'SUT_FAIL'
    end,
    case
      when not v_update.operation_succeeded
       and v_update.returned_sqlstate = 'P0001'
       and v_update.message_text = 'closed_at can only change when status changes for conversation_sessions'
       and v_after = v_before
        then 'closed_at tampering was blocked by the expected write rule'
      else 'closed_at changed or the rejection cause was unexpected'
    end,
    v_update.returned_sqlstate,
    v_update.constraint_name,
    'closed_at_unchanged=' || (v_after = v_before)
  );
exception
  when others then
    insert into pg_temp._p9_cs_results values (7, 'closed_at nao pode ser falsificado', 'HARNESS_ERROR', 'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null, 'scenario rolled back');
end;
$scenario_7$;

-- --------------------------------------------------------------------------
-- Cenario 8: sessao fechada nao reabre.
-- --------------------------------------------------------------------------

do $scenario_8$
declare
  v_fixture pg_temp._p9_cs_fixtures%rowtype;
  v_id uuid := gen_random_uuid();
  v_insert record;
  v_update record;
  v_status text;
  v_closed_at timestamptz;
begin
  if (select harness_preflight from pg_temp._p9_cs_context) <> 'PASS' then
    insert into pg_temp._p9_cs_results values (8, 'sessao fechada nao reabre', 'HARNESS_ERROR', 'harness preflight did not pass', null, null, 'scenario not executed');
    return;
  end if;

  select * into v_fixture from pg_temp._p9_cs_fixtures where fixture_number = 7;
  if v_fixture.conversation_id is null then
    insert into pg_temp._p9_cs_results values (8, 'sessao fechada nao reabre', 'BLOCKED_BY_FIXTURE_PREREQUISITE', 'fixture 7 is unavailable', null, null, 'no write attempted');
    return;
  end if;

  if not pg_temp._p9_fixture_is_still_safe(7) then
    insert into pg_temp._p9_cs_results values (8, (select scenario_name from pg_temp._p9_cs_matrix where scenario_number = 8), 'HARNESS_ERROR', 'selected fixture changed after setup or acquired an active session', null, null, 'fixture was revalidated immediately before the first write');
    return;
  end if;

  insert into pg_temp._p9_cs_created_ids values (v_id, 8, 'closed reopen fixture');

  select * into v_insert from pg_temp._p9_exec_dml(
    'service_role', null,
    pg_catalog.format(
      'insert into public.conversation_sessions (id, organization_id, store_id, conversation_id, status, closed_at) values (%L, %L, %L, %L, ''closed'', pg_catalog.clock_timestamp())',
      v_id, v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id
    )
  );

  if v_insert.harness_error is not null or not v_insert.identity_clean then
    insert into pg_temp._p9_cs_results values (8, 'sessao fechada nao reabre', 'HARNESS_ERROR', coalesce(v_insert.harness_error, 'identity was not restored after insert'), v_insert.returned_sqlstate, v_insert.constraint_name, 'runner identity check failed');
    return;
  end if;

  if not v_insert.operation_succeeded then
    insert into pg_temp._p9_cs_results values (8, 'sessao fechada nao reabre', 'SUT_FAIL', 'closed fixture insert failed: ' || coalesce(v_insert.message_text, '<no message>'), v_insert.returned_sqlstate, v_insert.constraint_name, 'fixture not created');
    return;
  end if;

  select * into v_update from pg_temp._p9_exec_dml(
    'service_role', null,
    pg_catalog.format(
      'update public.conversation_sessions set status = ''active'' where id = %L',
      v_id
    )
  );

  if v_update.harness_error is not null or not v_update.identity_clean then
    insert into pg_temp._p9_cs_results values (8, 'sessao fechada nao reabre', 'HARNESS_ERROR', coalesce(v_update.harness_error, 'identity was not restored after update'), v_update.returned_sqlstate, v_update.constraint_name, 'runner identity check failed');
    return;
  end if;

  select status, closed_at into v_status, v_closed_at from public.conversation_sessions where id = v_id;

  insert into pg_temp._p9_cs_results values (
    8,
    'sessao fechada nao reabre',
    case
      when not v_update.operation_succeeded
       and v_update.returned_sqlstate = 'P0001'
       and v_update.message_text = 'closed session cannot be reopened for conversation_sessions'
       and v_status = 'closed'
       and v_closed_at is not null then 'PASS'
      else 'SUT_FAIL'
    end,
    case
      when not v_update.operation_succeeded
       and v_update.returned_sqlstate = 'P0001'
       and v_update.message_text = 'closed session cannot be reopened for conversation_sessions'
       and v_status = 'closed'
       and v_closed_at is not null
        then 'reopening was blocked and the closed state remained intact'
      else 'closed session reopened or rejection cause was unexpected'
    end,
    v_update.returned_sqlstate,
    v_update.constraint_name,
    pg_catalog.format('status=%s | closed_at_present=%s', v_status, v_closed_at is not null)
  );
exception
  when others then
    insert into pg_temp._p9_cs_results values (8, 'sessao fechada nao reabre', 'HARNESS_ERROR', 'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null, 'scenario rolled back');
end;
$scenario_8$;

-- --------------------------------------------------------------------------
-- Cenario 9: organization_id imutavel por authenticated.
-- --------------------------------------------------------------------------

do $scenario_9$
declare
  v_fixture pg_temp._p9_cs_fixtures%rowtype;
  v_user uuid;
  v_id uuid := gen_random_uuid();
  v_other_org uuid;
  v_insert record;
  v_update record;
  v_after_org uuid;
begin
  if (select harness_preflight from pg_temp._p9_cs_context) <> 'PASS' then
    insert into pg_temp._p9_cs_results values (9, 'organization_id imutavel por authenticated', 'HARNESS_ERROR', 'harness preflight did not pass', null, null, 'scenario not executed');
    return;
  end if;

  select * into v_fixture from pg_temp._p9_cs_fixtures where fixture_number = 8;
  select mismatch_user_id, mismatch_current_org_id
  into v_user, v_other_org
  from pg_temp._p9_cs_context;

  if v_fixture.conversation_id is null
     or v_user is null
     or v_other_org is null then
    insert into pg_temp._p9_cs_results values (9, 'organization_id imutavel por authenticated', 'BLOCKED_BY_FIXTURE_PREREQUISITE', 'fixture 8 or multi-organization authenticated regression user is unavailable', null, null, 'no write attempted');
    return;
  end if;

  if v_other_org = v_fixture.organization_id
     or not exists (
       select 1
       from public.memberships m
       where m.user_id = v_user
         and m.organization_id = v_other_org
     ) then
    insert into pg_temp._p9_cs_results values (9, 'organization_id imutavel por authenticated', 'HARNESS_ERROR', 'selected second organization is not a distinct membership of the authenticated user', null, null, 'scenario not executed');
    return;
  end if;

  if not pg_temp._p9_fixture_is_still_safe(8) then
    insert into pg_temp._p9_cs_results values (9, (select scenario_name from pg_temp._p9_cs_matrix where scenario_number = 9), 'HARNESS_ERROR', 'selected fixture changed after setup or acquired an active session', null, null, 'fixture was revalidated immediately before the first write');
    return;
  end if;

  insert into pg_temp._p9_cs_created_ids values (v_id, 9, 'authenticated immutability fixture');

  select * into v_insert from pg_temp._p9_exec_dml(
    'authenticated', v_user,
    pg_catalog.format(
      'insert into public.conversation_sessions (id, organization_id, store_id, conversation_id, status, closed_at) values (%L, %L, %L, %L, ''closed'', pg_catalog.clock_timestamp())',
      v_id, v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id
    )
  );

  if v_insert.harness_error is not null or not v_insert.identity_clean then
    insert into pg_temp._p9_cs_results values (9, 'organization_id imutavel por authenticated', 'HARNESS_ERROR', coalesce(v_insert.harness_error, 'identity was not restored after insert'), v_insert.returned_sqlstate, v_insert.constraint_name, 'runner identity check failed');
    return;
  end if;

  if not v_insert.operation_succeeded then
    insert into pg_temp._p9_cs_results values (9, 'organization_id imutavel por authenticated', 'SUT_FAIL', 'authenticated fixture insert failed: ' || coalesce(v_insert.message_text, '<no message>'), v_insert.returned_sqlstate, v_insert.constraint_name, 'fixture not created');
    return;
  end if;

  select * into v_update from pg_temp._p9_exec_dml(
    'authenticated', v_user,
    pg_catalog.format(
      'update public.conversation_sessions set organization_id = %L where id = %L',
      v_other_org, v_id
    )
  );

  if v_update.harness_error is not null or not v_update.identity_clean then
    insert into pg_temp._p9_cs_results values (9, 'organization_id imutavel por authenticated', 'HARNESS_ERROR', coalesce(v_update.harness_error, 'identity was not restored after update'), v_update.returned_sqlstate, v_update.constraint_name, 'runner identity check failed');
    return;
  end if;

  select organization_id into v_after_org from public.conversation_sessions where id = v_id;

  insert into pg_temp._p9_cs_results values (
    9,
    'organization_id imutavel por authenticated',
    case
      when not v_update.operation_succeeded
       and v_update.returned_sqlstate = 'P0001'
       and v_update.message_text = 'organization_id is immutable after insert for conversation_sessions'
       and v_after_org = v_fixture.organization_id then 'PASS'
      else 'SUT_FAIL'
    end,
    case
      when not v_update.operation_succeeded
       and v_update.returned_sqlstate = 'P0001'
       and v_update.message_text = 'organization_id is immutable after insert for conversation_sessions'
       and v_after_org = v_fixture.organization_id
        then 'authenticated organization change was blocked by the explicit immutability rule'
      else 'organization changed or rejection cause was unexpected'
    end,
    v_update.returned_sqlstate,
    v_update.constraint_name,
    'organization_unchanged=' || (v_after_org = v_fixture.organization_id)
  );
exception
  when others then
    insert into pg_temp._p9_cs_results values (9, 'organization_id imutavel por authenticated', 'HARNESS_ERROR', 'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null, 'scenario rolled back');
end;
$scenario_9$;

-- --------------------------------------------------------------------------
-- Cenario 10: organization_id imutavel por service_role.
-- --------------------------------------------------------------------------

do $scenario_10$
declare
  v_fixture pg_temp._p9_cs_fixtures%rowtype;
  v_id uuid := gen_random_uuid();
  v_other_org uuid := gen_random_uuid();
  v_insert record;
  v_update record;
  v_after_org uuid;
begin
  if (select harness_preflight from pg_temp._p9_cs_context) <> 'PASS' then
    insert into pg_temp._p9_cs_results values (10, 'organization_id imutavel por service_role', 'HARNESS_ERROR', 'harness preflight did not pass', null, null, 'scenario not executed');
    return;
  end if;

  select * into v_fixture from pg_temp._p9_cs_fixtures where fixture_number = 9;
  if v_fixture.conversation_id is null then
    insert into pg_temp._p9_cs_results values (10, 'organization_id imutavel por service_role', 'BLOCKED_BY_FIXTURE_PREREQUISITE', 'fixture 9 is unavailable', null, null, 'no write attempted');
    return;
  end if;

  if not pg_temp._p9_fixture_is_still_safe(9) then
    insert into pg_temp._p9_cs_results values (10, (select scenario_name from pg_temp._p9_cs_matrix where scenario_number = 10), 'HARNESS_ERROR', 'selected fixture changed after setup or acquired an active session', null, null, 'fixture was revalidated immediately before the first write');
    return;
  end if;

  insert into pg_temp._p9_cs_created_ids values (v_id, 10, 'service_role immutability fixture');

  select * into v_insert from pg_temp._p9_exec_dml(
    'service_role', null,
    pg_catalog.format(
      'insert into public.conversation_sessions (id, organization_id, store_id, conversation_id, status, closed_at) values (%L, %L, %L, %L, ''closed'', pg_catalog.clock_timestamp())',
      v_id, v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id
    )
  );

  if v_insert.harness_error is not null or not v_insert.identity_clean then
    insert into pg_temp._p9_cs_results values (10, 'organization_id imutavel por service_role', 'HARNESS_ERROR', coalesce(v_insert.harness_error, 'identity was not restored after insert'), v_insert.returned_sqlstate, v_insert.constraint_name, 'runner identity check failed');
    return;
  end if;

  if not v_insert.operation_succeeded then
    insert into pg_temp._p9_cs_results values (10, 'organization_id imutavel por service_role', 'SUT_FAIL', 'service_role fixture insert failed: ' || coalesce(v_insert.message_text, '<no message>'), v_insert.returned_sqlstate, v_insert.constraint_name, 'fixture not created');
    return;
  end if;

  select * into v_update from pg_temp._p9_exec_dml(
    'service_role', null,
    pg_catalog.format(
      'update public.conversation_sessions set organization_id = %L where id = %L',
      v_other_org, v_id
    )
  );

  if v_update.harness_error is not null or not v_update.identity_clean then
    insert into pg_temp._p9_cs_results values (10, 'organization_id imutavel por service_role', 'HARNESS_ERROR', coalesce(v_update.harness_error, 'identity was not restored after update'), v_update.returned_sqlstate, v_update.constraint_name, 'runner identity check failed');
    return;
  end if;

  select organization_id into v_after_org from public.conversation_sessions where id = v_id;

  insert into pg_temp._p9_cs_results values (
    10,
    'organization_id imutavel por service_role',
    case
      when not v_update.operation_succeeded
       and v_update.returned_sqlstate = 'P0001'
       and v_update.message_text = 'organization_id is immutable after insert for conversation_sessions'
       and v_after_org = v_fixture.organization_id then 'PASS'
      else 'SUT_FAIL'
    end,
    case
      when not v_update.operation_succeeded
       and v_update.returned_sqlstate = 'P0001'
       and v_update.message_text = 'organization_id is immutable after insert for conversation_sessions'
       and v_after_org = v_fixture.organization_id
        then 'service_role organization change was blocked by the explicit immutability rule'
      else 'organization changed or rejection cause was unexpected'
    end,
    v_update.returned_sqlstate,
    v_update.constraint_name,
    'organization_unchanged=' || (v_after_org = v_fixture.organization_id)
  );
exception
  when others then
    insert into pg_temp._p9_cs_results values (10, 'organization_id imutavel por service_role', 'HARNESS_ERROR', 'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null, 'scenario rolled back');
end;
$scenario_10$;

-- --------------------------------------------------------------------------
-- Cenario 11: unicidade de active.
-- --------------------------------------------------------------------------

do $scenario_11$
declare
  v_fixture pg_temp._p9_cs_fixtures%rowtype;
  v_first uuid := gen_random_uuid();
  v_second uuid := gen_random_uuid();
  v_insert_first record;
  v_insert_second record;
  v_active_count integer;
  v_second_count integer;
begin
  if (select harness_preflight from pg_temp._p9_cs_context) <> 'PASS' then
    insert into pg_temp._p9_cs_results values (11, 'apenas uma active por thread e loja', 'HARNESS_ERROR', 'harness preflight did not pass', null, null, 'scenario not executed');
    return;
  end if;

  select * into v_fixture from pg_temp._p9_cs_fixtures where fixture_number = 10;
  if v_fixture.conversation_id is null then
    insert into pg_temp._p9_cs_results values (11, 'apenas uma active por thread e loja', 'BLOCKED_BY_FIXTURE_PREREQUISITE', 'fixture 10 is unavailable', null, null, 'no write attempted');
    return;
  end if;

  if not pg_temp._p9_fixture_is_still_safe(10) then
    insert into pg_temp._p9_cs_results values (11, (select scenario_name from pg_temp._p9_cs_matrix where scenario_number = 11), 'HARNESS_ERROR', 'selected fixture changed after setup or acquired an active session', null, null, 'fixture was revalidated immediately before the first write');
    return;
  end if;

  insert into pg_temp._p9_cs_created_ids values
    (v_first, 11, 'first active session'),
    (v_second, 11, 'duplicate active attempt');

  select * into v_insert_first from pg_temp._p9_exec_dml(
    'service_role', null,
    pg_catalog.format(
      'insert into public.conversation_sessions (id, organization_id, store_id, conversation_id) values (%L, %L, %L, %L)',
      v_first, v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id
    )
  );

  if v_insert_first.harness_error is not null or not v_insert_first.identity_clean then
    insert into pg_temp._p9_cs_results values (11, 'apenas uma active por thread e loja', 'HARNESS_ERROR', coalesce(v_insert_first.harness_error, 'identity was not restored after first insert'), v_insert_first.returned_sqlstate, v_insert_first.constraint_name, 'runner identity check failed');
    return;
  end if;

  if not v_insert_first.operation_succeeded then
    insert into pg_temp._p9_cs_results values (11, 'apenas uma active por thread e loja', 'SUT_FAIL', 'first active insert failed: ' || coalesce(v_insert_first.message_text, '<no message>'), v_insert_first.returned_sqlstate, v_insert_first.constraint_name, 'first active fixture not created');
    return;
  end if;

  select * into v_insert_second from pg_temp._p9_exec_dml(
    'service_role', null,
    pg_catalog.format(
      'insert into public.conversation_sessions (id, organization_id, store_id, conversation_id) values (%L, %L, %L, %L)',
      v_second, v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id
    )
  );

  if v_insert_second.harness_error is not null or not v_insert_second.identity_clean then
    insert into pg_temp._p9_cs_results values (11, 'apenas uma active por thread e loja', 'HARNESS_ERROR', coalesce(v_insert_second.harness_error, 'identity was not restored after duplicate insert'), v_insert_second.returned_sqlstate, v_insert_second.constraint_name, 'runner identity check failed');
    return;
  end if;

  select count(*) into v_active_count
  from public.conversation_sessions
  where organization_id = v_fixture.organization_id
    and store_id = v_fixture.store_id
    and conversation_id = v_fixture.conversation_id
    and status = 'active';

  select count(*) into v_second_count from public.conversation_sessions where id = v_second;

  insert into pg_temp._p9_cs_results values (
    11,
    'apenas uma active por thread e loja',
    case
      when not v_insert_second.operation_succeeded
       and v_insert_second.returned_sqlstate = '23505'
       and v_insert_second.constraint_name = 'conversation_sessions_one_active_per_thread_uidx'
       and v_active_count = 1
       and v_second_count = 0 then 'PASS'
      else 'SUT_FAIL'
    end,
    case
      when not v_insert_second.operation_succeeded
       and v_insert_second.returned_sqlstate = '23505'
       and v_insert_second.constraint_name = 'conversation_sessions_one_active_per_thread_uidx'
       and v_active_count = 1
       and v_second_count = 0
        then 'partial unique index blocked the second active session'
      else 'duplicate active was accepted or rejected by an unexpected cause'
    end,
    v_insert_second.returned_sqlstate,
    v_insert_second.constraint_name,
    pg_catalog.format('active_count=%s | duplicate_row_count=%s', v_active_count, v_second_count)
  );
exception
  when others then
    insert into pg_temp._p9_cs_results values (11, 'apenas uma active por thread e loja', 'HARNESS_ERROR', 'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null, 'scenario rolled back');
end;
$scenario_11$;

-- --------------------------------------------------------------------------
-- Cenario 12: nova active apos fechamento.
-- --------------------------------------------------------------------------

do $scenario_12$
declare
  v_fixture pg_temp._p9_cs_fixtures%rowtype;
  v_first uuid := gen_random_uuid();
  v_second uuid := gen_random_uuid();
  v_insert_first record;
  v_close_first record;
  v_insert_second record;
  v_old_status text;
  v_old_closed_at timestamptz;
  v_new_status text;
  v_active_count integer;
begin
  if (select harness_preflight from pg_temp._p9_cs_context) <> 'PASS' then
    insert into pg_temp._p9_cs_results values (12, 'nova active permitida apos fechamento', 'HARNESS_ERROR', 'harness preflight did not pass', null, null, 'scenario not executed');
    return;
  end if;

  select * into v_fixture from pg_temp._p9_cs_fixtures where fixture_number = 11;
  if v_fixture.conversation_id is null then
    insert into pg_temp._p9_cs_results values (12, 'nova active permitida apos fechamento', 'BLOCKED_BY_FIXTURE_PREREQUISITE', 'fixture 11 is unavailable', null, null, 'no write attempted');
    return;
  end if;

  if not pg_temp._p9_fixture_is_still_safe(11) then
    insert into pg_temp._p9_cs_results values (12, (select scenario_name from pg_temp._p9_cs_matrix where scenario_number = 12), 'HARNESS_ERROR', 'selected fixture changed after setup or acquired an active session', null, null, 'fixture was revalidated immediately before the first write');
    return;
  end if;

  insert into pg_temp._p9_cs_created_ids values
    (v_first, 12, 'previous active session'),
    (v_second, 12, 'new active session');

  select * into v_insert_first from pg_temp._p9_exec_dml(
    'service_role', null,
    pg_catalog.format(
      'insert into public.conversation_sessions (id, organization_id, store_id, conversation_id) values (%L, %L, %L, %L)',
      v_first, v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id
    )
  );

  if v_insert_first.harness_error is not null or not v_insert_first.identity_clean then
    insert into pg_temp._p9_cs_results values (12, 'nova active permitida apos fechamento', 'HARNESS_ERROR', coalesce(v_insert_first.harness_error, 'identity was not restored after first insert'), v_insert_first.returned_sqlstate, v_insert_first.constraint_name, 'runner identity check failed');
    return;
  end if;

  if not v_insert_first.operation_succeeded then
    insert into pg_temp._p9_cs_results values (12, 'nova active permitida apos fechamento', 'SUT_FAIL', 'first active insert failed: ' || coalesce(v_insert_first.message_text, '<no message>'), v_insert_first.returned_sqlstate, v_insert_first.constraint_name, 'first active fixture not created');
    return;
  end if;

  select * into v_close_first from pg_temp._p9_exec_dml(
    'service_role', null,
    pg_catalog.format(
      'update public.conversation_sessions set status = ''closed'' where id = %L',
      v_first
    )
  );

  if v_close_first.harness_error is not null or not v_close_first.identity_clean then
    insert into pg_temp._p9_cs_results values (12, 'nova active permitida apos fechamento', 'HARNESS_ERROR', coalesce(v_close_first.harness_error, 'identity was not restored after close'), v_close_first.returned_sqlstate, v_close_first.constraint_name, 'runner identity check failed');
    return;
  end if;

  if not v_close_first.operation_succeeded or v_close_first.affected_rows <> 1 then
    insert into pg_temp._p9_cs_results values (12, 'nova active permitida apos fechamento', 'SUT_FAIL', 'closing the previous active failed: ' || coalesce(v_close_first.message_text, '<no message>'), v_close_first.returned_sqlstate, v_close_first.constraint_name, 'expected one closed row');
    return;
  end if;

  select * into v_insert_second from pg_temp._p9_exec_dml(
    'service_role', null,
    pg_catalog.format(
      'insert into public.conversation_sessions (id, organization_id, store_id, conversation_id) values (%L, %L, %L, %L)',
      v_second, v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id
    )
  );

  if v_insert_second.harness_error is not null or not v_insert_second.identity_clean then
    insert into pg_temp._p9_cs_results values (12, 'nova active permitida apos fechamento', 'HARNESS_ERROR', coalesce(v_insert_second.harness_error, 'identity was not restored after second insert'), v_insert_second.returned_sqlstate, v_insert_second.constraint_name, 'runner identity check failed');
    return;
  end if;

  select status, closed_at into v_old_status, v_old_closed_at from public.conversation_sessions where id = v_first;
  select status into v_new_status from public.conversation_sessions where id = v_second;
  select count(*) into v_active_count
  from public.conversation_sessions
  where organization_id = v_fixture.organization_id
    and store_id = v_fixture.store_id
    and conversation_id = v_fixture.conversation_id
    and status = 'active';

  insert into pg_temp._p9_cs_results values (
    12,
    'nova active permitida apos fechamento',
    case
      when v_insert_second.operation_succeeded
       and v_insert_second.affected_rows = 1
       and v_old_status = 'closed'
       and v_old_closed_at is not null
       and v_new_status = 'active'
       and v_active_count = 1 then 'PASS'
      else 'SUT_FAIL'
    end,
    case
      when v_insert_second.operation_succeeded
       and v_insert_second.affected_rows = 1
       and v_old_status = 'closed'
       and v_old_closed_at is not null
       and v_new_status = 'active'
       and v_active_count = 1
        then 'a new active session was accepted after the prior one was closed'
      else 'resume flow did not preserve one closed and one active session'
    end,
    v_insert_second.returned_sqlstate,
    v_insert_second.constraint_name,
    pg_catalog.format('old_status=%s | new_status=%s | active_count=%s', v_old_status, v_new_status, v_active_count)
  );
exception
  when others then
    insert into pg_temp._p9_cs_results values (12, 'nova active permitida apos fechamento', 'HARNESS_ERROR', 'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null, 'scenario rolled back');
end;
$scenario_12$;

-- --------------------------------------------------------------------------
-- Cenario 13: relation mismatch.
-- --------------------------------------------------------------------------

do $scenario_13$
declare
  v_fixture pg_temp._p9_cs_fixtures%rowtype;
  v_id uuid := gen_random_uuid();
  v_wrong_store uuid := gen_random_uuid();
  v_exec record;
  v_remaining integer;
begin
  if (select harness_preflight from pg_temp._p9_cs_context) <> 'PASS' then
    insert into pg_temp._p9_cs_results values (13, 'conversation e store incoerentes sao rejeitados', 'HARNESS_ERROR', 'harness preflight did not pass', null, null, 'scenario not executed');
    return;
  end if;

  select * into v_fixture from pg_temp._p9_cs_fixtures where fixture_number = 12;
  if v_fixture.conversation_id is null then
    insert into pg_temp._p9_cs_results values (13, 'conversation e store incoerentes sao rejeitados', 'BLOCKED_BY_FIXTURE_PREREQUISITE', 'fixture 12 is unavailable', null, null, 'no write attempted');
    return;
  end if;

  if not pg_temp._p9_fixture_is_still_safe(12) then
    insert into pg_temp._p9_cs_results values (13, (select scenario_name from pg_temp._p9_cs_matrix where scenario_number = 13), 'HARNESS_ERROR', 'selected fixture changed after setup or acquired an active session', null, null, 'fixture was revalidated immediately before the first write');
    return;
  end if;

  insert into pg_temp._p9_cs_created_ids values (v_id, 13, 'relation mismatch attempt');

  select * into v_exec from pg_temp._p9_exec_dml(
    'service_role', null,
    pg_catalog.format(
      'insert into public.conversation_sessions (id, organization_id, store_id, conversation_id) values (%L, %L, %L, %L)',
      v_id, v_fixture.organization_id, v_wrong_store, v_fixture.conversation_id
    )
  );

  if v_exec.harness_error is not null or not v_exec.identity_clean then
    insert into pg_temp._p9_cs_results values (13, 'conversation e store incoerentes sao rejeitados', 'HARNESS_ERROR', coalesce(v_exec.harness_error, 'identity was not restored'), v_exec.returned_sqlstate, v_exec.constraint_name, 'runner identity check failed');
    return;
  end if;

  select count(*) into v_remaining from public.conversation_sessions where id = v_id;

  insert into pg_temp._p9_cs_results values (
    13,
    'conversation e store incoerentes sao rejeitados',
    case
      when not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '23514'
       and v_exec.message_text = 'conversation session relation mismatch'
       and v_remaining = 0 then 'PASS'
      else 'SUT_FAIL'
    end,
    case
      when not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '23514'
       and v_exec.message_text = 'conversation session relation mismatch'
       and v_remaining = 0
        then 'mismatched store was rejected by the generic relation guard'
      else 'relation mismatch was accepted or rejected by an unexpected cause'
    end,
    v_exec.returned_sqlstate,
    v_exec.constraint_name,
    'attempted row remaining=' || v_remaining
  );
exception
  when others then
    insert into pg_temp._p9_cs_results values (13, 'conversation e store incoerentes sao rejeitados', 'HARNESS_ERROR', 'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null, 'scenario rolled back');
end;
$scenario_13$;

-- --------------------------------------------------------------------------
-- Cenario 14: usuario externo nao visualiza.
-- --------------------------------------------------------------------------

do $scenario_14$
declare
  v_fixture pg_temp._p9_cs_fixtures%rowtype;
  v_external uuid;
  v_id uuid := gen_random_uuid();
  v_insert record;
  v_select record;
  v_postgres_count integer;
begin
  if (select harness_preflight from pg_temp._p9_cs_context) <> 'PASS' then
    insert into pg_temp._p9_cs_results values (14, 'usuario externo nao visualiza sessao', 'HARNESS_ERROR', 'harness preflight did not pass', null, null, 'scenario not executed');
    return;
  end if;

  select * into v_fixture from pg_temp._p9_cs_fixtures where fixture_number = 13;
  select external_user_id into v_external from pg_temp._p9_cs_context;

  if v_fixture.conversation_id is null or v_external is null then
    insert into pg_temp._p9_cs_results values (14, 'usuario externo nao visualiza sessao', 'BLOCKED_BY_FIXTURE_PREREQUISITE', 'fixture 13 or external authenticated user is unavailable', null, null, 'no visibility test executed');
    return;
  end if;

  if not pg_temp._p9_fixture_is_still_safe(13) then
    insert into pg_temp._p9_cs_results values (14, (select scenario_name from pg_temp._p9_cs_matrix where scenario_number = 14), 'HARNESS_ERROR', 'selected fixture changed after setup or acquired an active session', null, null, 'fixture was revalidated immediately before the first write');
    return;
  end if;

  insert into pg_temp._p9_cs_created_ids values (v_id, 14, 'cross-organization select fixture');

  select * into v_insert from pg_temp._p9_exec_dml(
    'service_role', null,
    pg_catalog.format(
      'insert into public.conversation_sessions (id, organization_id, store_id, conversation_id, status, closed_at) values (%L, %L, %L, %L, ''closed'', pg_catalog.clock_timestamp())',
      v_id, v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id
    )
  );

  if v_insert.harness_error is not null or not v_insert.identity_clean then
    insert into pg_temp._p9_cs_results values (14, 'usuario externo nao visualiza sessao', 'HARNESS_ERROR', coalesce(v_insert.harness_error, 'identity was not restored after insert'), v_insert.returned_sqlstate, v_insert.constraint_name, 'runner identity check failed');
    return;
  end if;

  if not v_insert.operation_succeeded then
    insert into pg_temp._p9_cs_results values (14, 'usuario externo nao visualiza sessao', 'SUT_FAIL', 'visibility fixture insert failed: ' || coalesce(v_insert.message_text, '<no message>'), v_insert.returned_sqlstate, v_insert.constraint_name, 'fixture not created');
    return;
  end if;

  select * into v_select from pg_temp._p9_exec_scalar(
    'authenticated', v_external,
    pg_catalog.format(
      'select count(*)::text from public.conversation_sessions where id = %L',
      v_id
    )
  );

  if v_select.harness_error is not null or not v_select.identity_clean then
    insert into pg_temp._p9_cs_results values (14, 'usuario externo nao visualiza sessao', 'HARNESS_ERROR', coalesce(v_select.harness_error, 'identity was not restored after select'), v_select.returned_sqlstate, v_select.constraint_name, 'runner identity check failed');
    return;
  end if;

  select count(*) into v_postgres_count from public.conversation_sessions where id = v_id;

  insert into pg_temp._p9_cs_results values (
    14,
    'usuario externo nao visualiza sessao',
    case when v_select.operation_succeeded and v_select.value_text = '0' and v_postgres_count = 1 then 'PASS' else 'SUT_FAIL' end,
    case when v_select.operation_succeeded and v_select.value_text = '0' and v_postgres_count = 1 then 'external user saw zero rows while the session still existed' else 'cross-organization SELECT isolation failed' end,
    v_select.returned_sqlstate,
    v_select.constraint_name,
    pg_catalog.format('external_visible=%s | postgres_visible=%s', coalesce(v_select.value_text, '<null>'), v_postgres_count)
  );
exception
  when others then
    insert into pg_temp._p9_cs_results values (14, 'usuario externo nao visualiza sessao', 'HARNESS_ERROR', 'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null, 'scenario rolled back');
end;
$scenario_14$;

-- --------------------------------------------------------------------------
-- Cenario 15: usuario externo nao insere e recebe erro generico.
-- --------------------------------------------------------------------------

do $scenario_15$
declare
  v_fixture pg_temp._p9_cs_fixtures%rowtype;
  v_external uuid;
  v_id uuid := gen_random_uuid();
  v_exec record;
  v_remaining integer;
begin
  if (select harness_preflight from pg_temp._p9_cs_context) <> 'PASS' then
    insert into pg_temp._p9_cs_results values (15, 'usuario externo nao insere nem recebe detalhes', 'HARNESS_ERROR', 'harness preflight did not pass', null, null, 'scenario not executed');
    return;
  end if;

  select * into v_fixture from pg_temp._p9_cs_fixtures where fixture_number = 14;
  select external_user_id into v_external from pg_temp._p9_cs_context;

  if v_fixture.conversation_id is null or v_external is null then
    insert into pg_temp._p9_cs_results values (15, 'usuario externo nao insere nem recebe detalhes', 'BLOCKED_BY_FIXTURE_PREREQUISITE', 'fixture 14 or external authenticated user is unavailable', null, null, 'no write attempted');
    return;
  end if;

  if not pg_temp._p9_fixture_is_still_safe(14) then
    insert into pg_temp._p9_cs_results values (15, (select scenario_name from pg_temp._p9_cs_matrix where scenario_number = 15), 'HARNESS_ERROR', 'selected fixture changed after setup or acquired an active session', null, null, 'fixture was revalidated immediately before the first write');
    return;
  end if;

  insert into pg_temp._p9_cs_created_ids values (v_id, 15, 'cross-organization insert attempt');

  select * into v_exec from pg_temp._p9_exec_dml(
    'authenticated', v_external,
    pg_catalog.format(
      'insert into public.conversation_sessions (id, organization_id, store_id, conversation_id) values (%L, %L, %L, %L)',
      v_id, v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id
    )
  );

  if v_exec.harness_error is not null or not v_exec.identity_clean then
    insert into pg_temp._p9_cs_results values (15, 'usuario externo nao insere nem recebe detalhes', 'HARNESS_ERROR', coalesce(v_exec.harness_error, 'identity was not restored'), v_exec.returned_sqlstate, v_exec.constraint_name, 'runner identity check failed');
    return;
  end if;

  select count(*) into v_remaining from public.conversation_sessions where id = v_id;

  insert into pg_temp._p9_cs_results values (
    15,
    'usuario externo nao insere nem recebe detalhes',
    case
      when not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '42501'
       and v_exec.message_text = 'conversation session write is not authorized'
       and v_remaining = 0 then 'PASS'
      else 'SUT_FAIL'
    end,
    case
      when not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '42501'
       and v_exec.message_text = 'conversation session write is not authorized'
       and v_remaining = 0
        then 'external insert was blocked before privileged relation lookup with a generic authorization error'
      else 'external insert was accepted or exposed an unexpected error cause'
    end,
    v_exec.returned_sqlstate,
    v_exec.constraint_name,
    'attempted row remaining=' || v_remaining
  );
exception
  when others then
    insert into pg_temp._p9_cs_results values (15, 'usuario externo nao insere nem recebe detalhes', 'HARNESS_ERROR', 'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null, 'scenario rolled back');
end;
$scenario_15$;

-- --------------------------------------------------------------------------
-- Cenario 16: authenticated nao executa DELETE.
-- --------------------------------------------------------------------------

do $scenario_16$
declare
  v_fixture pg_temp._p9_cs_fixtures%rowtype;
  v_user uuid;
  v_id uuid := gen_random_uuid();
  v_insert record;
  v_delete record;
  v_remaining integer;
begin
  if (select harness_preflight from pg_temp._p9_cs_context) <> 'PASS' then
    insert into pg_temp._p9_cs_results values (16, 'authenticated nao executa delete', 'HARNESS_ERROR', 'harness preflight did not pass', null, null, 'scenario not executed');
    return;
  end if;

  select * into v_fixture from pg_temp._p9_cs_fixtures where fixture_number = 15;
  select coalesce(mismatch_user_id, member_user_id) into v_user from pg_temp._p9_cs_context;

  if v_fixture.conversation_id is null or v_user is null then
    insert into pg_temp._p9_cs_results values (16, 'authenticated nao executa delete', 'BLOCKED_BY_FIXTURE_PREREQUISITE', 'fixture 15 or authenticated member is unavailable', null, null, 'no delete test executed');
    return;
  end if;

  if not pg_temp._p9_fixture_is_still_safe(15) then
    insert into pg_temp._p9_cs_results values (16, (select scenario_name from pg_temp._p9_cs_matrix where scenario_number = 16), 'HARNESS_ERROR', 'selected fixture changed after setup or acquired an active session', null, null, 'fixture was revalidated immediately before the first write');
    return;
  end if;

  insert into pg_temp._p9_cs_created_ids values (v_id, 16, 'authenticated delete fixture');

  select * into v_insert from pg_temp._p9_exec_dml(
    'service_role', null,
    pg_catalog.format(
      'insert into public.conversation_sessions (id, organization_id, store_id, conversation_id, status, closed_at) values (%L, %L, %L, %L, ''closed'', pg_catalog.clock_timestamp())',
      v_id, v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id
    )
  );

  if v_insert.harness_error is not null or not v_insert.identity_clean then
    insert into pg_temp._p9_cs_results values (16, 'authenticated nao executa delete', 'HARNESS_ERROR', coalesce(v_insert.harness_error, 'identity was not restored after insert'), v_insert.returned_sqlstate, v_insert.constraint_name, 'runner identity check failed');
    return;
  end if;

  if not v_insert.operation_succeeded then
    insert into pg_temp._p9_cs_results values (16, 'authenticated nao executa delete', 'SUT_FAIL', 'delete fixture insert failed: ' || coalesce(v_insert.message_text, '<no message>'), v_insert.returned_sqlstate, v_insert.constraint_name, 'fixture not created');
    return;
  end if;

  select * into v_delete from pg_temp._p9_exec_dml(
    'authenticated', v_user,
    pg_catalog.format(
      'delete from public.conversation_sessions where id = %L',
      v_id
    )
  );

  if v_delete.harness_error is not null or not v_delete.identity_clean then
    insert into pg_temp._p9_cs_results values (16, 'authenticated nao executa delete', 'HARNESS_ERROR', coalesce(v_delete.harness_error, 'identity was not restored after delete'), v_delete.returned_sqlstate, v_delete.constraint_name, 'runner identity check failed');
    return;
  end if;

  select count(*) into v_remaining from public.conversation_sessions where id = v_id;

  insert into pg_temp._p9_cs_results values (
    16,
    'authenticated nao executa delete',
    case
      when not v_delete.operation_succeeded
       and v_delete.returned_sqlstate = '42501'
       and not has_table_privilege('authenticated', 'public.conversation_sessions', 'DELETE')
       and v_remaining = 1 then 'PASS'
      else 'SUT_FAIL'
    end,
    case
      when not v_delete.operation_succeeded
       and v_delete.returned_sqlstate = '42501'
       and not has_table_privilege('authenticated', 'public.conversation_sessions', 'DELETE')
       and v_remaining = 1
        then 'authenticated DELETE was denied and the runner-owned row remained'
      else 'authenticated DELETE was accepted or blocked by an unexpected state'
    end,
    v_delete.returned_sqlstate,
    v_delete.constraint_name,
    'row_remaining=' || v_remaining
  );
exception
  when others then
    insert into pg_temp._p9_cs_results values (16, 'authenticated nao executa delete', 'HARNESS_ERROR', 'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null, 'scenario rolled back');
end;
$scenario_16$;

-- --------------------------------------------------------------------------
-- Cenario 17: service_role DML completo.
-- --------------------------------------------------------------------------

do $scenario_17$
declare
  v_fixture pg_temp._p9_cs_fixtures%rowtype;
  v_id uuid := gen_random_uuid();
  v_insert record;
  v_select record;
  v_update record;
  v_delete record;
  v_remaining integer;
begin
  if (select harness_preflight from pg_temp._p9_cs_context) <> 'PASS' then
    insert into pg_temp._p9_cs_results values (17, 'service_role possui DML completo', 'HARNESS_ERROR', 'harness preflight did not pass', null, null, 'scenario not executed');
    return;
  end if;

  select * into v_fixture from pg_temp._p9_cs_fixtures where fixture_number = 16;
  if v_fixture.conversation_id is null then
    insert into pg_temp._p9_cs_results values (17, 'service_role possui DML completo', 'BLOCKED_BY_FIXTURE_PREREQUISITE', 'fixture 16 is unavailable', null, null, 'no DML test executed');
    return;
  end if;

  if not pg_temp._p9_fixture_is_still_safe(16) then
    insert into pg_temp._p9_cs_results values (17, (select scenario_name from pg_temp._p9_cs_matrix where scenario_number = 17), 'HARNESS_ERROR', 'selected fixture changed after setup or acquired an active session', null, null, 'fixture was revalidated immediately before the first write');
    return;
  end if;

  insert into pg_temp._p9_cs_created_ids values (v_id, 17, 'service_role full DML fixture');

  select * into v_insert from pg_temp._p9_exec_dml(
    'service_role', null,
    pg_catalog.format(
      'insert into public.conversation_sessions (id, organization_id, store_id, conversation_id) values (%L, %L, %L, %L)',
      v_id, v_fixture.organization_id, v_fixture.store_id, v_fixture.conversation_id
    )
  );

  select * into v_select from pg_temp._p9_exec_scalar(
    'service_role', null,
    pg_catalog.format('select count(*)::text from public.conversation_sessions where id = %L', v_id)
  );

  select * into v_update from pg_temp._p9_exec_dml(
    'service_role', null,
    pg_catalog.format('update public.conversation_sessions set status = ''closed'' where id = %L', v_id)
  );

  select * into v_delete from pg_temp._p9_exec_dml(
    'service_role', null,
    pg_catalog.format('delete from public.conversation_sessions where id = %L', v_id)
  );

  if v_insert.harness_error is not null or v_select.harness_error is not null or v_update.harness_error is not null or v_delete.harness_error is not null
     or not v_insert.identity_clean or not v_select.identity_clean or not v_update.identity_clean or not v_delete.identity_clean then
    insert into pg_temp._p9_cs_results values (
      17,
      'service_role possui DML completo',
      'HARNESS_ERROR',
      coalesce(v_insert.harness_error, v_select.harness_error, v_update.harness_error, v_delete.harness_error, 'identity was not restored during DML sequence'),
      coalesce(v_insert.returned_sqlstate, v_select.returned_sqlstate, v_update.returned_sqlstate, v_delete.returned_sqlstate),
      coalesce(v_insert.constraint_name, v_select.constraint_name, v_update.constraint_name, v_delete.constraint_name),
      'runner identity check failed'
    );
    return;
  end if;

  select count(*) into v_remaining from public.conversation_sessions where id = v_id;

  insert into pg_temp._p9_cs_results values (
    17,
    'service_role possui DML completo',
    case
      when v_insert.operation_succeeded and v_insert.affected_rows = 1
       and v_select.operation_succeeded and v_select.value_text = '1'
       and v_update.operation_succeeded and v_update.affected_rows = 1
       and v_delete.operation_succeeded and v_delete.affected_rows = 1
       and v_remaining = 0 then 'PASS'
      else 'SUT_FAIL'
    end,
    case
      when v_insert.operation_succeeded and v_insert.affected_rows = 1
       and v_select.operation_succeeded and v_select.value_text = '1'
       and v_update.operation_succeeded and v_update.affected_rows = 1
       and v_delete.operation_succeeded and v_delete.affected_rows = 1
       and v_remaining = 0
        then 'service_role completed INSERT SELECT UPDATE DELETE and left no row'
      else 'one or more service_role DML operations failed'
    end,
    coalesce(v_insert.returned_sqlstate, v_select.returned_sqlstate, v_update.returned_sqlstate, v_delete.returned_sqlstate),
    coalesce(v_insert.constraint_name, v_select.constraint_name, v_update.constraint_name, v_delete.constraint_name),
    pg_catalog.format('insert=%s | select=%s | update=%s | delete=%s | remaining=%s', v_insert.affected_rows, coalesce(v_select.value_text, '<null>'), v_update.affected_rows, v_delete.affected_rows, v_remaining)
  );
exception
  when others then
    insert into pg_temp._p9_cs_results values (17, 'service_role possui DML completo', 'HARNESS_ERROR', 'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null, 'scenario rolled back');
end;
$scenario_17$;

-- --------------------------------------------------------------------------
-- Cenario 19: lead sem loja. Executa quando uma fixture real segura existir;
-- caso contrario, registra bloqueio objetivo sem fabricar dados permanentes.
-- --------------------------------------------------------------------------

do $scenario_19$
declare
  v_conversation uuid;
  v_org uuid;
  v_store uuid;
  v_id uuid := gen_random_uuid();
  v_exec record;
  v_remaining integer;
  v_no_store_count integer;
begin
  if (select harness_preflight from pg_temp._p9_cs_context) <> 'PASS' then
    insert into pg_temp._p9_cs_results values (19, 'lead sem loja e rejeitado', 'HARNESS_ERROR', 'harness preflight did not pass', null, null, 'scenario not executed');
    return;
  end if;

  select lead_without_store_count into v_no_store_count from pg_temp._p9_cs_context;

  if v_no_store_count = 0 then
    insert into pg_temp._p9_cs_results values (
      19,
      'lead sem loja e rejeitado',
      'BLOCKED_BY_FIXTURE_PREREQUISITE',
      'no safe existing lead-without-store fixture; count=0',
      null,
      null,
      'no permanent fixture was created or modified'
    );
    return;
  end if;

  select
    c.id,
    c.organization_id,
    store_candidate.id
  into
    v_conversation,
    v_org,
    v_store
  from public.conversations c
  join public.leads l
    on l.id = c.lead_id
   and l.organization_id = c.organization_id
  join lateral (
    select s.id
    from public.stores s
    where s.organization_id = c.organization_id
    order by s.id
    limit 1
  ) store_candidate on true
  where l.store_id is null
  order by c.organization_id, c.id
  limit 1;

  if v_conversation is null or v_org is null or v_store is null then
    insert into pg_temp._p9_cs_results values (
      19,
      'lead sem loja e rejeitado',
      'BLOCKED_BY_FIXTURE_PREREQUISITE',
      'lead-without-store exists but no safe same-organization store is available',
      null,
      null,
      'no write attempted'
    );
    return;
  end if;

  insert into pg_temp._p9_cs_created_ids values (v_id, 19, 'lead-without-store attempt');

  select * into v_exec from pg_temp._p9_exec_dml(
    'service_role', null,
    pg_catalog.format(
      'insert into public.conversation_sessions (id, organization_id, store_id, conversation_id) values (%L, %L, %L, %L)',
      v_id, v_org, v_store, v_conversation
    )
  );

  if v_exec.harness_error is not null or not v_exec.identity_clean then
    insert into pg_temp._p9_cs_results values (19, 'lead sem loja e rejeitado', 'HARNESS_ERROR', coalesce(v_exec.harness_error, 'identity was not restored'), v_exec.returned_sqlstate, v_exec.constraint_name, 'runner identity check failed');
    return;
  end if;

  select count(*) into v_remaining from public.conversation_sessions where id = v_id;

  insert into pg_temp._p9_cs_results values (
    19,
    'lead sem loja e rejeitado',
    case
      when not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '23514'
       and v_exec.message_text = 'conversation session relation mismatch'
       and v_remaining = 0 then 'PASS'
      else 'SUT_FAIL'
    end,
    case
      when not v_exec.operation_succeeded
       and v_exec.returned_sqlstate = '23514'
       and v_exec.message_text = 'conversation session relation mismatch'
       and v_remaining = 0
        then 'lead-without-store was rejected by the generic relation guard'
      else 'lead-without-store was accepted or rejected by an unexpected cause'
    end,
    v_exec.returned_sqlstate,
    v_exec.constraint_name,
    'attempted row remaining=' || v_remaining
  );
exception
  when others then
    insert into pg_temp._p9_cs_results values (19, 'lead sem loja e rejeitado', 'HARNESS_ERROR', 'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null, 'scenario rolled back');
end;
$scenario_19$;

-- --------------------------------------------------------------------------
-- Cenario 18: cleanup, sempre por ultimo.
-- --------------------------------------------------------------------------

do $scenario_18$
declare
  v_deleted bigint := 0;
  v_remaining integer := 0;
begin
  begin execute 'reset role'; exception when others then null; end;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);

  if not pg_temp._p9_identity_is_clean() then
    update pg_temp._p9_cs_context set cleanup_status = 'CLEANUP_FAILURE';
    insert into pg_temp._p9_cs_results values (
      18,
      'cleanup total dos registros do runner',
      'CLEANUP_FAILURE',
      'identity could not be restored before cleanup',
      null,
      null,
      'cleanup did not run under postgres'
    );
    return;
  end if;

  delete from public.conversation_sessions session_to_clean
  using pg_temp._p9_cs_created_ids runner_id
  where session_to_clean.id = runner_id.id;

  get diagnostics v_deleted = row_count;

  select count(*)
  into v_remaining
  from public.conversation_sessions remaining_session
  join pg_temp._p9_cs_created_ids runner_id
    on runner_id.id = remaining_session.id;

  update pg_temp._p9_cs_context
  set cleanup_status = case when v_remaining = 0 then 'PASS' else 'CLEANUP_FAILURE' end;

  insert into pg_temp._p9_cs_results values (
    18,
    'cleanup total dos registros do runner',
    case when v_remaining = 0 then 'PASS' else 'CLEANUP_FAILURE' end,
    case
      when v_remaining = 0 then 'all runner-created conversation_sessions were removed'
      else 'runner cleanup left residual conversation_sessions rows'
    end,
    null,
    null,
    pg_catalog.format('tracked_ids=%s | deleted_rows=%s | remaining_rows=%s', (select count(*) from pg_temp._p9_cs_created_ids), v_deleted, v_remaining)
  );
exception
  when others then
    begin execute 'reset role'; exception when others then null; end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);

    update pg_temp._p9_cs_context set cleanup_status = 'CLEANUP_FAILURE';

    insert into pg_temp._p9_cs_results values (
      18,
      'cleanup total dos registros do runner',
      'CLEANUP_FAILURE',
      'cleanup error: ' || sqlstate || ': ' || sqlerrm,
      sqlstate,
      null,
      'cleanup exception was captured'
    );
end;
$scenario_18$;

-- Garante exatamente um resultado por cenario sem esconder colisao.
insert into pg_temp._p9_cs_results (
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
  case
    when matrix.scenario_number = 18 then 'CLEANUP_FAILURE'
    else 'HARNESS_ERROR'
  end,
  'runner did not emit a result for this scenario',
  null,
  null,
  'missing scenario result was synthesized by the final integrity check'
from pg_temp._p9_cs_matrix matrix
where not exists (
  select 1
  from pg_temp._p9_cs_results result
  where result.scenario_number = matrix.scenario_number
);

-- --------------------------------------------------------------------------
-- Barreira final de segurança.
-- Se o cleanup não comprovou zero resíduos, a transação inteira é abortada.
-- Nesse caso o SQL Editor exibirá erro e nenhuma fixture do runner será
-- persistida, mesmo que o próprio cleanup tenha falhado parcialmente.
-- --------------------------------------------------------------------------

do $final_cleanup_safety$
declare
  v_cleanup_status text;
  v_remaining integer;
begin
  select cleanup_status
  into v_cleanup_status
  from pg_temp._p9_cs_context;

  select count(*)
  into v_remaining
  from public.conversation_sessions remaining_session
  join pg_temp._p9_cs_created_ids runner_id
    on runner_id.id = remaining_session.id;

  if v_cleanup_status <> 'PASS' or v_remaining <> 0 then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'runner cleanup safety gate failed; transaction will be rolled back (status=%s, remaining=%s)',
        coalesce(v_cleanup_status, '<null>'),
        v_remaining
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
    count(*) filter (where status = 'CLEANUP_FAILURE') as total_cleanup_failure,
    case
      when count(*) <> 19 then 'HARNESS_ERROR'
      when count(*) filter (where status = 'CLEANUP_FAILURE') > 0 then 'CLEANUP_FAILURE'
      when count(*) filter (where status = 'HARNESS_ERROR') > 0 then 'HARNESS_ERROR'
      when count(*) filter (where status = 'SUT_FAIL') > 0 then 'SUT_FAIL'
      when count(*) filter (where status = 'BLOCKED_BY_FIXTURE_PREREQUISITE') > 0 then 'BLOCKED_BY_FIXTURE_PREREQUISITE'
      else 'APROVADA'
    end as final_status
  from pg_temp._p9_cs_results
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
    null::bigint as total_cleanup_failure,
    null::text as cleanup_status,
    null::text as harness_preflight,
    null::text as fixture_inventory,
    null::text as object_fingerprint,
    null::text as final_status
  from pg_temp._p9_cs_results result
  join pg_temp._p9_cs_matrix matrix
    on matrix.scenario_number = result.scenario_number

  union all

  select
    'SUMMARY',
    null,
    'runner summary',
    '19-scenario approval contract',
    'postgres controller',
    'classification with cleanup priority',
    summary.final_status,
    pg_catalog.format(
      'scenario_count=%s | pass=%s | sut_fail=%s | harness_error=%s | blocked=%s | cleanup_failure=%s | final_status=%s',
      summary.scenario_count,
      summary.total_pass,
      summary.total_sut_fail,
      summary.total_harness_error,
      summary.total_blocked,
      summary.total_cleanup_failure,
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
    summary.total_cleanup_failure,
    context.cleanup_status,
    context.harness_preflight,
    context.inventory_text,
    context.object_fingerprint,
    summary.final_status
  from summary
  cross join pg_temp._p9_cs_context context
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
  total_cleanup_failure,
  cleanup_status,
  harness_preflight,
  fixture_inventory,
  object_fingerprint,
  final_status
from report
order by
  case when row_type = 'SCENARIO' then 0 else 1 end,
  scenario_number nulls last;

-- ZION / Pilar 9 / Fase 4 / 4.1A-2
-- Runner V1 de validacao estrutural e funcional de public.lead_customer_links.
--
-- REGRAS DE SEGURANCA:
-- - executar o arquivo inteiro uma unica vez no SQL Editor do Supabase;
-- - nao altera leads, organizations, stores, memberships ou auth.users;
-- - cria somente customers/identities/store-links temporarios, com UUIDs da execucao;
-- - escreve em lead_customer_links somente por funcoes controladas, exceto probes
--   negativos executados sob papeis sem grant e probes de trigger sob postgres;
-- - todas as fixtures sao removidas antes do COMMIT;
-- - falha de cleanup aborta a transacao inteira;
-- - exatamente 22 cenarios e uma linha SUMMARY sao emitidos ao final.

begin;

set local lock_timeout = '3s';
set local statement_timeout = '240s';
set local idle_in_transaction_session_timeout = '240s';
set local search_path = pg_catalog, pg_temp, public, extensions;

-- --------------------------------------------------------------------------
-- Objetos temporarios.
-- --------------------------------------------------------------------------

drop table if exists pg_temp._p9_lcl_results;
drop table if exists pg_temp._p9_lcl_matrix;
drop table if exists pg_temp._p9_lcl_context;
drop table if exists pg_temp._p9_lcl_leads;
drop table if exists pg_temp._p9_lcl_customers;
drop table if exists pg_temp._p9_lcl_state;

create temp table _p9_lcl_results (
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

create temp table _p9_lcl_matrix (
  scenario_number integer primary key,
  scenario_name text not null,
  coverage_rule text not null,
  test_role text not null,
  expected_outcome text not null
) on commit preserve rows;

create temp table _p9_lcl_context (
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
  safe_lead_count integer not null default 0,
  selected_lead_count integer not null default 0,
  inventory_text text not null default '',
  object_fingerprint text not null default ''
) on commit preserve rows;

create temp table _p9_lcl_leads (
  fixture_number integer primary key,
  lead_id uuid not null unique,
  organization_id uuid not null,
  store_id uuid not null
) on commit preserve rows;

create temp table _p9_lcl_customers (
  fixture_number integer primary key,
  customer_id uuid not null unique,
  customer_store_link_id uuid not null unique,
  identity_id uuid not null unique,
  normalized_identity text not null unique,
  merged_into_customer_id uuid null
) on commit preserve rows;

create temp table _p9_lcl_state (
  state_key text primary key,
  value_uuid uuid null,
  value_text text null
) on commit preserve rows;

insert into _p9_lcl_context (run_id) values (gen_random_uuid());

insert into _p9_lcl_matrix (
  scenario_number, scenario_name, coverage_rule, test_role, expected_outcome
) values
  (1,  'estrutura e hardening encontrados', 'tabela, colunas, constraints, indices, RLS, grants, funcoes e triggers', 'postgres', 'contrato estrutural completo'),
  (2,  'normalizacao WhatsApp brasileira', '11 digitos, 13 digitos com 55 e entrada invalida', 'postgres', 'normalizacao canonica e erro 22023'),
  (3,  'fronteiras de permissao das funcoes', 'service_role executa; authenticated e anon nao executam', 'authenticated/service_role', 'grants coerentes e erro 42501'),
  (4,  'criacao humana valida', 'vinculo ativo com identidade WhatsApp e ator humano preservado', 'service_role', 'uma linha ativa correta'),
  (5,  'repeticao idempotente retorna a mesma linha', 'mesma chave e mesmos argumentos nao duplicam', 'service_role', 'mesmo id e uma linha'),
  (6,  'conflito de idempotencia e rejeitado', 'mesma chave com relacao diferente', 'service_role', '23505 generico'),
  (7,  'segundo vinculo ativo e rejeitado', 'uma ligacao ativa por lead', 'service_role', '23505 generico'),
  (8,  'fonte WhatsApp exige identidade', 'whatsapp_identity sem source_identity_id', 'service_role', '23514 generico'),
  (9,  'identidade de outro customer e rejeitada', 'source_identity deve pertencer ao customer e organizacao', 'service_role', '23514 generico'),
  (10, 'customer fundido e rejeitado', 'merged_into_customer_id bloqueia novo vinculo', 'service_role', '23514 generico'),
  (11, 'contrato de ator e aplicado', 'human exige user_id e nao-human proibe user_id', 'service_role', '22023 nos dois casos'),
  (12, 'encerramento valido preserva auditoria', 'active para inactive com motivo e metadata', 'service_role', 'linha encerrada corretamente'),
  (13, 'encerramento repetido e imutavel', 'mesmo motivo e idempotente; motivo diferente e rejeitado', 'service_role', 'mesmo id e P0001'),
  (14, 'substituicao atomica valida', 'encerra antigo e cria novo com cadeia replaces_link_id', 'service_role', 'um antigo inactive e um novo active'),
  (15, 'repeticao da substituicao retorna a mesma linha', 'retry da mesma correcao nao duplica', 'service_role', 'mesmo replacement id'),
  (16, 'conflito de substituicao e rejeitado', 'mesmo vinculo antigo com customer diferente', 'service_role', '23505 generico'),
  (17, 'substituicao pelo mesmo customer e rejeitada', 'customer novo deve diferir do atual', 'service_role', '22023'),
  (18, 'escrita direta permanece bloqueada', 'authenticated e service_role sem INSERT UPDATE DELETE direto', 'authenticated/service_role', '42501 e nenhuma mutacao'),
  (19, 'RLS isola leitura por membership', 'membro ve a linha e usuario externo ve zero', 'authenticated', '1 para membro e 0 para externo'),
  (20, 'trigger protege campos e historico inactive', 'campos centrais imutaveis e inactive totalmente imutavel', 'postgres', 'P0001 e estado preservado'),
  (21, 'autoria humana usa FK RESTRICT', 'FKs para auth.users nao permitem apagar a referencia historica', 'postgres', 'confdeltype r e CHECK estrito'),
  (22, 'cleanup total das fixtures do runner', 'zero links, identidades, store-links e customers residuais', 'postgres', 'zero residuos');

-- --------------------------------------------------------------------------
-- Helpers de execucao sob papel testado.
-- --------------------------------------------------------------------------

create or replace function pg_temp._p9_lcl_identity_is_clean()
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

revoke all on function pg_temp._p9_lcl_identity_is_clean() from public;

create or replace function pg_temp._p9_lcl_exec_dml(
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
  v_clean boolean := false;
  v_harness text;
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
  v_clean := pg_temp._p9_lcl_identity_is_clean();

  return query select v_ok, v_rows, v_state, v_message, v_detail, v_hint,
    v_constraint, v_clean, v_harness;
exception
  when others then
    begin execute 'reset role'; exception when others then null; end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    return query select false, 0::bigint, null::text, null::text, null::text,
      null::text, null::text, pg_temp._p9_lcl_identity_is_clean(),
      ('helper internal error: ' || sqlstate || ': ' || sqlerrm)::text;
end;
$function$;

revoke all on function pg_temp._p9_lcl_exec_dml(text, uuid, text) from public;

create or replace function pg_temp._p9_lcl_exec_scalar(
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
  v_clean boolean := false;
  v_harness text;
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
  v_clean := pg_temp._p9_lcl_identity_is_clean();

  return query select v_ok, v_value, v_state, v_message, v_detail, v_hint,
    v_constraint, v_clean, v_harness;
exception
  when others then
    begin execute 'reset role'; exception when others then null; end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    return query select false, null::text, null::text, null::text, null::text,
      null::text, null::text, pg_temp._p9_lcl_identity_is_clean(),
      ('helper internal error: ' || sqlstate || ': ' || sqlerrm)::text;
end;
$function$;

revoke all on function pg_temp._p9_lcl_exec_scalar(text, uuid, text) from public;

-- --------------------------------------------------------------------------
-- Setup: escolhe leads seguros e cria apenas fixtures canonicas temporarias.
-- --------------------------------------------------------------------------

do $setup$
declare
  v_lock boolean := false;
  v_run uuid;
  v_org uuid;
  v_store uuid;
  v_member uuid;
  v_external uuid;
  v_safe_count integer := 0;
  v_selected integer := 0;
  v_c1 uuid := gen_random_uuid();
  v_c2 uuid := gen_random_uuid();
  v_c3 uuid := gen_random_uuid();
  v_c4 uuid := gen_random_uuid();
  v_sl1 uuid := gen_random_uuid();
  v_sl2 uuid := gen_random_uuid();
  v_sl3 uuid := gen_random_uuid();
  v_sl4 uuid := gen_random_uuid();
  v_i1 uuid := gen_random_uuid();
  v_i2 uuid := gen_random_uuid();
  v_i3 uuid := gen_random_uuid();
  v_i4 uuid := gen_random_uuid();
  v_n1 text;
  v_n2 text;
  v_n3 text;
  v_n4 text;
  v_candidate text;
  v_fingerprint text;
begin
  select run_id into v_run from pg_temp._p9_lcl_context;

  select pg_try_advisory_xact_lock(
    hashtextextended('zion:p9:lead_customer_links:runner', 0)
  ) into v_lock;

  if not v_lock then
    update pg_temp._p9_lcl_context
    set setup_status = 'HARNESS_ERROR',
        setup_detail = 'another lead_customer_links runner holds the advisory lock';
    return;
  end if;

  if current_user <> 'postgres' or session_user <> 'postgres' then
    update pg_temp._p9_lcl_context
    set setup_status = 'HARNESS_ERROR',
        setup_detail = 'runner must start as postgres';
    return;
  end if;

  with candidates as (
    select l.organization_id, l.store_id, count(*) as safe_count
    from public.leads l
    join public.stores s
      on s.id = l.store_id
     and s.organization_id = l.organization_id
    where l.organization_id is not null
      and l.store_id is not null
      and not exists (
        select 1
        from public.lead_customer_links existing_link
        where existing_link.organization_id = l.organization_id
          and existing_link.store_id = l.store_id
          and existing_link.lead_id = l.id
      )
    group by l.organization_id, l.store_id
  )
  select organization_id, store_id, safe_count
  into v_org, v_store, v_safe_count
  from candidates
  order by safe_count desc, organization_id, store_id
  limit 1;

  if v_org is null or v_store is null then
    update pg_temp._p9_lcl_context
    set setup_status = 'HARNESS_ERROR',
        setup_detail = 'no safe lead fixture with organization and store is available';
    return;
  end if;

  insert into pg_temp._p9_lcl_leads (
    fixture_number, lead_id, organization_id, store_id
  )
  select
    row_number() over (order by l.id)::integer,
    l.id,
    l.organization_id,
    l.store_id
  from public.leads l
  where l.organization_id = v_org
    and l.store_id = v_store
    and not exists (
      select 1
      from public.lead_customer_links existing_link
      where existing_link.organization_id = l.organization_id
        and existing_link.store_id = l.store_id
        and existing_link.lead_id = l.id
    )
  order by l.id
  limit 7;

  select count(*) into v_selected from pg_temp._p9_lcl_leads;

  select m.user_id into v_member
  from public.memberships m
  where m.organization_id = v_org
    and m.user_id is not null
  order by m.created_at, m.user_id
  limit 1;

  select m.user_id into v_external
  from public.memberships m
  where m.user_id is not null
    and not exists (
      select 1
      from public.memberships target_membership
      where target_membership.organization_id = v_org
        and target_membership.user_id = m.user_id
    )
  order by m.created_at, m.user_id
  limit 1;

  -- Gera quatro identidades 55 + 11 digitos, sem colisao com dados existentes.
  loop
    v_candidate := '55' || right(
      '12345678901' || regexp_replace(gen_random_uuid()::text, '[^0-9]', '', 'g'),
      11
    );
    exit when not exists (
      select 1 from public.customer_channel_identities
      where organization_id = v_org
        and channel = 'whatsapp'
        and normalized_external_identity = v_candidate
    );
  end loop;
  v_n1 := v_candidate;

  loop
    v_candidate := '55' || right(
      '23456789012' || regexp_replace(gen_random_uuid()::text, '[^0-9]', '', 'g'),
      11
    );
    exit when v_candidate <> v_n1
      and not exists (
        select 1 from public.customer_channel_identities
        where organization_id = v_org
          and channel = 'whatsapp'
          and normalized_external_identity = v_candidate
      );
  end loop;
  v_n2 := v_candidate;

  loop
    v_candidate := '55' || right(
      '34567890123' || regexp_replace(gen_random_uuid()::text, '[^0-9]', '', 'g'),
      11
    );
    exit when v_candidate not in (v_n1, v_n2)
      and not exists (
        select 1 from public.customer_channel_identities
        where organization_id = v_org
          and channel = 'whatsapp'
          and normalized_external_identity = v_candidate
      );
  end loop;
  v_n3 := v_candidate;

  loop
    v_candidate := '55' || right(
      '45678901234' || regexp_replace(gen_random_uuid()::text, '[^0-9]', '', 'g'),
      11
    );
    exit when v_candidate not in (v_n1, v_n2, v_n3)
      and not exists (
        select 1 from public.customer_channel_identities
        where organization_id = v_org
          and channel = 'whatsapp'
          and normalized_external_identity = v_candidate
      );
  end loop;
  v_n4 := v_candidate;

  insert into public.customers (
    id, organization_id, display_name, normalized_name
  ) values
    (v_c1, v_org, 'Runner Customer 1 ' || v_run::text, 'runner customer 1 ' || v_run::text),
    (v_c2, v_org, 'Runner Customer 2 ' || v_run::text, 'runner customer 2 ' || v_run::text),
    (v_c3, v_org, 'Runner Customer 3 ' || v_run::text, 'runner customer 3 ' || v_run::text);

  insert into public.customers (
    id, organization_id, display_name, normalized_name, merged_into_customer_id
  ) values (
    v_c4, v_org, 'Runner Customer Merged ' || v_run::text,
    'runner customer merged ' || v_run::text, v_c1
  );

  insert into public.customer_store_links (
    id, organization_id, store_id, customer_id
  ) values
    (v_sl1, v_org, v_store, v_c1),
    (v_sl2, v_org, v_store, v_c2),
    (v_sl3, v_org, v_store, v_c3),
    (v_sl4, v_org, v_store, v_c4);

  insert into public.customer_channel_identities (
    id, organization_id, customer_id, channel,
    external_identity, normalized_external_identity, is_primary
  ) values
    (v_i1, v_org, v_c1, 'whatsapp', v_n1, v_n1, true),
    (v_i2, v_org, v_c2, 'whatsapp', v_n2, v_n2, true),
    (v_i3, v_org, v_c3, 'whatsapp', v_n3, v_n3, true),
    (v_i4, v_org, v_c4, 'whatsapp', v_n4, v_n4, true);

  insert into pg_temp._p9_lcl_customers (
    fixture_number, customer_id, customer_store_link_id,
    identity_id, normalized_identity, merged_into_customer_id
  ) values
    (1, v_c1, v_sl1, v_i1, v_n1, null),
    (2, v_c2, v_sl2, v_i2, v_n2, null),
    (3, v_c3, v_sl3, v_i3, v_n3, null),
    (4, v_c4, v_sl4, v_i4, v_n4, v_c1);

  with fingerprint_parts as (
    select 'function'::text as object_type,
      n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as object_name,
      pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'normalize_br_whatsapp_identity',
        'lead_customer_link_request_role',
        'enforce_lead_customer_link_write_rules',
        'link_lead_to_customer',
        'close_lead_customer_link',
        'replace_lead_customer_link'
      )
    union all
    select 'constraint', con.conname, pg_get_constraintdef(con.oid, true)
    from pg_constraint con
    where con.conrelid = 'public.lead_customer_links'::regclass
    union all
    select 'index', indexname, indexdef
    from pg_indexes
    where schemaname = 'public' and tablename = 'lead_customer_links'
    union all
    select 'policy', policyname,
      coalesce(qual, '') || '|' || coalesce(with_check, '') || '|' || cmd || '|' || roles::text
    from pg_policies
    where schemaname = 'public' and tablename = 'lead_customer_links'
  )
  select md5(string_agg(object_type || ':' || object_name || ':' || definition,
                        E'\n' order by object_type, object_name))
  into v_fingerprint
  from fingerprint_parts;

  update pg_temp._p9_lcl_context
  set setup_status = 'PASS',
      setup_detail = 'safe leads selected and canonical temporary fixtures created',
      organization_id = v_org,
      store_id = v_store,
      member_user_id = v_member,
      external_user_id = v_external,
      safe_lead_count = v_safe_count,
      selected_lead_count = v_selected,
      inventory_text = format(
        'safe_leads=%s | selected_leads=%s | member_user=%s | external_user=%s | fixture_customers=4',
        v_safe_count, v_selected,
        case when v_member is null then 'missing' else 'present' end,
        case when v_external is null then 'missing' else 'present' end
      ),
      object_fingerprint = coalesce(v_fingerprint, '<missing>');
exception
  when others then
    begin execute 'reset role'; exception when others then null; end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    update pg_temp._p9_lcl_context
    set setup_status = 'HARNESS_ERROR',
        setup_detail = 'setup failed with ' || sqlstate || ': ' || sqlerrm;
end;
$setup$;

-- --------------------------------------------------------------------------
-- Preflight do harness.
-- --------------------------------------------------------------------------

do $preflight$
declare
  v_exec record;
  v_setup text;
begin
  select setup_status into v_setup from pg_temp._p9_lcl_context;

  if v_setup <> 'PASS' then
    update pg_temp._p9_lcl_context
    set harness_preflight = 'HARNESS_ERROR',
        harness_detail = 'setup did not pass: ' || setup_detail;
    return;
  end if;

  select * into v_exec
  from pg_temp._p9_lcl_exec_scalar(
    'authenticated', gen_random_uuid(), 'select (1 / 0)::text'
  );

  if v_exec.harness_error is not null
     or not v_exec.identity_clean
     or v_exec.operation_succeeded
     or v_exec.returned_sqlstate <> '22012' then
    update pg_temp._p9_lcl_context
    set harness_preflight = 'HARNESS_ERROR',
        harness_detail = format(
          'error capture or identity restoration failed | succeeded=%s | sqlstate=%s | clean=%s | helper=%s',
          v_exec.operation_succeeded, v_exec.returned_sqlstate,
          v_exec.identity_clean, coalesce(v_exec.harness_error, '<none>')
        );
    return;
  end if;

  update pg_temp._p9_lcl_context
  set harness_preflight = 'PASS',
      harness_detail = 'role switch, expected-error capture and identity restoration passed';
exception
  when others then
    begin execute 'reset role'; exception when others then null; end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    update pg_temp._p9_lcl_context
    set harness_preflight = 'HARNESS_ERROR',
        harness_detail = 'preflight failed with ' || sqlstate || ': ' || sqlerrm;
end;
$preflight$;

-- --------------------------------------------------------------------------
-- Cenario 1: estrutura e hardening.
-- --------------------------------------------------------------------------

do $scenario_1$
declare
  v_ok boolean := false;
begin
  if (select harness_preflight from pg_temp._p9_lcl_context) <> 'PASS' then
    insert into pg_temp._p9_lcl_results values
      (1, 'estrutura e hardening encontrados', 'HARNESS_ERROR',
       'harness preflight did not pass', null, null, 'scenario not executed');
    return;
  end if;

  select
    to_regclass('public.lead_customer_links') is not null
    and (select count(*) = 23 from information_schema.columns
         where table_schema = 'public' and table_name = 'lead_customer_links')
    and exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'lead_customer_links'
        and c.relrowsecurity and not c.relforcerowsecurity
    )
    and (
      select count(*) = 21 from pg_constraint
      where conrelid = 'public.lead_customer_links'::regclass
    )
    and (
      select count(*) = 21 from pg_constraint
      where conrelid = 'public.lead_customer_links'::regclass
        and conname in (
          'lead_customer_links_pkey',
          'lead_customer_links_organization_fkey',
          'lead_customer_links_store_org_fkey',
          'lead_customer_links_lead_org_store_fkey',
          'lead_customer_links_customer_org_fkey',
          'lead_customer_links_customer_store_fkey',
          'lead_customer_links_source_identity_fkey',
          'lead_customer_links_linked_by_user_fkey',
          'lead_customer_links_unlinked_by_user_fkey',
          'lead_customer_links_replaces_same_lead_fkey',
          'lead_customer_links_status_check',
          'lead_customer_links_source_check',
          'lead_customer_links_link_actor_check',
          'lead_customer_links_unlink_state_check',
          'lead_customer_links_source_reference_not_blank',
          'lead_customer_links_idempotency_not_blank',
          'lead_customer_links_unlink_reason_code_format',
          'lead_customer_links_unlink_reason_not_blank',
          'lead_customer_links_metadata_object_check',
          'lead_customer_links_source_identity_required',
          'lead_customer_links_not_replace_self'
        )
    )
    and exists (
      select 1 from pg_constraint
      where conrelid = 'public.lead_customer_links'::regclass
        and conname = 'lead_customer_links_linked_by_user_fkey'
        and contype = 'f' and confdeltype = 'r'
        and confrelid = 'auth.users'::regclass
    )
    and exists (
      select 1 from pg_constraint
      where conrelid = 'public.lead_customer_links'::regclass
        and conname = 'lead_customer_links_unlinked_by_user_fkey'
        and contype = 'f' and confdeltype = 'r'
        and confrelid = 'auth.users'::regclass
    )
    and exists (
      select 1 from pg_constraint
      where conrelid = 'public.lead_customer_links'::regclass
        and conname = 'lead_customer_links_link_actor_check'
        and strpos(lower(pg_get_constraintdef(oid, true)), 'linked_by_user_id is not null') > 0
        and strpos(lower(pg_get_constraintdef(oid, true)), 'linked_by_user_id is null') > 0
    )
    and exists (
      select 1 from pg_constraint
      where conrelid = 'public.lead_customer_links'::regclass
        and conname = 'lead_customer_links_unlink_state_check'
        and strpos(lower(pg_get_constraintdef(oid, true)), 'unlinked_by_user_id is not null') > 0
        and strpos(lower(pg_get_constraintdef(oid, true)), 'unlinked_by_user_id is null') > 0
    )
    and (select count(*) = 9 from pg_indexes
         where schemaname = 'public' and tablename = 'lead_customer_links')
    and (
      select count(*) = 9 from pg_indexes
      where schemaname = 'public' and tablename = 'lead_customer_links'
        and indexname in (
          'lead_customer_links_pkey',
          'lead_customer_links_id_org_store_lead_uidx',
          'lead_customer_links_one_active_per_lead_uidx',
          'lead_customer_links_idempotency_uidx',
          'lead_customer_links_replaces_once_uidx',
          'lead_customer_links_customer_status_idx',
          'lead_customer_links_source_identity_idx',
          'lead_customer_links_correlation_idx',
          'lead_customer_links_lead_history_idx'
        )
    )
    and exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'lead_customer_links'
        and policyname = 'lead_customer_links_select_by_membership'
        and cmd = 'SELECT' and roles = array['authenticated']::name[]
        and strpos(lower(qual), 'memberships') > 0
        and strpos(lower(qual), 'auth.uid()') > 0
    )
    and (select count(*) = 1 from pg_policies
         where schemaname = 'public' and tablename = 'lead_customer_links')
    and has_table_privilege('authenticated', 'public.lead_customer_links', 'SELECT')
    and not has_table_privilege('authenticated', 'public.lead_customer_links', 'INSERT')
    and not has_table_privilege('authenticated', 'public.lead_customer_links', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.lead_customer_links', 'DELETE')
    and has_table_privilege('service_role', 'public.lead_customer_links', 'SELECT')
    and not has_table_privilege('service_role', 'public.lead_customer_links', 'INSERT')
    and not has_table_privilege('service_role', 'public.lead_customer_links', 'UPDATE')
    and not has_table_privilege('service_role', 'public.lead_customer_links', 'DELETE')
    and not has_table_privilege('anon', 'public.lead_customer_links', 'SELECT')
    and exists (
      select 1 from pg_trigger t
      join pg_proc p on p.oid = t.tgfoid
      join pg_namespace n on n.oid = p.pronamespace
      where t.tgrelid = 'public.lead_customer_links'::regclass
        and t.tgname = 'lead_customer_links_enforce_write_rules'
        and not t.tgisinternal and t.tgenabled = 'O'
        and n.nspname = 'public'
        and p.proname = 'enforce_lead_customer_link_write_rules'
    )
    and (
      select count(*) = 6 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'normalize_br_whatsapp_identity',
          'lead_customer_link_request_role',
          'enforce_lead_customer_link_write_rules',
          'link_lead_to_customer',
          'close_lead_customer_link',
          'replace_lead_customer_link'
        )
    )
    and (
      select count(*) = 3 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner
      where n.nspname = 'public'
        and p.proname in (
          'link_lead_to_customer',
          'close_lead_customer_link',
          'replace_lead_customer_link'
        )
        and p.prosecdef and r.rolname = 'postgres'
        and p.proconfig @> array[
          'search_path=pg_catalog, pg_temp', 'row_security=off'
        ]::text[]
        and has_function_privilege('service_role', p.oid, 'EXECUTE')
        and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and not has_function_privilege('anon', p.oid, 'EXECUTE')
    )
  into v_ok;

  insert into pg_temp._p9_lcl_results values (
    1, 'estrutura e hardening encontrados',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    case when v_ok
      then 'structural, security and controlled-function contracts match the approved foundation'
      else 'one or more structural or security predicates differ from the approved contract'
    end,
    null, null,
    '23 columns, 21 constraints, 9 indexes, one SELECT policy, controlled grants and hardened functions checked'
  );
exception
  when others then
    insert into pg_temp._p9_lcl_results values
      (1, 'estrutura e hardening encontrados', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_1$;

-- --------------------------------------------------------------------------
-- Cenario 2: normalizacao.
-- --------------------------------------------------------------------------

do $scenario_2$
declare
  v_11 text;
  v_13 text;
  v_invalid_state text;
  v_invalid_message text;
begin
  select public.normalize_br_whatsapp_identity('(11) 98888-7777') into v_11;
  select public.normalize_br_whatsapp_identity('+55 (11) 98888-7777') into v_13;

  begin
    perform public.normalize_br_whatsapp_identity('1234');
  exception when others then
    get stacked diagnostics
      v_invalid_state = returned_sqlstate,
      v_invalid_message = message_text;
  end;

  insert into pg_temp._p9_lcl_results values (
    2, 'normalizacao WhatsApp brasileira',
    case when v_11 = '5511988887777'
            and v_13 = '5511988887777'
            and v_invalid_state = '22023'
            and v_invalid_message = 'invalid Brazilian WhatsApp identity'
         then 'PASS' else 'SUT_FAIL' end,
    format('11_digits=%s | 13_digits=%s | invalid_sqlstate=%s',
           coalesce(v_11, '<null>'), coalesce(v_13, '<null>'),
           coalesce(v_invalid_state, '<null>')),
    v_invalid_state, null,
    'both accepted formats normalize to 5511988887777 and invalid input is rejected'
  );
exception
  when others then
    insert into pg_temp._p9_lcl_results values
      (2, 'normalizacao WhatsApp brasileira', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_2$;

-- --------------------------------------------------------------------------
-- Cenario 3: grants das funcoes.
-- --------------------------------------------------------------------------

do $scenario_3$
declare
  v_member uuid;
  v_norm text;
  v_exec_auth record;
  v_exec_anon record;
  v_exec_service record;
begin
  select member_user_id into v_member from pg_temp._p9_lcl_context;
  select normalized_identity into v_norm
  from pg_temp._p9_lcl_customers where fixture_number = 1;

  if v_member is null then
    insert into pg_temp._p9_lcl_results values
      (3, 'fronteiras de permissao das funcoes',
       'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'no authenticated membership user is available in the selected organization',
       null, null, 'service_role and catalog grants remain covered by scenario 1');
    return;
  end if;

  select * into v_exec_auth
  from pg_temp._p9_lcl_exec_scalar(
    'authenticated', v_member,
    format('select public.normalize_br_whatsapp_identity(%L)', v_norm)
  );

  select * into v_exec_anon
  from pg_temp._p9_lcl_exec_scalar(
    'anon', null,
    format('select public.normalize_br_whatsapp_identity(%L)', v_norm)
  );

  select * into v_exec_service
  from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format('select public.normalize_br_whatsapp_identity(%L)', v_norm)
  );

  if coalesce(v_exec_auth.harness_error, v_exec_anon.harness_error,
              v_exec_service.harness_error) is not null
     or not v_exec_auth.identity_clean
     or not v_exec_anon.identity_clean
     or not v_exec_service.identity_clean then
    insert into pg_temp._p9_lcl_results values
      (3, 'fronteiras de permissao das funcoes', 'HARNESS_ERROR',
       coalesce(v_exec_auth.harness_error, v_exec_anon.harness_error,
                v_exec_service.harness_error, 'identity was not restored'),
       coalesce(v_exec_auth.returned_sqlstate, v_exec_anon.returned_sqlstate,
                v_exec_service.returned_sqlstate),
       null, 'runner identity check failed');
    return;
  end if;

  insert into pg_temp._p9_lcl_results values (
    3, 'fronteiras de permissao das funcoes',
    case when not v_exec_auth.operation_succeeded
              and v_exec_auth.returned_sqlstate = '42501'
              and not v_exec_anon.operation_succeeded
              and v_exec_anon.returned_sqlstate = '42501'
              and v_exec_service.operation_succeeded
              and v_exec_service.value_text = v_norm
         then 'PASS' else 'SUT_FAIL' end,
    format('authenticated=%s/%s | anon=%s/%s | service_role=%s/%s',
           v_exec_auth.operation_succeeded, coalesce(v_exec_auth.returned_sqlstate, '<none>'),
           v_exec_anon.operation_succeeded, coalesce(v_exec_anon.returned_sqlstate, '<none>'),
           v_exec_service.operation_succeeded, coalesce(v_exec_service.value_text, '<null>')),
    coalesce(v_exec_auth.returned_sqlstate, v_exec_anon.returned_sqlstate),
    null,
    'authenticated and anon receive 42501 while service_role executes normalization'
  );
exception
  when others then
    insert into pg_temp._p9_lcl_results values
      (3, 'fronteiras de permissao das funcoes', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_3$;

-- --------------------------------------------------------------------------
-- Cenario 4: criacao humana valida.
-- --------------------------------------------------------------------------

do $scenario_4$
declare
  v_org uuid; v_store uuid; v_lead uuid; v_customer uuid; v_identity uuid;
  v_member uuid; v_run uuid; v_key text; v_exec record; v_id uuid; v_count integer;
begin
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_lcl_context;
  select lead_id into v_lead from pg_temp._p9_lcl_leads where fixture_number = 1;
  select customer_id, identity_id into v_customer, v_identity
  from pg_temp._p9_lcl_customers where fixture_number = 1;

  if v_lead is null or v_member is null then
    insert into pg_temp._p9_lcl_results values
      (4, 'criacao humana valida', 'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'lead fixture 1 or member user is unavailable', null, null, 'no write attempted');
    return;
  end if;

  v_key := 'runner:' || v_run::text || ':human-link';

  select * into v_exec from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.link_lead_to_customer(
        p_organization_id => %L,
        p_store_id => %L,
        p_lead_id => %L,
        p_customer_id => %L,
        p_source => 'whatsapp_identity',
        p_linked_by_actor_type => 'human',
        p_linked_by_user_id => %L,
        p_source_identity_id => %L,
        p_source_reference => 'runner scenario 4',
        p_idempotency_key => %L,
        p_correlation_id => %L,
        p_metadata => '{"runner":true,"scenario":4}'::jsonb
      )).id::text
    $sql$, v_org, v_store, v_lead, v_customer, v_member, v_identity, v_key, v_run)
  );

  if v_exec.harness_error is not null or not v_exec.identity_clean then
    insert into pg_temp._p9_lcl_results values
      (4, 'criacao humana valida', 'HARNESS_ERROR',
       coalesce(v_exec.harness_error, 'identity was not restored'),
       v_exec.returned_sqlstate, v_exec.constraint_name, 'runner identity check failed');
    return;
  end if;

  if v_exec.operation_succeeded then
    v_id := v_exec.value_text::uuid;
    insert into pg_temp._p9_lcl_state values ('human_link_id', v_id, null)
    on conflict (state_key) do update set value_uuid = excluded.value_uuid;
  end if;

  select count(*) into v_count
  from public.lead_customer_links
  where id = v_id
    and organization_id = v_org and store_id = v_store and lead_id = v_lead
    and customer_id = v_customer and source_identity_id = v_identity
    and status = 'active' and source = 'whatsapp_identity'
    and linked_by_actor_type = 'human' and linked_by_user_id = v_member
    and idempotency_key = v_key and correlation_id = v_run
    and metadata @> '{"runner":true,"scenario":4}'::jsonb;

  insert into pg_temp._p9_lcl_results values (
    4, 'criacao humana valida',
    case when v_exec.operation_succeeded and v_count = 1 then 'PASS' else 'SUT_FAIL' end,
    case when v_exec.operation_succeeded and v_count = 1
      then 'controlled function created one active human-authored WhatsApp link'
      else 'valid human link failed or persisted with unexpected fields: ' || coalesce(v_exec.message_text, '<no message>')
    end,
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'matching_row_count=' || v_count
  );
exception
  when others then
    insert into pg_temp._p9_lcl_results values
      (4, 'criacao humana valida', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_4$;

-- --------------------------------------------------------------------------
-- Cenarios 5 a 7: idempotencia e unicidade ativa.
-- --------------------------------------------------------------------------

do $scenario_5$
declare
  v_org uuid; v_store uuid; v_lead uuid; v_customer uuid; v_identity uuid;
  v_member uuid; v_run uuid; v_key text; v_expected uuid; v_exec record; v_count integer;
begin
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_lcl_context;
  select lead_id into v_lead from pg_temp._p9_lcl_leads where fixture_number = 1;
  select customer_id, identity_id into v_customer, v_identity
  from pg_temp._p9_lcl_customers where fixture_number = 1;
  select value_uuid into v_expected from pg_temp._p9_lcl_state where state_key = 'human_link_id';

  if v_expected is null then
    insert into pg_temp._p9_lcl_results values
      (5, 'repeticao idempotente retorna a mesma linha', 'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'scenario 4 did not create the base link', null, null, 'no retry attempted');
    return;
  end if;

  v_key := 'runner:' || v_run::text || ':human-link';
  select * into v_exec from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.link_lead_to_customer(
        p_organization_id => %L, p_store_id => %L, p_lead_id => %L,
        p_customer_id => %L, p_source => 'whatsapp_identity',
        p_linked_by_actor_type => 'human', p_linked_by_user_id => %L,
        p_source_identity_id => %L, p_source_reference => 'retry scenario 5',
        p_idempotency_key => %L, p_correlation_id => %L,
        p_metadata => '{"runner":true,"scenario":5}'::jsonb
      )).id::text
    $sql$, v_org, v_store, v_lead, v_customer, v_member, v_identity, v_key, v_run)
  );

  select count(*) into v_count from public.lead_customer_links
  where organization_id = v_org and idempotency_key = v_key;

  insert into pg_temp._p9_lcl_results values (
    5, 'repeticao idempotente retorna a mesma linha',
    case when v_exec.operation_succeeded
              and v_exec.value_text::uuid = v_expected and v_count = 1
         then 'PASS' else 'SUT_FAIL' end,
    format('returned_id=%s | expected_id=%s | row_count=%s',
           coalesce(v_exec.value_text, '<null>'), v_expected, v_count),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'same idempotency key returned the original id and left exactly one row'
  );
exception
  when others then
    insert into pg_temp._p9_lcl_results values
      (5, 'repeticao idempotente retorna a mesma linha', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_5$;

do $scenario_6$
declare
  v_org uuid; v_store uuid; v_lead uuid; v_customer uuid; v_identity uuid;
  v_run uuid; v_key text; v_exec record;
begin
  select organization_id, store_id, run_id into v_org, v_store, v_run
  from pg_temp._p9_lcl_context;
  select lead_id into v_lead from pg_temp._p9_lcl_leads where fixture_number = 1;
  select customer_id, identity_id into v_customer, v_identity
  from pg_temp._p9_lcl_customers where fixture_number = 2;
  v_key := 'runner:' || v_run::text || ':human-link';

  select * into v_exec from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.link_lead_to_customer(
        p_organization_id => %L, p_store_id => %L, p_lead_id => %L,
        p_customer_id => %L, p_source => 'whatsapp_identity',
        p_linked_by_actor_type => 'system', p_source_identity_id => %L,
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_lead, v_customer, v_identity, v_key, v_run)
  );

  insert into pg_temp._p9_lcl_results values (
    6, 'conflito de idempotencia e rejeitado',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '23505'
              and v_exec.message_text = 'lead customer link idempotency conflict'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'same key with a different customer must fail with the generic idempotency conflict'
  );
exception
  when others then
    insert into pg_temp._p9_lcl_results values
      (6, 'conflito de idempotencia e rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_6$;

do $scenario_7$
declare
  v_org uuid; v_store uuid; v_lead uuid; v_customer uuid; v_identity uuid;
  v_run uuid; v_exec record; v_active integer;
begin
  select organization_id, store_id, run_id into v_org, v_store, v_run
  from pg_temp._p9_lcl_context;
  select lead_id into v_lead from pg_temp._p9_lcl_leads where fixture_number = 1;
  select customer_id, identity_id into v_customer, v_identity
  from pg_temp._p9_lcl_customers where fixture_number = 2;

  select * into v_exec from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.link_lead_to_customer(
        p_organization_id => %L, p_store_id => %L, p_lead_id => %L,
        p_customer_id => %L, p_source => 'whatsapp_identity',
        p_linked_by_actor_type => 'system', p_source_identity_id => %L,
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_lead, v_customer, v_identity,
           'runner:' || v_run::text || ':duplicate-active', v_run)
  );

  select count(*) into v_active from public.lead_customer_links
  where organization_id = v_org and store_id = v_store and lead_id = v_lead
    and status = 'active';

  insert into pg_temp._p9_lcl_results values (
    7, 'segundo vinculo ativo e rejeitado',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '23505'
              and v_exec.message_text = 'lead already has an active customer link'
              and v_active = 1
         then 'PASS' else 'SUT_FAIL' end,
    format('message=%s | active_count=%s', coalesce(v_exec.message_text, '<none>'), v_active),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'second active request is rejected and exactly one active row remains'
  );
exception
  when others then
    insert into pg_temp._p9_lcl_results values
      (7, 'segundo vinculo ativo e rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_7$;

-- --------------------------------------------------------------------------
-- Cenarios 8 a 11: relacoes e atores invalidos.
-- --------------------------------------------------------------------------

do $scenario_8$
declare
  v_org uuid; v_store uuid; v_lead uuid; v_customer uuid; v_run uuid; v_exec record;
begin
  select organization_id, store_id, run_id into v_org, v_store, v_run
  from pg_temp._p9_lcl_context;
  select lead_id into v_lead from pg_temp._p9_lcl_leads where fixture_number = 2;
  select customer_id into v_customer from pg_temp._p9_lcl_customers where fixture_number = 1;

  if v_lead is null then
    insert into pg_temp._p9_lcl_results values
      (8, 'fonte WhatsApp exige identidade', 'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'lead fixture 2 is unavailable', null, null, 'no write attempted');
    return;
  end if;

  select * into v_exec from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.link_lead_to_customer(
        p_organization_id => %L, p_store_id => %L, p_lead_id => %L,
        p_customer_id => %L, p_source => 'whatsapp_identity',
        p_linked_by_actor_type => 'system',
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_lead, v_customer,
           'runner:' || v_run::text || ':missing-identity', v_run)
  );

  insert into pg_temp._p9_lcl_results values (
    8, 'fonte WhatsApp exige identidade',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '23514'
              and v_exec.message_text = 'lead customer link relation mismatch'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'whatsapp_identity without source_identity_id must fail generically'
  );
exception
  when others then
    insert into pg_temp._p9_lcl_results values
      (8, 'fonte WhatsApp exige identidade', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_8$;

do $scenario_9$
declare
  v_org uuid; v_store uuid; v_lead uuid; v_customer uuid; v_wrong_identity uuid;
  v_run uuid; v_exec record;
begin
  select organization_id, store_id, run_id into v_org, v_store, v_run
  from pg_temp._p9_lcl_context;
  select lead_id into v_lead from pg_temp._p9_lcl_leads where fixture_number = 2;
  select customer_id into v_customer from pg_temp._p9_lcl_customers where fixture_number = 2;
  select identity_id into v_wrong_identity from pg_temp._p9_lcl_customers where fixture_number = 1;

  if v_lead is null then
    insert into pg_temp._p9_lcl_results values
      (9, 'identidade de outro customer e rejeitada', 'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'lead fixture 2 is unavailable', null, null, 'no write attempted');
    return;
  end if;

  select * into v_exec from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.link_lead_to_customer(
        p_organization_id => %L, p_store_id => %L, p_lead_id => %L,
        p_customer_id => %L, p_source => 'whatsapp_identity',
        p_linked_by_actor_type => 'system', p_source_identity_id => %L,
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_lead, v_customer, v_wrong_identity,
           'runner:' || v_run::text || ':wrong-identity', v_run)
  );

  insert into pg_temp._p9_lcl_results values (
    9, 'identidade de outro customer e rejeitada',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '23514'
              and v_exec.message_text = 'lead customer link relation mismatch'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'identity/customer mismatch must fail without exposing relation details'
  );
exception
  when others then
    insert into pg_temp._p9_lcl_results values
      (9, 'identidade de outro customer e rejeitada', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_9$;

do $scenario_10$
declare
  v_org uuid; v_store uuid; v_lead uuid; v_customer uuid; v_identity uuid;
  v_run uuid; v_exec record;
begin
  select organization_id, store_id, run_id into v_org, v_store, v_run
  from pg_temp._p9_lcl_context;
  select lead_id into v_lead from pg_temp._p9_lcl_leads where fixture_number = 2;
  select customer_id, identity_id into v_customer, v_identity
  from pg_temp._p9_lcl_customers where fixture_number = 4;

  if v_lead is null then
    insert into pg_temp._p9_lcl_results values
      (10, 'customer fundido e rejeitado', 'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'lead fixture 2 is unavailable', null, null, 'no write attempted');
    return;
  end if;

  select * into v_exec from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.link_lead_to_customer(
        p_organization_id => %L, p_store_id => %L, p_lead_id => %L,
        p_customer_id => %L, p_source => 'whatsapp_identity',
        p_linked_by_actor_type => 'system', p_source_identity_id => %L,
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_lead, v_customer, v_identity,
           'runner:' || v_run::text || ':merged-customer', v_run)
  );

  insert into pg_temp._p9_lcl_results values (
    10, 'customer fundido e rejeitado',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '23514'
              and v_exec.message_text = 'lead customer link relation mismatch'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'merged customer must not receive a new lead link'
  );
exception
  when others then
    insert into pg_temp._p9_lcl_results values
      (10, 'customer fundido e rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_10$;

do $scenario_11$
declare
  v_org uuid; v_store uuid; v_lead uuid; v_customer uuid; v_member uuid; v_run uuid;
  v_human record; v_system record; v_rows integer;
begin
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_lcl_context;
  select lead_id into v_lead from pg_temp._p9_lcl_leads where fixture_number = 2;
  select customer_id into v_customer from pg_temp._p9_lcl_customers where fixture_number = 1;

  if v_lead is null or v_member is null then
    insert into pg_temp._p9_lcl_results values
      (11, 'contrato de ator e aplicado', 'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'lead fixture 2 or member user is unavailable', null, null, 'no write attempted');
    return;
  end if;

  select * into v_human from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.link_lead_to_customer(
        p_organization_id => %L, p_store_id => %L, p_lead_id => %L,
        p_customer_id => %L, p_source => 'manual',
        p_linked_by_actor_type => 'human', p_linked_by_user_id => null,
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_lead, v_customer,
           'runner:' || v_run::text || ':human-null', v_run)
  );

  select * into v_system from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.link_lead_to_customer(
        p_organization_id => %L, p_store_id => %L, p_lead_id => %L,
        p_customer_id => %L, p_source => 'manual',
        p_linked_by_actor_type => 'system', p_linked_by_user_id => %L,
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_lead, v_customer, v_member,
           'runner:' || v_run::text || ':system-user', v_run)
  );

  select count(*) into v_rows from public.lead_customer_links
  where correlation_id = v_run and lead_id = v_lead;

  insert into pg_temp._p9_lcl_results values (
    11, 'contrato de ator e aplicado',
    case when not v_human.operation_succeeded
              and v_human.returned_sqlstate = '22023'
              and v_human.message_text = 'lead customer link actor is invalid'
              and not v_system.operation_succeeded
              and v_system.returned_sqlstate = '22023'
              and v_system.message_text = 'lead customer link actor is invalid'
              and v_rows = 0
         then 'PASS' else 'SUT_FAIL' end,
    format('human_without_user=%s/%s | system_with_user=%s/%s | rows=%s',
           v_human.operation_succeeded, coalesce(v_human.returned_sqlstate, '<none>'),
           v_system.operation_succeeded, coalesce(v_system.returned_sqlstate, '<none>'),
           v_rows),
    coalesce(v_human.returned_sqlstate, v_system.returned_sqlstate), null,
    'both invalid actor combinations fail with 22023 and create no row'
  );
exception
  when others then
    insert into pg_temp._p9_lcl_results values
      (11, 'contrato de ator e aplicado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_11$;

-- --------------------------------------------------------------------------
-- Cenarios 12 e 13: fechamento.
-- --------------------------------------------------------------------------

do $scenario_12$
declare
  v_org uuid; v_store uuid; v_run uuid; v_link uuid; v_exec record; v_count integer;
begin
  select organization_id, store_id, run_id into v_org, v_store, v_run
  from pg_temp._p9_lcl_context;
  select value_uuid into v_link from pg_temp._p9_lcl_state where state_key = 'human_link_id';

  if v_link is null then
    insert into pg_temp._p9_lcl_results values
      (12, 'encerramento valido preserva auditoria', 'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'scenario 4 base link is unavailable', null, null, 'no close attempted');
    return;
  end if;

  select * into v_exec from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.close_lead_customer_link(
        p_link_id => %L, p_organization_id => %L, p_store_id => %L,
        p_unlinked_by_actor_type => 'system', p_unlinked_by_user_id => null,
        p_unlink_reason_code => 'runner_closed',
        p_unlink_reason => 'runner scenario 12',
        p_metadata => '{"runner":true,"scenario":12}'::jsonb,
        p_correlation_id => %L
      )).id::text
    $sql$, v_link, v_org, v_store, v_run)
  );

  select count(*) into v_count from public.lead_customer_links
  where id = v_link and status = 'inactive' and unlinked_at is not null
    and unlinked_by_actor_type = 'system' and unlinked_by_user_id is null
    and unlink_reason_code = 'runner_closed'
    and unlink_reason = 'runner scenario 12'
    and metadata -> 'unlink' @> '{"runner":true,"scenario":12}'::jsonb;

  insert into pg_temp._p9_lcl_results values (
    12, 'encerramento valido preserva auditoria',
    case when v_exec.operation_succeeded
              and v_exec.value_text::uuid = v_link and v_count = 1
         then 'PASS' else 'SUT_FAIL' end,
    format('returned_id=%s | matching_inactive=%s',
           coalesce(v_exec.value_text, '<null>'), v_count),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'active link becomes inactive with timestamp, actor, reason and unlink metadata'
  );
exception
  when others then
    insert into pg_temp._p9_lcl_results values
      (12, 'encerramento valido preserva auditoria', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_12$;

do $scenario_13$
declare
  v_org uuid; v_store uuid; v_run uuid; v_link uuid;
  v_same record; v_other record; v_reason text;
begin
  select organization_id, store_id, run_id into v_org, v_store, v_run
  from pg_temp._p9_lcl_context;
  select value_uuid into v_link from pg_temp._p9_lcl_state where state_key = 'human_link_id';

  if v_link is null then
    insert into pg_temp._p9_lcl_results values
      (13, 'encerramento repetido e imutavel', 'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'scenario 4 base link is unavailable', null, null, 'no retry attempted');
    return;
  end if;

  select * into v_same from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.close_lead_customer_link(
        p_link_id => %L, p_organization_id => %L, p_store_id => %L,
        p_unlinked_by_actor_type => 'system', p_unlinked_by_user_id => null,
        p_unlink_reason_code => 'runner_closed', p_correlation_id => %L
      )).id::text
    $sql$, v_link, v_org, v_store, v_run)
  );

  select * into v_other from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.close_lead_customer_link(
        p_link_id => %L, p_organization_id => %L, p_store_id => %L,
        p_unlinked_by_actor_type => 'system', p_unlinked_by_user_id => null,
        p_unlink_reason_code => 'different_reason', p_correlation_id => %L
      )).id::text
    $sql$, v_link, v_org, v_store, v_run)
  );

  select unlink_reason_code into v_reason from public.lead_customer_links where id = v_link;

  insert into pg_temp._p9_lcl_results values (
    13, 'encerramento repetido e imutavel',
    case when v_same.operation_succeeded and v_same.value_text::uuid = v_link
              and not v_other.operation_succeeded
              and v_other.returned_sqlstate = 'P0001'
              and v_other.message_text = 'inactive lead customer link is immutable'
              and v_reason = 'runner_closed'
         then 'PASS' else 'SUT_FAIL' end,
    format('same_retry=%s | different_reason=%s/%s | stored_reason=%s',
           v_same.operation_succeeded, v_other.operation_succeeded,
           coalesce(v_other.returned_sqlstate, '<none>'), v_reason),
    v_other.returned_sqlstate, v_other.constraint_name,
    'same reason returns the existing link; different reason cannot rewrite inactive history'
  );
exception
  when others then
    insert into pg_temp._p9_lcl_results values
      (13, 'encerramento repetido e imutavel', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_13$;

-- --------------------------------------------------------------------------
-- Cenarios 14 a 17: substituicao.
-- --------------------------------------------------------------------------

do $scenario_14$
declare
  v_org uuid; v_store uuid; v_lead uuid; v_c1 uuid; v_c2 uuid; v_i2 uuid;
  v_member uuid; v_run uuid; v_old_exec record; v_replace record;
  v_old uuid; v_new uuid; v_old_count integer; v_new_count integer;
begin
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_lcl_context;
  select lead_id into v_lead from pg_temp._p9_lcl_leads where fixture_number = 3;
  select customer_id into v_c1 from pg_temp._p9_lcl_customers where fixture_number = 1;
  select customer_id, identity_id into v_c2, v_i2
  from pg_temp._p9_lcl_customers where fixture_number = 2;

  if v_lead is null or v_member is null then
    insert into pg_temp._p9_lcl_results values
      (14, 'substituicao atomica valida', 'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'lead fixture 3 or member user is unavailable', null, null, 'no replacement attempted');
    return;
  end if;

  select * into v_old_exec from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.link_lead_to_customer(
        p_organization_id => %L, p_store_id => %L, p_lead_id => %L,
        p_customer_id => %L, p_source => 'manual',
        p_linked_by_actor_type => 'system',
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_lead, v_c1,
           'runner:' || v_run::text || ':replace-old', v_run)
  );

  if not v_old_exec.operation_succeeded then
    insert into pg_temp._p9_lcl_results values
      (14, 'substituicao atomica valida', 'SUT_FAIL',
       'base link creation failed: ' || coalesce(v_old_exec.message_text, '<no message>'),
       v_old_exec.returned_sqlstate, v_old_exec.constraint_name, 'replacement not attempted');
    return;
  end if;
  v_old := v_old_exec.value_text::uuid;

  select * into v_replace from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.replace_lead_customer_link(
        p_old_link_id => %L, p_organization_id => %L, p_store_id => %L,
        p_new_customer_id => %L, p_source => 'whatsapp_identity',
        p_actor_type => 'human', p_actor_user_id => %L,
        p_source_identity_id => %L,
        p_source_reference => 'runner scenario 14',
        p_idempotency_key => %L, p_correlation_id => %L,
        p_link_metadata => '{"runner":true,"scenario":14}'::jsonb,
        p_unlink_reason_code => 'wrong_customer',
        p_unlink_reason => 'runner correction',
        p_unlink_metadata => '{"runner":true,"scenario":14}'::jsonb
      )).id::text
    $sql$, v_old, v_org, v_store, v_c2, v_member, v_i2,
           'runner:' || v_run::text || ':replacement', v_run)
  );

  if v_replace.operation_succeeded then
    v_new := v_replace.value_text::uuid;
    insert into pg_temp._p9_lcl_state values ('replace_old_id', v_old, null)
    on conflict (state_key) do update set value_uuid = excluded.value_uuid;
    insert into pg_temp._p9_lcl_state values ('replacement_id', v_new, null)
    on conflict (state_key) do update set value_uuid = excluded.value_uuid;
  end if;

  select count(*) into v_old_count from public.lead_customer_links
  where id = v_old and status = 'inactive'
    and unlinked_by_actor_type = 'human' and unlinked_by_user_id = v_member
    and unlink_reason_code = 'wrong_customer';

  select count(*) into v_new_count from public.lead_customer_links
  where id = v_new and status = 'active' and customer_id = v_c2
    and source_identity_id = v_i2 and replaces_link_id = v_old
    and linked_by_actor_type = 'human' and linked_by_user_id = v_member
    and correlation_id = v_run;

  insert into pg_temp._p9_lcl_results values (
    14, 'substituicao atomica valida',
    case when v_replace.operation_succeeded
              and v_old_count = 1 and v_new_count = 1
              and (select count(*) from public.lead_customer_links
                   where organization_id = v_org and store_id = v_store
                     and lead_id = v_lead and status = 'active') = 1
         then 'PASS' else 'SUT_FAIL' end,
    format('old_inactive=%s | new_active=%s | new_id=%s',
           v_old_count, v_new_count, coalesce(v_replace.value_text, '<null>')),
    v_replace.returned_sqlstate, v_replace.constraint_name,
    'old row is closed and exactly one new active replacement preserves the chain'
  );
exception
  when others then
    insert into pg_temp._p9_lcl_results values
      (14, 'substituicao atomica valida', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_14$;

do $scenario_15$
declare
  v_org uuid; v_store uuid; v_c2 uuid; v_i2 uuid; v_member uuid; v_run uuid;
  v_old uuid; v_expected uuid; v_exec record; v_count integer;
begin
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_lcl_context;
  select customer_id, identity_id into v_c2, v_i2
  from pg_temp._p9_lcl_customers where fixture_number = 2;
  select value_uuid into v_old from pg_temp._p9_lcl_state where state_key = 'replace_old_id';
  select value_uuid into v_expected from pg_temp._p9_lcl_state where state_key = 'replacement_id';

  if v_old is null or v_expected is null then
    insert into pg_temp._p9_lcl_results values
      (15, 'repeticao da substituicao retorna a mesma linha',
       'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'scenario 14 replacement fixtures are unavailable', null, null, 'no retry attempted');
    return;
  end if;

  select * into v_exec from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.replace_lead_customer_link(
        p_old_link_id => %L, p_organization_id => %L, p_store_id => %L,
        p_new_customer_id => %L, p_source => 'whatsapp_identity',
        p_actor_type => 'human', p_actor_user_id => %L,
        p_source_identity_id => %L,
        p_idempotency_key => %L, p_correlation_id => %L,
        p_unlink_reason_code => 'wrong_customer'
      )).id::text
    $sql$, v_old, v_org, v_store, v_c2, v_member, v_i2,
           'runner:' || v_run::text || ':replacement', v_run)
  );

  select count(*) into v_count from public.lead_customer_links
  where replaces_link_id = v_old;

  insert into pg_temp._p9_lcl_results values (
    15, 'repeticao da substituicao retorna a mesma linha',
    case when v_exec.operation_succeeded
              and v_exec.value_text::uuid = v_expected and v_count = 1
         then 'PASS' else 'SUT_FAIL' end,
    format('returned=%s | expected=%s | replacements=%s',
           coalesce(v_exec.value_text, '<null>'), v_expected, v_count),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'retry returns the existing replacement and leaves exactly one replacement row'
  );
exception
  when others then
    insert into pg_temp._p9_lcl_results values
      (15, 'repeticao da substituicao retorna a mesma linha', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_15$;

do $scenario_16$
declare
  v_org uuid; v_store uuid; v_c3 uuid; v_i3 uuid; v_run uuid; v_old uuid;
  v_exec record;
begin
  select organization_id, store_id, run_id into v_org, v_store, v_run
  from pg_temp._p9_lcl_context;
  select customer_id, identity_id into v_c3, v_i3
  from pg_temp._p9_lcl_customers where fixture_number = 3;
  select value_uuid into v_old from pg_temp._p9_lcl_state where state_key = 'replace_old_id';

  if v_old is null then
    insert into pg_temp._p9_lcl_results values
      (16, 'conflito de substituicao e rejeitado',
       'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'scenario 14 old link is unavailable', null, null, 'no conflicting retry attempted');
    return;
  end if;

  select * into v_exec from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.replace_lead_customer_link(
        p_old_link_id => %L, p_organization_id => %L, p_store_id => %L,
        p_new_customer_id => %L, p_source => 'whatsapp_identity',
        p_actor_type => 'system', p_source_identity_id => %L,
        p_idempotency_key => %L, p_correlation_id => %L,
        p_unlink_reason_code => 'wrong_customer'
      )).id::text
    $sql$, v_old, v_org, v_store, v_c3, v_i3,
           'runner:' || v_run::text || ':replacement-conflict', v_run)
  );

  insert into pg_temp._p9_lcl_results values (
    16, 'conflito de substituicao e rejeitado',
    case when not v_exec.operation_succeeded
              and v_exec.returned_sqlstate = '23505'
              and v_exec.message_text = 'lead customer link replacement conflict'
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_exec.message_text, '<no message>'),
    v_exec.returned_sqlstate, v_exec.constraint_name,
    'an old link already replaced cannot be replaced by a different customer'
  );
exception
  when others then
    insert into pg_temp._p9_lcl_results values
      (16, 'conflito de substituicao e rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_16$;

do $scenario_17$
declare
  v_org uuid; v_store uuid; v_lead uuid; v_c1 uuid; v_run uuid;
  v_old_exec record; v_replace record; v_old uuid;
begin
  select organization_id, store_id, run_id into v_org, v_store, v_run
  from pg_temp._p9_lcl_context;
  select lead_id into v_lead from pg_temp._p9_lcl_leads where fixture_number = 4;
  select customer_id into v_c1 from pg_temp._p9_lcl_customers where fixture_number = 1;

  if v_lead is null then
    insert into pg_temp._p9_lcl_results values
      (17, 'substituicao pelo mesmo customer e rejeitada',
       'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'lead fixture 4 is unavailable', null, null, 'no replacement attempted');
    return;
  end if;

  select * into v_old_exec from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.link_lead_to_customer(
        p_organization_id => %L, p_store_id => %L, p_lead_id => %L,
        p_customer_id => %L, p_source => 'manual',
        p_linked_by_actor_type => 'system',
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_lead, v_c1,
           'runner:' || v_run::text || ':same-customer-old', v_run)
  );

  if not v_old_exec.operation_succeeded then
    insert into pg_temp._p9_lcl_results values
      (17, 'substituicao pelo mesmo customer e rejeitada', 'SUT_FAIL',
       'base link creation failed: ' || coalesce(v_old_exec.message_text, '<no message>'),
       v_old_exec.returned_sqlstate, v_old_exec.constraint_name, 'replacement not attempted');
    return;
  end if;
  v_old := v_old_exec.value_text::uuid;

  select * into v_replace from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.replace_lead_customer_link(
        p_old_link_id => %L, p_organization_id => %L, p_store_id => %L,
        p_new_customer_id => %L, p_source => 'manual',
        p_actor_type => 'system', p_idempotency_key => %L,
        p_correlation_id => %L, p_unlink_reason_code => 'same_customer_probe'
      )).id::text
    $sql$, v_old, v_org, v_store, v_c1,
           'runner:' || v_run::text || ':same-customer-replace', v_run)
  );

  insert into pg_temp._p9_lcl_results values (
    17, 'substituicao pelo mesmo customer e rejeitada',
    case when not v_replace.operation_succeeded
              and v_replace.returned_sqlstate = '22023'
              and v_replace.message_text = 'replacement customer must differ from current customer'
              and exists (select 1 from public.lead_customer_links
                          where id = v_old and status = 'active')
         then 'PASS' else 'SUT_FAIL' end,
    coalesce(v_replace.message_text, '<no message>'),
    v_replace.returned_sqlstate, v_replace.constraint_name,
    'same-customer replacement fails and the original link remains active'
  );
exception
  when others then
    insert into pg_temp._p9_lcl_results values
      (17, 'substituicao pelo mesmo customer e rejeitada', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_17$;

-- --------------------------------------------------------------------------
-- Cenario 18: escrita direta bloqueada.
-- --------------------------------------------------------------------------

do $scenario_18$
declare
  v_org uuid; v_store uuid; v_lead uuid; v_customer uuid; v_member uuid;
  v_run uuid; v_target uuid; v_random uuid := gen_random_uuid();
  v_service_insert record; v_auth_insert record; v_service_update record; v_service_delete record;
  v_remaining integer;
begin
  select organization_id, store_id, member_user_id, run_id
  into v_org, v_store, v_member, v_run from pg_temp._p9_lcl_context;
  select lead_id into v_lead from pg_temp._p9_lcl_leads where fixture_number = 5;
  select customer_id into v_customer from pg_temp._p9_lcl_customers where fixture_number = 1;
  select value_uuid into v_target from pg_temp._p9_lcl_state where state_key = 'replacement_id';

  if v_lead is null or v_member is null or v_target is null then
    insert into pg_temp._p9_lcl_results values
      (18, 'escrita direta permanece bloqueada',
       'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'lead fixture 5, member user or replacement target is unavailable',
       null, null, 'no direct DML probe executed');
    return;
  end if;

  select * into v_service_insert from pg_temp._p9_lcl_exec_dml(
    'service_role', null,
    format($sql$
      insert into public.lead_customer_links (
        id, organization_id, store_id, lead_id, customer_id,
        status, source, linked_by_actor_type, metadata
      ) values (%L, %L, %L, %L, %L, 'active', 'manual', 'system', '{}'::jsonb)
    $sql$, v_random, v_org, v_store, v_lead, v_customer)
  );

  select * into v_auth_insert from pg_temp._p9_lcl_exec_dml(
    'authenticated', v_member,
    format($sql$
      insert into public.lead_customer_links (
        id, organization_id, store_id, lead_id, customer_id,
        status, source, linked_by_actor_type, metadata
      ) values (%L, %L, %L, %L, %L, 'active', 'manual', 'system', '{}'::jsonb)
    $sql$, gen_random_uuid(), v_org, v_store, v_lead, v_customer)
  );

  select * into v_service_update from pg_temp._p9_lcl_exec_dml(
    'service_role', null,
    format('update public.lead_customer_links set metadata = metadata where id = %L', v_target)
  );

  select * into v_service_delete from pg_temp._p9_lcl_exec_dml(
    'service_role', null,
    format('delete from public.lead_customer_links where id = %L', v_target)
  );

  select count(*) into v_remaining from public.lead_customer_links where id = v_random;

  insert into pg_temp._p9_lcl_results values (
    18, 'escrita direta permanece bloqueada',
    case when not v_service_insert.operation_succeeded
              and v_service_insert.returned_sqlstate = '42501'
              and not v_auth_insert.operation_succeeded
              and v_auth_insert.returned_sqlstate = '42501'
              and not v_service_update.operation_succeeded
              and v_service_update.returned_sqlstate = '42501'
              and not v_service_delete.operation_succeeded
              and v_service_delete.returned_sqlstate = '42501'
              and v_remaining = 0
         then 'PASS' else 'SUT_FAIL' end,
    format('service_insert=%s | auth_insert=%s | service_update=%s | service_delete=%s | inserted_rows=%s',
           coalesce(v_service_insert.returned_sqlstate, '<none>'),
           coalesce(v_auth_insert.returned_sqlstate, '<none>'),
           coalesce(v_service_update.returned_sqlstate, '<none>'),
           coalesce(v_service_delete.returned_sqlstate, '<none>'), v_remaining),
    coalesce(v_service_insert.returned_sqlstate, v_auth_insert.returned_sqlstate,
             v_service_update.returned_sqlstate, v_service_delete.returned_sqlstate),
    null,
    'all direct write attempts fail with 42501 and no raw row is created or changed'
  );
exception
  when others then
    insert into pg_temp._p9_lcl_results values
      (18, 'escrita direta permanece bloqueada', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_18$;

-- --------------------------------------------------------------------------
-- Cenario 19: RLS.
-- --------------------------------------------------------------------------

do $scenario_19$
declare
  v_org uuid; v_store uuid; v_lead uuid; v_customer uuid; v_member uuid; v_external uuid;
  v_run uuid; v_create record; v_link uuid; v_member_select record; v_external_select record;
begin
  select organization_id, store_id, member_user_id, external_user_id, run_id
  into v_org, v_store, v_member, v_external, v_run from pg_temp._p9_lcl_context;
  select lead_id into v_lead from pg_temp._p9_lcl_leads where fixture_number = 5;
  select customer_id into v_customer from pg_temp._p9_lcl_customers where fixture_number = 1;

  if v_lead is null or v_member is null or v_external is null then
    insert into pg_temp._p9_lcl_results values
      (19, 'RLS isola leitura por membership',
       'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'lead fixture 5, member user or external user is unavailable',
       null, null, 'no visibility fixture was created');
    return;
  end if;

  select * into v_create from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.link_lead_to_customer(
        p_organization_id => %L, p_store_id => %L, p_lead_id => %L,
        p_customer_id => %L, p_source => 'manual',
        p_linked_by_actor_type => 'system',
        p_idempotency_key => %L, p_correlation_id => %L
      )).id::text
    $sql$, v_org, v_store, v_lead, v_customer,
           'runner:' || v_run::text || ':rls-link', v_run)
  );

  if not v_create.operation_succeeded then
    insert into pg_temp._p9_lcl_results values
      (19, 'RLS isola leitura por membership', 'SUT_FAIL',
       'visibility fixture creation failed: ' || coalesce(v_create.message_text, '<no message>'),
       v_create.returned_sqlstate, v_create.constraint_name, 'SELECT probes not executed');
    return;
  end if;
  v_link := v_create.value_text::uuid;

  select * into v_member_select from pg_temp._p9_lcl_exec_scalar(
    'authenticated', v_member,
    format('select count(*)::text from public.lead_customer_links where id = %L', v_link)
  );

  select * into v_external_select from pg_temp._p9_lcl_exec_scalar(
    'authenticated', v_external,
    format('select count(*)::text from public.lead_customer_links where id = %L', v_link)
  );

  insert into pg_temp._p9_lcl_results values (
    19, 'RLS isola leitura por membership',
    case when v_member_select.operation_succeeded and v_member_select.value_text = '1'
              and v_external_select.operation_succeeded and v_external_select.value_text = '0'
         then 'PASS' else 'SUT_FAIL' end,
    format('member_visible=%s | external_visible=%s',
           coalesce(v_member_select.value_text, '<null>'),
           coalesce(v_external_select.value_text, '<null>')),
    coalesce(v_member_select.returned_sqlstate, v_external_select.returned_sqlstate),
    null,
    'member sees one row and a user without target-organization membership sees zero'
  );
exception
  when others then
    insert into pg_temp._p9_lcl_results values
      (19, 'RLS isola leitura por membership', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_19$;

-- --------------------------------------------------------------------------
-- Cenario 20: trigger de imutabilidade.
-- --------------------------------------------------------------------------

do $scenario_20$
declare
  v_org uuid; v_store uuid; v_lead uuid; v_c1 uuid; v_c2 uuid; v_run uuid;
  v_create record; v_close record; v_link uuid;
  v_core_state text; v_core_message text; v_inactive_state text; v_inactive_message text;
  v_customer_after uuid; v_metadata_after jsonb;
begin
  select organization_id, store_id, run_id into v_org, v_store, v_run
  from pg_temp._p9_lcl_context;
  select lead_id into v_lead from pg_temp._p9_lcl_leads where fixture_number = 6;
  select customer_id into v_c1 from pg_temp._p9_lcl_customers where fixture_number = 1;
  select customer_id into v_c2 from pg_temp._p9_lcl_customers where fixture_number = 2;

  if v_lead is null then
    insert into pg_temp._p9_lcl_results values
      (20, 'trigger protege campos e historico inactive',
       'BLOCKED_BY_FIXTURE_PREREQUISITE',
       'lead fixture 6 is unavailable', null, null, 'no trigger probe executed');
    return;
  end if;

  select * into v_create from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.link_lead_to_customer(
        p_organization_id => %L, p_store_id => %L, p_lead_id => %L,
        p_customer_id => %L, p_source => 'manual',
        p_linked_by_actor_type => 'system',
        p_idempotency_key => %L, p_correlation_id => %L,
        p_metadata => '{"runner":true,"scenario":20}'::jsonb
      )).id::text
    $sql$, v_org, v_store, v_lead, v_c1,
           'runner:' || v_run::text || ':trigger-link', v_run)
  );

  if not v_create.operation_succeeded then
    insert into pg_temp._p9_lcl_results values
      (20, 'trigger protege campos e historico inactive', 'SUT_FAIL',
       'trigger fixture creation failed: ' || coalesce(v_create.message_text, '<no message>'),
       v_create.returned_sqlstate, v_create.constraint_name, 'trigger probes not executed');
    return;
  end if;
  v_link := v_create.value_text::uuid;

  begin
    update public.lead_customer_links set customer_id = v_c2 where id = v_link;
  exception when others then
    get stacked diagnostics v_core_state = returned_sqlstate, v_core_message = message_text;
  end;

  select customer_id into v_customer_after from public.lead_customer_links where id = v_link;

  select * into v_close from pg_temp._p9_lcl_exec_scalar(
    'service_role', null,
    format($sql$
      select (public.close_lead_customer_link(
        p_link_id => %L, p_organization_id => %L, p_store_id => %L,
        p_unlinked_by_actor_type => 'system', p_unlinked_by_user_id => null,
        p_unlink_reason_code => 'trigger_probe', p_correlation_id => %L
      )).id::text
    $sql$, v_link, v_org, v_store, v_run)
  );

  begin
    update public.lead_customer_links
    set metadata = metadata || '{"tampered":true}'::jsonb
    where id = v_link;
  exception when others then
    get stacked diagnostics v_inactive_state = returned_sqlstate,
                            v_inactive_message = message_text;
  end;

  select metadata into v_metadata_after from public.lead_customer_links where id = v_link;

  insert into pg_temp._p9_lcl_results values (
    20, 'trigger protege campos e historico inactive',
    case when v_core_state = 'P0001'
              and v_core_message = 'lead customer link core fields are immutable'
              and v_customer_after = v_c1
              and v_close.operation_succeeded
              and v_inactive_state = 'P0001'
              and v_inactive_message = 'inactive lead customer link is immutable'
              and not (v_metadata_after ? 'tampered')
         then 'PASS' else 'SUT_FAIL' end,
    format('core=%s/%s | customer_unchanged=%s | inactive=%s/%s | tampered=%s',
           coalesce(v_core_state, '<none>'), coalesce(v_core_message, '<none>'),
           v_customer_after = v_c1,
           coalesce(v_inactive_state, '<none>'), coalesce(v_inactive_message, '<none>'),
           v_metadata_after ? 'tampered'),
    coalesce(v_core_state, v_inactive_state), null,
    'core mutation and any later mutation of an inactive row are rejected without state change'
  );
exception
  when others then
    insert into pg_temp._p9_lcl_results values
      (20, 'trigger protege campos e historico inactive', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_20$;

-- --------------------------------------------------------------------------
-- Cenario 21: FK RESTRICT e CHECK estrito.
-- --------------------------------------------------------------------------

do $scenario_21$
declare
  v_ok boolean;
begin
  select
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.lead_customer_links'::regclass
        and conname = 'lead_customer_links_linked_by_user_fkey'
        and confrelid = 'auth.users'::regclass and confdeltype = 'r'
    )
    and exists (
      select 1 from pg_constraint
      where conrelid = 'public.lead_customer_links'::regclass
        and conname = 'lead_customer_links_unlinked_by_user_fkey'
        and confrelid = 'auth.users'::regclass and confdeltype = 'r'
    )
    and exists (
      select 1 from pg_constraint
      where conrelid = 'public.lead_customer_links'::regclass
        and conname = 'lead_customer_links_link_actor_check'
        and strpos(lower(pg_get_constraintdef(oid, true)),
                   'linked_by_actor_type = ''human''::text') > 0
        and strpos(lower(pg_get_constraintdef(oid, true)),
                   'linked_by_user_id is not null') > 0
        and strpos(lower(pg_get_constraintdef(oid, true)),
                   'linked_by_actor_type <> ''human''::text') > 0
        and strpos(lower(pg_get_constraintdef(oid, true)),
                   'linked_by_user_id is null') > 0
    )
    and exists (
      select 1 from pg_constraint
      where conrelid = 'public.lead_customer_links'::regclass
        and conname = 'lead_customer_links_unlink_state_check'
        and strpos(lower(pg_get_constraintdef(oid, true)),
                   'unlinked_by_actor_type = ''human''::text') > 0
        and strpos(lower(pg_get_constraintdef(oid, true)),
                   'unlinked_by_user_id is not null') > 0
        and strpos(lower(pg_get_constraintdef(oid, true)),
                   'unlinked_by_actor_type <> ''human''::text') > 0
        and strpos(lower(pg_get_constraintdef(oid, true)),
                   'unlinked_by_user_id is null') > 0
    )
    and strpos(
      lower(pg_get_functiondef('public.enforce_lead_customer_link_write_rules()'::regprocedure)),
      'permite somente o set null automático'
    ) = 0
  into v_ok;

  insert into pg_temp._p9_lcl_results values (
    21, 'autoria humana usa FK RESTRICT',
    case when v_ok then 'PASS' else 'SUT_FAIL' end,
    case when v_ok
      then 'both auth.users FKs use RESTRICT, actor checks require human user ids and the SET NULL trigger exception is absent'
      else 'one or more strict actor identity barriers are missing'
    end,
    null, null,
    'structural verification avoids attempting to delete any real auth user'
  );
exception
  when others then
    insert into pg_temp._p9_lcl_results values
      (21, 'autoria humana usa FK RESTRICT', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'scenario rolled back');
end;
$scenario_21$;

-- --------------------------------------------------------------------------
-- Cenario 22: cleanup total.
-- --------------------------------------------------------------------------

do $scenario_22$
declare
  v_run uuid;
  v_links_before integer;
  v_links_after integer;
  v_identities_after integer;
  v_store_links_after integer;
  v_customers_after integer;
  v_deleted_replacements bigint := 0;
  v_deleted_links bigint := 0;
begin
  begin execute 'reset role'; exception when others then null; end;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);

  if not pg_temp._p9_lcl_identity_is_clean() then
    update pg_temp._p9_lcl_context set cleanup_status = 'CLEANUP_FAILURE';
    insert into pg_temp._p9_lcl_results values
      (22, 'cleanup total das fixtures do runner', 'CLEANUP_FAILURE',
       'identity could not be restored before cleanup', null, null,
       'cleanup did not run under postgres');
    return;
  end if;

  select run_id into v_run from pg_temp._p9_lcl_context;
  select count(*) into v_links_before from public.lead_customer_links
  where correlation_id = v_run;

  delete from public.lead_customer_links
  where correlation_id = v_run and replaces_link_id is not null;
  get diagnostics v_deleted_replacements = row_count;

  delete from public.lead_customer_links
  where correlation_id = v_run;
  get diagnostics v_deleted_links = row_count;

  delete from public.customer_channel_identities identity_row
  using pg_temp._p9_lcl_customers fixture
  where identity_row.id = fixture.identity_id;

  delete from public.customer_store_links store_link
  using pg_temp._p9_lcl_customers fixture
  where store_link.id = fixture.customer_store_link_id;

  delete from public.customers customer_row
  using pg_temp._p9_lcl_customers fixture
  where customer_row.id = fixture.customer_id
    and fixture.merged_into_customer_id is not null;

  delete from public.customers customer_row
  using pg_temp._p9_lcl_customers fixture
  where customer_row.id = fixture.customer_id;

  select count(*) into v_links_after from public.lead_customer_links
  where correlation_id = v_run;

  select count(*) into v_identities_after
  from public.customer_channel_identities identity_row
  join pg_temp._p9_lcl_customers fixture on fixture.identity_id = identity_row.id;

  select count(*) into v_store_links_after
  from public.customer_store_links store_link
  join pg_temp._p9_lcl_customers fixture
    on fixture.customer_store_link_id = store_link.id;

  select count(*) into v_customers_after
  from public.customers customer_row
  join pg_temp._p9_lcl_customers fixture on fixture.customer_id = customer_row.id;

  update pg_temp._p9_lcl_context
  set cleanup_status = case
    when v_links_after = 0 and v_identities_after = 0
     and v_store_links_after = 0 and v_customers_after = 0
    then 'PASS' else 'CLEANUP_FAILURE' end;

  insert into pg_temp._p9_lcl_results values (
    22, 'cleanup total das fixtures do runner',
    case when v_links_after = 0 and v_identities_after = 0
               and v_store_links_after = 0 and v_customers_after = 0
         then 'PASS' else 'CLEANUP_FAILURE' end,
    format('links_before=%s | deleted_replacements=%s | deleted_other_links=%s | links_after=%s | identities_after=%s | store_links_after=%s | customers_after=%s',
           v_links_before, v_deleted_replacements, v_deleted_links,
           v_links_after, v_identities_after, v_store_links_after, v_customers_after),
    null, null,
    'all runner-owned rows must be absent before commit'
  );
exception
  when others then
    begin execute 'reset role'; exception when others then null; end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    update pg_temp._p9_lcl_context set cleanup_status = 'CLEANUP_FAILURE';
    insert into pg_temp._p9_lcl_results values
      (22, 'cleanup total das fixtures do runner', 'CLEANUP_FAILURE',
       'cleanup error: ' || sqlstate || ': ' || sqlerrm,
       sqlstate, null, 'cleanup exception was captured');
end;
$scenario_22$;

-- Garante um resultado por cenario.
insert into pg_temp._p9_lcl_results (
  scenario_number, scenario_name, status, detail,
  returned_sqlstate, constraint_name, postcondition
)
select
  matrix.scenario_number,
  matrix.scenario_name,
  case when matrix.scenario_number = 22 then 'CLEANUP_FAILURE' else 'HARNESS_ERROR' end,
  'runner did not emit a result for this scenario',
  null, null,
  'missing scenario result synthesized by final integrity check'
from pg_temp._p9_lcl_matrix matrix
where not exists (
  select 1 from pg_temp._p9_lcl_results result
  where result.scenario_number = matrix.scenario_number
);

-- Barreira final: cleanup precisa provar zero residuos.
do $final_cleanup_safety$
declare
  v_cleanup text;
  v_run uuid;
  v_links integer;
  v_identities integer;
  v_store_links integer;
  v_customers integer;
begin
  select cleanup_status, run_id into v_cleanup, v_run
  from pg_temp._p9_lcl_context;

  select count(*) into v_links from public.lead_customer_links
  where correlation_id = v_run;

  select count(*) into v_identities
  from public.customer_channel_identities identity_row
  join pg_temp._p9_lcl_customers fixture on fixture.identity_id = identity_row.id;

  select count(*) into v_store_links
  from public.customer_store_links store_link
  join pg_temp._p9_lcl_customers fixture
    on fixture.customer_store_link_id = store_link.id;

  select count(*) into v_customers
  from public.customers customer_row
  join pg_temp._p9_lcl_customers fixture on fixture.customer_id = customer_row.id;

  if v_cleanup <> 'PASS' or v_links <> 0 or v_identities <> 0
     or v_store_links <> 0 or v_customers <> 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'lead_customer_links runner cleanup safety gate failed; transaction rolled back (status=%s, links=%s, identities=%s, store_links=%s, customers=%s)',
        coalesce(v_cleanup, '<null>'), v_links, v_identities, v_store_links, v_customers
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
      when count(*) <> 22 then 'HARNESS_ERROR'
      when count(*) filter (where status = 'CLEANUP_FAILURE') > 0 then 'CLEANUP_FAILURE'
      when count(*) filter (where status = 'HARNESS_ERROR') > 0 then 'HARNESS_ERROR'
      when count(*) filter (where status = 'SUT_FAIL') > 0 then 'SUT_FAIL'
      when count(*) filter (where status = 'BLOCKED_BY_FIXTURE_PREREQUISITE') > 0
        then 'BLOCKED_BY_FIXTURE_PREREQUISITE'
      else 'APROVADA'
    end as final_status
  from pg_temp._p9_lcl_results
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
  from pg_temp._p9_lcl_results result
  join pg_temp._p9_lcl_matrix matrix
    on matrix.scenario_number = result.scenario_number

  union all

  select
    'SUMMARY', null, 'runner summary', '22-scenario approval contract',
    'postgres controller', 'classification with cleanup priority',
    summary.final_status,
    format('scenario_count=%s | pass=%s | sut_fail=%s | harness_error=%s | blocked=%s | cleanup_failure=%s | final_status=%s',
           summary.scenario_count, summary.total_pass, summary.total_sut_fail,
           summary.total_harness_error, summary.total_blocked,
           summary.total_cleanup_failure, summary.final_status),
    null, null, 'see cleanup_status and harness_preflight columns',
    summary.scenario_count, summary.total_pass, summary.total_sut_fail,
    summary.total_harness_error, summary.total_blocked,
    summary.total_cleanup_failure,
    context.cleanup_status, context.harness_preflight,
    context.inventory_text, context.object_fingerprint,
    summary.final_status
  from summary cross join pg_temp._p9_lcl_context context
)
select
  row_type, scenario_number, scenario_name, coverage_rule, test_role,
  expected_outcome, status, detail, returned_sqlstate, constraint_name,
  postcondition, scenario_count, total_pass, total_sut_fail,
  total_harness_error, total_blocked, total_cleanup_failure,
  cleanup_status, harness_preflight, fixture_inventory,
  object_fingerprint, final_status
from report
order by case when row_type = 'SCENARIO' then 0 else 1 end,
         scenario_number nulls last;

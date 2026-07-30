-- ZION / Pilar 9 / Etapa 1.1
-- Runner manual de validacao estrutural e funcional do hardening de escopo
-- de public.leads.
--
-- Regras:
-- - executar o arquivo inteiro uma unica vez;
-- - usa apenas fixtures isoladas desta execucao;
-- - nao depende de nomes, IDs ou quantidades preexistentes;
-- - agrega todas as falhas antes do erro final;
-- - termina com rollback e nao persiste dados.

begin;

set local lock_timeout = '3s';
set local statement_timeout = '240s';
set local idle_in_transaction_session_timeout = '240s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

drop table if exists pg_temp._p9_leads_scope_results;
drop table if exists pg_temp._p9_leads_scope_ctx;

create temp table pg_temp._p9_leads_scope_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null check (status in ('PASS', 'SUT_FAIL', 'HARNESS_ERROR')),
  detail text not null,
  returned_sqlstate text null,
  constraint_name text null
) on commit preserve rows;

create temp table pg_temp._p9_leads_scope_ctx (
  singleton boolean primary key default true check (singleton),
  run_id uuid not null default gen_random_uuid(),
  pre_org_count bigint not null default 0,
  pre_store_count bigint not null default 0,
  pre_lead_count bigint not null default 0,
  lead_column_fingerprint text not null default '',
  lead_trigger_fingerprint text not null default '',
  lead_policy_fingerprint text not null default '',
  lead_rls_fingerprint text not null default '',
  org_a uuid not null default gen_random_uuid(),
  org_b uuid not null default gen_random_uuid(),
  store_a uuid not null default gen_random_uuid(),
  store_b uuid not null default gen_random_uuid(),
  lead_primary uuid not null default gen_random_uuid(),
  lead_secondary uuid not null default gen_random_uuid(),
  lead_insert_ok uuid not null default gen_random_uuid()
) on commit preserve rows;

insert into pg_temp._p9_leads_scope_ctx default values;

create or replace function pg_temp._p9_leads_scope_record(
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
  insert into pg_temp._p9_leads_scope_results (
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
end;
$function$;

create or replace function pg_temp._p9_leads_scope_exec_stmt_sql(
  p_sql text
)
returns table (
  operation_succeeded boolean,
  returned_sqlstate text,
  message_text text,
  constraint_name text
)
language plpgsql
as $function$
declare
  v_state text;
  v_message text;
  v_constraint text;
  v_succeeded boolean := false;
begin
  begin
    execute p_sql;
    v_succeeded := true;
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text,
        v_constraint = constraint_name;
      v_succeeded := false;
  end;

  return query
  select
    v_succeeded,
    v_state,
    v_message,
    v_constraint;
end;
$function$;

revoke all on function pg_temp._p9_leads_scope_record(
  integer, text, boolean, text, text, text
) from public;

revoke all on function pg_temp._p9_leads_scope_exec_stmt_sql(text) from public;

do $setup$
declare
  v_ctx pg_temp._p9_leads_scope_ctx;
begin
  select * into strict v_ctx from pg_temp._p9_leads_scope_ctx;

  update pg_temp._p9_leads_scope_ctx
  set
    pre_org_count = (select count(*) from public.organizations),
    pre_store_count = (select count(*) from public.stores),
    pre_lead_count = (select count(*) from public.leads),
    lead_column_fingerprint = (
      select string_agg(
               format(
                 '%s|%s|%s|%s',
                 column_name,
                 data_type,
                 is_nullable,
                 coalesce(column_default, '')
               ),
               ' || '
               order by ordinal_position
             )
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'leads'
        and column_name in ('state', 'humano_assumiu', 'store_id')
    ),
    lead_trigger_fingerprint = (
      select coalesce(
               string_agg(
                 format(
                   '%s|%s|%s|%s',
                   trigger_row.tgname,
                   trigger_row.tgenabled,
                   trigger_row.tgtype,
                   procedure_row.proname
                 ),
                 ' || '
                 order by trigger_row.tgname
               ),
               '<none>'
             )
      from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_proc procedure_row
        on procedure_row.oid = trigger_row.tgfoid
      where trigger_row.tgrelid = 'public.leads'::pg_catalog.regclass
        and not trigger_row.tgisinternal
    ),
    lead_policy_fingerprint = (
      select coalesce(
               string_agg(
                 format(
                   '%s|%s|%s|%s|%s',
                   policyname,
                   permissive,
                   cmd,
                   array_to_string(roles, ','),
                   coalesce(qual, '') || '|' || coalesce(with_check, '')
                 ),
                 ' || '
                 order by policyname
               ),
               '<none>'
             )
      from pg_policies
      where schemaname = 'public'
        and tablename = 'leads'
    ),
    lead_rls_fingerprint = (
      select format(
               '%s|%s',
               relrowsecurity,
               relforcerowsecurity
             )
      from pg_catalog.pg_class
      where oid = 'public.leads'::pg_catalog.regclass
    );

  insert into public.organizations (id, name)
  values
    (v_ctx.org_a, 'Runner Leads Scope Org A ' || v_ctx.run_id::text),
    (v_ctx.org_b, 'Runner Leads Scope Org B ' || v_ctx.run_id::text);

  insert into public.stores (id, organization_id, name, created_at)
  values
    (v_ctx.store_a, v_ctx.org_a, 'Runner Leads Scope Store A ' || v_ctx.run_id::text, now()),
    (v_ctx.store_b, v_ctx.org_b, 'Runner Leads Scope Store B ' || v_ctx.run_id::text, now());

  insert into public.leads (
    id,
    organization_id,
    store_id,
    state,
    created_at,
    updated_at
  )
  values
    (v_ctx.lead_primary, v_ctx.org_a, v_ctx.store_a, 'negociacao', now(), now()),
    (v_ctx.lead_secondary, v_ctx.org_a, v_ctx.store_a, 'negociacao', now(), now());
exception
  when others then
    insert into pg_temp._p9_leads_scope_results values (
      0,
      'setup',
      'HARNESS_ERROR',
      'setup failed: ' || sqlstate || ': ' || sqlerrm,
      sqlstate,
      null
    );
end;
$setup$;

do $scenario_1$
declare
  v_ok boolean;
begin
  select
    exists (
      select 1
      from pg_catalog.pg_attribute
      where attrelid = 'public.leads'::pg_catalog.regclass
        and attname = 'store_id'
        and attnotnull
    )
  into v_ok;

  perform pg_temp._p9_leads_scope_record(
    1,
    'store_id esta not null',
    v_ok,
    'public.leads.store_id must be attnotnull'
  );
exception
  when others then
    insert into pg_temp._p9_leads_scope_results values
      (1, 'store_id esta not null', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null);
end;
$scenario_1$;

do $scenario_2$
declare
  v_ok boolean;
begin
  select exists (
           select 1
           from pg_catalog.pg_constraint constraint_row
           where constraint_row.conrelid = 'public.leads'::pg_catalog.regclass
             and constraint_row.conname = 'leads_store_id_organization_id_fkey'
             and constraint_row.contype = 'f'
             and constraint_row.convalidated
             and constraint_row.confrelid = 'public.stores'::pg_catalog.regclass
             and constraint_row.confdeltype = 'r'
             and (
               select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
               from pg_catalog.unnest(
                      constraint_row.conkey
                    ) with ordinality as key_column(attnum, ordinality)
               join pg_catalog.pg_attribute attribute_row
                 on attribute_row.attrelid = constraint_row.conrelid
                and attribute_row.attnum = key_column.attnum
             ) = array['store_id', 'organization_id']::text[]
             and (
               select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
               from pg_catalog.unnest(
                      constraint_row.confkey
                    ) with ordinality as key_column(attnum, ordinality)
               join pg_catalog.pg_attribute attribute_row
                 on attribute_row.attrelid = constraint_row.confrelid
                and attribute_row.attnum = key_column.attnum
             ) = array['id', 'organization_id']::text[]
         )
    into v_ok;

  perform pg_temp._p9_leads_scope_record(
    2,
    'fk composta existe e usa restrict',
    v_ok,
    'leads_store_id_organization_id_fkey must be validated and use ON DELETE RESTRICT'
  );
exception
  when others then
    insert into pg_temp._p9_leads_scope_results values
      (2, 'fk composta existe e usa restrict', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null);
end;
$scenario_2$;

do $scenario_3$
declare
  v_ok boolean;
begin
  select not exists (
           select 1
           from pg_catalog.pg_constraint
           where conrelid = 'public.leads'::pg_catalog.regclass
             and conname = 'leads_store_id_fkey'
         )
    into v_ok;

  perform pg_temp._p9_leads_scope_record(
    3,
    'fk simples antiga nao existe',
    v_ok,
    'legacy leads_store_id_fkey must be absent'
  );
exception
  when others then
    insert into pg_temp._p9_leads_scope_results values
      (3, 'fk simples antiga nao existe', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null);
end;
$scenario_3$;

do $scenario_4$
declare
  v_ok boolean;
begin
  select exists (
           select 1
           from pg_catalog.pg_constraint constraint_row
           where constraint_row.conrelid = 'public.leads'::pg_catalog.regclass
             and constraint_row.conname = 'leads_organization_id_fkey'
             and constraint_row.contype = 'f'
             and constraint_row.confrelid = 'public.organizations'::pg_catalog.regclass
         )
    into v_ok;

  perform pg_temp._p9_leads_scope_record(
    4,
    'fk de organization foi preservada',
    v_ok,
    'leads_organization_id_fkey must remain bound to public.organizations(id)'
  );
exception
  when others then
    insert into pg_temp._p9_leads_scope_results values
      (4, 'fk de organization foi preservada', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null);
end;
$scenario_4$;

do $scenario_5$
declare
  v_ctx pg_temp._p9_leads_scope_ctx;
  v_probe record;
  v_exists boolean;
begin
  select * into strict v_ctx from pg_temp._p9_leads_scope_ctx;

  select * into v_probe
  from pg_temp._p9_leads_scope_exec_stmt_sql(
    format(
      $sql$
        insert into public.leads (
          id, organization_id, store_id, state, created_at, updated_at
        )
        values (
          %L::uuid, %L::uuid, %L::uuid, 'negociacao', now(), now()
        )
      $sql$,
      v_ctx.lead_insert_ok,
      v_ctx.org_a,
      v_ctx.store_a
    )
  );

  select exists (
           select 1
           from public.leads
           where id = v_ctx.lead_insert_ok
             and organization_id = v_ctx.org_a
             and store_id = v_ctx.store_a
         )
    into v_exists;

  perform pg_temp._p9_leads_scope_record(
    5,
    'insert coerente funciona',
    v_probe.operation_succeeded and v_exists,
    format('insert_ok=%s | row_exists=%s', v_probe.operation_succeeded, v_exists),
    v_probe.returned_sqlstate,
    v_probe.constraint_name
  );
exception
  when others then
    insert into pg_temp._p9_leads_scope_results values
      (5, 'insert coerente funciona', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null);
end;
$scenario_5$;

do $scenario_6$
declare
  v_ctx pg_temp._p9_leads_scope_ctx;
  v_probe record;
begin
  select * into strict v_ctx from pg_temp._p9_leads_scope_ctx;

  select * into v_probe
  from pg_temp._p9_leads_scope_exec_stmt_sql(
    format(
      $sql$
        insert into public.leads (
          id, organization_id, store_id, state, created_at, updated_at
        )
        values (
          %L::uuid, %L::uuid, %L::uuid, 'negociacao', now(), now()
        )
      $sql$,
      gen_random_uuid(),
      v_ctx.org_a,
      v_ctx.store_b
    )
  );

  perform pg_temp._p9_leads_scope_record(
    6,
    'insert com loja de outra organizacao e rejeitado',
    not v_probe.operation_succeeded
    and v_probe.returned_sqlstate = '23503'
    and v_probe.constraint_name = 'leads_store_id_organization_id_fkey',
    coalesce(v_probe.message_text, '<none>'),
    v_probe.returned_sqlstate,
    v_probe.constraint_name
  );
exception
  when others then
    insert into pg_temp._p9_leads_scope_results values
      (6, 'insert com loja de outra organizacao e rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null);
end;
$scenario_6$;

do $scenario_7$
declare
  v_ctx pg_temp._p9_leads_scope_ctx;
  v_probe record;
begin
  select * into strict v_ctx from pg_temp._p9_leads_scope_ctx;

  select * into v_probe
  from pg_temp._p9_leads_scope_exec_stmt_sql(
    format(
      $sql$
        insert into public.leads (
          id, organization_id, store_id, state, created_at, updated_at
        )
        values (
          %L::uuid, %L::uuid, null, 'negociacao', now(), now()
        )
      $sql$,
      gen_random_uuid(),
      v_ctx.org_a
    )
  );

  perform pg_temp._p9_leads_scope_record(
    7,
    'insert com store_id null e rejeitado',
    not v_probe.operation_succeeded
    and v_probe.returned_sqlstate = '23502',
    coalesce(v_probe.message_text, '<none>'),
    v_probe.returned_sqlstate,
    v_probe.constraint_name
  );
exception
  when others then
    insert into pg_temp._p9_leads_scope_results values
      (7, 'insert com store_id null e rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null);
end;
$scenario_7$;

do $scenario_8$
declare
  v_ctx pg_temp._p9_leads_scope_ctx;
  v_probe record;
begin
  select * into strict v_ctx from pg_temp._p9_leads_scope_ctx;

  select * into v_probe
  from pg_temp._p9_leads_scope_exec_stmt_sql(
    format(
      $sql$
        update public.leads
        set store_id = null
        where id = %L::uuid
      $sql$,
      v_ctx.lead_primary
    )
  );

  perform pg_temp._p9_leads_scope_record(
    8,
    'update para store_id null e rejeitado',
    not v_probe.operation_succeeded
    and v_probe.returned_sqlstate = '23502',
    coalesce(v_probe.message_text, '<none>'),
    v_probe.returned_sqlstate,
    v_probe.constraint_name
  );
exception
  when others then
    insert into pg_temp._p9_leads_scope_results values
      (8, 'update para store_id null e rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null);
end;
$scenario_8$;

do $scenario_9$
declare
  v_ctx pg_temp._p9_leads_scope_ctx;
  v_probe record;
begin
  select * into strict v_ctx from pg_temp._p9_leads_scope_ctx;

  select * into v_probe
  from pg_temp._p9_leads_scope_exec_stmt_sql(
    format(
      $sql$
        update public.leads
        set store_id = %L::uuid
        where id = %L::uuid
      $sql$,
      v_ctx.store_b,
      v_ctx.lead_primary
    )
  );

  perform pg_temp._p9_leads_scope_record(
    9,
    'update para loja de outra organizacao e rejeitado',
    not v_probe.operation_succeeded
    and v_probe.returned_sqlstate = '23503'
    and v_probe.constraint_name = 'leads_store_id_organization_id_fkey',
    coalesce(v_probe.message_text, '<none>'),
    v_probe.returned_sqlstate,
    v_probe.constraint_name
  );
exception
  when others then
    insert into pg_temp._p9_leads_scope_results values
      (9, 'update para loja de outra organizacao e rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null);
end;
$scenario_9$;

do $scenario_10$
declare
  v_ctx pg_temp._p9_leads_scope_ctx;
  v_probe record;
begin
  select * into strict v_ctx from pg_temp._p9_leads_scope_ctx;

  select * into v_probe
  from pg_temp._p9_leads_scope_exec_stmt_sql(
    format(
      $sql$
        delete from public.stores
        where id = %L::uuid
          and organization_id = %L::uuid
      $sql$,
      v_ctx.store_a,
      v_ctx.org_a
    )
  );

  perform pg_temp._p9_leads_scope_record(
    10,
    'delete de store referenciada e rejeitado',
    not v_probe.operation_succeeded
    and v_probe.returned_sqlstate = '23503'
    and v_probe.constraint_name = 'leads_store_id_organization_id_fkey',
    coalesce(v_probe.message_text, '<none>'),
    v_probe.returned_sqlstate,
    v_probe.constraint_name
  );
exception
  when others then
    insert into pg_temp._p9_leads_scope_results values
      (10, 'delete de store referenciada e rejeitado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null);
end;
$scenario_10$;

do $scenario_11$
declare
  v_ctx pg_temp._p9_leads_scope_ctx;
  v_probe record;
begin
  select * into strict v_ctx from pg_temp._p9_leads_scope_ctx;

  select * into v_probe
  from pg_temp._p9_leads_scope_exec_stmt_sql(
    format(
      $sql$
        delete from public.organizations
        where id = %L::uuid
      $sql$,
      v_ctx.org_a
    )
  );

  perform pg_temp._p9_leads_scope_record(
    11,
    'delete de organization com store e lead vinculados e verificado',
    not v_probe.operation_succeeded
    and v_probe.returned_sqlstate = '23503',
    coalesce(v_probe.message_text, '<none>'),
    v_probe.returned_sqlstate,
    v_probe.constraint_name
  );
exception
  when others then
    insert into pg_temp._p9_leads_scope_results values
      (11, 'delete de organization com store e lead vinculados e verificado', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null);
end;
$scenario_11$;

do $cleanup_and_checks$
declare
  v_ctx pg_temp._p9_leads_scope_ctx;
  v_columns_now text;
  v_triggers_now text;
  v_policies_now text;
  v_rls_now text;
  v_count_org bigint;
  v_count_store bigint;
  v_count_lead bigint;
begin
  select * into strict v_ctx from pg_temp._p9_leads_scope_ctx;

  delete from public.leads
  where id in (v_ctx.lead_primary, v_ctx.lead_secondary, v_ctx.lead_insert_ok);

  delete from public.stores
  where (id, organization_id) in (
    (v_ctx.store_a, v_ctx.org_a),
    (v_ctx.store_b, v_ctx.org_b)
  );

  delete from public.organizations
  where id in (v_ctx.org_a, v_ctx.org_b);

  select count(*) into v_count_org from public.organizations;
  select count(*) into v_count_store from public.stores;
  select count(*) into v_count_lead from public.leads;

  select string_agg(
           format(
             '%s|%s|%s|%s',
             column_name,
             data_type,
             is_nullable,
             coalesce(column_default, '')
           ),
           ' || '
           order by ordinal_position
         )
    into v_columns_now
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'leads'
    and column_name in ('state', 'humano_assumiu', 'store_id');

  select coalesce(
           string_agg(
             format(
               '%s|%s|%s|%s',
               trigger_row.tgname,
               trigger_row.tgenabled,
               trigger_row.tgtype,
               procedure_row.proname
             ),
             ' || '
             order by trigger_row.tgname
           ),
           '<none>'
         )
    into v_triggers_now
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_proc procedure_row
    on procedure_row.oid = trigger_row.tgfoid
  where trigger_row.tgrelid = 'public.leads'::pg_catalog.regclass
    and not trigger_row.tgisinternal;

  select coalesce(
           string_agg(
             format(
               '%s|%s|%s|%s|%s',
               policyname,
               permissive,
               cmd,
               array_to_string(roles, ','),
               coalesce(qual, '') || '|' || coalesce(with_check, '')
             ),
             ' || '
             order by policyname
           ),
           '<none>'
         )
    into v_policies_now
  from pg_policies
  where schemaname = 'public'
    and tablename = 'leads';

  select format('%s|%s', relrowsecurity, relforcerowsecurity)
    into v_rls_now
  from pg_catalog.pg_class
  where oid = 'public.leads'::pg_catalog.regclass;

  perform pg_temp._p9_leads_scope_record(
    12,
    'dados preexistentes nao sao alterados',
    v_count_org = v_ctx.pre_org_count
    and v_count_store = v_ctx.pre_store_count
    and v_count_lead = v_ctx.pre_lead_count,
    format(
      'orgs=%s/%s | stores=%s/%s | leads=%s/%s',
      v_count_org, v_ctx.pre_org_count,
      v_count_store, v_ctx.pre_store_count,
      v_count_lead, v_ctx.pre_lead_count
    )
  );

  perform pg_temp._p9_leads_scope_record(
    13,
    'state triggers rls e policies nao foram modificados',
    v_columns_now = v_ctx.lead_column_fingerprint
    and v_triggers_now = v_ctx.lead_trigger_fingerprint
    and v_policies_now = v_ctx.lead_policy_fingerprint
    and v_rls_now = v_ctx.lead_rls_fingerprint,
    'catalog fingerprints for state/humano_assumiu/store_id, triggers, policies and RLS remained identical'
  );

  perform pg_temp._p9_leads_scope_record(
    14,
    'reaplicacao logica nao produziria duplicidade',
    (
      select count(*)
      from pg_catalog.pg_constraint
      where conrelid = 'public.leads'::pg_catalog.regclass
        and conname = 'leads_store_id_organization_id_fkey'
    ) = 1
    and (
      select count(*)
      from pg_catalog.pg_constraint
      where conrelid = 'public.leads'::pg_catalog.regclass
        and conname = 'leads_store_id_fkey'
    ) = 0
    and (
      select count(*)
      from pg_catalog.pg_constraint
      where conrelid = 'public.leads'::pg_catalog.regclass
        and conname = 'leads_organization_id_fkey'
    ) = 1,
    'final composite FK is unique, legacy FK is absent and organization FK remains singular'
  );
exception
  when others then
    insert into pg_temp._p9_leads_scope_results values
      (12, 'cleanup e checagens finais', 'HARNESS_ERROR',
       'scenario error: ' || sqlstate || ': ' || sqlerrm, sqlstate, null);
end;
$cleanup_and_checks$;

select
  scenario_number,
  scenario_name,
  status,
  detail,
  returned_sqlstate,
  constraint_name
from pg_temp._p9_leads_scope_results
order by scenario_number;

do $guard$
declare
  v_failure_report text;
begin
  if (select count(*) from pg_temp._p9_leads_scope_results where scenario_number between 1 and 14) <> 14 then
    raise exception using
      errcode = 'P0001',
      message = 'runner did not emit the required 14 scenarios';
  end if;

  select string_agg(
           format(
             'scenario %s | %s | %s | sqlstate=%s | constraint=%s | detail=%s',
             result_row.scenario_number,
             result_row.scenario_name,
             result_row.status,
             coalesce(result_row.returned_sqlstate, '<null>'),
             coalesce(result_row.constraint_name, '<null>'),
             left(result_row.detail, 400)
           ),
           E'\n'
           order by result_row.scenario_number
         )
    into v_failure_report
  from pg_temp._p9_leads_scope_results result_row
  where result_row.status <> 'PASS';

  if v_failure_report is not null then
    raise exception using
      errcode = 'P0001',
      message = 'harden_leads_store_scope runner detected failures:' || E'\n' || v_failure_report;
  end if;
end;
$guard$;

rollback;

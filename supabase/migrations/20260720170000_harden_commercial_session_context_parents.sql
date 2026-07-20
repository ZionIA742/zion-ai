-- ZION / Pilar 9 / Fase 4 / 4.1A-3
-- Endurece entidades-pai antes da futura criacao de commercial_session_context_links.
--
-- Escopo:
-- - amplia imutabilidade central de conversation_sessions;
-- - amplia imutabilidade central de commercial_opportunities;
-- - endurece a funcao de timestamps de commercial_opportunities;
-- - cria chaves unicas compostas para futuras FKs compostas;
-- - aborta em caso de aplicacao parcial ou schema inesperado.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:commercial-session-context:parents-hardening:v1',
    0
  )
);

-- --------------------------------------------------------------------------
-- Preflight estrutural: a migration so pode rodar sobre o estado esperado.
-- --------------------------------------------------------------------------

do $preflight$
declare
  v_count integer;
begin
  if pg_catalog.to_regclass('public.conversation_sessions') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.lead_customer_links') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: required parent tables are missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.conversation_session_apply_write_rules()'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.prevent_conversation_session_organization_change()'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.touch_commercial_opportunity_timestamps()'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.prevent_commercial_opportunity_organization_change()'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.enforce_lead_customer_link_write_rules()'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: expected trigger functions are missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.prevent_conversation_session_core_change()'
     ) is not null
     or pg_catalog.to_regprocedure(
       'public.prevent_commercial_opportunity_core_change()'
     ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: core immutability functions already exist';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class cls
    join pg_catalog.pg_namespace nsp
      on nsp.oid = cls.relnamespace
    where nsp.nspname = 'public'
      and cls.relkind = 'i'
      and cls.relname in (
        'commercial_opportunities_id_org_store_customer_uidx',
        'lead_customer_links_id_org_store_customer_uidx'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: one or more target indexes already exist';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c
      on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n
      on n.oid = c.relnamespace
    where not t.tgisinternal
      and n.nspname = 'public'
      and (
        (c.relname = 'conversation_sessions'
         and t.tgname = 'conversation_sessions_00_prevent_core_change')
        or
        (c.relname = 'commercial_opportunities'
         and t.tgname = 'commercial_opportunities_prevent_core_change')
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: replacement immutability triggers already exist';
  end if;

  select count(*)
    into v_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c
    on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n
    on n.oid = c.relnamespace
  join pg_catalog.pg_proc p
    on p.oid = t.tgfoid
  join pg_catalog.pg_namespace pn
    on pn.oid = p.pronamespace
  where not t.tgisinternal
    and n.nspname = 'public'
    and c.relname = 'conversation_sessions'
    and t.tgname = 'conversation_sessions_apply_write_rules'
    and t.tgenabled = 'O'
    and t.tgtype = 23
    and pn.nspname = 'public'
    and p.proname = 'conversation_session_apply_write_rules';

  if v_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: conversation_sessions write-rules trigger binding is unexpected';
  end if;

  select count(*)
    into v_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c
    on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n
    on n.oid = c.relnamespace
  join pg_catalog.pg_proc p
    on p.oid = t.tgfoid
  join pg_catalog.pg_namespace pn
    on pn.oid = p.pronamespace
  where not t.tgisinternal
    and n.nspname = 'public'
    and c.relname = 'conversation_sessions'
    and t.tgname = 'conversation_sessions_prevent_organization_change'
    and t.tgenabled = 'O'
    and t.tgtype = 19
    and pn.nspname = 'public'
    and p.proname = 'prevent_conversation_session_organization_change';

  if v_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: conversation_sessions organization immutability trigger binding is unexpected';
  end if;

  select count(*)
    into v_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c
    on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n
    on n.oid = c.relnamespace
  join pg_catalog.pg_proc p
    on p.oid = t.tgfoid
  join pg_catalog.pg_namespace pn
    on pn.oid = p.pronamespace
  where not t.tgisinternal
    and n.nspname = 'public'
    and c.relname = 'commercial_opportunities'
    and t.tgname = 'commercial_opportunities_touch_timestamps'
    and t.tgenabled = 'O'
    and t.tgtype = 19
    and pn.nspname = 'public'
    and p.proname = 'touch_commercial_opportunity_timestamps';

  if v_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: commercial_opportunities timestamp trigger binding is unexpected';
  end if;

  select count(*)
    into v_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c
    on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n
    on n.oid = c.relnamespace
  join pg_catalog.pg_proc p
    on p.oid = t.tgfoid
  join pg_catalog.pg_namespace pn
    on pn.oid = p.pronamespace
  where not t.tgisinternal
    and n.nspname = 'public'
    and c.relname = 'commercial_opportunities'
    and t.tgname = 'commercial_opportunities_prevent_organization_change'
    and t.tgenabled = 'O'
    and t.tgtype = 19
    and pn.nspname = 'public'
    and p.proname = 'prevent_commercial_opportunity_organization_change';

  if v_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: commercial_opportunities organization immutability trigger binding is unexpected';
  end if;

end;
$preflight$;

-- --------------------------------------------------------------------------
-- Conversation sessions: imutabilidade dos campos centrais.
-- --------------------------------------------------------------------------

create or replace function public.prevent_conversation_session_core_change()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if new.organization_id is distinct from old.organization_id
     or new.store_id is distinct from old.store_id
     or new.conversation_id is distinct from old.conversation_id then
    raise exception using
      errcode = 'P0001',
      message = 'conversation session core fields are immutable';
  end if;

  return new;
end;
$function$;

alter function public.prevent_conversation_session_core_change()
  owner to postgres;

comment on function public.prevent_conversation_session_core_change() is
  'Impede alteracao de organization_id, store_id e conversation_id apos o insert de conversation_sessions.';

revoke all on function public.prevent_conversation_session_core_change()
  from public, anon, authenticated, service_role;

drop trigger conversation_sessions_prevent_organization_change
  on public.conversation_sessions;

create trigger conversation_sessions_00_prevent_core_change
  before update on public.conversation_sessions
  for each row
  execute function public.prevent_conversation_session_core_change();

drop function public.prevent_conversation_session_organization_change();

-- --------------------------------------------------------------------------
-- Commercial opportunities: timestamps endurecidos e campos centrais imutaveis.
-- --------------------------------------------------------------------------

create or replace function public.touch_commercial_opportunity_timestamps()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  new.updated_at := v_now;

  if new.stage is distinct from old.stage then
    new.stage_changed_at := v_now;
  else
    new.stage_changed_at := old.stage_changed_at;
  end if;

  return new;
end;
$function$;

alter function public.touch_commercial_opportunity_timestamps()
  owner to postgres;

comment on function public.touch_commercial_opportunity_timestamps() is
  'Atualiza updated_at e move stage_changed_at somente quando o stage de commercial_opportunities muda.';

revoke all on function public.touch_commercial_opportunity_timestamps()
  from public, anon, authenticated, service_role;

create or replace function public.prevent_commercial_opportunity_core_change()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if new.organization_id is distinct from old.organization_id
     or new.store_id is distinct from old.store_id
     or new.customer_id is distinct from old.customer_id then
    raise exception using
      errcode = 'P0001',
      message = 'commercial opportunity core fields are immutable';
  end if;

  return new;
end;
$function$;

alter function public.prevent_commercial_opportunity_core_change()
  owner to postgres;

comment on function public.prevent_commercial_opportunity_core_change() is
  'Impede alteracao de organization_id, store_id e customer_id apos o insert de commercial_opportunities.';

revoke all on function public.prevent_commercial_opportunity_core_change()
  from public, anon, authenticated, service_role;

drop trigger commercial_opportunities_prevent_organization_change
  on public.commercial_opportunities;

create trigger commercial_opportunities_prevent_core_change
  before update on public.commercial_opportunities
  for each row
  execute function public.prevent_commercial_opportunity_core_change();

drop function public.prevent_commercial_opportunity_organization_change();

-- --------------------------------------------------------------------------
-- Indices compostos exatos para futuras FKs compostas.
-- --------------------------------------------------------------------------

create unique index commercial_opportunities_id_org_store_customer_uidx
  on public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id
  );

create unique index lead_customer_links_id_org_store_customer_uidx
  on public.lead_customer_links (
    id,
    organization_id,
    store_id,
    customer_id
  );

-- --------------------------------------------------------------------------
-- Postconditions: confirma bindings, hardening e ausencia de aplicacao parcial.
-- --------------------------------------------------------------------------

do $postconditions$
declare
  v_count integer;
  v_definition text;
begin
  if pg_catalog.to_regprocedure(
       'public.prevent_conversation_session_organization_change()'
     ) is not null
     or pg_catalog.to_regprocedure(
       'public.prevent_commercial_opportunity_organization_change()'
     ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: legacy organization-only immutability functions still exist';
  end if;

  if pg_catalog.to_regprocedure(
       'public.prevent_conversation_session_core_change()'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.prevent_commercial_opportunity_core_change()'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: replacement core immutability functions were not created';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid =
          'public.prevent_conversation_session_core_change()'::pg_catalog.regprocedure
      and p.proconfig @> array['search_path=pg_catalog, pg_temp']::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: conversation session core immutability function is not hardened';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid =
          'public.prevent_commercial_opportunity_core_change()'::pg_catalog.regprocedure
      and p.proconfig @> array['search_path=pg_catalog, pg_temp']::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: commercial opportunity core immutability function is not hardened';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid =
          'public.touch_commercial_opportunity_timestamps()'::pg_catalog.regprocedure
      and p.proconfig @> array['search_path=pg_catalog, pg_temp']::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: commercial opportunity timestamp function search_path is not hardened';
  end if;

  select pg_catalog.lower(
           pg_catalog.pg_get_functiondef(
             'public.touch_commercial_opportunity_timestamps()'::pg_catalog.regprocedure
           )
         )
    into v_definition;

  if pg_catalog.strpos(
       v_definition,
       'pg_catalog.clock_timestamp()'
     ) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: commercial opportunity timestamp function clock source is not hardened';
  end if;

  select count(*)
    into v_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c
    on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n
    on n.oid = c.relnamespace
  join pg_catalog.pg_proc p
    on p.oid = t.tgfoid
  join pg_catalog.pg_namespace pn
    on pn.oid = p.pronamespace
  where not t.tgisinternal
    and n.nspname = 'public'
    and c.relname = 'conversation_sessions'
    and t.tgname = 'conversation_sessions_apply_write_rules'
    and t.tgenabled = 'O'
    and t.tgtype = 23
    and pn.nspname = 'public'
    and p.proname = 'conversation_session_apply_write_rules';

  if v_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: conversation_sessions_apply_write_rules was changed unexpectedly';
  end if;

  select count(*)
    into v_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c
    on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n
    on n.oid = c.relnamespace
  join pg_catalog.pg_proc p
    on p.oid = t.tgfoid
  join pg_catalog.pg_namespace pn
    on pn.oid = p.pronamespace
  where not t.tgisinternal
    and n.nspname = 'public'
    and c.relname = 'conversation_sessions'
    and t.tgname = 'conversation_sessions_00_prevent_core_change'
    and t.tgenabled = 'O'
    and t.tgtype = 19
    and pn.nspname = 'public'
    and p.proname = 'prevent_conversation_session_core_change';

  if v_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: conversation_sessions core immutability trigger binding is invalid';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c
      on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n
      on n.oid = c.relnamespace
    where not t.tgisinternal
      and n.nspname = 'public'
      and c.relname = 'conversation_sessions'
      and t.tgname = 'conversation_sessions_prevent_organization_change'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: legacy conversation_sessions immutability trigger still exists';
  end if;

  select count(*)
    into v_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c
    on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n
    on n.oid = c.relnamespace
  join pg_catalog.pg_proc p
    on p.oid = t.tgfoid
  join pg_catalog.pg_namespace pn
    on pn.oid = p.pronamespace
  where not t.tgisinternal
    and n.nspname = 'public'
    and c.relname = 'commercial_opportunities'
    and t.tgname = 'commercial_opportunities_touch_timestamps'
    and t.tgenabled = 'O'
    and t.tgtype = 19
    and pn.nspname = 'public'
    and p.proname = 'touch_commercial_opportunity_timestamps';

  if v_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: commercial_opportunities_touch_timestamps binding is invalid';
  end if;

  select count(*)
    into v_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c
    on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n
    on n.oid = c.relnamespace
  join pg_catalog.pg_proc p
    on p.oid = t.tgfoid
  join pg_catalog.pg_namespace pn
    on pn.oid = p.pronamespace
  where not t.tgisinternal
    and n.nspname = 'public'
    and c.relname = 'commercial_opportunities'
    and t.tgname = 'commercial_opportunities_prevent_core_change'
    and t.tgenabled = 'O'
    and t.tgtype = 19
    and pn.nspname = 'public'
    and p.proname = 'prevent_commercial_opportunity_core_change';

  if v_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: commercial_opportunities core immutability trigger binding is invalid';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c
      on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n
      on n.oid = c.relnamespace
    where not t.tgisinternal
      and n.nspname = 'public'
      and c.relname = 'commercial_opportunities'
      and t.tgname = 'commercial_opportunities_prevent_organization_change'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: legacy commercial_opportunities immutability trigger still exists';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class index_relation
    join pg_catalog.pg_namespace index_namespace
      on index_namespace.oid = index_relation.relnamespace
    join pg_catalog.pg_index index_row
      on index_row.indexrelid = index_relation.oid
    join pg_catalog.pg_class table_relation
      on table_relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = table_relation.relnamespace
    where index_namespace.nspname = 'public'
      and index_relation.relname =
          'commercial_opportunities_id_org_store_customer_uidx'
      and index_relation.relkind = 'i'
      and table_namespace.nspname = 'public'
      and table_relation.relname = 'commercial_opportunities'
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indexprs is null
      and index_row.indpred is null
      and index_row.indnatts = 4
      and index_row.indnkeyatts = 4
      and (
        select pg_catalog.array_agg(
                 attribute_row.attname::text
                 order by key_column.ordinality
               )
        from pg_catalog.unnest(
               index_row.indkey::smallint[]
             ) with ordinality
             as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = index_row.indrelid
         and attribute_row.attnum = key_column.attnum
      ) = array[
        'id',
        'organization_id',
        'store_id',
        'customer_id'
      ]::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: commercial_opportunities composite unique index definition is invalid';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class index_relation
    join pg_catalog.pg_namespace index_namespace
      on index_namespace.oid = index_relation.relnamespace
    join pg_catalog.pg_index index_row
      on index_row.indexrelid = index_relation.oid
    join pg_catalog.pg_class table_relation
      on table_relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = table_relation.relnamespace
    where index_namespace.nspname = 'public'
      and index_relation.relname =
          'lead_customer_links_id_org_store_customer_uidx'
      and index_relation.relkind = 'i'
      and table_namespace.nspname = 'public'
      and table_relation.relname = 'lead_customer_links'
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indexprs is null
      and index_row.indpred is null
      and index_row.indnatts = 4
      and index_row.indnkeyatts = 4
      and (
        select pg_catalog.array_agg(
                 attribute_row.attname::text
                 order by key_column.ordinality
               )
        from pg_catalog.unnest(
               index_row.indkey::smallint[]
             ) with ordinality
             as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = index_row.indrelid
         and attribute_row.attnum = key_column.attnum
      ) = array[
        'id',
        'organization_id',
        'store_id',
        'customer_id'
      ]::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: lead_customer_links composite unique index definition is invalid';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) privilege_row
    where procedure_row.oid in (
      'public.prevent_conversation_session_core_change()'::pg_catalog.regprocedure,
      'public.touch_commercial_opportunity_timestamps()'::pg_catalog.regprocedure,
      'public.prevent_commercial_opportunity_core_change()'::pg_catalog.regprocedure
    )
      and privilege_row.grantee = 0
      and privilege_row.privilege_type = 'EXECUTE'
  )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.prevent_conversation_session_core_change()',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.prevent_conversation_session_core_change()',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.prevent_conversation_session_core_change()',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.touch_commercial_opportunity_timestamps()',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.touch_commercial_opportunity_timestamps()',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.touch_commercial_opportunity_timestamps()',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.prevent_commercial_opportunity_core_change()',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.prevent_commercial_opportunity_core_change()',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.prevent_commercial_opportunity_core_change()',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: one or more trigger functions still grant EXECUTE unexpectedly';
  end if;
end;
$postconditions$;

commit;

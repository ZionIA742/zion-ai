-- ZION / Pilar 18 / Bloco 3 / Etapa 4
-- Impede novas escritas em state_transition_log com store_id
-- divergente do caminho canonico conversation -> lead -> store.
--
-- Escopo exclusivo:
-- - protege INSERT e alteracoes de conversation_id/store_id;
-- - preserva a protecao de organization_id criada na Etapa 3;
-- - nao altera funcoes escritoras;
-- - nao altera SLA, archive, grants operacionais ou regras comerciais.

begin;

set local lock_timeout = '5s';

set local statement_timeout = '120s';

set local idle_in_transaction_session_timeout = '120s';

set local search_path = pg_catalog, pg_temp, public, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p18:state-transition-log:store-scope-enforcement:v1',
    0
  )
);

do $preflight$
begin
  if pg_catalog.to_regclass('public.state_transition_log') is null
     or pg_catalog.to_regclass('public.conversations') is null
     or pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.stores') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: required canonical scope tables are missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.enforce_state_transition_log_store_scope()'
     ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: store scope enforcement function already exists';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid =
          'public.state_transition_log'::pg_catalog.regclass
      and trigger_row.tgname =
          'state_transition_log_enforce_store_scope'
      and not trigger_row.tgisinternal
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: store scope enforcement trigger already exists';
  end if;

  if pg_catalog.to_regprocedure(
       'public.enforce_state_transition_log_organization_scope()'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: Etapa 3 organization scope enforcement is missing';
  end if;
end;
$preflight$;

create function public.enforce_state_transition_log_store_scope()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_correct_store_id uuid;
begin
  if tg_table_schema <> 'public'
     or tg_table_name <> 'state_transition_log' then
    raise exception using
      errcode = 'P0001',
      message = 'invalid trigger binding for state_transition_log store scope enforcement';
  end if;

  if new.conversation_id is null then
    raise exception using
      errcode = '23514',
      message = 'state_transition_log conversation_id is required for canonical store scope';
  end if;

  select lead_row.store_id
  into v_correct_store_id
  from public.conversations conversation_row
  join public.leads lead_row
    on lead_row.id = conversation_row.lead_id
  join public.stores store_row
    on store_row.id = lead_row.store_id
   and store_row.organization_id = lead_row.organization_id
  where conversation_row.id = new.conversation_id;

  if v_correct_store_id is null then
    raise exception using
      errcode = '23514',
      message = 'state_transition_log canonical store scope could not be resolved';
  end if;

  if new.store_id is distinct from v_correct_store_id then
    raise exception using
      errcode = '23514',
      message = 'state_transition_log store_id does not match canonical conversation scope';
  end if;

  return new;
end;
$function$;

alter function public.enforce_state_transition_log_store_scope()
  owner to postgres;

comment on function public.enforce_state_transition_log_store_scope() is
  'Rejeita state_transition_log cujo store_id diverge do caminho canonico conversation -> lead -> store.';

revoke all on function public.enforce_state_transition_log_store_scope()
  from public, anon, authenticated, service_role;

create trigger state_transition_log_enforce_store_scope
  before insert or update of conversation_id, store_id
  on public.state_transition_log
  for each row
  execute function public.enforce_state_transition_log_store_scope();

do $postconditions$
declare
  v_function_oid oid;
begin
  v_function_oid := pg_catalog.to_regprocedure(
    'public.enforce_state_transition_log_store_scope()'
  );

  if v_function_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: store scope enforcement function was not created';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure_row
    where procedure_row.oid = v_function_oid
      and not procedure_row.prosecdef
      and procedure_row.proconfig @>
          array['search_path=pg_catalog, pg_temp']::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: store scope enforcement function hardening mismatch';
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
    where procedure_row.oid = v_function_oid
      and privilege_row.privilege_type = 'EXECUTE'
      and privilege_row.grantee in (
        0,
        'anon'::pg_catalog.regrole::oid,
        'authenticated'::pg_catalog.regrole::oid,
        'service_role'::pg_catalog.regrole::oid
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: store scope enforcement function grants mismatch';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_proc procedure_row
      on procedure_row.oid = trigger_row.tgfoid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = procedure_row.pronamespace
    where trigger_row.tgrelid =
          'public.state_transition_log'::pg_catalog.regclass
      and trigger_row.tgname =
          'state_transition_log_enforce_store_scope'
      and not trigger_row.tgisinternal
      and trigger_row.tgenabled = 'O'
      and namespace_row.nspname = 'public'
      and procedure_row.proname =
          'enforce_state_transition_log_store_scope'
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: store scope enforcement trigger binding mismatch';
  end if;

  if (
    select count(*)
    from public.state_transition_log log_row
    join public.conversations conversation_row
      on conversation_row.id = log_row.conversation_id
    join public.leads lead_row
      on lead_row.id = conversation_row.lead_id
    join public.stores store_row
      on store_row.id = lead_row.store_id
     and store_row.organization_id = lead_row.organization_id
    where log_row.store_id is distinct from lead_row.store_id
  ) <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: historical store scope mismatches remain';
  end if;
end;
$postconditions$;

commit;

-- ZION / Pilar 18 / Bloco 3 / Etapa 5
-- Corrige log_state_transition preservando assinatura e retorno.
--
-- Escopo exclusivo:
-- - preserva a assinatura publica existente;
-- - preserva o retorno uuid;
-- - valida organization_id e store_id pelo caminho canonico;
-- - endurece o search_path da funcao SECURITY DEFINER;
-- - preserva a geracao deterministica de event_key;
-- - nao altera regras de actor_type, SLA, archive ou funcoes legadas.

begin;

set local lock_timeout = '5s';

set local statement_timeout = '120s';

set local idle_in_transaction_session_timeout = '120s';

set local search_path = pg_catalog, pg_temp, public, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p18:log-state-transition:canonical-scope-and-search-path:v1',
    0
  )
);

do $preflight$
declare
  v_function_oid oid;
begin
  v_function_oid := pg_catalog.to_regprocedure(
    'public.log_state_transition(uuid,uuid,uuid,text,text,text,uuid,text,jsonb)'
  );

  if v_function_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: log_state_transition canonical signature is missing';
  end if;

  if pg_catalog.pg_get_function_result(v_function_oid) <> 'uuid' then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: log_state_transition return type is not uuid';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure_row
    where procedure_row.oid = v_function_oid
      and procedure_row.prosecdef
      and pg_catalog.pg_get_userbyid(procedure_row.proowner) = 'postgres'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: log_state_transition owner or security mode mismatch';
  end if;

  if pg_catalog.to_regclass('public.state_transition_log') is null
     or pg_catalog.to_regclass('public.conversations') is null
     or pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.stores') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: required canonical scope tables are missing';
  end if;

  if pg_catalog.to_regprocedure('extensions.digest(text,text)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: extensions.digest(text,text) is missing';
  end if;
end;
$preflight$;

create or replace function public.log_state_transition(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_from_state text,
  p_to_state text,
  p_actor_type text,
  p_actor_user_id uuid default null::uuid,
  p_reason text default null::text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_id uuid;
  v_event_key text;
  v_canonical_organization_id uuid;
  v_canonical_store_id uuid;
begin
  if p_conversation_id is null then
    raise exception using
      errcode = '23514',
      message = 'log_state_transition conversation_id is required';
  end if;

  select
    lead_row.organization_id,
    lead_row.store_id
  into
    v_canonical_organization_id,
    v_canonical_store_id
  from public.conversations conversation_row
  join public.leads lead_row
    on lead_row.id = conversation_row.lead_id
  join public.stores store_row
    on store_row.id = lead_row.store_id
   and store_row.organization_id = lead_row.organization_id
  where conversation_row.id = p_conversation_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'log_state_transition canonical conversation scope could not be resolved';
  end if;

  if p_organization_id is distinct from v_canonical_organization_id then
    raise exception using
      errcode = '23514',
      message = 'log_state_transition organization_id does not match canonical conversation scope';
  end if;

  if p_store_id is distinct from v_canonical_store_id then
    raise exception using
      errcode = '23514',
      message = 'log_state_transition store_id does not match canonical conversation scope';
  end if;

  v_event_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.coalesce(p_organization_id::text, '') ||
      pg_catalog.coalesce(p_store_id::text, '') ||
      pg_catalog.coalesce(p_conversation_id::text, '') ||
      pg_catalog.coalesce(p_from_state, '') ||
      pg_catalog.coalesce(p_to_state, '') ||
      pg_catalog.coalesce(p_actor_type, '') ||
      pg_catalog.coalesce(p_actor_user_id::text, '') ||
      pg_catalog.coalesce(p_reason, ''),
      'sha256'::text
    ),
    'hex'::text
  );

  insert into public.state_transition_log (
    organization_id,
    store_id,
    conversation_id,
    from_state,
    to_state,
    actor_type,
    actor_user_id,
    reason,
    metadata,
    event_key
  )
  values (
    p_organization_id,
    p_store_id,
    p_conversation_id,
    p_from_state,
    p_to_state,
    p_actor_type,
    p_actor_user_id,
    p_reason,
    pg_catalog.coalesce(p_metadata, '{}'::jsonb),
    v_event_key
  )
  returning id into v_id;

  return v_id;
end;
$function$;

alter function public.log_state_transition(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  jsonb
) owner to postgres;

comment on function public.log_state_transition(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  jsonb
) is
  'Registra transicao de estado com escopo canonico conversation -> lead -> store e event_key deterministico.';

revoke all on function public.log_state_transition(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.log_state_transition(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  jsonb
) to service_role;

do $postconditions$
declare
  v_function_oid oid;
  v_definition text;
begin
  v_function_oid := pg_catalog.to_regprocedure(
    'public.log_state_transition(uuid,uuid,uuid,text,text,text,uuid,text,jsonb)'
  );

  if v_function_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: log_state_transition canonical signature is missing';
  end if;

  if pg_catalog.pg_get_function_result(v_function_oid) <> 'uuid' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: log_state_transition return type changed';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure_row
    where procedure_row.oid = v_function_oid
      and procedure_row.prosecdef
      and pg_catalog.pg_get_userbyid(procedure_row.proowner) = 'postgres'
      and procedure_row.proconfig @>
          array['search_path=pg_catalog, pg_temp']::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: log_state_transition hardening mismatch';
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
        'authenticated'::pg_catalog.regrole::oid
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: log_state_transition public grants mismatch';
  end if;

  if not pg_catalog.has_function_privilege(
    'service_role',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: service_role lost EXECUTE on log_state_transition';
  end if;

  v_definition := pg_catalog.lower(
    pg_catalog.pg_get_functiondef(v_function_oid)
  );

  if v_definition not like '%extensions.digest%'
     or v_definition not like '%public.conversations%'
     or v_definition not like '%public.leads%'
     or v_definition not like '%public.stores%'
     or v_definition not like '%insert into public.state_transition_log%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: log_state_transition canonical implementation mismatch';
  end if;
end;
$postconditions$;

commit;

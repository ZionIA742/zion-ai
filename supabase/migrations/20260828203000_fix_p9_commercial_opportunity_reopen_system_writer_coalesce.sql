begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    '20260828203000_fix_p9_commercial_opportunity_reopen_system_writer_coalesce',
    0
  )
);

do $preflight$
begin
  if pg_catalog.to_regprocedure(
       'public.apply_commercial_opportunity_reopen_internal(uuid,uuid,uuid,text,text,text,text,text,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.reopen_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,text)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: P9 system reopen writer foundation is missing';
  end if;
end;
$preflight$;

create or replace function public.reopen_commercial_opportunity_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_idempotency_key text,
  p_target_stage text,
  p_reason_details text,
  p_source text default 'system_reopen'
)
returns table (
  commercial_opportunity_id uuid,
  stage text,
  lifecycle_cycle integer,
  current_loss_event_id uuid,
  last_reopened_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
begin
  if v_request_role is distinct from 'service_role'
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity reopen by system is not authorized';
  end if;

  return query
  select *
  from public.apply_commercial_opportunity_reopen_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_idempotency_key,
    p_target_stage,
    p_reason_details,
    p_source,
    'system',
    null
  );
end;
$function$;

alter function public.reopen_commercial_opportunity_by_system(
  uuid, uuid, uuid, text, text, text, text
) owner to postgres;

revoke all on function public.reopen_commercial_opportunity_by_system(
  uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.reopen_commercial_opportunity_by_system(
  uuid, uuid, uuid, text, text, text, text
) to service_role;

comment on function public.reopen_commercial_opportunity_by_system(
  uuid, uuid, uuid, text, text, text, text
) is
  'Writer canonico service_role-only para reabrir opportunity perdida quando uma regra de sistema provou a mesma intencao.';

do $postconditions$
declare
  v_oid oid;
  v_definition text;
  v_normalized text;
begin
  v_oid := pg_catalog.to_regprocedure(
    'public.reopen_commercial_opportunity_by_system(uuid,uuid,uuid,text,text,text,text)'
  );

  if v_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: system reopen writer is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_oid
      and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
      and proc_row.prosecdef
      and proc_row.proconfig @> array[
        'search_path=pg_catalog, pg_temp, public',
        'row_security=off'
      ]::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: system reopen writer hardening mismatch';
  end if;

  if pg_catalog.has_function_privilege(
       'authenticated',
       v_oid,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       v_oid,
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       v_oid,
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: system reopen writer grants mismatch';
  end if;

  select pg_catalog.pg_get_functiondef(v_oid)
  into v_definition;

  v_normalized := pg_catalog.regexp_replace(
    pg_catalog.lower(coalesce(v_definition, '')),
    '\s+',
    ' ',
    'g'
  );

  if pg_catalog.strpos(v_normalized, 'coalesce(') = 0
     or pg_catalog.strpos(v_normalized, 'pg_catalog.coalesce(') > 0
     or pg_catalog.strpos(v_normalized, 'request.jwt.claim.role') = 0
     or pg_catalog.strpos(v_normalized, 'auth.jwt()') = 0
     or pg_catalog.strpos(v_normalized, '''service_role''') = 0
     or pg_catalog.strpos(v_normalized, 'apply_commercial_opportunity_reopen_internal') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: corrected system reopen writer definition mismatch';
  end if;
end;
$postconditions$;

commit;

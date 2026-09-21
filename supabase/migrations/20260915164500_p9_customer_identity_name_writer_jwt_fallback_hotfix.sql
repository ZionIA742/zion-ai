begin;

-- ============================================================================
-- P9 / 5.5.6
-- Hotfix: service_role authorization fallback for customer identity name writer
--
-- Context:
-- - The original wrapper only inspected request.jwt.claim.role.
-- - PostgREST/Supabase service-role calls may expose the role through auth.jwt().
-- - Existing hardened P9 system writers already use this fallback pattern.
-- ============================================================================

create or replace function public.write_customer_identity_name_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_lead_id uuid,
  p_conversation_id uuid,
  p_source_message_id uuid,
  p_operation_key text,
  p_display_name text,
  p_created_by text default 'sales_ai_identity_name_extractor_v1'
)
returns table (
  lead_id uuid,
  customer_id uuid,
  display_name text,
  normalized_name text,
  changed boolean,
  outcome text,
  event_id uuid,
  updated_at timestamptz
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
      message = 'customer identity name write by system is not authorized';
  end if;

  return query
  select *
  from public.apply_customer_identity_name_internal(
    p_organization_id,
    p_store_id,
    p_lead_id,
    p_conversation_id,
    p_source_message_id,
    p_operation_key,
    p_display_name,
    p_created_by
  );
end;
$function$;

alter function public.write_customer_identity_name_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text, text
) owner to postgres;

revoke all on function public.write_customer_identity_name_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.write_customer_identity_name_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text, text
) to service_role;

do $postconditions$
declare
  v_proc_oid oid;
  v_definition text;
  v_normalized_definition text;
begin
  v_proc_oid := pg_catalog.to_regprocedure(
    'public.write_customer_identity_name_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text)'
  );

  if v_proc_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: customer identity name system writer missing';
  end if;

  select pg_catalog.pg_get_functiondef(v_proc_oid)
  into v_definition;

  v_normalized_definition := pg_catalog.regexp_replace(
    coalesce(v_definition, ''),
    '\s+',
    ' ',
    'g'
  );

  if position(
       'current_setting(''request.jwt.claim.role'', true)'
       in v_normalized_definition
     ) = 0
     or position(
       'auth.jwt() ->> ''role'''
       in v_normalized_definition
     ) = 0
     or position('service_role' in v_normalized_definition) = 0
     or position(
       'session_user <> ''postgres'''
       in v_normalized_definition
     ) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: customer identity name jwt fallback markers missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_proc_oid
      and (
        proc_row.prosecdef is not true
        or pg_catalog.pg_get_userbyid(proc_row.proowner) <> 'postgres'
        or proc_row.proconfig is null
        or not proc_row.proconfig @> array[
          'search_path=pg_catalog, pg_temp, public',
          'row_security=off'
        ]::text[]
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: customer identity name security-definer contract changed';
  end if;

  if pg_catalog.has_function_privilege(
       'anon',
       'public.write_customer_identity_name_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.write_customer_identity_name_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.write_customer_identity_name_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: customer identity name wrapper grants mismatch';
  end if;

  if pg_catalog.has_function_privilege(
       'service_role',
       'public.apply_customer_identity_name_internal(uuid,uuid,uuid,uuid,uuid,text,text,text)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: customer identity internal writer exposed to service_role';
  end if;
end;
$postconditions$;

comment on function public.write_customer_identity_name_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text, text
) is
  'Server-only writer for explicit customer self-declared names. Accepts service_role via legacy request.jwt.claim.role or auth.jwt() role fallback, with postgres allowed for controlled SQL maintenance/tests.';

commit;

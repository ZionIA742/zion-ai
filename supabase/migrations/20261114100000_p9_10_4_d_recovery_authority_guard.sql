-- P9 10.4-D: canonical, tenant-scoped recovery fence.
-- This is intentionally a transaction-local authority. Callers must invoke it
-- immediately before every recovery writer; a stale/ambiguous scope is never
-- treated as permission to continue.

begin;

create or replace function public.assert_p9_10_4_d_recovery_write_authority_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_conversation public.conversations%rowtype;
  v_lease public.conversation_human_takeover_leases%rowtype;
begin
  select c.* into v_conversation
    from public.conversations c
    join public.leads l on l.id = c.lead_id
      and l.organization_id = p_organization_id
      and l.store_id = p_store_id
    join public.stores s on s.id = l.store_id
      and s.organization_id = l.organization_id
   where c.id = p_conversation_id
     and c.organization_id = p_organization_id
   for update of c;
  if not found then return false; end if;

  select h.* into v_lease
    from public.conversation_human_takeover_leases h
   where h.conversation_id = p_conversation_id
     and h.organization_id = p_organization_id
     and h.store_id = p_store_id
   for update;

  if coalesce(v_conversation.is_human_active, false)
     or pg_catalog.lower(pg_catalog.btrim(coalesce(v_conversation.status, ''))) = 'humano_assumiu'
     or coalesce(v_lease.hard_hold, false)
     or (found and v_lease.released_at is null) then
    return false;
  end if;
  return true;
end;
$function$;

alter function public.assert_p9_10_4_d_recovery_write_authority_by_system(uuid, uuid, uuid)
  owner to postgres;
revoke all on function public.assert_p9_10_4_d_recovery_write_authority_by_system(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.assert_p9_10_4_d_recovery_write_authority_by_system(uuid, uuid, uuid)
  to service_role;

do $postconditions$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.assert_p9_10_4_d_recovery_write_authority_by_system(uuid,uuid,uuid)'::regprocedure
  );
begin
  if pg_catalog.strpos(v_definition, 'for update of c') = 0
     or pg_catalog.strpos(v_definition, 'conversation_human_takeover_leases') = 0
     or pg_catalog.strpos(v_definition, 'humano_assumiu') = 0
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.assert_p9_10_4_d_recovery_write_authority_by_system(uuid,uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_RECOVERY_AUTHORITY_POSTCONDITION_FAILED';
  end if;
end;
$postconditions$;

commit;

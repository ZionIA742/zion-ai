-- P0 emergency repair. Apply only after the read-only preflight confirms that
-- public.process_stale_human_conversations() is the installed timeout authority.
-- This is intentionally independent of the unregistered 10.5 migrations.

begin;

create or replace function public.process_stale_human_conversations()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
begin
  -- Emergency fail-closed behavior: the legacy timeout authority is inert.
  return 0;
end;
$function$;

alter function public.process_stale_human_conversations() owner to postgres;
revoke all on function public.process_stale_human_conversations() from public, anon, authenticated;
grant execute on function public.process_stale_human_conversations() to service_role;

do $postcondition$
declare
  v_definition text := pg_catalog.lower(
    pg_catalog.pg_get_functiondef(
      'public.process_stale_human_conversations()'::pg_catalog.regprocedure
    )
  );
begin
  if pg_catalog.strpos(v_definition, 'returns integer') = 0
     or pg_catalog.strpos(v_definition, 'return 0') = 0
     or pg_catalog.strpos(v_definition, 'release_human_takeover') <> 0
     or pg_catalog.strpos(v_definition, 'transition_conversation_state') <> 0
     or pg_catalog.strpos(v_definition, 'conversation_human_takeover_leases') <> 0
     or pg_catalog.strpos(v_definition, 'insert into') <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'P9_10_3_P0_EMERGENCY_REPAIR_POSTCONDITION_FAILED';
  end if;
end;
$postcondition$;

commit;

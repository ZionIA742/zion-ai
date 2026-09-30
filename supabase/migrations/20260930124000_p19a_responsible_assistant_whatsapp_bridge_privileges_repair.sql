-- P19-A / Bloco 5 / Etapa 5.1
-- Repair: restrict service_role privileges on the responsible WhatsApp -> Assistant bridge ledger.
-- The original bridge migration can inherit broad Supabase default privileges for service_role.
-- This repair makes the intended least-privilege contract explicit.

begin;

revoke all privileges
  on table public.store_assistant_responsible_whatsapp_events
  from public, anon, authenticated, service_role;

grant select, insert, update
  on table public.store_assistant_responsible_whatsapp_events
  to service_role;

do $$
begin
  if has_table_privilege(
       'anon',
       'public.store_assistant_responsible_whatsapp_events',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     or has_table_privilege(
       'authenticated',
       'public.store_assistant_responsible_whatsapp_events',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     ) then
    raise exception 'P19A_5_1_LEDGER_UNEXPECTED_CLIENT_PRIVILEGE';
  end if;

  if not has_table_privilege(
       'service_role',
       'public.store_assistant_responsible_whatsapp_events',
       'SELECT'
     )
     or not has_table_privilege(
       'service_role',
       'public.store_assistant_responsible_whatsapp_events',
       'INSERT'
     )
     or not has_table_privilege(
       'service_role',
       'public.store_assistant_responsible_whatsapp_events',
       'UPDATE'
     ) then
    raise exception 'P19A_5_1_LEDGER_REQUIRED_SERVICE_ROLE_PRIVILEGE_MISSING';
  end if;

  if has_table_privilege(
       'service_role',
       'public.store_assistant_responsible_whatsapp_events',
       'DELETE'
     )
     or has_table_privilege(
       'service_role',
       'public.store_assistant_responsible_whatsapp_events',
       'TRUNCATE'
     )
     or has_table_privilege(
       'service_role',
       'public.store_assistant_responsible_whatsapp_events',
       'REFERENCES'
     )
     or has_table_privilege(
       'service_role',
       'public.store_assistant_responsible_whatsapp_events',
       'TRIGGER'
     ) then
    raise exception 'P19A_5_1_LEDGER_EXCESS_SERVICE_ROLE_PRIVILEGE';
  end if;
end;
$$;

commit;

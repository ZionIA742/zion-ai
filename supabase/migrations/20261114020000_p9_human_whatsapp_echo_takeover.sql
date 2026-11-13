-- P9 Block 10 / Etapa 10.2
-- Extend the canonical message writer so a verified Business App echo enters
-- human takeover in the same transaction as message persistence.

do $migration$
declare
  v_oid oid;
  v_definition text;
  v_patched text;
  v_marker text := $$and coalesce(p_metadata ->> 'source', '') = 'panel'
     and (
       coalesce(p_metadata ->> 'outbound_origin', '') = 'crm_manual_text'
       or coalesce(p_metadata ->> 'source_channel', '') = 'panel_manual'
     )$$;
  v_replacement text := $$and (
       (
         coalesce(p_metadata ->> 'source', '') = 'panel'
         and (
           coalesce(p_metadata ->> 'outbound_origin', '') = 'crm_manual_text'
           or coalesce(p_metadata ->> 'source_channel', '') = 'panel_manual'
         )
       )
       or (
         coalesce(p_metadata ->> 'source', '') = 'meta_whatsapp_webhook'
         and coalesce(p_metadata ->> 'origin', '') = 'whatsapp_business_app'
         and coalesce(p_metadata ->> 'event_kind', '') = 'message_echo'
       )
     )$$;
begin
  select procedure_row.oid, pg_catalog.pg_get_functiondef(procedure_row.oid)
    into v_oid, v_definition
  from pg_catalog.pg_proc procedure_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = procedure_row.pronamespace
  where namespace_row.nspname = 'public'
    and procedure_row.oid =
      'public.insert_message(uuid,text,text,text,text,text,text,jsonb)'::regprocedure;

  if v_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_10_2_PRECONDITION_INSERT_MESSAGE_MISSING';
  end if;

  if pg_catalog.strpos(v_definition, v_marker) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'P9_10_2_PRECONDITION_PANEL_TAKEOVER_MARKER_MISSING';
  end if;

  v_patched := pg_catalog.replace(v_definition, v_marker, v_replacement);
  execute v_patched;

  select pg_catalog.pg_get_functiondef(procedure_row.oid)
    into v_definition
  from pg_catalog.pg_proc procedure_row
  where procedure_row.oid = v_oid;

  if pg_catalog.strpos(v_definition, 'whatsapp_business_app') = 0
     or pg_catalog.strpos(v_definition, 'message_echo') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'P9_10_2_POSTCONDITION_ECHO_TAKEOVER_MISSING';
  end if;
end;
$migration$;

-- The pending-PIN materializer is SECURITY DEFINER.  Its idempotent replay
-- path must establish the WABA identity independently of the HTTP route.
-- Keep this as an append-only correction so it is safe when the preceding
-- migration has already been applied in an environment.
do $migration$
declare
  v_function_oid oid;
  v_definition text;
  v_patched_definition text;
  v_marker text := $marker$
  if found and v_integration.is_active is true
     and v_integration.metadata ->> 'pin_activation_pending' is distinct from 'true' then$marker$;
  v_replacement text := $replacement$
  if found and v_integration.is_active is true
     and v_integration.metadata ->> 'pin_activation_pending' is distinct from 'true' then
    if nullif(pg_catalog.btrim(coalesce(v_integration.whatsapp_business_account_id, '')), '') is null
       or nullif(pg_catalog.btrim(coalesce(p_whatsapp_business_account_id, '')), '') is null
       or pg_catalog.btrim(v_integration.whatsapp_business_account_id)
          is distinct from pg_catalog.btrim(p_whatsapp_business_account_id) then
      raise exception using
        errcode = '42501',
        message = 'ZION_WHATSAPP_PIN_PENDING_WABA_SCOPE_MISMATCH';
    end if;$replacement$;
begin
  select pg_catalog.to_regprocedure(
    'public.materialize_store_whatsapp_signup_pending_pin_by_system(uuid,uuid,text,text,text,text,text,text,timestamptz)'
  )
    into v_function_oid;

  if v_function_oid is null then
    raise exception using
      errcode = '42883',
      message = 'ZION_WHATSAPP_PIN_PENDING_MATERIALIZER_NOT_FOUND';
  end if;

  select pg_catalog.pg_get_functiondef(v_function_oid)
    into v_definition;

  if pg_catalog.strpos(v_definition, v_marker) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_WHATSAPP_PIN_PENDING_MATERIALIZER_PATCH_PRECONDITION_FAILED';
  end if;

  v_patched_definition := pg_catalog.replace(v_definition, v_marker, v_replacement);
  execute v_patched_definition;

  select pg_catalog.pg_get_functiondef(v_function_oid)
    into v_definition;

  if pg_catalog.strpos(v_definition, 'ZION_WHATSAPP_PIN_PENDING_WABA_SCOPE_MISMATCH') = 0
     or pg_catalog.strpos(v_definition, 'p_whatsapp_business_account_id') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_WHATSAPP_PIN_PENDING_MATERIALIZER_PATCH_POSTCONDITION_FAILED';
  end if;
end;
$migration$;

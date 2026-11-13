begin;

-- Conventional Cloud API first connections must not become operational while
-- their mandatory two-step PIN is still pending. Coexistence intentionally
-- continues to use the original materializer and never calls this function.
create or replace function public.materialize_store_whatsapp_embedded_signup_pending_pin_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_whatsapp_business_account_id text,
  p_phone_number_id text,
  p_display_phone_number text,
  p_access_token text,
  p_meta_graph_api_version text default null,
  p_meta_app_id text default null,
  p_validated_at timestamptz default now()
)
returns table (
  integration_id uuid,
  outcome text,
  provider text,
  status text,
  is_active boolean,
  phone_number_id text,
  whatsapp_business_account_id text,
  display_phone_number text
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
as $function$
declare
  v_result record;
  v_integration public.external_integrations%rowtype;
  v_active_secret_id uuid;
begin
  select integration_row.* into v_integration
    from public.external_integrations integration_row
   where integration_row.organization_id = p_organization_id
     and integration_row.store_id = p_store_id
     and integration_row.provider = 'whatsapp'
     and integration_row.phone_number_id = btrim(p_phone_number_id)
   for update;

  if found and v_integration.is_active is true
     and v_integration.metadata ->> 'pin_activation_pending' is distinct from 'true' then
    select secret_row.id into v_active_secret_id
      from public.whatsapp_phone_security_secrets secret_row
     where secret_row.organization_id = p_organization_id
       and secret_row.store_id = p_store_id
       and secret_row.provider = 'whatsapp'
       and secret_row.phone_number_id = btrim(p_phone_number_id)
       and secret_row.external_integration_id = v_integration.id
       and secret_row.status = 'active'
     limit 1;

    if found then
      return query select
        v_integration.id,
        'idempotent_replay'::text,
        v_integration.provider,
        v_integration.status,
        v_integration.is_active,
        v_integration.phone_number_id,
        v_integration.whatsapp_business_account_id,
        v_integration.display_phone_number;
      return;
    end if;
  end if;

  select * into v_result
    from public.materialize_store_whatsapp_embedded_signup_by_system(
      p_organization_id,
      p_store_id,
      p_whatsapp_business_account_id,
      p_phone_number_id,
      p_display_phone_number,
      p_access_token,
      p_meta_graph_api_version,
      p_meta_app_id,
      p_validated_at
    );

  update public.external_integrations as integration_row
     set is_active = false,
         metadata = coalesce(integration_row.metadata, '{}'::jsonb)
           || jsonb_build_object('pin_activation_pending', true),
         updated_at = pg_catalog.clock_timestamp()
   where integration_row.id = v_result.integration_id
     and integration_row.organization_id = p_organization_id
     and integration_row.store_id = p_store_id
     and integration_row.provider = 'whatsapp'
     and integration_row.phone_number_id = btrim(p_phone_number_id)
  returning integration_row.* into v_integration;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'ZION_WHATSAPP_PIN_PENDING_INTEGRATION_SCOPE_MISMATCH';
  end if;

  return query select
    v_integration.id,
    v_result.outcome,
    v_integration.provider,
    v_integration.status,
    v_integration.is_active,
    v_integration.phone_number_id,
    v_integration.whatsapp_business_account_id,
    v_integration.display_phone_number;
end;
$function$;

alter function public.materialize_store_whatsapp_embedded_signup_pending_pin_by_system(
  uuid, uuid, text, text, text, text, text, text, timestamptz
) owner to postgres;
revoke all on function public.materialize_store_whatsapp_embedded_signup_pending_pin_by_system(
  uuid, uuid, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.materialize_store_whatsapp_embedded_signup_pending_pin_by_system(
  uuid, uuid, text, text, text, text, text, text, timestamptz
) to service_role;

-- Activation and operational promotion are one database transaction. A failed
-- promotion rolls back both the secret activation and the integration flag.
create or replace function public.activate_whatsapp_phone_security_secret_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_provider text,
  p_phone_number_id text,
  p_external_integration_id uuid
)
returns table(secret_id uuid, status text, outcome text)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
as $function$
declare
  v_pending public.whatsapp_phone_security_secrets%rowtype;
  v_active public.whatsapp_phone_security_secrets%rowtype;
  v_integration public.external_integrations%rowtype;
  v_phone text := nullif(btrim(coalesce(p_phone_number_id, '')), '');
  v_active_count integer;
  v_was_pending boolean;
begin
  if p_organization_id is null or p_store_id is null or p_provider <> 'whatsapp'
     or v_phone is null or p_external_integration_id is null then
    raise exception using errcode = '22023', message = 'ZION_WHATSAPP_PIN_ACTIVATE_INPUT_INVALID';
  end if;

  perform 1 from public.stores
   where id = p_store_id and organization_id = p_organization_id
   for key share;
  if not found then
    raise exception using errcode = '42501', message = 'ZION_WHATSAPP_PIN_STORE_SCOPE_MISMATCH';
  end if;

  select integration_row.* into v_integration
    from public.external_integrations integration_row
   where integration_row.id = p_external_integration_id
     and integration_row.organization_id = p_organization_id
     and integration_row.store_id = p_store_id
     and integration_row.provider = p_provider
     and integration_row.phone_number_id = v_phone
     and integration_row.status = 'active'
     and (integration_row.is_active is true
       or integration_row.metadata ->> 'pin_activation_pending' = 'true')
   for update;
  if not found then
    raise exception using errcode = '42501', message = 'ZION_WHATSAPP_PIN_INTEGRATION_SCOPE_MISMATCH';
  end if;
  v_was_pending := v_integration.is_active is not true;

  select secret_row.* into v_active
    from public.whatsapp_phone_security_secrets secret_row
   where secret_row.organization_id = p_organization_id
     and secret_row.store_id = p_store_id
     and secret_row.provider = p_provider
     and secret_row.phone_number_id = v_phone
     and secret_row.external_integration_id = p_external_integration_id
     and secret_row.status = 'active'
   for update;
  if found and v_integration.is_active is true then
    secret_id := v_active.id;
    status := 'active';
    outcome := 'idempotent_replay';
    return next;
    return;
  end if;

  select secret_row.* into v_pending
    from public.whatsapp_phone_security_secrets secret_row
   where secret_row.organization_id = p_organization_id
     and secret_row.store_id = p_store_id
     and secret_row.provider = p_provider
     and secret_row.phone_number_id = v_phone
     and secret_row.status = 'pending'
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'ZION_WHATSAPP_PIN_PENDING_NOT_FOUND';
  end if;

  select count(*) into v_active_count
    from public.whatsapp_phone_security_secrets secret_row
   where secret_row.phone_number_id = v_phone and secret_row.status = 'active';
  if v_active_count > 0 then
    select secret_row.* into v_active
      from public.whatsapp_phone_security_secrets secret_row
     where secret_row.phone_number_id = v_phone and secret_row.status = 'active'
     for update;
    if v_active.organization_id is distinct from p_organization_id
       or v_active.store_id is distinct from p_store_id
       or v_active.provider is distinct from p_provider then
      raise exception using errcode = '42501', message = 'ZION_WHATSAPP_PIN_ACTIVE_SCOPE_MISMATCH';
    end if;
    update public.whatsapp_phone_security_secrets
       set status = 'invalidated', invalidated_at = clock_timestamp(), updated_at = clock_timestamp()
     where id = v_active.id;
  end if;

  update public.whatsapp_phone_security_secrets as activated_secret
     set status = 'active', external_integration_id = p_external_integration_id,
         activated_at = clock_timestamp(),
         last_rotated_at = case when v_active.id is null then last_rotated_at else clock_timestamp() end,
         updated_at = clock_timestamp()
   where activated_secret.id = v_pending.id
  returning activated_secret.id, activated_secret.status into secret_id, status;

  if v_was_pending then
    update public.external_integrations
       set is_active = true,
           metadata = metadata - 'pin_activation_pending',
           updated_at = clock_timestamp()
     where id = v_integration.id and is_active is false
       and metadata ->> 'pin_activation_pending' = 'true';
    if not found then
      raise exception using errcode = '55000', message = 'ZION_WHATSAPP_PIN_INTEGRATION_PROMOTION_FAILED';
    end if;
  end if;

  outcome := case when v_active.id is null then 'activated' else 'rotated' end;
  return next;
end;
$function$;

alter function public.activate_whatsapp_phone_security_secret_by_system(
  uuid, uuid, text, text, uuid
) owner to postgres;
revoke all on function public.activate_whatsapp_phone_security_secret_by_system(
  uuid, uuid, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.activate_whatsapp_phone_security_secret_by_system(
  uuid, uuid, text, text, uuid
) to service_role;

commit;

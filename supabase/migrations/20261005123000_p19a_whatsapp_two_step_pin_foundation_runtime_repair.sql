begin;

-- P19-A Block 4: runtime repair for WhatsApp two-step PIN foundation.
-- The original foundation migration was already applied in DEV, so this
-- append-only repair replaces only affected function bodies.
-- No existing integration row or secret row is mutated by installation.

create or replace function public.create_whatsapp_phone_security_secret_pending_by_system(

  p_organization_id uuid,

  p_store_id uuid,

  p_provider text,

  p_phone_number_id text,

  p_ciphertext text,

  p_iv text,

  p_auth_tag text,

  p_key_version integer

)

returns table(secret_id uuid, status text, outcome text)

language plpgsql

security definer

set search_path = pg_catalog, pg_temp, public

as $function$

declare

  v_existing public.whatsapp_phone_security_secrets%rowtype;

  v_phone text := nullif(btrim(coalesce(p_phone_number_id, '')), '');

begin

  if p_organization_id is null or p_store_id is null or p_provider <> 'whatsapp'

     or v_phone is null or nullif(btrim(coalesce(p_ciphertext, '')), '') is null

     or nullif(btrim(coalesce(p_iv, '')), '') is null

     or nullif(btrim(coalesce(p_auth_tag, '')), '') is null or p_key_version <> 1 then

    raise exception using errcode = '22023', message = 'ZION_WHATSAPP_PIN_MATERIAL_INVALID';

  end if;



  perform 1 from public.stores

   where id = p_store_id and organization_id = p_organization_id

   for key share;

  if not found then

    raise exception using errcode = '42501', message = 'ZION_WHATSAPP_PIN_STORE_SCOPE_MISMATCH';

  end if;



  select secret_row.* into v_existing

    from public.whatsapp_phone_security_secrets secret_row

   where secret_row.organization_id = p_organization_id and secret_row.store_id = p_store_id

     and secret_row.provider = p_provider and secret_row.phone_number_id = v_phone and secret_row.status = 'pending'

   for update;



  if found then

    if v_existing.ciphertext is distinct from p_ciphertext

       or v_existing.iv is distinct from p_iv

       or v_existing.auth_tag is distinct from p_auth_tag

       or v_existing.key_version is distinct from p_key_version then

      raise exception using errcode = '23505', message = 'ZION_WHATSAPP_PIN_PENDING_CONFLICT';

    end if;

    return query select v_existing.id, v_existing.status, 'idempotent_replay'::text;

    return;

  end if;



  begin

    insert into public.whatsapp_phone_security_secrets as inserted_secret(

      organization_id, store_id, provider, phone_number_id,

      ciphertext, iv, auth_tag, key_version

    ) values (

      p_organization_id, p_store_id, p_provider, v_phone,

      p_ciphertext, p_iv, p_auth_tag, p_key_version

    ) returning inserted_secret.id, inserted_secret.status into secret_id, status;

  exception when unique_violation then

    raise exception using errcode = '23505', message = 'ZION_WHATSAPP_PIN_PENDING_CONCURRENT_CONFLICT';

  end;



  outcome := 'created';

  return next;

end;

$function$;

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

  v_phone text := nullif(btrim(coalesce(p_phone_number_id, '')), '');

  v_active_count integer;

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



  perform 1 from public.external_integrations integration_row

   where integration_row.id = p_external_integration_id and integration_row.organization_id = p_organization_id

     and integration_row.store_id = p_store_id and integration_row.provider = p_provider

     and integration_row.phone_number_id = v_phone and integration_row.status = 'active' and integration_row.is_active is true

   for key share;

  if not found then

    raise exception using errcode = '42501', message = 'ZION_WHATSAPP_PIN_INTEGRATION_SCOPE_MISMATCH';

  end if;



  select secret_row.* into v_pending

    from public.whatsapp_phone_security_secrets secret_row

   where secret_row.organization_id = p_organization_id and secret_row.store_id = p_store_id

     and secret_row.provider = p_provider and secret_row.phone_number_id = v_phone and secret_row.status = 'pending'

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

         activated_at = clock_timestamp(), last_rotated_at =

           case when v_active.id is null then last_rotated_at else clock_timestamp() end,

         updated_at = clock_timestamp()

   where activated_secret.id = v_pending.id

  returning activated_secret.id, activated_secret.status into secret_id, status;



  outcome := case when v_active.id is null then 'activated' else 'rotated' end;

  return next;

end;

$function$;

create or replace function public.invalidate_whatsapp_phone_security_secret_by_system(

  p_organization_id uuid,

  p_store_id uuid,

  p_secret_id uuid

)

returns table(secret_id uuid, status text, outcome text)

language plpgsql

security definer

set search_path = pg_catalog, pg_temp, public

as $function$

declare v_secret public.whatsapp_phone_security_secrets%rowtype;

begin

  select * into v_secret from public.whatsapp_phone_security_secrets

   where id = p_secret_id and organization_id = p_organization_id and store_id = p_store_id

   for update;

  if not found then

    raise exception using errcode = '42501', message = 'ZION_WHATSAPP_PIN_SECRET_SCOPE_MISMATCH';

  end if;

  if v_secret.status = 'invalidated' then

    return query select v_secret.id, v_secret.status, 'idempotent_replay'::text;

    return;

  end if;

  update public.whatsapp_phone_security_secrets as invalidated_secret

     set status = 'invalidated', invalidated_at = clock_timestamp(), updated_at = clock_timestamp()

   where invalidated_secret.id = v_secret.id

  returning invalidated_secret.id, invalidated_secret.status into secret_id, status;

  outcome := 'invalidated';

  return next;

end;

$function$;

create or replace function public.read_whatsapp_phone_security_secret_metadata_by_system(

  p_organization_id uuid,

  p_store_id uuid,

  p_provider text,

  p_phone_number_id text

)

returns table(

  managed_pin boolean,

  status text,

  key_version integer,

  created_at timestamptz,

  last_revealed_at timestamptz,

  last_rotated_at timestamptz

)

language plpgsql

security definer

set search_path = pg_catalog, pg_temp, public

as $function$

declare v_secret public.whatsapp_phone_security_secrets%rowtype;

begin

  if p_organization_id is null or p_store_id is null or p_provider <> 'whatsapp'

     or nullif(btrim(coalesce(p_phone_number_id, '')), '') is null then

    raise exception using errcode = '22023', message = 'ZION_WHATSAPP_PIN_METADATA_INPUT_INVALID';

  end if;

  perform 1 from public.stores where id = p_store_id and organization_id = p_organization_id for key share;

  if not found then raise exception using errcode = '42501', message = 'ZION_WHATSAPP_PIN_STORE_SCOPE_MISMATCH'; end if;



  select secret_row.* into v_secret from public.whatsapp_phone_security_secrets secret_row

   where secret_row.organization_id = p_organization_id and secret_row.store_id = p_store_id

     and secret_row.provider = p_provider and secret_row.phone_number_id = btrim(p_phone_number_id)

     and secret_row.status = 'active'

   order by secret_row.created_at desc limit 1;



  if not found then

    return query select false, null::text, null::integer, null::timestamptz, null::timestamptz, null::timestamptz;

    return;

  end if;

  return query select true, v_secret.status, v_secret.key_version, v_secret.created_at,

    v_secret.last_revealed_at, v_secret.last_rotated_at;

end;

$function$;

create or replace function public.read_whatsapp_phone_security_secret_material_by_system(

  p_organization_id uuid,

  p_store_id uuid,

  p_provider text,

  p_phone_number_id text

)

returns table(secret_id uuid, ciphertext text, iv text, auth_tag text, key_version integer)

language plpgsql

security definer

set search_path = pg_catalog, pg_temp, public

as $function$

declare v_secret public.whatsapp_phone_security_secrets%rowtype;

begin

  if p_organization_id is null or p_store_id is null or p_provider <> 'whatsapp'

     or nullif(btrim(coalesce(p_phone_number_id, '')), '') is null then

    raise exception using errcode = '22023', message = 'ZION_WHATSAPP_PIN_REVEAL_INPUT_INVALID';

  end if;

  perform 1 from public.stores where id = p_store_id and organization_id = p_organization_id for key share;

  if not found then raise exception using errcode = '42501', message = 'ZION_WHATSAPP_PIN_STORE_SCOPE_MISMATCH'; end if;



  select secret_row.* into v_secret from public.whatsapp_phone_security_secrets secret_row

   where secret_row.organization_id = p_organization_id and secret_row.store_id = p_store_id

     and secret_row.provider = p_provider and secret_row.phone_number_id = btrim(p_phone_number_id)

     and secret_row.status = 'active'

   order by secret_row.created_at desc limit 1

   for update;

  if not found then raise exception using errcode = '22023', message = 'ZION_WHATSAPP_PIN_NOT_MANAGED'; end if;



  update public.whatsapp_phone_security_secrets

     set last_revealed_at = clock_timestamp(), updated_at = clock_timestamp()

   where id = v_secret.id;

  return query select v_secret.id, v_secret.ciphertext, v_secret.iv, v_secret.auth_tag, v_secret.key_version;

end;

$function$;

alter function public.create_whatsapp_phone_security_secret_pending_by_system(
  uuid, uuid, text, text, text, text, text, integer
) owner to postgres;

alter function public.activate_whatsapp_phone_security_secret_by_system(
  uuid, uuid, text, text, uuid
) owner to postgres;

alter function public.invalidate_whatsapp_phone_security_secret_by_system(
  uuid, uuid, uuid
) owner to postgres;

alter function public.read_whatsapp_phone_security_secret_metadata_by_system(
  uuid, uuid, text, text
) owner to postgres;

alter function public.read_whatsapp_phone_security_secret_material_by_system(
  uuid, uuid, text, text
) owner to postgres;

revoke all on function public.create_whatsapp_phone_security_secret_pending_by_system(
  uuid, uuid, text, text, text, text, text, integer
) from public, anon, authenticated;

revoke all on function public.activate_whatsapp_phone_security_secret_by_system(
  uuid, uuid, text, text, uuid
) from public, anon, authenticated;

revoke all on function public.invalidate_whatsapp_phone_security_secret_by_system(
  uuid, uuid, uuid
) from public, anon, authenticated;

revoke all on function public.read_whatsapp_phone_security_secret_metadata_by_system(
  uuid, uuid, text, text
) from public, anon, authenticated;

revoke all on function public.read_whatsapp_phone_security_secret_material_by_system(
  uuid, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.create_whatsapp_phone_security_secret_pending_by_system(
  uuid, uuid, text, text, text, text, text, integer
) to service_role;

grant execute on function public.activate_whatsapp_phone_security_secret_by_system(
  uuid, uuid, text, text, uuid
) to service_role;

grant execute on function public.invalidate_whatsapp_phone_security_secret_by_system(
  uuid, uuid, uuid
) to service_role;

grant execute on function public.read_whatsapp_phone_security_secret_metadata_by_system(
  uuid, uuid, text, text
) to service_role;

grant execute on function public.read_whatsapp_phone_security_secret_material_by_system(
  uuid, uuid, text, text
) to service_role;

commit;

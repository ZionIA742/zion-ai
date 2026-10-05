create table if not exists public.whatsapp_phone_security_secrets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  provider text not null default 'whatsapp',
  phone_number_id text not null,
  external_integration_id uuid,
  secret_kind text not null default 'two_step_verification_pin',
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  key_version integer not null,
  status text not null default 'pending',
  created_at timestamptz not null default clock_timestamp(),
  activated_at timestamptz,
  invalidated_at timestamptz,
  last_revealed_at timestamptz,
  last_rotated_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint whatsapp_phone_security_secrets_provider_check
    check (provider = 'whatsapp'),
  constraint whatsapp_phone_security_secrets_kind_check
    check (secret_kind = 'two_step_verification_pin'),
  constraint whatsapp_phone_security_secrets_status_check
    check (status in ('pending', 'active', 'invalidated')),
  constraint whatsapp_phone_security_secrets_scope_check
    check (btrim(phone_number_id) <> ''),
  constraint whatsapp_phone_security_secrets_ciphertext_check
    check (btrim(ciphertext) <> '' and btrim(iv) <> '' and btrim(auth_tag) <> ''),
  constraint whatsapp_phone_security_secrets_key_version_check
    check (key_version = 1),
  constraint whatsapp_phone_security_secrets_lifecycle_check
    check (
      (status = 'pending' and external_integration_id is null and activated_at is null and invalidated_at is null)
      or (status = 'active' and external_integration_id is not null and activated_at is not null and invalidated_at is null)
      or (status = 'invalidated' and invalidated_at is not null)
    ),
  constraint whatsapp_phone_security_secrets_activation_order_check
    check (activated_at is null or activated_at >= created_at),
  constraint whatsapp_phone_security_secrets_invalidation_order_check
    check (invalidated_at is null or invalidated_at >= created_at)
);

create unique index if not exists whatsapp_phone_security_secrets_active_phone_uidx
  on public.whatsapp_phone_security_secrets(phone_number_id)
  where status = 'active';

create unique index if not exists whatsapp_phone_security_secrets_pending_scope_uidx
  on public.whatsapp_phone_security_secrets(organization_id, store_id, provider, phone_number_id)
  where status = 'pending';

create index if not exists whatsapp_phone_security_secrets_scope_idx
  on public.whatsapp_phone_security_secrets(organization_id, store_id, provider, phone_number_id, created_at desc);

create or replace function public.guard_whatsapp_phone_security_secret_terminal_immutability_by_system()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if old.status = 'invalidated'
     and pg_catalog.to_jsonb(new) is distinct from pg_catalog.to_jsonb(old) then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_PIN_INVALIDATED_IMMUTABLE';
  end if;
  return new;
end;
$function$;

drop trigger if exists whatsapp_phone_security_secrets_terminal_immutability
  on public.whatsapp_phone_security_secrets;

create trigger whatsapp_phone_security_secrets_terminal_immutability
before update on public.whatsapp_phone_security_secrets
for each row execute function public.guard_whatsapp_phone_security_secret_terminal_immutability_by_system();

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
    insert into public.whatsapp_phone_security_secrets(
      organization_id, store_id, provider, phone_number_id,
      ciphertext, iv, auth_tag, key_version
    ) values (
      p_organization_id, p_store_id, p_provider, v_phone,
      p_ciphertext, p_iv, p_auth_tag, p_key_version
    ) returning id, status into secret_id, status;
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

  update public.whatsapp_phone_security_secrets
     set status = 'active', external_integration_id = p_external_integration_id,
         activated_at = clock_timestamp(), last_rotated_at =
           case when v_active.id is null then last_rotated_at else clock_timestamp() end,
         updated_at = clock_timestamp()
   where id = v_pending.id
  returning id, status into secret_id, status;

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
  update public.whatsapp_phone_security_secrets
     set status = 'invalidated', invalidated_at = clock_timestamp(), updated_at = clock_timestamp()
   where id = v_secret.id
  returning id, status into secret_id, status;
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
   order by created_at desc limit 1;

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
   order by created_at desc limit 1
   for update;
  if not found then raise exception using errcode = '22023', message = 'ZION_WHATSAPP_PIN_NOT_MANAGED'; end if;

  update public.whatsapp_phone_security_secrets
     set last_revealed_at = clock_timestamp(), updated_at = clock_timestamp()
   where id = v_secret.id;
  return query select v_secret.id, v_secret.ciphertext, v_secret.iv, v_secret.auth_tag, v_secret.key_version;
end;
$function$;

alter function public.guard_whatsapp_phone_security_secret_terminal_immutability_by_system() owner to postgres;
alter function public.create_whatsapp_phone_security_secret_pending_by_system(uuid,uuid,text,text,text,text,text,integer) owner to postgres;
alter function public.activate_whatsapp_phone_security_secret_by_system(uuid,uuid,text,text,uuid) owner to postgres;
alter function public.invalidate_whatsapp_phone_security_secret_by_system(uuid,uuid,uuid) owner to postgres;
alter function public.read_whatsapp_phone_security_secret_metadata_by_system(uuid,uuid,text,text) owner to postgres;
alter function public.read_whatsapp_phone_security_secret_material_by_system(uuid,uuid,text,text) owner to postgres;

revoke all on table public.whatsapp_phone_security_secrets from public, anon, authenticated;
revoke all on function public.guard_whatsapp_phone_security_secret_terminal_immutability_by_system() from public, anon, authenticated;
revoke all on function public.create_whatsapp_phone_security_secret_pending_by_system(uuid,uuid,text,text,text,text,text,integer) from public, anon, authenticated;
revoke all on function public.activate_whatsapp_phone_security_secret_by_system(uuid,uuid,text,text,uuid) from public, anon, authenticated;
revoke all on function public.invalidate_whatsapp_phone_security_secret_by_system(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.read_whatsapp_phone_security_secret_metadata_by_system(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.read_whatsapp_phone_security_secret_material_by_system(uuid,uuid,text,text) from public, anon, authenticated;

grant execute on function public.create_whatsapp_phone_security_secret_pending_by_system(uuid,uuid,text,text,text,text,text,integer) to service_role;
grant execute on function public.activate_whatsapp_phone_security_secret_by_system(uuid,uuid,text,text,uuid) to service_role;
grant execute on function public.invalidate_whatsapp_phone_security_secret_by_system(uuid,uuid,uuid) to service_role;
grant execute on function public.read_whatsapp_phone_security_secret_metadata_by_system(uuid,uuid,text,text) to service_role;
grant execute on function public.read_whatsapp_phone_security_secret_material_by_system(uuid,uuid,text,text) to service_role;

comment on table public.whatsapp_phone_security_secrets is
  'P19-A managed WhatsApp two-step verification PIN ciphertext. Plain PIN material never belongs in this table.';

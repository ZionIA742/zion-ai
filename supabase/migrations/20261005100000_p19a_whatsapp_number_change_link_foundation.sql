create table if not exists public.whatsapp_number_change_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  provider text not null default 'whatsapp',
  token_hash text not null,
  status text not null default 'issued',
  created_by_user_id uuid not null,
  responsible_user_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  last_sent_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  revoked_at timestamptz,
  binding_change_request_id uuid,
  updated_at timestamptz not null default clock_timestamp(),
  constraint whatsapp_number_change_links_provider_check
    check (provider = 'whatsapp'),
  constraint whatsapp_number_change_links_status_check
    check (status in ('issued', 'started', 'completed', 'revoked', 'expired')),
  constraint whatsapp_number_change_links_token_hash_check
    check (btrim(token_hash) <> ''),
  constraint whatsapp_number_change_links_expiry_check
    check (expires_at > created_at),
  constraint whatsapp_number_change_links_status_timestamps_check
    check (
      (status = 'issued' and started_at is null and completed_at is null and revoked_at is null)
      or (status = 'started' and started_at is not null and completed_at is null and revoked_at is null)
      or (status = 'completed' and started_at is not null and completed_at is not null and revoked_at is null)
      or (status = 'revoked' and completed_at is null and revoked_at is not null)
      or (status = 'expired' and completed_at is null and revoked_at is null)
    ),
  constraint whatsapp_number_change_links_completed_after_started_check
    check (completed_at is null or started_at is null or completed_at >= started_at),
  constraint whatsapp_number_change_links_revoked_after_created_check
    check (revoked_at is null or revoked_at >= created_at)
);

create unique index if not exists whatsapp_number_change_links_token_hash_uidx
  on public.whatsapp_number_change_links(token_hash);

create unique index if not exists whatsapp_number_change_links_active_scope_uidx
  on public.whatsapp_number_change_links(organization_id, store_id, provider)
  where status in ('issued', 'started');

create index if not exists whatsapp_number_change_links_scope_idx
  on public.whatsapp_number_change_links(organization_id, store_id, provider, created_at desc);

alter table public.whatsapp_number_change_links
  add column if not exists responsible_user_id uuid;

create or replace function public.guard_whatsapp_number_change_link_terminal_immutability_by_system()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if old.status in ('completed', 'revoked', 'expired')
     and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception using errcode = '23514',
      message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_TERMINAL_IMMUTABLE';
  end if;
  return new;
end;
$function$;

drop trigger if exists whatsapp_number_change_links_terminal_immutability
  on public.whatsapp_number_change_links;

create trigger whatsapp_number_change_links_terminal_immutability
before update on public.whatsapp_number_change_links
for each row execute function public.guard_whatsapp_number_change_link_terminal_immutability_by_system();

drop function if exists public.create_whatsapp_number_change_link_by_system(uuid, uuid, text, text, uuid, timestamptz);

create or replace function public.create_whatsapp_number_change_link_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_provider text,
  p_token_hash text,
  p_created_by_user_id uuid,
  p_responsible_user_id uuid,
  p_expires_at timestamptz
)
returns table (
  link_id uuid,
  organization_id uuid,
  store_id uuid,
  provider text,
  status text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
as $function$
declare
  v_previous public.whatsapp_number_change_links%rowtype;
  v_id uuid;
  v_owner_count integer;
begin
  if p_organization_id is null or p_store_id is null
     or p_created_by_user_id is null or p_responsible_user_id is null
     or p_provider <> 'whatsapp' or btrim(coalesce(p_token_hash, '')) = ''
     or p_expires_at <= clock_timestamp() then
    raise exception using errcode = '22023', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_INPUT_INVALID';
  end if;

  perform 1 from public.stores
   where id = p_store_id and organization_id = p_organization_id;
  if not found then
    raise exception using errcode = '42501', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_SCOPE_MISMATCH';
  end if;

  select count(*) into v_owner_count
    from public.memberships
   where organization_id = p_organization_id
     and role = 'owner'
     and coalesce(is_active, true) is true;
  if v_owner_count <> 1 or not exists (
    select 1 from public.memberships
     where organization_id = p_organization_id
       and user_id = p_responsible_user_id
       and role = 'owner'
       and coalesce(is_active, true) is true
  ) then
    raise exception using errcode = '42501', message = 'ZION_WHATSAPP_NUMBER_CHANGE_OWNER_INVALID';
  end if;

  if exists (select 1 from public.whatsapp_number_change_links where token_hash = p_token_hash) then
    raise exception using errcode = '23505', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_TOKEN_HASH_REUSED';
  end if;

  select * into v_previous
    from public.whatsapp_number_change_links
   where organization_id = p_organization_id and store_id = p_store_id
     and provider = p_provider and status in ('issued', 'started')
   order by created_at desc
   limit 1
   for update;

  if v_previous.id is not null then
    update public.whatsapp_number_change_links
       set status = 'revoked', revoked_at = clock_timestamp(), updated_at = clock_timestamp()
     where id = v_previous.id;
  end if;

  begin
    insert into public.whatsapp_number_change_links(
      organization_id, store_id, provider, token_hash, status,
       created_by_user_id, responsible_user_id, expires_at
    ) values (
      p_organization_id, p_store_id, p_provider, p_token_hash, 'issued',
       p_created_by_user_id, p_responsible_user_id, p_expires_at
    ) returning id into v_id;
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_CONCURRENT_CONFLICT';
  end;

  return query
    select link.id, link.organization_id, link.store_id, link.provider, link.status, link.expires_at
      from public.whatsapp_number_change_links as link
     where link.id = v_id;
end;
$function$;

create or replace function public.resolve_whatsapp_number_change_link_by_system(
  p_token_hash text
)
returns table (
  link_id uuid,
  organization_id uuid,
  store_id uuid,
  provider text,
  status text,
  expires_at timestamptz,
  started_at timestamptz,
  binding_change_request_id uuid,
  responsible_user_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
as $function$
declare v_link public.whatsapp_number_change_links%rowtype;
begin
  if btrim(coalesce(p_token_hash, '')) = '' then
    raise exception using errcode = '22023', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_TOKEN_INVALID';
  end if;
  select * into v_link from public.whatsapp_number_change_links where token_hash = p_token_hash for update;
  if not found then
    raise exception using errcode = '22023', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_NOT_FOUND';
  end if;
  if v_link.status in ('completed', 'revoked', 'expired') then
    raise exception using errcode = '22023', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_NOT_ACTIVE';
  end if;
  if v_link.expires_at <= clock_timestamp() then
    raise exception using errcode = '22023', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_EXPIRED';
  end if;
  return query select v_link.id, v_link.organization_id, v_link.store_id, v_link.provider,
    v_link.status, v_link.expires_at, v_link.started_at, v_link.binding_change_request_id,
    v_link.responsible_user_id;
end;
$function$;

create or replace function public.start_whatsapp_number_change_link_by_system(
  p_link_id uuid, p_organization_id uuid, p_store_id uuid, p_provider text,
  p_responsible_user_id uuid
)
returns table (link_id uuid, organization_id uuid, store_id uuid, provider text, status text, expires_at timestamptz, started_at timestamptz, binding_change_request_id uuid)
language plpgsql security definer set search_path = pg_catalog, pg_temp, public
as $function$
declare v_link public.whatsapp_number_change_links%rowtype;
begin
  select * into v_link from public.whatsapp_number_change_links
   where id = p_link_id and organization_id = p_organization_id and store_id = p_store_id and provider = p_provider for update;
  if not found then raise exception using errcode = '42501', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_SCOPE_MISMATCH'; end if;
  if v_link.responsible_user_id is distinct from p_responsible_user_id then
    raise exception using errcode = '42501', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_RESPONSIBLE_MISMATCH';
  end if;
  if (select count(*) from public.memberships where organization_id = p_organization_id and role = 'owner' and coalesce(is_active, true) is true) <> 1
     or not exists (select 1 from public.memberships where organization_id = p_organization_id and user_id = p_responsible_user_id and role = 'owner' and coalesce(is_active, true) is true) then
    raise exception using errcode = '42501', message = 'ZION_WHATSAPP_NUMBER_CHANGE_OWNER_INVALID';
  end if;
  if v_link.status in ('completed', 'revoked', 'expired') then raise exception using errcode = '22023', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_TERMINAL'; end if;
  if v_link.expires_at <= clock_timestamp() then
    raise exception using errcode = '22023', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_EXPIRED';
  end if;
  if v_link.status = 'issued' then
    update public.whatsapp_number_change_links set status = 'started', started_at = clock_timestamp(), updated_at = clock_timestamp() where id = v_link.id returning * into v_link;
  end if;
  return query select v_link.id, v_link.organization_id, v_link.store_id, v_link.provider, v_link.status, v_link.expires_at, v_link.started_at, v_link.binding_change_request_id;
end;
$function$;

create or replace function public.bind_whatsapp_number_change_link_by_system(
  p_link_id uuid, p_organization_id uuid, p_store_id uuid, p_provider text, p_binding_change_request_id uuid
)
returns table (link_id uuid, organization_id uuid, store_id uuid, provider text, status text, binding_change_request_id uuid)
language plpgsql security definer set search_path = pg_catalog, pg_temp, public
as $function$
declare v_link public.whatsapp_number_change_links%rowtype; v_request record;
begin
  select * into v_link from public.whatsapp_number_change_links where id = p_link_id and organization_id = p_organization_id and store_id = p_store_id and provider = p_provider for update;
  if not found then raise exception using errcode = '42501', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_SCOPE_MISMATCH'; end if;
  if v_link.status in ('completed', 'revoked', 'expired') then raise exception using errcode = '22023', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_TERMINAL'; end if;
  if v_link.status <> 'started' then raise exception using errcode = '22023', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_NOT_STARTED'; end if;
  if v_link.binding_change_request_id is not null and v_link.binding_change_request_id <> p_binding_change_request_id then raise exception using errcode = '23505', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_ALREADY_BOUND'; end if;
  select id, status into v_request from public.whatsapp_binding_change_requests where id = p_binding_change_request_id and organization_id = p_organization_id and store_id = p_store_id and provider = p_provider for update;
  if not found then raise exception using errcode = '42501', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_REQUEST_SCOPE_MISMATCH'; end if;
  if v_link.binding_change_request_id is null then
    update public.whatsapp_number_change_links set binding_change_request_id = p_binding_change_request_id, updated_at = clock_timestamp() where id = v_link.id returning * into v_link;
  end if;
  return query select v_link.id, v_link.organization_id, v_link.store_id, v_link.provider, v_link.status, v_link.binding_change_request_id;
end;
$function$;

create or replace function public.complete_whatsapp_number_change_link_by_system(
  p_link_id uuid, p_organization_id uuid, p_store_id uuid, p_provider text
)
returns table (link_id uuid, organization_id uuid, store_id uuid, provider text, status text, completed_at timestamptz, binding_change_request_id uuid)
language plpgsql security definer set search_path = pg_catalog, pg_temp, public
as $function$
declare v_link public.whatsapp_number_change_links%rowtype; v_request record;
begin
  select * into v_link from public.whatsapp_number_change_links where id = p_link_id and organization_id = p_organization_id and store_id = p_store_id and provider = p_provider for update;
  if not found then raise exception using errcode = '42501', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_SCOPE_MISMATCH'; end if;
  if v_link.status = 'completed' then return query select v_link.id, v_link.organization_id, v_link.store_id, v_link.provider, v_link.status, v_link.completed_at, v_link.binding_change_request_id; return; end if;
  if v_link.status in ('revoked', 'expired') then raise exception using errcode = '22023', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_TERMINAL'; end if;
  if v_link.status <> 'started' or v_link.binding_change_request_id is null then raise exception using errcode = '22023', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_NOT_READY'; end if;
  select status into v_request from public.whatsapp_binding_change_requests where id = v_link.binding_change_request_id and organization_id = p_organization_id and store_id = p_store_id and provider = p_provider for update;
  if not found then raise exception using errcode = '42501', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_REQUEST_SCOPE_MISMATCH'; end if;
  if v_request.status <> 'completed' then raise exception using errcode = '22023', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_REQUEST_NOT_COMPLETED'; end if;
  update public.whatsapp_number_change_links set status = 'completed', completed_at = clock_timestamp(), updated_at = clock_timestamp() where id = v_link.id returning * into v_link;
  return query select v_link.id, v_link.organization_id, v_link.store_id, v_link.provider, v_link.status, v_link.completed_at, v_link.binding_change_request_id;
end;
$function$;

create or replace function public.revoke_whatsapp_number_change_link_by_system(
  p_link_id uuid, p_organization_id uuid, p_store_id uuid, p_provider text
)
returns table (link_id uuid, organization_id uuid, store_id uuid, provider text, status text, revoked_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, pg_temp, public
as $function$
declare v_link public.whatsapp_number_change_links%rowtype;
begin
  select * into v_link from public.whatsapp_number_change_links where id = p_link_id and organization_id = p_organization_id and store_id = p_store_id and provider = p_provider for update;
  if not found then raise exception using errcode = '42501', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_SCOPE_MISMATCH'; end if;
  if v_link.status = 'revoked' then return query select v_link.id, v_link.organization_id, v_link.store_id, v_link.provider, v_link.status, v_link.revoked_at; return; end if;
  if v_link.status in ('completed', 'expired') then raise exception using errcode = '22023', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_TERMINAL'; end if;
  update public.whatsapp_number_change_links set status = 'revoked', revoked_at = clock_timestamp(), updated_at = clock_timestamp() where id = v_link.id returning * into v_link;
  return query select v_link.id, v_link.organization_id, v_link.store_id, v_link.provider, v_link.status, v_link.revoked_at;
end;
$function$;

create or replace function public.expire_whatsapp_number_change_link_by_system(
  p_link_id uuid, p_organization_id uuid, p_store_id uuid, p_provider text
)
returns table (link_id uuid, organization_id uuid, store_id uuid, provider text, status text, expires_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, pg_temp, public
as $function$
declare v_link public.whatsapp_number_change_links%rowtype;
begin
  select * into v_link from public.whatsapp_number_change_links where id = p_link_id and organization_id = p_organization_id and store_id = p_store_id and provider = p_provider for update;
  if not found then raise exception using errcode = '42501', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_SCOPE_MISMATCH'; end if;
  if v_link.status = 'expired' then return query select v_link.id, v_link.organization_id, v_link.store_id, v_link.provider, v_link.status, v_link.expires_at; return; end if;
  if v_link.status in ('completed', 'revoked') then raise exception using errcode = '22023', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_TERMINAL'; end if;
  if v_link.expires_at > clock_timestamp() then raise exception using errcode = '22023', message = 'ZION_WHATSAPP_NUMBER_CHANGE_LINK_NOT_EXPIRED'; end if;
  update public.whatsapp_number_change_links set status = 'expired', updated_at = clock_timestamp() where id = v_link.id returning * into v_link;
  return query select v_link.id, v_link.organization_id, v_link.store_id, v_link.provider, v_link.status, v_link.expires_at;
end;
$function$;

alter function public.guard_whatsapp_number_change_link_terminal_immutability_by_system() owner to postgres;
alter function public.create_whatsapp_number_change_link_by_system(uuid, uuid, text, text, uuid, uuid, timestamptz) owner to postgres;
alter function public.resolve_whatsapp_number_change_link_by_system(text) owner to postgres;
alter function public.start_whatsapp_number_change_link_by_system(uuid, uuid, uuid, text, uuid) owner to postgres;
alter function public.bind_whatsapp_number_change_link_by_system(uuid, uuid, uuid, text, uuid) owner to postgres;
alter function public.complete_whatsapp_number_change_link_by_system(uuid, uuid, uuid, text) owner to postgres;
alter function public.revoke_whatsapp_number_change_link_by_system(uuid, uuid, uuid, text) owner to postgres;
alter function public.expire_whatsapp_number_change_link_by_system(uuid, uuid, uuid, text) owner to postgres;

revoke all on table public.whatsapp_number_change_links from public, anon, authenticated;
revoke all on function public.guard_whatsapp_number_change_link_terminal_immutability_by_system() from public, anon, authenticated;
revoke all on function public.create_whatsapp_number_change_link_by_system(uuid, uuid, text, text, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.resolve_whatsapp_number_change_link_by_system(text) from public, anon, authenticated;
revoke all on function public.start_whatsapp_number_change_link_by_system(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.bind_whatsapp_number_change_link_by_system(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.complete_whatsapp_number_change_link_by_system(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.revoke_whatsapp_number_change_link_by_system(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.expire_whatsapp_number_change_link_by_system(uuid, uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.create_whatsapp_number_change_link_by_system(uuid, uuid, text, text, uuid, uuid, timestamptz) to service_role;
grant execute on function public.resolve_whatsapp_number_change_link_by_system(text) to service_role;
grant execute on function public.start_whatsapp_number_change_link_by_system(uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.bind_whatsapp_number_change_link_by_system(uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.complete_whatsapp_number_change_link_by_system(uuid, uuid, uuid, text) to service_role;
grant execute on function public.revoke_whatsapp_number_change_link_by_system(uuid, uuid, uuid, text) to service_role;
grant execute on function public.expire_whatsapp_number_change_link_by_system(uuid, uuid, uuid, text) to service_role;

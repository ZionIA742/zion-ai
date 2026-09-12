begin;

do $migration$
begin
  if pg_catalog.to_regclass('public.stores') is null then
    raise exception using errcode = 'P0001', message = 'precondition failed: public.stores is required';
  end if;
  if pg_catalog.to_regclass('public.memberships') is null then
    raise exception using errcode = 'P0001', message = 'precondition failed: public.memberships is required';
  end if;
  if pg_catalog.to_regclass('public.store_import_files') is null then
    raise exception using errcode = 'P0001', message = 'precondition failed: public.store_import_files is required';
  end if;
  if pg_catalog.to_regclass('public.store_import_file_items') is null then
    raise exception using errcode = 'P0001', message = 'precondition failed: public.store_import_file_items is required';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conname = 'store_import_files_id_organization_store_key'
      and c.conrelid = 'public.store_import_files'::pg_catalog.regclass
  ) then
    alter table public.store_import_files
      add constraint store_import_files_id_organization_store_key
      unique (id, organization_id, store_id);
  end if;
end;
$migration$;

create table public.store_catalog_settings (
  organization_id uuid not null,
  store_id uuid not null,
  allow_full_catalog_send boolean not null,
  customer_catalog_import_file_id uuid,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint store_catalog_settings_pkey primary key (organization_id, store_id),
  constraint store_catalog_settings_store_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete cascade,
  constraint store_catalog_settings_customer_file_scope_fkey
    foreign key (customer_catalog_import_file_id, organization_id, store_id)
    references public.store_import_files(id, organization_id, store_id)
    on delete restrict,
  constraint store_catalog_settings_selection_consistency_check
    check (
      (allow_full_catalog_send is false and customer_catalog_import_file_id is null)
      or
      (allow_full_catalog_send is true and customer_catalog_import_file_id is not null)
    )
);

comment on table public.store_catalog_settings is
  'P19-A: politica canonica da loja para envio de um arquivo completo do catalogo ao cliente.';

create or replace function public.touch_store_catalog_settings_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;

alter function public.touch_store_catalog_settings_updated_at() owner to postgres;
revoke all on function public.touch_store_catalog_settings_updated_at()
  from public, anon, authenticated, service_role;

create trigger touch_store_catalog_settings_updated_at
before update on public.store_catalog_settings
for each row execute function public.touch_store_catalog_settings_updated_at();

alter table public.store_catalog_settings enable row level security;
revoke all on table public.store_catalog_settings
  from public, anon, authenticated, service_role;
grant select on table public.store_catalog_settings to authenticated;

create policy store_catalog_settings_select_by_active_membership
on public.store_catalog_settings
for select
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1 from public.memberships m
    where m.organization_id = store_catalog_settings.organization_id
      and m.user_id = auth.uid()
      and m.is_active is true
  )
  and exists (
    select 1 from public.stores s
    where s.id = store_catalog_settings.store_id
      and s.organization_id = store_catalog_settings.organization_id
  )
);

create or replace function public.assert_store_catalog_settings_scope(
  p_organization_id uuid,
  p_store_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.is_active is true
  ) then
    raise exception 'active organization membership required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.stores s
    where s.id = p_store_id
      and s.organization_id = p_organization_id
  ) then
    raise exception 'store is outside organization scope' using errcode = '42501';
  end if;
end;
$function$;

alter function public.assert_store_catalog_settings_scope(uuid, uuid) owner to postgres;
revoke all on function public.assert_store_catalog_settings_scope(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.read_store_catalog_settings_scoped(
  p_organization_id uuid,
  p_store_id uuid
)
returns table (
  organization_id uuid,
  store_id uuid,
  allow_full_catalog_send boolean,
  customer_catalog_import_file_id uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
begin
  perform public.assert_store_catalog_settings_scope(p_organization_id, p_store_id);

  return query
  select s.organization_id, s.store_id, s.allow_full_catalog_send,
         s.customer_catalog_import_file_id, s.created_at, s.updated_at
  from public.store_catalog_settings s
  where s.organization_id = p_organization_id
    and s.store_id = p_store_id;
end;
$function$;

alter function public.read_store_catalog_settings_scoped(uuid, uuid) owner to postgres;
revoke all on function public.read_store_catalog_settings_scoped(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_store_catalog_settings_scoped(uuid, uuid)
  to authenticated;

create or replace function public.upsert_store_catalog_settings_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_allow_full_catalog_send boolean,
  p_customer_catalog_import_file_id uuid default null
)
returns table (
  organization_id uuid,
  store_id uuid,
  allow_full_catalog_send boolean,
  customer_catalog_import_file_id uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
begin
  perform public.assert_store_catalog_settings_scope(p_organization_id, p_store_id);

  if p_allow_full_catalog_send is null then
    raise exception 'allow_full_catalog_send is required' using errcode = '22023';
  end if;

  if p_allow_full_catalog_send is false and p_customer_catalog_import_file_id is not null then
    raise exception 'customer catalog file must be null when full catalog sending is disabled'
      using errcode = '22023';
  end if;

  if p_allow_full_catalog_send is true and p_customer_catalog_import_file_id is null then
    raise exception 'customer catalog file is required when full catalog sending is enabled'
      using errcode = '22023';
  end if;

  if p_allow_full_catalog_send is true and not exists (
    select 1
    from public.store_import_files f
    where f.id = p_customer_catalog_import_file_id
      and f.organization_id = p_organization_id
      and f.store_id = p_store_id
      and f.status = 'active'
      and nullif(pg_catalog.btrim(f.storage_bucket), '') is not null
      and nullif(pg_catalog.btrim(f.storage_path), '') is not null
      and exists (
        select 1
        from public.store_import_file_items i
        where i.import_file_id = f.id
          and i.organization_id = f.organization_id
          and i.store_id = f.store_id
      )
  ) then
    raise exception 'selected customer catalog file is not an active imported file from this store'
      using errcode = '22023';
  end if;

  insert into public.store_catalog_settings (
    organization_id,
    store_id,
    allow_full_catalog_send,
    customer_catalog_import_file_id
  )
  values (
    p_organization_id,
    p_store_id,
    p_allow_full_catalog_send,
    p_customer_catalog_import_file_id
  )
  on conflict (organization_id, store_id)
  do update set
    allow_full_catalog_send = excluded.allow_full_catalog_send,
    customer_catalog_import_file_id = excluded.customer_catalog_import_file_id;

  return query
  select s.organization_id, s.store_id, s.allow_full_catalog_send,
         s.customer_catalog_import_file_id, s.created_at, s.updated_at
  from public.store_catalog_settings s
  where s.organization_id = p_organization_id
    and s.store_id = p_store_id;
end;
$function$;

alter function public.upsert_store_catalog_settings_scoped(uuid, uuid, boolean, uuid)
  owner to postgres;
revoke all on function public.upsert_store_catalog_settings_scoped(uuid, uuid, boolean, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.upsert_store_catalog_settings_scoped(uuid, uuid, boolean, uuid)
  to authenticated;

commit;

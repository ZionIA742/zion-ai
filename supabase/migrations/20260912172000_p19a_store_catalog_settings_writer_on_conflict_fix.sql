begin;

-- P19-A / Bloco 3 / Etapa 3.4
-- Forward fix: elimina ambiguidade PL/pgSQL no ON CONFLICT do writer
-- canonico de store_catalog_settings. A migration original ja foi aplicada
-- e permanece imutavel.

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
  perform public.assert_store_catalog_settings_scope(
    p_organization_id,
    p_store_id
  );

  if p_allow_full_catalog_send is null then
    raise exception 'allow_full_catalog_send is required'
      using errcode = '22023';
  end if;

  if p_allow_full_catalog_send is false
     and p_customer_catalog_import_file_id is not null then
    raise exception
      'customer catalog file must be null when full catalog sending is disabled'
      using errcode = '22023';
  end if;

  if p_allow_full_catalog_send is true
     and p_customer_catalog_import_file_id is null then
    raise exception
      'customer catalog file is required when full catalog sending is enabled'
      using errcode = '22023';
  end if;

  if p_allow_full_catalog_send is true
     and not exists (
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
    raise exception
      'selected customer catalog file is not an active imported file from this store'
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
  on conflict on constraint store_catalog_settings_pkey
  do update set
    allow_full_catalog_send = excluded.allow_full_catalog_send,
    customer_catalog_import_file_id = excluded.customer_catalog_import_file_id;

  return query
  select
    s.organization_id,
    s.store_id,
    s.allow_full_catalog_send,
    s.customer_catalog_import_file_id,
    s.created_at,
    s.updated_at
  from public.store_catalog_settings s
  where s.organization_id = p_organization_id
    and s.store_id = p_store_id;
end;
$function$;

alter function public.upsert_store_catalog_settings_scoped(
  uuid,
  uuid,
  boolean,
  uuid
) owner to postgres;

revoke all
on function public.upsert_store_catalog_settings_scoped(
  uuid,
  uuid,
  boolean,
  uuid
)
from public, anon, authenticated, service_role;

grant execute
on function public.upsert_store_catalog_settings_scoped(
  uuid,
  uuid,
  boolean,
  uuid
)
to authenticated;

commit;

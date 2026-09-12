begin;

-- P19-A / Bloco 3 / Etapa 3.4
-- Reader canonico de sistema para a Sales AI consumir somente os arquivos
-- explicitamente autorizados em "Catalogos para clientes".
--
-- A lista autorizada continua pertencendo a store_catalog_customer_files.
-- Este reader nao decide intencao comercial e nao escolhe arquivo por nome:
-- ele apenas expoe, de forma tenant-scoped e fail-closed, os arquivos
-- atualmente autorizados e os destinos canonicos originados por cada importacao.

create or replace function public.read_store_customer_catalog_files_for_ai_by_system(
  p_organization_id uuid,
  p_store_id uuid
)
returns table (
  organization_id uuid,
  store_id uuid,
  import_file_id uuid,
  sort_order integer,
  original_file_name text,
  mime_type text,
  extension text,
  storage_bucket text,
  storage_path text,
  linked_pool_ids uuid[],
  linked_catalog_item_ids uuid[]
)
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  if p_organization_id is null or p_store_id is null then
    raise exception 'organization_id and store_id are required'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.stores s
    where s.id = p_store_id
      and s.organization_id = p_organization_id
  ) then
    raise exception 'store does not belong to organization'
      using errcode = '22023';
  end if;

  return query
  select
    cf.organization_id,
    cf.store_id,
    cf.import_file_id,
    cf.sort_order,
    f.original_file_name,
    f.mime_type,
    f.extension,
    f.storage_bucket,
    f.storage_path,
    coalesce(
      (
        select pg_catalog.array_agg(i.destination_item_id order by i.created_at, i.id)
        from public.store_import_file_items i
        where i.import_file_id = cf.import_file_id
          and i.organization_id = cf.organization_id
          and i.store_id = cf.store_id
          and i.destination_type = 'pool'
          and i.destination_table = 'pools'
      ),
      '{}'::uuid[]
    ) as linked_pool_ids,
    coalesce(
      (
        select pg_catalog.array_agg(i.destination_item_id order by i.created_at, i.id)
        from public.store_import_file_items i
        where i.import_file_id = cf.import_file_id
          and i.organization_id = cf.organization_id
          and i.store_id = cf.store_id
          and i.destination_type = 'catalog_item'
          and i.destination_table = 'store_catalog_items'
      ),
      '{}'::uuid[]
    ) as linked_catalog_item_ids
  from public.store_catalog_settings settings_row
  join public.store_catalog_customer_files cf
    on cf.organization_id = settings_row.organization_id
   and cf.store_id = settings_row.store_id
  join public.store_import_files f
    on f.id = cf.import_file_id
   and f.organization_id = cf.organization_id
   and f.store_id = cf.store_id
  where settings_row.organization_id = p_organization_id
    and settings_row.store_id = p_store_id
    and settings_row.allow_full_catalog_send is true
    and f.status = 'active'
    and nullif(pg_catalog.btrim(f.storage_bucket), '') is not null
    and nullif(pg_catalog.btrim(f.storage_path), '') is not null
    and exists (
      select 1
      from public.store_import_file_items linked_item
      where linked_item.import_file_id = f.id
        and linked_item.organization_id = f.organization_id
        and linked_item.store_id = f.store_id
    )
  order by cf.sort_order;
end;
$function$;

alter function public.read_store_customer_catalog_files_for_ai_by_system(uuid, uuid)
owner to postgres;

revoke all
on function public.read_store_customer_catalog_files_for_ai_by_system(uuid, uuid)
from public, anon, authenticated, service_role;

grant execute
on function public.read_store_customer_catalog_files_for_ai_by_system(uuid, uuid)
to service_role;

comment on function public.read_store_customer_catalog_files_for_ai_by_system(uuid, uuid) is
  'P19-A: reader service-only dos catalogos completos explicitamente autorizados para a Sales AI, incluindo vinculos canonicos de pools e itens de catalogo.';

commit;

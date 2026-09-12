begin;

-- P19-A / Bloco 3 / Etapa 3.4
-- Evolucao forward-only da authority de "catalogo completo para clientes":
-- de um unico arquivo autorizado para uma lista ordenada de arquivos.
--
-- Principios:
-- * store_catalog_customer_files passa a ser a authority canonica da LISTA.
-- * store_catalog_settings continua sendo a policy da loja (liga/desliga).
-- * customer_catalog_import_file_id permanece temporariamente como mirror
--   de compatibilidade do PRIMEIRO arquivo da lista, para nao quebrar a UI
--   atual nem leitores antigos durante a transicao.
-- * writers autenticados mantem mirror + lista atomicamente.
-- * nenhum arquivo e autoautorizado: apenas os ids explicitamente enviados.
-- * todos os arquivos selecionados continuam protegidos contra exclusao.

do $migration$
begin
  if pg_catalog.to_regclass('public.store_catalog_settings') is null then
    raise exception 'precondition failed: public.store_catalog_settings is required';
  end if;

  if pg_catalog.to_regclass('public.store_import_files') is null then
    raise exception 'precondition failed: public.store_import_files is required';
  end if;

  if pg_catalog.to_regclass('public.store_import_file_items') is null then
    raise exception 'precondition failed: public.store_import_file_items is required';
  end if;
end;
$migration$;

create table public.store_catalog_customer_files (
  organization_id uuid not null,
  store_id uuid not null,
  import_file_id uuid not null,
  sort_order integer not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),

  constraint store_catalog_customer_files_pkey
    primary key (organization_id, store_id, import_file_id),

  constraint store_catalog_customer_files_store_settings_fkey
    foreign key (organization_id, store_id)
    references public.store_catalog_settings(organization_id, store_id)
    on delete cascade,

  constraint store_catalog_customer_files_import_scope_fkey
    foreign key (import_file_id, organization_id, store_id)
    references public.store_import_files(id, organization_id, store_id)
    on delete restrict,

  constraint store_catalog_customer_files_sort_order_check
    check (sort_order >= 1),

  constraint store_catalog_customer_files_sort_order_key
    unique (organization_id, store_id, sort_order)
);

comment on table public.store_catalog_customer_files is
  'P19-A: lista canonica e ordenada de arquivos importados explicitamente autorizados para envio a clientes.';

comment on column public.store_catalog_settings.customer_catalog_import_file_id is
  'P19-A: mirror temporario de compatibilidade do primeiro arquivo de store_catalog_customer_files; nao e a authority da lista.';

create or replace function public.touch_store_catalog_customer_files_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;

alter function public.touch_store_catalog_customer_files_updated_at()
owner to postgres;

revoke all
on function public.touch_store_catalog_customer_files_updated_at()
from public, anon, authenticated, service_role;

create trigger touch_store_catalog_customer_files_updated_at
before update on public.store_catalog_customer_files
for each row
execute function public.touch_store_catalog_customer_files_updated_at();

alter table public.store_catalog_customer_files enable row level security;

revoke all on table public.store_catalog_customer_files
from public, anon, authenticated, service_role;

grant select on table public.store_catalog_customer_files
to authenticated;

create policy store_catalog_customer_files_select_by_active_membership
on public.store_catalog_customer_files
for select
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.memberships m
    where m.organization_id = store_catalog_customer_files.organization_id
      and m.user_id = auth.uid()
      and m.is_active is true
  )
  and exists (
    select 1
    from public.stores s
    where s.id = store_catalog_customer_files.store_id
      and s.organization_id = store_catalog_customer_files.organization_id
  )
);

-- Backfill: preserva automaticamente o unico arquivo ja configurado antes
-- desta evolucao, mantendo a ordem 1.
insert into public.store_catalog_customer_files (
  organization_id,
  store_id,
  import_file_id,
  sort_order
)
select
  s.organization_id,
  s.store_id,
  s.customer_catalog_import_file_id,
  1
from public.store_catalog_settings s
where s.allow_full_catalog_send is true
  and s.customer_catalog_import_file_id is not null
on conflict on constraint store_catalog_customer_files_pkey
do nothing;

create or replace function public.read_store_catalog_settings_multi_scoped(
  p_organization_id uuid,
  p_store_id uuid
)
returns table (
  organization_id uuid,
  store_id uuid,
  allow_full_catalog_send boolean,
  customer_catalog_import_file_ids uuid[],
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  perform public.assert_store_catalog_settings_scope(
    p_organization_id,
    p_store_id
  );

  return query
  select
    s.organization_id,
    s.store_id,
    s.allow_full_catalog_send,
    coalesce(
      pg_catalog.array_agg(cf.import_file_id order by cf.sort_order)
        filter (where cf.import_file_id is not null),
      '{}'::uuid[]
    ) as customer_catalog_import_file_ids,
    s.created_at,
    s.updated_at
  from public.store_catalog_settings s
  left join public.store_catalog_customer_files cf
    on cf.organization_id = s.organization_id
   and cf.store_id = s.store_id
  where s.organization_id = p_organization_id
    and s.store_id = p_store_id
  group by
    s.organization_id,
    s.store_id,
    s.allow_full_catalog_send,
    s.created_at,
    s.updated_at;
end;
$function$;

alter function public.read_store_catalog_settings_multi_scoped(uuid, uuid)
owner to postgres;

revoke all
on function public.read_store_catalog_settings_multi_scoped(uuid, uuid)
from public, anon, authenticated, service_role;

grant execute
on function public.read_store_catalog_settings_multi_scoped(uuid, uuid)
to authenticated;

create or replace function public.upsert_store_catalog_settings_multi_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_allow_full_catalog_send boolean,
  p_customer_catalog_import_file_ids uuid[] default '{}'::uuid[]
)
returns table (
  organization_id uuid,
  store_id uuid,
  allow_full_catalog_send boolean,
  customer_catalog_import_file_ids uuid[],
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_file_ids uuid[] := coalesce(p_customer_catalog_import_file_ids, '{}'::uuid[]);
  v_file_count integer := 0;
  v_distinct_count integer := 0;
  v_valid_count integer := 0;
  v_primary_file_id uuid := null;
begin
  perform public.assert_store_catalog_settings_scope(
    p_organization_id,
    p_store_id
  );

  if p_allow_full_catalog_send is null then
    raise exception 'allow_full_catalog_send is required'
      using errcode = '22023';
  end if;

  v_file_count := coalesce(pg_catalog.cardinality(v_file_ids), 0);

  if p_allow_full_catalog_send is false and v_file_count > 0 then
    raise exception
      'customer catalog files must be empty when full catalog sending is disabled'
      using errcode = '22023';
  end if;

  if p_allow_full_catalog_send is true and v_file_count = 0 then
    raise exception
      'at least one customer catalog file is required when full catalog sending is enabled'
      using errcode = '22023';
  end if;

  if pg_catalog.array_position(v_file_ids, null::uuid) is not null then
    raise exception
      'customer catalog files cannot contain null ids'
      using errcode = '22023';
  end if;

  select count(*)
  into v_distinct_count
  from (
    select distinct file_id
    from pg_catalog.unnest(v_file_ids) as selected(file_id)
  ) distinct_files;

  if v_distinct_count <> v_file_count then
    raise exception
      'customer catalog files cannot contain duplicate ids'
      using errcode = '22023';
  end if;

  if p_allow_full_catalog_send is true then
    select count(*)
    into v_valid_count
    from public.store_import_files f
    where f.id = any(v_file_ids)
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
      );

    if v_valid_count <> v_file_count then
      raise exception
        'one or more customer catalog files are not active, scoped, stored, or linked to this store import'
        using errcode = '22023';
    end if;

    v_primary_file_id := v_file_ids[1];
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
    v_primary_file_id
  )
  on conflict on constraint store_catalog_settings_pkey
  do update set
    allow_full_catalog_send = excluded.allow_full_catalog_send,
    customer_catalog_import_file_id = excluded.customer_catalog_import_file_id;

  delete from public.store_catalog_customer_files cf
  where cf.organization_id = p_organization_id
    and cf.store_id = p_store_id;

  if p_allow_full_catalog_send is true then
    insert into public.store_catalog_customer_files (
      organization_id,
      store_id,
      import_file_id,
      sort_order
    )
    select
      p_organization_id,
      p_store_id,
      selected.file_id,
      selected.ordinality::integer
    from pg_catalog.unnest(v_file_ids) with ordinality
      as selected(file_id, ordinality);
  end if;

  return query
  select
    s.organization_id,
    s.store_id,
    s.allow_full_catalog_send,
    coalesce(
      pg_catalog.array_agg(cf.import_file_id order by cf.sort_order)
        filter (where cf.import_file_id is not null),
      '{}'::uuid[]
    ) as customer_catalog_import_file_ids,
    s.created_at,
    s.updated_at
  from public.store_catalog_settings s
  left join public.store_catalog_customer_files cf
    on cf.organization_id = s.organization_id
   and cf.store_id = s.store_id
  where s.organization_id = p_organization_id
    and s.store_id = p_store_id
  group by
    s.organization_id,
    s.store_id,
    s.allow_full_catalog_send,
    s.created_at,
    s.updated_at;
end;
$function$;

alter function public.upsert_store_catalog_settings_multi_scoped(
  uuid,
  uuid,
  boolean,
  uuid[]
) owner to postgres;

revoke all
on function public.upsert_store_catalog_settings_multi_scoped(
  uuid,
  uuid,
  boolean,
  uuid[]
)
from public, anon, authenticated, service_role;

grant execute
on function public.upsert_store_catalog_settings_multi_scoped(
  uuid,
  uuid,
  boolean,
  uuid[]
)
to authenticated;

-- Compatibilidade: o writer antigo continua funcionando, mas passa a manter
-- a lista canonica sincronizada com exatamente 0 ou 1 arquivo.
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
set search_path = pg_catalog, public
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
      'customer catalog file is not active, scoped, stored, or linked to this store import'
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

  delete from public.store_catalog_customer_files cf
  where cf.organization_id = p_organization_id
    and cf.store_id = p_store_id;

  if p_allow_full_catalog_send is true then
    insert into public.store_catalog_customer_files (
      organization_id,
      store_id,
      import_file_id,
      sort_order
    )
    values (
      p_organization_id,
      p_store_id,
      p_customer_catalog_import_file_id,
      1
    );
  end if;

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

-- O trigger existente passa a proteger QUALQUER arquivo presente na lista
-- canonica. O fallback para o mirror antigo mantem fail-closed durante a
-- transicao e protege contra inconsistencias acidentais.
create or replace function public.protect_selected_customer_catalog_import_link()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_is_selected boolean;
begin
  if tg_op = 'UPDATE'
     and new.import_file_id is not distinct from old.import_file_id
     and new.organization_id is not distinct from old.organization_id
     and new.store_id is not distinct from old.store_id then
    return new;
  end if;

  select (
    exists (
      select 1
      from public.store_catalog_customer_files selected_file
      where selected_file.organization_id = old.organization_id
        and selected_file.store_id = old.store_id
        and selected_file.import_file_id = old.import_file_id
    )
    or exists (
      select 1
      from public.store_catalog_settings settings_row
      where settings_row.organization_id = old.organization_id
        and settings_row.store_id = old.store_id
        and settings_row.allow_full_catalog_send is true
        and settings_row.customer_catalog_import_file_id = old.import_file_id
    )
  )
  into v_is_selected;

  if coalesce(v_is_selected, false) then
    raise exception
      'selected customer catalog file links cannot be removed while full catalog sending is enabled'
      using errcode = '23503';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

alter function public.protect_selected_customer_catalog_import_link()
owner to postgres;

revoke all
on function public.protect_selected_customer_catalog_import_link()
from public, anon, authenticated, service_role;

comment on function public.protect_selected_customer_catalog_import_link() is
  'P19-A: impede remover ou mover vinculos de qualquer arquivo autorizado na lista canonica de catalogos para clientes.';

commit;

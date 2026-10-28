begin;

do $preconditions$
begin
  if pg_catalog.to_regclass('public.sales_contracts') is null
     or pg_catalog.to_regclass('public.sales_contract_versions') is null
     or pg_catalog.to_regclass('public.sales_quotes') is null
     or pg_catalog.to_regclass('public.sales_quote_versions') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.messages') is null
     or pg_catalog.to_regclass('public.store_files') is null
     or pg_catalog.to_regclass('public.stores') is null then
    raise exception using
      errcode = '42P01',
      message = 'P9_9_3_CONTRACT_SEND_BARRIER_REQUIRED_TABLE_MISSING';
  end if;
end
$preconditions$;

-- Parent scope keys are supplied by the preceding P9 foundations. messages
-- only had a globally unique id, so create the composite FK support key here.
create unique index if not exists p9_messages_id_organization_store_uidx
  on public.messages (id, organization_id, store_id);

create table public.p9_sales_contract_send_barriers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  sales_contract_id uuid not null,
  sales_contract_version_id uuid not null,
  sales_quote_id uuid not null,
  sales_quote_version_id uuid not null,
  commercial_opportunity_id uuid not null,
  message_id uuid not null,
  outbound_idempotency_key text not null,
  activated_at timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  release_reason text,
  release_evidence jsonb,
  constraint p9_sales_contract_send_barriers_key_ck
    check (length(btrim(outbound_idempotency_key)) between 1 and 200),
  constraint p9_sales_contract_send_barriers_release_ck
    check (
      (released_at is null and release_reason is null and release_evidence is null)
      or (
        released_at is not null
        and release_reason in ('finalized', 'reconciled_no_delivery')
        and jsonb_typeof(release_evidence) = 'object'
        and released_at >= activated_at
      )
    ),
  constraint p9_sales_contract_send_barriers_scope_identity_ck
    check (
      organization_id is not null
      and store_id is not null
      and sales_contract_id is not null
      and sales_contract_version_id is not null
      and sales_quote_id is not null
      and sales_quote_version_id is not null
      and commercial_opportunity_id is not null
      and message_id is not null
    )
);

comment on table public.p9_sales_contract_send_barriers is
  'P9 9.3-B foundation only: durable identity barrier for a contract outbound attempt. The messages outbound fields remain the sole external-delivery authority.';

create unique index p9_contract_send_barriers_operation_uidx
  on public.p9_sales_contract_send_barriers (
    organization_id,
    store_id,
    outbound_idempotency_key
  );

create unique index p9_contract_send_barriers_message_uidx
  on public.p9_sales_contract_send_barriers (organization_id, store_id, message_id);

create unique index p9_contract_send_barriers_contract_version_uidx
  on public.p9_sales_contract_send_barriers (
    organization_id,
    store_id,
    sales_contract_id,
    sales_contract_version_id
  );

-- Keep the contract, proposal and proposal version as one canonical lineage.
create unique index if not exists p9_sales_contracts_id_quote_lineage_scope_uidx
  on public.sales_contracts (
    id,
    quote_id,
    quote_version_id,
    organization_id,
    store_id
  );

-- Validate every referenced parent key before adding the eight composite FKs.
-- A primary key on id alone does not satisfy a multi-column FK.
do $parent_keys$
declare
  v_key record;
begin
  for v_key in
    select * from (values
      ('public.stores', array['id','organization_id']::text[]),
      ('public.sales_contracts', array['id','organization_id','store_id']::text[]),
      ('public.sales_contracts', array['id','quote_id','quote_version_id','organization_id','store_id']::text[]),
      ('public.sales_contract_versions', array['id','contract_id','organization_id','store_id']::text[]),
      ('public.sales_quotes', array['id','commercial_opportunity_id','organization_id','store_id']::text[]),
      ('public.sales_quote_versions', array['id','quote_id','organization_id','store_id']::text[]),
      ('public.commercial_opportunities', array['id','organization_id','store_id']::text[]),
      ('public.messages', array['id','organization_id','store_id']::text[])
    ) as required(parent_table, key_columns)
  loop
    if not exists (
      select 1
        from pg_catalog.pg_index idx
       where idx.indrelid = v_key.parent_table::pg_catalog.regclass
         and idx.indisunique
         and idx.indisvalid
         and idx.indisready
         and idx.indimmediate
         and idx.indpred is null
         and idx.indexprs is null
         and idx.indnkeyatts = cardinality(v_key.key_columns)
         and (
           select array_agg(att.attname::text order by att.attname)
             from pg_catalog.generate_series(0, idx.indnkeyatts - 1) as ordinal(position)
             join pg_catalog.pg_attribute att
               on att.attrelid = idx.indrelid
              and att.attnum = idx.indkey[ordinal.position]
         ) = (
           select array_agg(column_name order by column_name)
             from unnest(v_key.key_columns) as column_name
         )
    ) then
      raise exception using
        errcode = '42830',
        message = 'P9_9_3_BARRIER_PARENT_COMPOSITE_KEY_MISSING',
        detail = v_key.parent_table || ': ' || array_to_string(v_key.key_columns, ', ');
    end if;
  end loop;
end
$parent_keys$;

alter table public.p9_sales_contract_send_barriers
  add constraint p9_contract_send_barriers_store_scope_fkey
  foreign key (store_id, organization_id)
  references public.stores (id, organization_id)
  on delete restrict,
  add constraint p9_contract_send_barriers_contract_scope_fkey
  foreign key (sales_contract_id, organization_id, store_id)
  references public.sales_contracts (id, organization_id, store_id)
  on delete restrict,
  add constraint p9_contract_send_barriers_contract_quote_lineage_fkey
  foreign key (
    sales_contract_id,
    sales_quote_id,
    sales_quote_version_id,
    organization_id,
    store_id
  )
  references public.sales_contracts (
    id,
    quote_id,
    quote_version_id,
    organization_id,
    store_id
  )
  on delete restrict,
  add constraint p9_contract_send_barriers_contract_version_scope_fkey
  foreign key (
    sales_contract_version_id,
    sales_contract_id,
    organization_id,
    store_id
  )
  references public.sales_contract_versions (
    id,
    contract_id,
    organization_id,
    store_id
  )
  on delete restrict,
  add constraint p9_contract_send_barriers_quote_opportunity_scope_fkey
  foreign key (
    sales_quote_id,
    commercial_opportunity_id,
    organization_id,
    store_id
  )
  references public.sales_quotes (
    id,
    commercial_opportunity_id,
    organization_id,
    store_id
  )
  on delete restrict,
  add constraint p9_contract_send_barriers_quote_version_scope_fkey
  foreign key (
    sales_quote_version_id,
    sales_quote_id,
    organization_id,
    store_id
  )
  references public.sales_quote_versions (
    id,
    quote_id,
    organization_id,
    store_id
  )
  on delete restrict,
  add constraint p9_contract_send_barriers_opportunity_scope_fkey
  foreign key (
    commercial_opportunity_id,
    organization_id,
    store_id
  )
  references public.commercial_opportunities (id, organization_id, store_id)
  on delete restrict,
  add constraint p9_contract_send_barriers_message_scope_fkey
  foreign key (message_id, organization_id, store_id)
  references public.messages (id, organization_id, store_id)
  on delete restrict;

create unique index p9_contract_send_barriers_active_contract_uidx
  on public.p9_sales_contract_send_barriers (
    organization_id,
    store_id,
    sales_contract_id
  )
  where released_at is null;

create index p9_contract_send_barriers_active_opportunity_idx
  on public.p9_sales_contract_send_barriers (
    organization_id,
    store_id,
    commercial_opportunity_id
  )
  where released_at is null;

alter table public.p9_sales_contract_send_barriers enable row level security;
alter table public.p9_sales_contract_send_barriers force row level security;

revoke all on table public.p9_sales_contract_send_barriers from public;
revoke all on table public.p9_sales_contract_send_barriers from anon;
revoke all on table public.p9_sales_contract_send_barriers from authenticated;
revoke all on table public.p9_sales_contract_send_barriers from service_role;

create or replace function public.p9_acquire_sales_contract_send_domain_lock(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_lock_key bigint;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22023',
      message = 'P9_9_3_CONTRACT_SEND_DOMAIN_LOCK_IDENTITY_REQUIRED';
  end if;

  -- Contract: every authority in this domain must acquire this exact key before
  -- its first row lock. There is intentionally no contract fallback: an
  -- opportunity-scoped operation must never serialize under another identity.
  v_lock_key := pg_catalog.hashtextextended(
    'zion:p9:contract-send:'
      || p_organization_id::text || ':'
      || p_store_id::text || ':'
      || p_commercial_opportunity_id::text,
    0
  );
  perform pg_catalog.pg_advisory_xact_lock(v_lock_key);
end;
$function$;

alter function public.p9_acquire_sales_contract_send_domain_lock(uuid, uuid, uuid)
  owner to postgres;

revoke all on function public.p9_acquire_sales_contract_send_domain_lock(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.p9_read_active_sales_contract_send_barriers_by_contract(
  p_organization_id uuid,
  p_store_id uuid,
  p_sales_contract_id uuid
)
returns table (
  barrier_id uuid,
  organization_id uuid,
  store_id uuid,
  sales_contract_id uuid,
  sales_contract_version_id uuid,
  sales_quote_id uuid,
  sales_quote_version_id uuid,
  commercial_opportunity_id uuid,
  message_id uuid,
  outbound_idempotency_key text,
  activated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
begin
  if p_organization_id is null
     or p_store_id is null
     or p_sales_contract_id is null then
    raise exception using
      errcode = '22023',
      message = 'P9_9_3_CONTRACT_SEND_BARRIER_READ_IDENTITY_REQUIRED';
  end if;

  return query
  select
    b.id,
    b.organization_id,
    b.store_id,
    b.sales_contract_id,
    b.sales_contract_version_id,
    b.sales_quote_id,
    b.sales_quote_version_id,
    b.commercial_opportunity_id,
    b.message_id,
    b.outbound_idempotency_key,
    b.activated_at
  from public.p9_sales_contract_send_barriers b
  where b.organization_id = p_organization_id
    and b.store_id = p_store_id
    and b.sales_contract_id = p_sales_contract_id
    and b.released_at is null;
end;
$function$;

alter function public.p9_read_active_sales_contract_send_barriers_by_contract(uuid, uuid, uuid)
  owner to postgres;

revoke all on function public.p9_read_active_sales_contract_send_barriers_by_contract(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.p9_read_active_sales_contract_send_barriers_by_opportunity(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
)
returns table (
  barrier_id uuid,
  organization_id uuid,
  store_id uuid,
  sales_contract_id uuid,
  sales_contract_version_id uuid,
  sales_quote_id uuid,
  sales_quote_version_id uuid,
  commercial_opportunity_id uuid,
  message_id uuid,
  outbound_idempotency_key text,
  activated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22023',
      message = 'P9_9_3_CONTRACT_SEND_BARRIER_READ_IDENTITY_REQUIRED';
  end if;

  return query
  select
    b.id,
    b.organization_id,
    b.store_id,
    b.sales_contract_id,
    b.sales_contract_version_id,
    b.sales_quote_id,
    b.sales_quote_version_id,
    b.commercial_opportunity_id,
    b.message_id,
    b.outbound_idempotency_key,
    b.activated_at
  from public.p9_sales_contract_send_barriers b
  where b.organization_id = p_organization_id
    and b.store_id = p_store_id
    and b.commercial_opportunity_id = p_commercial_opportunity_id
    and b.released_at is null;
end;
$function$;

alter function public.p9_read_active_sales_contract_send_barriers_by_opportunity(uuid, uuid, uuid)
  owner to postgres;

revoke all on function public.p9_read_active_sales_contract_send_barriers_by_opportunity(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.p9_guard_sales_contract_send_barrier_immutability()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '42501',
      message = 'P9_9_3_CONTRACT_SEND_BARRIER_DELETE_FORBIDDEN';
  end if;

  -- Release authority is intentionally not installed in this foundation.
  -- Future migrations must replace this guard with a narrowly-scoped finalizer
  -- path; no caller may update release fields directly today.
  raise exception using
    errcode = '42501',
    message = 'P9_9_3_CONTRACT_SEND_BARRIER_UPDATE_AUTHORITY_NOT_INSTALLED';
end;
$function$;

alter function public.p9_guard_sales_contract_send_barrier_immutability()
  owner to postgres;

revoke all on function public.p9_guard_sales_contract_send_barrier_immutability()
  from public, anon, authenticated, service_role;

create trigger p9_contract_send_barrier_immutability_guard
before update or delete
on public.p9_sales_contract_send_barriers
for each row
execute function public.p9_guard_sales_contract_send_barrier_immutability();

comment on function public.p9_acquire_sales_contract_send_domain_lock(uuid, uuid, uuid) is
  'Internal foundation contract: acquire the exact organization/store/opportunity advisory lock before any row lock. This function does not authorize or release external delivery.';

comment on function public.p9_read_active_sales_contract_send_barriers_by_contract(uuid, uuid, uuid) is
  'Internal non-serializing read of active contract-send barriers. It is not proof of concurrency safety and never decides external delivery.';

comment on function public.p9_read_active_sales_contract_send_barriers_by_opportunity(uuid, uuid, uuid) is
  'Internal non-serializing read of active opportunity barriers. It is not proof of concurrency safety and never decides external delivery.';

do $postconditions$
declare
  v_relrowsecurity boolean;
  v_force_row_security boolean;
begin
  select c.relrowsecurity, c.relforcerowsecurity
    into v_relrowsecurity, v_force_row_security
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'p9_sales_contract_send_barriers';

  if not coalesce(v_relrowsecurity, false)
     or not coalesce(v_force_row_security, false) then
    raise exception using message = 'P9_9_3_CONTRACT_SEND_BARRIER_RLS_NOT_HARDENED';
  end if;
  if has_table_privilege('public', 'public.p9_sales_contract_send_barriers', 'INSERT')
     or has_table_privilege('anon', 'public.p9_sales_contract_send_barriers', 'INSERT')
     or has_table_privilege('authenticated', 'public.p9_sales_contract_send_barriers', 'INSERT')
     or has_table_privilege('service_role', 'public.p9_sales_contract_send_barriers', 'INSERT') then
    raise exception using message = 'P9_9_3_CONTRACT_SEND_BARRIER_INSERT_GRANT_UNEXPECTED';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_constraint
    where conrelid = 'public.p9_sales_contract_send_barriers'::pg_catalog.regclass
      and conname in (
        'p9_contract_send_barriers_store_scope_fkey',
        'p9_contract_send_barriers_contract_scope_fkey',
        'p9_contract_send_barriers_contract_quote_lineage_fkey',
        'p9_contract_send_barriers_contract_version_scope_fkey',
        'p9_contract_send_barriers_quote_opportunity_scope_fkey',
        'p9_contract_send_barriers_quote_version_scope_fkey',
        'p9_contract_send_barriers_opportunity_scope_fkey',
        'p9_contract_send_barriers_message_scope_fkey'
      )
      and convalidated
  ) <> 8 then
    raise exception using message = 'P9_9_3_CONTRACT_SEND_BARRIER_SCOPE_FK_POSTCONDITION_FAILED';
  end if;
end
$postconditions$;

commit;

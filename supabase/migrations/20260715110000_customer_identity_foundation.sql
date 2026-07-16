  create table if not exists public.customers (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null,
    display_name text null,
    normalized_name text null,
    merged_into_customer_id uuid null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint customers_organization_fkey
      foreign key (organization_id)
      references public.organizations(id)
      on delete cascade,

    constraint customers_display_name_not_blank_check
      check (display_name is null or length(btrim(display_name)) > 0),

    constraint customers_normalized_name_not_blank_check
      check (normalized_name is null or length(btrim(normalized_name)) > 0),

    constraint customers_not_merged_into_self_check
      check (merged_into_customer_id is null or merged_into_customer_id <> id)
  );

  create unique index if not exists customers_id_organization_uidx
    on public.customers (id, organization_id);

  alter table public.customers
    add constraint customers_merged_into_customer_same_org_fkey
    foreign key (merged_into_customer_id, organization_id)
    references public.customers(id, organization_id)
    on delete set null;

  create index if not exists customers_organization_idx
    on public.customers (organization_id);

  create index if not exists customers_organization_normalized_name_idx
    on public.customers (organization_id, normalized_name)
    where normalized_name is not null;

  create index if not exists customers_merged_into_customer_idx
    on public.customers (merged_into_customer_id)
    where merged_into_customer_id is not null;

  create table if not exists public.customer_channel_identities (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null,
    customer_id uuid not null,
    channel text not null,
    external_identity text not null,
    normalized_external_identity text not null,
    is_primary boolean not null default false,
    verified_at timestamptz null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint customer_channel_identities_organization_fkey
      foreign key (organization_id)
      references public.organizations(id)
      on delete cascade,

    constraint customer_channel_identities_customer_org_fkey
      foreign key (customer_id, organization_id)
      references public.customers(id, organization_id)
      on delete cascade,

    constraint customer_channel_identities_channel_not_blank_check
      check (length(btrim(channel)) > 0),

    constraint customer_channel_identities_channel_format_check
      check (channel ~ '^[a-z0-9_:-]+$'),

    constraint customer_channel_identities_external_identity_not_blank_check
  check (length(btrim(external_identity)) > 0)
  );

  create unique index if not exists customer_channel_identities_org_channel_identity_uidx
    on public.customer_channel_identities (
      organization_id,
      channel,
      normalized_external_identity
    );

  create unique index if not exists customer_channel_identities_primary_per_channel_uidx
    on public.customer_channel_identities (customer_id, channel)
    where is_primary = true;

  create index if not exists customer_channel_identities_customer_idx
    on public.customer_channel_identities (customer_id);

  create index if not exists customer_channel_identities_org_channel_idx
    on public.customer_channel_identities (organization_id, channel);

  create index if not exists customer_channel_identities_org_customer_idx
    on public.customer_channel_identities (organization_id, customer_id);

  create unique index if not exists stores_id_organization_uidx
    on public.stores (id, organization_id);

  create table if not exists public.customer_store_links (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null,
    store_id uuid not null,
    customer_id uuid not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint customer_store_links_organization_fkey
      foreign key (organization_id)
      references public.organizations(id)
      on delete cascade,

    constraint customer_store_links_store_org_fkey
      foreign key (store_id, organization_id)
      references public.stores(id, organization_id)
      on delete cascade,

    constraint customer_store_links_customer_org_fkey
      foreign key (customer_id, organization_id)
      references public.customers(id, organization_id)
      on delete cascade
  );

  create unique index if not exists customer_store_links_customer_store_uidx
    on public.customer_store_links (customer_id, store_id);

  create index if not exists customer_store_links_store_idx
    on public.customer_store_links (store_id);

  create index if not exists customer_store_links_customer_idx
    on public.customer_store_links (customer_id);

  create index if not exists customer_store_links_org_store_idx
    on public.customer_store_links (organization_id, store_id);

  create or replace function public.touch_customer_identity_updated_at()
  returns trigger
  language plpgsql
  as $$
  begin
    new.updated_at := now();
    return new;
  end;
  $$;

  create or replace function public.prevent_customer_identity_organization_change()
  returns trigger
  language plpgsql
  as $$
  begin
    if new.organization_id is distinct from old.organization_id then
      raise exception 'organization_id is immutable after insert for %', tg_table_name;
    end if;

    return new;
  end;
  $$;

  drop trigger if exists customers_touch_updated_at on public.customers;
  create trigger customers_touch_updated_at
    before update on public.customers
    for each row
    execute function public.touch_customer_identity_updated_at();

  drop trigger if exists customers_prevent_organization_change on public.customers;
  create trigger customers_prevent_organization_change
    before update on public.customers
    for each row
    execute function public.prevent_customer_identity_organization_change();

  drop trigger if exists customer_channel_identities_touch_updated_at on public.customer_channel_identities;
  create trigger customer_channel_identities_touch_updated_at
    before update on public.customer_channel_identities
    for each row
    execute function public.touch_customer_identity_updated_at();

  drop trigger if exists customer_channel_identities_prevent_organization_change on public.customer_channel_identities;
  create trigger customer_channel_identities_prevent_organization_change
    before update on public.customer_channel_identities
    for each row
    execute function public.prevent_customer_identity_organization_change();

  drop trigger if exists customer_store_links_touch_updated_at on public.customer_store_links;
  create trigger customer_store_links_touch_updated_at
    before update on public.customer_store_links
    for each row
    execute function public.touch_customer_identity_updated_at();

  drop trigger if exists customer_store_links_prevent_organization_change on public.customer_store_links;
  create trigger customer_store_links_prevent_organization_change
    before update on public.customer_store_links
    for each row
    execute function public.prevent_customer_identity_organization_change();

  alter table public.customers enable row level security;
  alter table public.customer_channel_identities enable row level security;
  alter table public.customer_store_links enable row level security;

  revoke all on table public.customers from public;
  revoke all on table public.customers from anon;
  revoke all on table public.customers from authenticated;

  revoke all on table public.customer_channel_identities from public;
  revoke all on table public.customer_channel_identities from anon;
  revoke all on table public.customer_channel_identities from authenticated;

  revoke all on table public.customer_store_links from public;
  revoke all on table public.customer_store_links from anon;
  revoke all on table public.customer_store_links from authenticated;

  grant select, insert, update on table public.customers to authenticated;
  grant select, insert, update on table public.customer_channel_identities to authenticated;
  grant select, insert, update on table public.customer_store_links to authenticated;

  grant all on table public.customers to service_role;
  grant all on table public.customer_channel_identities to service_role;
  grant all on table public.customer_store_links to service_role;

  drop policy if exists customers_select_by_membership on public.customers;
  create policy customers_select_by_membership
    on public.customers
    for select
    to authenticated
    using (
      exists (
        select 1
        from public.memberships m
        where m.organization_id = customers.organization_id
          and m.user_id = auth.uid()
      )
    );

  drop policy if exists customers_insert_by_membership on public.customers;
  create policy customers_insert_by_membership
    on public.customers
    for insert
    to authenticated
    with check (
      exists (
        select 1
        from public.memberships m
        where m.organization_id = customers.organization_id
          and m.user_id = auth.uid()
      )
    );

  drop policy if exists customers_update_by_membership on public.customers;
  create policy customers_update_by_membership
    on public.customers
    for update
    to authenticated
    using (
      exists (
        select 1
        from public.memberships m
        where m.organization_id = customers.organization_id
          and m.user_id = auth.uid()
      )
    )
    with check (
      exists (
        select 1
        from public.memberships m
        where m.organization_id = customers.organization_id
          and m.user_id = auth.uid()
      )
    );

  drop policy if exists customer_channel_identities_select_by_membership on public.customer_channel_identities;
  create policy customer_channel_identities_select_by_membership
    on public.customer_channel_identities
    for select
    to authenticated
    using (
      exists (
        select 1
        from public.memberships m
        where m.organization_id = customer_channel_identities.organization_id
          and m.user_id = auth.uid()
      )
    );

  drop policy if exists customer_channel_identities_insert_by_membership on public.customer_channel_identities;
  create policy customer_channel_identities_insert_by_membership
    on public.customer_channel_identities
    for insert
    to authenticated
    with check (
      exists (
        select 1
        from public.memberships m
        where m.organization_id = customer_channel_identities.organization_id
          and m.user_id = auth.uid()
      )
    );

  drop policy if exists customer_channel_identities_update_by_membership on public.customer_channel_identities;
  create policy customer_channel_identities_update_by_membership
    on public.customer_channel_identities
    for update
    to authenticated
    using (
      exists (
        select 1
        from public.memberships m
        where m.organization_id = customer_channel_identities.organization_id
          and m.user_id = auth.uid()
      )
    )
    with check (
      exists (
        select 1
        from public.memberships m
        where m.organization_id = customer_channel_identities.organization_id
          and m.user_id = auth.uid()
      )
    );

  drop policy if exists customer_store_links_select_by_membership on public.customer_store_links;
  create policy customer_store_links_select_by_membership
    on public.customer_store_links
    for select
    to authenticated
    using (
      exists (
        select 1
        from public.memberships m
        where m.organization_id = customer_store_links.organization_id
          and m.user_id = auth.uid()
      )
    );

  drop policy if exists customer_store_links_insert_by_membership on public.customer_store_links;
  create policy customer_store_links_insert_by_membership
    on public.customer_store_links
    for insert
    to authenticated
    with check (
      exists (
        select 1
        from public.memberships m
        where m.organization_id = customer_store_links.organization_id
          and m.user_id = auth.uid()
      )
      and exists (
        select 1
        from public.stores s
        where s.id = customer_store_links.store_id
          and s.organization_id = customer_store_links.organization_id
      )
    );

  drop policy if exists customer_store_links_update_by_membership on public.customer_store_links;
  create policy customer_store_links_update_by_membership
    on public.customer_store_links
    for update
    to authenticated
    using (
      exists (
        select 1
        from public.memberships m
        where m.organization_id = customer_store_links.organization_id
          and m.user_id = auth.uid()
      )
    )
    with check (
      exists (
        select 1
        from public.memberships m
        where m.organization_id = customer_store_links.organization_id
          and m.user_id = auth.uid()
      )
      and exists (
        select 1
        from public.stores s
        where s.id = customer_store_links.store_id
          and s.organization_id = customer_store_links.organization_id
      )
    );

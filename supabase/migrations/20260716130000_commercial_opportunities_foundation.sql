create table public.commercial_opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  customer_id uuid not null,
  origin_lead_id uuid null,
  primary_conversation_id uuid null,
  stage text not null default 'novo_lead',
  stage_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint commercial_opportunities_organization_fkey
    foreign key (organization_id)
    references public.organizations(id)
    on delete cascade,

  constraint commercial_opportunities_store_org_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete restrict,

  constraint commercial_opportunities_customer_org_fkey
    foreign key (customer_id, organization_id)
    references public.customers(id, organization_id)
    on delete restrict,

  constraint commercial_opportunities_stage_check
    check (
      stage in (
        'novo_lead',
        'qualificacao',
        'orcamento',
        'visita_tecnica',
        'negociacao',
        'fechamento_pagamento',
        'instalacao_entrega',
        'pos_venda',
        'perdido',
        'concluido_sem_mais_acoes'
      )
    )
);

create unique index commercial_opportunities_id_organization_uidx
  on public.commercial_opportunities (id, organization_id);

create unique index commercial_opportunities_id_organization_store_uidx
  on public.commercial_opportunities (id, organization_id, store_id);

create index commercial_opportunities_org_store_stage_updated_idx
  on public.commercial_opportunities (organization_id, store_id, stage, updated_at desc);

create index commercial_opportunities_org_customer_updated_idx
  on public.commercial_opportunities (organization_id, customer_id, updated_at desc);

create index commercial_opportunities_org_origin_lead_idx
  on public.commercial_opportunities (organization_id, origin_lead_id)
  where origin_lead_id is not null;

create index commercial_opportunities_org_primary_conversation_idx
  on public.commercial_opportunities (organization_id, primary_conversation_id)
  where primary_conversation_id is not null;

create or replace function public.touch_commercial_opportunity_timestamps()
returns trigger
language plpgsql
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  new.updated_at := v_now;

  if new.stage is distinct from old.stage then
    new.stage_changed_at := v_now;
  else
    new.stage_changed_at := old.stage_changed_at;
  end if;

  return new;
end;
$$;

create or replace function public.prevent_commercial_opportunity_organization_change()
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

drop trigger if exists commercial_opportunities_touch_timestamps on public.commercial_opportunities;
create trigger commercial_opportunities_touch_timestamps
  before update on public.commercial_opportunities
  for each row
  execute function public.touch_commercial_opportunity_timestamps();

drop trigger if exists commercial_opportunities_prevent_organization_change on public.commercial_opportunities;
create trigger commercial_opportunities_prevent_organization_change
  before update on public.commercial_opportunities
  for each row
  execute function public.prevent_commercial_opportunity_organization_change();

alter table public.commercial_opportunities enable row level security;

revoke all on table public.commercial_opportunities from public;
revoke all on table public.commercial_opportunities from anon;
revoke all on table public.commercial_opportunities from authenticated;

grant select, insert, update on table public.commercial_opportunities to authenticated;
grant all on table public.commercial_opportunities to service_role;

drop policy if exists commercial_opportunities_select_by_membership on public.commercial_opportunities;
create policy commercial_opportunities_select_by_membership
  on public.commercial_opportunities
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      where m.organization_id = commercial_opportunities.organization_id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists commercial_opportunities_insert_by_membership on public.commercial_opportunities;
create policy commercial_opportunities_insert_by_membership
  on public.commercial_opportunities
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.memberships m
      where m.organization_id = commercial_opportunities.organization_id
        and m.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.stores s
      where s.id = commercial_opportunities.store_id
        and s.organization_id = commercial_opportunities.organization_id
    )
    and exists (
      select 1
      from public.customers c
      where c.id = commercial_opportunities.customer_id
        and c.organization_id = commercial_opportunities.organization_id
    )
  );

drop policy if exists commercial_opportunities_update_by_membership on public.commercial_opportunities;
create policy commercial_opportunities_update_by_membership
  on public.commercial_opportunities
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      where m.organization_id = commercial_opportunities.organization_id
        and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.memberships m
      where m.organization_id = commercial_opportunities.organization_id
        and m.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.stores s
      where s.id = commercial_opportunities.store_id
        and s.organization_id = commercial_opportunities.organization_id
    )
    and exists (
      select 1
      from public.customers c
      where c.id = commercial_opportunities.customer_id
        and c.organization_id = commercial_opportunities.organization_id
    )
  );

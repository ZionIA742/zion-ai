begin;

create table if not exists public.store_discount_counterpart_policy (
  organization_id uuid not null,
  store_id uuid not null,
  enabled boolean not null default false,
  allowed_payment_methods text[] not null default '{}'::text[],
  higher_down_payment_enabled boolean not null default false,
  higher_down_payment_minimum_type text,
  higher_down_payment_minimum_percent numeric(7,4),
  higher_down_payment_minimum_amount_cents bigint,
  fewer_installments_enabled boolean not null default false,
  fewer_installments_max_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, store_id),
  constraint store_discount_counterpart_policy_org_fk
    foreign key (organization_id) references public.organizations(id),
  constraint store_discount_counterpart_policy_store_org_fk
    foreign key (store_id, organization_id) references public.stores(id, organization_id),
  constraint store_discount_counterpart_policy_methods_ck check (
    allowed_payment_methods <@ array['pix','cartao_credito','cartao_debito','boleto','dinheiro','transferencia','financiamento']::text[]
  ),
  constraint store_discount_counterpart_policy_type_ck check (
    higher_down_payment_minimum_type is null
    or higher_down_payment_minimum_type in ('percent','fixed')
  ),
  constraint store_discount_counterpart_policy_percent_ck check (
    higher_down_payment_minimum_percent is null
    or (higher_down_payment_minimum_percent > 0 and higher_down_payment_minimum_percent <= 100)
  ),
  constraint store_discount_counterpart_policy_amount_ck check (
    higher_down_payment_minimum_amount_cents is null
    or higher_down_payment_minimum_amount_cents > 0
  ),
  constraint store_discount_counterpart_policy_higher_shape_ck check (
    (higher_down_payment_enabled = false and higher_down_payment_minimum_type is null and higher_down_payment_minimum_percent is null and higher_down_payment_minimum_amount_cents is null)
    or (higher_down_payment_enabled = true and ((higher_down_payment_minimum_type = 'percent' and higher_down_payment_minimum_percent is not null and higher_down_payment_minimum_amount_cents is null) or (higher_down_payment_minimum_type = 'fixed' and higher_down_payment_minimum_percent is null and higher_down_payment_minimum_amount_cents is not null)))
  ),
  constraint store_discount_counterpart_policy_installments_ck check (
    (fewer_installments_enabled = false and fewer_installments_max_count is null)
    or (fewer_installments_enabled = true and fewer_installments_max_count >= 1)
  )
);

alter table public.store_discount_counterpart_policy enable row level security;
alter table public.store_discount_counterpart_policy force row level security;
revoke all on table public.store_discount_counterpart_policy from public;
revoke all on table public.store_discount_counterpart_policy from anon;
revoke all on table public.store_discount_counterpart_policy from authenticated;
revoke all on table public.store_discount_counterpart_policy from service_role;

create or replace function public.store_discount_counterpart_policy_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists store_discount_counterpart_policy_touch_updated_at on public.store_discount_counterpart_policy;
create trigger store_discount_counterpart_policy_touch_updated_at
before update on public.store_discount_counterpart_policy
for each row execute function public.store_discount_counterpart_policy_touch_updated_at();

create or replace function public.read_store_discount_counterpart_policy_scoped(
  p_organization_id uuid,
  p_store_id uuid
)
returns setof public.store_discount_counterpart_policy
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $$
declare v_request_role text := public.zion_resolve_request_role_internal(); v_is_member boolean;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception 'organization_id and store_id are required';
  end if;
  if v_request_role = 'authenticated' then
    select exists (select 1 from public.memberships m where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.is_active is true) into v_is_member;
    if coalesce(v_is_member, false) is not true then raise exception using errcode = '42501', message = 'discount counterpart policy scope is not authorized'; end if;
  elsif v_request_role <> 'postgres' then
    raise exception using errcode = '42501', message = 'discount counterpart policy scope is not authorized';
  end if;
  perform 1 from public.stores s where s.id = p_store_id and s.organization_id = p_organization_id;
  if not found then raise exception using errcode = '42501', message = 'discount counterpart policy scope is not authorized'; end if;
  return query
    select p.* from public.store_discount_counterpart_policy p
    where p.organization_id = p_organization_id and p.store_id = p_store_id;
end;
$$;

create or replace function public.upsert_store_discount_counterpart_policy_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_enabled boolean,
  p_allowed_payment_methods text[],
  p_higher_down_payment_enabled boolean,
  p_higher_down_payment_minimum_type text,
  p_higher_down_payment_minimum_percent numeric,
  p_higher_down_payment_minimum_amount_cents bigint,
  p_fewer_installments_enabled boolean,
  p_fewer_installments_max_count integer
)
returns public.store_discount_counterpart_policy
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $$
declare v_row public.store_discount_counterpart_policy; v_request_role text := public.zion_resolve_request_role_internal(); v_is_member boolean;
begin
  if p_organization_id is null or p_store_id is null then raise exception 'organization_id and store_id are required'; end if;
  if v_request_role = 'authenticated' then
    select exists (select 1 from public.memberships m where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.is_active is true) into v_is_member;
    if coalesce(v_is_member, false) is not true then raise exception using errcode = '42501', message = 'discount counterpart policy scope is not authorized'; end if;
  elsif v_request_role <> 'postgres' then
    raise exception using errcode = '42501', message = 'discount counterpart policy scope is not authorized';
  end if;
  perform 1 from public.stores s where s.id = p_store_id and s.organization_id = p_organization_id;
  if not found then raise exception using errcode = '42501', message = 'discount counterpart policy scope is not authorized'; end if;
  insert into public.store_discount_counterpart_policy (
    organization_id, store_id, enabled, allowed_payment_methods,
    higher_down_payment_enabled, higher_down_payment_minimum_type,
    higher_down_payment_minimum_percent, higher_down_payment_minimum_amount_cents,
    fewer_installments_enabled, fewer_installments_max_count, updated_at
  ) values (
    p_organization_id, p_store_id, coalesce(p_enabled, false),
    case when coalesce(p_enabled, false) then coalesce(p_allowed_payment_methods, '{}'::text[]) else '{}'::text[] end,
    case when coalesce(p_enabled, false) then coalesce(p_higher_down_payment_enabled, false) else false end,
    case when coalesce(p_enabled, false) and coalesce(p_higher_down_payment_enabled, false) then p_higher_down_payment_minimum_type else null end,
    case when coalesce(p_enabled, false) and coalesce(p_higher_down_payment_enabled, false) then p_higher_down_payment_minimum_percent else null end,
    case when coalesce(p_enabled, false) and coalesce(p_higher_down_payment_enabled, false) then p_higher_down_payment_minimum_amount_cents else null end,
    case when coalesce(p_enabled, false) then coalesce(p_fewer_installments_enabled, false) else false end,
    case when coalesce(p_enabled, false) and coalesce(p_fewer_installments_enabled, false) then p_fewer_installments_max_count else null end,
    now()
  ) on conflict (organization_id, store_id) do update set
    enabled = excluded.enabled,
    allowed_payment_methods = excluded.allowed_payment_methods,
    higher_down_payment_enabled = excluded.higher_down_payment_enabled,
    higher_down_payment_minimum_type = excluded.higher_down_payment_minimum_type,
    higher_down_payment_minimum_percent = excluded.higher_down_payment_minimum_percent,
    higher_down_payment_minimum_amount_cents = excluded.higher_down_payment_minimum_amount_cents,
    fewer_installments_enabled = excluded.fewer_installments_enabled,
    fewer_installments_max_count = excluded.fewer_installments_max_count,
    updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

alter function public.read_store_discount_counterpart_policy_scoped(uuid, uuid) owner to postgres;
alter function public.upsert_store_discount_counterpart_policy_scoped(uuid, uuid, boolean, text[], boolean, text, numeric, bigint, boolean, integer) owner to postgres;
revoke all on function public.read_store_discount_counterpart_policy_scoped(uuid, uuid) from public, anon, authenticated;
revoke all on function public.upsert_store_discount_counterpart_policy_scoped(uuid, uuid, boolean, text[], boolean, text, numeric, bigint, boolean, integer) from public, anon, authenticated;
grant execute on function public.read_store_discount_counterpart_policy_scoped(uuid, uuid) to authenticated, service_role;
grant execute on function public.upsert_store_discount_counterpart_policy_scoped(uuid, uuid, boolean, text[], boolean, text, numeric, bigint, boolean, integer) to authenticated, service_role;

commit;

-- ZION Administrador: fixed-cost effective dates and immutable monthly financial closes.
-- Apply in Supabase SQL Editor only after code review. No organization/store billing mutations.
create table if not exists public.zion_admin_fixed_cost_items (
  id uuid primary key default gen_random_uuid(),
  starts_on date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.zion_admin_fixed_cost_versions (
  item_id uuid not null references public.zion_admin_fixed_cost_items(id) on delete restrict,
  effective_month date not null,
  name text not null,
  amount_cents bigint not null check (amount_cents >= 0 and amount_cents <= 100000000000),
  frequency text not null check (frequency in ('monthly','annual')),
  enabled boolean not null,
  changed_at timestamptz not null default now(),
  primary key (item_id,effective_month),
  constraint zion_admin_cost_month_first check (extract(day from effective_month) = 1),
  constraint zion_admin_cost_name check (char_length(trim(name)) between 1 and 100)
);

create table if not exists public.zion_admin_monthly_closures (
  month date primary key check (extract(day from month) = 1),
  fixed_brl_cents bigint not null check (fixed_brl_cents >= 0),
  ai_usd numeric(20,8) not null check (ai_usd >= 0),
  fx_usd_brl numeric(16,6) not null check (fx_usd_brl > 0),
  variable_brl_cents bigint not null check (variable_brl_cents >= 0),
  total_brl_cents bigint not null check (total_brl_cents >= 0),
  fixed_items jsonb not null default '[]'::jsonb,
  ai_runs bigint not null check (ai_runs >= 0),
  closed_at timestamptz not null default now(),
  check (total_brl_cents = fixed_brl_cents + variable_brl_cents)
);

-- Client (anon/authenticated) cannot access finance tables directly; admin endpoints authenticate first.
revoke all on public.zion_admin_fixed_cost_items from public, anon, authenticated;
revoke all on public.zion_admin_fixed_cost_versions from public, anon, authenticated;
revoke all on public.zion_admin_monthly_closures from public, anon, authenticated;
alter table public.zion_admin_fixed_cost_items enable row level security;
alter table public.zion_admin_fixed_cost_versions enable row level security;
alter table public.zion_admin_monthly_closures enable row level security;
grant select,insert on public.zion_admin_fixed_cost_items to service_role;
grant select,insert,update on public.zion_admin_fixed_cost_versions to service_role;
grant select,insert on public.zion_admin_monthly_closures to service_role;

-- Immutable historical close. Reconciliation must be an explicit, separately approved process.
create or replace function public.zion_admin_refuse_close_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'ZION_ADMIN_MONTH_CLOSE_IMMUTABLE';
end;
$$;
drop trigger if exists zion_admin_close_immutable on public.zion_admin_monthly_closures;
create trigger zion_admin_close_immutable before update or delete on public.zion_admin_monthly_closures
for each row execute function public.zion_admin_refuse_close_mutation();
revoke all on function public.zion_admin_refuse_close_mutation() from public, anon, authenticated;

-- Four initial expenses begin on 2026-11-23, recognized at FULL value for November 2026.
-- Their monthly effective policy begins 2026-11-01; starts_on records the real start date
-- so daily / weekly views never allocate a cost before November 23.
-- Newly added/changed costs take effect on the first day of the next month.
do $$
declare
  v_month date := date '2026-11-01';
  v_starts_on date := date '2026-11-23';
  v_id uuid;
  v_entry record;
begin
  for v_entry in
    select * from (values
      ('ChatGPT Plus',10400::bigint,'monthly'::text),
      ('Vercel',10000::bigint,'monthly'::text),
      ('Supabase',10000::bigint,'monthly'::text),
      ('Domínio',4000::bigint,'annual'::text)
    ) as t(name, amount_cents, frequency)
  loop
    if not exists (select 1 from public.zion_admin_fixed_cost_versions where name = v_entry.name) then
      insert into public.zion_admin_fixed_cost_items(starts_on) values(v_starts_on) returning id into v_id;
      insert into public.zion_admin_fixed_cost_versions(item_id,effective_month,name,amount_cents,frequency,enabled)
      values(v_id,v_month,v_entry.name,v_entry.amount_cents,v_entry.frequency,true);
    end if;
  end loop;
end;
$$;

-- Changes apply strictly from the first day of NEXT calendar month in Sao Paulo.
create or replace function public.zion_admin_manage_fixed_cost(
  p_action text,
  p_item_id uuid default null,
  p_name text default null,
  p_amount_cents bigint default null,
  p_frequency text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_next_month date := (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '1 month')::date;
  v_id uuid;
  v_existing record;
  v_name text;
  v_amount bigint;
  v_frequency text;
  v_enabled boolean;
begin
  if p_action not in ('add','edit','remove') then
    raise exception 'INVALID_COST_ACTION';
  end if;
  if p_action = 'add' then
    if p_item_id is not null then raise exception 'NEW_ITEM_ID_MUST_BE_EMPTY'; end if;
    v_name := trim(coalesce(p_name,''));
    v_amount := p_amount_cents;
    v_frequency := p_frequency;
    v_enabled := true;
    if char_length(v_name) not between 1 and 100 or v_amount is null or v_amount < 0 or v_amount > 100000000000 or v_frequency not in ('monthly','annual') then
      raise exception 'INVALID_FIXED_COST';
    end if;
    insert into public.zion_admin_fixed_cost_items(starts_on) values(v_next_month) returning id into v_id;
  else
    if p_item_id is null then raise exception 'MISSING_ITEM_ID'; end if;
    select id into v_id from public.zion_admin_fixed_cost_items where id=p_item_id for update;
    if v_id is null then raise exception 'FIXED_COST_NOT_FOUND'; end if;
    select name,amount_cents,frequency,enabled into v_existing
      from public.zion_admin_fixed_cost_versions where item_id=v_id
      order by effective_month desc limit 1;
    if not found then raise exception 'FIXED_COST_VERSION_NOT_FOUND'; end if;
    v_enabled := p_action <> 'remove';
    v_name := case when p_action='remove' then v_existing.name else trim(coalesce(p_name,'')) end;
    v_amount := case when p_action='remove' then v_existing.amount_cents else p_amount_cents end;
    v_frequency := case when p_action='remove' then v_existing.frequency else p_frequency end;
    if char_length(v_name) not between 1 and 100 or v_amount is null or v_amount < 0 or v_amount > 100000000000 or v_frequency not in ('monthly','annual') then
      raise exception 'INVALID_FIXED_COST';
    end if;
  end if;
  insert into public.zion_admin_fixed_cost_versions(item_id,effective_month,name,amount_cents,frequency,enabled)
  values(v_id,v_next_month,v_name,v_amount,v_frequency,v_enabled)
  on conflict (item_id,effective_month) do update
    set name=excluded.name, amount_cents=excluded.amount_cents, frequency=excluded.frequency,
        enabled=excluded.enabled,changed_at=now();
  return v_id;
end;
$$;
revoke all on function public.zion_admin_manage_fixed_cost(text,uuid,text,bigint,text) from public, anon, authenticated;
grant execute on function public.zion_admin_manage_fixed_cost(text,uuid,text,bigint,text) to service_role;

-- Single transaction + month lock: all fixed policy items and all AI runs are frozen atomically.
create or replace function public.zion_admin_close_cost_month(
  p_month date,
  p_fx_usd_brl numeric
) returns date language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_current date := date_trunc('month',now() at time zone 'America/Sao_Paulo')::date;
  v_fixed_cents bigint := 0;
  v_variable_cents bigint := 0;
  v_ai_usd numeric := 0;
  v_runs bigint := 0;
  v_missing_cost bigint := 0;
  v_alloc bigint;
  v_detail jsonb := '[]'::jsonb;
  v_row record;
begin
  if p_month is null or extract(day from p_month) <> 1 or p_month >= v_current or p_month < date '2020-01-01' then
    raise exception 'CLOSURE_MONTH_INVALID_OR_NOT_FINISHED';
  end if;
  if p_fx_usd_brl is null or p_fx_usd_brl <= 0 or p_fx_usd_brl > 1000 then
    raise exception 'INVALID_VERIFIED_FX_RATE';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('zion_admin_monthly_close'),pg_catalog.hashtext(p_month::text));
  if exists (select 1 from public.zion_admin_monthly_closures where month=p_month) then
    return p_month;
  end if;
  for v_row in
    select distinct on (v.item_id) v.item_id, v.name, v.amount_cents, v.frequency, v.enabled
    from public.zion_admin_fixed_cost_versions v
    where v.effective_month <= p_month
    order by v.item_id, v.effective_month desc
  loop
    if v_row.enabled then
      v_alloc := case when v_row.frequency='monthly' then v_row.amount_cents
        else floor(extract(month from p_month)::numeric*v_row.amount_cents/12)::bigint
           - floor((extract(month from p_month)::numeric-1)*v_row.amount_cents/12)::bigint end;
      v_fixed_cents := v_fixed_cents + v_alloc;
      v_detail := v_detail || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'name',v_row.name,'amount_cents',v_alloc,'frequency',v_row.frequency,'original_cents',v_row.amount_cents
      ));
    end if;
  end loop;
  v_start := (p_month::timestamp at time zone 'America/Sao_Paulo');
  v_end := ((p_month + interval '1 month')::timestamp at time zone 'America/Sao_Paulo');
  select coalesce(sum(cost_usd),0),count(*),count(*) filter(where cost_usd is null)
    into v_ai_usd,v_runs,v_missing_cost
    from public.ai_runs where created_at >= v_start and created_at < v_end;
  if v_missing_cost > 0 then
    raise exception 'AI_RUNS_WITHOUT_COST_IN_MONTH: %',v_missing_cost;
  end if;
  v_variable_cents := round(v_ai_usd*p_fx_usd_brl*100)::bigint;
  insert into public.zion_admin_monthly_closures(
    month,fixed_brl_cents,ai_usd,fx_usd_brl,variable_brl_cents,total_brl_cents,fixed_items,ai_runs
  ) values(p_month,v_fixed_cents,v_ai_usd,p_fx_usd_brl,v_variable_cents,v_fixed_cents+v_variable_cents,v_detail,v_runs);
  return p_month;
end;
$$;
revoke all on function public.zion_admin_close_cost_month(date,numeric) from public, anon, authenticated;
grant execute on function public.zion_admin_close_cost_month(date,numeric) to service_role;

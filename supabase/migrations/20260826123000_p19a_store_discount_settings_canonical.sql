-- P19-A / Etapa 3.3 / Descontos — revisão manual 2026-08-26
create or replace function public.store_discount_autonomy_mode_is_valid(
  p_discount_autonomy_mode text
)
returns boolean
language sql
immutable
as $function$
  select coalesce(p_discount_autonomy_mode, '') in (
    'approval_required',
    'default_step_autonomous',
    'within_policy_autonomous'
  );
$function$;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'store_discount_settings'
  ) then
    alter table public.store_discount_settings
      add column if not exists organization_id uuid,
      add column if not exists default_discount_percent numeric(5,2),
      add column if not exists allow_ask_above_max_discount boolean,
      add column if not exists discount_autonomy_mode text,
      add column if not exists created_at timestamptz not null default timezone('utc', now()),
      add column if not exists updated_at timestamptz not null default timezone('utc', now());
  else
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.store_discount_settings is missing';
  end if;
end;
$$;

update public.store_discount_settings
set
  allow_ask_above_max_discount = coalesce(allow_ask_above_max_discount, false),
  discount_autonomy_mode = coalesce(
    nullif(pg_catalog.btrim(discount_autonomy_mode), ''),
    'approval_required'
  )
where allow_ask_above_max_discount is null
   or nullif(pg_catalog.btrim(discount_autonomy_mode), '') is null;

update public.store_discount_settings discount_row
set organization_id = store_row.organization_id
from public.stores store_row
where discount_row.store_id = store_row.id
  and discount_row.organization_id is null;

do $$
begin
  if exists (
    select 1
    from public.store_discount_settings discount_row
    left join public.stores store_row
      on store_row.id = discount_row.store_id
    where discount_row.organization_id is null
       or store_row.id is null
       or store_row.organization_id is distinct from discount_row.organization_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'precondition failed: store_discount_settings contains invalid store/organization scope';
  end if;
end;
$$;

alter table public.store_discount_settings
  alter column organization_id set not null,
  alter column allow_ask_above_max_discount set default false,
  alter column allow_ask_above_max_discount set not null,
  alter column discount_autonomy_mode set default 'approval_required',
  alter column discount_autonomy_mode set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.store_discount_settings'::regclass
      and conname = 'store_discount_settings_store_scope_fkey'
  ) then
    alter table public.store_discount_settings
      add constraint store_discount_settings_store_scope_fkey
      foreign key (store_id, organization_id)
      references public.stores(id, organization_id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.store_discount_settings'::regclass
      and conname = 'store_discount_settings_max_discount_percent_valid'
  ) then
    alter table public.store_discount_settings
      add constraint store_discount_settings_max_discount_percent_valid
      check (
        max_discount_percent is null
        or (
          max_discount_percent >= 0
          and max_discount_percent <= 100
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.store_discount_settings'::regclass
      and conname = 'store_discount_settings_default_discount_requires_max'
  ) then
    alter table public.store_discount_settings
      add constraint store_discount_settings_default_discount_requires_max
      check (
        default_discount_percent is null
        or (
          max_discount_percent is not null
          and default_discount_percent >= 0
          and default_discount_percent <= 100
          and default_discount_percent <= max_discount_percent
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.store_discount_settings'::regclass
      and conname = 'store_discount_settings_discount_autonomy_mode_valid'
  ) then
    alter table public.store_discount_settings
      add constraint store_discount_settings_discount_autonomy_mode_valid
      check (public.store_discount_autonomy_mode_is_valid(discount_autonomy_mode));
  end if;
end;
$$;

create or replace function public.touch_store_discount_settings_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$function$;

drop trigger if exists store_discount_settings_touch_updated_at on public.store_discount_settings;
create trigger store_discount_settings_touch_updated_at
before update on public.store_discount_settings
for each row
execute function public.touch_store_discount_settings_updated_at();

create table if not exists public.store_high_value_discount_settings (
  organization_id uuid not null,
  store_id uuid not null,
  enabled boolean not null default false,
  threshold_amount_cents integer,
  discount_percent numeric(5,2),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint store_high_value_discount_settings_pkey primary key (organization_id, store_id),
  constraint store_high_value_discount_settings_store_scope_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id)
    on delete cascade,
  constraint store_high_value_discount_settings_disabled_children_cleared
    check (
      enabled is true
      or (
        threshold_amount_cents is null
        and discount_percent is null
      )
    ),
  constraint store_high_value_discount_settings_enabled_requirements
    check (
      enabled is false
      or (
        threshold_amount_cents is not null
        and threshold_amount_cents > 0
        and discount_percent is not null
        and discount_percent > 0
        and discount_percent <= 100
      )
    )
);

create or replace function public.touch_store_high_value_discount_settings_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$function$;

drop trigger if exists store_high_value_discount_settings_touch_updated_at
  on public.store_high_value_discount_settings;
create trigger store_high_value_discount_settings_touch_updated_at
before update on public.store_high_value_discount_settings
for each row
execute function public.touch_store_high_value_discount_settings_updated_at();

alter table public.store_discount_settings enable row level security;
alter table public.store_high_value_discount_settings enable row level security;

revoke all on table public.store_discount_settings from public;
revoke all on table public.store_discount_settings from anon;
revoke all on table public.store_discount_settings from authenticated;
revoke all on table public.store_discount_settings from service_role;

revoke all on table public.store_high_value_discount_settings from public;
revoke all on table public.store_high_value_discount_settings from anon;
revoke all on table public.store_high_value_discount_settings from authenticated;
revoke all on table public.store_high_value_discount_settings from service_role;

grant select on table public.store_discount_settings to authenticated;
grant select on table public.store_high_value_discount_settings to authenticated;

-- Preserve server-side read-only observability (e.g. Zion Admin) without
-- restoring any direct write privilege or writer EXECUTE to service_role.
grant select on table public.store_discount_settings to service_role;
grant select on table public.store_high_value_discount_settings to service_role;

drop policy if exists store_discount_settings_select_by_active_membership
  on public.store_discount_settings;
drop policy if exists store_discount_settings_insert_by_active_membership
  on public.store_discount_settings;
drop policy if exists store_discount_settings_update_by_active_membership
  on public.store_discount_settings;
drop policy if exists store_discount_settings_delete_by_active_membership
  on public.store_discount_settings;
drop policy if exists store_high_value_discount_settings_select_by_active_membership
  on public.store_high_value_discount_settings;

create policy store_discount_settings_select_by_active_membership
  on public.store_discount_settings
  for select
  to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = store_discount_settings.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
    and exists (
      select 1
      from public.stores store_row
      where store_row.id = store_discount_settings.store_id
        and store_row.organization_id = store_discount_settings.organization_id
    )
  );

create policy store_high_value_discount_settings_select_by_active_membership
  on public.store_high_value_discount_settings
  for select
  to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = store_high_value_discount_settings.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
    and exists (
      select 1
      from public.stores store_row
      where store_row.id = store_high_value_discount_settings.store_id
        and store_row.organization_id = store_high_value_discount_settings.organization_id
    )
  );

create or replace function public.store_discount_settings_build_legacy_summary(
  p_default_discount_percent numeric,
  p_max_discount_percent numeric,
  p_allow_ask_above_max_discount boolean,
  p_discount_autonomy_mode text
)
returns text
language plpgsql
immutable
as $function$
declare
  v_autonomy_label text;
begin
  v_autonomy_label :=
    case coalesce(p_discount_autonomy_mode, 'approval_required')
      when 'approval_required' then 'Autonomia: aprovacao humana'
      when 'default_step_autonomous' then 'Autonomia: primeiro degrau'
      when 'within_policy_autonomous' then 'Autonomia: dentro da politica'
      else 'Autonomia: aprovacao humana'
    end;

  if coalesce(p_default_discount_percent, 0) <= 0
     and coalesce(p_max_discount_percent, 0) <= 0
     and coalesce(p_allow_ask_above_max_discount, false) is false
  then
    return 'Sem politica global de desconto configurada';
  end if;

  return array_to_string(
    array[
      format('Primeiro degrau normal %s%%', coalesce(p_default_discount_percent, 0)),
      format('Teto normal %s%%', coalesce(p_max_discount_percent, 0)),
      v_autonomy_label,
      case
        when coalesce(p_allow_ask_above_max_discount, false)
          then 'Pode consultar humano acima do teto'
        else 'Nao pode consultar acima do teto'
      end
    ],
    ' | '
  );
end;
$function$;

create or replace function public.upsert_store_discount_settings_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_default_discount_percent numeric,
  p_max_discount_percent numeric,
  p_allow_ask_above_max_discount boolean default false,
  p_discount_autonomy_mode text default 'approval_required'
)
returns public.store_discount_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_is_member boolean;
  v_result public.store_discount_settings%rowtype;
  v_discount_autonomy_mode text := coalesce(
    nullif(pg_catalog.btrim(coalesce(p_discount_autonomy_mode, '')), ''),
    'approval_required'
  );
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  if p_default_discount_percent is null or p_max_discount_percent is null then
    raise exception using
      errcode = '22023',
      message = 'default_discount_percent and max_discount_percent are required';
  end if;

  if p_default_discount_percent < 0
     or p_max_discount_percent < 0
     or p_default_discount_percent > p_max_discount_percent
     or p_max_discount_percent > 100
  then
    raise exception using
      errcode = '23514',
      message = 'discount policy values are invalid';
  end if;

  if not public.store_discount_autonomy_mode_is_valid(v_discount_autonomy_mode) then
    raise exception using
      errcode = '23514',
      message = 'discount autonomy mode is invalid';
  end if;

  if v_request_role = 'authenticated' then
    if auth.uid() is null then
      raise exception using
        errcode = '42501',
        message = 'store discount settings scope is not authorized';
    end if;

    select exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = p_organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
    into v_is_member;

    if coalesce(v_is_member, false) is not true then
      raise exception using
        errcode = '42501',
        message = 'store discount settings scope is not authorized';
    end if;
  elsif v_request_role = 'postgres' then
    null;
  else
    raise exception using
      errcode = '42501',
      message = 'store discount settings scope is not authorized';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store discount settings scope is not authorized';
  end if;

  insert into public.store_discount_settings (
    store_id,
    organization_id,
    default_discount_percent,
    max_discount_percent,
    allow_ask_above_max_discount,
    discount_autonomy_mode
  )
  values (
    p_store_id,
    p_organization_id,
    p_default_discount_percent,
    p_max_discount_percent,
    coalesce(p_allow_ask_above_max_discount, false),
    v_discount_autonomy_mode
  )
  on conflict (store_id)
  do update
    set organization_id = excluded.organization_id,
        default_discount_percent = excluded.default_discount_percent,
        max_discount_percent = excluded.max_discount_percent,
        allow_ask_above_max_discount = excluded.allow_ask_above_max_discount,
        discount_autonomy_mode = excluded.discount_autonomy_mode
  returning *
  into v_result;

  return v_result;
end;
$function$;

create or replace function public.upsert_store_discount_settings_with_legacy_mirror_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_default_discount_percent numeric,
  p_max_discount_percent numeric,
  p_allow_ask_above_max_discount boolean default false,
  p_discount_autonomy_mode text default 'approval_required'
)
returns public.store_discount_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_result public.store_discount_settings%rowtype;
  v_summary text;
  v_can_offer_discount boolean;
begin
  v_result := public.upsert_store_discount_settings_scoped(
    p_organization_id,
    p_store_id,
    p_default_discount_percent,
    p_max_discount_percent,
    p_allow_ask_above_max_discount,
    p_discount_autonomy_mode
  );

  v_summary := public.store_discount_settings_build_legacy_summary(
    v_result.default_discount_percent,
    v_result.max_discount_percent,
    v_result.allow_ask_above_max_discount,
    v_result.discount_autonomy_mode
  );

  -- Legacy compatibility only.  This key historically behaves like a
  -- binary "AI may offer a discount" switch, so keep the mirror fail-safe:
  -- approval_required must never become TRUE merely because a numeric policy
  -- exists.  The canonical autonomy mode remains the only authority.
  v_can_offer_discount :=
    v_result.discount_autonomy_mode in (
      'default_step_autonomous',
      'within_policy_autonomous'
    )
    and (
      coalesce(v_result.default_discount_percent, 0) > 0
      or coalesce(v_result.max_discount_percent, 0) > 0
    );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'can_offer_discount',
    p_answer => to_jsonb(v_can_offer_discount)
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'max_discount_percent',
    p_answer => to_jsonb(v_result.max_discount_percent)
  );

  perform public.onboarding_upsert_answer_scoped(
    p_organization_id => p_organization_id,
    p_store_id => p_store_id,
    p_question_key => 'discount_policy_summary',
    p_answer => to_jsonb(v_summary)
  );

  return v_result;
end;
$function$;

create or replace function public.upsert_store_high_value_discount_settings_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_enabled boolean default false,
  p_threshold_amount_cents integer default null,
  p_discount_percent numeric default null
)
returns public.store_high_value_discount_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_is_member boolean;
  v_result public.store_high_value_discount_settings%rowtype;
  v_enabled boolean := coalesce(p_enabled, false);
  v_threshold_amount_cents integer := p_threshold_amount_cents;
  v_discount_percent numeric := p_discount_percent;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  if v_enabled is false then
    v_threshold_amount_cents := null;
    v_discount_percent := null;
  elsif v_threshold_amount_cents is null
     or v_threshold_amount_cents <= 0
     or v_discount_percent is null
     or v_discount_percent <= 0
     or v_discount_percent > 100
  then
    raise exception using
      errcode = '23514',
      message = 'high-value discount policy values are invalid';
  end if;

  if v_request_role = 'authenticated' then
    if auth.uid() is null then
      raise exception using
        errcode = '42501',
        message = 'store high-value discount settings scope is not authorized';
    end if;

    select exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = p_organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
    into v_is_member;

    if coalesce(v_is_member, false) is not true then
      raise exception using
        errcode = '42501',
        message = 'store high-value discount settings scope is not authorized';
    end if;
  elsif v_request_role = 'postgres' then
    null;
  else
    raise exception using
      errcode = '42501',
      message = 'store high-value discount settings scope is not authorized';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store high-value discount settings scope is not authorized';
  end if;

  insert into public.store_high_value_discount_settings (
    organization_id,
    store_id,
    enabled,
    threshold_amount_cents,
    discount_percent
  )
  values (
    p_organization_id,
    p_store_id,
    v_enabled,
    v_threshold_amount_cents,
    v_discount_percent
  )
  on conflict (organization_id, store_id)
  do update
    set enabled = excluded.enabled,
        threshold_amount_cents = excluded.threshold_amount_cents,
        discount_percent = excluded.discount_percent
  returning *
  into v_result;

  return v_result;
end;
$function$;

revoke all on function public.store_discount_autonomy_mode_is_valid(text) from public;
revoke all on function public.store_discount_autonomy_mode_is_valid(text) from anon;
revoke all on function public.store_discount_autonomy_mode_is_valid(text) from authenticated;
revoke all on function public.store_discount_autonomy_mode_is_valid(text) from service_role;

revoke all on function public.store_discount_settings_build_legacy_summary(
  numeric,
  numeric,
  boolean,
  text
) from public;
revoke all on function public.store_discount_settings_build_legacy_summary(
  numeric,
  numeric,
  boolean,
  text
) from anon;
revoke all on function public.store_discount_settings_build_legacy_summary(
  numeric,
  numeric,
  boolean,
  text
) from authenticated;
revoke all on function public.store_discount_settings_build_legacy_summary(
  numeric,
  numeric,
  boolean,
  text
) from service_role;

revoke all on function public.upsert_store_discount_settings_scoped(
  uuid,
  uuid,
  numeric,
  numeric,
  boolean,
  text
) from public;
revoke all on function public.upsert_store_discount_settings_scoped(
  uuid,
  uuid,
  numeric,
  numeric,
  boolean,
  text
) from anon;
revoke all on function public.upsert_store_discount_settings_scoped(
  uuid,
  uuid,
  numeric,
  numeric,
  boolean,
  text
) from authenticated;
revoke all on function public.upsert_store_discount_settings_scoped(
  uuid,
  uuid,
  numeric,
  numeric,
  boolean,
  text
) from service_role;

revoke all on function public.upsert_store_discount_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  numeric,
  numeric,
  boolean,
  text
) from public;
revoke all on function public.upsert_store_discount_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  numeric,
  numeric,
  boolean,
  text
) from anon;
revoke all on function public.upsert_store_discount_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  numeric,
  numeric,
  boolean,
  text
) from authenticated;
revoke all on function public.upsert_store_discount_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  numeric,
  numeric,
  boolean,
  text
) from service_role;

revoke all on function public.upsert_store_high_value_discount_settings_scoped(
  uuid,
  uuid,
  boolean,
  integer,
  numeric
) from public;
revoke all on function public.upsert_store_high_value_discount_settings_scoped(
  uuid,
  uuid,
  boolean,
  integer,
  numeric
) from anon;
revoke all on function public.upsert_store_high_value_discount_settings_scoped(
  uuid,
  uuid,
  boolean,
  integer,
  numeric
) from authenticated;
revoke all on function public.upsert_store_high_value_discount_settings_scoped(
  uuid,
  uuid,
  boolean,
  integer,
  numeric
) from service_role;

grant execute on function public.upsert_store_discount_settings_with_legacy_mirror_scoped(
  uuid,
  uuid,
  numeric,
  numeric,
  boolean,
  text
) to authenticated;

grant execute on function public.upsert_store_high_value_discount_settings_scoped(
  uuid,
  uuid,
  boolean,
  integer,
  numeric
) to authenticated;

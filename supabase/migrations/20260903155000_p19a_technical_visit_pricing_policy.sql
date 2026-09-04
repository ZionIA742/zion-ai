-- P19-A / Bloco 3 / Etapa 3.3 / Pacote D
-- Autoridade canonica da politica de cobranca da visita tecnica.

create or replace function public.store_operation_technical_visit_pricing_mode_is_valid(
  p_pricing_mode text
)
returns boolean
language sql
immutable
as $function$
  select p_pricing_mode is null
    or p_pricing_mode in ('free', 'fixed', 'case_by_case');
$function$;

alter table public.store_operation_settings
  add column if not exists technical_visit_pricing_mode text null,
  add column if not exists technical_visit_fixed_fee_cents integer null,
  add column if not exists technical_visit_case_by_case_rule text null,
  add column if not exists technical_visit_fee_deductible_from_purchase boolean null;

alter table public.store_operation_settings
  drop constraint if exists store_operation_settings_technical_visit_pricing_mode_valid,
  drop constraint if exists store_operation_settings_technical_visit_pricing_payload_valid;

alter table public.store_operation_settings
  add constraint store_operation_settings_technical_visit_pricing_mode_valid
    check (
      public.store_operation_technical_visit_pricing_mode_is_valid(
        technical_visit_pricing_mode
      )
    ),
  add constraint store_operation_settings_technical_visit_pricing_payload_valid
    check (
      (
        technical_visit_pricing_mode is null
        and technical_visit_fixed_fee_cents is null
        and technical_visit_case_by_case_rule is null
        and technical_visit_fee_deductible_from_purchase is null
      )
      or (
        technical_visit_pricing_mode = 'free'
        and technical_visit_fixed_fee_cents is null
        and technical_visit_case_by_case_rule is null
        and technical_visit_fee_deductible_from_purchase is null
      )
      or (
        technical_visit_pricing_mode = 'fixed'
        and technical_visit_fixed_fee_cents > 0
        and technical_visit_case_by_case_rule is null
        and technical_visit_fee_deductible_from_purchase is not null
      )
      or (
        technical_visit_pricing_mode = 'case_by_case'
        and technical_visit_fixed_fee_cents is null
        and nullif(pg_catalog.btrim(technical_visit_case_by_case_rule), '') is not null
        and technical_visit_fee_deductible_from_purchase is not null
      )
    );

create or replace function public.upsert_store_operation_technical_visit_pricing_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_technical_visit_pricing_mode text default null,
  p_technical_visit_fixed_fee_cents integer default null,
  p_technical_visit_case_by_case_rule text default null,
  p_technical_visit_fee_deductible_from_purchase boolean default null
)
returns public.store_operation_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_is_member boolean;
  v_pricing_mode text := nullif(
    pg_catalog.lower(pg_catalog.btrim(coalesce(p_technical_visit_pricing_mode, ''))),
    ''
  );
  v_fixed_fee_cents integer := p_technical_visit_fixed_fee_cents;
  v_case_by_case_rule text := nullif(
    pg_catalog.btrim(coalesce(p_technical_visit_case_by_case_rule, '')),
    ''
  );
  v_deductible boolean := p_technical_visit_fee_deductible_from_purchase;
  v_result public.store_operation_settings%rowtype;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  if not public.store_operation_technical_visit_pricing_mode_is_valid(v_pricing_mode) then
    raise exception using
      errcode = '23514',
      message = 'technical_visit_pricing_mode is invalid';
  end if;

  if v_pricing_mode is null then
    v_fixed_fee_cents := null;
    v_case_by_case_rule := null;
    v_deductible := null;
  elsif v_pricing_mode = 'free' then
    v_fixed_fee_cents := null;
    v_case_by_case_rule := null;
    v_deductible := null;
  elsif v_pricing_mode = 'fixed' then
    if v_fixed_fee_cents is null or v_fixed_fee_cents <= 0 then
      raise exception using
        errcode = '23514',
        message = 'technical_visit_fixed_fee_cents must be positive for fixed pricing';
    end if;
    if v_deductible is null then
      raise exception using
        errcode = '23514',
        message = 'technical_visit_fee_deductible_from_purchase is required for paid visit pricing';
    end if;
    v_case_by_case_rule := null;
  elsif v_pricing_mode = 'case_by_case' then
    if v_case_by_case_rule is null then
      raise exception using
        errcode = '23514',
        message = 'technical_visit_case_by_case_rule is required for case_by_case pricing';
    end if;
    if v_deductible is null then
      raise exception using
        errcode = '23514',
        message = 'technical_visit_fee_deductible_from_purchase is required for paid visit pricing';
    end if;
    v_fixed_fee_cents := null;
  end if;

  if v_request_role = 'authenticated' then
    if auth.uid() is null then
      raise exception using
        errcode = '42501',
        message = 'store operation technical visit pricing scope is not authorized';
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
        message = 'store operation technical visit pricing scope is not authorized';
    end if;
  elsif v_request_role = 'postgres' then
    null;
  else
    raise exception using
      errcode = '42501',
      message = 'store operation technical visit pricing scope is not authorized';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store operation technical visit pricing scope is not authorized';
  end if;

  insert into public.store_operation_settings (
    organization_id,
    store_id,
    technical_visit_pricing_mode,
    technical_visit_fixed_fee_cents,
    technical_visit_case_by_case_rule,
    technical_visit_fee_deductible_from_purchase
  )
  values (
    p_organization_id,
    p_store_id,
    v_pricing_mode,
    v_fixed_fee_cents,
    v_case_by_case_rule,
    v_deductible
  )
  on conflict (organization_id, store_id)
  do update set
    technical_visit_pricing_mode = excluded.technical_visit_pricing_mode,
    technical_visit_fixed_fee_cents = excluded.technical_visit_fixed_fee_cents,
    technical_visit_case_by_case_rule = excluded.technical_visit_case_by_case_rule,
    technical_visit_fee_deductible_from_purchase =
      excluded.technical_visit_fee_deductible_from_purchase
  returning *
  into v_result;

  return v_result;
end;
$function$;

alter function public.store_operation_technical_visit_pricing_mode_is_valid(text)
  owner to postgres;

alter function public.upsert_store_operation_technical_visit_pricing_scoped(
  uuid,
  uuid,
  text,
  integer,
  text,
  boolean
) owner to postgres;

revoke all on function public.store_operation_technical_visit_pricing_mode_is_valid(text)
  from public, anon, authenticated, service_role;

revoke all on function public.upsert_store_operation_technical_visit_pricing_scoped(
  uuid,
  uuid,
  text,
  integer,
  text,
  boolean
) from public, anon, authenticated, service_role;

grant execute on function public.upsert_store_operation_technical_visit_pricing_scoped(
  uuid,
  uuid,
  text,
  integer,
  text,
  boolean
) to authenticated;

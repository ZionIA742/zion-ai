begin;

-- P19-A 3.4
-- Explicit completion marker for the canonical price-policy authority.
-- Existing rows remain NULL: row existence alone does not prove that
-- the merchant explicitly configured the Prices card.

alter table public.store_commercial_ai_settings
  add column if not exists price_policy_configured_at timestamptz;

create or replace function public.upsert_store_commercial_ai_settings_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_price_answer_policy text,
  p_price_context_requirements text[] default '{}'::text[]
)
returns public.store_commercial_ai_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_is_member boolean;
  v_price_answer_policy text := pg_catalog.lower(
    nullif(pg_catalog.btrim(coalesce(p_price_answer_policy, '')), '')
  );
  v_price_context_requirements text[];
  v_result public.store_commercial_ai_settings%rowtype;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  if not public.store_commercial_ai_price_answer_policy_is_valid(v_price_answer_policy) then
    raise exception using
      errcode = '23514',
      message = 'price_answer_policy is invalid';
  end if;

  select coalesce(array_agg(requirement order by first_position, requirement), '{}'::text[])
  into v_price_context_requirements
  from (
    select
      pg_catalog.lower(pg_catalog.btrim(requirement)) as requirement,
      min(ordinality) as first_position
    from unnest(coalesce(p_price_context_requirements, '{}'::text[]))
      with ordinality as requirement_row(requirement, ordinality)
    where nullif(pg_catalog.btrim(requirement), '') is not null
    group by pg_catalog.lower(pg_catalog.btrim(requirement))
  ) normalized_requirement;

  if not public.store_commercial_ai_price_context_requirements_are_valid(
    v_price_context_requirements
  ) then
    raise exception using
      errcode = '23514',
      message = 'price_context_requirements contains invalid values';
  end if;

  if v_request_role = 'authenticated' then
    if auth.uid() is null then
      raise exception using
        errcode = '42501',
        message = 'store commercial AI settings scope is not authorized';
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
        message = 'store commercial AI settings scope is not authorized';
    end if;
  elsif v_request_role = 'postgres' then
    null;
  else
    raise exception using
      errcode = '42501',
      message = 'store commercial AI settings scope is not authorized';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store commercial AI settings scope is not authorized';
  end if;

  insert into public.store_commercial_ai_settings (
    organization_id,
    store_id,
    price_answer_policy,
    price_context_requirements,
    price_policy_configured_at
  )
  values (
    p_organization_id,
    p_store_id,
    v_price_answer_policy,
    v_price_context_requirements,
    pg_catalog.clock_timestamp()
  )
  on conflict (organization_id, store_id)
  do update
    set price_answer_policy = excluded.price_answer_policy,
        price_context_requirements = excluded.price_context_requirements,
        price_policy_configured_at = excluded.price_policy_configured_at
  returning *
  into v_result;

  return v_result;
end;
$function$;

comment on column public.store_commercial_ai_settings.price_policy_configured_at is
  'Timestamp of an explicit canonical price-policy write. NULL means price settings have not been explicitly confirmed through the canonical writer.';

commit;
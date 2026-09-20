begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p19a:onboarding-completion-readiness:v1',
    0
  )
);

-- ============================================================
-- 1. RESOLVER INTERNO ÚNICO DE READINESS DE CONCLUSÃO
-- ============================================================

create or replace function public.resolve_store_onboarding_completion_readiness_internal(
  p_organization_id uuid,
  p_store_id uuid
)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
set row_security to 'off'
as $function$
declare
  v_store_name text;

  v_store_description text;
  v_city text;
  v_state text;
  v_store_services text[];

  v_primary_responsible_count integer;
  v_responsible_name text;
  v_responsible_whatsapp text;

  v_whatsapp_integration_count integer;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  select nullif(pg_catalog.btrim(store_row.name), '')
  into v_store_name
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store scope is not authorized';
  end if;

  if v_store_name is null then
    return 'P19A_ONBOARDING_NOT_READY:STORE_NAME';
  end if;

  select
    nullif(pg_catalog.btrim(strategy_row.store_description), ''),
    nullif(pg_catalog.btrim(strategy_row.city), ''),
    nullif(pg_catalog.btrim(strategy_row.state), ''),
    strategy_row.store_services
  into
    v_store_description,
    v_city,
    v_state,
    v_store_services
  from public.store_strategy_settings strategy_row
  where strategy_row.organization_id = p_organization_id
    and strategy_row.store_id = p_store_id;

  if not found then
    return 'P19A_ONBOARDING_NOT_READY:STRATEGY_SETTINGS';
  end if;

  if v_store_description is null then
    return 'P19A_ONBOARDING_NOT_READY:STORE_DESCRIPTION';
  end if;

  if v_city is null then
    return 'P19A_ONBOARDING_NOT_READY:CITY';
  end if;

  if v_state is null then
    return 'P19A_ONBOARDING_NOT_READY:STATE';
  end if;

  if coalesce(cardinality(v_store_services), 0) < 1 then
    return 'P19A_ONBOARDING_NOT_READY:STORE_SERVICES';
  end if;

  select count(*)
  into v_primary_responsible_count
  from public.store_responsibles responsible_row
  where responsible_row.organization_id = p_organization_id
    and responsible_row.store_id = p_store_id
    and responsible_row.is_primary is true
    and responsible_row.is_active is true;

  if v_primary_responsible_count <> 1 then
    return 'P19A_ONBOARDING_NOT_READY:PRIMARY_RESPONSIBLE';
  end if;

  select
    nullif(pg_catalog.btrim(responsible_row.name), ''),
    nullif(pg_catalog.btrim(responsible_row.whatsapp_number), '')
  into
    v_responsible_name,
    v_responsible_whatsapp
  from public.store_responsibles responsible_row
  where responsible_row.organization_id = p_organization_id
    and responsible_row.store_id = p_store_id
    and responsible_row.is_primary is true
    and responsible_row.is_active is true
  limit 1;

  if v_responsible_name is null then
    return 'P19A_ONBOARDING_NOT_READY:RESPONSIBLE_NAME';
  end if;

  if v_responsible_whatsapp is null then
    return 'P19A_ONBOARDING_NOT_READY:RESPONSIBLE_WHATSAPP';
  end if;

  select count(*)
  into v_whatsapp_integration_count
  from public.external_integrations integration_row
  where integration_row.organization_id = p_organization_id
    and integration_row.store_id = p_store_id
    and integration_row.provider = 'whatsapp'
    and integration_row.is_active is true
    and pg_catalog.lower(pg_catalog.btrim(integration_row.status)) = 'active'
    and nullif(pg_catalog.btrim(integration_row.phone_number_id), '') is not null
    and nullif(pg_catalog.btrim(integration_row.display_phone_number), '') is not null;

  if v_whatsapp_integration_count <> 1 then
    return 'P19A_ONBOARDING_NOT_READY:WHATSAPP_COMMERCIAL';
  end if;

  return null;
end;
$function$;

alter function public.resolve_store_onboarding_completion_readiness_internal(uuid, uuid)
  owner to postgres;

revoke all on function public.resolve_store_onboarding_completion_readiness_internal(uuid, uuid)
  from public, anon, authenticated, service_role;

-- ============================================================
-- 2. READER SCOPED / READ-ONLY
-- ============================================================

create or replace function public.read_store_onboarding_completion_readiness_scoped(
  p_organization_id uuid,
  p_store_id uuid
)
returns table (
  is_ready boolean,
  reason_code text
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
set row_security to 'off'
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_is_member boolean;
  v_reason text;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  if v_request_role = 'authenticated' then
    if auth.uid() is null then
      raise exception using
        errcode = '42501',
        message = 'store scope is not authorized';
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
        message = 'store scope is not authorized';
    end if;
  elsif v_request_role in ('service_role', 'postgres') then
    null;
  else
    raise exception using
      errcode = '42501',
      message = 'store scope is not authorized';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store scope is not authorized';
  end if;

  v_reason :=
    public.resolve_store_onboarding_completion_readiness_internal(
      p_organization_id,
      p_store_id
    );

  return query
  select
    v_reason is null,
    v_reason;
end;
$function$;

alter function public.read_store_onboarding_completion_readiness_scoped(uuid, uuid)
  owner to postgres;

revoke all on function public.read_store_onboarding_completion_readiness_scoped(uuid, uuid)
  from public, anon;

grant execute on function public.read_store_onboarding_completion_readiness_scoped(uuid, uuid)
  to authenticated, service_role;

-- ============================================================
-- 3. CONCLUSÃO PASSA A CONSUMIR O MESMO RESOLVER
-- ============================================================

create or replace function public.onboarding_complete_store_onboarding_scoped(
  p_organization_id uuid,
  p_store_id uuid
)
returns public.store_onboarding
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
set row_security to 'off'
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_is_member boolean;
  v_readiness_reason text;
  v_existing public.store_onboarding%rowtype;
  v_result public.store_onboarding%rowtype;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  if v_request_role = 'authenticated' then
    if auth.uid() is null then
      raise exception using
        errcode = '42501',
        message = 'store scope is not authorized';
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
        message = 'store scope is not authorized';
    end if;
  elsif v_request_role in ('service_role', 'postgres') then
    null;
  else
    raise exception using
      errcode = '42501',
      message = 'store scope is not authorized';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store scope is not authorized';
  end if;

  select onboarding_row.*
  into v_existing
  from public.store_onboarding onboarding_row
  where onboarding_row.store_id = p_store_id
  for update;

  if found then
    if v_existing.organization_id <> p_organization_id then
      raise exception using
        errcode = '42501',
        message = 'store scope is not authorized';
    end if;

    if v_existing.status = 'completed' then
      return v_existing;
    end if;
  end if;

  v_readiness_reason :=
    public.resolve_store_onboarding_completion_readiness_internal(
      p_organization_id,
      p_store_id
    );

  if v_readiness_reason is not null then
    raise exception using
      errcode = 'P0001',
      message = v_readiness_reason;
  end if;

  if v_existing.store_id is null then
    insert into public.store_onboarding (
      store_id,
      organization_id,
      status,
      completed_at
    )
    values (
      p_store_id,
      p_organization_id,
      'completed',
      now()
    )
    returning *
    into v_result;
  else
    update public.store_onboarding onboarding_row
    set
      status = 'completed',
      completed_at = now(),
      updated_at = now()
    where onboarding_row.store_id = p_store_id
      and onboarding_row.organization_id = p_organization_id
    returning onboarding_row.*
    into v_result;
  end if;

  if v_result.store_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_ONBOARDING_COMPLETION_WRITE_FAILED';
  end if;

  return v_result;
end;
$function$;

alter function public.onboarding_complete_store_onboarding_scoped(uuid, uuid)
  owner to postgres;

revoke all on function public.onboarding_complete_store_onboarding_scoped(uuid, uuid)
  from public, anon;

grant execute on function public.onboarding_complete_store_onboarding_scoped(uuid, uuid)
  to authenticated, service_role;

comment on function public.resolve_store_onboarding_completion_readiness_internal(uuid, uuid)
is 'Internal single source of truth for P19-A onboarding completion readiness. Returns the canonical P19A_ONBOARDING_NOT_READY reason or NULL when ready.';

comment on function public.read_store_onboarding_completion_readiness_scoped(uuid, uuid)
is 'Authorized read-only projection of the canonical P19-A onboarding completion readiness.';

comment on function public.onboarding_complete_store_onboarding_scoped(uuid, uuid)
is 'Canonical P19-A onboarding completion writer. Uses the shared readiness resolver before atomically setting completed.';

commit;
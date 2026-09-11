-- P19-A / Bloco 3 / Passada B
-- Onboarding completion authority hardening
--
-- Objetivos:
-- 1. impedir que o RPC genérico faça a primeira transição para completed;
-- 2. tornar completed terminal/idempotente;
-- 3. validar tenant/store/membership nos RPCs de onboarding;
-- 4. criar autoridade específica para conclusão;
-- 5. concluir somente após readiness canônica persistida;
-- 6. preservar compatibilidade com callers que apenas repetem completed.

begin;

-- ============================================================
-- 1. PREFLIGHT DE INTEGRIDADE DE ESCOPO
-- ============================================================

do $$
begin
  if exists (
    select 1
    from public.store_onboarding onboarding_row
    left join public.stores store_row
      on store_row.id = onboarding_row.store_id
     and store_row.organization_id = onboarding_row.organization_id
    where store_row.id is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_ONBOARDING_SCOPE_PREFLIGHT_FAILED';
  end if;
end;
$$;

-- ============================================================
-- 2. INTEGRIDADE ESTRUTURAL STORE + ORGANIZATION
-- ============================================================

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'store_onboarding_store_scope_fkey'
      and conrelid = 'public.store_onboarding'::regclass
  ) then
    alter table public.store_onboarding
      add constraint store_onboarding_store_scope_fkey
      foreign key (store_id, organization_id)
      references public.stores(id, organization_id)
      on delete cascade;
  end if;
end;
$$;

-- ============================================================
-- 3. HARDEN DO GUARD EXISTENTE
--
-- Mantemos a semântica histórica:
-- "este onboarding já está completed?"
--
-- Ele NÃO é readiness.
-- Apenas adicionamos autorização/escopo fail-closed.
-- ============================================================

create or replace function public.guard_store_onboarding_completed_scoped(
  p_organization_id uuid,
  p_store_id uuid
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
set row_security to 'off'
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_is_member boolean;
  v_status text;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  if not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_organization_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'store scope is not authorized';
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

  select onboarding_row.status
  into v_status
  from public.store_onboarding onboarding_row
  where onboarding_row.organization_id = p_organization_id
    and onboarding_row.store_id = p_store_id;

  if v_status is null then
    return false;
  end if;

  return v_status = 'completed';
end;
$function$;

-- ============================================================
-- 4. HARDEN DO WRITER GENÉRICO
--
-- Este RPC continua responsável por:
-- not_started / in_progress.
--
-- Ele NÃO é autoridade para iniciar completed.
--
-- Compatibilidade:
-- se a loja JÁ estiver completed, chamadas posteriores retornam
-- a linha existente sem reabrir/downgrade.
-- ============================================================

create or replace function public.onboarding_upsert_store_onboarding_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_status text
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
  v_existing public.store_onboarding%rowtype;
  v_result public.store_onboarding%rowtype;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  if p_status not in ('not_started', 'in_progress', 'completed') then
    raise exception using
      errcode = '22023',
      message = 'invalid onboarding status';
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

  -- Store row é também nosso lock serializador por loja.
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

    -- completed é terminal.
    -- Isso também preserva callers antigos que apenas repetem completed.
    if v_existing.status = 'completed' then
      return v_existing;
    end if;
  end if;

  -- Primeira transição para completed só pode ocorrer
  -- pelo RPC canônico específico criado abaixo.
  if p_status = 'completed' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_ONBOARDING_COMPLETION_REQUIRES_CANONICAL_RPC';
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
      p_status,
      null
    )
    returning *
    into v_result;
  else
    update public.store_onboarding onboarding_row
    set
      status = p_status,
      completed_at = null,
      updated_at = now()
    where onboarding_row.store_id = p_store_id
      and onboarding_row.organization_id = p_organization_id
    returning onboarding_row.*
    into v_result;
  end if;

  return v_result;
end;
$function$;

-- ============================================================
-- 5. AUTORIDADE CANÔNICA DE CONCLUSÃO
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

  v_store_name text;

  v_store_description text;
  v_city text;
  v_state text;
  v_store_services text[];

  v_primary_responsible_count integer;
  v_responsible_name text;
  v_responsible_whatsapp text;

  v_whatsapp_integration_count integer;

  v_existing public.store_onboarding%rowtype;
  v_result public.store_onboarding%rowtype;
begin
  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'organization_id and store_id are required';
  end if;

  -- ----------------------------------------------------------
  -- REQUEST / MEMBERSHIP AUTHORITY
  -- ----------------------------------------------------------

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

  -- ----------------------------------------------------------
  -- STORE SCOPE + SERIALIZATION LOCK
  -- ----------------------------------------------------------

  select nullif(pg_catalog.btrim(store_row.name), '')
  into v_store_name
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

    -- Replay legítimo: completion já ocorreu.
    if v_existing.status = 'completed' then
      return v_existing;
    end if;
  end if;

  -- ----------------------------------------------------------
  -- READINESS 1: IDENTIDADE DA LOJA
  -- ----------------------------------------------------------

  if v_store_name is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_ONBOARDING_NOT_READY:STORE_NAME';
  end if;

  -- ----------------------------------------------------------
  -- READINESS 2: ESSÊNCIA / BASE / OFERTAS
  -- ----------------------------------------------------------

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
    raise exception using
      errcode = 'P0001',
      message = 'P19A_ONBOARDING_NOT_READY:STRATEGY_SETTINGS';
  end if;

  if v_store_description is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_ONBOARDING_NOT_READY:STORE_DESCRIPTION';
  end if;

  if v_city is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_ONBOARDING_NOT_READY:CITY';
  end if;

  if v_state is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_ONBOARDING_NOT_READY:STATE';
  end if;

  if coalesce(cardinality(v_store_services), 0) < 1 then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_ONBOARDING_NOT_READY:STORE_SERVICES';
  end if;

  -- ----------------------------------------------------------
  -- READINESS 3: RESPONSÁVEL PRINCIPAL CANÔNICO
  -- ----------------------------------------------------------

  select count(*)
  into v_primary_responsible_count
  from public.store_responsibles responsible_row
  where responsible_row.organization_id = p_organization_id
    and responsible_row.store_id = p_store_id
    and responsible_row.is_primary is true
    and responsible_row.is_active is true;

  if v_primary_responsible_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_ONBOARDING_NOT_READY:PRIMARY_RESPONSIBLE';
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
    raise exception using
      errcode = 'P0001',
      message = 'P19A_ONBOARDING_NOT_READY:RESPONSIBLE_NAME';
  end if;

  if v_responsible_whatsapp is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_ONBOARDING_NOT_READY:RESPONSIBLE_WHATSAPP';
  end if;

  -- ----------------------------------------------------------
  -- READINESS 4: WHATSAPP COMERCIAL REAL
  --
  -- Não cria conexão.
  -- Apenas aceita uma integração já persistida como ativa.
  -- ----------------------------------------------------------

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
    raise exception using
      errcode = 'P0001',
      message = 'P19A_ONBOARDING_NOT_READY:WHATSAPP_COMMERCIAL';
  end if;

  -- ----------------------------------------------------------
  -- ALL CANONICAL REQUIREMENTS PASSED
  -- ----------------------------------------------------------

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

-- ============================================================
-- 6. EXECUTE PRIVILEGES
-- ============================================================

revoke all on function public.guard_store_onboarding_completed_scoped(uuid, uuid)
  from public, anon;

grant execute on function public.guard_store_onboarding_completed_scoped(uuid, uuid)
  to authenticated, service_role;

revoke all on function public.onboarding_upsert_store_onboarding_scoped(uuid, uuid, text)
  from public, anon;

grant execute on function public.onboarding_upsert_store_onboarding_scoped(uuid, uuid, text)
  to authenticated, service_role;

revoke all on function public.onboarding_complete_store_onboarding_scoped(uuid, uuid)
  from public, anon;

grant execute on function public.onboarding_complete_store_onboarding_scoped(uuid, uuid)
  to authenticated, service_role;

comment on function public.guard_store_onboarding_completed_scoped(uuid, uuid)
is 'Returns whether onboarding is already completed for an authorized store scope. This is not a readiness validator.';

comment on function public.onboarding_upsert_store_onboarding_scoped(uuid, uuid, text)
is 'Generic scoped onboarding status writer for pre-completion states. Cannot perform the initial transition to completed; completed is terminal and replay-safe.';

comment on function public.onboarding_complete_store_onboarding_scoped(uuid, uuid)
is 'Canonical P19-A onboarding completion authority. Validates persisted store identity, strategy essentials, primary responsible and active WhatsApp integration before atomically setting completed.';

commit;
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p19a:onboarding-completion-readiness:completed-replay:v1',
    0
  )
);

-- ============================================================
-- P19-A / Bloco 3 / Etapa 3.6
--
-- Alinha o reader canônico à semântica terminal/idempotente
-- já usada pelo writer de conclusão:
--
-- - onboarding já completed => readiness permanece ready;
-- - onboarding ainda não completed => usa o resolver único
--   dos requisitos canônicos de pré-conclusão.
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

  v_onboarding_organization_id uuid;
  v_onboarding_status text;

  v_reason text;
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
  -- STORE SCOPE
  -- ----------------------------------------------------------

  perform 1
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store scope is not authorized';
  end if;

  -- ----------------------------------------------------------
  -- COMPLETED É TERMINAL / REPLAY-SAFE
  --
  -- Espelha a semântica do writer canônico:
  -- uma conclusão já persistida não volta a ficar "not ready"
  -- por alterações posteriores nos requisitos de ativação.
  -- ----------------------------------------------------------

  select
    onboarding_row.organization_id,
    onboarding_row.status
  into
    v_onboarding_organization_id,
    v_onboarding_status
  from public.store_onboarding onboarding_row
  where onboarding_row.store_id = p_store_id;

  if found then
    if v_onboarding_organization_id <> p_organization_id then
      raise exception using
        errcode = '42501',
        message = 'store scope is not authorized';
    end if;

    if v_onboarding_status = 'completed' then
      return query
      select
        true,
        null::text;

      return;
    end if;
  end if;

  -- ----------------------------------------------------------
  -- PRÉ-CONCLUSÃO: MESMA AUTHORITY DO WRITER
  -- ----------------------------------------------------------

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

comment on function public.read_store_onboarding_completion_readiness_scoped(uuid, uuid)
is 'Authorized read-only projection of canonical P19-A onboarding readiness. Completed is terminal/replay-safe; pre-completion delegates to the shared readiness resolver.';

commit;
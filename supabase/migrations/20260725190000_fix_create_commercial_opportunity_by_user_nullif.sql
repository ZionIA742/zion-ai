do $preflight$
declare
  v_function_oid oid := pg_catalog.to_regprocedure(
    'public.create_commercial_opportunity_by_user(uuid,uuid,uuid,uuid)'
  );
  v_function_lang name;
  v_function_result text;
  v_function_config text[];
  v_function_definition text;
begin
  if v_function_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: create_commercial_opportunity_by_user is missing';
  end if;

  select
    language_row.lanname,
    pg_catalog.pg_get_function_result(proc_row.oid),
    proc_row.proconfig,
    pg_catalog.pg_get_functiondef(proc_row.oid)
  into
    v_function_lang,
    v_function_result,
    v_function_config,
    v_function_definition
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_language language_row
    on language_row.oid = proc_row.prolang
  where proc_row.oid = v_function_oid
    and proc_row.prosecdef;

  if v_function_lang <> 'plpgsql'
     or v_function_result <> 'TABLE(commercial_opportunity_id uuid, organization_id uuid, store_id uuid, customer_id uuid, stage text, stage_changed_at timestamp with time zone, lifecycle_cycle integer, created_at timestamp with time zone, updated_at timestamp with time zone)'
     or v_function_config is null
     or not exists (
       select 1
       from pg_catalog.unnest(v_function_config) config_row
       where config_row = 'search_path=pg_catalog, pg_temp, public'
     )
     or not exists (
       select 1
       from pg_catalog.unnest(v_function_config) config_row
       where config_row = 'row_security=off'
     )
     or position('current_setting(''request.jwt.claim.role'', true)' in v_function_definition) = 0
     or (
       position('pg_catalog.nullif(' in v_function_definition) = 0
       and position('nullif(' in v_function_definition) = 0
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: create_commercial_opportunity_by_user contract mismatch';
  end if;
end;
$preflight$;

create or replace function public.create_commercial_opportunity_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_customer_id uuid,
  p_commercial_opportunity_id uuid
)
returns table (
  commercial_opportunity_id uuid,
  organization_id uuid,
  store_id uuid,
  customer_id uuid,
  stage text,
  stage_changed_at timestamptz,
  lifecycle_cycle integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  v_initial_stage text;
  v_existing public.commercial_opportunities;
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity creation by user is not authorized';
  end if;

  if p_request_organization_id is null
     or p_store_id is null
     or p_customer_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22023',
      message = 'commercial opportunity creation by user requires organization, store, customer and opportunity';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_request_organization_id
      and membership_row.user_id = v_user_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity creation by user is not authorized';
  end if;

  select opportunity_row.*
  into v_existing
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
  for update;

  if found then
    if v_existing.organization_id is distinct from p_request_organization_id
       or v_existing.store_id is distinct from p_store_id
       or v_existing.customer_id is distinct from p_customer_id then
      raise exception using
        errcode = '23514',
        message = 'commercial opportunity scope mismatch';
    end if;

    return query
    select
      v_existing.id,
      v_existing.organization_id,
      v_existing.store_id,
      v_existing.customer_id,
      v_existing.stage,
      v_existing.stage_changed_at,
      v_existing.lifecycle_cycle,
      v_existing.created_at,
      v_existing.updated_at;
    return;
  end if;

  if not exists (
    select 1
    from public.organizations organization_row
    where organization_row.id = p_request_organization_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'commercial opportunity organization not found';
  end if;

  if not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_request_organization_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'commercial opportunity store scope not found';
  end if;

  if not exists (
    select 1
    from public.customers customer_row
    where customer_row.id = p_customer_id
      and customer_row.organization_id = p_request_organization_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'commercial opportunity customer scope not found';
  end if;

  if not exists (
    select 1
    from public.customer_store_links customer_store_link_row
    where customer_store_link_row.organization_id = p_request_organization_id
      and customer_store_link_row.store_id = p_store_id
      and customer_store_link_row.customer_id = p_customer_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'commercial opportunity customer store link not found';
  end if;

  v_initial_stage := public.normalize_commercial_opportunity_stage('novo_lead');

  begin
    insert into public.commercial_opportunities (
      id,
      organization_id,
      store_id,
      customer_id,
      stage
    )
    values (
      p_commercial_opportunity_id,
      p_request_organization_id,
      p_store_id,
      p_customer_id,
      v_initial_stage
    )
    returning *
    into v_existing;
  exception
    when unique_violation then
      select opportunity_row.*
      into v_existing
      from public.commercial_opportunities opportunity_row
      where opportunity_row.id = p_commercial_opportunity_id
      for update;

      if not found then
        raise;
      end if;

      if v_existing.organization_id is distinct from p_request_organization_id
         or v_existing.store_id is distinct from p_store_id
         or v_existing.customer_id is distinct from p_customer_id then
        raise exception using
          errcode = '23514',
          message = 'commercial opportunity scope mismatch';
      end if;
  end;

  return query
  select
    v_existing.id,
    v_existing.organization_id,
    v_existing.store_id,
    v_existing.customer_id,
    v_existing.stage,
    v_existing.stage_changed_at,
    v_existing.lifecycle_cycle,
    v_existing.created_at,
    v_existing.updated_at;
end;
$function$;

alter function public.create_commercial_opportunity_by_user(
  uuid,
  uuid,
  uuid,
  uuid
)
  owner to postgres;

revoke all on function public.create_commercial_opportunity_by_user(
  uuid,
  uuid,
  uuid,
  uuid
)
  from public, anon, authenticated, service_role;

grant execute on function public.create_commercial_opportunity_by_user(
  uuid,
  uuid,
  uuid,
  uuid
)
  to authenticated;

comment on function public.create_commercial_opportunity_by_user(
  uuid,
  uuid,
  uuid,
  uuid
) is
  'Cria uma nova commercial_opportunity canonicamente, sem reutilizar outra oportunidade, e torna repeticoes do mesmo opportunity_id idempotentes apenas quando o escopo coincide.';

do $postconditions$
declare
  v_function_oid oid := pg_catalog.to_regprocedure(
    'public.create_commercial_opportunity_by_user(uuid,uuid,uuid,uuid)'
  );
  v_function_owner regrole;
  v_function_lang name;
  v_function_result text;
  v_function_config text[];
  v_function_definition text;
  v_authenticated_can_execute boolean;
  v_public_can_execute boolean;
  v_anon_can_execute boolean;
  v_service_role_can_execute boolean;
begin
  if v_function_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: create_commercial_opportunity_by_user is missing';
  end if;

  select
    proc_row.proowner::regrole,
    language_row.lanname,
    pg_catalog.pg_get_function_result(proc_row.oid),
    proc_row.proconfig,
    pg_catalog.pg_get_functiondef(proc_row.oid)
  into
    v_function_owner,
    v_function_lang,
    v_function_result,
    v_function_config,
    v_function_definition
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_language language_row
    on language_row.oid = proc_row.prolang
  where proc_row.oid = v_function_oid
    and proc_row.prosecdef;

  if v_function_owner <> 'postgres'::regrole
     or v_function_lang <> 'plpgsql'
     or v_function_result <> 'TABLE(commercial_opportunity_id uuid, organization_id uuid, store_id uuid, customer_id uuid, stage text, stage_changed_at timestamp with time zone, lifecycle_cycle integer, created_at timestamp with time zone, updated_at timestamp with time zone)'
     or v_function_config is null
     or not exists (
       select 1
       from pg_catalog.unnest(v_function_config) config_row
       where config_row = 'search_path=pg_catalog, pg_temp, public'
     )
     or not exists (
       select 1
       from pg_catalog.unnest(v_function_config) config_row
       where config_row = 'row_security=off'
     )
     or position('pg_catalog.nullif(' in v_function_definition) <> 0
     or position('nullif(' in v_function_definition) = 0
     or position('current_setting(''request.jwt.claim.role'', true)' in v_function_definition) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: create_commercial_opportunity_by_user contract mismatch';
  end if;

  v_authenticated_can_execute := pg_catalog.has_function_privilege(
    'authenticated',
    v_function_oid,
    'EXECUTE'
  );
  v_public_can_execute := pg_catalog.has_function_privilege(
    'public',
    v_function_oid,
    'EXECUTE'
  );
  v_anon_can_execute := pg_catalog.has_function_privilege(
    'anon',
    v_function_oid,
    'EXECUTE'
  );
  v_service_role_can_execute := pg_catalog.has_function_privilege(
    'service_role',
    v_function_oid,
    'EXECUTE'
  );

  if not v_authenticated_can_execute
     or v_public_can_execute
     or v_anon_can_execute
     or v_service_role_can_execute then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: create_commercial_opportunity_by_user grants mismatch';
  end if;
end;
$postconditions$;

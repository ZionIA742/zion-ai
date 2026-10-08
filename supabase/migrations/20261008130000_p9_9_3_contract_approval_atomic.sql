do $preflight$
begin
  if pg_catalog.to_regclass('public.sales_contracts') is null
     or pg_catalog.to_regclass('public.sales_contract_versions') is null
     or pg_catalog.to_regclass('public.store_files') is null then
    raise exception using errcode = 'P0001', message = 'P9_9_3_REQUIRED_TABLES_MISSING';
  end if;

  if pg_catalog.to_regprocedure(
       'public.p9_assert_sales_contract_current_proposal_lineage_internal(uuid,uuid,uuid)'
     ) is null then
    raise exception using errcode = 'P0001', message = 'P9_9_3_CURRENT_PROPOSAL_LINEAGE_HELPER_MISSING';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sales_contracts'
      and column_name in (
        'id', 'organization_id', 'store_id', 'current_version_id',
        'status', 'approved_at', 'approved_by'
      )
    having count(*) = 7
  ) then
    raise exception using errcode = 'P0001', message = 'P9_9_3_CONTRACT_APPROVAL_COLUMNS_MISSING';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sales_contract_versions'
      and column_name in (
        'id', 'contract_id', 'organization_id', 'store_id', 'status',
        'approved_at', 'storage_bucket', 'storage_path'
      )
    having count(*) = 8
  ) then
    raise exception using errcode = 'P0001', message = 'P9_9_3_VERSION_APPROVAL_COLUMNS_MISSING';
  end if;
end
$preflight$;

create or replace function public.approve_sales_contract_by_user_atomic(
  p_organization_id uuid,
  p_store_id uuid,
  p_contract_id uuid,
  p_expected_contract_version_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
  v_contract public.sales_contracts%rowtype;
  v_version public.sales_contract_versions%rowtype;
  v_lineage record;
  v_contract_status text;
  v_version_status text;
  v_now timestamptz;
  v_outcome text;
  v_replayed boolean := false;
  v_reconciled boolean := false;
begin
  if (v_request_role is distinct from 'service_role') and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'P9_CONTRACT_APPROVAL_SERVICE_ROLE_REQUIRED';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_contract_id is null
     or p_expected_contract_version_id is null
     or p_actor_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'P9_CONTRACT_APPROVAL_ARGUMENTS_INVALID';
  end if;

  select contract_row.*
    into v_contract
    from public.sales_contracts contract_row
   where contract_row.id = p_contract_id
     and contract_row.organization_id = p_organization_id
     and contract_row.store_id = p_store_id
   for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'P9_CONTRACT_APPROVAL_CONTRACT_NOT_FOUND';
  end if;

  if v_contract.current_version_id is null then
    raise exception using
      errcode = '23514',
      message = 'P9_CONTRACT_APPROVAL_CURRENT_VERSION_REQUIRED';
  end if;

  if v_contract.current_version_id is distinct from p_expected_contract_version_id then
    raise exception using
      errcode = '23514',
      message = 'P9_CONTRACT_APPROVAL_CURRENT_VERSION_MISMATCH';
  end if;

  select version_row.*
    into v_version
    from public.sales_contract_versions version_row
   where version_row.id = p_expected_contract_version_id
     and version_row.contract_id = v_contract.id
     and version_row.organization_id = p_organization_id
     and version_row.store_id = p_store_id
   for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'P9_CONTRACT_APPROVAL_VERSION_NOT_FOUND';
  end if;

  if nullif(pg_catalog.btrim(coalesce(v_version.storage_bucket, '')), '') is null
     or nullif(pg_catalog.btrim(coalesce(v_version.storage_path, '')), '') is null then
    raise exception using
      errcode = '23514',
      message = 'P9_CONTRACT_APPROVAL_PDF_STORAGE_MISSING';
  end if;

  select lineage_row.*
    into v_lineage
    from public.p9_assert_sales_contract_current_proposal_lineage_internal(
      p_organization_id,
      p_store_id,
      v_contract.id
    ) lineage_row;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'P9_CONTRACT_APPROVAL_LINEAGE_UNPROVABLE';
  end if;

  v_contract_status := pg_catalog.lower(pg_catalog.btrim(coalesce(v_contract.status, '')));
  v_version_status := pg_catalog.lower(pg_catalog.btrim(coalesce(v_version.status, '')));

  if v_contract_status = 'approved' and v_version_status = 'approved' then
    if v_contract.approved_at is null or v_contract.approved_by is null or v_version.approved_at is null then
      raise exception using
        errcode = '23514',
        message = 'P9_CONTRACT_APPROVAL_AUDIT_INVALID';
    end if;

    v_outcome := 'already_applied';
    v_replayed := true;
  elsif v_contract_status = 'approved'
        and v_version_status in ('generated', 'pending_review') then
    if v_contract.approved_at is null or v_contract.approved_by is null then
      raise exception using
        errcode = '23514',
        message = 'P9_CONTRACT_APPROVAL_AUDIT_INVALID';
    end if;

    update public.sales_contract_versions version_row
       set status = 'approved',
           approved_at = v_contract.approved_at
     where version_row.id = v_version.id
       and version_row.contract_id = v_contract.id
       and version_row.organization_id = p_organization_id
       and version_row.store_id = p_store_id
       and version_row.status in ('generated', 'pending_review')
    returning version_row.* into v_version;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'P9_CONTRACT_APPROVAL_RECONCILIATION_FAILED';
    end if;

    v_outcome := 'reconciled_partial_state';
    v_replayed := true;
    v_reconciled := true;
  elsif v_contract_status in ('draft', 'pending_review')
        and v_version_status = 'approved' then
    raise exception using
      errcode = '23514',
      message = 'P9_CONTRACT_APPROVAL_INVERSE_PARTIAL_STATE';
  elsif v_contract_status not in ('draft', 'pending_review') then
    raise exception using
      errcode = '23514',
      message = 'P9_CONTRACT_APPROVAL_STATUS_NOT_APPROVABLE';
  elsif v_version_status not in ('generated', 'pending_review') then
    raise exception using
      errcode = '23514',
      message = 'P9_CONTRACT_APPROVAL_VERSION_STATUS_NOT_APPROVABLE';
  else
    v_now := pg_catalog.clock_timestamp();

    update public.sales_contracts contract_row
       set status = 'approved',
           approved_at = v_now,
           approved_by = p_actor_user_id
     where contract_row.id = v_contract.id
       and contract_row.organization_id = p_organization_id
       and contract_row.store_id = p_store_id
       and contract_row.current_version_id = p_expected_contract_version_id
       and contract_row.status in ('draft', 'pending_review')
    returning contract_row.* into v_contract;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'P9_CONTRACT_APPROVAL_CONTRACT_UPDATE_FAILED';
    end if;

    update public.sales_contract_versions version_row
       set status = 'approved',
           approved_at = v_now
     where version_row.id = v_version.id
       and version_row.contract_id = v_contract.id
       and version_row.organization_id = p_organization_id
       and version_row.store_id = p_store_id
       and version_row.status in ('generated', 'pending_review')
    returning version_row.* into v_version;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'P9_CONTRACT_APPROVAL_VERSION_UPDATE_FAILED';
    end if;

    v_outcome := 'approved';
  end if;

  return pg_catalog.jsonb_build_object(
    'outcome', v_outcome,
    'replayed', v_replayed,
    'reconciled', v_reconciled,
    'contract_id', v_contract.id,
    'contract_version_id', v_version.id,
    'contract_status', v_contract.status,
    'version_status', v_version.status,
    'approved_at', v_contract.approved_at,
    'approved_by', v_contract.approved_by
  );
end;
$function$;

alter function public.approve_sales_contract_by_user_atomic(
  uuid, uuid, uuid, uuid, uuid
) owner to postgres;

revoke all on function public.approve_sales_contract_by_user_atomic(
  uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated;

grant execute on function public.approve_sales_contract_by_user_atomic(
  uuid, uuid, uuid, uuid, uuid
) to service_role;

do $postconditions$
declare
  v_oid oid;
  v_owner name;
  v_security_definer boolean;
  v_config text[];
  v_definition text;
begin
  v_oid := pg_catalog.to_regprocedure(
    'public.approve_sales_contract_by_user_atomic(uuid,uuid,uuid,uuid,uuid)'
  );
  if v_oid is null then
    raise exception using errcode = 'P0001', message = 'P9_9_3_APPROVAL_FUNCTION_MISSING';
  end if;

  select pg_proc.proowner::regrole,
         pg_proc.prosecdef,
         pg_proc.proconfig,
         pg_catalog.pg_get_functiondef(v_oid)
    into v_owner, v_security_definer, v_config, v_definition
    from pg_catalog.pg_proc
   where pg_proc.oid = v_oid;

  if v_owner <> 'postgres' or not v_security_definer then
    raise exception using errcode = 'P0001', message = 'P9_9_3_APPROVAL_FUNCTION_SECURITY_INVALID';
  end if;
  if not exists (select 1 from unnest(coalesce(v_config, '{}'::text[])) config where config like 'search_path=%') then
    raise exception using errcode = 'P0001', message = 'P9_9_3_APPROVAL_FUNCTION_SEARCH_PATH_MISSING';
  end if;
  if has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception using errcode = 'P0001', message = 'P9_9_3_AUTHENTICATED_EXECUTE_UNEXPECTED';
  end if;
  if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception using errcode = 'P0001', message = 'P9_9_3_SERVICE_ROLE_EXECUTE_MISSING';
  end if;
  if v_definition not like '%for update%'
     or v_definition not like '%p9_assert_sales_contract_current_proposal_lineage_internal%'
     or v_definition not like '%outcome%'
     or v_definition not like '%reconciled_partial_state%' then
    raise exception using errcode = 'P0001', message = 'P9_9_3_APPROVAL_FUNCTION_POSTCONDITION_FAILED';
  end if;
end
$postconditions$;

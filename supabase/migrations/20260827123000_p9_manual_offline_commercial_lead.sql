begin;

-- P9 / Bloco 3 / Etapa 3.1
-- Cria lead comercial manual/offline de forma atomica.
-- Nao cria conversation, message, session ou context link.

do $preflight$
begin
  if pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.customers') is null
     or pg_catalog.to_regclass('public.customer_store_links') is null
     or pg_catalog.to_regclass('public.lead_customer_links') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.memberships') is null
     or pg_catalog.to_regclass('public.stores') is null then
    raise exception using errcode = 'P0001',
      message = 'precondition failed: manual commercial lead prerequisites are missing';
  end if;

  if pg_catalog.to_regprocedure('public.lead_customer_link_request_role()') is null
     or pg_catalog.to_regprocedure('public.p9_deterministic_uuid_from_text(text)') is null
     or pg_catalog.to_regprocedure('public.normalize_commercial_opportunity_stage(text)') is null then
    raise exception using errcode = 'P0001',
      message = 'precondition failed: required P9 helpers are missing';
  end if;
end;
$preflight$;

create or replace function public.create_manual_commercial_lead_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_operation_id uuid,
  p_name text default null,
  p_phone text default null
)
returns table (
  operation_id uuid,
  lead_id uuid,
  customer_id uuid,
  customer_store_link_id uuid,
  lead_customer_link_id uuid,
  commercial_opportunity_id uuid,
  stage text,
  primary_conversation_id uuid,
  replayed boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := public.lead_customer_link_request_role();
  v_name text;
  v_phone text;
  v_payload_fingerprint text;
  v_link_idempotency_key text;
  v_lead_id uuid;
  v_customer_id uuid;
  v_customer_store_link_id uuid;
  v_lead_customer_link_id uuid;
  v_commercial_opportunity_id uuid;
  v_initial_stage text;
  v_lead public.leads;
  v_customer public.customers;
  v_customer_store_link public.customer_store_links;
  v_lead_customer_link public.lead_customer_links;
  v_opportunity public.commercial_opportunities;
begin
  if v_user_id is null or v_request_role is distinct from 'authenticated' then
    raise exception using errcode = '42501',
      message = 'manual commercial lead creation by user is not authorized';
  end if;

  if p_request_organization_id is null
     or p_store_id is null
     or p_operation_id is null then
    raise exception using errcode = '22004',
      message = 'manual commercial lead creation requires organization, store and operation';
  end if;

  v_name := nullif(
    pg_catalog.regexp_replace(
      pg_catalog.btrim(coalesce(p_name, '')),
      '[[:space:]]+',
      ' ',
      'g'
    ),
    ''
  );
  v_phone := nullif(pg_catalog.btrim(coalesce(p_phone, '')), '');

  if v_name is null and v_phone is null then
    raise exception using errcode = '22023',
      message = 'manual commercial lead creation requires name or phone';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_request_organization_id
      and membership_row.user_id = v_user_id
  ) then
    raise exception using errcode = '42501',
      message = 'manual commercial lead creation by user is not authorized';
  end if;

  if not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_request_organization_id
  ) then
    raise exception using errcode = '23503',
      message = 'manual commercial lead store scope not found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'zion:p9:manual-commercial-lead:v1:' ||
      p_request_organization_id::text || ':' ||
      p_store_id::text || ':' ||
      p_operation_id::text,
      0
    )
  );

  v_lead_id := public.p9_deterministic_uuid_from_text(
    'zion:p9:manual-commercial-lead:lead:v1:' ||
    p_request_organization_id::text || ':' || p_store_id::text || ':' || p_operation_id::text
  );
  v_customer_id := public.p9_deterministic_uuid_from_text(
    'zion:p9:manual-commercial-lead:customer:v1:' ||
    p_request_organization_id::text || ':' || p_store_id::text || ':' || p_operation_id::text
  );
  v_customer_store_link_id := public.p9_deterministic_uuid_from_text(
    'zion:p9:manual-commercial-lead:customer-store-link:v1:' ||
    p_request_organization_id::text || ':' || p_store_id::text || ':' || p_operation_id::text
  );
  v_lead_customer_link_id := public.p9_deterministic_uuid_from_text(
    'zion:p9:manual-commercial-lead:lead-customer-link:v1:' ||
    p_request_organization_id::text || ':' || p_store_id::text || ':' || p_operation_id::text
  );
  v_commercial_opportunity_id := public.p9_deterministic_uuid_from_text(
    'zion:p9:manual-commercial-lead:opportunity:v1:' ||
    p_request_organization_id::text || ':' || p_store_id::text || ':' || p_operation_id::text
  );

  v_payload_fingerprint := pg_catalog.md5(
    coalesce(v_name, '<null>') || chr(31) || coalesce(v_phone, '<null>')
  );
  v_link_idempotency_key :=
    'zion:p9:manual-commercial-lead:v1:' ||
    p_request_organization_id::text || ':' ||
    p_store_id::text || ':' ||
    p_operation_id::text || ':' ||
    v_payload_fingerprint;

  select lead_row.* into v_lead
  from public.leads lead_row
  where lead_row.id = v_lead_id
  for update;

  if found then
    select customer_row.* into v_customer
    from public.customers customer_row
    where customer_row.id = v_customer_id
      and customer_row.organization_id = p_request_organization_id
    for update;

    select store_link_row.* into v_customer_store_link
    from public.customer_store_links store_link_row
    where store_link_row.id = v_customer_store_link_id
      and store_link_row.organization_id = p_request_organization_id
      and store_link_row.store_id = p_store_id
      and store_link_row.customer_id = v_customer_id
    for update;

    select link_row.* into v_lead_customer_link
    from public.lead_customer_links link_row
    where link_row.id = v_lead_customer_link_id
      and link_row.organization_id = p_request_organization_id
      and link_row.store_id = p_store_id
      and link_row.lead_id = v_lead_id
      and link_row.customer_id = v_customer_id
    for update;

    select opportunity_row.* into v_opportunity
    from public.commercial_opportunities opportunity_row
    where opportunity_row.id = v_commercial_opportunity_id
    for update;

    if v_lead.organization_id is distinct from p_request_organization_id
       or v_lead.store_id is distinct from p_store_id
       or v_customer.id is null
       or v_customer.merged_into_customer_id is not null
       or v_customer_store_link.id is null
       or v_lead_customer_link.id is null
       or v_lead_customer_link.status is distinct from 'active'
       or v_lead_customer_link.unlinked_at is not null
       or v_lead_customer_link.source is distinct from 'manual'
       or v_lead_customer_link.linked_by_actor_type is distinct from 'human'
       or v_lead_customer_link.linked_by_user_id is distinct from v_user_id
       or v_lead_customer_link.idempotency_key is distinct from v_link_idempotency_key
       or v_opportunity.id is null
       or v_opportunity.organization_id is distinct from p_request_organization_id
       or v_opportunity.store_id is distinct from p_store_id
       or v_opportunity.customer_id is distinct from v_customer_id
       or v_opportunity.origin_lead_id is distinct from v_lead_id
       or v_opportunity.primary_conversation_id is not null then
      raise exception using errcode = '23514',
        message = 'manual commercial lead replay payload mismatch';
    end if;

    return query
    select p_operation_id, v_lead.id, v_customer.id, v_customer_store_link.id,
      v_lead_customer_link.id, v_opportunity.id, v_opportunity.stage,
      v_opportunity.primary_conversation_id, true, v_opportunity.created_at;
    return;
  end if;

  if exists (select 1 from public.customers where id = v_customer_id)
     or exists (select 1 from public.customer_store_links where id = v_customer_store_link_id)
     or exists (select 1 from public.lead_customer_links where id = v_lead_customer_link_id)
     or exists (select 1 from public.commercial_opportunities where id = v_commercial_opportunity_id) then
    raise exception using errcode = '23505',
      message = 'manual commercial lead deterministic identity conflict';
  end if;

  insert into public.leads (
    id, organization_id, store_id, name, phone, state
  ) values (
    v_lead_id, p_request_organization_id, p_store_id, v_name, v_phone, 'novo_lead'
  )
  returning * into v_lead;

  insert into public.customers (
    id, organization_id, display_name, normalized_name
  ) values (
    v_customer_id,
    p_request_organization_id,
    v_name,
    case
      when v_name is null then null::text
      else pg_catalog.lower(
        pg_catalog.regexp_replace(v_name, '[[:space:]]+', ' ', 'g')
      )
    end
  )
  returning * into v_customer;

  insert into public.customer_store_links (
    id, organization_id, store_id, customer_id
  ) values (
    v_customer_store_link_id, p_request_organization_id, p_store_id, v_customer_id
  )
  returning * into v_customer_store_link;

  insert into public.lead_customer_links (
    id, organization_id, store_id, lead_id, customer_id,
    source_identity_id, replaces_link_id, status, source, source_reference,
    idempotency_key, correlation_id, linked_at,
    linked_by_actor_type, linked_by_user_id, metadata
  ) values (
    v_lead_customer_link_id,
    p_request_organization_id,
    p_store_id,
    v_lead_id,
    v_customer_id,
    null,
    null,
    'active',
    'manual',
    pg_catalog.format('crm_manual_commercial_lead:%s', p_operation_id),
    v_link_idempotency_key,
    p_operation_id,
    pg_catalog.clock_timestamp(),
    'human',
    v_user_id,
    pg_catalog.jsonb_build_object(
      'writer', 'create_manual_commercial_lead_by_user',
      'contract_version', 'v1',
      'operation_id', p_operation_id::text,
      'input_name', v_name,
      'input_phone', v_phone,
      'payload_fingerprint', v_payload_fingerprint
    )
  )
  returning * into v_lead_customer_link;

  v_initial_stage := public.normalize_commercial_opportunity_stage('novo_lead');

  insert into public.commercial_opportunities (
    id, organization_id, store_id, customer_id,
    origin_lead_id, primary_conversation_id, stage
  ) values (
    v_commercial_opportunity_id,
    p_request_organization_id,
    p_store_id,
    v_customer_id,
    v_lead_id,
    null,
    v_initial_stage
  )
  returning * into v_opportunity;

  return query
  select p_operation_id, v_lead.id, v_customer.id, v_customer_store_link.id,
    v_lead_customer_link.id, v_opportunity.id, v_opportunity.stage,
    v_opportunity.primary_conversation_id, false, v_opportunity.created_at;
end;
$function$;

alter function public.create_manual_commercial_lead_by_user(
  uuid, uuid, uuid, text, text
) owner to postgres;

revoke all on function public.create_manual_commercial_lead_by_user(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.create_manual_commercial_lead_by_user(
  uuid, uuid, uuid, text, text
) to authenticated;

comment on function public.create_manual_commercial_lead_by_user(
  uuid, uuid, uuid, text, text
) is
  'Cria atomicamente lead/customer/vinculos/opportunity para origem manual/offline, sem conversation ou mensagem falsa, com origin_lead_id explicito, primary_conversation_id NULL e replay deterministico por operation_id.';

do $postconditions$
declare
  v_oid oid;
begin
  v_oid := pg_catalog.to_regprocedure(
    'public.create_manual_commercial_lead_by_user(uuid,uuid,uuid,text,text)'
  );

  if v_oid is null then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: create_manual_commercial_lead_by_user is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_roles role_row on role_row.oid = proc_row.proowner
    where proc_row.oid = v_oid
      and proc_row.prosecdef
      and role_row.rolname = 'postgres'
      and proc_row.proconfig @> array[
        'search_path=pg_catalog, pg_temp, public',
        'row_security=off'
      ]::text[]
  ) then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: create_manual_commercial_lead_by_user security contract mismatch';
  end if;

  if not pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception using errcode = 'P0001',
      message = 'postcondition failed: create_manual_commercial_lead_by_user grants mismatch';
  end if;
end;
$postconditions$;

commit;

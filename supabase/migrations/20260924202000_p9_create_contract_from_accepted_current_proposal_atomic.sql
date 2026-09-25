begin;

-- ============================================================================
-- P9 6.8
-- Atomic contract creation from the exact accepted Current Commercial Proposal.
--
-- Authority chain:
-- Current Commercial Proposal
--   -> exact customer acceptance
--   -> create_contract readiness
--   -> immutable sales_quote_versions.quote_snapshot
--   -> sales_contracts
--
-- Never derives contract commercial content from mutable sales_quotes header
-- fields or mutable sales_quote_items.
-- ============================================================================

do $preflight$
begin
  if pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.sales_quotes') is null
     or pg_catalog.to_regclass('public.sales_quote_versions') is null
     or pg_catalog.to_regclass('public.sales_contracts') is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9 6.8 contract creation precondition failed: required tables missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.p9_resolve_current_commercial_proposal_acceptance_internal(uuid,uuid,uuid)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9 6.8 contract creation precondition failed: acceptance resolver missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.p9_resolve_commercial_action_readiness_internal(uuid,uuid,uuid,text)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9 6.8 contract creation precondition failed: readiness resolver missing';
  end if;
end;
$preflight$;


create or replace function public.create_sales_contract_from_current_accepted_proposal_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_quote_id uuid,
  p_quote_version_id uuid,
  p_contract_number text
)
returns table (
  outcome text,
  contract_id uuid,
  organization_id uuid,
  store_id uuid,
  commercial_opportunity_id uuid,
  quote_id uuid,
  quote_version_id uuid,
  acceptance_event_id uuid,
  contract_number text,
  contract_status text
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text :=
    coalesce(
      nullif(
        pg_catalog.current_setting('request.jwt.claim.role', true),
        ''
      ),
      nullif(auth.jwt() ->> 'role', '')
    );

  v_safe_contract_number text :=
    nullif(pg_catalog.btrim(p_contract_number), '');

  v_opportunity public.commercial_opportunities%rowtype;
  v_quote public.sales_quotes%rowtype;
  v_version public.sales_quote_versions%rowtype;
  v_contract public.sales_contracts%rowtype;
  v_existing public.sales_contracts%rowtype;

  v_acceptance record;
  v_readiness record;

  v_snapshot jsonb;
  v_snapshot_quote jsonb;

  v_existing_count bigint := 0;

  v_subtotal numeric;
  v_discount numeric;
  v_total numeric;

  v_quote_number text;
  v_quote_title text;
  v_contract_title text;
  v_customer_name text;
  v_customer_phone text;
  v_payment_terms text;
  v_delivery_terms text;
  v_warranty_terms text;
  v_valid_until_text text;
  v_valid_until date;
begin
  -- --------------------------------------------------------------------------
  -- Server-only boundary.
  -- --------------------------------------------------------------------------
  if v_request_role is distinct from 'service_role'
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'sales contract creation writer is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_quote_id is null
     or p_quote_version_id is null
     or v_safe_contract_number is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_CONTRACT_CREATE_INVALID_ARGUMENT';
  end if;

  -- --------------------------------------------------------------------------
  -- Serialize against Current Commercial Proposal changes and acceptance.
  -- --------------------------------------------------------------------------
  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'ZION_CONTRACT_CREATE_OPPORTUNITY_NOT_FOUND';
  end if;

  if v_opportunity.current_quote_id is distinct from p_quote_id
     or v_opportunity.current_quote_version_id is distinct from p_quote_version_id then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_CREATE_PROPOSAL_STALE',
      detail = pg_catalog.jsonb_build_object(
        'expected_quote_id', p_quote_id,
        'expected_quote_version_id', p_quote_version_id,
        'current_quote_id', v_opportunity.current_quote_id,
        'current_quote_version_id', v_opportunity.current_quote_version_id
      )::text;
  end if;

  -- --------------------------------------------------------------------------
  -- Exact acceptance authority.
  -- --------------------------------------------------------------------------
  select acceptance_row.*
  into v_acceptance
  from public.p9_resolve_current_commercial_proposal_acceptance_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id
  ) acceptance_row;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_CREATE_ACCEPTANCE_MISSING';
  end if;

  if v_acceptance.acceptance_state is distinct from 'accepted'
     or v_acceptance.reason_code is distinct from 'current_proposal_accepted'
     or v_acceptance.acceptance_event_id is null
     or v_acceptance.current_quote_id is distinct from p_quote_id
     or v_acceptance.current_quote_version_id is distinct from p_quote_version_id then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_CREATE_ACCEPTANCE_NOT_CURRENT',
      detail = pg_catalog.to_jsonb(v_acceptance)::text;
  end if;

  -- --------------------------------------------------------------------------
  -- Canonical create_contract readiness under the same transaction/lock.
  -- --------------------------------------------------------------------------
  select readiness_row.*
  into v_readiness
  from public.p9_resolve_commercial_action_readiness_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    'create_contract'
  ) readiness_row;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_CREATE_READINESS_MISSING';
  end if;

  if v_readiness.readiness_state is distinct from 'ready'
     or v_readiness.reason_code is distinct from
          'create_contract_commercial_prerequisites_ready' then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_CREATE_READINESS_NOT_READY',
      detail = pg_catalog.to_jsonb(v_readiness)::text;
  end if;

  if v_readiness.readiness_basis -> 'details'
         ->> 'current_proposal_quote_id'
       is distinct from p_quote_id::text
     or v_readiness.readiness_basis -> 'details'
         ->> 'current_proposal_quote_version_id'
       is distinct from p_quote_version_id::text
     or v_readiness.readiness_basis -> 'details'
         ->> 'proposal_acceptance_event_id'
       is distinct from v_acceptance.acceptance_event_id::text then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_CREATE_READINESS_LINEAGE_MISMATCH',
      detail = pg_catalog.to_jsonb(v_readiness)::text;
  end if;

  -- --------------------------------------------------------------------------
  -- Exact quote/version scope.
  -- The mutable quote row is used only for stable association ids.
  -- Commercial contract contents come from the immutable version snapshot.
  -- --------------------------------------------------------------------------
  select quote_row.*
  into v_quote
  from public.sales_quotes quote_row
  where quote_row.id = p_quote_id
    and quote_row.organization_id = p_organization_id
    and quote_row.store_id = p_store_id
    and quote_row.commercial_opportunity_id = p_commercial_opportunity_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'ZION_CONTRACT_CREATE_QUOTE_SCOPE_INVALID';
  end if;

  select version_row.*
  into v_version
  from public.sales_quote_versions version_row
  where version_row.id = p_quote_version_id
    and version_row.quote_id = p_quote_id
    and version_row.organization_id = p_organization_id
    and version_row.store_id = p_store_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'ZION_CONTRACT_CREATE_QUOTE_VERSION_SCOPE_INVALID';
  end if;

  if v_version.sent_at is null
     or pg_catalog.lower(coalesce(v_version.status, ''))
          not in ('sent', 'superseded') then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_CREATE_QUOTE_VERSION_NOT_SENT';
  end if;

  v_snapshot := v_version.quote_snapshot;

  if v_snapshot is null
     or pg_catalog.jsonb_typeof(v_snapshot) is distinct from 'object'
     or pg_catalog.jsonb_typeof(v_snapshot -> 'quote') is distinct from 'object'
     or pg_catalog.jsonb_typeof(v_snapshot -> 'items') is distinct from 'array' then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_CREATE_QUOTE_SNAPSHOT_INVALID';
  end if;

  v_snapshot_quote := v_snapshot -> 'quote';

  if nullif(
       pg_catalog.btrim(
         coalesce(v_snapshot_quote ->> 'id', '')
       ),
       ''
     ) is distinct from p_quote_id::text then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_CREATE_QUOTE_SNAPSHOT_LINEAGE_MISMATCH';
  end if;

  if pg_catalog.jsonb_typeof(v_snapshot_quote -> 'subtotalCents')
         is distinct from 'number'
     or pg_catalog.jsonb_typeof(v_snapshot_quote -> 'discountCents')
         is distinct from 'number'
     or pg_catalog.jsonb_typeof(v_snapshot_quote -> 'totalCents')
         is distinct from 'number' then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_CREATE_QUOTE_SNAPSHOT_MONEY_INVALID';
  end if;

  v_subtotal := (v_snapshot_quote ->> 'subtotalCents')::numeric;
  v_discount := (v_snapshot_quote ->> 'discountCents')::numeric;
  v_total := (v_snapshot_quote ->> 'totalCents')::numeric;

  if v_subtotal < 0
     or v_discount < 0
     or v_total < 0
     or v_subtotal > 2147483647
     or v_discount > 2147483647
     or v_total > 2147483647
     or pg_catalog.trunc(v_subtotal) <> v_subtotal
     or pg_catalog.trunc(v_discount) <> v_discount
     or pg_catalog.trunc(v_total) <> v_total then
    raise exception using
      errcode = '22003',
      message = 'ZION_CONTRACT_CREATE_QUOTE_SNAPSHOT_MONEY_OUT_OF_RANGE';
  end if;

  -- --------------------------------------------------------------------------
  -- Version-aware replay / duplicate protection.
  -- A contract for another quote version must NOT block this accepted version.
  -- Cancelled/expired/failed contracts may be recreated.
  -- Opportunity row lock serializes concurrent canonical create attempts.
  -- --------------------------------------------------------------------------
  select pg_catalog.count(*)
  into v_existing_count
  from public.sales_contracts contract_row
  where contract_row.organization_id = p_organization_id
    and contract_row.store_id = p_store_id
    and contract_row.quote_id = p_quote_id
    and contract_row.quote_version_id = p_quote_version_id
    and contract_row.status not in ('cancelled', 'expired', 'failed');

  if v_existing_count > 1 then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_CREATE_DUPLICATE_ACTIVE_LINEAGE_CONFLICT',
      detail = pg_catalog.jsonb_build_object(
        'quote_id', p_quote_id,
        'quote_version_id', p_quote_version_id,
        'active_contract_count', v_existing_count
      )::text;
  end if;

  if v_existing_count = 1 then
    select contract_row.*
    into v_existing
    from public.sales_contracts contract_row
    where contract_row.organization_id = p_organization_id
      and contract_row.store_id = p_store_id
      and contract_row.quote_id = p_quote_id
      and contract_row.quote_version_id = p_quote_version_id
      and contract_row.status not in ('cancelled', 'expired', 'failed');

    return query
    select
      'already_exists'::text,
      v_existing.id,
      v_existing.organization_id,
      v_existing.store_id,
      p_commercial_opportunity_id,
      v_existing.quote_id,
      v_existing.quote_version_id,
      v_acceptance.acceptance_event_id,
      v_existing.contract_number,
      v_existing.status;

    return;
  end if;

  -- --------------------------------------------------------------------------
  -- Build contract exclusively from the immutable quote-version snapshot.
  -- --------------------------------------------------------------------------
  v_quote_number :=
    nullif(
      pg_catalog.btrim(coalesce(v_snapshot_quote ->> 'quoteNumber', '')),
      ''
    );

  v_quote_title :=
    nullif(
      pg_catalog.btrim(coalesce(v_snapshot_quote ->> 'title', '')),
      ''
    );

  if v_quote_title is not null then
    v_contract_title := 'Contrato - ' || v_quote_title;
  else
    v_contract_title :=
      'Contrato referente ao orcamento '
      || coalesce(v_quote_number, p_quote_id::text);
  end if;

  v_customer_name :=
    coalesce(
      nullif(
        pg_catalog.btrim(
          coalesce(v_snapshot_quote ->> 'customerName', '')
        ),
        ''
      ),
      nullif(
        pg_catalog.btrim(
          coalesce(v_snapshot -> 'lead' ->> 'name', '')
        ),
        ''
      )
    );

  v_customer_phone :=
    coalesce(
      nullif(
        pg_catalog.btrim(
          coalesce(v_snapshot_quote ->> 'customerPhone', '')
        ),
        ''
      ),
      nullif(
        pg_catalog.btrim(
          coalesce(v_snapshot -> 'lead' ->> 'phone', '')
        ),
        ''
      )
    );

  v_payment_terms :=
    nullif(
      pg_catalog.btrim(
        coalesce(v_snapshot_quote ->> 'paymentTerms', '')
      ),
      ''
    );

  v_delivery_terms :=
    nullif(
      pg_catalog.btrim(
        coalesce(v_snapshot_quote ->> 'deliveryTerms', '')
      ),
      ''
    );

  v_warranty_terms :=
    nullif(
      pg_catalog.btrim(
        coalesce(v_snapshot_quote ->> 'warrantyTerms', '')
      ),
      ''
    );

  v_valid_until_text :=
    nullif(
      pg_catalog.btrim(
        coalesce(v_snapshot_quote ->> 'validUntil', '')
      ),
      ''
    );

  if v_valid_until_text is not null then
    begin
      v_valid_until := v_valid_until_text::date;
    exception
      when others then
        raise exception using
          errcode = '22007',
          message = 'ZION_CONTRACT_CREATE_QUOTE_SNAPSHOT_VALID_UNTIL_INVALID',
          detail = v_valid_until_text;
    end;
  end if;

  insert into public.sales_contracts (
    organization_id,
    store_id,
    lead_id,
    conversation_id,
    quote_id,
    quote_version_id,
    current_version_id,
    contract_number,
    status,
    title,
    customer_name,
    customer_phone,
    currency,
    subtotal_cents,
    discount_cents,
    total_cents,
    payment_terms,
    delivery_terms,
    warranty_terms,
    contract_terms,
    valid_until,
    metadata
  )
  values (
    p_organization_id,
    p_store_id,
    v_quote.lead_id,
    v_quote.conversation_id,
    p_quote_id,
    p_quote_version_id,
    null,
    v_safe_contract_number,
    'pending_review',
    v_contract_title,
    v_customer_name,
    v_customer_phone,
    'BRL',
    v_subtotal::integer,
    v_discount::integer,
    v_total::integer,
    v_payment_terms,
    v_delivery_terms,
    v_warranty_terms,
    null,
    v_valid_until,
    pg_catalog.jsonb_build_object(
      'source', 'accepted_quote_version_snapshot',
      'quote_number', v_quote_number,
      'quote_status', v_snapshot_quote ->> 'status',
      'commercial_opportunity_id', p_commercial_opportunity_id,
      'quote_version_id', p_quote_version_id,
      'quote_version_number', v_version.version_number,
      'proposal_acceptance_event_id', v_acceptance.acceptance_event_id,
      'proposal_acceptance_source_message_id', v_acceptance.source_message_id,
      'proposal_accepted_at', v_acceptance.accepted_at,
      'created_via',
        'create_sales_contract_from_current_accepted_proposal_by_system'
    )
  )
  returning *
  into v_contract;

  return query
  select
    'created'::text,
    v_contract.id,
    v_contract.organization_id,
    v_contract.store_id,
    p_commercial_opportunity_id,
    v_contract.quote_id,
    v_contract.quote_version_id,
    v_acceptance.acceptance_event_id,
    v_contract.contract_number,
    v_contract.status;
end;
$function$;


alter function public.create_sales_contract_from_current_accepted_proposal_by_system(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text
)
owner to postgres;

revoke all on function public.create_sales_contract_from_current_accepted_proposal_by_system(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text
)
from public, anon, authenticated;

grant execute on function public.create_sales_contract_from_current_accepted_proposal_by_system(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text
)
to service_role;

comment on function public.create_sales_contract_from_current_accepted_proposal_by_system(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text
) is
  'P9 6.8 server-only atomic contract creation boundary. Locks the commercial opportunity, requires exact accepted Current Commercial Proposal plus create_contract readiness, derives commercial fields only from the immutable exact sales_quote_version quote_snapshot, and deduplicates by exact quote/version lineage.';


do $postconditions$
declare
  v_function oid := pg_catalog.to_regprocedure(
    'public.create_sales_contract_from_current_accepted_proposal_by_system(uuid,uuid,uuid,uuid,uuid,text)'
  );
  v_owner text;
  v_security_definer boolean;
  v_config text[];
  v_definition text;
begin
  if v_function is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9 6.8 contract creation postcondition failed: writer missing';
  end if;

  select
    role_row.rolname,
    proc_row.prosecdef,
    proc_row.proconfig,
    pg_catalog.pg_get_functiondef(proc_row.oid)
  into
    v_owner,
    v_security_definer,
    v_config,
    v_definition
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_roles role_row
    on role_row.oid = proc_row.proowner
  where proc_row.oid = v_function;

  if v_owner is distinct from 'postgres'
     or v_security_definer is distinct from true
     or not (
       coalesce(v_config, '{}'::text[]) @> array[
         'row_security=off',
         'search_path=pg_catalog, pg_temp, public'
       ]::text[]
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9 6.8 contract creation postcondition failed: security contract mismatch';
  end if;

  if exists (
       select 1
       from pg_catalog.pg_proc proc_row
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           proc_row.proacl,
           pg_catalog.acldefault('f', proc_row.proowner)
         )
       ) acl_row
       where proc_row.oid = v_function
         and acl_row.grantee = 0
         and acl_row.privilege_type = 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       v_function::regprocedure,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       v_function::regprocedure,
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       v_function::regprocedure,
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9 6.8 contract creation postcondition failed: ACL mismatch';
  end if;

  if pg_catalog.strpos(
       pg_catalog.lower(v_definition),
       'for update'
     ) = 0
     or pg_catalog.strpos(
       pg_catalog.lower(v_definition),
       'p9_resolve_current_commercial_proposal_acceptance_internal'
     ) = 0
     or pg_catalog.strpos(
       pg_catalog.lower(v_definition),
       'p9_resolve_commercial_action_readiness_internal'
     ) = 0
     or pg_catalog.strpos(
       pg_catalog.lower(v_definition),
       'quote_snapshot'
     ) = 0
     or pg_catalog.strpos(
       pg_catalog.lower(v_definition),
       'quote_version_id = p_quote_version_id'
     ) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'P9 6.8 contract creation postcondition failed: lineage contract mismatch';
  end if;
end;
$postconditions$;


commit;

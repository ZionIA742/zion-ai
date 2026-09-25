begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:current-proposal-private-resolvers:v1',
    0
  )
);


-- ============================================================================
-- P9 / Bloco 6 / Etapa 6.8
--
-- Private composable authority layer.
--
-- Public/system readers keep their existing authorization contracts.
-- Commercial semantics move into private internal resolvers so other canonical
-- SECURITY DEFINER authorities can compose them without depending on the
-- caller's JWT role.
--
-- Chain:
--   p9_resolve_current_commercial_proposal_internal
--     -> p9_resolve_current_commercial_proposal_acceptance_internal
--       -> future create_contract readiness integration
-- ============================================================================


do $preconditions$
begin
  if pg_catalog.to_regprocedure(
       'public.read_current_commercial_proposal_by_system(uuid,uuid,uuid)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message =
        'precondition failed: canonical current proposal system reader is required';
  end if;

  if pg_catalog.to_regprocedure(
       'public.read_current_commercial_proposal_acceptance_by_system(uuid,uuid,uuid)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message =
        'precondition failed: canonical proposal acceptance system reader is required';
  end if;

  if pg_catalog.to_regclass(
       'public.commercial_proposal_acceptance_events'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message =
        'precondition failed: commercial proposal acceptance authority is required';
  end if;

  if pg_catalog.to_regprocedure(
       'public.p9_resolve_current_commercial_proposal_internal(uuid,uuid,uuid)'
     ) is not null then
    raise exception using
      errcode = 'P0001',
      message =
        'precondition failed: private current proposal resolver already exists';
  end if;

  if pg_catalog.to_regprocedure(
       'public.p9_resolve_current_commercial_proposal_acceptance_internal(uuid,uuid,uuid)'
     ) is not null then
    raise exception using
      errcode = 'P0001',
      message =
        'precondition failed: private proposal acceptance resolver already exists';
  end if;
end;
$preconditions$;


-- ============================================================================
-- 1. Private Current Commercial Proposal authority.
-- ============================================================================

create function public.p9_resolve_current_commercial_proposal_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
)
returns table (
  organization_id uuid,
  store_id uuid,
  commercial_opportunity_id uuid,
  lifecycle_cycle integer,
  proposal_state text,
  current_quote_id uuid,
  current_quote_version_id uuid,
  quote_number text,
  lead_id uuid,
  conversation_id uuid,
  version_status text,
  version_number integer,
  version_sent_at timestamptz,
  reason_code text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_opportunity public.commercial_opportunities%rowtype;
  v_quote public.sales_quotes%rowtype;
  v_version public.sales_quote_versions%rowtype;

  v_pair_complete boolean := false;
  v_authority_valid boolean := false;
  v_canonical_sent_version_count integer := 0;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22023',
      message = 'P9_CURRENT_PROPOSAL_READER_ARGUMENTS_REQUIRED';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'P9_CURRENT_PROPOSAL_READER_OPPORTUNITY_NOT_FOUND';
  end if;

  select pg_catalog.count(*)::integer
  into v_canonical_sent_version_count
  from public.sales_quotes quote_row
  join public.sales_quote_versions version_row
    on version_row.quote_id = quote_row.id
   and version_row.organization_id = quote_row.organization_id
   and version_row.store_id = quote_row.store_id
  where quote_row.organization_id = p_organization_id
    and quote_row.store_id = p_store_id
    and quote_row.commercial_opportunity_id =
      p_commercial_opportunity_id
    and version_row.sent_at is not null
    and pg_catalog.lower(
      pg_catalog.btrim(coalesce(version_row.status, ''))
    ) in ('sent', 'superseded');

  if v_opportunity.current_quote_id is null
     and v_opportunity.current_quote_version_id is null then
    return query
    select
      v_opportunity.organization_id,
      v_opportunity.store_id,
      v_opportunity.id,
      v_opportunity.lifecycle_cycle,
      case
        when v_canonical_sent_version_count > 0
          then 'needs_resolution'::text
        else 'none'::text
      end,
      null::uuid,
      null::uuid,
      null::text,
      null::uuid,
      null::uuid,
      null::text,
      null::integer,
      null::timestamptz,
      case
        when v_canonical_sent_version_count > 0
          then 'quote_sent_without_current_proposal'::text
        else 'current_proposal_unknown'::text
      end;

    return;
  end if;

  v_pair_complete :=
    v_opportunity.current_quote_id is not null
    and v_opportunity.current_quote_version_id is not null;

  if not v_pair_complete then
    return query
    select
      v_opportunity.organization_id,
      v_opportunity.store_id,
      v_opportunity.id,
      v_opportunity.lifecycle_cycle,
      'conflict'::text,
      v_opportunity.current_quote_id,
      v_opportunity.current_quote_version_id,
      null::text,
      null::uuid,
      null::uuid,
      null::text,
      null::integer,
      null::timestamptz,
      'current_proposal_pair_conflict'::text;

    return;
  end if;

  select quote_row.*
  into v_quote
  from public.sales_quotes quote_row
  where quote_row.id = v_opportunity.current_quote_id
    and quote_row.organization_id = p_organization_id
    and quote_row.store_id = p_store_id
    and quote_row.commercial_opportunity_id =
      p_commercial_opportunity_id;

  if not found then
    return query
    select
      v_opportunity.organization_id,
      v_opportunity.store_id,
      v_opportunity.id,
      v_opportunity.lifecycle_cycle,
      'conflict'::text,
      v_opportunity.current_quote_id,
      v_opportunity.current_quote_version_id,
      null::text,
      null::uuid,
      null::uuid,
      null::text,
      null::integer,
      null::timestamptz,
      'current_proposal_quote_authority_conflict'::text;

    return;
  end if;

  select version_row.*
  into v_version
  from public.sales_quote_versions version_row
  where version_row.id = v_opportunity.current_quote_version_id
    and version_row.quote_id = v_quote.id
    and version_row.organization_id = p_organization_id
    and version_row.store_id = p_store_id;

  if not found then
    return query
    select
      v_opportunity.organization_id,
      v_opportunity.store_id,
      v_opportunity.id,
      v_opportunity.lifecycle_cycle,
      'conflict'::text,
      v_opportunity.current_quote_id,
      v_opportunity.current_quote_version_id,
      null::text,
      null::uuid,
      null::uuid,
      null::text,
      null::integer,
      null::timestamptz,
      'current_proposal_version_authority_conflict'::text;

    return;
  end if;

  v_authority_valid :=
    v_version.sent_at is not null
    and pg_catalog.lower(
      pg_catalog.btrim(coalesce(v_version.status, ''))
    ) in ('sent', 'superseded');

  if not v_authority_valid then
    return query
    select
      v_opportunity.organization_id,
      v_opportunity.store_id,
      v_opportunity.id,
      v_opportunity.lifecycle_cycle,
      'conflict'::text,
      v_opportunity.current_quote_id,
      v_opportunity.current_quote_version_id,
      null::text,
      null::uuid,
      null::uuid,
      null::text,
      null::integer,
      null::timestamptz,
      'current_proposal_sent_evidence_conflict'::text;

    return;
  end if;

  if v_opportunity.lifecycle_cycle > 1 then
    return query
    select
      v_opportunity.organization_id,
      v_opportunity.store_id,
      v_opportunity.id,
      v_opportunity.lifecycle_cycle,
      'needs_resolution'::text,
      v_opportunity.current_quote_id,
      v_opportunity.current_quote_version_id,
      null::text,
      null::uuid,
      null::uuid,
      null::text,
      null::integer,
      null::timestamptz,
      'current_proposal_cycle_unanchored'::text;

    return;
  end if;

  return query
  select
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_opportunity.id,
    v_opportunity.lifecycle_cycle,
    'available'::text,
    v_quote.id,
    v_version.id,
    v_quote.quote_number,
    v_quote.lead_id,
    v_quote.conversation_id,
    v_version.status,
    v_version.version_number,
    v_version.sent_at,
    'current_proposal_authority_valid'::text;
end;
$function$;

alter function public.p9_resolve_current_commercial_proposal_internal(
  uuid,
  uuid,
  uuid
)
  owner to postgres;

revoke all on function public.p9_resolve_current_commercial_proposal_internal(
  uuid,
  uuid,
  uuid
)
  from public, anon, authenticated, service_role;


-- ============================================================================
-- 2. Existing 6.7 system reader becomes authorization wrapper only.
-- ============================================================================

create or replace function public.read_current_commercial_proposal_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
)
returns table (
  organization_id uuid,
  store_id uuid,
  commercial_opportunity_id uuid,
  lifecycle_cycle integer,
  proposal_state text,
  current_quote_id uuid,
  current_quote_version_id uuid,
  quote_number text,
  lead_id uuid,
  conversation_id uuid,
  version_status text,
  version_number integer,
  version_sent_at timestamptz,
  reason_code text
)
language plpgsql
stable
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
begin
  if v_request_role is distinct from 'service_role'
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message =
        'current commercial proposal system reader is not authorized';
  end if;

  return query
  select resolved.*
  from public.p9_resolve_current_commercial_proposal_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id
  ) resolved;
end;
$function$;

alter function public.read_current_commercial_proposal_by_system(
  uuid,
  uuid,
  uuid
)
  owner to postgres;

revoke all on function public.read_current_commercial_proposal_by_system(
  uuid,
  uuid,
  uuid
)
  from public, anon, authenticated, service_role;

grant execute on function public.read_current_commercial_proposal_by_system(
  uuid,
  uuid,
  uuid
)
  to service_role;

comment on function public.read_current_commercial_proposal_by_system(
  uuid,
  uuid,
  uuid
) is
  'P9 6.7 service-role wrapper for the canonical private Current Commercial Proposal resolver. Authorization remains external to the private semantic authority.';


-- ============================================================================
-- 3. Private exact Current Commercial Proposal Acceptance authority.
-- ============================================================================

create function public.p9_resolve_current_commercial_proposal_acceptance_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
)
returns table (
  commercial_opportunity_id uuid,
  lifecycle_cycle integer,
  current_quote_id uuid,
  current_quote_version_id uuid,
  acceptance_state text,
  reason_code text,
  acceptance_event_id uuid,
  source_message_id uuid,
  customer_signal_at timestamptz,
  confirmed_by_user_id uuid,
  accepted_at timestamptz,
  stale_acceptance_count bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_current_proposal record;
  v_acceptance public.commercial_proposal_acceptance_events%rowtype;
  v_stale_count bigint := 0;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22023',
      message =
        'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_READER_ARGUMENTS_REQUIRED';
  end if;

  select *
  into v_current_proposal
  from public.p9_resolve_current_commercial_proposal_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id
  );

  if not found then
    raise exception using
      errcode = 'P0001',
      message =
        'ZION_COMMERCIAL_PROPOSAL_ACCEPTANCE_CURRENT_PROPOSAL_READER_NO_ROW';
  end if;

  select pg_catalog.count(*)
  into v_stale_count
  from public.commercial_proposal_acceptance_events acceptance_row
  where acceptance_row.organization_id = p_organization_id
    and acceptance_row.store_id = p_store_id
    and acceptance_row.commercial_opportunity_id =
      p_commercial_opportunity_id
    and (
      acceptance_row.lifecycle_cycle
        is distinct from v_current_proposal.lifecycle_cycle
      or acceptance_row.quote_id
        is distinct from v_current_proposal.current_quote_id
      or acceptance_row.quote_version_id
        is distinct from v_current_proposal.current_quote_version_id
    );

  if v_current_proposal.proposal_state is distinct from 'available' then
    return query
    select
      v_current_proposal.commercial_opportunity_id::uuid,
      v_current_proposal.lifecycle_cycle::integer,
      v_current_proposal.current_quote_id::uuid,
      v_current_proposal.current_quote_version_id::uuid,
      case
        when v_current_proposal.proposal_state in (
          'none',
          'conflict',
          'needs_resolution'
        )
          then v_current_proposal.proposal_state::text
        else 'conflict'::text
      end,
      case
        when v_current_proposal.proposal_state in (
          'none',
          'conflict',
          'needs_resolution'
        )
          then v_current_proposal.reason_code::text
        else 'current_proposal_upstream_state_unknown'::text
      end,
      null::uuid,
      null::uuid,
      null::timestamptz,
      null::uuid,
      null::timestamptz,
      v_stale_count;

    return;
  end if;

  select acceptance_row.*
  into v_acceptance
  from public.commercial_proposal_acceptance_events acceptance_row
  where acceptance_row.organization_id = p_organization_id
    and acceptance_row.store_id = p_store_id
    and acceptance_row.commercial_opportunity_id =
      v_current_proposal.commercial_opportunity_id
    and acceptance_row.lifecycle_cycle =
      v_current_proposal.lifecycle_cycle
    and acceptance_row.quote_id =
      v_current_proposal.current_quote_id
    and acceptance_row.quote_version_id =
      v_current_proposal.current_quote_version_id;

  if found then
    return query
    select
      v_current_proposal.commercial_opportunity_id::uuid,
      v_current_proposal.lifecycle_cycle::integer,
      v_current_proposal.current_quote_id::uuid,
      v_current_proposal.current_quote_version_id::uuid,
      'accepted'::text,
      'current_proposal_accepted'::text,
      v_acceptance.id,
      v_acceptance.source_message_id,
      v_acceptance.customer_signal_at,
      v_acceptance.confirmed_by_user_id,
      v_acceptance.accepted_at,
      v_stale_count;

    return;
  end if;

  return query
  select
    v_current_proposal.commercial_opportunity_id::uuid,
    v_current_proposal.lifecycle_cycle::integer,
    v_current_proposal.current_quote_id::uuid,
    v_current_proposal.current_quote_version_id::uuid,
    'none'::text,
    case
      when v_stale_count > 0
        then 'current_proposal_acceptance_stale'
      else 'current_proposal_not_accepted'
    end,
    null::uuid,
    null::uuid,
    null::timestamptz,
    null::uuid,
    null::timestamptz,
    v_stale_count;
end;
$function$;

alter function public.p9_resolve_current_commercial_proposal_acceptance_internal(
  uuid,
  uuid,
  uuid
)
  owner to postgres;

revoke all on function public.p9_resolve_current_commercial_proposal_acceptance_internal(
  uuid,
  uuid,
  uuid
)
  from public, anon, authenticated, service_role;


-- ============================================================================
-- 4. Existing 6.8 system reader becomes authorization wrapper only.
-- ============================================================================

create or replace function public.read_current_commercial_proposal_acceptance_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
)
returns table (
  commercial_opportunity_id uuid,
  lifecycle_cycle integer,
  current_quote_id uuid,
  current_quote_version_id uuid,
  acceptance_state text,
  reason_code text,
  acceptance_event_id uuid,
  source_message_id uuid,
  customer_signal_at timestamptz,
  confirmed_by_user_id uuid,
  accepted_at timestamptz,
  stale_acceptance_count bigint
)
language plpgsql
stable
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
begin
  if v_request_role is distinct from 'service_role'
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message =
        'current commercial proposal acceptance reader is not authorized';
  end if;

  return query
  select resolved.*
  from public.p9_resolve_current_commercial_proposal_acceptance_internal(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id
  ) resolved;
end;
$function$;

alter function public.read_current_commercial_proposal_acceptance_by_system(
  uuid,
  uuid,
  uuid
)
  owner to postgres;

revoke all on function public.read_current_commercial_proposal_acceptance_by_system(
  uuid,
  uuid,
  uuid
)
  from public, anon, authenticated, service_role;

grant execute on function public.read_current_commercial_proposal_acceptance_by_system(
  uuid,
  uuid,
  uuid
)
  to service_role;

comment on function public.read_current_commercial_proposal_acceptance_by_system(
  uuid,
  uuid,
  uuid
) is
  'P9 6.8 service-role wrapper for the private exact Current Commercial Proposal Acceptance resolver. The private authority composes the private P9 6.7 Current Proposal resolver and preserves upstream none/conflict/needs_resolution semantics.';


-- ============================================================================
-- 5. Postconditions.
-- ============================================================================

do $postconditions$
declare
  v_proposal_internal oid := pg_catalog.to_regprocedure(
    'public.p9_resolve_current_commercial_proposal_internal(uuid,uuid,uuid)'
  );

  v_acceptance_internal oid := pg_catalog.to_regprocedure(
    'public.p9_resolve_current_commercial_proposal_acceptance_internal(uuid,uuid,uuid)'
  );

  v_proposal_reader oid := pg_catalog.to_regprocedure(
    'public.read_current_commercial_proposal_by_system(uuid,uuid,uuid)'
  );

  v_acceptance_reader oid := pg_catalog.to_regprocedure(
    'public.read_current_commercial_proposal_acceptance_by_system(uuid,uuid,uuid)'
  );

  v_definition text;
  v_security_definer boolean;
  v_volatility "char";
begin
  if v_proposal_internal is null
     or v_acceptance_internal is null
     or v_proposal_reader is null
     or v_acceptance_reader is null then
    raise exception using
      errcode = 'P0001',
      message =
        'postcondition failed: private/public proposal authority chain incomplete';
  end if;

  if pg_catalog.has_function_privilege(
       'public',
       v_proposal_internal,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       v_proposal_internal,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       v_proposal_internal,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       v_proposal_internal,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'public',
       v_acceptance_internal,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       v_acceptance_internal,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       v_acceptance_internal,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       v_acceptance_internal,
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message =
        'postcondition failed: private proposal resolvers became externally executable';
  end if;

  if pg_catalog.has_function_privilege(
       'authenticated',
       v_proposal_reader,
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       v_proposal_reader,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       v_acceptance_reader,
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       v_acceptance_reader,
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message =
        'postcondition failed: service reader grants changed';
  end if;

  select
    proc_row.prosecdef,
    proc_row.provolatile
  into
    v_security_definer,
    v_volatility
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_proposal_internal;

  if v_security_definer is distinct from true
     or v_volatility is distinct from 's'::"char" then
    raise exception using
      errcode = 'P0001',
      message =
        'postcondition failed: private Current Proposal resolver hardening mismatch';
  end if;

  select
    proc_row.prosecdef,
    proc_row.provolatile
  into
    v_security_definer,
    v_volatility
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_acceptance_internal;

  if v_security_definer is distinct from true
     or v_volatility is distinct from 's'::"char" then
    raise exception using
      errcode = 'P0001',
      message =
        'postcondition failed: private acceptance resolver hardening mismatch';
  end if;

  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(v_proposal_reader),
      '\s+',
      ' ',
      'g'
    )
  )
  into v_definition;

  if v_definition not like
       '%p9_resolve_current_commercial_proposal_internal%'
     or v_definition like '%from public.commercial_opportunities%'
     or v_definition like '%from public.sales_quotes%'
     or v_definition like '%from public.sales_quote_versions%' then
    raise exception using
      errcode = 'P0001',
      message =
        'postcondition failed: Current Proposal system reader does not delegate cleanly';
  end if;

  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(v_acceptance_internal),
      '\s+',
      ' ',
      'g'
    )
  )
  into v_definition;

  if v_definition not like
       '%p9_resolve_current_commercial_proposal_internal%'
     or v_definition not like
       '%commercial_proposal_acceptance_events%'
     or v_definition like
       '%read_current_commercial_proposal_by_system%' then
    raise exception using
      errcode = 'P0001',
      message =
        'postcondition failed: private acceptance resolver authority chain mismatch';
  end if;

  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(v_acceptance_reader),
      '\s+',
      ' ',
      'g'
    )
  )
  into v_definition;

  if v_definition not like
       '%p9_resolve_current_commercial_proposal_acceptance_internal%'
     or v_definition like
       '%commercial_proposal_acceptance_events%'
     or v_definition like
       '%read_current_commercial_proposal_by_system%' then
    raise exception using
      errcode = 'P0001',
      message =
        'postcondition failed: acceptance system reader does not delegate cleanly';
  end if;
end;
$postconditions$;

commit;

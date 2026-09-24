begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:current-commercial-proposal-system-reader:v1',
    0
  )
);

-- ============================================================================
-- P9 / Bloco 6 / Etapa 6.7
-- Current Commercial Proposal - system reader.
--
-- Authority:
--   commercial_opportunities.current_quote_id
--   commercial_opportunities.current_quote_version_id
--
-- Rules:
-- - never infer the current proposal by latest/first/created_at/updated_at;
-- - both stored pointers must exist together;
-- - quote must belong to the exact organization/store/opportunity;
-- - version must belong to the exact quote/organization/store;
-- - immutable presentation evidence is sales_quote_versions.sent_at;
-- - version status may be sent or superseded;
-- - lifecycle_cycle > 1 is not currently anchored in quote lineage, therefore
--   the reader fails closed with needs_resolution;
-- - only an "available" result may be consumed as the current proposal.
-- ============================================================================

do $preflight$
declare
  v_expected record;
begin
  if pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.sales_quotes') is null
     or pg_catalog.to_regclass('public.sales_quote_versions') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: current commercial proposal authority tables are required';
  end if;

  for v_expected in
    select *
    from (
      values
        ('commercial_opportunities'::text, 'id'::text),
        ('commercial_opportunities', 'organization_id'),
        ('commercial_opportunities', 'store_id'),
        ('commercial_opportunities', 'lifecycle_cycle'),
        ('commercial_opportunities', 'current_quote_id'),
        ('commercial_opportunities', 'current_quote_version_id'),
        ('sales_quotes', 'id'),
        ('sales_quotes', 'organization_id'),
        ('sales_quotes', 'store_id'),
        ('sales_quotes', 'commercial_opportunity_id'),
        ('sales_quotes', 'conversation_id'),
        ('sales_quotes', 'lead_id'),
        ('sales_quotes', 'quote_number'),
        ('sales_quote_versions', 'id'),
        ('sales_quote_versions', 'quote_id'),
        ('sales_quote_versions', 'organization_id'),
        ('sales_quote_versions', 'store_id'),
        ('sales_quote_versions', 'status'),
        ('sales_quote_versions', 'version_number'),
        ('sales_quote_versions', 'sent_at')
    ) as expected(table_name, column_name)
  loop
    if not exists (
      select 1
      from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = v_expected.table_name
        and column_row.column_name = v_expected.column_name
    ) then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'precondition failed: public.%s.%s is required',
          v_expected.table_name,
          v_expected.column_name
        );
    end if;
  end loop;

  if pg_catalog.to_regprocedure(
       'public.set_current_commercial_proposal_from_sent_quote_by_system(uuid,uuid,uuid,uuid,uuid,text,text)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical current proposal writer is required';
  end if;
end;
$preflight$;

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
      nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
      nullif(auth.jwt() ->> 'role', '')
    );

  v_opportunity public.commercial_opportunities;
  v_quote public.sales_quotes;
  v_version public.sales_quote_versions;

  v_pair_complete boolean := false;
  v_authority_valid boolean := false;
  v_canonical_sent_version_count integer := 0;
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'current commercial proposal system reader is not authorized';
  end if;

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
    and quote_row.commercial_opportunity_id = p_commercial_opportunity_id
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
        when v_canonical_sent_version_count > 0 then 'needs_resolution'::text
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
    and quote_row.commercial_opportunity_id = p_commercial_opportunity_id;

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

alter function public.read_current_commercial_proposal_by_system(
  uuid,
  uuid,
  uuid
) owner to postgres;

comment on function public.read_current_commercial_proposal_by_system(
  uuid,
  uuid,
  uuid
) is
  'P9 6.7 canonical system reader for the explicit current commercial proposal. Reads only commercial_opportunities.current_quote_id/current_quote_version_id, validates exact quote/version scope and canonical sent evidence, never infers by recency, and fails closed when lifecycle cycle lineage is not provable.';

revoke all on function public.read_current_commercial_proposal_by_system(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated, service_role;

grant execute on function public.read_current_commercial_proposal_by_system(
  uuid,
  uuid,
  uuid
) to service_role;

do $postconditions$
declare
  v_definition text;
  v_proc record;
begin
  if pg_catalog.to_regprocedure(
       'public.read_current_commercial_proposal_by_system(uuid,uuid,uuid)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: current commercial proposal system reader was not created';
  end if;

  select
    procedure_row.prosecdef,
    procedure_row.provolatile
  into v_proc
  from pg_catalog.pg_proc procedure_row
  where procedure_row.oid =
    'public.read_current_commercial_proposal_by_system(uuid,uuid,uuid)'::pg_catalog.regprocedure;

  if v_proc.prosecdef is distinct from true
     or v_proc.provolatile is distinct from 's'::"char" then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: current proposal reader security/volatility contract mismatch';
  end if;

  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(
        'public.read_current_commercial_proposal_by_system(uuid,uuid,uuid)'::pg_catalog.regprocedure
      ),
      '\s+',
      ' ',
      'g'
    )
  )
  into v_definition;

  if v_definition not like '%current_quote_id%'
     or v_definition not like '%current_quote_version_id%'
     or v_definition not like '%commercial_opportunity_id = p_commercial_opportunity_id%'
     or v_definition not like '%v_version.sent_at is not null%'
     or v_definition not like '%in (''sent'', ''superseded'')%'
     or v_definition not like '%quote_sent_without_current_proposal%'
     or v_definition not like '%lifecycle_cycle > 1%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: current proposal reader is missing canonical authority checks';
  end if;

  if v_definition like '%order by%'
     or v_definition like '%limit %'
     or v_definition like '%created_at%'
     or v_definition like '%updated_at%'
     or v_definition like '%v_quote.status%'
     or v_definition like '%v_quote.total_cents%'
     or v_definition like '%v_quote.current_version_id%'
     or v_definition like '%v_quote.customer_name%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: current proposal reader contains recency/selection heuristics';
  end if;

  if not has_function_privilege(
       'service_role',
       'public.read_current_commercial_proposal_by_system(uuid,uuid,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.read_current_commercial_proposal_by_system(uuid,uuid,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.read_current_commercial_proposal_by_system(uuid,uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: current proposal reader grants mismatch';
  end if;
end;
$postconditions$;

commit;

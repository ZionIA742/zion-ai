begin;

-- ============================================================================
-- ZION / Pilar 9 / Bloco 6 / Etapa 6.8
--
-- Hotfix aditivo:
-- deterministic canonical-vs-legacy classification.
--
-- Migrations ja aplicadas permanecem imutaveis:
--   20260925124500
--   20260925133500
--
-- SQL three-valued boolean root cause:
--   NULL OR NULL OR FALSE = NULL
--
-- Therefore:
--   IF NOT v_is_canonical
-- did not enter the legacy branch when every canonical marker was absent.
--
-- IS NOT DISTINCT FROM guarantees TRUE/FALSE semantics.
-- ============================================================================
create or replace function public.p9_assert_sales_contract_current_proposal_lineage_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_contract_id uuid
)
returns table (
  guard_state text,
  commercial_opportunity_id uuid,
  quote_id uuid,
  quote_version_id uuid,
  acceptance_event_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_contract public.sales_contracts%rowtype;
  v_quote public.sales_quotes%rowtype;
  v_opportunity public.commercial_opportunities%rowtype;
  v_acceptance record;

  v_created_via text;
  v_source text;
  v_metadata_opportunity_id text;
  v_metadata_quote_version_id text;
  v_metadata_acceptance_event_id text;

  v_is_canonical boolean := false;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_contract_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_DOWNSTREAM_INVALID_ARGUMENT';
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
      message = 'ZION_CONTRACT_DOWNSTREAM_CONTRACT_NOT_FOUND';
  end if;

  v_created_via :=
    nullif(
      pg_catalog.btrim(
        coalesce(
          v_contract.metadata ->> 'created_via',
          ''
        )
      ),
      ''
    );

  v_source :=
    nullif(
      pg_catalog.btrim(
        coalesce(
          v_contract.metadata ->> 'source',
          ''
        )
      ),
      ''
    );

  v_metadata_opportunity_id :=
    nullif(
      pg_catalog.btrim(
        coalesce(
          v_contract.metadata ->> 'commercial_opportunity_id',
          ''
        )
      ),
      ''
    );

  v_metadata_quote_version_id :=
    nullif(
      pg_catalog.btrim(
        coalesce(
          v_contract.metadata ->> 'quote_version_id',
          ''
        )
      ),
      ''
    );

  v_metadata_acceptance_event_id :=
    nullif(
      pg_catalog.btrim(
        coalesce(
          v_contract.metadata ->> 'proposal_acceptance_event_id',
          ''
        )
      ),
      ''
    );

  -- Only contracts created by the canonical P9 6.8 boundary are guarded.
  -- Older contracts remain historical/legacy and are not retroactively blocked.
  v_is_canonical :=
    v_created_via is not distinct from
      'create_sales_contract_from_current_accepted_proposal_by_system'
    or v_source is not distinct from
      'accepted_quote_version_snapshot'
    or v_metadata_acceptance_event_id is not null;

  if not v_is_canonical then
    return query
    select
      'legacy_not_guarded'::text,
      null::uuid,
      v_contract.quote_id,
      v_contract.quote_version_id,
      null::uuid;

    return;
  end if;

  if v_created_via is distinct from
       'create_sales_contract_from_current_accepted_proposal_by_system'
     or v_source is distinct from 'accepted_quote_version_snapshot'
     or v_contract.quote_id is null
     or v_contract.quote_version_id is null
     or v_metadata_opportunity_id is null
     or v_metadata_quote_version_id is null
     or v_metadata_acceptance_event_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_DOWNSTREAM_LINEAGE_UNPROVABLE';
  end if;

  if v_metadata_quote_version_id
       is distinct from v_contract.quote_version_id::text then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_DOWNSTREAM_LINEAGE_MISMATCH';
  end if;

  select quote_row.*
  into v_quote
  from public.sales_quotes quote_row
  where quote_row.id = v_contract.quote_id
    and quote_row.organization_id = p_organization_id
    and quote_row.store_id = p_store_id;

  if not found
     or v_quote.commercial_opportunity_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_DOWNSTREAM_QUOTE_LINEAGE_UNPROVABLE';
  end if;

  if v_metadata_opportunity_id
       is distinct from v_quote.commercial_opportunity_id::text then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_DOWNSTREAM_OPPORTUNITY_MISMATCH';
  end if;

  -- Same lock authority used by Current Commercial Proposal writers.
  -- It is held until the outer mutation transaction commits.
  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = v_quote.commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_DOWNSTREAM_OPPORTUNITY_NOT_FOUND';
  end if;

  if v_opportunity.current_quote_id
       is distinct from v_contract.quote_id
     or v_opportunity.current_quote_version_id
       is distinct from v_contract.quote_version_id then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_DOWNSTREAM_PROPOSAL_STALE',
      detail = pg_catalog.jsonb_build_object(
        'contract_id', v_contract.id,
        'contract_quote_id', v_contract.quote_id,
        'contract_quote_version_id', v_contract.quote_version_id,
        'current_quote_id', v_opportunity.current_quote_id,
        'current_quote_version_id', v_opportunity.current_quote_version_id
      )::text;
  end if;

  select acceptance_row.*
  into v_acceptance
  from public.p9_resolve_current_commercial_proposal_acceptance_internal(
    p_organization_id,
    p_store_id,
    v_opportunity.id
  ) acceptance_row;

  if not found
     or v_acceptance.acceptance_state is distinct from 'accepted'
     or v_acceptance.reason_code is distinct from 'current_proposal_accepted'
     or v_acceptance.acceptance_event_id is null
     or v_acceptance.current_quote_id
          is distinct from v_contract.quote_id
     or v_acceptance.current_quote_version_id
          is distinct from v_contract.quote_version_id then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_DOWNSTREAM_ACCEPTANCE_NOT_CURRENT';
  end if;

  if v_metadata_acceptance_event_id
       is distinct from v_acceptance.acceptance_event_id::text then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_DOWNSTREAM_ACCEPTANCE_EVENT_MISMATCH';
  end if;

  return query
  select
    'current'::text,
    v_opportunity.id,
    v_contract.quote_id,
    v_contract.quote_version_id,
    v_acceptance.acceptance_event_id;
end;
$function$;

create or replace function public.p9_guard_sales_contract_canonical_lineage_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_old_created_via text;
  v_old_source text;
  v_old_acceptance_event_id text;
  v_old_is_canonical boolean := false;
begin
  v_old_created_via :=
    nullif(
      pg_catalog.btrim(
        coalesce(
          old.metadata ->> 'created_via',
          ''
        )
      ),
      ''
    );

  v_old_source :=
    nullif(
      pg_catalog.btrim(
        coalesce(
          old.metadata ->> 'source',
          ''
        )
      ),
      ''
    );

  v_old_acceptance_event_id :=
    nullif(
      pg_catalog.btrim(
        coalesce(
          old.metadata ->> 'proposal_acceptance_event_id',
          ''
        )
      ),
      ''
    );

  v_old_is_canonical :=
    v_old_created_via is not distinct from
      'create_sales_contract_from_current_accepted_proposal_by_system'
    or v_old_source is not distinct from
      'accepted_quote_version_snapshot'
    or v_old_acceptance_event_id is not null;

  if not v_old_is_canonical then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.store_id is distinct from old.store_id
     or new.quote_id is distinct from old.quote_id
     or new.quote_version_id is distinct from old.quote_version_id then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_DOWNSTREAM_LINEAGE_IMMUTABLE';
  end if;

  if new.metadata ->> 'created_via'
       is distinct from old.metadata ->> 'created_via'
     or new.metadata ->> 'source'
       is distinct from old.metadata ->> 'source'
     or new.metadata ->> 'commercial_opportunity_id'
       is distinct from old.metadata ->> 'commercial_opportunity_id'
     or new.metadata ->> 'quote_version_id'
       is distinct from old.metadata ->> 'quote_version_id'
     or new.metadata ->> 'proposal_acceptance_event_id'
       is distinct from old.metadata ->> 'proposal_acceptance_event_id'
     or new.metadata ->> 'proposal_acceptance_source_message_id'
       is distinct from old.metadata ->> 'proposal_acceptance_source_message_id'
     or new.metadata ->> 'proposal_accepted_at'
       is distinct from old.metadata ->> 'proposal_accepted_at' then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_DOWNSTREAM_LINEAGE_METADATA_IMMUTABLE';
  end if;

  return new;
end;
$function$;
alter function public.p9_assert_sales_contract_current_proposal_lineage_internal(
  uuid,
  uuid,
  uuid
) owner to postgres;

revoke all on function public.p9_assert_sales_contract_current_proposal_lineage_internal(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated, service_role;


alter function public.p9_guard_sales_contract_canonical_lineage_update()
owner to postgres;

revoke all on function public.p9_guard_sales_contract_canonical_lineage_update()
from public, anon, authenticated, service_role;


do $postconditions$
declare
  v_assert text;
  v_immutability text;
begin
  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(
        'public.p9_assert_sales_contract_current_proposal_lineage_internal(uuid,uuid,uuid)'::pg_catalog.regprocedure
      ),
      '\s+',
      ' ',
      'g'
    )
  )
  into v_assert;

  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(
        'public.p9_guard_sales_contract_canonical_lineage_update()'::pg_catalog.regprocedure
      ),
      '\s+',
      ' ',
      'g'
    )
  )
  into v_immutability;

  if v_assert not like
       '%v_created_via is not distinct from%'
     or v_assert not like
       '%v_source is not distinct from%'
     or v_assert not like
       '%legacy_not_guarded%' then
    raise exception using
      errcode = 'P0001',
      message =
        'P9_6_8_LEGACY_BOOLEAN_HOTFIX_ASSERT_POSTCONDITION_FAILED';
  end if;

  if v_immutability not like
       '%v_old_created_via is not distinct from%'
     or v_immutability not like
       '%v_old_source is not distinct from%'
     or v_immutability not like
       '%if not v_old_is_canonical then%' then
    raise exception using
      errcode = 'P0001',
      message =
        'P9_6_8_LEGACY_BOOLEAN_HOTFIX_IMMUTABILITY_POSTCONDITION_FAILED';
  end if;
end;
$postconditions$;

commit;
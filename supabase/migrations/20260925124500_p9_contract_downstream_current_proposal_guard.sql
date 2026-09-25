begin;

-- ============================================================================
-- P9 6.8
-- Downstream guard for contracts created from an accepted Current Commercial
-- Proposal.
--
-- New advancement facts must still belong to the exact accepted
-- Current Commercial Proposal that originated the contract.
--
-- Historical facts are never deleted or rewritten.
-- Legacy contracts created before this canonical lineage are left untouched.
--
-- Linearization points protected here:
--   1. new sales_contract_versions row      -> contract PDF generation
--   2. sales_contracts transition approved  -> human approval
--   3. outgoing sales_contract_pdf message  -> contract send
--   4. customer/store signature insert      -> contract acceptance/signature
-- ============================================================================

do $preflight$
begin
  if pg_catalog.to_regclass('public.sales_contracts') is null
     or pg_catalog.to_regclass('public.sales_contract_versions') is null
     or pg_catalog.to_regclass('public.sales_contract_signatures') is null
     or pg_catalog.to_regclass('public.sales_quotes') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.messages') is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_6_8_DOWNSTREAM_GUARD_REQUIRED_TABLE_MISSING';
  end if;

  if pg_catalog.to_regprocedure(
       'public.p9_resolve_current_commercial_proposal_acceptance_internal(uuid,uuid,uuid)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_6_8_DOWNSTREAM_GUARD_ACCEPTANCE_RESOLVER_MISSING';
  end if;
end;
$preflight$;


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
    pg_catalog.nullif(
      pg_catalog.btrim(
        pg_catalog.coalesce(
          v_contract.metadata ->> 'created_via',
          ''
        )
      ),
      ''
    );

  v_source :=
    pg_catalog.nullif(
      pg_catalog.btrim(
        pg_catalog.coalesce(
          v_contract.metadata ->> 'source',
          ''
        )
      ),
      ''
    );

  v_metadata_opportunity_id :=
    pg_catalog.nullif(
      pg_catalog.btrim(
        pg_catalog.coalesce(
          v_contract.metadata ->> 'commercial_opportunity_id',
          ''
        )
      ),
      ''
    );

  v_metadata_quote_version_id :=
    pg_catalog.nullif(
      pg_catalog.btrim(
        pg_catalog.coalesce(
          v_contract.metadata ->> 'quote_version_id',
          ''
        )
      ),
      ''
    );

  v_metadata_acceptance_event_id :=
    pg_catalog.nullif(
      pg_catalog.btrim(
        pg_catalog.coalesce(
          v_contract.metadata ->> 'proposal_acceptance_event_id',
          ''
        )
      ),
      ''
    );

  -- Only contracts created by the canonical P9 6.8 boundary are guarded.
  -- Older contracts remain historical/legacy and are not retroactively blocked.
  v_is_canonical :=
    v_created_via =
      'create_sales_contract_from_current_accepted_proposal_by_system'
    or v_source = 'accepted_quote_version_snapshot'
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


-- ============================================================================
-- CANONICAL CONTRACT LINEAGE IMMUTABILITY
--
-- Once a contract declares canonical P9 6.8 lineage, the fields that prove
-- that lineage cannot be removed, replaced, re-scoped or downgraded to legacy.
-- ============================================================================

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
    pg_catalog.nullif(
      pg_catalog.btrim(
        pg_catalog.coalesce(
          old.metadata ->> 'created_via',
          ''
        )
      ),
      ''
    );

  v_old_source :=
    pg_catalog.nullif(
      pg_catalog.btrim(
        pg_catalog.coalesce(
          old.metadata ->> 'source',
          ''
        )
      ),
      ''
    );

  v_old_acceptance_event_id :=
    pg_catalog.nullif(
      pg_catalog.btrim(
        pg_catalog.coalesce(
          old.metadata ->> 'proposal_acceptance_event_id',
          ''
        )
      ),
      ''
    );

  v_old_is_canonical :=
    v_old_created_via =
      'create_sales_contract_from_current_accepted_proposal_by_system'
    or v_old_source = 'accepted_quote_version_snapshot'
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

alter function public.p9_guard_sales_contract_canonical_lineage_update()
owner to postgres;

revoke all on function public.p9_guard_sales_contract_canonical_lineage_update()
from public, anon, authenticated, service_role;

drop trigger if exists
  p9_sales_contract_canonical_lineage_immutability_guard
on public.sales_contracts;

create trigger p9_sales_contract_canonical_lineage_immutability_guard
before update of
  organization_id,
  store_id,
  quote_id,
  quote_version_id,
  metadata
on public.sales_contracts
for each row
execute function public.p9_guard_sales_contract_canonical_lineage_update();

-- ============================================================================
-- PDF GENERATION
-- A newly inserted contract version is the first durable DB fact of a newly
-- generated/regenerated contract PDF.
-- ============================================================================

create or replace function public.p9_guard_sales_contract_version_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
begin
  perform 1
  from public.p9_assert_sales_contract_current_proposal_lineage_internal(
    new.organization_id,
    new.store_id,
    new.contract_id
  );

  return new;
end;
$function$;

alter function public.p9_guard_sales_contract_version_insert()
owner to postgres;

revoke all on function public.p9_guard_sales_contract_version_insert()
from public, anon, authenticated, service_role;

drop trigger if exists
  p9_sales_contract_version_current_proposal_guard
on public.sales_contract_versions;

create trigger p9_sales_contract_version_current_proposal_guard
before insert
on public.sales_contract_versions
for each row
execute function public.p9_guard_sales_contract_version_insert();


-- ============================================================================
-- CONTRACT APPROVAL
-- Only a real transition into approved creates a new downstream fact.
-- ============================================================================

create or replace function public.p9_guard_sales_contract_approval()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
begin
  if pg_catalog.lower(
       pg_catalog.btrim(pg_catalog.coalesce(new.status, ''))
     ) = 'approved'
     and pg_catalog.lower(
       pg_catalog.btrim(pg_catalog.coalesce(old.status, ''))
     ) is distinct from 'approved' then

    perform 1
    from public.p9_assert_sales_contract_current_proposal_lineage_internal(
      new.organization_id,
      new.store_id,
      new.id
    );
  end if;

  return new;
end;
$function$;

alter function public.p9_guard_sales_contract_approval()
owner to postgres;

revoke all on function public.p9_guard_sales_contract_approval()
from public, anon, authenticated, service_role;

drop trigger if exists
  p9_sales_contract_approval_current_proposal_guard
on public.sales_contracts;

create trigger p9_sales_contract_approval_current_proposal_guard
before update of status
on public.sales_contracts
for each row
execute function public.p9_guard_sales_contract_approval();


-- ============================================================================
-- CONTRACT SEND
-- The outgoing contract-PDF message is the external-effect linearization point.
-- The normal route metadata contains:
--   file_kind = sales_contract_pdf
--   contract_id
-- ============================================================================

create or replace function public.p9_guard_sales_contract_send_message()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_contract_id_text text;
  v_contract_id uuid;
begin
  if pg_catalog.lower(
       pg_catalog.btrim(pg_catalog.coalesce(new.direction, ''))
     ) <> 'outgoing' then
    return new;
  end if;

  if pg_catalog.coalesce(new.metadata ->> 'file_kind', '')
       <> 'sales_contract_pdf' then
    return new;
  end if;

  v_contract_id_text :=
    pg_catalog.nullif(
      pg_catalog.btrim(
        pg_catalog.coalesce(
          new.metadata ->> 'contract_id',
          ''
        )
      ),
      ''
    );

  if v_contract_id_text is null then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_DOWNSTREAM_MESSAGE_CONTRACT_ID_REQUIRED';
  end if;

  begin
    v_contract_id := v_contract_id_text::uuid;
  exception
    when others then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_CONTRACT_DOWNSTREAM_MESSAGE_CONTRACT_ID_INVALID';
  end;

  perform 1
  from public.p9_assert_sales_contract_current_proposal_lineage_internal(
    new.organization_id,
    new.store_id,
    v_contract_id
  );

  return new;
end;
$function$;

alter function public.p9_guard_sales_contract_send_message()
owner to postgres;

revoke all on function public.p9_guard_sales_contract_send_message()
from public, anon, authenticated, service_role;

drop trigger if exists
  p9_sales_contract_send_message_current_proposal_guard
on public.messages;

create trigger p9_sales_contract_send_message_current_proposal_guard
before insert
on public.messages
for each row
execute function public.p9_guard_sales_contract_send_message();


-- ============================================================================
-- CUSTOMER / STORE SIGNATURES
-- The signature row itself is the human acceptance/confirmation fact.
--
-- Customer acceptance already runs inside one atomic PL/pgSQL transaction, so
-- the opportunity lock acquired here remains held through its contract/version
-- updates.
--
-- Store signature is likewise validated at the moment the human signature fact
-- is created; later status updates only materialize that already-valid fact.
-- ============================================================================

create or replace function public.p9_guard_sales_contract_signature_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_signer_type text;
begin
  v_signer_type :=
    pg_catalog.lower(
      pg_catalog.btrim(
        pg_catalog.coalesce(new.signer_type, '')
      )
    );

  if v_signer_type not in ('customer', 'store') then
    return new;
  end if;

  perform 1
  from public.p9_assert_sales_contract_current_proposal_lineage_internal(
    new.organization_id,
    new.store_id,
    new.contract_id
  );

  return new;
end;
$function$;

alter function public.p9_guard_sales_contract_signature_insert()
owner to postgres;

revoke all on function public.p9_guard_sales_contract_signature_insert()
from public, anon, authenticated, service_role;

drop trigger if exists
  p9_sales_contract_signature_current_proposal_guard
on public.sales_contract_signatures;

create trigger p9_sales_contract_signature_current_proposal_guard
before insert
on public.sales_contract_signatures
for each row
execute function public.p9_guard_sales_contract_signature_insert();


-- ============================================================================
-- POSTCONDITIONS
-- ============================================================================

do $postconditions$
declare
  v_definition text;
begin
  if pg_catalog.to_regprocedure(
       'public.p9_assert_sales_contract_current_proposal_lineage_internal(uuid,uuid,uuid)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_6_8_DOWNSTREAM_GUARD_HELPER_MISSING';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation_row
      on relation_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = relation_row.relnamespace
    where namespace_row.nspname = 'public'
      and relation_row.relname = 'sales_contract_versions'
      and trigger_row.tgname =
        'p9_sales_contract_version_current_proposal_guard'
      and not trigger_row.tgisinternal
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_6_8_DOWNSTREAM_VERSION_TRIGGER_MISSING';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation_row
      on relation_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = relation_row.relnamespace
    where namespace_row.nspname = 'public'
      and relation_row.relname = 'sales_contracts'
      and trigger_row.tgname =
        'p9_sales_contract_approval_current_proposal_guard'
      and not trigger_row.tgisinternal
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_6_8_DOWNSTREAM_APPROVAL_TRIGGER_MISSING';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation_row
      on relation_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = relation_row.relnamespace
    where namespace_row.nspname = 'public'
      and relation_row.relname = 'messages'
      and trigger_row.tgname =
        'p9_sales_contract_send_message_current_proposal_guard'
      and not trigger_row.tgisinternal
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_6_8_DOWNSTREAM_MESSAGE_TRIGGER_MISSING';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation_row
      on relation_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = relation_row.relnamespace
    where namespace_row.nspname = 'public'
      and relation_row.relname = 'sales_contract_signatures'
      and trigger_row.tgname =
        'p9_sales_contract_signature_current_proposal_guard'
      and not trigger_row.tgisinternal
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_6_8_DOWNSTREAM_SIGNATURE_TRIGGER_MISSING';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation_row
      on relation_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = relation_row.relnamespace
    where namespace_row.nspname = 'public'
      and relation_row.relname = 'sales_contracts'
      and trigger_row.tgname =
        'p9_sales_contract_canonical_lineage_immutability_guard'
      and not trigger_row.tgisinternal
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_6_8_DOWNSTREAM_LINEAGE_IMMUTABILITY_TRIGGER_MISSING';
  end if;
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
  into v_definition;

  if v_definition not like '%for update%'
     or v_definition not like '%current_quote_id%'
     or v_definition not like '%current_quote_version_id%'
     or v_definition not like '%p9_resolve_current_commercial_proposal_acceptance_internal%'
     or v_definition not like '%proposal_acceptance_event_id%'
     or v_definition not like '%zion_contract_downstream_proposal_stale%'
     or v_definition not like '%zion_contract_downstream_acceptance_not_current%' then
    raise exception using
      errcode = 'P0001',
      message = 'P9_6_8_DOWNSTREAM_GUARD_DEFINITION_INCOMPLETE';
  end if;
end;
$postconditions$;

commit;
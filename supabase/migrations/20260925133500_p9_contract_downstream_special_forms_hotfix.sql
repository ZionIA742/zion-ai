begin;

-- ============================================================================
-- ZION / P9 / Bloco 6 / Etapa 6.8
-- Hotfix aditivo: SQL special forms no downstream Current Proposal guard.
--
-- A migration 20260925124500 ja foi aplicada no DEV e NAO deve ser alterada
-- retroativamente.
--
-- PostgreSQL nao resolve COALESCE / NULLIF como:
--   pg_catalog.coalesce(...)
--   pg_catalog.nullif(...)
--
-- Este hotfix redefine apenas as funcoes afetadas, preservando:
-- - assinaturas;
-- - triggers existentes;
-- - semantica;
-- - lineage;
-- - fail-closed;
-- - owner/grants.
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

create or replace function public.p9_guard_sales_contract_approval()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
begin
  if pg_catalog.lower(
       pg_catalog.btrim(coalesce(new.status, ''))
     ) = 'approved'
     and pg_catalog.lower(
       pg_catalog.btrim(coalesce(old.status, ''))
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
       pg_catalog.btrim(coalesce(new.direction, ''))
     ) <> 'outgoing' then
    return new;
  end if;

  if coalesce(new.metadata ->> 'file_kind', '')
       <> 'sales_contract_pdf' then
    return new;
  end if;

  v_contract_id_text :=
    nullif(
      pg_catalog.btrim(
        coalesce(
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
        coalesce(new.signer_type, '')
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


alter function public.p9_guard_sales_contract_approval()
owner to postgres;

revoke all on function public.p9_guard_sales_contract_approval()
from public, anon, authenticated, service_role;


alter function public.p9_guard_sales_contract_send_message()
owner to postgres;

revoke all on function public.p9_guard_sales_contract_send_message()
from public, anon, authenticated, service_role;


alter function public.p9_guard_sales_contract_signature_insert()
owner to postgres;

revoke all on function public.p9_guard_sales_contract_signature_insert()
from public, anon, authenticated, service_role;


do $postconditions$
declare
  v_signature text;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.p9_assert_sales_contract_current_proposal_lineage_internal(uuid,uuid,uuid)',
    'public.p9_guard_sales_contract_canonical_lineage_update()',
    'public.p9_guard_sales_contract_approval()',
    'public.p9_guard_sales_contract_send_message()',
    'public.p9_guard_sales_contract_signature_insert()'
  ]
  loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception using
        errcode = 'P0001',
        message = 'P9_6_8_SPECIAL_FORMS_HOTFIX_FUNCTION_MISSING',
        detail = v_signature;
    end if;

    select pg_catalog.pg_get_functiondef(
      pg_catalog.to_regprocedure(v_signature)
    )
    into v_definition;

    if pg_catalog.strpos(
         pg_catalog.lower(v_definition),
         'pg_catalog.coalesce('
       ) > 0
       or pg_catalog.strpos(
         pg_catalog.lower(v_definition),
         'pg_catalog.nullif('
       ) > 0 then
      raise exception using
        errcode = 'P0001',
        message = 'P9_6_8_SPECIAL_FORMS_HOTFIX_INVALID_FORM_REMAINS',
        detail = v_signature;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c
      on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n
      on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'messages'
      and t.tgname =
        'p9_sales_contract_send_message_current_proposal_guard'
      and not t.tgisinternal
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_6_8_SPECIAL_FORMS_HOTFIX_MESSAGE_TRIGGER_MISSING';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c
      on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n
      on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'sales_contracts'
      and t.tgname =
        'p9_sales_contract_canonical_lineage_immutability_guard'
      and not t.tgisinternal
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_6_8_SPECIAL_FORMS_HOTFIX_IMMUTABILITY_TRIGGER_MISSING';
  end if;
end;
$postconditions$;

commit;
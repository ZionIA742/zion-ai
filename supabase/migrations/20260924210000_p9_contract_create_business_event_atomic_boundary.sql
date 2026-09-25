-- P9 6.8
-- Atomic/reconcilable contract_record_created business event boundary.
--
-- Keeps the existing exact accepted Current Commercial Proposal writer intact.
-- Adds a server-only wrapper that:
-- - creates/replays the exact-lineage contract through the existing canonical writer;
-- - guarantees exactly one contract_record_created event per contract;
-- - reconciles a missing event on an already_exists replay;
-- - rolls contract creation back if event registration fails in the same transaction.

do $preflight$
begin
  if pg_catalog.to_regprocedure(
       'public.create_sales_contract_from_current_accepted_proposal_by_system(uuid,uuid,uuid,uuid,uuid,text)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9 6.8 event boundary precondition failed: canonical contract writer missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.store_business_event_register(uuid,uuid,text,text,uuid,uuid,uuid,jsonb)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9 6.8 event boundary precondition failed: business event writer missing';
  end if;

  if pg_catalog.to_regclass('public.store_business_events') is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9 6.8 event boundary precondition failed: store_business_events missing';
  end if;

  if exists (
    select 1
    from public.store_business_events event_row
    where event_row.event_key = 'contrato_gerado'
      and event_row.event_payload ->> 'stage' = 'contract_record_created'
      and nullif(
            pg_catalog.btrim(
              coalesce(event_row.event_payload ->> 'contract_id', '')
            ),
            ''
          ) is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9 6.8 event boundary precondition failed: contract_record_created without contract_id';
  end if;

  if exists (
    select 1
    from public.store_business_events event_row
    where event_row.event_key = 'contrato_gerado'
      and event_row.event_payload ->> 'stage' = 'contract_record_created'
      and nullif(
            pg_catalog.btrim(
              coalesce(event_row.event_payload ->> 'contract_id', '')
            ),
            ''
          ) is not null
    group by
      event_row.organization_id,
      event_row.store_id,
      event_row.event_payload ->> 'contract_id'
    having pg_catalog.count(*) > 1
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9 6.8 event boundary precondition failed: duplicate contract_record_created events';
  end if;
end;
$preflight$;


create unique index if not exists
  store_business_events_contract_record_created_contract_uidx
on public.store_business_events (
  organization_id,
  store_id,
  ((event_payload ->> 'contract_id'))
)
where event_key = 'contrato_gerado'
  and event_payload ->> 'stage' = 'contract_record_created'
  and nullif(
        pg_catalog.btrim(
          coalesce(event_payload ->> 'contract_id', '')
        ),
        ''
      ) is not null;


create or replace function public.create_sales_contract_with_current_acceptance_event_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_quote_id uuid,
  p_quote_version_id uuid,
  p_contract_number text,
  p_actor_user_id uuid
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
  contract_status text,
  business_event_id uuid,
  business_event_outcome text
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

  v_writer record;
  v_contract public.sales_contracts%rowtype;
  v_existing_event public.store_business_events%rowtype;

  v_event_id uuid;
  v_event_outcome text;
begin
  if v_request_role is distinct from 'service_role'
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'sales contract creation event boundary is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_quote_id is null
     or p_quote_version_id is null
     or nullif(pg_catalog.btrim(p_contract_number), '') is null
     or p_actor_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_CONTRACT_CREATE_EVENT_INVALID_ARGUMENT';
  end if;

  -- The actor attached to the human contract creation event must still be an
  -- active member of the organization. The service-role caller is not allowed
  -- to forge a human actor outside the authorized organization.
  perform 1
  from public.memberships membership_row
  where membership_row.organization_id = p_organization_id
    and membership_row.user_id = p_actor_user_id
    and membership_row.is_active = true;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'ZION_CONTRACT_CREATE_EVENT_ACTOR_NOT_AUTHORIZED';
  end if;

  -- Canonical contract authority.
  -- Its opportunity FOR UPDATE lock remains held until this wrapper returns,
  -- so contract creation/replay and event materialization share one transaction.
  select writer_row.*
  into v_writer
  from public.create_sales_contract_from_current_accepted_proposal_by_system(
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_quote_id,
    p_quote_version_id,
    p_contract_number
  ) writer_row;

  if not found
     or v_writer.contract_id is null
     or v_writer.outcome not in ('created', 'already_exists') then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_CREATE_EVENT_WRITER_RESULT_INVALID';
  end if;

  if v_writer.organization_id is distinct from p_organization_id
     or v_writer.store_id is distinct from p_store_id
     or v_writer.commercial_opportunity_id is distinct from p_commercial_opportunity_id
     or v_writer.quote_id is distinct from p_quote_id
     or v_writer.quote_version_id is distinct from p_quote_version_id
     or v_writer.acceptance_event_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_CREATE_EVENT_WRITER_LINEAGE_MISMATCH',
      detail = pg_catalog.to_jsonb(v_writer)::text;
  end if;

  select contract_row.*
  into v_contract
  from public.sales_contracts contract_row
  where contract_row.id = v_writer.contract_id
    and contract_row.organization_id = p_organization_id
    and contract_row.store_id = p_store_id
    and contract_row.quote_id = p_quote_id
    and contract_row.quote_version_id = p_quote_version_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTRACT_CREATE_EVENT_CONTRACT_SCOPE_INVALID';
  end if;

  -- Exact semantic slot:
  -- organization + store + contrato_gerado + contract_record_created + contract_id.
  select event_row.*
  into v_existing_event
  from public.store_business_events event_row
  where event_row.organization_id = p_organization_id
    and event_row.store_id = p_store_id
    and event_row.event_key = 'contrato_gerado'
    and event_row.event_payload ->> 'stage' = 'contract_record_created'
    and event_row.event_payload ->> 'contract_id' = v_contract.id::text;

  if found then
    -- Existing legacy/current event must describe the same immutable contract
    -- lineage. commercial_opportunity_id is optional for historical rows because
    -- old contract_record_created events did not persist it.
    if v_existing_event.event_payload ->> 'quote_id'
         is distinct from p_quote_id::text
       or v_existing_event.event_payload ->> 'quote_version_id'
         is distinct from p_quote_version_id::text
       or v_existing_event.event_payload ->> 'contract_number'
         is distinct from v_contract.contract_number
       or (
         nullif(
           pg_catalog.btrim(
             coalesce(
               v_existing_event.event_payload ->> 'commercial_opportunity_id',
               ''
             )
           ),
           ''
         ) is not null
         and v_existing_event.event_payload ->> 'commercial_opportunity_id'
               is distinct from p_commercial_opportunity_id::text
       ) then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_CONTRACT_CREATE_EVENT_EXISTING_LINEAGE_CONFLICT',
        detail = pg_catalog.to_jsonb(v_existing_event)::text;
    end if;

    v_event_id := v_existing_event.id;
    v_event_outcome := 'already_exists';

  else
    select public.store_business_event_register(
      p_organization_id,
      p_store_id,
      'contrato_gerado',
      'human',
      v_contract.lead_id,
      v_contract.conversation_id,
      p_actor_user_id,
      pg_catalog.jsonb_build_object(
        'contract_id', v_contract.id,
        'contract_number', v_contract.contract_number,
        'quote_id', p_quote_id,
        'commercial_opportunity_id', p_commercial_opportunity_id,
        'quote_version_id', p_quote_version_id,
        'status', v_contract.status,
        'stage', 'contract_record_created'
      )
    )
    into v_event_id;

    if v_event_id is null then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_CONTRACT_CREATE_EVENT_REGISTER_FAILED';
    end if;

    if v_writer.outcome = 'already_exists' then
      v_event_outcome := 'reconciled';
    else
      v_event_outcome := 'created';
    end if;
  end if;

  return query
  select
    v_writer.outcome::text,
    v_contract.id,
    p_organization_id,
    p_store_id,
    p_commercial_opportunity_id,
    p_quote_id,
    p_quote_version_id,
    v_writer.acceptance_event_id,
    v_contract.contract_number,
    v_contract.status,
    v_event_id,
    v_event_outcome;
end;
$function$;


alter function public.create_sales_contract_with_current_acceptance_event_by_system(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid
)
owner to postgres;


revoke all on function public.create_sales_contract_with_current_acceptance_event_by_system(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid
)
from public, anon, authenticated, service_role;


grant execute on function public.create_sales_contract_with_current_acceptance_event_by_system(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid
)
to service_role;


comment on function public.create_sales_contract_with_current_acceptance_event_by_system(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid
) is
  'P9 6.8 service-role atomic boundary for exact accepted Current Commercial Proposal contract creation plus exactly-once contract_record_created business-event materialization/reconciliation.';


do $postconditions$
declare
  v_function oid := pg_catalog.to_regprocedure(
    'public.create_sales_contract_with_current_acceptance_event_by_system(uuid,uuid,uuid,uuid,uuid,text,uuid)'
  );

  v_index record;
  v_definition text;
begin
  if v_function is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9 6.8 event boundary postcondition failed: wrapper missing';
  end if;

  if not pg_catalog.has_function_privilege(
           'service_role',
           v_function,
           'EXECUTE'
         ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9 6.8 event boundary postcondition failed: service_role grant missing';
  end if;

  if pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'P9 6.8 event boundary postcondition failed: app role execute grant leaked';
  end if;

  select
    index_row.indexrelid,
    index_row.indisunique
  into v_index
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class class_row
    on class_row.oid = index_row.indexrelid
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = class_row.relnamespace
  where namespace_row.nspname = 'public'
    and class_row.relname =
      'store_business_events_contract_record_created_contract_uidx';

  if not found or v_index.indisunique is distinct from true then
    raise exception using
      errcode = 'P0001',
      message = 'P9 6.8 event boundary postcondition failed: unique semantic-slot index missing';
  end if;

  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(v_function),
      '\s+',
      ' ',
      'g'
    )
  )
  into v_definition;

  if v_definition not like
       '%create_sales_contract_from_current_accepted_proposal_by_system%'
     or v_definition not like '%store_business_event_register%'
     or v_definition not like '%contract_record_created%'
     or v_definition not like '%already_exists%'
     or v_definition not like '%reconciled%' then
    raise exception using
      errcode = 'P0001',
      message = 'P9 6.8 event boundary postcondition failed: required atomic/reconciliation semantics missing';
  end if;
end;
$postconditions$;

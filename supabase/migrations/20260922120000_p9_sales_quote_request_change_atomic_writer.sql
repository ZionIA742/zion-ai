-- P9 6.2: request-change must create the change request, update the quote,

-- and insert the conversation event as one atomic operation.

do $preflight$

begin

  if pg_catalog.to_regclass('public.sales_quotes') is null then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: public.sales_quotes is required';

  end if;

  if pg_catalog.to_regclass('public.sales_quote_change_requests') is null then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: public.sales_quote_change_requests is required';

  end if;

  if pg_catalog.to_regclass('public.conversation_events') is null then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: public.conversation_events is required';

  end if;

  if pg_catalog.to_regclass('public.event_state_rules') is null then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: public.event_state_rules is required';

  end if;

  if pg_catalog.to_regclass('public.conversations') is null then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: public.conversations is required';

  end if;

  if pg_catalog.to_regclass('public.leads') is null then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: public.leads is required';

  end if;

end;

$preflight$;

-- request-change is only valid after the canonical quote-event preparation
-- has placed the commercial flow in orcamento.
update public.event_state_rules
set is_allowed = true
where event_type = 'orcamento_alteracao_solicitada'
  and state = 'orcamento';

insert into public.event_state_rules (
  event_type,
  state,
  is_allowed
)
select
  'orcamento_alteracao_solicitada',
  'orcamento',
  true
where not exists (
  select 1
  from public.event_state_rules
  where event_type = 'orcamento_alteracao_solicitada'
    and state = 'orcamento'
);

create or replace function public.request_sales_quote_change_by_system(

  p_organization_id uuid,

  p_store_id uuid,

  p_quote_id uuid,

  p_conversation_id uuid,

  p_lead_id uuid,

  p_request_text text

)

returns table (

  quote_id uuid,

  change_request_id uuid,

  status text,

  event_created boolean,

  reused_existing_request boolean

)

language plpgsql

security definer

set search_path = pg_catalog, pg_temp

set row_security = off

as $function$

declare

  v_request_role text := coalesce(

    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),

    nullif(auth.jwt() ->> 'role', '')

  );

  v_request_text text := nullif(pg_catalog.btrim(coalesce(p_request_text, '')), '');

  v_quote public.sales_quotes%rowtype;

  v_conversation record;

  v_lead record;

  v_current_state text;

  v_rule_allowed boolean := false;

  v_open_total_count integer := 0;

  v_open_scoped_count integer := 0;

  v_open_change_request public.sales_quote_change_requests%rowtype;

  v_change_request_id uuid;

  v_event_count integer := 0;

  v_event_conflict_count integer := 0;

  v_inserted_events integer := 0;

  v_effective_request_text text;

  v_reused_existing_request boolean := false;

begin

  if (v_request_role is distinct from 'service_role') and session_user <> 'postgres' then

    raise exception using

      errcode = '42501',

      message = 'sales quote request-change atomic writer is not authorized';

  end if;

  if p_organization_id is null

     or p_store_id is null

     or p_quote_id is null

     or p_conversation_id is null

     or p_lead_id is null

     or v_request_text is null then

    raise exception using

      errcode = '22023',

      message = 'ZION_SALES_QUOTE_REQUEST_CHANGE_ARGUMENTS_INVALID';

  end if;

  select quote_row.*

  into v_quote

  from public.sales_quotes quote_row

  where quote_row.id = p_quote_id

    and quote_row.organization_id = p_organization_id

    and quote_row.store_id = p_store_id

  for update;

  if not found then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_SALES_QUOTE_REQUEST_CHANGE_QUOTE_NOT_FOUND';

  end if;

  if v_quote.conversation_id is distinct from p_conversation_id

     or v_quote.lead_id is distinct from p_lead_id then

    raise exception using

      errcode = '23514',

      message = 'ZION_SALES_QUOTE_REQUEST_CHANGE_SCOPE_MISMATCH';

  end if;

  select conversation_row.id, conversation_row.organization_id, conversation_row.lead_id

  into v_conversation

  from public.conversations conversation_row

  where conversation_row.id = p_conversation_id

    and conversation_row.organization_id = p_organization_id;

  if not found

     or v_conversation.lead_id is distinct from p_lead_id then

    raise exception using

      errcode = '23514',

      message = 'ZION_SALES_QUOTE_REQUEST_CHANGE_SCOPE_MISMATCH';

  end if;

  select lead_row.id, lead_row.organization_id, lead_row.store_id, lead_row.state

  into v_lead

  from public.leads lead_row

  where lead_row.id = p_lead_id

    and lead_row.organization_id = p_organization_id;

  if not found

     or (v_lead.store_id is not null and v_lead.store_id is distinct from p_store_id) then

    raise exception using

      errcode = '23514',

      message = 'ZION_SALES_QUOTE_REQUEST_CHANGE_SCOPE_MISMATCH';

  end if;

  v_current_state := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(v_lead.state, ''))), '');

  if v_current_state is null then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_QUOTE_EVENT_NOT_ALLOWED';

  end if;

  select rule_row.is_allowed

  into v_rule_allowed

  from public.event_state_rules rule_row

  where rule_row.event_type = 'orcamento_alteracao_solicitada'

    and rule_row.state = v_current_state;

  if coalesce(v_rule_allowed, false) is not true then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_QUOTE_EVENT_NOT_ALLOWED';

  end if;

  select pg_catalog.count(*)::integer

  into v_open_total_count

  from public.sales_quote_change_requests change_request_row

  where change_request_row.quote_id = p_quote_id

    and pg_catalog.lower(pg_catalog.btrim(coalesce(change_request_row.status, ''))) = 'open';

  select pg_catalog.count(*)::integer

  into v_open_scoped_count

  from public.sales_quote_change_requests change_request_row

  where change_request_row.quote_id = p_quote_id

    and change_request_row.organization_id = p_organization_id

    and change_request_row.store_id = p_store_id

    and pg_catalog.lower(pg_catalog.btrim(coalesce(change_request_row.status, ''))) = 'open';

  if v_open_total_count <> v_open_scoped_count

     or v_open_scoped_count > 1 then

    raise exception using

      errcode = '23505',

      message = 'ZION_SALES_QUOTE_CHANGE_REQUEST_INCONSISTENT_OPEN';

  end if;

  if v_open_scoped_count = 1 then

    select change_request_row.*

    into v_open_change_request

    from public.sales_quote_change_requests change_request_row

    where change_request_row.quote_id = p_quote_id

      and change_request_row.organization_id = p_organization_id

      and change_request_row.store_id = p_store_id

      and pg_catalog.lower(pg_catalog.btrim(coalesce(change_request_row.status, ''))) = 'open'

    for update;

    if not found

       or pg_catalog.lower(pg_catalog.btrim(coalesce(v_quote.status, ''))) <> 'changes_requested'

       or v_quote.last_change_request_id is distinct from v_open_change_request.id then

      raise exception using

        errcode = '23505',

        message = 'ZION_SALES_QUOTE_CHANGE_REQUEST_INCONSISTENT_OPEN';

    end if;

    v_change_request_id := v_open_change_request.id;

    v_effective_request_text := v_open_change_request.request_text;

    v_reused_existing_request := true;

  else

    insert into public.sales_quote_change_requests (

      quote_id,

      organization_id,

      store_id,

      status,

      requested_by,

      request_text

    )

    values (

      p_quote_id,

      p_organization_id,

      p_store_id,

      'open',

      'human',

      v_request_text

    )

    returning id, request_text into v_change_request_id, v_effective_request_text;

    update public.sales_quotes quote_row

    set status = 'changes_requested',

        last_change_request_id = v_change_request_id,

        updated_at = pg_catalog.clock_timestamp()

    where quote_row.id = p_quote_id

      and quote_row.organization_id = p_organization_id

      and quote_row.store_id = p_store_id

    returning quote_row.* into v_quote;

    if not found

       or v_quote.status is distinct from 'changes_requested'

       or v_quote.last_change_request_id is distinct from v_change_request_id then

      raise exception using

        errcode = 'P0001',

        message = 'ZION_SALES_QUOTE_REQUEST_CHANGE_QUOTE_UPDATE_FAILED';

    end if;

  end if;

  select pg_catalog.count(*)::integer

  into v_event_conflict_count

  from public.conversation_events event_row

  where event_row.event_type = 'orcamento_alteracao_solicitada'

    and coalesce(event_row.payload ->> 'change_request_id', '') = v_change_request_id::text

    and (

      event_row.organization_id is distinct from p_organization_id

      or event_row.conversation_id is distinct from p_conversation_id

      or coalesce(event_row.payload ->> 'quote_id', '') <> p_quote_id::text

    );

  if v_event_conflict_count > 0 then

    raise exception using

      errcode = '23505',

      message = 'ZION_SALES_QUOTE_CHANGE_REQUEST_INCONSISTENT_OPEN';

  end if;

  select pg_catalog.count(*)::integer

  into v_event_count

  from public.conversation_events event_row

  where event_row.organization_id = p_organization_id

    and event_row.conversation_id = p_conversation_id

    and event_row.event_type = 'orcamento_alteracao_solicitada'

    and coalesce(event_row.payload ->> 'quote_id', '') = p_quote_id::text

    and coalesce(event_row.payload ->> 'change_request_id', '') = v_change_request_id::text;

  if v_event_count > 1 then

    raise exception using

      errcode = '23505',

      message = 'ZION_SALES_QUOTE_CHANGE_REQUEST_INCONSISTENT_OPEN';

  end if;

  if v_event_count = 0 then

    insert into public.conversation_events (

      conversation_id,

      organization_id,

      event_type,

      payload,

      created_by

    )

    values (

      p_conversation_id,

      p_organization_id,

      'orcamento_alteracao_solicitada',

      pg_catalog.jsonb_build_object(

        'quote_id', p_quote_id,

        'change_request_id', v_change_request_id,

        'quote_number', v_quote.quote_number,

        'status', 'changes_requested',

        'current_version_id', v_quote.current_version_id,

        'request_text', v_effective_request_text

      ),

      'human'

    );

    get diagnostics v_inserted_events = row_count;

    if v_inserted_events <> 1 then

      raise exception using

        errcode = 'P0001',

        message = 'ZION_SALES_QUOTE_REQUEST_CHANGE_EVENT_INSERT_FAILED';

    end if;

  end if;

  if v_event_count = 0 then

    v_event_count := v_inserted_events;

  end if;

  quote_id := p_quote_id;

  change_request_id := v_change_request_id;

  status := 'changes_requested';

  event_created := v_inserted_events = 1;

  reused_existing_request := v_reused_existing_request;

  return next;

end;

$function$;

alter function public.request_sales_quote_change_by_system(

  uuid, uuid, uuid, uuid, uuid, text

) owner to postgres;

comment on function public.request_sales_quote_change_by_system(

  uuid, uuid, uuid, uuid, uuid, text

) is

  'P9 6.2 writer: atomically creates or safely reuses a coherent open sales quote change request, marks the quote changes_requested, stores last_change_request_id, and records or recovers the canonical conversation event after event_state_rules validation.';

revoke all on function public.request_sales_quote_change_by_system(

  uuid, uuid, uuid, uuid, uuid, text

) from public, anon, authenticated, service_role;

grant execute on function public.request_sales_quote_change_by_system(

  uuid, uuid, uuid, uuid, uuid, text

) to service_role;

do $postcondition$

declare

  v_proc_oid oid := pg_catalog.to_regprocedure(

    'public.request_sales_quote_change_by_system(uuid,uuid,uuid,uuid,uuid,text)'

  );

  v_definition text;

  v_normalized_definition text;

begin

  if (
    select pg_catalog.count(*)
    from public.event_state_rules rule_row
    where rule_row.event_type = 'orcamento_alteracao_solicitada'
      and rule_row.state = 'orcamento'
      and rule_row.is_allowed = true
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: request-change event_state_rules missing or duplicated';
  end if;

  if v_proc_oid is null then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: request-change atomic writer missing';

  end if;

  select pg_catalog.pg_get_functiondef(v_proc_oid)

  into v_definition;

  v_normalized_definition := lower(regexp_replace(coalesce(v_definition, ''), '\s+', ' ', 'g'));

  if v_normalized_definition not like '%for update%'
     or v_normalized_definition not like '%from public.sales_quotes%'
     or v_normalized_definition not like '%sales_quote_change_requests%'
     or v_normalized_definition not like '%conversation_events%'
     or v_normalized_definition not like '%event_state_rules%'
     or v_normalized_definition not like '%orcamento_alteracao_solicitada%'
     or v_normalized_definition not like '%reused_existing_request%'
     or v_normalized_definition not like '%zion_sales_quote_change_request_inconsistent_open%'
     or v_normalized_definition like '%update public.leads%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: request-change atomic writer definition mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    cross join lateral pg_catalog.unnest(
      coalesce(proc_row.proconfig, array[]::text[])
    ) config_row(config_value)
    where proc_row.oid = v_proc_oid
      and pg_catalog.lower(
        pg_catalog.replace(config_row.config_value, ' ', '')
      ) = 'search_path=pg_catalog,pg_temp'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: request-change atomic writer search_path mismatch';
  end if;

  if pg_catalog.pg_get_userbyid((select proc_row.proowner from pg_catalog.pg_proc proc_row where proc_row.oid = v_proc_oid)) <> 'postgres' then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: request-change atomic writer owner mismatch';

  end if;

  if exists (

    select 1

    from pg_catalog.pg_proc proc_row

    cross join lateral pg_catalog.aclexplode(

      coalesce(proc_row.proacl, pg_catalog.acldefault('f', proc_row.proowner))

    ) privilege_row

    where proc_row.oid = v_proc_oid

      and privilege_row.grantee = 0

      and privilege_row.privilege_type = 'EXECUTE'

  ) or pg_catalog.has_function_privilege('anon', v_proc_oid, 'EXECUTE')

     or pg_catalog.has_function_privilege('authenticated', v_proc_oid, 'EXECUTE')

     or not pg_catalog.has_function_privilege('service_role', v_proc_oid, 'EXECUTE') then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: request-change atomic writer grants mismatch';

  end if;

end;

$postcondition$;

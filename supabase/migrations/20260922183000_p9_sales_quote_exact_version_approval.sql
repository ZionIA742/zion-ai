-- P9 6.5: exact quote_id + quote_version_id approval.

-- Human approval is atomic, stale-aware, idempotent, and records the

-- canonical approval event in the same transaction.



do $preflight$

begin

  if pg_catalog.to_regclass('public.sales_quotes') is null then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: public.sales_quotes is required';

  end if;



  if pg_catalog.to_regclass('public.sales_quote_versions') is null then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: public.sales_quote_versions is required';

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



  if pg_catalog.to_regprocedure(

    'public.sales_quote_version_is_expired(jsonb,date,date)'

  ) is null then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: public.sales_quote_version_is_expired(jsonb,date,date) is required';

  end if;



  if pg_catalog.to_regprocedure(

    'public.create_sales_quote_version_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text,text,text,integer,jsonb)'

  ) is null then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: public.create_sales_quote_version_by_system(...) is required';

  end if;

end;

$preflight$;



update public.event_state_rules

   set is_allowed = true

 where event_type = 'orcamento_aprovado'

   and state = 'orcamento';



insert into public.event_state_rules (

  event_type,

  state,

  is_allowed

)

select

  'orcamento_aprovado',

  'orcamento',

  true

where not exists (

  select 1

    from public.event_state_rules

   where event_type = 'orcamento_aprovado'

     and state = 'orcamento'

);



create or replace function public.create_sales_quote_version_by_system(

  p_organization_id uuid,

  p_store_id uuid,

  p_quote_id uuid,

  p_version_status text,

  p_next_quote_status text,

  p_quote_kind text,

  p_store_file_id uuid,

  p_storage_bucket text,

  p_storage_path text,

  p_original_filename text,

  p_mime_type text,

  p_size_bytes integer,

  p_quote_snapshot jsonb

)

returns table (

  id uuid,

  quote_id uuid,

  organization_id uuid,

  store_id uuid,

  version_number integer,

  status text,

  quote_kind text,

  store_file_id uuid,

  storage_bucket text,

  storage_path text,

  original_filename text,

  mime_type text,

  size_bytes integer,

  quote_snapshot jsonb,

  created_at timestamptz,

  sent_at timestamptz

)

language plpgsql

security definer

set search_path = pg_catalog, public, pg_temp

set row_security = off

as $function$

declare

  v_request_role text := coalesce(

    nullif(current_setting('request.jwt.claim.role', true), ''),

    nullif(auth.jwt() ->> 'role', '')

  );

  v_quote public.sales_quotes%rowtype;

  v_previous_version_id uuid;

  v_version public.sales_quote_versions%rowtype;

  v_next_version_number integer;

  v_updated_count integer;

begin

  if (v_request_role is distinct from 'service_role') and session_user <> 'postgres' then

    raise exception using

      errcode = '42501',

      message = 'sales quote version writer is not authorized';

  end if;



  p_version_status := pg_catalog.lower(pg_catalog.btrim(coalesce(p_version_status, '')));

  p_next_quote_status := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_next_quote_status, ''))), '');

  p_quote_kind := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_quote_kind, ''))), '');

  p_storage_bucket := nullif(pg_catalog.btrim(coalesce(p_storage_bucket, '')), '');

  p_storage_path := nullif(pg_catalog.btrim(coalesce(p_storage_path, '')), '');

  p_original_filename := nullif(pg_catalog.btrim(coalesce(p_original_filename, '')), '');

  p_mime_type := nullif(pg_catalog.btrim(coalesce(p_mime_type, '')), '');



  if p_organization_id is null

     or p_store_id is null

     or p_quote_id is null

     or p_version_status not in ('generated', 'failed')

     or p_quote_snapshot is null

     or pg_catalog.jsonb_typeof(p_quote_snapshot) is distinct from 'object'

     or (p_quote_kind is not null and p_quote_kind not in ('preliminary', 'definitive')) then

    raise exception using

      errcode = '22023',

      message = 'ZION_SALES_QUOTE_VERSION_ARGUMENTS_INVALID';

  end if;



  if p_version_status = 'generated' then

    if p_next_quote_status is null

       or p_next_quote_status not in (

         'draft',

         'pending_review',

         'sent',

         'approved',

         'changes_requested',

         'failed'

       )

       or p_store_file_id is null

       or p_storage_bucket is null

       or p_storage_path is null

       or p_original_filename is null

       or p_mime_type is distinct from 'application/pdf'

       or p_size_bytes is null

       or p_size_bytes <= 0 then

      raise exception using

        errcode = '22023',

        message = 'ZION_SALES_QUOTE_VERSION_GENERATED_ARGUMENTS_INVALID';

    end if;

  else

    if p_next_quote_status is not null

       or p_store_file_id is not null

       or p_storage_bucket is not null

       or p_storage_path is not null

       or p_original_filename is not null

       or p_mime_type is not null

       or p_size_bytes is not null

       or p_quote_kind is not null then

      raise exception using

        errcode = '22023',

        message = 'ZION_SALES_QUOTE_VERSION_FAILED_ARGUMENTS_INVALID';

    end if;

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

      message = 'ZION_SALES_QUOTE_VERSION_QUOTE_NOT_FOUND';

  end if;



  if pg_catalog.lower(pg_catalog.btrim(coalesce(v_quote.status, ''))) = 'sent' then

    raise exception using

      errcode = '23514',

      message = 'ZION_SALES_QUOTE_VERSION_QUOTE_SENT_IMMUTABLE';

  end if;



  v_previous_version_id := v_quote.current_version_id;



  select coalesce(pg_catalog.max(version_row.version_number), 0) + 1

    into v_next_version_number

    from public.sales_quote_versions version_row

   where version_row.quote_id = p_quote_id

     and version_row.organization_id = p_organization_id

     and version_row.store_id = p_store_id;



  insert into public.sales_quote_versions (

    quote_id,

    organization_id,

    store_id,

    version_number,

    status,

    quote_kind,

    store_file_id,

    storage_bucket,

    storage_path,

    original_filename,

    mime_type,

    size_bytes,

    quote_snapshot

  )

  values (

    p_quote_id,

    p_organization_id,

    p_store_id,

    v_next_version_number,

    p_version_status,

    p_quote_kind,

    p_store_file_id,

    coalesce(p_storage_bucket, 'zion-store-files'),

    p_storage_path,

    p_original_filename,

    coalesce(p_mime_type, 'application/pdf'),

    p_size_bytes,

    p_quote_snapshot

  )

  returning * into v_version;



  if p_version_status = 'generated' then

    if v_previous_version_id is not null then

      update public.sales_quote_versions version_row

         set status = 'superseded'

       where version_row.id = v_previous_version_id

         and version_row.quote_id = p_quote_id

         and version_row.organization_id = p_organization_id

         and version_row.store_id = p_store_id;



      get diagnostics v_updated_count = row_count;

      if v_updated_count <> 1 then

        raise exception using

          errcode = 'P0001',

          message = 'ZION_SALES_QUOTE_VERSION_CURRENT_POINTER_INVALID';

      end if;

    end if;



    update public.sales_quotes quote_row

       set current_version_id = v_version.id,

           status = p_next_quote_status,

           approved_at = null,

           approved_by = null,

           updated_at = pg_catalog.clock_timestamp()

     where quote_row.id = p_quote_id

       and quote_row.organization_id = p_organization_id

       and quote_row.store_id = p_store_id;



    get diagnostics v_updated_count = row_count;

    if v_updated_count <> 1 then

      raise exception using

        errcode = 'P0001',

        message = 'ZION_SALES_QUOTE_VERSION_QUOTE_UPDATE_FAILED';

    end if;

  end if;



  id := v_version.id;

  quote_id := v_version.quote_id;

  organization_id := v_version.organization_id;

  store_id := v_version.store_id;

  version_number := v_version.version_number;

  status := v_version.status;

  quote_kind := v_version.quote_kind;

  store_file_id := v_version.store_file_id;

  storage_bucket := v_version.storage_bucket;

  storage_path := v_version.storage_path;

  original_filename := v_version.original_filename;

  mime_type := v_version.mime_type;

  size_bytes := v_version.size_bytes;

  quote_snapshot := v_version.quote_snapshot;

  created_at := v_version.created_at;

  sent_at := v_version.sent_at;

  return next;

end;

$function$;



alter function public.create_sales_quote_version_by_system(

  uuid, uuid, uuid, text, text, text, uuid, text, text, text, text, integer, jsonb

) owner to postgres;



comment on function public.create_sales_quote_version_by_system(

  uuid, uuid, uuid, text, text, text, uuid, text, text, text, text, integer, jsonb

) is

  'Creates generated or failed sales quote versions atomically. Generated versions advance current_version_id and invalidate any prior quote approval audit so the new version requires human approval.';



drop function if exists public.approve_sales_quote_version_by_system(

  uuid, uuid, uuid, uuid

);



drop function if exists public.approve_sales_quote_version_by_system(

  uuid, uuid, uuid, uuid, uuid

);



create function public.approve_sales_quote_version_by_system(

  p_organization_id uuid,

  p_store_id uuid,

  p_quote_id uuid,

  p_sales_quote_version_id uuid,

  p_approved_by uuid

)

returns table (

  id uuid,

  quote_id uuid,

  organization_id uuid,

  store_id uuid,

  version_number integer,

  status text,

  quote_kind text,

  store_file_id uuid,

  storage_bucket text,

  storage_path text,

  original_filename text,

  mime_type text,

  size_bytes integer,

  quote_snapshot jsonb,

  created_at timestamptz,

  sent_at timestamptz

)

language plpgsql

security definer

set search_path = pg_catalog, public, pg_temp

set row_security = off

as $function$

declare

  v_request_role text := coalesce(

    nullif(current_setting('request.jwt.claim.role', true), ''),

    nullif(auth.jwt() ->> 'role', '')

  );

  v_quote public.sales_quotes%rowtype;

  v_version public.sales_quote_versions%rowtype;

  v_conversation public.conversations%rowtype;

  v_lead record;

  v_current_state text;

  v_rule_allowed boolean;

  v_event_count integer;

  v_event_conflict_count integer;

  v_inserted_events integer := 0;

  v_now timestamptz := clock_timestamp();

begin

  if (v_request_role is distinct from 'service_role') and session_user <> 'postgres' then

    raise exception using

      errcode = '42501',

      message = 'sales quote version approval writer is not authorized';

  end if;



  if p_organization_id is null

     or p_store_id is null

     or p_quote_id is null

     or p_sales_quote_version_id is null

     or p_approved_by is null then

    raise exception using

      errcode = '22023',

      message = 'ZION_SALES_QUOTE_VERSION_APPROVAL_ARGUMENTS_INVALID';

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

      message = 'ZION_SALES_QUOTE_VERSION_APPROVAL_QUOTE_NOT_FOUND';

  end if;



  if v_quote.current_version_id is distinct from p_sales_quote_version_id then

    raise exception using

      errcode = '23514',

      message = 'ZION_SALES_QUOTE_VERSION_APPROVAL_REQUIRES_CURRENT_VERSION';

  end if;



  select version_row.*

    into v_version

    from public.sales_quote_versions version_row

   where version_row.id = p_sales_quote_version_id

     and version_row.organization_id = p_organization_id

     and version_row.store_id = p_store_id

   for update;



  if not found then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_SALES_QUOTE_VERSION_APPROVAL_VERSION_NOT_FOUND';

  end if;



  if v_version.quote_id is distinct from p_quote_id then

    raise exception using

      errcode = '23514',

      message = 'ZION_SALES_QUOTE_VERSION_APPROVAL_VERSION_QUOTE_MISMATCH';

  end if;



  if pg_catalog.lower(pg_catalog.btrim(coalesce(v_quote.status, ''))) not in (

    'pending_review',

    'approved'

  ) then

    raise exception using

      errcode = '23514',

      message = 'ZION_SALES_QUOTE_APPROVAL_QUOTE_STATUS_INVALID';

  end if;



  if public.sales_quote_version_is_expired(

    v_version.quote_snapshot,

    v_quote.valid_until,

    (now() at time zone 'UTC')::date

  ) then

    raise exception using

      errcode = '23514',

      message = 'ZION_SALES_QUOTE_VERSION_EXPIRED';

  end if;



  if v_version.sent_at is not null

     or pg_catalog.lower(pg_catalog.btrim(coalesce(v_version.status, ''))) in (

       'sent',

       'superseded',

       'failed'

     ) then

    raise exception using

      errcode = '23514',

      message = 'ZION_SALES_QUOTE_VERSION_APPROVAL_STATUS_INVALID';

  end if;



  if pg_catalog.lower(pg_catalog.btrim(coalesce(v_version.status, ''))) not in (

    'generated',

    'pending_review',

    'approved'

  ) then

    raise exception using

      errcode = '23514',

      message = 'ZION_SALES_QUOTE_VERSION_APPROVAL_STATUS_INVALID';

  end if;



  if v_quote.conversation_id is null or v_quote.lead_id is null then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_SALES_QUOTE_APPROVAL_EVENT_CONTEXT_REQUIRED';

  end if;



  select conversation_row.*

    into v_conversation

    from public.conversations conversation_row

   where conversation_row.id = v_quote.conversation_id

     and conversation_row.organization_id = p_organization_id;



  if not found

     or v_conversation.lead_id is distinct from v_quote.lead_id then

    raise exception using

      errcode = '23514',

      message = 'ZION_SALES_QUOTE_APPROVAL_SCOPE_MISMATCH';

  end if;



  select lead_row.id, lead_row.organization_id, lead_row.store_id

    into v_lead

    from public.leads lead_row

   where lead_row.id = v_quote.lead_id

     and lead_row.organization_id = p_organization_id;



  if not found

     or (v_lead.store_id is not null and v_lead.store_id is distinct from p_store_id) then

    raise exception using

      errcode = '23514',

      message = 'ZION_SALES_QUOTE_APPROVAL_SCOPE_MISMATCH';

  end if;



  select nullif(

           pg_catalog.lower(

             pg_catalog.btrim(coalesce(state_row.state, ''))

           ),

           ''

         )

    into v_current_state

    from public.conversation_states state_row

   where state_row.conversation_id = v_quote.conversation_id

     and state_row.organization_id = p_organization_id;



  if not found or v_current_state is null then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_QUOTE_APPROVAL_EVENT_NOT_ALLOWED';

  end if;



  select rule_row.is_allowed

    into v_rule_allowed

    from public.event_state_rules rule_row

   where rule_row.event_type = 'orcamento_aprovado'

     and rule_row.state = v_current_state;



  if coalesce(v_rule_allowed, false) is not true then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_QUOTE_APPROVAL_EVENT_NOT_ALLOWED';

  end if;



  if v_version.status is distinct from 'approved' then

    update public.sales_quote_versions version_row

       set status = 'approved'

     where version_row.id = p_sales_quote_version_id

       and version_row.quote_id = p_quote_id

       and version_row.organization_id = p_organization_id

       and version_row.store_id = p_store_id

    returning * into v_version;

  end if;



  if pg_catalog.lower(pg_catalog.btrim(coalesce(v_quote.status, ''))) <> 'approved'

     or v_quote.approved_at is null

     or v_quote.approved_by is null then

    update public.sales_quotes quote_row

       set status = 'approved',

           approved_at = coalesce(quote_row.approved_at, v_now),

           approved_by = coalesce(quote_row.approved_by, p_approved_by),

           updated_at = v_now

     where quote_row.id = p_quote_id

       and quote_row.organization_id = p_organization_id

       and quote_row.store_id = p_store_id

    returning quote_row.* into v_quote;



    if not found

       or pg_catalog.lower(pg_catalog.btrim(coalesce(v_quote.status, ''))) <> 'approved'

       or v_quote.approved_at is null

       or v_quote.approved_by is null then

      raise exception using

        errcode = 'P0001',

        message = 'ZION_SALES_QUOTE_APPROVAL_QUOTE_UPDATE_FAILED';

    end if;

  end if;



  select pg_catalog.count(*)::integer

    into v_event_conflict_count

    from public.conversation_events event_row

   where event_row.event_type = 'orcamento_aprovado'

     and coalesce(event_row.payload ->> 'quote_id', '') = p_quote_id::text

     and coalesce(event_row.payload ->> 'version_id', '') = p_sales_quote_version_id::text

     and (

       event_row.organization_id is distinct from p_organization_id

       or event_row.conversation_id is distinct from v_quote.conversation_id

     );



  if v_event_conflict_count > 0 then

    raise exception using

      errcode = '23505',

      message = 'ZION_SALES_QUOTE_APPROVAL_EVENT_INCONSISTENT';

  end if;



  select pg_catalog.count(*)::integer

    into v_event_count

    from public.conversation_events event_row

   where event_row.organization_id = p_organization_id

     and event_row.conversation_id = v_quote.conversation_id

     and event_row.event_type = 'orcamento_aprovado'

     and coalesce(event_row.payload ->> 'quote_id', '') = p_quote_id::text

     and coalesce(event_row.payload ->> 'version_id', '') = p_sales_quote_version_id::text;



  if v_event_count > 1 then

    raise exception using

      errcode = '23505',

      message = 'ZION_SALES_QUOTE_APPROVAL_EVENT_INCONSISTENT';

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

      v_quote.conversation_id,

      p_organization_id,

      'orcamento_aprovado',

      pg_catalog.jsonb_build_object(

        'quote_id', p_quote_id,

        'version_id', p_sales_quote_version_id,

        'quote_number', v_quote.quote_number,

        'total_cents', v_quote.total_cents,

        'status', 'approved',

        'approved_at', v_quote.approved_at,

        'approved_by', v_quote.approved_by

      ),

      'human'

    );



    get diagnostics v_inserted_events = row_count;

    if v_inserted_events <> 1 then

      raise exception using

        errcode = 'P0001',

        message = 'ZION_SALES_QUOTE_APPROVAL_EVENT_INSERT_FAILED';

    end if;

  end if;



  id := v_version.id;

  quote_id := v_version.quote_id;

  organization_id := v_version.organization_id;

  store_id := v_version.store_id;

  version_number := v_version.version_number;

  status := v_version.status;

  quote_kind := v_version.quote_kind;

  store_file_id := v_version.store_file_id;

  storage_bucket := v_version.storage_bucket;

  storage_path := v_version.storage_path;

  original_filename := v_version.original_filename;

  mime_type := v_version.mime_type;

  size_bytes := v_version.size_bytes;

  quote_snapshot := v_version.quote_snapshot;

  created_at := v_version.created_at;

  sent_at := v_version.sent_at;

  return next;

end;

$function$;



alter function public.approve_sales_quote_version_by_system(

  uuid, uuid, uuid, uuid, uuid

) owner to postgres;



comment on function public.approve_sales_quote_version_by_system(

  uuid, uuid, uuid, uuid, uuid

) is

  'P9 6.5 writer: approves the exact current sales quote version, updates sales_quotes audit fields, and records one canonical approval event atomically.';



revoke all on function public.approve_sales_quote_version_by_system(

  uuid, uuid, uuid, uuid, uuid

) from public;

revoke all on function public.approve_sales_quote_version_by_system(

  uuid, uuid, uuid, uuid, uuid

) from anon;

revoke all on function public.approve_sales_quote_version_by_system(

  uuid, uuid, uuid, uuid, uuid

) from authenticated;

revoke all on function public.approve_sales_quote_version_by_system(

  uuid, uuid, uuid, uuid, uuid

) from service_role;



grant execute on function public.approve_sales_quote_version_by_system(

  uuid, uuid, uuid, uuid, uuid

) to service_role;



do $postconditions$

declare

  v_definition text;

  v_create_definition text;

begin

  if pg_catalog.to_regprocedure(

    'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid)'

  ) is not null then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: old 4-argument approval writer still exists';

  end if;



  select pg_get_functiondef(

    'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid,uuid)'::regprocedure

  )

    into v_definition;



  if v_definition is null

     or v_definition not like '%for update%'

     or v_definition not like '%current_version_id is distinct from p_sales_quote_version_id%'

     or v_definition not like '%conversation_events%'

     or v_definition not like '%conversation_states%'

     or v_definition not like '%event_state_rules%'

     or v_definition not like '%sales_quote_version_is_expired%' then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: approval writer body is missing required 6.5 contracts';

  end if;



  select pg_get_functiondef(

    'public.create_sales_quote_version_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text,text,text,integer,jsonb)'::regprocedure

  )

    into v_create_definition;



  if v_create_definition is null

     or v_create_definition not ilike '%approved_at = null%'

     or v_create_definition not ilike '%approved_by = null%'

     or v_create_definition not ilike '%ZION_SALES_QUOTE_VERSION_QUOTE_SENT_IMMUTABLE%' then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: create_sales_quote_version_by_system does not invalidate prior approval atomically';

  end if;



  if has_function_privilege(

       'public',

       'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid,uuid)',

       'execute'

     )

     or has_function_privilege(

       'anon',

       'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid,uuid)',

       'execute'

     )

     or has_function_privilege(

       'authenticated',

       'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid,uuid)',

       'execute'

     )

     or not has_function_privilege(

       'service_role',

       'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid,uuid)',

       'execute'

     ) then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: approval writer grants must be service-role only';

  end if;

end;

$postconditions$;

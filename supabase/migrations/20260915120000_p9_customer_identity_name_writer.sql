begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:customer-identity-name-writer:v1', 0)
);

do $preflight$
begin
  if pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.customers') is null
     or pg_catalog.to_regclass('public.customer_store_links') is null
     or pg_catalog.to_regclass('public.lead_customer_links') is null
     or pg_catalog.to_regclass('public.conversations') is null
     or pg_catalog.to_regclass('public.messages') is null then
    raise exception using
      errcode = 'P0001',
      message = 'customer identity name writer prerequisites are missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.write_customer_identity_name_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'public.apply_customer_identity_name_internal(uuid,uuid,uuid,uuid,uuid,text,text,text)'
     ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'customer identity name writer collision detected';
  end if;
end;
$preflight$;

create table public.customer_identity_name_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  lead_id uuid not null,
  customer_id uuid not null,
  conversation_id uuid not null,
  source_message_id uuid not null,
  operation_key text not null,
  proposed_display_name text not null,
  proposed_normalized_name text not null,
  previous_lead_name text null,
  previous_customer_display_name text null,
  outcome text not null,
  changed boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default clock_timestamp(),

  constraint customer_identity_name_events_scope_fkey
    foreign key (lead_id, organization_id, store_id)
    references public.leads(id, organization_id, store_id)
    on delete restrict,

  constraint customer_identity_name_events_customer_fkey
    foreign key (customer_id, organization_id)
    references public.customers(id, organization_id)
    on delete restrict,

  constraint customer_identity_name_events_customer_store_fkey
    foreign key (customer_id, organization_id, store_id)
    references public.customer_store_links(customer_id, organization_id, store_id)
    on delete restrict,

  constraint customer_identity_name_events_outcome_check
    check (
      outcome in (
        'updated',
        'completed_existing_match',
        'reaffirmed',
        'idempotent_replay',
        'conflict_existing_name',
        'identity_scope_conflict'
      )
    ),

  constraint customer_identity_name_events_operation_key_not_blank
    check (pg_catalog.length(pg_catalog.btrim(operation_key)) > 0),

  constraint customer_identity_name_events_name_not_blank
    check (
      pg_catalog.length(pg_catalog.btrim(proposed_display_name)) > 0
      and pg_catalog.length(pg_catalog.btrim(proposed_normalized_name)) > 0
    ),

  constraint customer_identity_name_events_created_by_not_blank
    check (pg_catalog.length(pg_catalog.btrim(created_by)) > 0)
);

alter table public.customer_identity_name_events owner to postgres;
alter table public.customer_identity_name_events enable row level security;

create unique index customer_identity_name_events_org_operation_uidx
  on public.customer_identity_name_events (organization_id, operation_key);

create index customer_identity_name_events_lead_idx
  on public.customer_identity_name_events (organization_id, store_id, lead_id, created_at desc);

revoke all on table public.customer_identity_name_events from public, anon, authenticated, service_role;

create or replace function public.normalize_customer_identity_name_for_system(p_name text)
returns text
language sql
immutable
as $function$
  select nullif(
    pg_catalog.lower(
      pg_catalog.regexp_replace(
        normalize(pg_catalog.btrim(coalesce(p_name, '')), NFC),
        '[[:space:]]+',
        ' ',
        'g'
      )
    ),
    ''
  );
$function$;

alter function public.normalize_customer_identity_name_for_system(text) owner to postgres;
revoke all on function public.normalize_customer_identity_name_for_system(text)
  from public, anon, authenticated, service_role;

create or replace function public.is_customer_identity_placeholder_name(p_name text)
returns boolean
language sql
immutable
as $function$
  select public.normalize_customer_identity_name_for_system(p_name) = 'cliente whatsapp';
$function$;

alter function public.is_customer_identity_placeholder_name(text) owner to postgres;
revoke all on function public.is_customer_identity_placeholder_name(text)
  from public, anon, authenticated, service_role;

create or replace function public.apply_customer_identity_name_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_lead_id uuid,
  p_conversation_id uuid,
  p_source_message_id uuid,
  p_operation_key text,
  p_display_name text,
  p_created_by text
)
returns table (
  lead_id uuid,
  customer_id uuid,
  display_name text,
  normalized_name text,
  changed boolean,
  outcome text,
  event_id uuid,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_operation_key text := nullif(pg_catalog.btrim(coalesce(p_operation_key, '')), '');
  v_display_name text := nullif(
    normalize(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_display_name, '')), '[[:space:]]+', ' ', 'g'), NFC),
    ''
  );
  v_normalized_name text;
  v_created_by text := nullif(pg_catalog.btrim(coalesce(p_created_by, '')), '');
  v_lead public.leads;
  v_customer public.customers;
  v_link public.lead_customer_links;
  v_existing_event public.customer_identity_name_events;
  v_event public.customer_identity_name_events;
  v_link_count integer;
  v_message_sender text;
  v_message_direction text;
  v_message_conversation_id uuid;
  v_lead_norm text;
  v_customer_norm text;
  v_customer_stored_norm text;
  v_lead_is_empty_or_placeholder boolean;
  v_customer_is_empty_or_placeholder boolean;
  v_outcome text;
  v_changed boolean := false;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_lead_id is null
     or p_conversation_id is null
     or p_source_message_id is null
     or v_operation_key is null
     or v_display_name is null
     or v_created_by is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_IDENTITY_NAME_ARGUMENTS_REQUIRED';
  end if;

  if pg_catalog.length(v_operation_key) > 200 then
    raise exception using
      errcode = '22023',
      message = 'ZION_IDENTITY_NAME_OPERATION_KEY_INVALID';
  end if;

  if pg_catalog.length(v_display_name) < 2
     or pg_catalog.length(v_display_name) > 80
     or v_display_name !~ '^[A-Za-zÀ-ÖØ-öø-ÿĀ-ž][A-Za-zÀ-ÖØ-öø-ÿĀ-ž'' -]*$' then
    raise exception using
      errcode = '22023',
      message = 'ZION_IDENTITY_NAME_VALUE_INVALID';
  end if;

  if pg_catalog.length(v_created_by) > 120
     or v_created_by !~ '^[a-z0-9_:.\/-]+$' then
    raise exception using
      errcode = '22023',
      message = 'ZION_IDENTITY_NAME_CREATED_BY_INVALID';
  end if;

  v_normalized_name := public.normalize_customer_identity_name_for_system(v_display_name);

  if v_normalized_name is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_IDENTITY_NAME_VALUE_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'zion:p9:identity-name:'
      || p_organization_id::text
      || ':' || p_store_id::text
      || ':' || p_lead_id::text,
      0
    )
  );

  select event_row.*
  into v_existing_event
  from public.customer_identity_name_events event_row
  where event_row.organization_id = p_organization_id
    and event_row.operation_key = v_operation_key
  limit 1;

  if v_existing_event.id is not null then
    if v_existing_event.store_id is distinct from p_store_id
       or v_existing_event.lead_id is distinct from p_lead_id
       or v_existing_event.conversation_id is distinct from p_conversation_id
       or v_existing_event.source_message_id is distinct from p_source_message_id
       or v_existing_event.proposed_display_name is distinct from v_display_name
       or v_existing_event.proposed_normalized_name is distinct from v_normalized_name
       or v_existing_event.created_by is distinct from v_created_by then
      raise exception using
        errcode = '23505',
        message = 'ZION_IDENTITY_NAME_OPERATION_KEY_REUSED';
    end if;

    return query
    select
      v_existing_event.lead_id,
      v_existing_event.customer_id,
      v_existing_event.proposed_display_name,
      v_existing_event.proposed_normalized_name,
      false,
      'idempotent_replay'::text,
      v_existing_event.id,
      v_existing_event.created_at;
    return;
  end if;

  select lead_row.*
  into v_lead
  from public.leads lead_row
  where lead_row.id = p_lead_id
    and lead_row.organization_id = p_organization_id
    and lead_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'ZION_IDENTITY_NAME_LEAD_SCOPE_MISMATCH';
  end if;

  perform 1
  from public.conversations conversation_row
  where conversation_row.id = p_conversation_id
    and conversation_row.organization_id = p_organization_id
    and conversation_row.lead_id = p_lead_id
  for key share;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'ZION_IDENTITY_NAME_CONVERSATION_SCOPE_MISMATCH';
  end if;

  select
    message_row.conversation_id,
    message_row.sender,
    message_row.direction
  into
    v_message_conversation_id,
    v_message_sender,
    v_message_direction
  from public.messages message_row
  where message_row.id = p_source_message_id
    and message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id
  for key share;

  if not found
     or v_message_conversation_id is distinct from p_conversation_id then
    raise exception using
      errcode = '23514',
      message = 'ZION_IDENTITY_NAME_MESSAGE_SCOPE_MISMATCH';
  end if;

  if pg_catalog.lower(pg_catalog.btrim(coalesce(v_message_sender, ''))) <> 'user'
     or pg_catalog.lower(pg_catalog.btrim(coalesce(v_message_direction, ''))) <> 'incoming' then
    raise exception using
      errcode = '23514',
      message = 'ZION_IDENTITY_NAME_SOURCE_NOT_INCOMING_CUSTOMER';
  end if;

  select pg_catalog.count(*)::integer
  into v_link_count
  from public.lead_customer_links link_row
  join public.customers customer_row
    on customer_row.id = link_row.customer_id
   and customer_row.organization_id = link_row.organization_id
  join public.customer_store_links store_link_row
    on store_link_row.customer_id = link_row.customer_id
   and store_link_row.organization_id = link_row.organization_id
   and store_link_row.store_id = link_row.store_id
  where link_row.organization_id = p_organization_id
    and link_row.store_id = p_store_id
    and link_row.lead_id = p_lead_id
    and link_row.status = 'active'
    and customer_row.merged_into_customer_id is null;

  if v_link_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'ZION_IDENTITY_NAME_CUSTOMER_CARDINALITY_INVALID';
  end if;

  select link_row.*
  into v_link
  from public.lead_customer_links link_row
  where link_row.organization_id = p_organization_id
    and link_row.store_id = p_store_id
    and link_row.lead_id = p_lead_id
    and link_row.status = 'active'
  for update;

  select customer_row.*
  into v_customer
  from public.customers customer_row
  where customer_row.id = v_link.customer_id
    and customer_row.organization_id = p_organization_id
    and customer_row.merged_into_customer_id is null
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'ZION_IDENTITY_NAME_CUSTOMER_SCOPE_MISMATCH';
  end if;

  perform 1
  from public.customer_store_links store_link_row
  where store_link_row.customer_id = v_customer.id
    and store_link_row.organization_id = p_organization_id
    and store_link_row.store_id = p_store_id
  for key share;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'ZION_IDENTITY_NAME_CUSTOMER_STORE_SCOPE_MISMATCH';
  end if;

  v_lead_norm := public.normalize_customer_identity_name_for_system(v_lead.name);
  v_customer_norm := public.normalize_customer_identity_name_for_system(v_customer.display_name);
  v_customer_stored_norm := v_customer.normalized_name;
  v_lead_is_empty_or_placeholder := v_lead_norm is null
    or public.is_customer_identity_placeholder_name(v_lead.name);
  v_customer_is_empty_or_placeholder := v_customer_norm is null
    or public.is_customer_identity_placeholder_name(v_customer.display_name);

  if not v_lead_is_empty_or_placeholder
     and not v_customer_is_empty_or_placeholder
     and v_lead_norm is distinct from v_customer_norm then
    v_outcome := 'identity_scope_conflict';
  elsif not v_lead_is_empty_or_placeholder
     and v_lead_norm is distinct from v_normalized_name then
    v_outcome := 'conflict_existing_name';
  elsif not v_customer_is_empty_or_placeholder
     and v_customer_norm is distinct from v_normalized_name then
    v_outcome := 'conflict_existing_name';
  elsif v_lead_norm is not distinct from v_normalized_name
     and v_customer_norm is not distinct from v_normalized_name
     and v_customer_stored_norm is not distinct from v_normalized_name then
    v_outcome := 'completed_existing_match';
  elsif v_lead_norm is not distinct from v_normalized_name
     and v_customer_norm is not distinct from v_normalized_name
     and v_customer_stored_norm is distinct from v_normalized_name then
    update public.customers customer_row
    set normalized_name = v_normalized_name
    where customer_row.id = v_customer.id
      and customer_row.organization_id = p_organization_id
      and customer_row.normalized_name is distinct from v_normalized_name;

    v_changed := true;
    v_outcome := 'updated';
  else
    update public.leads lead_row
    set name = v_display_name
    where lead_row.id = p_lead_id
      and lead_row.organization_id = p_organization_id
      and lead_row.store_id = p_store_id
      and (
        public.normalize_customer_identity_name_for_system(lead_row.name) is distinct from v_normalized_name
        or public.is_customer_identity_placeholder_name(lead_row.name)
      );

    update public.customers customer_row
    set
      display_name = v_display_name,
      normalized_name = v_normalized_name
    where customer_row.id = v_customer.id
      and customer_row.organization_id = p_organization_id
      and (
        public.normalize_customer_identity_name_for_system(customer_row.display_name) is distinct from v_normalized_name
        or public.is_customer_identity_placeholder_name(customer_row.display_name)
        or customer_row.normalized_name is distinct from v_normalized_name
      );

    v_changed := true;
    v_outcome := 'updated';
  end if;

  insert into public.customer_identity_name_events (
    organization_id,
    store_id,
    lead_id,
    customer_id,
    conversation_id,
    source_message_id,
    operation_key,
    proposed_display_name,
    proposed_normalized_name,
    previous_lead_name,
    previous_customer_display_name,
    outcome,
    changed,
    created_by
  )
  values (
    p_organization_id,
    p_store_id,
    p_lead_id,
    v_customer.id,
    p_conversation_id,
    p_source_message_id,
    v_operation_key,
    v_display_name,
    v_normalized_name,
    v_lead.name,
    v_customer.display_name,
    v_outcome,
    v_changed,
    v_created_by
  )
  returning *
  into v_event;

  return query
  select
    p_lead_id,
    v_customer.id,
    v_display_name,
    v_normalized_name,
    v_changed,
    v_outcome,
    v_event.id,
    v_event.created_at;
end;
$function$;

alter function public.apply_customer_identity_name_internal(
  uuid, uuid, uuid, uuid, uuid, text, text, text
) owner to postgres;

revoke all on function public.apply_customer_identity_name_internal(
  uuid, uuid, uuid, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;

create or replace function public.write_customer_identity_name_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_lead_id uuid,
  p_conversation_id uuid,
  p_source_message_id uuid,
  p_operation_key text,
  p_display_name text,
  p_created_by text default 'sales_ai_identity_name_extractor_v1'
)
returns table (
  lead_id uuid,
  customer_id uuid,
  display_name text,
  normalized_name text,
  changed boolean,
  outcome text,
  event_id uuid,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'customer identity name write by system is not authorized';
  end if;

  return query
  select *
  from public.apply_customer_identity_name_internal(
    p_organization_id,
    p_store_id,
    p_lead_id,
    p_conversation_id,
    p_source_message_id,
    p_operation_key,
    p_display_name,
    p_created_by
  );
end;
$function$;

alter function public.write_customer_identity_name_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text, text
) owner to postgres;

revoke all on function public.write_customer_identity_name_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.write_customer_identity_name_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text, text
) to service_role;

do $postcondition$
begin
  if exists (
    select 1
    from pg_catalog.pg_class table_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(table_row.relacl, pg_catalog.acldefault('r', table_row.relowner))
    ) acl
    where table_row.oid = 'public.customer_identity_name_events'::regclass
      and acl.grantee = 0
      and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  )
     or pg_catalog.has_table_privilege('anon', 'public.customer_identity_name_events', 'SELECT')
     or pg_catalog.has_table_privilege('anon', 'public.customer_identity_name_events', 'INSERT')
     or pg_catalog.has_table_privilege('anon', 'public.customer_identity_name_events', 'UPDATE')
     or pg_catalog.has_table_privilege('anon', 'public.customer_identity_name_events', 'DELETE')
     or pg_catalog.has_table_privilege('authenticated', 'public.customer_identity_name_events', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.customer_identity_name_events', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.customer_identity_name_events', 'UPDATE')
     or pg_catalog.has_table_privilege('authenticated', 'public.customer_identity_name_events', 'DELETE')
     or pg_catalog.has_table_privilege('service_role', 'public.customer_identity_name_events', 'SELECT')
     or pg_catalog.has_table_privilege('service_role', 'public.customer_identity_name_events', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.customer_identity_name_events', 'UPDATE')
     or pg_catalog.has_table_privilege('service_role', 'public.customer_identity_name_events', 'DELETE') then
    raise exception using
      errcode = '42501',
      message = 'ZION_IDENTITY_NAME_EVENTS_PRIVILEGE_POSTCONDITION_FAILED';
  end if;

  if not pg_catalog.has_function_privilege(
    'service_role',
    'public.write_customer_identity_name_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text)',
    'EXECUTE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'ZION_IDENTITY_NAME_WRAPPER_PRIVILEGE_POSTCONDITION_FAILED';
  end if;

  if pg_catalog.has_function_privilege(
    'anon',
    'public.write_customer_identity_name_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text)',
    'EXECUTE'
  )
     or pg_catalog.has_function_privilege(
    'authenticated',
    'public.write_customer_identity_name_by_system(uuid,uuid,uuid,uuid,uuid,text,text,text)',
    'EXECUTE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'ZION_IDENTITY_NAME_WRAPPER_API_PRIVILEGE_POSTCONDITION_FAILED';
  end if;

  if pg_catalog.has_function_privilege(
    'anon',
    'public.apply_customer_identity_name_internal(uuid,uuid,uuid,uuid,uuid,text,text,text)',
    'EXECUTE'
  )
     or pg_catalog.has_function_privilege(
    'authenticated',
    'public.apply_customer_identity_name_internal(uuid,uuid,uuid,uuid,uuid,text,text,text)',
    'EXECUTE'
  )
     or pg_catalog.has_function_privilege(
    'service_role',
    'public.apply_customer_identity_name_internal(uuid,uuid,uuid,uuid,uuid,text,text,text)',
    'EXECUTE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'ZION_IDENTITY_NAME_INTERNAL_PRIVILEGE_POSTCONDITION_FAILED';
  end if;
end;
$postcondition$;

comment on table public.customer_identity_name_events is
  'Append-only provenance for customer/lead display-name updates derived from explicit customer self-declaration.';

comment on function public.write_customer_identity_name_by_system(
  uuid, uuid, uuid, uuid, uuid, text, text, text
) is
  'Server-only writer for explicit customer self-declared names. Validates lead/conversation/message/customer scope, serializes by lead identity, updates leads.name and customers.display_name atomically, and preserves conflicts without overwrite.';

commit;

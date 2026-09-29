begin;

-- ============================================================================
-- P9 — WhatsApp inbound thread reuse + terminal conversation reader repair
--
-- Problema:
-- 1. resolve_whatsapp_inbound_thread_by_system reutilizava somente status=active.
--    Conversas comerciais legítimas em qualificacao/orcamento/humano_assumiu/etc.
--    eram ignoradas e um novo thread era criado.
--
-- 2. panel_list_crm_cards_scoped podia escolher uma conversation closed/resolved
--    simplesmente por ela ser a mais recente.
--
-- 3. panel_list_inbox listava closed/resolved.
--
-- 4. conversations_sla_runtime mantinha closed/resolved no runtime.
--
-- Contrato:
-- - closed/resolved são terminais e não são reutilizados pelo inbound;
-- - qualquer outra conversation do mesmo lead é candidata reutilizável;
-- - mais de uma candidata continua fail-closed;
-- - o contrato externo thread_state permanece compatível:
--     existing_active_thread
--     created_active_thread
-- ============================================================================


-- ============================================================================
-- 0. PRECONDITIONS
-- ============================================================================

do $preconditions$
declare
  v_definition text;
begin
  if pg_catalog.to_regprocedure(
    'public.resolve_whatsapp_inbound_thread_by_system(uuid,uuid,text,text)'
  ) is null then
    raise exception
      'precondition failed: resolve_whatsapp_inbound_thread_by_system is missing';
  end if;

  if pg_catalog.to_regprocedure(
    'public.panel_list_crm_cards_scoped(uuid,uuid,integer,integer)'
  ) is null then
    raise exception
      'precondition failed: panel_list_crm_cards_scoped is missing';
  end if;

  if pg_catalog.to_regprocedure(
    'public.panel_list_inbox(uuid,uuid,integer,integer)'
  ) is null then
    raise exception
      'precondition failed: panel_list_inbox is missing';
  end if;

  if pg_catalog.to_regclass(
    'public.conversations_sla_runtime'
  ) is null then
    raise exception
      'precondition failed: conversations_sla_runtime is missing';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.resolve_whatsapp_inbound_thread_by_system(uuid,uuid,text,text)'::pg_catalog.regprocedure
  )
  into v_definition;

  if position(
    'conversation_row.status = ''active'''
    in v_definition
  ) = 0 then
    raise exception
      'precondition failed: inbound resolver no longer matches audited version';
  end if;
end;
$preconditions$;


-- ============================================================================
-- 1. WHATSAPP INBOUND THREAD RESOLVER
-- ============================================================================

create or replace function public.resolve_whatsapp_inbound_thread_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_whatsapp_identity text,
  p_contact_name text default null
)
returns table (
  lead_id uuid,
  conversation_id uuid,
  normalized_whatsapp_identity text,
  thread_state text,
  lead_created boolean,
  conversation_created boolean
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp', 'public'
set row_security to 'off'
as $function$
declare
  v_request_role text := public.lead_customer_link_request_role();
  v_digits text;
  v_contact_name text :=
    nullif(pg_catalog.btrim(p_contact_name), '');
  v_lead_count bigint := 0;
  v_lead_id uuid := null;
  v_conversation_count bigint := 0;
  v_conversation_id uuid := null;
  v_lead_created boolean := false;
  v_conversation_created boolean := false;
begin
  if not (
    v_request_role = 'service_role'
    or session_user = 'postgres'
  ) then
    raise exception using
      errcode = '42501',
      message =
        'whatsapp inbound thread resolution by system is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or nullif(
       pg_catalog.btrim(p_whatsapp_identity),
       ''
     ) is null
  then
    raise exception using
      errcode = '22004',
      message =
        'whatsapp inbound thread resolution input is incomplete';
  end if;

  v_digits := pg_catalog.regexp_replace(
    p_whatsapp_identity,
    '[^0-9]+',
    '',
    'g'
  );

  if v_digits = '' then
    raise exception using
      errcode = '22023',
      message =
        'whatsapp inbound identity has no digits';
  end if;

  if not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_organization_id
  ) then
    raise exception using
      errcode = '23514',
      message =
        'whatsapp inbound thread store scope mismatch';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'zion:p9:whatsapp-inbound-thread:v1:'
      || p_organization_id::text
      || ':'
      || p_store_id::text
      || ':'
      || v_digits,
      0
    )
  );

  select
    pg_catalog.count(*),
    pg_catalog.min(lead_row.id::text)::uuid
  into
    v_lead_count,
    v_lead_id
  from public.leads lead_row
  where lead_row.organization_id = p_organization_id
    and lead_row.store_id = p_store_id
    and lead_row.phone is not null
    and pg_catalog.regexp_replace(
      lead_row.phone,
      '[^0-9]+',
      '',
      'g'
    ) = v_digits;

  if v_lead_count > 1 then
    raise exception using
      errcode = 'P0001',
      message =
        'whatsapp inbound lead identity is ambiguous';
  end if;

  if v_lead_count = 0 then
    insert into public.leads (
      organization_id,
      store_id,
      phone,
      name
    )
    values (
      p_organization_id,
      p_store_id,
      v_digits,
      coalesce(
        v_contact_name,
        'Cliente WhatsApp'
      )
    )
    returning id
    into v_lead_id;

    v_lead_created := true;
  end if;

  perform 1
  from public.leads lead_row
  where lead_row.id = v_lead_id
    and lead_row.organization_id = p_organization_id
    and lead_row.store_id = p_store_id
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message =
        'whatsapp inbound lead scope mismatch';
  end if;

  select
    pg_catalog.count(*),
    pg_catalog.min(conversation_row.id::text)::uuid
  into
    v_conversation_count,
    v_conversation_id
  from public.conversations conversation_row
  where conversation_row.organization_id = p_organization_id
    and conversation_row.lead_id = v_lead_id
    and conversation_row.status not in (
      'closed',
      'resolved'
    );

  if v_conversation_count > 1 then
    raise exception using
      errcode = 'P0001',
      message =
        'whatsapp inbound reusable conversation is ambiguous';
  end if;

  if v_conversation_count = 0 then
    insert into public.conversations (
      organization_id,
      lead_id,
      status
    )
    values (
      p_organization_id,
      v_lead_id,
      'active'
    )
    returning id
    into v_conversation_id;

    v_conversation_created := true;
  end if;

  return query
  select
    v_lead_id,
    v_conversation_id,
    v_digits,
    case
      when v_lead_created
        or v_conversation_created
      then 'created_active_thread'::text
      else 'existing_active_thread'::text
    end,
    v_lead_created,
    v_conversation_created;
end;
$function$;


comment on function
  public.resolve_whatsapp_inbound_thread_by_system(
    uuid,
    uuid,
    text,
    text
  )
is
  'Resolve o thread WhatsApp reutilizando a única conversation não terminal do lead; closed/resolved não são reutilizados e múltiplas candidatas falham fechado.';


-- ============================================================================
-- 2. CRM — NÃO ESCOLHER CLOSED/RESOLVED COMO CONVERSA ATUAL
-- ============================================================================

create or replace function public.panel_list_crm_cards_scoped(
  p_organization_id uuid,
  p_store_id uuid default null,
  p_limit integer default 500,
  p_offset integer default 0
)
returns table (
  lead_id uuid,
  conversation_id uuid,
  name text,
  phone text,
  effective_state text,
  lead_state text,
  conversation_status text,
  is_human_active boolean,
  created_at timestamptz
)
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select
    l.id as lead_id,
    c.id as conversation_id,
    l.name,
    l.phone,
    coalesce(
      c.status,
      l.state,
      'novo_lead'
    ) as effective_state,
    l.state as lead_state,
    c.status as conversation_status,
    coalesce(
      c.is_human_active,
      false
    ) as is_human_active,
    coalesce(
      c.created_at,
      l.created_at
    ) as created_at
  from public.leads l
  left join lateral (
    select
      conv.id,
      conv.status,
      conv.is_human_active,
      conv.created_at
    from public.conversations conv
    where conv.organization_id =
      p_organization_id
      and conv.lead_id = l.id
      and conv.status not in (
        'closed',
        'resolved'
      )
    order by conv.created_at desc
    limit 1
  ) c on true
  where l.organization_id =
      p_organization_id
    and (
      p_store_id is null
      or l.store_id = p_store_id
    )
  order by
    coalesce(
      c.created_at,
      l.created_at
    ) desc
  limit p_limit
  offset p_offset;
$function$;


-- ============================================================================
-- 3. INBOX — NÃO LISTAR CLOSED/RESOLVED
-- ============================================================================

create or replace function public.panel_list_inbox(
  p_organization_id uuid,
  p_store_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  conversation_id uuid,
  lead_id uuid,
  store_id uuid,
  status text,
  is_human_active boolean,
  conversation_created_at timestamptz,
  last_message_at timestamptz,
  last_message_preview text,
  last_message_direction text,
  last_message_sender text
)
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select
    i.conversation_id,
    i.lead_id,
    i.store_id,
    i.status,
    i.is_human_active,
    i.conversation_created_at,
    i.last_message_at,
    i.last_message_preview,
    i.last_message_direction,
    i.last_message_sender
  from public.conversations_inbox i
  where i.organization_id =
      p_organization_id
    and (
      p_store_id is null
      or i.store_id = p_store_id
    )
    and i.status not in (
      'closed',
      'resolved'
    )
  order by
    i.last_message_at desc nulls last,
    i.conversation_created_at desc
  limit p_limit
  offset p_offset;
$function$;


-- ============================================================================
-- 4. SLA — CLOSED/RESOLVED NÃO PARTICIPAM DO RUNTIME OPERACIONAL
-- ============================================================================

create or replace view public.conversations_sla_runtime
as
with t as (
  select now() as ts
),
current_state_enter as (
  select
    c.id as conversation_id,
    max(stl.created_at) as state_entered_at
  from public.conversations c
  left join public.state_transition_log stl
    on stl.conversation_id = c.id
   and stl.organization_id = c.organization_id
   and stl.to_state = c.status
   and stl.from_state is not null
   and (
     coalesce(stl.reason, '') <> all (
       array[
         'sla_violation'::text,
         'sla_risk_alert'::text
       ]
     )
   )
  where c.status not in (
    'closed',
    'resolved'
  )
  group by c.id
),
resolved as (
  select
    c.id as conversation_id,
    c.organization_id,
    c.status as current_state,
    coalesce(
      cse.state_entered_at,
      c.created_at
    ) as state_entered_at,
    coalesce(
      (cfg.sla_minutes * 60)::bigint,
      0::bigint
    ) as sla_seconds
  from public.conversations c
  left join current_state_enter cse
    on cse.conversation_id = c.id
  left join public.state_sla_configs cfg
    on cfg.organization_id = c.organization_id
   and cfg.state = c.status
  where c.status not in (
    'closed',
    'resolved'
  )
)
select
  r.conversation_id,
  r.organization_id,
  r.current_state,
  r.state_entered_at,
  r.sla_seconds,
  greatest(
    0::bigint,
    floor(
      extract(
        epoch from (t.ts - r.state_entered_at)
      )
    )::bigint
  ) as elapsed_seconds,
  greatest(
    0::bigint,
    r.sla_seconds
      - floor(
          extract(
            epoch from (t.ts - r.state_entered_at)
          )
        )::bigint
  ) as remaining_seconds,
  case
    when r.sla_seconds <= 0 then false
    else
      floor(
        extract(
          epoch from (t.ts - r.state_entered_at)
        )
      )::bigint > r.sla_seconds
  end as is_violated
from resolved r
cross join t;


-- ============================================================================
-- 5. POSTCONDITIONS
-- ============================================================================

do $postconditions$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.resolve_whatsapp_inbound_thread_by_system(uuid,uuid,text,text)'::pg_catalog.regprocedure
  )
  into v_definition;

  if position(
    'conversation_row.status not in'
    in pg_catalog.lower(v_definition)
  ) = 0
  or position(
    '''closed'''
    in pg_catalog.lower(v_definition)
  ) = 0
  or position(
    '''resolved'''
    in pg_catalog.lower(v_definition)
  ) = 0
  then
    raise exception
      'postcondition failed: inbound resolver terminal filter missing';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.panel_list_crm_cards_scoped(uuid,uuid,integer,integer)'::pg_catalog.regprocedure
  )
  into v_definition;

  if position(
    'conv.status not in'
    in pg_catalog.lower(v_definition)
  ) = 0 then
    raise exception
      'postcondition failed: CRM current conversation terminal filter missing';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.panel_list_inbox(uuid,uuid,integer,integer)'::pg_catalog.regprocedure
  )
  into v_definition;

  if position(
    'i.status not in'
    in pg_catalog.lower(v_definition)
  ) = 0 then
    raise exception
      'postcondition failed: Inbox terminal filter missing';
  end if;

  select pg_catalog.pg_get_viewdef(
    'public.conversations_sla_runtime'::pg_catalog.regclass,
    true
  )
  into v_definition;

  if position(
    'closed'
    in pg_catalog.lower(v_definition)
  ) = 0
  or position(
    'resolved'
    in pg_catalog.lower(v_definition)
  ) = 0
  then
    raise exception
      'postcondition failed: SLA terminal filter missing';
  end if;
end;
$postconditions$;

commit;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:b5:e5.1:followup-inbox-canonical-bridge:v1',
    0
  )
);

do $preflight$
begin
  if pg_catalog.to_regprocedure(
       'public.panel_list_crm_opportunity_cards_scoped(uuid,uuid,integer,integer)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical crm opportunity cards reader is missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.activate_commercial_opportunity_followup_plan_by_user(uuid,uuid,uuid,text,text,text,jsonb,integer,text,timestamp with time zone)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical followup plan writer is missing';
  end if;

  if pg_catalog.to_regclass('public.conversation_ai_window_state') is null
     or pg_catalog.to_regclass('public.ai_runs') is null
     or pg_catalog.to_regclass('public.ai_sales_action_queue') is null
     or pg_catalog.to_regclass('public.messages') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: followup runtime dependencies are missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.panel_list_followup_opportunity_candidates_scoped(uuid,uuid,text,integer,integer)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'public.panel_enqueue_followup_opportunity_scoped(uuid,uuid,uuid,uuid,text,text,integer,timestamp with time zone)'
     ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'P9 5.1 canonical inbox bridge collision detected';
  end if;
end;
$preflight$;

create function public.panel_list_followup_opportunity_candidates_scoped(
  p_organization_id uuid,
  p_store_id uuid default null,
  p_followup_type text default 'offer',
  p_min_hours_since_customer integer default 24,
  p_limit integer default 50
)
returns table (
  commercial_opportunity_id uuid,
  conversation_id uuid,
  lead_id uuid,
  lead_name text,
  lead_phone text,
  conversation_status text,
  is_human_active boolean,
  last_customer_message_at timestamptz,
  last_ai_message_at timestamptz,
  hours_since_customer numeric,
  suggested_action text,
  blocked_reason text
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text :=
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
  v_limit integer;
  v_min_hours integer;
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'followup opportunity candidates are not authorized';
  end if;

  if p_organization_id is null then
    raise exception using
      errcode = '22023',
      message = 'followup candidates require organization';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_organization_id
      and membership_row.user_id = v_user_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'followup opportunity candidates are not authorized';
  end if;

  if p_store_id is not null
     and not exists (
       select 1
       from public.stores store_row
       where store_row.id = p_store_id
         and store_row.organization_id = p_organization_id
     ) then
    raise exception using
      errcode = '23503',
      message = 'followup candidate store scope not found';
  end if;

  v_min_hours := greatest(coalesce(p_min_hours_since_customer, 24), 0);
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 500);

  return query
  with cards as (
    select *
    from public.panel_list_crm_opportunity_cards_scoped(
      p_organization_id,
      p_store_id,
      500,
      0
    )
    where conversation_id is not null
  ),
  base as (
    select
      card.commercial_opportunity_id,
      card.conversation_id,
      card.lead_id,
      card.name as lead_name,
      card.phone as lead_phone,
      card.conversation_status,
      card.is_human_active,
      card.is_follow_up_active,
      state_row.last_customer_message_at,
      state_row.last_ai_message_at,
      state_row.next_resume_at,
      round(
        extract(
          epoch from (
            pg_catalog.clock_timestamp()
            - state_row.last_customer_message_at
          )
        ) / 3600.0,
        1
      ) as hours_since_customer,
      case
        when lower(coalesce(p_followup_type, 'offer')) = 'visit'
          then 'followup_visit'
        else 'followup_offer'
      end as suggested_action,
      count(*) over (
        partition by card.conversation_id
      ) as opportunity_count_for_conversation
    from cards card
    left join public.conversation_ai_window_state state_row
      on state_row.conversation_id = card.conversation_id
  ),
  annotated as (
    select
      base_row.*,
      case
        when base_row.opportunity_count_for_conversation <> 1
          then 'multiple_opportunities_same_conversation'
        when base_row.is_follow_up_active
          then 'followup_ja_ativo'
        when coalesce(base_row.is_human_active, false)
          then 'humano_ativo'
        when base_row.next_resume_at is not null
         and base_row.next_resume_at > pg_catalog.clock_timestamp()
          then 'aguardando_janela'
        when base_row.last_customer_message_at is null
          then 'sem_mensagem_cliente'
        when base_row.hours_since_customer < v_min_hours
          then 'cliente_ainda_recente'
        when exists (
          select 1
          from public.ai_sales_action_queue queue_row
          where queue_row.organization_id = p_organization_id
            and queue_row.conversation_id = base_row.conversation_id
            and queue_row.next_action = base_row.suggested_action
            and queue_row.processed_at is null
            and queue_row.processing_error is null
            and (
              queue_row.payload ->> 'commercial_opportunity_id'
                = base_row.commercial_opportunity_id::text
              or queue_row.payload ->> 'commercial_opportunity_id' is null
            )
        ) then 'acao_ja_enfileirada'
        when exists (
          select 1
          from public.messages message_row
          where message_row.conversation_id = base_row.conversation_id
            and message_row.sender = 'ai'
            and message_row.direction = 'outgoing'
            and message_row.metadata ->> 'source' =
              case
                when base_row.suggested_action = 'followup_visit'
                  then 'ai_sales_real_handler_followup_visit'
                else 'ai_sales_real_handler_followup_offer'
              end
            and message_row.created_at >=
              pg_catalog.clock_timestamp() - interval '7 days'
        ) then 'followup_recente'
        else null::text
      end as blocked_reason
    from base base_row
  )
  select
    annotated.commercial_opportunity_id,
    annotated.conversation_id,
    annotated.lead_id,
    annotated.lead_name,
    annotated.lead_phone,
    annotated.conversation_status,
    coalesce(annotated.is_human_active, false),
    annotated.last_customer_message_at,
    annotated.last_ai_message_at,
    annotated.hours_since_customer,
    annotated.suggested_action,
    annotated.blocked_reason
  from annotated
  order by
    case when annotated.blocked_reason is null then 0 else 1 end,
    annotated.last_customer_message_at asc nulls last,
    annotated.commercial_opportunity_id
  limit v_limit;
end;
$function$;

alter function public.panel_list_followup_opportunity_candidates_scoped(
  uuid,
  uuid,
  text,
  integer,
  integer
)
  owner to postgres;

revoke all on function public.panel_list_followup_opportunity_candidates_scoped(
  uuid,
  uuid,
  text,
  integer,
  integer
)
  from public, anon, authenticated, service_role;

grant execute on function public.panel_list_followup_opportunity_candidates_scoped(
  uuid,
  uuid,
  text,
  integer,
  integer
)
  to authenticated;

create function public.panel_enqueue_followup_opportunity_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_conversation_id uuid,
  p_followup_type text,
  p_operation_key text,
  p_cadence_interval_minutes integer,
  p_next_action_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text :=
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
  v_operation_key text;
  v_next_action text;
  v_blocked_reason text;
  v_opportunity public.commercial_opportunities;
  v_followup public.commercial_opportunity_followups;
  v_ai_run_id uuid;
  v_action_key text;
  v_existing_queue record;
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'followup opportunity enqueue is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_conversation_id is null then
    raise exception using
      errcode = '22023',
      message = 'followup enqueue requires organization, store, opportunity and conversation';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_organization_id
      and membership_row.user_id = v_user_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'followup opportunity enqueue is not authorized';
  end if;

  v_operation_key :=
    public.normalize_commercial_opportunity_followup_operation_key(
      p_operation_key
    );

  v_next_action :=
    case
      when lower(coalesce(p_followup_type, 'offer')) = 'visit'
        then 'followup_visit'
      else 'followup_offer'
    end;

  v_action_key :=
    'manual_followup_opportunity:'
    || p_commercial_opportunity_id::text
    || ':'
    || v_operation_key;

  v_opportunity :=
    public.lock_commercial_opportunity_followup_target(
      p_organization_id,
      p_store_id,
      p_commercial_opportunity_id
    );

  v_opportunity :=
    public.validate_commercial_opportunity_followup_integrity(v_opportunity);

  if v_opportunity.primary_conversation_id is distinct from p_conversation_id then
    return jsonb_build_object(
      'ok', false,
      'error', 'opportunity_conversation_scope_mismatch'
    );
  end if;

  select
    queue_row.ai_run_id,
    queue_row.action_key,
    queue_row.next_action,
    queue_row.payload
  into v_existing_queue
  from public.ai_sales_action_queue queue_row
  where queue_row.organization_id = p_organization_id
    and queue_row.store_id = p_store_id
    and queue_row.conversation_id = p_conversation_id
    and queue_row.action_key = v_action_key
  limit 1;

  if found then
    if v_existing_queue.next_action is distinct from v_next_action
       or v_existing_queue.payload ->> 'commercial_opportunity_id'
            is distinct from p_commercial_opportunity_id::text
       or v_existing_queue.payload ->> 'conversation_id'
            is distinct from p_conversation_id::text
       or v_existing_queue.payload ->> 'followup_operation_key'
            is distinct from v_operation_key then
      raise exception using
        errcode = '23505',
        message = 'ZION_FOLLOWUP_INBOX_OPERATION_KEY_CONFLICT';
    end if;

    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'commercial_opportunity_id', p_commercial_opportunity_id,
      'conversation_id', p_conversation_id,
      'next_action', v_next_action,
      'ai_run_id', v_existing_queue.ai_run_id
    );
  end if;

  select candidate.blocked_reason
  into v_blocked_reason
  from public.panel_list_followup_opportunity_candidates_scoped(
    p_organization_id,
    p_store_id,
    lower(coalesce(p_followup_type, 'offer')),
    24,
    500
  ) candidate
  where candidate.commercial_opportunity_id = p_commercial_opportunity_id
    and candidate.conversation_id = p_conversation_id;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'followup_candidate_not_found'
    );
  end if;

  if v_blocked_reason is not null then
    return jsonb_build_object(
      'ok', false,
      'error', 'followup_blocked',
      'blocked_reason', v_blocked_reason,
      'commercial_opportunity_id', p_commercial_opportunity_id,
      'conversation_id', p_conversation_id,
      'next_action', v_next_action
    );
  end if;

  v_followup :=
    public.activate_commercial_opportunity_followup_plan_by_user(
      p_organization_id,
      p_store_id,
      p_commercial_opportunity_id,
      v_operation_key,
      'manual_inbox_followup',
      'Follow-up manual acionado pela Inbox.',
      jsonb_build_object(
        'source', 'inbox_manual_followup',
        'conversation_id', p_conversation_id,
        'followup_type', lower(coalesce(p_followup_type, 'offer')),
        'next_action', v_next_action
      ),
      p_cadence_interval_minutes,
      v_next_action,
      p_next_action_at
    );

  select
    queue_row.ai_run_id,
    queue_row.action_key,
    queue_row.next_action,
    queue_row.payload
  into v_existing_queue
  from public.ai_sales_action_queue queue_row
  where queue_row.organization_id = p_organization_id
    and queue_row.store_id = p_store_id
    and queue_row.conversation_id = p_conversation_id
    and queue_row.action_key = v_action_key
  limit 1;

  if found then
    if v_existing_queue.next_action is distinct from v_next_action
       or v_existing_queue.payload ->> 'commercial_opportunity_id'
            is distinct from p_commercial_opportunity_id::text
       or v_existing_queue.payload ->> 'conversation_id'
            is distinct from p_conversation_id::text
       or v_existing_queue.payload ->> 'followup_operation_key'
            is distinct from v_operation_key then
      raise exception using
        errcode = '23505',
        message = 'ZION_FOLLOWUP_INBOX_OPERATION_KEY_CONFLICT';
    end if;

    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'commercial_opportunity_id', p_commercial_opportunity_id,
      'conversation_id', p_conversation_id,
      'followup_id', v_followup.id,
      'followup_cycle', v_followup.cycle,
      'next_action', v_next_action,
      'ai_run_id', v_existing_queue.ai_run_id
    );
  end if;

  insert into public.ai_runs (
    organization_id,
    store_id,
    lead_id,
    conversation_id,
    status,
    input
  )
  values (
    p_organization_id,
    p_store_id,
    v_opportunity.origin_lead_id,
    p_conversation_id,
    'succeeded',
    jsonb_build_object(
      'type', 'manual_followup_enqueue',
      'source', 'panel_enqueue_followup_opportunity_scoped',
      'commercial_opportunity_id', p_commercial_opportunity_id,
      'followup_id', v_followup.id,
      'followup_cycle', v_followup.cycle,
      'next_action', v_next_action
    )
  )
  returning id into v_ai_run_id;

  insert into public.ai_sales_action_queue (
    organization_id,
    store_id,
    conversation_id,
    ai_run_id,
    next_action,
    action_key,
    payload
  )
  values (
    p_organization_id,
    p_store_id,
    p_conversation_id,
    v_ai_run_id,
    v_next_action,
    v_action_key,
    jsonb_build_object(
      'type', 'manual_followup',
      'source', 'panel_enqueue_followup_opportunity_scoped',
      'commercial_opportunity_id', p_commercial_opportunity_id,
      'conversation_id', p_conversation_id,
      'organization_id', p_organization_id,
      'store_id', p_store_id,
      'followup_id', v_followup.id,
      'followup_cycle', v_followup.cycle,
      'followup_operation_key', v_operation_key,
      'followup_type', lower(coalesce(p_followup_type, 'offer')),
      'next_action', v_next_action
    )
  );

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'commercial_opportunity_id', p_commercial_opportunity_id,
    'conversation_id', p_conversation_id,
    'followup_id', v_followup.id,
    'followup_cycle', v_followup.cycle,
    'next_action', v_next_action,
    'ai_run_id', v_ai_run_id
  );
end;
$function$;

alter function public.panel_enqueue_followup_opportunity_scoped(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  integer,
  timestamptz
)
  owner to postgres;

revoke all on function public.panel_enqueue_followup_opportunity_scoped(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  integer,
  timestamptz
)
  from public, anon, authenticated, service_role;

grant execute on function public.panel_enqueue_followup_opportunity_scoped(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  integer,
  timestamptz
)
  to authenticated;

do $postconditions$
begin
  if pg_catalog.to_regprocedure(
       'public.panel_list_followup_opportunity_candidates_scoped(uuid,uuid,text,integer,integer)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.panel_enqueue_followup_opportunity_scoped(uuid,uuid,uuid,uuid,text,text,integer,timestamp with time zone)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: canonical inbox followup bridge is missing';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.panel_list_followup_opportunity_candidates_scoped(uuid,uuid,text,integer,integer)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.panel_enqueue_followup_opportunity_scoped(uuid,uuid,uuid,uuid,text,text,integer,timestamp with time zone)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.panel_list_followup_opportunity_candidates_scoped(uuid,uuid,text,integer,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.panel_enqueue_followup_opportunity_scoped(uuid,uuid,uuid,uuid,text,text,integer,timestamp with time zone)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: canonical inbox followup bridge grants mismatch';
  end if;
end;
$postconditions$;

commit;
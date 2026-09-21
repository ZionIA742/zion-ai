begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:b5:e5.5.3:followup-inbox-reader-v4-unique-opportunity-type:v1',
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
      message = 'precondition failed: crm opportunity card reader is missing';
  end if;

  if pg_catalog.to_regprocedure(
    'public.panel_list_followup_opportunity_candidates_scoped_v4(uuid,uuid,integer,integer,integer)'
  ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: followup inbox reader v4 already exists';
  end if;

  if pg_catalog.to_regclass('public.conversation_sessions') is null
     or pg_catalog.to_regclass('public.commercial_session_context_links') is null
     or pg_catalog.to_regclass('public.lead_customer_links') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_followups') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical followup scope tables are missing';
  end if;
end;
$preflight$;

create function public.panel_list_followup_opportunity_candidates_scoped_v4(
  p_organization_id uuid,
  p_store_id uuid default null,
  p_min_hours_since_customer integer default 24,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  commercial_opportunity_id uuid,
  conversation_id uuid,
  lead_id uuid,
  lead_name text,
  lead_phone text,
  conversation_status text,
  opportunity_stage text,
  is_human_active boolean,
  last_customer_message_at timestamptz,
  last_ai_message_at timestamptz,
  hours_since_customer numeric,
  followup_type text,
  suggested_action text,
  operational_state text,
  blocked_reason text,
  followup_id uuid,
  followup_cycle integer,
  followup_status text,
  next_action text,
  next_action_at timestamptz,
  attempt_count integer,
  exhausted boolean,
  opted_out boolean,
  consent_restored boolean,
  reason_code text,
  reason_details text,
  context jsonb,
  total_count bigint,
  ready_count bigint,
  waiting_count bigint,
  blocked_count bigint
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
  v_offset integer;
  v_min_hours integer;
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'followup opportunity candidates v4 are not authorized';
  end if;

  if p_organization_id is null then
    raise exception using
      errcode = '22023',
      message = 'followup candidates v4 require organization';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_organization_id
      and membership_row.user_id = v_user_id
      and membership_row.is_active is true
  ) then
    raise exception using
      errcode = '42501',
      message = 'followup opportunity candidates v4 are not authorized';
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
      message = 'followup candidate v4 store scope not found';
  end if;

  v_min_hours := greatest(coalesce(p_min_hours_since_customer, 24), 0);
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
  with cards as (
    select card_source.*
    from public.panel_list_crm_opportunity_cards_scoped(
      p_organization_id,
      p_store_id,
      500,
      0
    ) card_source
    where card_source.conversation_id is not null
  ),
  base as (
    select
      card.commercial_opportunity_id,
      card.conversation_id,
      card.lead_id,
      card.name as lead_name,
      card.phone as lead_phone,
      card.conversation_status,
      opportunity_row.stage as opportunity_stage,
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
        when followup_row.status = 'active'
         and followup_row.next_action = 'followup_offer' then 'offer'
        when followup_row.status = 'active'
         and followup_row.next_action = 'followup_visit' then 'visit'
        else null::text
      end as followup_type,
      case
        when followup_row.status = 'active'
         and followup_row.next_action in ('followup_offer', 'followup_visit')
          then followup_row.next_action
        else null::text
      end as suggested_action,
      followup_row.id as followup_id,
      followup_row.cycle as followup_cycle,
      followup_row.status as followup_status,
      followup_row.next_action,
      followup_row.next_action_at,
      followup_row.attempt_count,
      (followup_row.status = 'exhausted') as exhausted,
      (followup_row.status = 'opted_out') as opted_out,
      (followup_row.status = 'consent_restored') as consent_restored,
      followup_row.reason_code,
      followup_row.reason_details,
      followup_row.context,
      count(*) over (
        partition by card.conversation_id
      ) as opportunity_count_for_conversation,

      exists (
        select 1
        from public.conversations conversation_row
        join public.conversation_sessions session_row
          on session_row.conversation_id = conversation_row.id
         and session_row.organization_id = conversation_row.organization_id
         and session_row.store_id = card.store_id
         and session_row.status = 'active'
        join public.commercial_session_context_links context_link_row
          on context_link_row.conversation_session_id = session_row.id
         and context_link_row.organization_id = session_row.organization_id
         and context_link_row.store_id = session_row.store_id
         and context_link_row.commercial_opportunity_id = card.commercial_opportunity_id
         and context_link_row.customer_id = card.customer_id
         and context_link_row.status = 'active'
         and context_link_row.unlinked_at is null
        join public.lead_customer_links lead_link_row
          on lead_link_row.id = context_link_row.lead_customer_link_id
         and lead_link_row.organization_id = card.organization_id
         and lead_link_row.store_id = card.store_id
         and lead_link_row.customer_id = card.customer_id
         and lead_link_row.lead_id = card.lead_id
         and lead_link_row.status = 'active'
         and lead_link_row.unlinked_at is null
        where conversation_row.id = card.conversation_id
          and conversation_row.organization_id = card.organization_id
          and conversation_row.lead_id = card.lead_id
      ) as primary_conversation_scope_ok

    from cards card
    join public.commercial_opportunities opportunity_row
      on opportunity_row.id = card.commercial_opportunity_id
     and opportunity_row.organization_id = p_organization_id
     and opportunity_row.store_id = card.store_id
     and (p_store_id is null or opportunity_row.store_id = p_store_id)
    left join public.conversation_ai_window_state state_row
      on state_row.conversation_id = card.conversation_id
    left join lateral (
      select followup_source.*
      from public.commercial_opportunity_followups followup_source
      where followup_source.organization_id = card.organization_id
        and followup_source.store_id = card.store_id
        and followup_source.commercial_opportunity_id = card.commercial_opportunity_id
      order by
        case followup_source.status
          when 'active' then 0
          when 'opted_out' then 1
          when 'consent_restored' then 2
          when 'exhausted' then 3
          else 4
        end,
        followup_source.cycle desc,
        followup_source.created_at desc,
        followup_source.id asc
      limit 1
    ) followup_row on true
  ),
  annotated as (
    select
      base_row.*,
      case
        when base_row.followup_status = 'opted_out'
          then 'commercial_opportunity_opted_out'
        when base_row.followup_status = 'exhausted'
          then 'commercial_opportunity_followup_exhausted'
        when base_row.opportunity_count_for_conversation <> 1
          then 'multiple_opportunities_same_conversation'
        when not base_row.primary_conversation_scope_ok
          then 'primary_conversation_scope_inconsistency'
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
        when base_row.suggested_action is not null
         and exists (
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
        when base_row.suggested_action is not null
         and exists (
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
  ),
  stateful as (
    select
      annotated.*,
      case
        when annotated.blocked_reason is null then 'ready'
        when annotated.blocked_reason in (
          'aguardando_janela',
          'cliente_ainda_recente',
          'followup_recente',
          'acao_ja_enfileirada'
        ) then 'waiting'
        else 'blocked'
      end as operational_state
    from annotated
  ),
  counted as (
    select
      stateful.*,
      count(*) over () as total_count,
      count(*) filter (
        where stateful.operational_state = 'ready'
      ) over () as ready_count,
      count(*) filter (
        where stateful.operational_state = 'waiting'
      ) over () as waiting_count,
      count(*) filter (
        where stateful.operational_state = 'blocked'
      ) over () as blocked_count
    from stateful
  )
  select
    counted.commercial_opportunity_id,
    counted.conversation_id,
    counted.lead_id,
    counted.lead_name,
    counted.lead_phone,
    counted.conversation_status,
    counted.opportunity_stage,
    coalesce(counted.is_human_active, false),
    counted.last_customer_message_at,
    counted.last_ai_message_at,
    counted.hours_since_customer,
    counted.followup_type,
    counted.suggested_action,
    counted.operational_state,
    counted.blocked_reason,
    counted.followup_id,
    counted.followup_cycle,
    counted.followup_status,
    counted.next_action,
    counted.next_action_at,
    counted.attempt_count,
    coalesce(counted.exhausted, false),
    coalesce(counted.opted_out, false),
    coalesce(counted.consent_restored, false),
    counted.reason_code,
    counted.reason_details,
    coalesce(counted.context, '{}'::jsonb),
    counted.total_count,
    counted.ready_count,
    counted.waiting_count,
    counted.blocked_count
  from counted
  order by
    case counted.operational_state
      when 'ready' then 0
      when 'waiting' then 1
      else 2
    end,
    counted.last_customer_message_at asc nulls last,
    counted.commercial_opportunity_id asc
  limit v_limit
  offset v_offset;
end;
$function$;

alter function public.panel_list_followup_opportunity_candidates_scoped_v4(
  uuid,
  uuid,
  integer,
  integer,
  integer
) owner to postgres;

revoke all on function public.panel_list_followup_opportunity_candidates_scoped_v4(
  uuid,
  uuid,
  integer,
  integer,
  integer
) from public, anon, authenticated, service_role;

grant execute on function public.panel_list_followup_opportunity_candidates_scoped_v4(
  uuid,
  uuid,
  integer,
  integer,
  integer
) to authenticated;

comment on function public.panel_list_followup_opportunity_candidates_scoped_v4(
  uuid,
  uuid,
  integer,
  integer,
  integer
) is
  'P9 5.5.3 Inbox follow-up reader v4. Lists one row per opportunity and derives followup_type only from active commercial_opportunity_followups.next_action.';

do $postconditions$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.panel_list_followup_opportunity_candidates_scoped_v4(uuid,uuid,integer,integer,integer)'
  );
  v_arguments text;
  v_result text;
  v_definition text;
begin
  if v_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: followup inbox reader v4 is missing';
  end if;

  select pg_catalog.pg_get_function_identity_arguments(v_oid)
  into v_arguments;

  select pg_catalog.pg_get_function_result(v_oid)
  into v_result;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(v_oid))
  into v_definition;

  if pg_catalog.strpos(v_arguments, 'p_followup_type') <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: followup inbox reader v4 still receives followup type';
  end if;

  if v_result not like '%opportunity_stage text%'
     or v_result not like '%followup_type text%'
     or v_result not like '%total_count bigint%'
     or v_result not like '%ready_count bigint%'
     or v_result not like '%waiting_count bigint%'
     or v_result not like '%blocked_count bigint%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: followup inbox reader v4 result is incomplete';
  end if;

  if pg_catalog.strpos(v_definition, 'opportunity_row.stage as opportunity_stage') = 0
     or pg_catalog.strpos(v_definition, 'when ''active'' then 0') = 0
     or pg_catalog.strpos(v_definition, 'followup_row.status = ''active''') = 0
     or pg_catalog.strpos(v_definition, 'followup_row.next_action = ''followup_offer''') = 0
     or pg_catalog.strpos(v_definition, 'followup_row.next_action = ''followup_visit''') = 0
     or pg_catalog.strpos(v_definition, 'else null::text') = 0
     or pg_catalog.strpos(v_definition, 'count(*) over () as total_count') = 0
     or pg_catalog.strpos(v_definition, 'offset v_offset') = 0
     or pg_catalog.strpos(v_definition, 'commercial_opportunity_id asc') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: followup inbox reader v4 canonical type, totals or ordering contract is incomplete';
  end if;
end;
$postconditions$;

commit;

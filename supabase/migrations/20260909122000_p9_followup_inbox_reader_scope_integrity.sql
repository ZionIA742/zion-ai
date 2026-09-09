begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:b5:e5.1:followup-inbox-reader-scope-integrity:v1',
    0
  )
);

do $preflight$
begin
  if pg_catalog.to_regprocedure(
    'public.panel_list_followup_opportunity_candidates_scoped(uuid,uuid,text,integer,integer)'
  ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical followup inbox reader is missing';
  end if;

  if pg_catalog.to_regclass('public.conversation_sessions') is null
     or pg_catalog.to_regclass('public.commercial_session_context_links') is null
     or pg_catalog.to_regclass('public.lead_customer_links') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical commercial scope tables are missing';
  end if;
end;
$preflight$;

create or replace function public.panel_list_followup_opportunity_candidates_scoped(
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
    left join public.conversation_ai_window_state state_row
      on state_row.conversation_id = card.conversation_id
  ),
  annotated as (
    select
      base_row.*,
      case
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
) owner to postgres;

revoke all on function public.panel_list_followup_opportunity_candidates_scoped(
  uuid,
  uuid,
  text,
  integer,
  integer
) from public, anon, authenticated, service_role;

grant execute on function public.panel_list_followup_opportunity_candidates_scoped(
  uuid,
  uuid,
  text,
  integer,
  integer
) to authenticated;

do $postconditions$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.panel_list_followup_opportunity_candidates_scoped(uuid,uuid,text,integer,integer)'
  );
  v_definition text;
begin
  if v_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: canonical followup reader is missing';
  end if;

  select pg_catalog.lower(
    pg_catalog.pg_get_functiondef(v_oid)
  )
  into v_definition;

  if pg_catalog.strpos(
       v_definition,
       'primary_conversation_scope_ok'
     ) = 0
     or pg_catalog.strpos(
       v_definition,
       'primary_conversation_scope_inconsistency'
     ) = 0
     or pg_catalog.strpos(
       v_definition,
       'conversation_sessions'
     ) = 0
     or pg_catalog.strpos(
       v_definition,
       'commercial_session_context_links'
     ) = 0
     or pg_catalog.strpos(
       v_definition,
       'lead_customer_links'
     ) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: canonical primary conversation scope gate is missing';
  end if;

  if not pg_catalog.has_function_privilege(
       'authenticated',
       v_oid,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       v_oid,
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: reader grants mismatch';
  end if;
end;
$postconditions$;

commit;
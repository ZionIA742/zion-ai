begin;

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('zion:p9:priority:reason-codes-hotfix:v1',0));

-- P9 / Bloco 5 / Etapa 5.4
-- Corrective migration after 20260910150000 was applied remotely.
-- Fixes text[] reason-code accumulation without changing priority semantics.
create or replace function public.p9_resolve_commercial_opportunity_priority_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_as_of timestamptz
)
returns table (
  organization_id uuid,
  store_id uuid,
  commercial_opportunity_id uuid,
  lifecycle_cycle integer,
  opportunity_stage text,
  priority_band text,
  priority_rank integer,
  rank_critical integer,
  rank_attention integer,
  rank_next_commitment_due_at timestamptz,
  rank_next_task_due_at timestamptz,
  rank_current_quote_total_cents bigint,
  rank_stage integer,
  has_customer_waiting boolean,
  customer_waiting_since timestamptz,
  last_customer_message_at timestamptz,
  last_outbound_message_at timestamptz,
  has_operational_blocker boolean,
  highest_operational_task_priority text,
  highest_operational_task_priority_rank integer,
  operational_task_ids uuid[],
  operational_task_basis jsonb,
  has_overdue_commitment boolean,
  next_commitment_at timestamptz,
  next_commitment_id uuid,
  has_due_followup boolean,
  followup_next_action_at timestamptz,
  followup_id uuid,
  followup_cycle integer,
  current_quote_id uuid,
  current_quote_version_id uuid,
  current_quote_total_cents bigint,
  reason_codes text[],
  authority_basis jsonb,
  evaluated_as_of timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_opportunity public.commercial_opportunities;
  v_as_of timestamptz := p_as_of;
  v_last_customer_message_at timestamptz;
  v_last_outbound_message_at timestamptz;
  v_customer_waiting boolean := false;
  v_task_ids uuid[] := array[]::uuid[];
  v_task_basis jsonb := '[]'::jsonb;
  v_task_priority text;
  v_task_priority_rank integer := 0;
  v_has_operational_blocker boolean := false;
  v_has_overdue_commitment boolean := false;
  v_next_commitment_at timestamptz;
  v_next_commitment_id uuid;
  v_has_due_followup boolean := false;
  v_followup_next_action_at timestamptz;
  v_followup_id uuid;
  v_followup_cycle integer;
  v_current_quote_total_cents bigint;
  v_current_quote_valid boolean := false;
  v_rank_critical integer := 0;
  v_rank_attention integer := 0;
  v_stage_rank integer := 0;
  v_priority_band text := 'normal';
  v_priority_rank integer := 30;
  v_reason_codes text[] := array[]::text[];
  v_is_terminal boolean := false;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22004',
      message = 'commercial opportunity priority scope is incomplete';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'commercial opportunity priority scope not found';
  end if;

  if p_as_of is null then
    raise exception using
      errcode = '22004',
      message = 'commercial opportunity priority as_of is required';
  end if;

  v_is_terminal :=
    pg_catalog.lower(pg_catalog.btrim(v_opportunity.stage))
      in ('perdido', 'concluido_sem_mais_acoes');
  v_stage_rank := public.p9_priority_stage_rank_internal(v_opportunity.stage);

  select max(message_row.created_at)
  into v_last_customer_message_at
  from public.messages message_row
  join public.commercial_session_context_links link_row
    on link_row.id = message_row.commercial_session_context_link_id
   and link_row.organization_id = message_row.organization_id
   and link_row.store_id = message_row.store_id
   and link_row.commercial_opportunity_id = v_opportunity.id
  where message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id
    and message_row.direction = 'incoming'
    and pg_catalog.lower(pg_catalog.btrim(coalesce(message_row.sender, ''))) = 'user'
    and message_row.deleted_at is null;

  select max(message_row.created_at)
  into v_last_outbound_message_at
  from public.messages message_row
  join public.commercial_session_context_links link_row
    on link_row.id = message_row.commercial_session_context_link_id
   and link_row.organization_id = message_row.organization_id
   and link_row.store_id = message_row.store_id
   and link_row.commercial_opportunity_id = v_opportunity.id
  where message_row.organization_id = p_organization_id
    and message_row.store_id = p_store_id
    and message_row.direction = 'outgoing'
    and message_row.deleted_at is null
    and pg_catalog.lower(pg_catalog.btrim(coalesce(message_row.sender, '')))
      in ('ai', 'human', 'store', 'assistant');

  v_customer_waiting :=
    v_last_customer_message_at is not null
    and (
      v_last_outbound_message_at is null
      or v_last_customer_message_at > v_last_outbound_message_at
    );

  if v_customer_waiting then
    v_reason_codes := pg_catalog.array_append(v_reason_codes, 'customer_waiting');
  end if;

  with open_tasks as (
    select
      task_row.id,
      task_row.priority,
      public.p9_priority_task_rank_internal(coalesce(task_row.priority, '')) as priority_rank,
      task_row.status,
      task_row.target_start_at
    from public.store_assistant_operational_tasks task_row
    where task_row.organization_id = p_organization_id
      and task_row.store_id = p_store_id
      and task_row.commercial_opportunity_id = p_commercial_opportunity_id
      and task_row.status in (
        'open',
        'waiting_user_choice',
        'waiting_customer_response',
        'ready_to_execute',
        'in_progress'
      )
  ),
  task_agg as (
    select
      array_agg(open_tasks.id order by open_tasks.priority_rank desc, open_tasks.target_start_at asc nulls last, open_tasks.id) as task_ids,
      jsonb_agg(
        jsonb_build_object(
          'task_id', open_tasks.id,
          'status', open_tasks.status,
          'priority', open_tasks.priority,
          'target_start_at', open_tasks.target_start_at,
          'priority_rank', open_tasks.priority_rank
        )
        order by open_tasks.priority_rank desc, open_tasks.target_start_at asc nulls last, open_tasks.id
      ) as task_basis,
      max(open_tasks.priority_rank) as max_priority_rank,
      (
        array_agg(
          open_tasks.priority
          order by open_tasks.priority_rank desc, open_tasks.target_start_at asc nulls last, open_tasks.id
        )
      )[1] as max_priority
    from open_tasks
  )
  select
    coalesce(task_agg.task_ids, array[]::uuid[]),
    coalesce(task_agg.task_basis, '[]'::jsonb),
    coalesce(task_agg.max_priority_rank, 0),
    task_agg.max_priority
  into
    v_task_ids,
    v_task_basis,
    v_task_priority_rank,
    v_task_priority
  from task_agg;

  v_has_operational_blocker := coalesce(pg_catalog.array_length(v_task_ids, 1), 0) > 0;

  if v_has_operational_blocker then
    v_reason_codes := pg_catalog.array_append(v_reason_codes, 'operational_blocker');
  end if;

  if v_task_priority_rank >= 4 then
    v_reason_codes := pg_catalog.array_append(v_reason_codes, 'operational_task_urgent');
  elsif v_task_priority_rank = 3 then
    v_reason_codes := pg_catalog.array_append(v_reason_codes, 'operational_task_high');
  end if;

  select
    appointment_row.scheduled_start < v_as_of,
    appointment_row.scheduled_start,
    appointment_row.id
  into
    v_has_overdue_commitment,
    v_next_commitment_at,
    v_next_commitment_id
  from public.store_appointments appointment_row
  where appointment_row.organization_id = p_organization_id
    and appointment_row.store_id = p_store_id
    and appointment_row.commercial_opportunity_id = p_commercial_opportunity_id
    and appointment_row.commercial_opportunity_lifecycle_cycle =
      v_opportunity.lifecycle_cycle
    and appointment_row.status in ('scheduled', 'rescheduled')
  order by
    case when appointment_row.scheduled_start < v_as_of then 0 else 1 end,
    case
      when appointment_row.scheduled_start < v_as_of
        then appointment_row.scheduled_start
      else null
    end asc nulls last,
    case
      when appointment_row.scheduled_start >= v_as_of
        then appointment_row.scheduled_start
      else null
    end asc nulls last,
    appointment_row.id
  limit 1;

  v_has_overdue_commitment := coalesce(v_has_overdue_commitment, false);

  if v_has_overdue_commitment then
    v_reason_codes := pg_catalog.array_append(v_reason_codes, 'overdue_commitment');
  elsif v_next_commitment_at is not null then
    v_reason_codes := pg_catalog.array_append(v_reason_codes, 'next_commitment');
  end if;

  select
    true,
    followup_row.next_action_at,
    followup_row.id,
    followup_row.cycle
  into
    v_has_due_followup,
    v_followup_next_action_at,
    v_followup_id,
    v_followup_cycle
  from public.commercial_opportunity_followups followup_row
  where followup_row.organization_id = p_organization_id
    and followup_row.store_id = p_store_id
    and followup_row.commercial_opportunity_id = p_commercial_opportunity_id
    and followup_row.status = 'active'
    and followup_row.next_action_at is not null
    and followup_row.next_action_at <= v_as_of
  order by followup_row.next_action_at asc, followup_row.id
  limit 1;

  v_has_due_followup := coalesce(v_has_due_followup, false);

  if v_has_due_followup then
    v_reason_codes := pg_catalog.array_append(v_reason_codes, 'due_followup');
  end if;

  if v_opportunity.current_quote_id is not null
     and v_opportunity.current_quote_version_id is not null then
    select
      quote_row.total_cents,
      true
    into
      v_current_quote_total_cents,
      v_current_quote_valid
    from public.sales_quotes quote_row
    join public.sales_quote_versions version_row
      on version_row.id = v_opportunity.current_quote_version_id
     and version_row.quote_id = quote_row.id
     and version_row.organization_id = quote_row.organization_id
     and version_row.store_id = quote_row.store_id
    where quote_row.id = v_opportunity.current_quote_id
      and quote_row.organization_id = p_organization_id
      and quote_row.store_id = p_store_id
      and quote_row.commercial_opportunity_id = p_commercial_opportunity_id
      and version_row.sent_at is not null
      and pg_catalog.lower(pg_catalog.btrim(version_row.status))
        in ('sent', 'superseded');

    if not found then
      v_current_quote_total_cents := null;
      v_current_quote_valid := false;
      v_reason_codes := pg_catalog.array_append(v_reason_codes, 'current_quote_authority_unproven');
    else
      if v_opportunity.lifecycle_cycle > 1 then
        v_current_quote_total_cents := null;
        v_current_quote_valid := false;
        v_reason_codes := pg_catalog.array_append(v_reason_codes, 'quote_current_proposal_cycle_unanchored');
      else
        v_reason_codes := pg_catalog.array_append(v_reason_codes, 'current_quote_authority_valid');
      end if;
    end if;
  elsif v_opportunity.current_quote_id is not null
        or v_opportunity.current_quote_version_id is not null then
    v_reason_codes := pg_catalog.array_append(v_reason_codes, 'current_quote_pointer_incomplete');
  else
    v_reason_codes := pg_catalog.array_append(v_reason_codes, 'current_quote_unknown');
  end if;

  if v_is_terminal then
    v_priority_band := 'low';
    v_priority_rank := 0;
    v_reason_codes := pg_catalog.array_append(v_reason_codes, 'terminal_stage');
  elsif v_has_overdue_commitment or v_task_priority_rank >= 4 then
    v_priority_band := 'urgent';
    v_priority_rank := 90;
  elsif v_customer_waiting or v_task_priority_rank = 3 or v_has_due_followup then
    v_priority_band := 'high';
    v_priority_rank := 70;
  elsif v_next_commitment_at is not null or v_has_operational_blocker then
    v_priority_band := 'normal';
    v_priority_rank := 50;
  else
    v_priority_band := 'low';
    v_priority_rank := 30;
  end if;

  v_rank_critical := case
    when v_is_terminal then -1
    when v_has_overdue_commitment then 3
    when v_task_priority_rank >= 4 then 2
    else 0
  end;

  v_rank_attention := case
    when v_customer_waiting then 3
    when v_task_priority_rank = 3 then 2
    when v_has_due_followup then 1
    else 0
  end;

  reason_codes := array(
    select distinct reason_code
    from unnest(v_reason_codes) reason_code
    where reason_code is not null and reason_code <> ''
    order by reason_code
  );

  return query
  select
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_opportunity.id,
    v_opportunity.lifecycle_cycle,
    v_opportunity.stage,
    v_priority_band,
    v_priority_rank,
    v_rank_critical,
    v_rank_attention,
    v_next_commitment_at,
    (
      select min((task_item ->> 'target_start_at')::timestamptz)
      from jsonb_array_elements(v_task_basis) task_item
      where task_item ? 'target_start_at'
        and task_item ->> 'target_start_at' is not null
    ),
    v_current_quote_total_cents,
    v_stage_rank,
    v_customer_waiting,
    case when v_customer_waiting then v_last_customer_message_at else null end,
    v_last_customer_message_at,
    v_last_outbound_message_at,
    v_has_operational_blocker,
    v_task_priority,
    v_task_priority_rank,
    v_task_ids,
    v_task_basis,
    v_has_overdue_commitment,
    v_next_commitment_at,
    v_next_commitment_id,
    v_has_due_followup,
    v_followup_next_action_at,
    v_followup_id,
    v_followup_cycle,
    case when v_current_quote_valid then v_opportunity.current_quote_id else null end,
    case when v_current_quote_valid then v_opportunity.current_quote_version_id else null end,
    v_current_quote_total_cents,
    reason_codes,
    jsonb_build_object(
      'authority', 'p9_commercial_opportunity_priority_v1',
      'ordering', jsonb_build_array(
        'rank_critical desc',
        'rank_attention desc',
        'rank_next_commitment_due_at asc nulls last',
        'rank_next_task_due_at asc nulls last',
        'rank_current_quote_total_cents desc nulls last',
        'rank_stage desc',
        'commercial_opportunity_id asc'
      ),
      'signals', jsonb_build_object(
        'customer_waiting', 'messages joined by captured commercial_session_context_link_id for the exact opportunity',
        'operational_tasks', 'store_assistant_operational_tasks exact organization/store/opportunity and open statuses',
        'commitments', 'store_appointments exact opportunity and current lifecycle cycle',
        'followup', 'commercial_opportunity_followups unique active follow-up for exact opportunity; follow-up cycle is independent from opportunity lifecycle cycle',
        'impact', 'commercial_opportunities.current_quote_id/current_quote_version_id with scoped quote/version validation'
      )
    ),
    v_as_of;
end;
$function$;

comment on function public.p9_resolve_commercial_opportunity_priority_internal(uuid,uuid,uuid,timestamp with time zone) is
  'P9 5.4 canonical commercial opportunity priority resolver. Reason codes use explicit array_append semantics.';

commit;

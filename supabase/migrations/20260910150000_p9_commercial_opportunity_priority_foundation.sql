begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:b5:e5.4:commercial-opportunity-priority-foundation:v1',
    0
  )
);

do $preflight$
declare
  v_relation text;
  v_column record;
begin
  foreach v_relation in array array[
    'public.commercial_opportunities',
    'public.commercial_session_context_links',
    'public.messages',
    'public.store_appointments',
    'public.store_assistant_operational_tasks',
    'public.commercial_opportunity_followups',
    'public.sales_quotes',
    'public.sales_quote_versions',
    'public.memberships',
    'public.stores'
  ] loop
    if pg_catalog.to_regclass(v_relation) is null then
      raise exception using
        errcode = 'P0001',
        message = 'precondition failed: required relation missing: ' || v_relation;
    end if;
  end loop;

  for v_column in
    select *
    from (
      values
        ('commercial_opportunities'::text, 'id'::text),
        ('commercial_opportunities', 'organization_id'),
        ('commercial_opportunities', 'store_id'),
        ('commercial_opportunities', 'stage'),
        ('commercial_opportunities', 'lifecycle_cycle'),
        ('commercial_opportunities', 'current_quote_id'),
        ('commercial_opportunities', 'current_quote_version_id'),
        ('commercial_session_context_links', 'id'),
        ('commercial_session_context_links', 'organization_id'),
        ('commercial_session_context_links', 'store_id'),
        ('commercial_session_context_links', 'commercial_opportunity_id'),
        ('commercial_session_context_links', 'status'),
        ('messages', 'id'),
        ('messages', 'organization_id'),
        ('messages', 'store_id'),
        ('messages', 'conversation_id'),
        ('messages', 'commercial_session_context_link_id'),
        ('messages', 'sender'),
        ('messages', 'direction'),
        ('messages', 'created_at'),
        ('messages', 'deleted_at'),
        ('store_appointments', 'id'),
        ('store_appointments', 'organization_id'),
        ('store_appointments', 'store_id'),
        ('store_appointments', 'commercial_opportunity_id'),
        ('store_appointments', 'commercial_opportunity_lifecycle_cycle'),
        ('store_appointments', 'status'),
        ('store_appointments', 'scheduled_start'),
        ('store_appointments', 'scheduled_end'),
        ('store_assistant_operational_tasks', 'id'),
        ('store_assistant_operational_tasks', 'organization_id'),
        ('store_assistant_operational_tasks', 'store_id'),
        ('store_assistant_operational_tasks', 'commercial_opportunity_id'),
        ('store_assistant_operational_tasks', 'status'),
        ('store_assistant_operational_tasks', 'priority'),
        ('store_assistant_operational_tasks', 'target_start_at'),
        ('commercial_opportunity_followups', 'id'),
        ('commercial_opportunity_followups', 'organization_id'),
        ('commercial_opportunity_followups', 'store_id'),
        ('commercial_opportunity_followups', 'commercial_opportunity_id'),
        ('commercial_opportunity_followups', 'cycle'),
        ('commercial_opportunity_followups', 'status'),
        ('commercial_opportunity_followups', 'next_action_at'),
        ('sales_quotes', 'id'),
        ('sales_quotes', 'organization_id'),
        ('sales_quotes', 'store_id'),
        ('sales_quotes', 'commercial_opportunity_id'),
        ('sales_quotes', 'current_version_id'),
        ('sales_quotes', 'total_cents'),
        ('sales_quote_versions', 'id'),
        ('sales_quote_versions', 'quote_id'),
        ('sales_quote_versions', 'organization_id'),
        ('sales_quote_versions', 'store_id'),
        ('sales_quote_versions', 'status'),
        ('sales_quote_versions', 'sent_at'),
        ('memberships', 'organization_id'),
        ('memberships', 'user_id'),
        ('memberships', 'is_active'),
        ('stores', 'id'),
        ('stores', 'organization_id')
    ) as expected(table_name, column_name)
  loop
    if not exists (
      select 1
      from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = v_column.table_name
        and column_row.column_name = v_column.column_name
    ) then
      raise exception using
        errcode = 'P0001',
        message = format(
          'precondition failed: public.%s.%s is missing',
          v_column.table_name,
          v_column.column_name
        );
    end if;
  end loop;
end
$preflight$;

create or replace function public.p9_priority_task_rank_internal(p_priority text)
returns integer
language sql
immutable
strict
set search_path = pg_catalog, pg_temp, public
as $function$
  select case pg_catalog.lower(pg_catalog.btrim(p_priority))
    when 'urgent' then 4
    when 'high' then 3
    when 'normal' then 2
    when 'low' then 1
    else 0
  end;
$function$;

create or replace function public.p9_priority_stage_rank_internal(p_stage text)
returns integer
language sql
immutable
strict
set search_path = pg_catalog, pg_temp, public
as $function$
  select case pg_catalog.lower(pg_catalog.btrim(p_stage))
    when 'fechamento_pagamento' then 8
    when 'negociacao' then 7
    when 'visita_tecnica' then 6
    when 'orcamento' then 5
    when 'qualificacao' then 4
    when 'novo_lead' then 3
    when 'instalacao_entrega' then 2
    when 'pos_venda' then 1
    else 0
  end;
$function$;

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
    v_reason_codes := v_reason_codes || 'customer_waiting';
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
    v_reason_codes := v_reason_codes || 'operational_blocker';
  end if;

  if v_task_priority_rank >= 4 then
    v_reason_codes := v_reason_codes || 'operational_task_urgent';
  elsif v_task_priority_rank = 3 then
    v_reason_codes := v_reason_codes || 'operational_task_high';
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
    v_reason_codes := v_reason_codes || 'overdue_commitment';
  elsif v_next_commitment_at is not null then
    v_reason_codes := v_reason_codes || 'next_commitment';
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
    v_reason_codes := v_reason_codes || 'due_followup';
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
      v_reason_codes := v_reason_codes || 'current_quote_authority_unproven';
    else
      if v_opportunity.lifecycle_cycle > 1 then
        v_current_quote_total_cents := null;
        v_current_quote_valid := false;
        v_reason_codes :=
          v_reason_codes || 'quote_current_proposal_cycle_unanchored';
      else
        v_reason_codes :=
          v_reason_codes || 'current_quote_authority_valid';
      end if;
    end if;
  elsif v_opportunity.current_quote_id is not null
        or v_opportunity.current_quote_version_id is not null then
    v_reason_codes := v_reason_codes || 'current_quote_pointer_incomplete';
  else
    v_reason_codes := v_reason_codes || 'current_quote_unknown';
  end if;

  if v_is_terminal then
    v_priority_band := 'low';
    v_priority_rank := 0;
    v_reason_codes := v_reason_codes || 'terminal_stage';
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

create or replace function public.panel_list_commercial_opportunity_priority_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_limit integer default 50,
  p_offset integer default 0,
  p_as_of timestamptz default null
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
  has_operational_blocker boolean,
  highest_operational_task_priority text,
  operational_task_ids uuid[],
  has_overdue_commitment boolean,
  next_commitment_at timestamptz,
  next_commitment_id uuid,
  has_due_followup boolean,
  followup_next_action_at timestamptz,
  followup_id uuid,
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
  v_user_id uuid := auth.uid();
  v_request_role text :=
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
  v_limit integer;
  v_offset integer;
  v_as_of timestamptz := coalesce(p_as_of, pg_catalog.clock_timestamp());
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity priority reader is not authorized';
  end if;

  if p_organization_id is null or p_store_id is null then
    raise exception using
      errcode = '22004',
      message = 'commercial opportunity priority reader scope is incomplete';
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
      message = 'commercial opportunity priority reader is not authorized';
  end if;

  if not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_organization_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'commercial opportunity priority reader store scope not found';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
  with active_opportunities as (
    select opportunity_row.id
    from public.commercial_opportunities opportunity_row
    where opportunity_row.organization_id = p_organization_id
      and opportunity_row.store_id = p_store_id
      and pg_catalog.lower(pg_catalog.btrim(opportunity_row.stage))
        not in ('perdido', 'concluido_sem_mais_acoes')
  ),
  priority_rows as (
    select priority_row.*
    from active_opportunities opportunity_row
    cross join lateral public.p9_resolve_commercial_opportunity_priority_internal(
      p_organization_id,
      p_store_id,
      opportunity_row.id,
      v_as_of
    ) priority_row
  )
  select
    priority_rows.organization_id,
    priority_rows.store_id,
    priority_rows.commercial_opportunity_id,
    priority_rows.lifecycle_cycle,
    priority_rows.opportunity_stage,
    priority_rows.priority_band,
    priority_rows.priority_rank,
    priority_rows.rank_critical,
    priority_rows.rank_attention,
    priority_rows.rank_next_commitment_due_at,
    priority_rows.rank_next_task_due_at,
    priority_rows.rank_current_quote_total_cents,
    priority_rows.rank_stage,
    priority_rows.has_customer_waiting,
    priority_rows.customer_waiting_since,
    priority_rows.has_operational_blocker,
    priority_rows.highest_operational_task_priority,
    priority_rows.operational_task_ids,
    priority_rows.has_overdue_commitment,
    priority_rows.next_commitment_at,
    priority_rows.next_commitment_id,
    priority_rows.has_due_followup,
    priority_rows.followup_next_action_at,
    priority_rows.followup_id,
    priority_rows.current_quote_id,
    priority_rows.current_quote_version_id,
    priority_rows.current_quote_total_cents,
    priority_rows.reason_codes,
    priority_rows.authority_basis,
    priority_rows.evaluated_as_of
  from priority_rows
  order by
    priority_rows.rank_critical desc,
    priority_rows.rank_attention desc,
    priority_rows.rank_next_commitment_due_at asc nulls last,
    priority_rows.rank_next_task_due_at asc nulls last,
    priority_rows.rank_current_quote_total_cents desc nulls last,
    priority_rows.rank_stage desc,
    priority_rows.commercial_opportunity_id asc
  limit v_limit
  offset v_offset;
end;
$function$;

alter function public.p9_priority_task_rank_internal(text) owner to postgres;
alter function public.p9_priority_stage_rank_internal(text) owner to postgres;
alter function public.p9_resolve_commercial_opportunity_priority_internal(
  uuid,
  uuid,
  uuid,
  timestamptz
) owner to postgres;
alter function public.panel_list_commercial_opportunity_priority_scoped(
  uuid,
  uuid,
  integer,
  integer,
  timestamptz
) owner to postgres;

revoke all on function public.p9_priority_task_rank_internal(text)
  from public, anon, authenticated, service_role;
revoke all on function public.p9_priority_stage_rank_internal(text)
  from public, anon, authenticated, service_role;
revoke all on function public.p9_resolve_commercial_opportunity_priority_internal(
  uuid,
  uuid,
  uuid,
  timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.panel_list_commercial_opportunity_priority_scoped(
  uuid,
  uuid,
  integer,
  integer,
  timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.panel_list_commercial_opportunity_priority_scoped(
  uuid,
  uuid,
  integer,
  integer,
  timestamptz
) to authenticated;

comment on function public.p9_resolve_commercial_opportunity_priority_internal(
  uuid,
  uuid,
  uuid,
  timestamptz
) is
  'P9 5.4 internal read-only commercial opportunity priority resolver. Exact organization/store/opportunity scope only; explicit p_as_of; no stage/lost/followup writes.';

comment on function public.panel_list_commercial_opportunity_priority_scoped(
  uuid,
  uuid,
  integer,
  integer,
  timestamptz
) is
  'P9 5.4 scoped human reader for active commercial opportunity priority order. It delegates priority semantics to p9_resolve_commercial_opportunity_priority_internal.';

do $postconditions$
declare
  v_internal_definition text;
  v_reader_definition text;
begin
  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(
        'public.p9_resolve_commercial_opportunity_priority_internal(uuid,uuid,uuid,timestamp with time zone)'::pg_catalog.regprocedure
      ),
      '\s+',
      ' ',
      'g'
    )
  )
  into v_internal_definition;

  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(
        'public.panel_list_commercial_opportunity_priority_scoped(uuid,uuid,integer,integer,timestamp with time zone)'::pg_catalog.regprocedure
      ),
      '\s+',
      ' ',
      'g'
    )
  )
  into v_reader_definition;

  if v_internal_definition like '% update public.commercial_opportunities %'
     or v_internal_definition like '%insert into public.commercial_opportunities%'
     or v_internal_definition like '%stage =%'
     or v_internal_definition like '%perdido%set%'
     or v_internal_definition like '%activate_commercial_opportunity_followup%'
     or v_internal_definition like '%opt_out_commercial_opportunity_followup%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: priority resolver must remain read-only';
  end if;

  if v_internal_definition not like '%commercial_session_context_link_id%'
     or v_internal_definition not like '%commercial_opportunity_lifecycle_cycle%'
     or v_internal_definition not like '%current_quote_id%'
     or v_internal_definition not like '%current_quote_version_id%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: priority resolver missing canonical signals';
  end if;

  if v_reader_definition not like '%p9_resolve_commercial_opportunity_priority_internal%'
     or v_reader_definition not like '%rank_critical desc%'
     or v_reader_definition not like '%rank_attention desc%'
     or v_reader_definition not like '%limit v_limit%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: priority reader does not delegate and order canonically';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.p9_resolve_commercial_opportunity_priority_internal(uuid,uuid,uuid,timestamp with time zone)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.p9_resolve_commercial_opportunity_priority_internal(uuid,uuid,uuid,timestamp with time zone)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: internal priority resolver leaked execute privilege';
  end if;
end
$postconditions$;

commit;

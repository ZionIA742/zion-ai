create or replace function public.read_commercial_conversation_fact_events_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_lead_id uuid,
  p_conversation_session_id uuid,
  p_commercial_session_context_link_id uuid default null,
  p_commercial_opportunity_id uuid default null
)
returns table (
  event_id uuid,
  organization_id uuid,
  store_id uuid,
  conversation_id uuid,
  lead_id uuid,
  conversation_session_id uuid,
  commercial_session_context_link_id uuid,
  commercial_opportunity_id uuid,
  fact_key text,
  value_json jsonb,
  operation_key text,
  event_kind text,
  supersedes_event_id uuid,
  source_message_id uuid,
  source_media_type text,
  actor_type text,
  evidence_level text,
  created_at timestamptz,
  conflict_state text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  v_context_opportunity_id uuid;
  v_opportunity_origin_lead_id uuid;
begin
  if (v_request_role is distinct from 'service_role') and session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'commercial conversation fact reader is server-only';
  end if;

  if not exists (
    select 1 from public.conversations c
    join public.leads l on l.id = c.lead_id and l.organization_id = c.organization_id
    where c.id = p_conversation_id and c.organization_id = p_organization_id
      and c.lead_id = p_lead_id and l.store_id = p_store_id
  ) or not exists (
    select 1 from public.conversation_sessions s
    where s.id = p_conversation_session_id and s.organization_id = p_organization_id
      and s.store_id = p_store_id and s.conversation_id = p_conversation_id
  ) then
    raise exception using errcode = '42501', message = 'commercial conversation fact reader scope mismatch';
  end if;

  if p_commercial_session_context_link_id is not null then
    select l.commercial_opportunity_id
      into v_context_opportunity_id
    from public.commercial_session_context_links l
    where l.id = p_commercial_session_context_link_id
      and l.organization_id = p_organization_id
      and l.store_id = p_store_id
      and l.conversation_session_id = p_conversation_session_id;
    if not found
       or p_commercial_opportunity_id is null
       or v_context_opportunity_id is distinct from p_commercial_opportunity_id then
      raise exception using errcode = '42501', message = 'commercial conversation fact reader context mismatch';
    end if;
  end if;

  if p_commercial_opportunity_id is not null then
    select o.origin_lead_id
      into v_opportunity_origin_lead_id
    from public.commercial_opportunities o
    where o.id = p_commercial_opportunity_id
      and o.organization_id = p_organization_id
      and o.store_id = p_store_id;
    if not found or v_opportunity_origin_lead_id is distinct from p_lead_id then
      raise exception using errcode = '42501', message = 'commercial conversation fact reader opportunity mismatch';
    end if;
  end if;

  return query
  with scoped_events as (
    select e.*
    from public.commercial_conversation_fact_events e
    where e.organization_id = p_organization_id
      and e.store_id = p_store_id
      and e.conversation_id = p_conversation_id
      and e.lead_id = p_lead_id
      and e.conversation_session_id = p_conversation_session_id
      and (p_commercial_session_context_link_id is null
           or e.commercial_session_context_link_id = p_commercial_session_context_link_id)
      and (
        (p_commercial_opportunity_id is null and e.commercial_opportunity_id is null)
        or (
          p_commercial_opportunity_id is not null
          and (e.commercial_opportunity_id is null or e.commercial_opportunity_id = p_commercial_opportunity_id)
        )
      )
  ), distinct_values as (
    select distinct se.fact_key, se.commercial_opportunity_id, se.value_json
    from scoped_events se
  ), value_counts as (
    select dv.fact_key, dv.commercial_opportunity_id, count(*) as distinct_value_count
    from distinct_values dv
    group by dv.fact_key, dv.commercial_opportunity_id
  )
  select e.id, e.organization_id, e.store_id, e.conversation_id, e.lead_id,
    e.conversation_session_id, e.commercial_session_context_link_id,
    e.commercial_opportunity_id, e.fact_key, e.value_json, e.operation_key,
    e.event_kind, e.supersedes_event_id, e.source_message_id, e.source_media_type,
    e.actor_type, e.evidence_level, e.created_at,
    case when vc.distinct_value_count > 1 then 'conflict' else 'consistent' end::text
  from scoped_events e
  join value_counts vc
    on vc.fact_key = e.fact_key
   and vc.commercial_opportunity_id is not distinct from e.commercial_opportunity_id
  order by e.created_at, e.id;
end;
$function$;

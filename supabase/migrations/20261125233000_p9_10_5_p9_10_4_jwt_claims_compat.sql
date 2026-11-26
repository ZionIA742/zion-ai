-- ZION P19-A / 4-T5-D.3-F.6-B
-- Canonical auth.role() compatibility repair for the five confirmed authorities.
-- No helper definition or ACL is changed by this migration.
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local search_path = pg_catalog, pg_temp, public, auth;
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('zion:p9:10:5:jwt-claims-compat:v5', 0));

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
  v_context_opportunity_id uuid;
  v_opportunity_origin_lead_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
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

create or replace function public.write_commercial_conversation_fact_event_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_lead_id uuid,
  p_conversation_session_id uuid,
  p_commercial_session_context_link_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation_key text,
  p_fact_key text,
  p_value_json jsonb,
  p_source_message_id uuid,
  p_source_media_type text,
  p_actor_type text,
  p_evidence_level text,
  p_event_kind text default 'assertion',
  p_supersedes_event_id uuid default null
)
returns table (
  event_id uuid,
  outcome text,
  operation_key text,
  fact_key text,
  conflict_group_key text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_operation_key text := nullif(btrim(coalesce(p_operation_key, '')), '');
  v_fact_key text := nullif(btrim(coalesce(p_fact_key, '')), '');
  v_media_type text := lower(nullif(btrim(coalesce(p_source_media_type, '')), ''));
  v_actor_type text := lower(nullif(btrim(coalesce(p_actor_type, '')), ''));
  v_evidence_level text := lower(nullif(btrim(coalesce(p_evidence_level, '')), ''));
  v_event_kind text := lower(nullif(btrim(coalesce(p_event_kind, 'assertion')), ''));
  v_existing public.commercial_conversation_fact_events%rowtype;
  v_message public.messages%rowtype;
  v_conversation_lead_id uuid;
  v_lead_store_id uuid;
  v_context_opportunity_id uuid;
  v_opportunity_origin_lead_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'commercial conversation fact writer is server-only';
  end if;

  if p_organization_id is null or p_store_id is null or p_conversation_id is null
     or p_lead_id is null or p_conversation_session_id is null
     or p_source_message_id is null or p_value_json is null
     or v_operation_key is null or v_fact_key is null then
    raise exception using errcode = '23514', message = 'commercial conversation fact scope or provenance is incomplete';
  end if;

  if v_media_type not in ('text', 'audio', 'image', 'video', 'document')
     or v_actor_type not in ('customer', 'human', 'assistant', 'system')
     or v_evidence_level not in ('declared', 'confirmed', 'inferred', 'conflict')
     or v_event_kind not in ('assertion', 'correction', 'conflict_resolution')
     or p_value_json = 'null'::jsonb then
    raise exception using errcode = '23514', message = 'commercial conversation fact payload is invalid';
  end if;

  select c.lead_id, l.store_id
    into v_conversation_lead_id, v_lead_store_id
  from public.conversations c
  join public.leads l on l.id = c.lead_id
                       and l.organization_id = c.organization_id
  where c.id = p_conversation_id
    and c.organization_id = p_organization_id;

  if not found or v_conversation_lead_id is distinct from p_lead_id
     or v_lead_store_id is distinct from p_store_id then
    raise exception using errcode = '42501', message = 'commercial conversation fact conversation lead scope mismatch';
  end if;

  if not exists (
    select 1
    from public.conversation_sessions s
    where s.id = p_conversation_session_id
      and s.organization_id = p_organization_id
      and s.store_id = p_store_id
      and s.conversation_id = p_conversation_id
  ) then
    raise exception using errcode = '42501', message = 'commercial conversation fact session scope mismatch';
  end if;

  select m.* into v_message
  from public.messages m
  where m.id = p_source_message_id
    and m.organization_id = p_organization_id
    and m.store_id = p_store_id
    and m.conversation_id = p_conversation_id
    and m.lead_id = p_lead_id;

  if not found then
    raise exception using errcode = '42501', message = 'commercial conversation fact source message scope mismatch';
  end if;

  if v_media_type is distinct from lower(v_message.message_type) then
    raise exception using errcode = '23514', message = 'commercial conversation fact media type mismatch';
  end if;

  if (v_actor_type = 'customer' and (v_message.sender <> 'user' or v_message.direction <> 'incoming'))
     or (v_actor_type = 'human' and v_message.sender <> 'human')
     or (v_actor_type = 'assistant' and v_message.sender <> 'ai') then
    raise exception using errcode = '23514', message = 'commercial conversation fact actor provenance mismatch';
  end if;

  if p_commercial_session_context_link_id is not null then
    select l.commercial_opportunity_id
      into v_context_opportunity_id
    from public.commercial_session_context_links l
    where l.id = p_commercial_session_context_link_id
      and l.organization_id = p_organization_id
      and l.store_id = p_store_id
      and l.conversation_session_id = p_conversation_session_id
      and l.status = 'active';
    if not found then
      raise exception using errcode = '42501', message = 'commercial conversation fact context link scope mismatch';
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
      raise exception using errcode = '42501', message = 'commercial conversation fact opportunity lead scope mismatch';
    end if;
    if v_context_opportunity_id is distinct from p_commercial_opportunity_id
       and p_commercial_session_context_link_id is not null then
      raise exception using errcode = '42501', message = 'commercial conversation fact opportunity context mismatch';
    end if;
  elsif p_commercial_session_context_link_id is not null then
    raise exception using errcode = '23514', message = 'commercial conversation fact context requires opportunity';
  end if;

  if p_supersedes_event_id is not null and not exists (
    select 1
    from public.commercial_conversation_fact_events e
    where e.id = p_supersedes_event_id
      and e.organization_id = p_organization_id
      and e.store_id = p_store_id
      and e.conversation_id = p_conversation_id
      and e.lead_id = p_lead_id
      and e.conversation_session_id = p_conversation_session_id
      and e.fact_key = v_fact_key
      and (
        (
          e.commercial_opportunity_id is not distinct from p_commercial_opportunity_id
          and e.commercial_session_context_link_id is not distinct from p_commercial_session_context_link_id
        )
        or (
          e.commercial_opportunity_id is null
          and e.commercial_session_context_link_id is null
          and p_commercial_opportunity_id is not null
          and p_commercial_session_context_link_id is not null
          and v_context_opportunity_id is not distinct from p_commercial_opportunity_id
        )
      )
  ) then
    raise exception using errcode = '42501', message = 'commercial conversation fact superseded event scope mismatch';
  end if;

  select * into v_existing
  from public.commercial_conversation_fact_events e
  where e.organization_id = p_organization_id
    and e.store_id = p_store_id
    and e.operation_key = v_operation_key
  for update;

  if found then
    if v_existing.conversation_id is distinct from p_conversation_id
       or v_existing.lead_id is distinct from p_lead_id
       or v_existing.conversation_session_id is distinct from p_conversation_session_id
       or v_existing.commercial_session_context_link_id is distinct from p_commercial_session_context_link_id
       or v_existing.commercial_opportunity_id is distinct from p_commercial_opportunity_id
       or v_existing.fact_key is distinct from v_fact_key
       or v_existing.value_json is distinct from p_value_json
       or v_existing.source_message_id is distinct from p_source_message_id
       or v_existing.source_media_type is distinct from v_media_type
       or v_existing.actor_type is distinct from v_actor_type
       or v_existing.evidence_level is distinct from v_evidence_level
       or v_existing.event_kind is distinct from v_event_kind
       or v_existing.supersedes_event_id is distinct from p_supersedes_event_id then
      raise exception using errcode = '23505', message = 'commercial conversation fact operation key collision';
    end if;
    return query select v_existing.id, 'replayed'::text, v_existing.operation_key,
      v_existing.fact_key, v_existing.fact_key, v_existing.created_at;
    return;
  end if;

  insert into public.commercial_conversation_fact_events as inserted (
    organization_id, store_id, conversation_id, lead_id, conversation_session_id,
    commercial_session_context_link_id, commercial_opportunity_id, fact_key,
    value_json, operation_key, event_kind, supersedes_event_id, source_message_id,
    source_media_type, actor_type, evidence_level, created_at
  ) values (
    p_organization_id, p_store_id, p_conversation_id, p_lead_id, p_conversation_session_id,
    p_commercial_session_context_link_id, p_commercial_opportunity_id, v_fact_key,
    p_value_json, v_operation_key, v_event_kind, p_supersedes_event_id, p_source_message_id,
    v_media_type, v_actor_type, v_evidence_level, v_now
  ) returning inserted.id, inserted.created_at
    into event_id, created_at;

  operation_key := v_operation_key;
  fact_key := v_fact_key;
  conflict_group_key := v_fact_key;
  outcome := 'created';

  return next;
end;
$function$;

create or replace function public.p9_10_4_d_assert_recovery_write_authority(
  p_organization_id uuid,p_store_id uuid,p_conversation_id uuid,
  p_commercial_opportunity_id uuid default null
) returns void language plpgsql security definer
set search_path=pg_catalog,pg_temp,public set row_security=off
as $function$
declare v_c public.conversations%rowtype; v_h public.conversation_human_takeover_leases%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_SYSTEM_ROLE_REQUIRED';
  end if;
  if p_commercial_opportunity_id is not null then
    perform 1 from public.commercial_opportunities o where o.id=p_commercial_opportunity_id
      and o.organization_id=p_organization_id and o.store_id=p_store_id
      and o.primary_conversation_id=p_conversation_id for update;
    if not found then raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_OPPORTUNITY_SCOPE_MISMATCH'; end if;
  end if;
  perform public.private_acquire_sales_contract_conversation_xact_lock(p_conversation_id);
  select c.* into v_c from public.conversations c join public.leads l on l.id=c.lead_id
    and l.organization_id=p_organization_id and l.store_id=p_store_id join public.stores s
    on s.id=l.store_id and s.organization_id=l.organization_id where c.id=p_conversation_id
    and c.organization_id=p_organization_id for update of c;
  if not found then raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_SCOPE_MISMATCH'; end if;
  select h.* into v_h from public.conversation_human_takeover_leases h where h.conversation_id=p_conversation_id for update;
  if found and (v_h.organization_id is distinct from p_organization_id or v_h.store_id is distinct from p_store_id) then
    raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_LEASE_SCOPE_MISMATCH';
  end if;
  if coalesce(v_c.is_human_active,false) or lower(btrim(coalesce(v_c.status,'')))='humano_assumiu'
     or coalesce(v_h.hard_hold,false) or (found and v_h.released_at is null) then
    raise exception using errcode='P0001',message='P9_10_4_D_RECOVERY_BLOCKED_BY_HUMAN_CONTROL';
  end if;
end;
$function$;

create or replace function public.p9_10_4_d_assert_recovery_set_claim_authority(
  p_response_set_id uuid,p_queue_id uuid,p_claim_token uuid,p_organization_id uuid,p_store_id uuid,
  p_conversation_id uuid,p_anchor_message_id uuid,p_lead_id uuid default null,
  p_commercial_opportunity_id uuid default null
) returns void language plpgsql security definer
set search_path=pg_catalog,pg_temp,public set row_security=off
as $function$
declare q public.ai_run_queue%rowtype; s public.p19a_sales_ai_reply_sets%rowtype; anchor_created_at timestamptz; latest_anchor uuid; newer_human boolean; v_set_opp uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_SYSTEM_ROLE_REQUIRED';
  end if;
  if p_response_set_id is null or p_queue_id is null or p_claim_token is null or p_anchor_message_id is null
     or p_lead_id is null then
    raise exception using errcode='22023',message='P9_10_4_D_RECOVERY_BINDING_REQUIRED';
  end if;
  -- Resolve the confirmed ledger opportunity before taking canonical locks.
  select x.commercial_opportunity_id into v_set_opp
    from public.p19a_sales_ai_reply_sets x
   where x.id=p_response_set_id and x.organization_id=p_organization_id
     and x.store_id=p_store_id and x.conversation_id=p_conversation_id
     and x.anchor_message_id=p_anchor_message_id and x.materialization_state='confirmed'
     and x.confirmed_at is not null and x.payload->>'lead_id'=p_lead_id::text;
  if not found then
    raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_SET_BINDING_MISMATCH';
  end if;
  if p_commercial_opportunity_id is not null and p_commercial_opportunity_id is distinct from v_set_opp then
    raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_OPPORTUNITY_SCOPE_MISMATCH';
  end if;
  perform public.p9_10_4_d_assert_recovery_write_authority(
    p_organization_id,p_store_id,p_conversation_id,v_set_opp
  );
  if not exists (select 1 from public.conversations c join public.leads l on l.id=c.lead_id
    where c.id=p_conversation_id and c.organization_id=p_organization_id and c.lead_id=p_lead_id
      and l.organization_id=p_organization_id and l.store_id=p_store_id) then
    raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_LEAD_SCOPE_MISMATCH';
  end if;
  -- The worker may already hold this queue row while calling the central
  -- materializer. NOWAIT prevents queue -> conversation and conversation ->
  -- queue from becoming a deadlock cycle; the recovery worker retries safely.
  select x.* into q from public.ai_run_queue x where x.id=p_queue_id and x.organization_id=p_organization_id
    and x.store_id=p_store_id and x.claim_token=p_claim_token and x.processed_at is null for update nowait;
  if not found then raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_QUEUE_SCOPE_OR_TOKEN_MISMATCH'; end if;
  if q.claim_expires_at is null or q.claim_expires_at<=pg_catalog.clock_timestamp() then
    raise exception using errcode='P0001',message='P9_10_4_D_RECOVERY_CLAIM_EXPIRED'; end if;
  if q.input->>'type' is distinct from 'sales_ai_post_materialization_recovery'
     or (q.input->>'responseSetId')::uuid is distinct from p_response_set_id
     or (q.input->>'anchorMessageId')::uuid is distinct from p_anchor_message_id
     or q.conversation_id is distinct from p_conversation_id or q.lead_id is distinct from p_lead_id then
    raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_QUEUE_BINDING_MISMATCH'; end if;
  select m.created_at into anchor_created_at from public.messages m
   where m.id=p_anchor_message_id and m.organization_id=p_organization_id and m.store_id=p_store_id
     and m.conversation_id=p_conversation_id and m.sender='user' and m.direction='incoming'
     and m.deleted_at is null;
  if not found then raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_ANCHOR_STALE_OR_DELETED'; end if;
  select m.id into latest_anchor from public.messages m
   where m.organization_id=p_organization_id and m.store_id=p_store_id
     and m.conversation_id=p_conversation_id and m.sender='user' and m.direction='incoming'
     and m.deleted_at is null order by m.created_at desc,m.id desc limit 1;
  if latest_anchor is distinct from p_anchor_message_id then
    raise exception using errcode='P0001',message='P9_10_4_D_RECOVERY_ANCHOR_SUPERSEDED';
  end if;
  select exists(select 1 from public.messages m where m.organization_id=p_organization_id and m.store_id=p_store_id
    and m.conversation_id=p_conversation_id and m.deleted_at is null
    and m.sender='human' and m.direction='outgoing'
    and (m.created_at>anchor_created_at or (m.outbound_delivery_state='sent'
      and m.external_message_id is not null and m.outbound_provider_accepted_at>anchor_created_at))) into newer_human;
  if newer_human then raise exception using errcode='P0001',message='P9_10_4_D_RECOVERY_NEWER_HUMAN_MESSAGE'; end if;
  select x.* into s from public.p19a_sales_ai_reply_sets x where x.id=p_response_set_id
    and x.organization_id=p_organization_id and x.store_id=p_store_id and x.conversation_id=p_conversation_id
    and nullif(x.payload->>'lead_id','')::uuid=p_lead_id
    and x.anchor_message_id=p_anchor_message_id and x.materialization_state='confirmed'
    and x.confirmed_at is not null and x.commercial_opportunity_id is not distinct from v_set_opp for update;
  if not found then raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_SET_BINDING_MISMATCH'; end if;
end;
$function$;

create or replace function public.p9_10_4_d_assert_recovery_set_authority(
  p_response_set_id uuid,p_organization_id uuid,p_store_id uuid,p_conversation_id uuid,p_anchor_message_id uuid default null
) returns void language plpgsql security definer
set search_path=pg_catalog,pg_temp,public set row_security=off
as $function$
declare s public.p19a_sales_ai_reply_sets%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_SYSTEM_ROLE_REQUIRED';
  end if;
  perform public.p9_10_4_d_assert_recovery_write_authority(p_organization_id,p_store_id,p_conversation_id);
  select * into s from public.p19a_sales_ai_reply_sets where id=p_response_set_id and organization_id=p_organization_id
    and store_id=p_store_id and conversation_id=p_conversation_id and materialization_state='confirmed' for update;
  if not found then raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_SET_SCOPE_MISMATCH'; end if;
  if p_anchor_message_id is not null and s.anchor_message_id is distinct from p_anchor_message_id then
    raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_ANCHOR_MISMATCH'; end if;
end;
$function$;

alter function public.read_commercial_conversation_fact_events_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid) owner to postgres;
alter function public.write_commercial_conversation_fact_event_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid,text,text,text,text,uuid) owner to postgres;
alter function public.p9_10_4_d_assert_recovery_write_authority(uuid,uuid,uuid,uuid) owner to postgres;
alter function public.p9_10_4_d_assert_recovery_set_claim_authority(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid) owner to postgres;
alter function public.p9_10_4_d_assert_recovery_set_authority(uuid,uuid,uuid,uuid,uuid) owner to postgres;

revoke all on function public.read_commercial_conversation_fact_events_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.write_commercial_conversation_fact_event_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid,text,text,text,text,uuid) from public, anon, authenticated, service_role;
revoke all on function public.p9_10_4_d_assert_recovery_write_authority(uuid,uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.p9_10_4_d_assert_recovery_set_claim_authority(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.p9_10_4_d_assert_recovery_set_authority(uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated;

grant execute on function public.read_commercial_conversation_fact_events_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.write_commercial_conversation_fact_event_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid,text,text,text,text,uuid) to service_role;
grant execute on function public.p9_10_4_d_assert_recovery_write_authority(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.p9_10_4_d_assert_recovery_set_claim_authority(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.p9_10_4_d_assert_recovery_set_authority(uuid,uuid,uuid,uuid,uuid) to service_role;


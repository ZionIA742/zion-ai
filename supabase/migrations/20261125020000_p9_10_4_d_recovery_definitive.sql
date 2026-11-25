-- ZION P9 B10 5.3-I.6 definitive recovery consolidation.
-- The four uninstalled I.2/I.4 candidates are archived outside migrations;
-- this is the only installable recovery migration and remains disabled.
begin;
set local lock_timeout = '4s';
set local statement_timeout = '60s';

do $preflight$
declare v_name text;
begin
  foreach v_name in array array[
    'public.ai_run_queue','public.conversations','public.leads','public.stores',
    'public.messages','public.p19a_sales_ai_reply_sets',
    'public.conversation_human_takeover_leases','public.commercial_opportunities',
    'public.store_assistant_operational_tasks'
  ] loop
    if pg_catalog.to_regclass(v_name) is null then
      raise exception using errcode='P0001',message='P9_10_4_D_I4_REQUIRED_OBJECT_MISSING:'||v_name;
    end if;
  end loop;
end;
$preflight$;

do $canonical_lock_preflight$
declare v_oid oid := pg_catalog.to_regprocedure(
  'public.private_acquire_sales_contract_conversation_xact_lock(uuid)'
);
begin
  if v_oid is null then
    raise exception using errcode='P0001',message='P9_10_4_D_CANONICAL_CONVERSATION_LOCK_MISSING';
  end if;
  if pg_catalog.md5(pg_catalog.pg_get_functiondef(v_oid))<>'a5828f3d3d8a5ddb6bd5567106e02a5e' then
    raise exception using errcode='P0001',message='P9_10_4_D_CANONICAL_CONVERSATION_LOCK_BASELINE_DRIFT';
  end if;
end;
$canonical_lock_preflight$;

create table if not exists public.zion_p9_recovery_activation (
  singleton boolean primary key default true check (singleton),
  automatic_enqueue_enabled boolean not null default false,
  compatible_consumers_deployed boolean not null default false,
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);
insert into public.zion_p9_recovery_activation(singleton) values (true) on conflict do nothing;
alter table public.zion_p9_recovery_activation enable row level security;
revoke all on table public.zion_p9_recovery_activation from public,anon,authenticated;
grant select on table public.zion_p9_recovery_activation to service_role;

create or replace function public.p9_10_4_d_recovery_enqueue_enabled()
returns boolean language sql stable security definer
set search_path=pg_catalog,pg_temp,public set row_security=off
as $function$
select coalesce((select automatic_enqueue_enabled and compatible_consumers_deployed
  from public.zion_p9_recovery_activation where singleton),false)
$function$;
alter function public.p9_10_4_d_recovery_enqueue_enabled() owner to postgres;
revoke all on function public.p9_10_4_d_recovery_enqueue_enabled() from public,anon,authenticated;
grant execute on function public.p9_10_4_d_recovery_enqueue_enabled() to service_role;

-- Canonical order: opportunity -> conversation advisory lock -> conversation
-- row -> lease row. Lease is resolved by conversation before tenant checks.
create or replace function public.p9_10_4_d_assert_recovery_write_authority(
  p_organization_id uuid,p_store_id uuid,p_conversation_id uuid,
  p_commercial_opportunity_id uuid default null
) returns void language plpgsql security definer
set search_path=pg_catalog,pg_temp,public set row_security=off
as $function$
declare v_c public.conversations%rowtype; v_h public.conversation_human_takeover_leases%rowtype;
begin
  if session_user <> 'postgres' and
     coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'') <> 'service_role' then
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
  if session_user <> 'postgres' and
     coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'') <> 'service_role' then
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
  if session_user <> 'postgres' and
     coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'') <> 'service_role' then
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

-- Recovery CRM progress is a single transactional authority: validate the
-- caller's exact live claim, use the canonical opportunity writer, then invoke
-- the protected legacy conversation transition before returning.
create or replace function public.p9_10_4_d_transition_recovery_stage_by_system(
  p_response_set_id uuid,p_queue_id uuid,p_claim_token uuid,
  p_organization_id uuid,p_store_id uuid,p_conversation_id uuid,
  p_anchor_message_id uuid,p_lead_id uuid,p_commercial_opportunity_id uuid,
  p_idempotency_key text,p_target_stage text,p_reason_details text,
  p_evidence_type text,p_evidence_message_id uuid,p_evidence_summary text,
  p_source text
) returns table (
  commercial_opportunity_id uuid,stage text,lifecycle_cycle integer,
  lifecycle_event_id uuid,event_type text,reason_code text,
  stage_changed_at timestamptz,updated_at timestamptz
) language plpgsql security definer
set search_path=pg_catalog,pg_temp,public set row_security=off
as $function$
begin
  if p_commercial_opportunity_id is null then
    raise exception using errcode='22023',message='P9_10_4_D_RECOVERY_OPPORTUNITY_REQUIRED';
  end if;
  perform public.p9_10_4_d_assert_recovery_set_claim_authority(
    p_response_set_id,p_queue_id,p_claim_token,p_organization_id,p_store_id,
    p_conversation_id,p_anchor_message_id,p_lead_id,p_commercial_opportunity_id
  );
  select x.commercial_opportunity_id,x.stage,x.lifecycle_cycle,x.lifecycle_event_id,
         x.event_type,x.reason_code,x.stage_changed_at,x.updated_at
    into commercial_opportunity_id,stage,lifecycle_cycle,lifecycle_event_id,
         event_type,reason_code,stage_changed_at,updated_at
    from public.transition_commercial_opportunity_stage_by_system(
      p_organization_id,p_store_id,p_commercial_opportunity_id,p_idempotency_key,
      p_target_stage,p_reason_details,p_evidence_type,p_evidence_message_id,
      p_evidence_summary,p_source
    ) x;
  perform public.transition_conversation_state_internal(
    p_conversation_id,p_target_stage,
    case
      when p_evidence_type='incoming_customer_message'
        and p_target_stage='qualificacao'
        then 'auto_progress_from_ai_sales_qualification_signal'
      when p_evidence_type='commercial_handoff_task'
        and p_target_stage='qualificacao'
        then 'auto_progress_from_ai_sales_quote_request_prepare_qualification'
      when p_evidence_type='commercial_handoff_task'
        and p_target_stage='orcamento'
        then 'auto_progress_from_ai_sales_quote_request'
      else p_reason_details
    end,
    'ai',p_source,
    p_idempotency_key,jsonb_build_object(
      'recovery_response_set_id',p_response_set_id,
      'recovery_anchor_message_id',p_anchor_message_id
    )
  );
  return next;
end;
$function$;

alter function public.p9_10_4_d_transition_recovery_stage_by_system(
 uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,text
) owner to postgres;
revoke all on function public.p9_10_4_d_transition_recovery_stage_by_system(
 uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.p9_10_4_d_transition_recovery_stage_by_system(
 uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,text
) to service_role;

alter table public.conversation_ai_window_state add column if not exists p9_recovery_response_set_id uuid;
alter table public.store_assistant_threads add column if not exists p9_recovery_response_set_id uuid;

-- Window state has no durable claim-token columns. Recovery callers write it
-- through this transactional wrapper; only the response-set id is retained as
-- non-secret provenance.
create or replace function public.p9_10_4_d_write_recovery_window_state_by_system(
  p_response_set_id uuid,p_queue_id uuid,p_claim_token uuid,p_organization_id uuid,
  p_store_id uuid,p_conversation_id uuid,p_anchor_message_id uuid,p_lead_id uuid,
  p_patch jsonb
) returns void language plpgsql security definer
set search_path=pg_catalog,pg_temp,public set row_security=off
as $function$
begin
  perform public.p9_10_4_d_assert_recovery_set_claim_authority(
    p_response_set_id,p_queue_id,p_claim_token,p_organization_id,p_store_id,
    p_conversation_id,p_anchor_message_id,p_lead_id,null
  );
  update public.conversation_ai_window_state
     set waiting_next_day=coalesce((p_patch->>'waiting_next_day')::boolean,waiting_next_day),
         pending_supervisor=coalesce((p_patch->>'pending_supervisor')::boolean,pending_supervisor),
         last_ai_message_at=case when p_patch ? 'last_ai_message_at' then nullif(p_patch->>'last_ai_message_at','')::timestamptz else last_ai_message_at end,
         last_customer_message_at=case when p_patch ? 'last_customer_message_at' then nullif(p_patch->>'last_customer_message_at','')::timestamptz else last_customer_message_at end,
         next_resume_at=case when p_patch ? 'next_resume_at' then nullif(p_patch->>'next_resume_at','')::timestamptz else next_resume_at end,
         resume_reason=case when p_patch ? 'resume_reason' then p_patch->>'resume_reason' else resume_reason end,
         p9_recovery_response_set_id=p_response_set_id,
         updated_at=coalesce(nullif(p_patch->>'updated_at','')::timestamptz,clock_timestamp())
   where conversation_id=p_conversation_id and organization_id=p_organization_id and store_id=p_store_id;
  if not found then
    insert into public.conversation_ai_window_state(
      conversation_id,organization_id,store_id,waiting_next_day,pending_supervisor,
      last_ai_message_at,last_customer_message_at,next_resume_at,resume_reason,
      p9_recovery_response_set_id,updated_at
    ) values (
      p_conversation_id,p_organization_id,p_store_id,
      coalesce((p_patch->>'waiting_next_day')::boolean,false),
      coalesce((p_patch->>'pending_supervisor')::boolean,false),
      nullif(p_patch->>'last_ai_message_at','')::timestamptz,
      nullif(p_patch->>'last_customer_message_at','')::timestamptz,
      nullif(p_patch->>'next_resume_at','')::timestamptz,
      coalesce(nullif(p_patch->>'resume_reason',''),'none'),p_response_set_id,
      coalesce(nullif(p_patch->>'updated_at','')::timestamptz,clock_timestamp())
    );
  end if;
end;
$function$;

alter function public.p9_10_4_d_write_recovery_window_state_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb) owner to postgres;
revoke all on function public.p9_10_4_d_write_recovery_window_state_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.p9_10_4_d_write_recovery_window_state_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb) to service_role;

create or replace function public.p9_10_4_d_guard_recovery_row_write()
returns trigger language plpgsql security definer
set search_path=pg_catalog,pg_temp,public set row_security=off
as $function$
declare n jsonb:=to_jsonb(new); o jsonb:=case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  sid uuid:=nullif(coalesce(n->>'p9_recovery_response_set_id',n->'input'->>'responseSetId',n->'metadata'->>'p9_recovery_response_set_id',n->'metadata'->>'responseSetId',n->'context'->>'p9_recovery_response_set_id',n->'payload'->>'p9_recovery_response_set_id',n->'task_payload'->>'p9_recovery_response_set_id'),'')::uuid;
  old_sid uuid:=nullif(coalesce(o->>'p9_recovery_response_set_id',o->'input'->>'responseSetId',o->'metadata'->>'p9_recovery_response_set_id',o->'metadata'->>'responseSetId',o->'context'->>'p9_recovery_response_set_id',o->'payload'->>'p9_recovery_response_set_id',o->'task_payload'->>'p9_recovery_response_set_id'),'')::uuid;
  org uuid:=nullif(n->>'organization_id','')::uuid; st uuid:=nullif(n->>'store_id','')::uuid;
  conv uuid:=coalesce(nullif(n->>'conversation_id',''),nullif(n->>'related_conversation_id',''))::uuid;
  opp uuid:=nullif(n->>'commercial_opportunity_id','')::uuid;
  qid uuid:=nullif(coalesce(n->>'p9_recovery_queue_id',n->'metadata'->>'p9_recovery_queue_id',n->'context'->>'p9_recovery_queue_id',n->'payload'->>'p9_recovery_queue_id',n->'task_payload'->>'p9_recovery_queue_id'),'')::uuid;
  token uuid:=nullif(coalesce(n->>'p9_recovery_claim_token',n->'metadata'->>'p9_recovery_claim_token',n->'context'->>'p9_recovery_claim_token',n->'payload'->>'p9_recovery_claim_token',n->'task_payload'->>'p9_recovery_claim_token',n->>'claim_token'),'')::uuid;
  anchor uuid:=nullif(coalesce(n->>'anchor_message_id',n->'metadata'->>'p9_recovery_anchor_message_id',n->'context'->>'p9_recovery_anchor_message_id',n->'payload'->>'p9_recovery_anchor_message_id',n->'task_payload'->>'p9_recovery_anchor_message_id',n->'input'->>'anchorMessageId'),'')::uuid;
  lead uuid:=nullif(n->>'lead_id','')::uuid;
begin
  -- Queue claim/finalization bookkeeping does not reacquire the conversation
  -- lock. Recovery effects must carry the live claim binding.
  if tg_table_name='ai_run_queue' and tg_op='UPDATE' and n->'input' is not distinct from o->'input' then return new; end if;
  if tg_op='UPDATE' and old_sid is not null and sid is distinct from old_sid then
    raise exception using errcode='P0001',message='P9_10_4_D_RECOVERY_AUTHORITY_MUTATION'; end if;
  if sid is null then
    if tg_table_name='store_assistant_operational_task_queue'
       and (qid is not null or token is not null) then
      raise exception using errcode='42501',
        message='P9_RECOVERY_QUEUE_BINDING_REQUIRED';
    end if;
    return new;
  end if;
  if tg_op='UPDATE' and old_sid=sid and qid is null and token is null and anchor is null then
    return new;
  end if;
  if session_user <> 'postgres' and coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'') <> 'service_role' then
    raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_SYSTEM_ROLE_REQUIRED';
  end if;
  if tg_table_name='store_assistant_operational_task_queue'
     and tg_op='INSERT' then
    if n->>'queue_type' is distinct from 'quote_preparation_request'
       or qid is null or token is null or anchor is null
       or n->>'message_id' is distinct from anchor::text
       or n->'payload'->>'request_message_id' is distinct from anchor::text then
      raise exception using errcode='42501',
        message='P9_RECOVERY_QUOTE_QUEUE_BINDING_INVALID';
    end if;

    lead := nullif(n->'payload'->>'lead_id','')::uuid;
    opp := nullif(n->'payload'->>'commercial_opportunity_id','')::uuid;

    if lead is null or opp is null then
      raise exception using errcode='42501',
        message='P9_RECOVERY_QUOTE_QUEUE_SCOPE_INVALID';
    end if;

    perform public.p9_10_4_d_assert_recovery_set_claim_authority(
      sid,qid,token,org,st,conv,anchor,lead,opp
    );

    perform 1
      from public.store_assistant_operational_tasks t
      join public.p19a_quote_preparation_task_authorizations a
        on a.task_id=t.id
       and a.organization_id=t.organization_id
       and a.store_id=t.store_id
     where t.id=(n->>'task_id')::uuid
       and t.organization_id=org
       and t.store_id=st
       and t.related_conversation_id=conv
       and t.related_lead_id=lead
       and t.commercial_opportunity_id=opp
       and t.task_type='commercial_quote_request'
       and t.status in (
         'open','waiting_user_choice','waiting_customer_response',
         'ready_to_execute','in_progress'
       )
       and t.cancelled_at is null
       and t.resolved_at is null
       and t.task_payload #>> '{quote_preparation,request_message_id}'=anchor::text
       and a.id=(n->'payload'->>'authorization_id')::uuid
       and a.request_message_id=anchor
       and a.revoked_at is null
       and a.expires_at>clock_timestamp()
     for update of t nowait
     for share of a nowait;

    if not found then
      raise exception using errcode='42501',
        message='P9_RECOVERY_QUOTE_QUEUE_AUTHORIZATION_INVALID';
    end if;

    NEW := jsonb_populate_record(
      NEW,
      jsonb_build_object(
        'payload',
        (n->'payload')
          - 'p9_recovery_queue_id'
          - 'p9_recovery_claim_token'
          - 'p9_recovery_anchor_message_id'
      )
    );

    return NEW;
  end if;

  if tg_table_name in (
       'store_assistant_operational_tasks',
       'store_assistant_notification_queue'
     ) then
    lead := nullif(n->>'related_lead_id','')::uuid;

    if lead is null or conv is null then
      raise exception using errcode='42501',
        message='P9_RECOVERY_ASSISTANT_SCOPE_INVALID';
    end if;
  end if;

  if tg_table_name='store_assistant_operational_tasks'
     and tg_op='INSERT' then

    if opp is null
       or qid is null or token is null or anchor is null
       or n->>'task_type' not in (
         'commercial_quote_request',
         'commercial_visit_request'
       ) then
      raise exception using errcode='42501',
        message='P9_RECOVERY_COMMERCIAL_TASK_BINDING_INVALID';
    end if;

    perform public.p9_10_4_d_assert_recovery_set_claim_authority(
      sid,qid,token,org,st,conv,anchor,lead,opp
    );

    NEW := jsonb_populate_record(
      NEW,
      jsonb_build_object(
        'task_payload',
        (n->'task_payload')
          - 'p9_recovery_queue_id'
          - 'p9_recovery_claim_token'
          - 'p9_recovery_anchor_message_id'
      )
    );

    return NEW;
  end if;

  if tg_table_name='store_assistant_notification_queue'
     and n->'context'->>'task_id' is not null then

    if qid is null or token is null or anchor is null then
      raise exception using errcode='42501',
        message='P9_RECOVERY_NOTIFICATION_BINDING_REQUIRED';
    end if;

    select t.commercial_opportunity_id into opp
      from public.store_assistant_operational_tasks t
     where t.id=(n->'context'->>'task_id')::uuid
       and t.organization_id=org
       and t.store_id=st
       and t.related_conversation_id=conv
       and t.related_lead_id=lead
       and t.task_type in (
         'commercial_quote_request',
         'commercial_visit_request'
       );

    if not found or opp is null then
      raise exception using errcode='42501',
        message='P9_RECOVERY_NOTIFICATION_TASK_INVALID';
    end if;

    perform public.p9_10_4_d_assert_recovery_set_claim_authority(
      sid,qid,token,org,st,conv,anchor,lead,opp
    );

    NEW := jsonb_populate_record(
      NEW,
      jsonb_build_object(
        'context',
        (n->'context')
          - 'p9_recovery_queue_id'
          - 'p9_recovery_claim_token'
          - 'p9_recovery_anchor_message_id'
      )
    );

    return NEW;
  end if;

  if tg_table_name='commercial_opportunity_cross_sell_suggestions'
     and tg_op='INSERT' then

    if opp is null or conv is null
       or qid is null or token is null or anchor is null then
      raise exception using errcode='42501',
        message='P9_RECOVERY_CROSS_SELL_BINDING_REQUIRED';
    end if;

    select c.lead_id into lead
      from public.conversations c
      join public.leads l on l.id=c.lead_id
     where c.id=conv
       and c.organization_id=org
       and l.organization_id=org
       and l.store_id=st;

    if not found or lead is null then
      raise exception using errcode='42501',
        message='P9_RECOVERY_CROSS_SELL_SCOPE_MISMATCH';
    end if;

    perform public.p9_10_4_d_assert_recovery_set_claim_authority(
      sid,qid,token,org,st,conv,anchor,lead,opp
    );

    if not exists (
      select 1
        from public.p19a_sales_ai_reply_sets s
       where s.id=sid
         and s.organization_id=org
         and s.store_id=st
         and s.conversation_id=conv
         and s.commercial_opportunity_id=opp
         and s.text_message_id=(n->>'suggestion_message_id')::uuid
         and s.anchor_message_id=anchor
         and s.materialization_state='confirmed'
    ) or n->'metadata'->>'source_message_id'
           is distinct from anchor::text then

      raise exception using errcode='42501',
        message='P9_RECOVERY_CROSS_SELL_MESSAGE_MISMATCH';
    end if;

    NEW := jsonb_populate_record(
      NEW,
      jsonb_build_object(
        'metadata',
        (n->'metadata')
          - 'p9_recovery_queue_id'
          - 'p9_recovery_claim_token'
          - 'p9_recovery_anchor_message_id'
      )
    );

    return NEW;
  end if;

  if tg_op='INSERT' and (
       tg_table_name='store_assistant_messages'
       or (
         tg_table_name='store_assistant_notification_queue'
         and n->'context'->>'task_id' is null
       )
     ) then

    lead := nullif(n->>'related_lead_id','')::uuid;

    if conv is null or lead is null
       or qid is null or token is null or anchor is null then
      raise exception using errcode='42501',
        message='P9_RECOVERY_ASSISTANT_MESSAGE_BINDING_REQUIRED';
    end if;

    perform public.p9_10_4_d_assert_recovery_set_claim_authority(
      sid,qid,token,org,st,conv,anchor,lead,null
    );

    if tg_table_name='store_assistant_messages' then
      NEW := jsonb_populate_record(
        NEW,
        jsonb_build_object(
          'metadata',
          (n->'metadata')
            - 'p9_recovery_queue_id'
            - 'p9_recovery_claim_token'
            - 'p9_recovery_anchor_message_id'
        )
      );
    else
      NEW := jsonb_populate_record(
        NEW,
        jsonb_build_object(
          'context',
          (n->'context')
            - 'p9_recovery_queue_id'
            - 'p9_recovery_claim_token'
            - 'p9_recovery_anchor_message_id'
        )
      );
    end if;

    return NEW;
  end if;

  if conv is null and opp is not null then
    select o.primary_conversation_id,o.origin_lead_id into conv,lead
      from public.commercial_opportunities o
     where o.id=opp and o.organization_id=org and o.store_id=st;
  elsif conv is not null and lead is null then
    select c.lead_id into lead from public.conversations c
     where c.id=conv and c.organization_id=org;
  end if;
  if tg_table_name='ai_run_queue' and tg_op='INSERT' and qid is null and token is null then
    perform public.p9_10_4_d_assert_recovery_set_authority(sid,org,st,(n->>'conversation_id')::uuid,anchor);
  elsif qid is null or token is null or anchor is null then
    raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_LIVE_CLAIM_REQUIRED';
  else
    perform public.p9_10_4_d_assert_recovery_set_claim_authority(sid,qid,token,org,st,conv,anchor,lead,opp);
  end if;
  return new;
end;
$function$;

do $triggers$
declare t text; tr text;
begin
  foreach t in array array['commercial_opportunity_cross_sell_suggestions',
    'store_assistant_messages','store_assistant_notification_queue','store_assistant_operational_tasks',
    'store_assistant_operational_task_queue','store_assistant_threads','ai_run_queue',
    'commercial_opportunity_qualification_fact_events','commercial_opportunity_qualification_facts_current'] loop
    if pg_catalog.to_regclass('public.'||t) is not null then
      tr:='trg_p9_10_4_d_i4_'||t;
      execute pg_catalog.format('drop trigger if exists %I on public.%I',tr,t);
      execute pg_catalog.format('create trigger %I before insert or update on public.%I for each row execute function public.p9_10_4_d_guard_recovery_row_write()',tr,t);
    end if;
  end loop;
end;
$triggers$;

-- Recovery-specific qualification wrapper; the ordinary writer remains unchanged.
create or replace function public.p9_10_4_d_write_recovery_qualification_fact_by_system(
  p_organization_id uuid,p_store_id uuid,p_commercial_opportunity_id uuid,p_operation_key text,p_fact_key text,
  p_value_json jsonb,p_assertion_level text,p_source_type text,p_source_message_id uuid default null,
  p_source_conversation_id uuid default null,p_created_by text default 'sales_ai',p_resolves_conflict boolean default false,
  p_response_set_id uuid default null,p_queue_id uuid default null,p_claim_token uuid default null,
  p_anchor_message_id uuid default null,p_conversation_id uuid default null,p_lead_id uuid default null)
returns table (
  commercial_opportunity_id uuid, fact_key text, event_id uuid,
  current_last_event_id uuid, current_state text, current_value_json jsonb,
  normalized_value_text text, value_kind text, conflict_values_json jsonb,
  changed boolean, outcome text, updated_at timestamptz
) language plpgsql security definer
set search_path=pg_catalog,pg_temp,public set row_security=off
as $function$
begin
  if session_user <> 'postgres' and
     coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'') <> 'service_role' then
    raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_SYSTEM_ROLE_REQUIRED';
  end if;
  perform public.p9_10_4_d_assert_recovery_set_claim_authority(p_response_set_id,p_queue_id,p_claim_token,
    p_organization_id,p_store_id,p_conversation_id,p_anchor_message_id,p_lead_id,p_commercial_opportunity_id);
  return query select * from public.write_commercial_opportunity_qualification_fact_by_system(
    p_organization_id,p_store_id,p_commercial_opportunity_id,p_operation_key,p_fact_key,p_value_json,
    p_assertion_level,p_source_type,p_source_message_id,p_source_conversation_id,p_created_by,p_resolves_conflict);
end;
$function$;

-- A deferral can refund only a live recovery claim while the same conversation
-- is actually blocked; null/expired claims and repeated refunds fail closed.
create or replace function public.release_ai_run_queue_recovery_claim_by_system(
  p_organization_id uuid,p_store_id uuid,p_queue_id uuid,p_claim_token uuid)
returns table(ok boolean,id uuid,claim_token uuid,attempt_count integer)
language plpgsql security definer set search_path=pg_catalog,pg_temp,public set row_security=off
as $function$
declare q public.ai_run_queue%rowtype; c public.conversations%rowtype; h public.conversation_human_takeover_leases%rowtype; has_h boolean; updated_attempt_count integer;
begin
  if session_user <> 'postgres' and coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'') <> 'service_role' then
    raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_SYSTEM_ROLE_REQUIRED';
  end if;
  if p_claim_token is null then raise exception using errcode='22023',message='P9_10_4_D_RECOVERY_CLAIM_REQUIRED'; end if;
  select x.* into q from public.ai_run_queue x where x.id=p_queue_id and x.organization_id=p_organization_id
    and x.store_id=p_store_id and x.claim_token=p_claim_token and x.processed_at is null;
  if not found or q.claim_expires_at is null or q.claim_expires_at<=pg_catalog.clock_timestamp()
     or q.input->>'type' is distinct from 'sales_ai_post_materialization_recovery' then
    raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_CLAIM_NOT_LIVE'; end if;
  if q.conversation_id is null then raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_CONVERSATION_REQUIRED'; end if;
  perform public.private_acquire_sales_contract_conversation_xact_lock(q.conversation_id);
  select conversation_row.* into c from public.conversations conversation_row where conversation_row.id=q.conversation_id for update;
  if not found or c.organization_id is distinct from p_organization_id then raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_CONVERSATION_SCOPE_MISMATCH'; end if;
  select lease_row.* into h from public.conversation_human_takeover_leases lease_row where lease_row.conversation_id=q.conversation_id for update;
  if found and (h.organization_id is distinct from p_organization_id or h.store_id is distinct from p_store_id) then
    raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_LEASE_SCOPE_MISMATCH'; end if;
  has_h:=coalesce(c.is_human_active,false) or lower(btrim(coalesce(c.status,'')))='humano_assumiu'
    or (found and (h.hard_hold or h.released_at is null));
  if not has_h then raise exception using errcode='P0001',message='P9_10_4_D_RECOVERY_NOT_DEFERRED'; end if;
  select x.* into q from public.ai_run_queue x where x.id=p_queue_id and x.organization_id=p_organization_id
    and x.store_id=p_store_id and x.claim_token=p_claim_token and x.processed_at is null for update nowait;
  if not found or q.claim_expires_at is null or q.claim_expires_at<=pg_catalog.clock_timestamp() then
    raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_CLAIM_NOT_LIVE'; end if;
  update public.ai_run_queue as queue_row set claim_token=null,claim_expires_at=null,claimed_by=null,
    p9_recovery_claim_started_at=null,
    attempt_count=greatest(0,queue_row.attempt_count-1)
    where queue_row.id=q.id and queue_row.organization_id=p_organization_id
      and queue_row.store_id=p_store_id and queue_row.claim_token=p_claim_token
    returning queue_row.attempt_count into updated_attempt_count;
  if not found then raise exception using errcode='42501',message='P9_10_4_D_RECOVERY_CLAIM_ALREADY_RELEASED'; end if;
  return query select true,q.id,p_claim_token,updated_attempt_count;
end;
$function$;

alter function public.release_ai_run_queue_recovery_claim_by_system(uuid,uuid,uuid,uuid) owner to postgres;
revoke all on function public.release_ai_run_queue_recovery_claim_by_system(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.release_ai_run_queue_recovery_claim_by_system(uuid,uuid,uuid,uuid) to service_role;


-- Recovery quote authorization requires the caller's exact live claim.
-- The ordinary four-argument authority remains unchanged.
create or replace function public.issue_quote_preparation_task_authorization_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_task_id uuid,
  p_request_message_id uuid,
  p_recovery_response_set_id uuid,
  p_recovery_queue_id uuid,
  p_recovery_claim_token uuid
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,pg_temp,public,auth
set row_security=off
as $function$
declare
  t public.store_assistant_operational_tasks%rowtype;
  locked_task public.store_assistant_operational_tasks%rowtype;
begin
  if public.zion_resolve_request_role_internal()
       is distinct from 'service_role' then
    raise exception using errcode='42501',
      message='P19A_QUOTE_PREP_AUTH_SYSTEM_ROLE_REQUIRED';
  end if;

  if p_recovery_response_set_id is null
     or p_recovery_queue_id is null
     or p_recovery_claim_token is null
     or p_request_message_id is null then
    raise exception using errcode='22023',
      message='P9_10_4_D_RECOVERY_BINDING_REQUIRED';
  end if;

  select x.* into t
  from public.store_assistant_operational_tasks x
  where x.id=p_task_id
    and x.organization_id=p_organization_id
    and x.store_id=p_store_id;

  if not found
     or t.related_conversation_id is null
     or t.related_lead_id is null
     or t.commercial_opportunity_id is null then
    raise exception using errcode='42501',
      message='P9_10_4_D_RECOVERY_TASK_SCOPE_MISMATCH';
  end if;

  perform public.p9_10_4_d_assert_recovery_set_claim_authority(
    p_recovery_response_set_id,
    p_recovery_queue_id,
    p_recovery_claim_token,
    p_organization_id,
    p_store_id,
    t.related_conversation_id,
    p_request_message_id,
    t.related_lead_id,
    t.commercial_opportunity_id
  );

  select x.* into locked_task
  from public.store_assistant_operational_tasks x
  where x.id=p_task_id
    and x.organization_id=p_organization_id
    and x.store_id=p_store_id
  for update nowait;

  if not found
     or locked_task.related_conversation_id
          is distinct from t.related_conversation_id
     or locked_task.related_lead_id
          is distinct from t.related_lead_id
     or locked_task.commercial_opportunity_id
          is distinct from t.commercial_opportunity_id then
    raise exception using errcode='42501',
      message='P9_10_4_D_RECOVERY_TASK_SCOPE_MISMATCH';
  end if;

  return public.issue_quote_preparation_task_authorization_by_system(
    p_organization_id,
    p_store_id,
    p_task_id,
    p_request_message_id
  );
end;
$function$;

alter function public.issue_quote_preparation_task_authorization_by_system(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid
) owner to postgres;

revoke all on function public.issue_quote_preparation_task_authorization_by_system(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid
) from public,anon,authenticated;

grant execute on function public.issue_quote_preparation_task_authorization_by_system(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid
) to service_role;

-- Recovery qualification writer: lead identity is explicit end-to-end.
alter function public.p9_10_4_d_write_recovery_qualification_fact_by_system(
 uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean,uuid,uuid,uuid,uuid,uuid,uuid
) owner to postgres;
revoke all on function public.p9_10_4_d_write_recovery_qualification_fact_by_system(
 uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean,uuid,uuid,uuid,uuid,uuid,uuid
) from public,anon,authenticated;
grant execute on function public.p9_10_4_d_write_recovery_qualification_fact_by_system(
 uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean,uuid,uuid,uuid,uuid,uuid,uuid
) to service_role;

-- Definitive materializer patch: the historical baseline hash is mandatory;
-- normalized CRLF handling is used only for the guarded replacement.
do $materializer$
declare oid_value oid := pg_catalog.to_regprocedure('public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)');
  definition text; normalized text; anchor_pattern text; anchor_match text; replacement text; baseline_md5 text; count_anchor integer; owner_before oid; acl_before aclitem[]; owner_after oid; acl_after aclitem[];
begin
  if oid_value is null then raise exception using errcode='P0001',message='P9_10_4_D_MATERIALIZER_MISSING'; end if;
  select md5(pg_get_functiondef(oid_value)),proowner,proacl into baseline_md5,owner_before,acl_before from pg_proc where oid=oid_value;
  if baseline_md5<>'4d44f7b4a2ad6dd33d2806ae251d8e2e' then raise exception using errcode='P0001',message='P9_10_4_D_MATERIALIZER_BASELINE_DRIFT:'||baseline_md5; end if;
  select pg_get_functiondef(oid_value) into definition;
  normalized:=regexp_replace(definition,E'\r\n?',E'\n','g');
  anchor_pattern:='update[[:space:]]+public[.]p19a_sales_ai_reply_sets[[:space:]]+'
    ||'set[[:space:]]+text_message_id[[:space:]]*=[[:space:]]*v_text_message[.]id,[[:space:]]*document_message_ids[[:space:]]*=[[:space:]]*v_document_ids,[[:space:]]*photo_message_id[[:space:]]*=[[:space:]]*v_photo_id,[[:space:]]*materialization_state[[:space:]]*=[[:space:]]*''confirmed'',[[:space:]]*confirmed_at[[:space:]]*=[[:space:]]*clock_timestamp\(\)[[:space:]]*'
    ||'where[[:space:]]+id[[:space:]]*=[[:space:]]*v_set_id[[:space:]]*;[[:space:]]+'
    ||'return[[:space:]]+query[[:space:]]+select[[:space:]]+v_set_id,[[:space:]]*v_text_message[.]id,[[:space:]]*v_document_ids,[[:space:]]*v_photo_id,[[:space:]]*v_fingerprint,[[:space:]]*false[[:space:]]*;';
  replacement:=regexp_replace($b$
  update public.p19a_sales_ai_reply_sets
  set text_message_id = v_text_message.id, document_message_ids = v_document_ids, photo_message_id = v_photo_id, materialization_state = 'confirmed', confirmed_at = clock_timestamp()
  where id = v_set_id;

  if public.p9_10_4_d_recovery_enqueue_enabled() then
    insert into public.ai_run_queue (organization_id,store_id,conversation_id,lead_id,queue_key,input,enqueued_at,processed_at,processing_error)
    values (p_organization_id,p_store_id,p_conversation_id,p_lead_id,format('sales-ai-post-materialization:%s',v_set_id),
      jsonb_build_object('type','sales_ai_post_materialization_recovery','responseSetId',v_set_id,'anchorMessageId',p_anchor_message_id),clock_timestamp(),null,null)
    on conflict (organization_id,queue_key) do nothing;
  end if;
  return query select v_set_id, v_text_message.id, v_document_ids, v_photo_id, v_fingerprint, false;
  $b$,E'\r\n?',E'\n','g');
  select count(*) into count_anchor from regexp_matches(normalized,anchor_pattern,'g');
  if count_anchor is distinct from 1 then raise exception using errcode='P0001',message='P9_10_4_D_MATERIALIZER_ANCHOR_COUNT_NOT_ONE'; end if;
  select (regexp_matches(normalized,anchor_pattern,'g'))[1] into anchor_match;
  execute replace(normalized,anchor_match,replacement);
  select proowner,proacl into owner_after,acl_after from pg_proc where oid=oid_value;
  if owner_after is distinct from owner_before or acl_after is distinct from acl_before then raise exception using errcode='P0001',message='P9_10_4_D_MATERIALIZER_SECURITY_DRIFT'; end if;
end;
$materializer$;

-- The installed legacy writers are patched only from the remotely confirmed
-- definitions. pg_get_functiondef is normalized for CRLF, the exact baseline
-- MD5 is mandatory, and each semantic anchor must occur exactly once. CREATE OR
-- REPLACE preserves the existing owner, SECURITY DEFINER, search_path and ACL;
-- those properties are nevertheless compared after each guarded replacement.
do $legacy_patches$
declare
  v_process oid := pg_catalog.to_regprocedure('public.process_next_ai_run_queue(uuid)');
  v_enqueue oid := pg_catalog.to_regprocedure('public.enqueue_ai_run(uuid,uuid,uuid,uuid,jsonb)');
  v_definition text; v_normalized text; v_match text; v_replacement text; v_count integer;
  v_owner oid; v_acl aclitem[]; v_config text[]; v_security boolean;
  v_owner_after oid; v_acl_after aclitem[]; v_config_after text[]; v_security_after boolean;
  v_process_pattern constant text :=
    'where[[:space:]]+organization_id[[:space:]]*=[[:space:]]*p_organization_id[[:space:]]+'
    || 'and[[:space:]]+processed_at[[:space:]]+is[[:space:]]+null[[:space:]]+'
    || 'order[[:space:]]+by[[:space:]]+enqueued_at[[:space:]]+asc';
  v_enqueue_pattern constant text := 'AS[[:space:]]+\$[^$]*\$[[:space:]]+declare[[:space:]]+v_run_id[[:space:]]+uuid[[:space:]]*;[[:space:]]*begin';
begin
  if v_process is null or v_enqueue is null then
    raise exception using errcode='P0001',message='P9_10_4_D_LEGACY_FUNCTION_SIGNATURES_UNAVAILABLE_RUN_READONLY_DIAGNOSTIC';
  end if;

  select pg_catalog.md5(pg_catalog.pg_get_functiondef(v_process)) into v_match;
  if v_match is distinct from 'd7c43290bce0c4dbc1d6b0f89c5fafeb' then
    raise exception using errcode='P0001',message='P9_10_4_D_PROCESS_QUEUE_BASELINE_DRIFT:'||v_match;
  end if;
  select p.proowner,p.proacl,p.proconfig,p.prosecdef into v_owner,v_acl,v_config,v_security
    from pg_catalog.pg_proc p where p.oid=v_process;
  if not v_security or pg_catalog.pg_get_userbyid(v_owner)<>'postgres'
     or not (v_config @> array['search_path=public, pg_temp']::text[])
     or not has_function_privilege('service_role',v_process,'EXECUTE')
     or has_function_privilege('anon',v_process,'EXECUTE')
     or has_function_privilege('authenticated',v_process,'EXECUTE') then
    raise exception using errcode='42501',message='P9_10_4_D_PROCESS_QUEUE_SECURITY_DRIFT';
  end if;
  select pg_catalog.regexp_replace(pg_catalog.pg_get_functiondef(v_process),E'\r\n?',E'\n','g') into v_normalized;
  select count(*) into v_count from pg_catalog.regexp_matches(v_normalized,v_process_pattern,'g');
  if v_count<>1 then raise exception using errcode='P0001',message='P9_10_4_D_PROCESS_QUEUE_ANCHOR_COUNT_NOT_ONE'; end if;
  select (pg_catalog.regexp_matches(v_normalized,v_process_pattern,'g'))[1] into v_match;
  v_replacement := 'where organization_id = p_organization_id'||E'\n'
    ||'  and processed_at is null'||E'\n'
    ||'  and (input ->> ''type'' is distinct from ''sales_ai_post_materialization_recovery'')'||E'\n'
    ||'  order by enqueued_at asc';
  execute pg_catalog.replace(v_normalized,v_match,v_replacement);
  select p.proowner,p.proacl,p.proconfig,p.prosecdef into v_owner_after,v_acl_after,v_config_after,v_security_after
    from pg_catalog.pg_proc p where p.oid=v_process;
  if v_owner_after is distinct from v_owner or v_acl_after is distinct from v_acl
     or v_config_after is distinct from v_config or v_security_after is distinct from v_security then
    raise exception using errcode='P0001',message='P9_10_4_D_PROCESS_QUEUE_SECURITY_DRIFT_AFTER_PATCH';
  end if;

  select pg_catalog.md5(pg_catalog.pg_get_functiondef(v_enqueue)) into v_match;
  if v_match is distinct from '219bb0ad93eac3b751543b81fad11b0c' then
    raise exception using errcode='P0001',message='P9_10_4_D_ENQUEUE_BASELINE_DRIFT:'||v_match;
  end if;
  select p.proowner,p.proacl,p.proconfig,p.prosecdef into v_owner,v_acl,v_config,v_security
    from pg_catalog.pg_proc p where p.oid=v_enqueue;
  if not v_security or pg_catalog.pg_get_userbyid(v_owner)<>'postgres'
     or not (v_config @> array['search_path=public, pg_temp']::text[])
     or not has_function_privilege('service_role',v_enqueue,'EXECUTE')
     or has_function_privilege('anon',v_enqueue,'EXECUTE')
     or has_function_privilege('authenticated',v_enqueue,'EXECUTE') then
    raise exception using errcode='42501',message='P9_10_4_D_ENQUEUE_SECURITY_DRIFT';
  end if;
  select pg_catalog.regexp_replace(pg_catalog.pg_get_functiondef(v_enqueue),E'\r\n?',E'\n','g') into v_normalized;
  select count(*) into v_count from pg_catalog.regexp_matches(v_normalized,v_enqueue_pattern,'g');
  if v_count<>1 then raise exception using errcode='P0001',message='P9_10_4_D_ENQUEUE_BODY_ANCHOR_COUNT_NOT_ONE'; end if;
  select (pg_catalog.regexp_matches(v_normalized,v_enqueue_pattern,'g'))[1] into v_match;
  v_replacement := v_match || E'\n  if coalesce($5 ->> ''type'','''') = ''sales_ai_post_materialization_recovery'' then\n'
    ||'    raise exception using errcode=''42501'',message=''P9_10_4_D_RECOVERY_ENQUEUE_FORBIDDEN'';'||E'\n'
    ||'  end if;';
  execute pg_catalog.replace(v_normalized,v_match,v_replacement);
  select p.proowner,p.proacl,p.proconfig,p.prosecdef into v_owner_after,v_acl_after,v_config_after,v_security_after
    from pg_catalog.pg_proc p where p.oid=v_enqueue;
  if v_owner_after is distinct from v_owner or v_acl_after is distinct from v_acl
     or v_config_after is distinct from v_config or v_security_after is distinct from v_security then
    raise exception using errcode='P0001',message='P9_10_4_D_ENQUEUE_SECURITY_DRIFT_AFTER_PATCH';
  end if;
end;
$legacy_patches$;

-- The worker baseline is patched so a recovery queue claim can never enter a
-- fresh commercial-response materialization. Recovery reconciles the confirmed
-- response set through its explicit writers instead.
do $worker_baseline$
declare v_oid oid := pg_catalog.to_regprocedure(
  'public.materialize_sales_ai_reply_set_by_worker_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,text,uuid,uuid,jsonb,jsonb,jsonb)');
  v_definition text; v_owner text; v_acl aclitem[]; v_security boolean; v_config text[];
  v_owner_before text; v_acl_before aclitem[]; v_security_before boolean; v_config_before text[];
  v_pattern constant text := 'AND[[:space:]]+q[.]attempt_count[[:space:]]+BETWEEN[[:space:]]+1[[:space:]]+AND[[:space:]]+3[[:space:]]+FOR[[:space:]]+UPDATE[[:space:]]+OF[[:space:]]+q[[:space:]]*;';
  v_match text; v_count integer;
begin
  if v_oid is null then raise exception using errcode='P0001',message='P9_10_4_D_WORKER_MATERIALIZER_MISSING'; end if;
  if pg_catalog.md5(pg_catalog.pg_get_functiondef(v_oid))<>'70ab29097ea4fb55be6d05afbac35492' then
    raise exception using errcode='P0001',message='P9_10_4_D_WORKER_MATERIALIZER_BASELINE_DRIFT';
  end if;
  select pg_catalog.pg_get_functiondef(v_oid),pg_catalog.pg_get_userbyid(p.proowner),p.proacl,p.prosecdef,p.proconfig
    into v_definition,v_owner_before,v_acl_before,v_security_before,v_config_before from pg_catalog.pg_proc p where p.oid=v_oid;
  v_owner:=v_owner_before; v_acl:=v_acl_before; v_security:=v_security_before; v_config:=v_config_before;
  if v_owner<>'postgres' or not v_security or pg_catalog.strpos(v_definition,'materialize_sales_ai_reply_set_by_system')=0 then
    raise exception using errcode='42501',message='P9_10_4_D_WORKER_MATERIALIZER_SECURITY_OR_DELEGATION_DRIFT';
  end if;
  select count(*) into v_count from pg_catalog.regexp_matches(v_definition,v_pattern,'g');
  if v_count<>1 then raise exception using errcode='P0001',message='P9_10_4_D_WORKER_MATERIALIZER_BODY_ANCHOR_COUNT_NOT_ONE'; end if;
  select (pg_catalog.regexp_matches(v_definition,v_pattern,'g'))[1] into v_match;
  v_definition:=pg_catalog.replace(v_definition,v_match,v_match||E'\n  if found and exists (select 1 from public.ai_run_queue q where q.id=p_claim_id and q.organization_id=p_organization_id and q.store_id=p_store_id and q.claim_token=p_claim_token and q.input->>''type'' = ''sales_ai_post_materialization_recovery'') then\n'
    ||'    raise exception using errcode=''42501'',message=''P9_10_4_D_RECOVERY_CLAIM_CANNOT_MATERIALIZE'';'||E'\n'
    ||'  end if;');
  execute v_definition;
  select pg_catalog.pg_get_userbyid(p.proowner),p.proacl,p.prosecdef,p.proconfig
    into v_owner,v_acl,v_security,v_config from pg_catalog.pg_proc p where p.oid=v_oid;
  if v_owner<>v_owner_before or v_acl is distinct from v_acl_before
     or v_security is distinct from v_security_before or v_config is distinct from v_config_before then
    raise exception using errcode='P0001',message='P9_10_4_D_WORKER_MATERIALIZER_SECURITY_DRIFT_AFTER_PATCH';
  end if;
end;
$worker_baseline$;

-- I.13: skip held recovery rows in both the claim and expired-terminal pass.
-- Non-locking observation only; the transactional writer still fences races.

-- Refund expired recovery reservations only under confirmed human control.
-- Called internally by the canonical claim authority.
-- Timestamp of the current recovery attempt reservation.
-- Not an authority token and not a customer-visible field.
alter table public.ai_run_queue
  add column p9_recovery_claim_started_at timestamptz;

create or replace function public.p9_10_4_d_refund_expired_held_recovery_claims(
  p_organization_id uuid,
  p_store_id uuid,
  p_limit integer
) returns integer
language plpgsql security definer
set search_path=pg_catalog,pg_temp,public,auth
set row_security=off
as $function$
declare
  v_candidate record;
  v_queue public.ai_run_queue%rowtype;
  v_conversation public.conversations%rowtype;
  v_lease public.conversation_human_takeover_leases%rowtype;
  v_has_lease boolean;
  v_blocked boolean;
  v_refunded integer := 0;
  v_changed integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501',
      message='P9_RECOVERY_EXPIRY_SYSTEM_ROLE_REQUIRED';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_limit is null
     or p_limit not between 1 and 100 then
    raise exception using errcode='22023',
      message='P9_RECOVERY_EXPIRY_ARGUMENTS_INVALID';
  end if;

  for v_candidate in
    select q.id,q.conversation_id,q.lead_id,q.claim_token
      from public.ai_run_queue q
      join public.conversations c
        on c.id=q.conversation_id
       and c.organization_id=q.organization_id
       and c.lead_id=q.lead_id
      join public.leads l
        on l.id=c.lead_id
       and l.organization_id=q.organization_id
       and l.store_id=q.store_id
     where q.organization_id=p_organization_id
       and q.store_id=p_store_id
       and q.input->>'type'='sales_ai_post_materialization_recovery'
       and q.processed_at is null
       and q.claim_token is not null
       and q.claim_expires_at<=clock_timestamp()
       and q.attempt_count between 1 and 3
       and (
         q.processing_error is null
         or q.processing_error like 'sales_ai_retryable:%'
       )
       and (
         coalesce(c.is_human_active,false)
         or lower(btrim(coalesce(c.status,'')))='humano_assumiu'
         or exists (
           select 1
             from public.conversation_human_takeover_leases h
            where h.conversation_id=q.conversation_id
              and h.organization_id=q.organization_id
              and h.store_id=q.store_id
              and (
                h.hard_hold is true
                or h.released_at is null
                or (
                  q.p9_recovery_claim_started_at is not null
                  and q.p9_recovery_claim_started_at
                        <=q.claim_expires_at
                  and h.takeover_started_at<=q.claim_expires_at
                  and h.released_at>=q.claim_expires_at
                  and h.released_at>=h.takeover_started_at
                )
              )
         )
       )
     order by q.claim_expires_at,q.id
     limit p_limit
  loop
    begin
      -- Use the exact canonical conversation advisory-lock key.
      -- Never wait behind an unrelated active conversation.
      if not pg_catalog.pg_try_advisory_xact_lock(
        public.private_sales_contract_conversation_lock_key(
          v_candidate.conversation_id
        )
      ) then
        continue;
      end if;

      select c.* into v_conversation
        from public.conversations c
        join public.leads l on l.id=c.lead_id
       where c.id=v_candidate.conversation_id
         and c.organization_id=p_organization_id
         and c.lead_id=v_candidate.lead_id
         and l.organization_id=p_organization_id
         and l.store_id=p_store_id
       for update of c nowait;

      if not found then
        continue;
      end if;

      select h.* into v_lease
        from public.conversation_human_takeover_leases h
       where h.conversation_id=v_candidate.conversation_id
       for update nowait;

      v_has_lease:=found;

      if v_has_lease and (
        v_lease.organization_id is distinct from p_organization_id
        or v_lease.store_id is distinct from p_store_id
      ) then
        continue;
      end if;

      v_blocked:=
        coalesce(v_conversation.is_human_active,false)
        or lower(btrim(coalesce(v_conversation.status,'')))='humano_assumiu'
        or (
          v_has_lease and (
            coalesce(v_lease.hard_hold,false)
            or v_lease.released_at is null
          )
        );

      select q.* into v_queue
        from public.ai_run_queue q
       where q.id=v_candidate.id
         and q.organization_id=p_organization_id
         and q.store_id=p_store_id
         and q.conversation_id=v_candidate.conversation_id
         and q.lead_id=v_candidate.lead_id
         and q.claim_token=v_candidate.claim_token
         and q.processed_at is null
         and q.claim_expires_at<=clock_timestamp()
         and q.attempt_count between 1 and 3
         and q.input->>'type'='sales_ai_post_materialization_recovery'
         and (
           q.processing_error is null
           or q.processing_error like 'sales_ai_retryable:%'
         )
       for update nowait;

      if not found then
        continue;
      end if;

      -- A completed takeover interval can prove that the
      -- reservation expired during human control, even after release.
      if not v_blocked then
        if not v_has_lease
           or v_queue.p9_recovery_claim_started_at is null
           or v_queue.p9_recovery_claim_started_at
                >v_queue.claim_expires_at
           or v_lease.takeover_started_at
                >v_queue.claim_expires_at
           or v_lease.released_at is null
           or v_lease.released_at<v_queue.claim_expires_at
           or v_lease.released_at<v_lease.takeover_started_at then
          continue;
        end if;
      elsif v_has_lease
            and v_lease.takeover_started_at
                  >v_queue.claim_expires_at then
        -- A later takeover does not prove an earlier expiry
        -- happened under human control.
        continue;
      end if;

      update public.ai_run_queue q
         set claim_token=null,
             claim_expires_at=null,
             claimed_by=null,
             p9_recovery_claim_started_at=null,
             attempt_count=q.attempt_count-1
       where q.id=v_queue.id
         and q.organization_id=p_organization_id
         and q.store_id=p_store_id
         and q.claim_token=v_candidate.claim_token
         and q.processed_at is null;

      get diagnostics v_changed=row_count;

      v_refunded:=v_refunded+v_changed;

    exception
      when lock_not_available then
        -- Retry on a later canonical claim cycle.
        null;
    end;
  end loop;

  return v_refunded;
end;
$function$;

alter function public.p9_10_4_d_refund_expired_held_recovery_claims(
  uuid,uuid,integer
) owner to postgres;

revoke all on function public.p9_10_4_d_refund_expired_held_recovery_claims(
  uuid,uuid,integer
) from public,anon,authenticated,service_role;

do $claim_patch$
declare
  v_oid oid := pg_catalog.to_regprocedure('public.claim_ai_run_queue_tasks_by_system(uuid,uuid,integer,text,integer,integer)');
  v_definition text; v_anchor text := 'AND q.processed_at IS NULL';
  v_filter text := $filter$
    AND (q.input->>'type' IS DISTINCT FROM 'sales_ai_post_materialization_recovery'
      OR (EXISTS (SELECT 1 FROM public.conversations c JOIN public.leads l ON l.id=c.lead_id
          WHERE c.id=q.conversation_id AND c.organization_id=q.organization_id
            AND c.lead_id=q.lead_id AND l.organization_id=q.organization_id AND l.store_id=q.store_id
            AND NOT coalesce(c.is_human_active,false)
            AND lower(btrim(coalesce(c.status,''))) <> 'humano_assumiu')
        AND NOT EXISTS (SELECT 1 FROM public.conversation_human_takeover_leases h
          WHERE h.conversation_id=q.conversation_id AND
            (h.organization_id IS DISTINCT FROM q.organization_id OR h.store_id IS DISTINCT FROM q.store_id
              OR h.hard_hold IS TRUE OR h.released_at IS NULL))))
$filter$;
  v_before record; v_after record; v_count integer;
begin
  if v_oid is null then raise exception 'P9_RECOVERY_CLAIM_BASELINE_MISSING'; end if;
  if pg_catalog.md5(pg_catalog.pg_get_functiondef(v_oid)) is distinct from '336804411a538f26856664a6b41ddd4b' then
    raise exception 'P9_RECOVERY_CLAIM_BASELINE_DRIFT';
  end if;
  select p.proowner,p.proacl,p.proconfig,p.prosecdef into v_before from pg_catalog.pg_proc p where p.oid=v_oid;
  v_definition:=pg_catalog.pg_get_functiondef(v_oid);
  v_count:=(length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor);
  if v_count is distinct from 2 then raise exception 'P9_RECOVERY_CLAIM_ANCHOR_COUNT:%',v_count; end if;

  v_definition:=replace(
    v_definition,v_anchor,v_anchor||v_filter
  );

  -- Run the recovery-only expiry reconciliation before the
  -- original expired-terminal update.
  v_definition:=pg_catalog.replace(
    pg_catalog.replace(
      v_definition,
      chr(13)||chr(10),
      chr(10)
    ),
    chr(13),
    chr(10)
  );

  v_anchor:=$expiry_anchor$UPDATE public.ai_run_queue AS q
  SET processing_error = 'sales_ai_failed_final:lease_expired_max_attempts',$expiry_anchor$;

  v_anchor:=pg_catalog.replace(
    pg_catalog.replace(
      v_anchor,
      chr(13)||chr(10),
      chr(10)
    ),
    chr(13),
    chr(10)
  );

  v_count:=
    (length(v_definition)-length(replace(v_definition,v_anchor,'')))
    /length(v_anchor);

  if v_count is distinct from 1 then
    raise exception 'P9_RECOVERY_EXPIRY_ANCHOR_COUNT:%',v_count;
  end if;

  v_definition:=replace(
    v_definition,
    v_anchor,
    'PERFORM public.p9_10_4_d_refund_expired_held_recovery_claims('
    ||'p_organization_id,p_store_id,p_limit);'
    ||E'\n\n  '||v_anchor
  );

  v_anchor:='attempt_count = q.attempt_count + 1';

  v_count:=
    (length(v_definition)-length(replace(v_definition,v_anchor,'')))
    /length(v_anchor);

  if v_count is distinct from 1 then
    raise exception 'P9_RECOVERY_CLAIM_TIMESTAMP_ANCHOR_COUNT:%',v_count;
  end if;

  v_definition:=replace(
    v_definition,
    v_anchor,
    v_anchor||E',\n      p9_recovery_claim_started_at = CASE'
    ||E'\n        WHEN q.input->>''type'' = ''sales_ai_post_materialization_recovery'''
    ||E'\n        THEN clock_timestamp()'
    ||E'\n        ELSE NULL END'
  );

  execute v_definition;

  select p.proowner,p.proacl,p.proconfig,p.prosecdef into v_after from pg_catalog.pg_proc p where p.oid=v_oid;
  if v_before.proowner is distinct from v_after.proowner or v_before.proacl is distinct from v_after.proacl
     or v_before.proconfig is distinct from v_after.proconfig or v_before.prosecdef is distinct from v_after.prosecdef then
    raise exception 'P9_RECOVERY_CLAIM_SECURITY_DRIFT';
  end if;
end;
$claim_patch$;

-- Explicit ACL audit for every new callable. Trigger-only functions are not
-- executable by client roles; service_role is the sole API caller.
do $acl$
declare f text;
begin
  foreach f in array array[
    'public.p9_10_4_d_recovery_enqueue_enabled()',
    'public.p9_10_4_d_assert_recovery_write_authority(uuid,uuid,uuid,uuid)',
    'public.p9_10_4_d_assert_recovery_set_claim_authority(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)',
    'public.p9_10_4_d_assert_recovery_set_authority(uuid,uuid,uuid,uuid,uuid)',
    'public.p9_10_4_d_transition_recovery_stage_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,text)',
    'public.p9_10_4_d_write_recovery_window_state_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)',
    'public.p9_10_4_d_guard_recovery_row_write()',
    'public.release_ai_run_queue_recovery_claim_by_system(uuid,uuid,uuid,uuid)',
    'public.issue_quote_preparation_task_authorization_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid)'
  ] loop
    if to_regprocedure(f) is null then raise exception 'P9_10_4_D_SECURITY_FUNCTION_MISSING:%',f; end if;
    execute format('alter function %s owner to postgres',f);
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end;
$acl$;


-- Recovery-only assistant effect writer.
create or replace function public.p9_10_4_d_write_assistant_effect_by_system(
  p_response_set_id uuid,
  p_queue_id uuid,
  p_claim_token uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_anchor_message_id uuid,
  p_lead_id uuid,
  p_commercial_opportunity_id uuid,
  p_operation text,
  p_payload jsonb
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,pg_temp,public,auth
set row_security=off
as $function$
declare
  v_thread_id uuid;
  v_message_id uuid;
  v_metadata jsonb;
  v_context jsonb;
  v_content text;
  v_kind text;
  v_event_key text;
  v_created boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501',
      message='P9_RECOVERY_ASSISTANT_SYSTEM_ROLE_REQUIRED';
  end if;

  if p_commercial_opportunity_id is null then
    raise exception using errcode='22023',
      message='P9_RECOVERY_ASSISTANT_OPPORTUNITY_REQUIRED';
  end if;

  perform public.p9_10_4_d_assert_recovery_set_claim_authority(
    p_response_set_id,p_queue_id,p_claim_token,
    p_organization_id,p_store_id,p_conversation_id,
    p_anchor_message_id,p_lead_id,p_commercial_opportunity_id
  );

  if p_operation='notification' then
    v_context := p_payload->'context';
    v_event_key := nullif(v_context->>'event_key','');

    if v_event_key is null
       or v_context->>'kind' is distinct from 'contract_workflow_decision'
       or nullif(p_payload->>'title','') is null
       or nullif(p_payload->>'body','') is null then
      raise exception using errcode='22023',
        message='P9_RECOVERY_CONTRACT_NOTIFICATION_INVALID';
    end if;

    select n.id into v_message_id
      from public.store_assistant_notification_queue n
     where n.organization_id=p_organization_id
       and n.store_id=p_store_id
       and n.related_conversation_id=p_conversation_id
       and n.related_lead_id=p_lead_id
       and n.notification_type='important_alert'
       and n.context->>'event_key'=v_event_key
     limit 1;

    if found then
      return jsonb_build_object(
        'created',false,'id',v_message_id
      );
    end if;

    v_context := v_context || jsonb_build_object(
      'p9_recovery_response_set_id',p_response_set_id,
      'p9_recovery_queue_id',p_queue_id,
      'p9_recovery_claim_token',p_claim_token,
      'p9_recovery_anchor_message_id',p_anchor_message_id
    );

    perform public.assistant_enqueue_internal_notification(
      p_organization_id => p_organization_id,
      p_store_id => p_store_id,
      p_notification_type => 'important_alert',
      p_title => p_payload->>'title',
      p_body => p_payload->>'body',
      p_priority => 'high',
      p_context => v_context,
      p_related_lead_id => p_lead_id,
      p_related_conversation_id => p_conversation_id,
      p_related_appointment_id => null::uuid,
      p_event_key => v_event_key
    );

    select n.id into v_message_id
      from public.store_assistant_notification_queue n
     where n.organization_id=p_organization_id
       and n.store_id=p_store_id
       and n.related_conversation_id=p_conversation_id
       and n.related_lead_id=p_lead_id
       and n.notification_type='important_alert'
       and n.context->>'event_key'=v_event_key
     limit 1;

    if not found then
      raise exception 'P9_RECOVERY_NOTIFICATION_NOT_CONFIRMED';
    end if;

    return jsonb_build_object(
      'created',true,'id',v_message_id
    );
  end if;

  if p_operation not in ('card','report') then
    raise exception using errcode='22023',
      message='P9_RECOVERY_ASSISTANT_OPERATION_INVALID';
  end if;

  v_metadata := p_payload->'metadata';
  v_content := nullif(p_payload->>'content','');
  v_kind := v_metadata->>'kind';

  if v_content is null or
     v_kind is distinct from (
       case when p_operation='card'
         then 'contract_workflow_decision'
         else 'customer_context_report'
       end
     ) then
    raise exception using errcode='22023',
      message='P9_RECOVERY_ASSISTANT_PAYLOAD_INVALID';
  end if;

  if nullif(v_metadata->>'quote_id','') is null
     or (
       p_operation='card' and (
         nullif(v_metadata->>'quote_version_id','') is null
         or nullif(v_metadata->>'trigger','') is null
         or nullif(v_metadata->>'source','') is null
       )
     )
     or (
       p_operation='report'
       and nullif(v_metadata->>'report_key','') is null
     ) then
    raise exception using errcode='22023',
      message='P9_RECOVERY_ASSISTANT_IDENTITY_INVALID';
  end if;

  select t.id into v_thread_id
    from public.store_assistant_threads t
   where t.organization_id=p_organization_id
     and t.store_id=p_store_id
     and t.thread_type='primary'
     and t.status='active'
   order by t.updated_at desc,t.id
   limit 1
   for update nowait;

  if not found then
    insert into public.store_assistant_threads(
      organization_id,store_id,thread_type,status,title,created_by
    ) values (
      p_organization_id,p_store_id,'primary','active',
      'Assistente operacional','system'
    ) returning id into v_thread_id;
  end if;

  select m.id into v_message_id
    from public.store_assistant_messages m
   where m.organization_id=p_organization_id
     and m.store_id=p_store_id
     and m.related_conversation_id=p_conversation_id
     and m.related_lead_id=p_lead_id
     and m.metadata->>'kind'=v_kind
     and (
       (
         p_operation='card'
         and m.metadata->>'quote_id'=v_metadata->>'quote_id'
         and m.metadata->>'quote_version_id'=v_metadata->>'quote_version_id'
         and m.metadata->>'trigger'=v_metadata->>'trigger'
         and m.metadata->>'source'=v_metadata->>'source'
       )
       or (
         p_operation='report'
         and m.metadata->>'report_key'=v_metadata->>'report_key'
       )
     )
   order by m.created_at desc,m.id
   limit 1;

  if not found then
    v_metadata := v_metadata || jsonb_build_object(
      'p9_recovery_response_set_id',p_response_set_id,
      'p9_recovery_queue_id',p_queue_id,
      'p9_recovery_claim_token',p_claim_token,
      'p9_recovery_anchor_message_id',p_anchor_message_id
    );

    perform public.assistant_push_system_message(
      p_organization_id => p_organization_id,
      p_store_id => p_store_id,
      p_content => v_content,
      p_message_type => 'text',
      p_related_lead_id => p_lead_id,
      p_related_conversation_id => p_conversation_id,
      p_related_appointment_id => null::uuid,
      p_metadata => v_metadata
    );

    select m.id into v_message_id
      from public.store_assistant_messages m
     where m.organization_id=p_organization_id
       and m.store_id=p_store_id
       and m.related_conversation_id=p_conversation_id
       and m.related_lead_id=p_lead_id
       and m.metadata->>'kind'=v_kind
       and m.metadata->>'p9_recovery_response_set_id'
         =p_response_set_id::text
       and (
         (
           p_operation='card'
           and m.metadata->>'quote_id'=v_metadata->>'quote_id'
           and m.metadata->>'quote_version_id'=v_metadata->>'quote_version_id'
           and m.metadata->>'trigger'=v_metadata->>'trigger'
           and m.metadata->>'source'=v_metadata->>'source'
         )
         or (
           p_operation='report'
           and m.metadata->>'report_key'=v_metadata->>'report_key'
         )
       )
     order by m.created_at desc,m.id
     limit 1;

    if not found then
      raise exception 'P9_RECOVERY_ASSISTANT_MESSAGE_NOT_CONFIRMED';
    end if;

    update public.store_assistant_threads
       set last_message_at=clock_timestamp(),
           last_message_preview=left(v_content,180),
           updated_at=clock_timestamp()
     where id=v_thread_id
       and organization_id=p_organization_id
       and store_id=p_store_id;

    v_created := true;
  end if;

  return jsonb_build_object(
    'created',v_created,
    'messageId',v_message_id,
    'threadId',v_thread_id
  );
end;
$function$;

alter function public.p9_10_4_d_write_assistant_effect_by_system(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb
) owner to postgres;

revoke all on function public.p9_10_4_d_write_assistant_effect_by_system(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb
) from public,anon,authenticated;

grant execute on function public.p9_10_4_d_write_assistant_effect_by_system(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb
) to service_role;



-- Durable receipt for the atomic recovery follow-up effect.
create table public.p9_recovery_followup_receipts (
  response_set_id uuid primary key
    references public.p19a_sales_ai_reply_sets(id),
  organization_id uuid not null,
  store_id uuid not null,
  conversation_id uuid not null,
  lead_id uuid not null,
  anchor_message_id uuid not null,
  decision_kind text not null check (
    decision_kind in ('schedule_resume','soft_pause','stop_contact')
  ),
  decision_reason text not null,
  queue_key text,
  completed_at timestamptz not null default clock_timestamp()
);

alter table public.p9_recovery_followup_receipts
  enable row level security;

alter table public.p9_recovery_followup_receipts owner to postgres;

revoke all on public.p9_recovery_followup_receipts
  from public,anon,authenticated,service_role;

create or replace function public.p9_10_4_d_apply_recovery_followup_by_system(
  p_response_set_id uuid,
  p_queue_id uuid,
  p_claim_token uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_anchor_message_id uuid,
  p_lead_id uuid,
  p_decision_kind text,
  p_patch jsonb,
  p_queue_key text,
  p_resume_input jsonb
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,pg_temp,public,auth
set row_security=off
as $function$
declare
  v_existing public.ai_run_queue%rowtype;
  v_receipt public.p9_recovery_followup_receipts%rowtype;
  v_decision jsonb;
  v_reason text;
  v_cancel_reason text;
  v_now timestamptz;
  v_prefix text;
  v_candidate_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501',
      message='P9_RECOVERY_FOLLOWUP_SYSTEM_ROLE_REQUIRED';
  end if;

  perform public.p9_10_4_d_assert_recovery_set_claim_authority(
    p_response_set_id,p_queue_id,p_claim_token,
    p_organization_id,p_store_id,p_conversation_id,
    p_anchor_message_id,p_lead_id,null
  );

  select s.payload #> '{caller_payload,operational_follow_up_decision}'
    into v_decision
    from public.p19a_sales_ai_reply_sets s
   where s.id=p_response_set_id;

  v_reason := nullif(p_patch->>'resume_reason','');

  if p_decision_kind is null
     or p_decision_kind not in (
       'schedule_resume','soft_pause','stop_contact'
     )
     or v_reason is null
     or v_decision->>'kind' is distinct from p_decision_kind
     or v_decision->>'reason' is distinct from v_reason then
    raise exception using errcode='42501',
      message='P9_RECOVERY_FOLLOWUP_DECISION_MISMATCH';
  end if;

  select * into v_receipt
    from public.p9_recovery_followup_receipts
   where response_set_id=p_response_set_id;

  if found then
    if v_receipt.organization_id is distinct from p_organization_id
       or v_receipt.store_id is distinct from p_store_id
       or v_receipt.conversation_id is distinct from p_conversation_id
       or v_receipt.lead_id is distinct from p_lead_id
       or v_receipt.anchor_message_id is distinct from p_anchor_message_id
       or v_receipt.decision_kind is distinct from p_decision_kind
       or v_receipt.decision_reason is distinct from v_reason then
      raise exception using errcode='42501',
        message='P9_RECOVERY_FOLLOWUP_RECEIPT_MISMATCH';
    end if;

    return jsonb_build_object('outcome','idempotent_replay');
  end if;

  v_now := clock_timestamp();
  v_prefix := 'resume:'||p_conversation_id::text||':';

  if p_decision_kind='schedule_resume' then
    if p_queue_key is null
       or left(p_queue_key,length(v_prefix))<>v_prefix
       or p_resume_input->>'type'
            is distinct from 'resume_sales_conversation'
       or p_resume_input->>'reason' is distinct from v_reason
       or p_resume_input->>'anchorMessageId'
            is distinct from p_anchor_message_id::text
       or p_resume_input->>'queue_key' is distinct from p_queue_key
       or nullif(p_patch->>'next_resume_at','') is null
       or p_resume_input->>'resumeAt'
            is distinct from p_patch->>'next_resume_at'
       or p_resume_input ? 'responseSetId'
       or p_resume_input ? 'p9_recovery_claim_token'
       or p_resume_input ? 'p9_recovery_queue_id' then
      raise exception using errcode='22023',
        message='P9_RECOVERY_RESUME_PAYLOAD_INVALID';
    end if;

    select q.* into v_existing
      from public.ai_run_queue q
     where q.organization_id=p_organization_id
       and q.queue_key=p_queue_key
     for update nowait;

    if found then
      if v_existing.store_id is distinct from p_store_id
         or v_existing.conversation_id is distinct from p_conversation_id
         or v_existing.lead_id is distinct from p_lead_id
         or v_existing.input->>'type'
              is distinct from 'resume_sales_conversation'
         or v_existing.input->>'anchorMessageId'
              is distinct from p_anchor_message_id::text
         or v_existing.input->>'reason' is distinct from v_reason
         or (v_existing.input->>'resumeAt')::timestamptz
              is distinct from (p_patch->>'next_resume_at')::timestamptz then
        raise exception using errcode='42501',
          message='P9_RECOVERY_RESUME_QUEUE_IDENTITY_MISMATCH';
      end if;

      -- Never reopen an already processed scheduled response.
      if v_existing.processed_at is not null then
        insert into public.p9_recovery_followup_receipts(
          response_set_id,organization_id,store_id,conversation_id,
          lead_id,anchor_message_id,decision_kind,decision_reason,queue_key
        ) values (
          p_response_set_id,p_organization_id,p_store_id,p_conversation_id,
          p_lead_id,p_anchor_message_id,p_decision_kind,v_reason,p_queue_key
        );
        return jsonb_build_object('outcome','idempotent_replay');
      end if;
    end if;

    v_cancel_reason := 'replaced_by_new_resume_schedule';

  elsif p_decision_kind='stop_contact' then
    v_cancel_reason := 'cancelled_by_stop_contact';

    if p_queue_key is not null or p_resume_input is not null
       or p_patch->>'next_resume_at' is not null then
      raise exception using errcode='22023',
        message='P9_RECOVERY_STOP_PAYLOAD_INVALID';
    end if;
  else
    if p_queue_key is not null or p_resume_input is not null then
      raise exception using errcode='22023',
        message='P9_RECOVERY_PAUSE_PAYLOAD_INVALID';
    end if;
  end if;

  if v_cancel_reason is not null then
    -- Acquire only ordinary scheduled-resume rows. Never recovery rows.
    for v_candidate_id in
      select q.id from public.ai_run_queue q
       where q.organization_id=p_organization_id
         and q.store_id=p_store_id
         and q.conversation_id=p_conversation_id
         and q.lead_id=p_lead_id
         and q.processed_at is null
         and q.input->>'type'='resume_sales_conversation'
         and left(q.queue_key,length(v_prefix))=v_prefix
         and q.queue_key is distinct from p_queue_key
       order by q.id
       for update nowait
    loop
      if exists (
        select 1 from public.ai_run_queue q
         where q.id=v_candidate_id
           and q.claim_token is not null
           and (
             q.claim_expires_at is null
             or q.claim_expires_at>clock_timestamp()
           )
      ) then
        raise exception using errcode='55P03',
          message='P9_RECOVERY_RESUME_CLAIM_ACTIVE';
      end if;

      update public.ai_run_queue
         set processed_at=v_now,
             processing_error=v_cancel_reason,
             claim_token=null,
             claim_expires_at=null,
             claimed_by=null
       where id=v_candidate_id;
    end loop;
  end if;

  perform public.p9_10_4_d_write_recovery_window_state_by_system(
    p_response_set_id,p_queue_id,p_claim_token,
    p_organization_id,p_store_id,p_conversation_id,
    p_anchor_message_id,p_lead_id,p_patch
  );

  if p_decision_kind='schedule_resume'
     and v_existing.id is null then

    insert into public.ai_run_queue(
      organization_id,store_id,conversation_id,lead_id,
      queue_key,input,enqueued_at,processed_at,processing_error
    ) values (
      p_organization_id,p_store_id,p_conversation_id,p_lead_id,
      p_queue_key,p_resume_input,v_now,null,null
    );
  end if;

  insert into public.p9_recovery_followup_receipts(
    response_set_id,organization_id,store_id,conversation_id,
    lead_id,anchor_message_id,decision_kind,decision_reason,queue_key
  ) values (
    p_response_set_id,p_organization_id,p_store_id,p_conversation_id,
    p_lead_id,p_anchor_message_id,p_decision_kind,v_reason,p_queue_key
  );

  return jsonb_build_object('outcome','applied');
end;
$function$;

alter function public.p9_10_4_d_apply_recovery_followup_by_system(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,jsonb
) owner to postgres;

revoke all on function public.p9_10_4_d_apply_recovery_followup_by_system(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,jsonb
) from public,anon,authenticated;

grant execute on function public.p9_10_4_d_apply_recovery_followup_by_system(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,jsonb
) to service_role;


-- Atomic recovery failure settlement.
-- Human-control deferral is not an execution failure.
create or replace function public.p9_10_4_d_settle_recovery_failure_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_queue_id uuid,
  p_claim_token uuid,
  p_error_text text,
  p_invalid_identity boolean default false
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,pg_temp,public,auth
set row_security=off
as $function$
declare
  q public.ai_run_queue%rowtype;
  c public.conversations%rowtype;
  h public.conversation_human_takeover_leases%rowtype;
  v_conversation_id uuid;
  v_lead_id uuid;
  v_has_lease boolean;
  v_blocked boolean;
  v_result record;
  v_refunded_attempt integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501',
      message='P9_RECOVERY_SETTLEMENT_SYSTEM_ROLE_REQUIRED';
  end if;

  if p_claim_token is null then
    raise exception using errcode='22023',
      message='P9_RECOVERY_SETTLEMENT_CLAIM_REQUIRED';
  end if;

  select x.* into q
    from public.ai_run_queue x
   where x.id=p_queue_id
     and x.organization_id=p_organization_id
     and x.store_id=p_store_id
     and x.claim_token=p_claim_token
     and x.processed_at is null
     and x.input->>'type'='sales_ai_post_materialization_recovery';

  if not found
     or q.claim_expires_at is null
     or q.claim_expires_at<=clock_timestamp() then
    return jsonb_build_object('outcome','claim_lost');
  end if;

  v_conversation_id:=q.conversation_id;
  v_lead_id:=q.lead_id;

  perform public.private_acquire_sales_contract_conversation_xact_lock(
    v_conversation_id
  );

  select x.* into c
    from public.conversations x
    join public.leads l on l.id=x.lead_id
   where x.id=v_conversation_id
     and x.organization_id=p_organization_id
     and x.lead_id=v_lead_id
     and l.organization_id=p_organization_id
     and l.store_id=p_store_id
   for update of x;

  if not found then
    raise exception using errcode='42501',
      message='P9_RECOVERY_SETTLEMENT_SCOPE_MISMATCH';
  end if;

  select x.* into h
    from public.conversation_human_takeover_leases x
   where x.conversation_id=v_conversation_id
   for update;

  v_has_lease:=found;

  if v_has_lease and (
    h.organization_id is distinct from p_organization_id
    or h.store_id is distinct from p_store_id
  ) then
    raise exception using errcode='42501',
      message='P9_RECOVERY_SETTLEMENT_LEASE_SCOPE_MISMATCH';
  end if;

  v_blocked:=
    coalesce(c.is_human_active,false)
    or lower(btrim(coalesce(c.status,'')))='humano_assumiu'
    or (
      v_has_lease and (
        coalesce(h.hard_hold,false)
        or h.released_at is null
      )
    );

  select x.* into q
    from public.ai_run_queue x
   where x.id=p_queue_id
     and x.organization_id=p_organization_id
     and x.store_id=p_store_id
     and x.claim_token=p_claim_token
     and x.processed_at is null
     and x.input->>'type'='sales_ai_post_materialization_recovery'
   for update nowait;

  if not found
     or q.claim_expires_at is null
     or q.claim_expires_at<=clock_timestamp() then
    return jsonb_build_object('outcome','claim_lost');
  end if;

  if q.conversation_id is distinct from v_conversation_id
     or q.lead_id is distinct from v_lead_id
     or q.attempt_count not between 1 and 3 then
    raise exception using errcode='42501',
      message='P9_RECOVERY_SETTLEMENT_BINDING_MISMATCH';
  end if;

  -- The worker observed human control, but an explicit release
  -- won the race before settlement acquired the conversation lock.
  -- Refund only when the canonical lease proves temporal overlap.
  if not v_blocked
     and p_invalid_identity is not true
     and p_error_text in (
       'recovery_human_control_observed',
       'recovery_human_control_blocked'
     )
     and v_has_lease
     and q.p9_recovery_claim_started_at is not null
     and q.p9_recovery_claim_started_at<=q.claim_expires_at
     and h.released_at is not null
     and h.released_at>=q.p9_recovery_claim_started_at
     and h.released_at>=h.takeover_started_at
     and h.takeover_started_at<=q.claim_expires_at
     and h.released_at<=clock_timestamp() then

    update public.ai_run_queue x
       set claim_token=null,
           claim_expires_at=null,
           claimed_by=null,
           p9_recovery_claim_started_at=null,
           attempt_count=x.attempt_count-1
     where x.id=p_queue_id
       and x.organization_id=p_organization_id
       and x.store_id=p_store_id
       and x.conversation_id=v_conversation_id
       and x.lead_id=v_lead_id
       and x.claim_token=p_claim_token
       and x.claim_expires_at>clock_timestamp()
       and x.processed_at is null
       and x.attempt_count between 1 and 3
       and x.input->>'type'='sales_ai_post_materialization_recovery'
    returning x.attempt_count into v_refunded_attempt;

    if not found then
      return jsonb_build_object('outcome','claim_lost');
    end if;

    return jsonb_build_object(
      'outcome','deferred',
      'attempt_count',v_refunded_attempt,
      'reason','confirmed_human_control_release_race'
    );
  end if;

  if v_blocked then
    select * into v_result
      from public.release_ai_run_queue_recovery_claim_by_system(
        p_organization_id,p_store_id,p_queue_id,p_claim_token
      );

    if v_result.ok is distinct from true
       or v_result.id is distinct from p_queue_id
       or v_result.claim_token is distinct from p_claim_token then
      raise exception 'P9_RECOVERY_DEFERRAL_NOT_CONFIRMED';
    end if;

    return jsonb_build_object(
      'outcome','deferred',
      'attempt_count',v_result.attempt_count
    );
  end if;

  select * into v_result
    from public.finalize_ai_run_queue_task_by_system(
      p_organization_id,p_store_id,p_queue_id,p_claim_token,
      case when p_invalid_identity is true
        then 'failed_final'
        else 'retryable'
      end,
      left(coalesce(nullif(p_error_text,''),'recovery_failed'),900),
      3
    );

  if v_result.ok is distinct from true then
    return jsonb_build_object('outcome','claim_lost');
  end if;

  if v_result.id is distinct from p_queue_id
     or v_result.organization_id is distinct from p_organization_id
     or v_result.store_id is distinct from p_store_id
     or v_result.claim_token is distinct from p_claim_token then
    raise exception 'P9_RECOVERY_FINALIZATION_BINDING_MISMATCH';
  end if;

  return jsonb_build_object(
    'outcome',
    case when v_result.terminal
      then 'failed_final'
      else 'retryable'
    end,
    'attempt_count',v_result.attempt_count
  );
end;
$function$;

alter function public.p9_10_4_d_settle_recovery_failure_by_system(
  uuid,uuid,uuid,uuid,text,boolean
) owner to postgres;

revoke all on function public.p9_10_4_d_settle_recovery_failure_by_system(
  uuid,uuid,uuid,uuid,text,boolean
) from public,anon,authenticated;

grant execute on function public.p9_10_4_d_settle_recovery_failure_by_system(
  uuid,uuid,uuid,uuid,text,boolean
) to service_role;


-- Preserve canonical cross-sell authority and ordinary replay.
-- Recovery credentials are transient, not business identity.
do $cross_sell_replay_patch$
declare
  v_oid oid;
  v_definition text;
  v_anchor text;
  v_replacement text;
  v_count integer;
  v_owner oid;
  v_acl aclitem[];
  v_config text[];
  v_security_definer boolean;
begin
  v_oid:=to_regprocedure(
    'public.record_commercial_cross_sell_suggestion_by_system(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,jsonb)'
  );

  if v_oid is null then
    raise exception 'P9_CROSS_SELL_CANONICAL_WRITER_MISSING';
  end if;

  select p.proowner,p.proacl,p.proconfig,p.prosecdef
    into v_owner,v_acl,v_config,v_security_definer
    from pg_catalog.pg_proc p
   where p.oid=v_oid;

  v_definition:=pg_get_functiondef(v_oid);

  if md5(v_definition)
       is distinct from '0ef0eb3aa5dd58c8c6201309c0f628f9'
  then
    raise exception 'P9_CROSS_SELL_CANONICAL_BASELINE_DRIFT';
  end if;

  v_definition:=pg_catalog.replace(
    pg_catalog.replace(
      v_definition,
      chr(13)||chr(10),
      chr(10)
    ),
    chr(13),
    chr(10)
  );

  v_anchor:=$anchor$
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);$anchor$;

  v_anchor:=pg_catalog.replace(
    pg_catalog.replace(
      v_anchor,
      chr(13)||chr(10),
      chr(10)
    ),
    chr(13),
    chr(10)
  );

  v_replacement:=v_anchor||$declarations$

  v_recovery_bound boolean := false;
  v_recovery_set uuid;
  v_recovery_queue uuid;
  v_recovery_token uuid;
  v_recovery_anchor uuid;
  v_recovery_lead uuid;
$declarations$;

  v_count:=
    (length(v_definition)
     -length(replace(v_definition,v_anchor,'')))
    /length(v_anchor);

  if v_count<>1 then
    raise exception 'P9_CROSS_SELL_DECLARATION_ANCHOR_INVALID';
  end if;

  v_definition:=replace(
    v_definition,v_anchor,v_replacement
  );

  -- Insert after the original cross-sell advisory lock,
  -- before the canonical opportunity row is acquired.
  v_anchor:=$anchor$
  select opportunity_row.*$anchor$;

  v_anchor:=pg_catalog.replace(
    pg_catalog.replace(
      v_anchor,
      chr(13)||chr(10),
      chr(10)
    ),
    chr(13),
    chr(10)
  );

  v_replacement:=$authority$

  v_recovery_bound:=v_metadata ?| array[
    'p9_recovery_response_set_id',
    'p9_recovery_queue_id',
    'p9_recovery_claim_token',
    'p9_recovery_anchor_message_id'
  ];

  if v_recovery_bound then
    v_recovery_set:=
      nullif(v_metadata->>'p9_recovery_response_set_id','')::uuid;

    v_recovery_queue:=
      nullif(v_metadata->>'p9_recovery_queue_id','')::uuid;

    v_recovery_token:=
      nullif(v_metadata->>'p9_recovery_claim_token','')::uuid;

    v_recovery_anchor:=
      nullif(v_metadata->>'p9_recovery_anchor_message_id','')::uuid;

    if v_recovery_set is null
       or v_recovery_queue is null
       or v_recovery_token is null
       or v_recovery_anchor is null then
      raise exception using
        errcode='42501',
        message='P9_RECOVERY_CROSS_SELL_BINDING_REQUIRED';
    end if;

    select c.lead_id into v_recovery_lead
      from public.conversations c
      join public.leads l on l.id=c.lead_id
     where c.id=p_conversation_id
       and c.organization_id=p_organization_id
       and l.organization_id=p_organization_id
       and l.store_id=p_store_id;

    if not found or v_recovery_lead is null then
      raise exception using
        errcode='42501',
        message='P9_RECOVERY_CROSS_SELL_SCOPE_MISMATCH';
    end if;

    perform public.p9_10_4_d_assert_recovery_set_claim_authority(
      v_recovery_set,
      v_recovery_queue,
      v_recovery_token,
      p_organization_id,
      p_store_id,
      p_conversation_id,
      v_recovery_anchor,
      v_recovery_lead,
      p_commercial_opportunity_id
    );

    if v_metadata->>'source_message_id'
         is distinct from v_recovery_anchor::text
       or not exists (
         select 1
           from public.p19a_sales_ai_reply_sets s
          where s.id=v_recovery_set
            and s.organization_id=p_organization_id
            and s.store_id=p_store_id
            and s.conversation_id=p_conversation_id
            and s.commercial_opportunity_id=p_commercial_opportunity_id
            and s.anchor_message_id=v_recovery_anchor
            and s.text_message_id=p_suggestion_message_id
            and s.materialization_state='confirmed'
            and s.confirmed_at is not null
       ) then
      raise exception using
        errcode='42501',
        message='P9_RECOVERY_CROSS_SELL_MESSAGE_MISMATCH';
    end if;
  end if;
$authority$||v_anchor;

  v_count:=
    (length(v_definition)
     -length(replace(v_definition,v_anchor,'')))
    /length(v_anchor);

  if v_count<>1 then
    raise exception 'P9_CROSS_SELL_AUTHORITY_ANCHOR_INVALID';
  end if;

  v_definition:=replace(
    v_definition,v_anchor,v_replacement
  );

  v_anchor:=
    'or v_existing.metadata is distinct from v_metadata then';

  v_replacement:=$replay$
or (
         case when v_recovery_bound then
           (
             (
               v_existing.metadata
                 - 'p9_recovery_response_set_id'
             ) is distinct from (
               v_metadata
                 - 'p9_recovery_response_set_id'
                 - 'p9_recovery_queue_id'
                 - 'p9_recovery_claim_token'
                 - 'p9_recovery_anchor_message_id'
             )
             or (
               v_existing.metadata
                 ? 'p9_recovery_response_set_id'
               and v_existing.metadata
                 ->>'p9_recovery_response_set_id'
                   is distinct from v_recovery_set::text
             )
           )
         else
           v_existing.metadata is distinct from v_metadata
         end
       ) then$replay$;

  v_count:=
    (length(v_definition)
     -length(replace(v_definition,v_anchor,'')))
    /length(v_anchor);

  if v_count<>1 then
    raise exception 'P9_CROSS_SELL_REPLAY_ANCHOR_INVALID';
  end if;

  v_definition:=replace(
    v_definition,v_anchor,v_replacement
  );

  execute v_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc p
     where p.oid=v_oid
       and p.proowner=v_owner
       and p.proacl is not distinct from v_acl
       and p.proconfig is not distinct from v_config
       and p.prosecdef=v_security_definer
  ) then
    raise exception 'P9_CROSS_SELL_SECURITY_CONFIGURATION_DRIFT';
  end if;
end;
$cross_sell_replay_patch$;


commit;

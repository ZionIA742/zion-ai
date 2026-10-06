begin;
set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('20261006170000_p9_8_4_b2b_human_decision', 0)
);
-- P9 8.4 B2B: authenticated human decision over the concession ledger.
-- This writer authorizes/rejects a concession only; it never changes quote
-- money, quote versions, Settings, or the persisted authority snapshot.
do $preflight$
begin
  if pg_catalog.to_regclass('public.commercial_negotiation_concessions') is null
     or pg_catalog.to_regclass('public.commercial_negotiation_concession_decision_events') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_lifecycle_events') is null
     or pg_catalog.to_regclass('public.sales_quotes') is null
     or pg_catalog.to_regclass('public.sales_quote_versions') is null
     or pg_catalog.to_regclass('public.memberships') is null
     or pg_catalog.to_regprocedure(
       'public.p9_resolve_current_commercial_proposal_internal(uuid,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.p9_compute_commercial_negotiation_concession_request_fingerprint_internal(jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.decide_commercial_negotiation_concession_by_system(uuid,uuid,uuid,uuid)'
     ) is null
     or pg_catalog.to_regclass(
       'public.commercial_negotiation_concessions_materialized_ordinal_uidx'
     ) is null
     or not exists (
       select 1
       from pg_catalog.pg_attribute attribute_row
       where attribute_row.attrelid =
             'public.commercial_negotiation_concessions'::pg_catalog.regclass
         and attribute_row.attname = 'effective_decision'
         and not attribute_row.attisdropped
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid =
             'public.commercial_negotiation_concessions'::pg_catalog.regclass
         and constraint_row.conname =
             'commercial_negotiation_concessions_human_exception_unconfigured_check'
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid =
             'public.commercial_negotiation_concessions'::pg_catalog.regclass
         and constraint_row.conname =
             'commercial_negotiation_concessions_human_exception_blocked_reason_check'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B2B_PRECONDITIONS_FAILED';
  end if;
end;
$preflight$;
create or replace function public.decide_commercial_negotiation_concession_by_human(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_concession_id uuid,
  p_decision text,
  p_reason text,
  p_approval_reference text default null
)
returns table (
  concession_id uuid,
  status text,
  effective_decision text,
  authority_decision text,
  reason_code text,
  negotiation_cycle_id uuid,
  quote_id uuid,
  quote_version_id uuid,
  decision_event_id uuid,
  operation_key text,
  request_fingerprint text,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
  v_actor uuid := auth.uid();
  v_decision text := nullif(pg_catalog.btrim(coalesce(p_decision, '')), '');
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_reference text := nullif(pg_catalog.btrim(coalesce(p_approval_reference, '')), '');
  v_operation_key text :=
    'commercial_negotiation_concession_human_decision:' || p_concession_id::text;
  v_now timestamptz;
  v_concession public.commercial_negotiation_concessions%rowtype;
  v_opportunity public.commercial_opportunities%rowtype;
  v_quote public.sales_quotes%rowtype;
  v_version public.sales_quote_versions%rowtype;
  v_proposal record;
  v_event public.commercial_negotiation_concession_decision_events%rowtype;
  v_effective text;
  v_to_status text;
  v_payload jsonb;
  v_fingerprint text;
  v_normal_count integer;
  v_normal public.commercial_negotiation_concessions%rowtype;
begin
  if v_role is distinct from 'authenticated' or v_actor is null then
    raise exception using errcode = '42501', message = 'P9_8_4_B2B_HUMAN_WRITER_NOT_AUTHORIZED';
  end if;
  if not exists (
    select 1 from public.memberships membership_row
    where membership_row.organization_id = p_organization_id
      and membership_row.user_id = v_actor
      and membership_row.is_active is true
  ) then
    raise exception using errcode = '42501', message = 'P9_8_4_B2B_MEMBERSHIP_REQUIRED';
  end if;
  if v_decision not in ('approve', 'reject') or v_reason is null then
    raise exception using errcode = '22023', message = 'P9_8_4_B2B_DECISION_ARGUMENTS_INVALID';
  end if;
  select concession_row.* into v_concession
  from public.commercial_negotiation_concessions concession_row
  where concession_row.id = p_concession_id
    and concession_row.organization_id = p_organization_id
    and concession_row.store_id = p_store_id
    and concession_row.commercial_opportunity_id = p_commercial_opportunity_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'P9_8_4_B2B_CONCESSION_NOT_FOUND_IN_SCOPE';
  end if;
  select event_row.* into v_event
  from public.commercial_negotiation_concession_decision_events event_row
  where event_row.organization_id = p_organization_id
    and event_row.store_id = p_store_id
    and event_row.concession_id = p_concession_id
    and event_row.operation_key = v_operation_key
  for update;
  if found then
    if v_event.decision_kind is distinct from 'human_decision'
       or v_event.actor_kind is distinct from 'human'
       or v_event.actor_user_id is distinct from v_actor
       or v_concession.approval_actor_user_id is distinct from v_actor
       or v_concession.approval_reason is distinct from v_reason
       or v_concession.approval_reference is distinct from v_reference then
      raise exception using errcode = '23505', message = 'P9_8_4_B2B_IDEMPOTENCY_KEY_REUSED_DIVERGENT';
    end if;
    v_payload := pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id, 'store_id', p_store_id,
      'commercial_opportunity_id', p_commercial_opportunity_id,
      'negotiation_cycle_id', v_concession.negotiation_cycle_id,
      'concession_id', v_concession.id, 'quote_id', v_concession.quote_id,
      'quote_version_id', v_concession.quote_version_id,
      'from_status', v_event.from_status, 'decision', v_decision,
      'actor_user_id', v_actor, 'reason', v_reason,
      'approval_reference', v_reference,
      'authority_decision', v_concession.authority_decision,
      'authority_snapshot', v_concession.authority_snapshot,
      'effective_decision', v_event.effective_decision,
      'to_status', v_event.to_status
    );
    if v_event.request_fingerprint is distinct from
       public.p9_compute_commercial_negotiation_concession_request_fingerprint_internal(v_payload) then
      raise exception using errcode = '23505', message = 'P9_8_4_B2B_IDEMPOTENCY_KEY_REUSED_DIVERGENT';
    end if;
    return query select v_concession.id, v_event.to_status, v_event.effective_decision,
      v_concession.authority_decision, v_event.reason_code, v_concession.negotiation_cycle_id,
      v_concession.quote_id, v_concession.quote_version_id, v_event.id, v_event.operation_key,
      v_event.request_fingerprint, true;
    return;
  end if;
  if v_concession.concession_class = 'normal' then
    if v_concession.status is distinct from 'pending_human_approval'
       or v_concession.effective_decision is distinct from 'human_approval_required' then
      raise exception using errcode = '23514', message = 'P9_8_4_B2B_NORMAL_NOT_PENDING_HUMAN_APPROVAL';
    end if;
  elsif v_concession.concession_class = 'human_exception' then
    if v_concession.origin is distinct from 'human'
       or v_concession.high_value is not false
       or v_concession.status is distinct from 'proposed' then
      raise exception using errcode = '23514', message = 'P9_8_4_B2B_HUMAN_EXCEPTION_NOT_PROPOSED';
    end if;
  else
    raise exception using errcode = '23514', message = 'P9_8_4_B2B_CONCESSION_CLASS_INVALID';
  end if;
  select opportunity_row.* into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id
  for update;
  if not found or v_opportunity.stage is distinct from 'negociacao' then
    raise exception using errcode = '23514', message = 'P9_8_4_B2B_OPPORTUNITY_STALE';
  end if;
  if not exists (
    select 1 from public.commercial_opportunity_lifecycle_events lifecycle_row
    where lifecycle_row.id = v_concession.negotiation_cycle_id
      and lifecycle_row.organization_id = p_organization_id
      and lifecycle_row.store_id = p_store_id
      and lifecycle_row.commercial_opportunity_id = p_commercial_opportunity_id
      and lifecycle_row.lifecycle_cycle = v_opportunity.lifecycle_cycle
      and lifecycle_row.event_type = 'stage_transition'
      and lifecycle_row.new_stage = 'negociacao'
      and lifecycle_row.reason_code in ('concrete_offer_required','concrete_quote_objection_required','visit_viable_concrete_offer_required','renegotiation_required')
  ) then
    raise exception using errcode = '23514', message = 'P9_8_4_B2B_NEGOTIATION_CYCLE_STALE';
  end if;
  select quote_row.* into v_quote from public.sales_quotes quote_row
  where quote_row.id = v_concession.quote_id and quote_row.organization_id = p_organization_id
    and quote_row.store_id = p_store_id and quote_row.commercial_opportunity_id = p_commercial_opportunity_id
  for update;
  if not found then raise exception using errcode = '23514', message = 'P9_8_4_B2B_QUOTE_STALE'; end if;
  select version_row.* into v_version from public.sales_quote_versions version_row
  where version_row.id = v_concession.quote_version_id and version_row.quote_id = v_concession.quote_id
    and version_row.organization_id = p_organization_id and version_row.store_id = p_store_id
  for update;
  if not found then raise exception using errcode = '23514', message = 'P9_8_4_B2B_QUOTE_VERSION_STALE'; end if;
  select proposal.* into v_proposal
  from public.p9_resolve_current_commercial_proposal_internal(p_organization_id,p_store_id,p_commercial_opportunity_id) proposal;
  if not found or v_proposal.proposal_state is distinct from 'available'
     or v_proposal.lifecycle_cycle is distinct from v_opportunity.lifecycle_cycle
     or v_proposal.current_quote_id is distinct from v_concession.quote_id
     or v_proposal.current_quote_version_id is distinct from v_concession.quote_version_id
     or v_proposal.version_status not in ('sent','superseded')
     or v_proposal.version_sent_at is null
     or v_proposal.reason_code is distinct from 'current_proposal_authority_valid' then
    raise exception using errcode = '23514', message = 'P9_8_4_B2B_CURRENT_PROPOSAL_STALE';
  end if;
  if v_concession.concession_class = 'human_exception' and v_decision = 'approve' then
    v_normal_count := 0;
    for v_normal in
      select normal_row.*
      from public.commercial_negotiation_concessions normal_row
      where normal_row.organization_id = p_organization_id
        and normal_row.store_id = p_store_id
        and normal_row.commercial_opportunity_id = p_commercial_opportunity_id
        and normal_row.negotiation_cycle_id = v_concession.negotiation_cycle_id
        and normal_row.concession_class = 'normal'
        and normal_row.status = 'materialized'
        and normal_row.concession_number in (1, 2)
      order by normal_row.concession_number
      for update
    loop
      v_normal_count := v_normal_count + 1;
      if (v_normal_count = 1 and v_normal.concession_number is distinct from 1)
         or (v_normal_count = 2 and v_normal.concession_number is distinct from 2)
         or v_normal_count > 2 then
        raise exception using
          errcode = '23514',
          message = 'P9_8_4_B2B_HUMAN_EXCEPTION_NORMALS_REQUIRED';
      end if;
    end loop;
    if v_normal_count <> 2 then
      raise exception using
        errcode = '23514',
        message = 'P9_8_4_B2B_HUMAN_EXCEPTION_NORMALS_REQUIRED';
    end if;
  end if;
  if v_decision = 'approve' then
    if v_concession.concession_class = 'normal' then
      v_effective := 'allowed';
    elsif v_concession.authority_decision in ('allowed','human_approval_required')
       or (v_concession.authority_decision = 'blocked' and v_concession.authority_snapshot ->> 'reasonCode' = 'TRANSACTIONAL_AUTHORITY_ABOVE_MAX_BLOCKED') then
      v_effective := 'allowed';
    else
      raise exception using errcode = '23514', message = 'P9_8_4_B2B_HUMAN_EXCEPTION_AUTHORITY_BLOCKED';
    end if;
    v_to_status := 'authorized';
  else
    v_effective := 'blocked';
    v_to_status := 'rejected';
  end if;
  v_now := pg_catalog.clock_timestamp();
  update public.commercial_negotiation_concessions concession_row
  set status = v_to_status, effective_decision = v_effective,
      approval_status = case when v_decision = 'approve' then 'approved' else 'rejected' end,
      approval_decided_at = v_now, approval_actor_user_id = v_actor,
      approval_reason = v_reason, approval_reference = v_reference,
      authorized_at = case when v_decision = 'approve' then v_now else null end,
      rejected_at = case when v_decision = 'reject' then v_now else null end,
      materialized_at = null, concession_number = null, updated_at = v_now
  where concession_row.id = v_concession.id and concession_row.organization_id = p_organization_id
    and concession_row.store_id = p_store_id and concession_row.status = v_concession.status;
  if not found then raise exception using errcode = '40001', message = 'P9_8_4_B2B_CONCESSION_TRANSITION_LOST'; end if;
  v_payload := pg_catalog.jsonb_build_object(
    'organization_id', p_organization_id, 'store_id', p_store_id,
    'commercial_opportunity_id', p_commercial_opportunity_id,
    'negotiation_cycle_id', v_concession.negotiation_cycle_id, 'concession_id', v_concession.id,
    'quote_id', v_concession.quote_id, 'quote_version_id', v_concession.quote_version_id,
    'from_status', v_concession.status, 'decision', v_decision, 'actor_user_id', v_actor,
    'reason', v_reason, 'approval_reference', v_reference,
    'authority_decision', v_concession.authority_decision,
    'authority_snapshot', v_concession.authority_snapshot, 'effective_decision', v_effective,
    'to_status', v_to_status
  );
  v_fingerprint := public.p9_compute_commercial_negotiation_concession_request_fingerprint_internal(v_payload);
  insert into public.commercial_negotiation_concession_decision_events (
    organization_id, store_id, commercial_opportunity_id, negotiation_cycle_id, concession_id,
    decision_kind, from_status, to_status, effective_decision, operation_key, request_fingerprint,
    actor_kind, actor_user_id, reason_code, created_at
  ) values (
    p_organization_id, p_store_id, p_commercial_opportunity_id, v_concession.negotiation_cycle_id,
    v_concession.id, 'human_decision', v_concession.status, v_to_status, v_effective,
    v_operation_key, v_fingerprint, 'human', v_actor, v_reason, v_now
  ) returning * into v_event;
  return query select v_concession.id, v_to_status, v_effective, v_concession.authority_decision,
    v_reason, v_concession.negotiation_cycle_id, v_concession.quote_id, v_concession.quote_version_id,
    v_event.id, v_operation_key, v_fingerprint, false;
end;
$function$;
alter function public.decide_commercial_negotiation_concession_by_human(uuid,uuid,uuid,uuid,text,text,text)
  owner to postgres;
revoke all on function public.decide_commercial_negotiation_concession_by_human(uuid,uuid,uuid,uuid,text,text,text)
from public, anon, authenticated, service_role;
grant execute on function public.decide_commercial_negotiation_concession_by_human(uuid,uuid,uuid,uuid,text,text,text)
to authenticated;
do $postconditions$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.decide_commercial_negotiation_concession_by_human(uuid,uuid,uuid,uuid,text,text,text)'
  );
begin
  if v_oid is null
     or not exists (
       select 1
       from pg_catalog.pg_proc proc_row
       join pg_catalog.pg_roles owner_row
         on owner_row.oid = proc_row.proowner
       where proc_row.oid = v_oid
         and proc_row.prosecdef
         and owner_row.rolname = 'postgres'
         and exists (
           select 1
           from pg_catalog.unnest(
             coalesce(proc_row.proconfig, array[]::text[])
           ) config_row
           where config_row = 'row_security=off'
         )
         and exists (
           select 1
           from pg_catalog.unnest(
             coalesce(proc_row.proconfig, array[]::text[])
           ) config_row
           where config_row = 'search_path=pg_catalog, pg_temp, public'
         )
     )
     or exists (
       select 1
       from pg_catalog.pg_proc proc_row
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           proc_row.proacl,
           pg_catalog.acldefault('f', proc_row.proowner)
         )
       ) privilege_row
       where proc_row.oid = v_oid
         and privilege_row.grantee = 0
         and privilege_row.privilege_type = 'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or pg_catalog.has_table_privilege(
          'authenticated',
          'public.commercial_negotiation_concession_decision_events',
          'INSERT'
        )
     or pg_catalog.has_table_privilege(
          'service_role',
          'public.commercial_negotiation_concession_decision_events',
          'INSERT'
        ) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_8_4_B2B_POSTCONDITIONS_FAILED';
  end if;
end;
$postconditions$;
commit;

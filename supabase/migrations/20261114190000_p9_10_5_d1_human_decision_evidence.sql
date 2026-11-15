begin;

set local search_path = pg_catalog, pg_temp, public, auth, extensions;

create table public.commercial_human_decision_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  conversation_id uuid not null,
  commercial_opportunity_id uuid not null,
  actor_user_id uuid not null,
  decision_domain text not null,
  decision_field text not null,
  canonical_value_json jsonb null,
  source_type text not null,
  source_id uuid not null,
  source_version text not null,
  operation_key text not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint p9_human_evidence_org_fk
    foreign key (organization_id) references public.organizations(id) on delete restrict,
  constraint p9_human_evidence_store_scope_fk
    foreign key (store_id, organization_id) references public.stores(id, organization_id) on delete restrict,
  constraint p9_human_evidence_conversation_scope_fk
    foreign key (conversation_id, organization_id) references public.conversations(id, organization_id) on delete restrict,
  constraint p9_human_evidence_opportunity_scope_fk
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id) on delete restrict,
  constraint p9_human_evidence_actor_fk
    foreign key (actor_user_id) references auth.users(id) on delete restrict,
  constraint p9_human_evidence_source_fk
    foreign key (source_id) references public.commercial_opportunity_lifecycle_events(id) on delete restrict,
  constraint p9_human_evidence_domain_chk
    check (decision_domain in ('crm_stage', 'commercial_facts', 'proposal', 'products', 'commitments', 'opportunity')),
  constraint p9_human_evidence_field_chk
    check (
      (decision_domain = 'crm_stage' and decision_field = 'stage')
      or (decision_domain = 'commercial_facts' and decision_field = 'qualification_fact')
      or (decision_domain = 'proposal' and decision_field in ('proposal', 'total_value', 'currency', 'version'))
      or (decision_domain = 'products' and decision_field in ('product', 'quantity', 'unit_value', 'total_value'))
      or (decision_domain = 'commitments' and decision_field in ('commitment', 'scheduled_at', 'description'))
      or (decision_domain = 'opportunity' and decision_field = 'selected_opportunity')
    ),
  constraint p9_human_evidence_source_type_chk
    check (source_type = 'commercial_opportunity_lifecycle_event'),
  constraint p9_human_evidence_operation_key_chk
    check (length(btrim(operation_key)) between 1 and 200),
  constraint p9_human_evidence_version_chk
    check (length(btrim(source_version)) between 1 and 100),
  constraint p9_human_evidence_source_unique
    unique (source_id, decision_domain, decision_field),
  constraint p9_human_evidence_operation_unique
    unique (organization_id, operation_key)
);

alter table public.commercial_human_decision_evidence enable row level security;
revoke all on table public.commercial_human_decision_evidence from public, anon, authenticated, service_role;
grant select on table public.commercial_human_decision_evidence to authenticated, service_role;

create policy p9_human_evidence_select_membership
  on public.commercial_human_decision_evidence
  for select to authenticated
  using (
    exists (
      select 1
      from public.memberships membership_row
      where membership_row.organization_id = commercial_human_decision_evidence.organization_id
        and membership_row.user_id = auth.uid()
        and membership_row.is_active is true
    )
  );

create or replace function public.record_human_stage_decision_evidence_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_commercial_opportunity_id uuid,
  p_actor_user_id uuid,
  p_operation_key text,
  p_source_id uuid,
  p_decision_field text,
  p_canonical_value_json jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public, auth
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_existing public.commercial_human_decision_evidence;
  v_opportunity public.commercial_opportunities;
  v_event public.commercial_opportunity_lifecycle_events;
  v_evidence_id uuid;
begin
  if v_user_id is null or v_user_id is distinct from p_actor_user_id
     or nullif(current_setting('request.jwt.claim.role', true), '') <> 'authenticated' then
    raise exception using errcode = '42501', message = 'human decision evidence actor is not authorized';
  end if;

  select opportunity_row.* into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id
    and opportunity_row.primary_conversation_id = p_conversation_id
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'human decision evidence opportunity scope mismatch';
  end if;

  select lifecycle_event.* into v_event
  from public.commercial_opportunity_lifecycle_events lifecycle_event
  where lifecycle_event.id = p_source_id
    and lifecycle_event.organization_id = p_organization_id
    and lifecycle_event.store_id = p_store_id
    and lifecycle_event.commercial_opportunity_id = p_commercial_opportunity_id
    and lifecycle_event.actor_type = 'human'
    and lifecycle_event.actor_user_id = p_actor_user_id
    and lifecycle_event.event_type = 'stage_transition';
  if not found then
    raise exception using errcode = '23514', message = 'human decision evidence source is not canonical';
  end if;

  if v_event.idempotency_key is distinct from p_operation_key
     or p_decision_field <> 'stage'
     or p_canonical_value_json is distinct from to_jsonb(v_event.new_stage)
     or v_event.lifecycle_cycle is null then
    raise exception using errcode = '23514', message = 'human decision evidence source mismatch';
  end if;

  select * into v_existing
  from public.commercial_human_decision_evidence evidence_row
  where evidence_row.organization_id = p_organization_id
    and evidence_row.operation_key = p_operation_key;
  if found then
    if v_existing.source_id is distinct from p_source_id
       or v_existing.actor_user_id is distinct from p_actor_user_id
       or v_existing.commercial_opportunity_id is distinct from p_commercial_opportunity_id
       or v_existing.canonical_value_json is distinct from p_canonical_value_json then
      raise exception using errcode = '23505', message = 'ZION_HUMAN_EVIDENCE_IDEMPOTENCY_KEY_REUSED';
    end if;
    return v_existing.id;
  end if;

  insert into public.commercial_human_decision_evidence (
    organization_id, store_id, conversation_id, commercial_opportunity_id,
    actor_user_id, decision_domain, decision_field, canonical_value_json,
    source_type, source_id, source_version, operation_key, observed_at
  ) values (
    p_organization_id, p_store_id, p_conversation_id, p_commercial_opportunity_id,
    p_actor_user_id, 'crm_stage', p_decision_field, p_canonical_value_json,
    'commercial_opportunity_lifecycle_event', v_event.id, v_event.lifecycle_cycle::text,
    p_operation_key, v_event.created_at
  ) returning id into v_evidence_id;

  return v_evidence_id;
end;
$function$;

alter function public.record_human_stage_decision_evidence_internal(uuid, uuid, uuid, uuid, uuid, text, uuid, text, jsonb) owner to postgres;
revoke all on function public.record_human_stage_decision_evidence_internal(uuid, uuid, uuid, uuid, uuid, text, uuid, text, jsonb) from public, anon, authenticated, service_role;

create or replace function public.transition_commercial_opportunity_stage_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_idempotency_key text,
  p_target_stage text,
  p_reason_details text default null,
  p_evidence_type text default null,
  p_evidence_message_id uuid default null,
  p_evidence_summary text default null,
  p_source text default 'manual_stage_transition'
)
returns table (
  commercial_opportunity_id uuid,
  stage text,
  lifecycle_cycle integer,
  lifecycle_event_id uuid,
  event_type text,
  reason_code text,
  stage_changed_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public, auth
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  v_transition record;
  v_conversation_id uuid;
  v_ledger_sqlstate text;
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using errcode = '42501', message = 'commercial opportunity stage transition by user is not authorized';
  end if;
  if not exists (
    select 1 from public.memberships membership_row
    where membership_row.organization_id = p_request_organization_id
      and membership_row.user_id = v_user_id
      and membership_row.is_active is true
  ) then
    raise exception using errcode = '42501', message = 'commercial opportunity stage transition by user is not authorized';
  end if;

  select * into v_transition
  from public.apply_commercial_opportunity_stage_transition_internal(
    p_request_organization_id, p_store_id, p_commercial_opportunity_id,
    p_idempotency_key, p_target_stage, p_reason_details, p_evidence_type,
    p_evidence_message_id, p_evidence_summary, p_source,
    'stage_transition', 'human', v_user_id
  );

  select opportunity_row.primary_conversation_id into v_conversation_id
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id;
  if v_conversation_id is not null then
    begin
      perform public.record_human_stage_decision_evidence_internal(
        p_request_organization_id, p_store_id, v_conversation_id,
        p_commercial_opportunity_id, v_user_id, p_idempotency_key,
        v_transition.lifecycle_event_id, 'stage', to_jsonb(v_transition.stage)
      );
    exception when others then
      get stacked diagnostics v_ledger_sqlstate = returned_sqlstate;
      if v_ledger_sqlstate in (
        '22023', -- invalid ledger arguments
        '23502', -- required ledger value missing
        '23503', -- tenant/scope/source foreign key
        '23505', -- idempotency or source uniqueness
        '23514', -- tenant/scope/catalog/source validation
        '40001', -- serialization failure
        '40P01', -- deadlock detected
        '42501'  -- authorization failure
      ) then
        raise;
      end if;
      -- A canonical CRM transition is a primary human action. The lifecycle
      -- event is already durable and is the source for a later evidence retry;
      -- an auxiliary ledger failure must not roll back that legitimate action.
      null;
    end;
  end if;

  return query select v_transition.commercial_opportunity_id, v_transition.stage,
    v_transition.lifecycle_cycle, v_transition.lifecycle_event_id, v_transition.event_type,
    v_transition.reason_code, v_transition.stage_changed_at, v_transition.updated_at;
end;
$function$;

alter function public.transition_commercial_opportunity_stage_by_user(uuid, uuid, uuid, text, text, text, text, uuid, text, text) owner to postgres;
revoke all on function public.transition_commercial_opportunity_stage_by_user(uuid, uuid, uuid, text, text, text, text, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.transition_commercial_opportunity_stage_by_user(uuid, uuid, uuid, text, text, text, text, uuid, text, text) to authenticated;

commit;

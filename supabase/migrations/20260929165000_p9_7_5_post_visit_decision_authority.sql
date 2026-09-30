-- ZION / Pilar 9 / Bloco 7 / Etapa 7.5
-- Canonical post-technical-visit decision authority.
--
-- This migration persists only a proposed consequence. It deliberately does
-- not mutate stage, loss, follow-up, quote, negotiation, or appointment.

begin;

do $preflight$
begin
  if pg_catalog.to_regclass('public.store_technical_visit_result_events') is null
     or pg_catalog.to_regclass('public.store_technical_visit_result_current') is null then
    raise exception using errcode = 'P0001',
      message = 'P9 7.5 decision precondition failed: technical visit result authority is missing';
  end if;

  if pg_catalog.to_regprocedure(
    'public.read_commercial_opportunity_qualification_facts_internal(uuid,uuid,uuid)'
  ) is null then
    raise exception using errcode = 'P0001',
      message = 'P9 7.5 decision precondition failed: qualification reader is missing';
  end if;

  if pg_catalog.to_regprocedure(
    'public.p9_resolve_commercial_action_readiness_internal(uuid,uuid,uuid,text)'
  ) is null then
    raise exception using errcode = 'P0001',
      message = 'P9 7.5 decision precondition failed: commercial readiness resolver is missing';
  end if;

  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using errcode = 'P0001',
      message = 'P9 7.5 decision precondition failed: digest is missing';
  end if;
end
$preflight$;

create table public.store_technical_visit_post_visit_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  appointment_id uuid not null,
  commercial_opportunity_id uuid not null,
  lifecycle_cycle integer not null,
  result_event_id uuid not null,
  decision_kind text not null,
  decision_reason text not null,
  decision_basis jsonb not null default '{}'::jsonb,
  operation_key text not null,
  request_fingerprint text not null,
  effects_executed boolean not null default false,
  execution_status text not null default 'not_executed',
  created_at timestamptz not null default pg_catalog.clock_timestamp(),

  constraint store_technical_visit_post_visit_decisions_event_scope_fkey
    foreign key (result_event_id, organization_id, store_id, appointment_id)
    references public.store_technical_visit_result_events(
      id, organization_id, store_id, appointment_id
    )
    on delete restrict,

  constraint store_technical_visit_post_visit_decisions_appointment_scope_fkey
    foreign key (appointment_id, organization_id, store_id)
    references public.store_appointments(id, organization_id, store_id)
    on delete restrict,

  constraint store_technical_visit_post_visit_decisions_opportunity_scope_fkey
    foreign key (commercial_opportunity_id, organization_id, store_id)
    references public.commercial_opportunities(id, organization_id, store_id)
    on delete restrict,

  constraint store_technical_visit_post_visit_decisions_cycle_chk
    check (lifecycle_cycle >= 1),

  constraint store_technical_visit_post_visit_decisions_kind_chk
    check (decision_kind in (
      'qualification', 'quote', 'negotiation', 'followup',
      'loss', 'new_visit', 'needs_resolution', 'none'
    )),

  constraint store_technical_visit_post_visit_decisions_basis_chk
    check (pg_catalog.jsonb_typeof(decision_basis) = 'object'),

  constraint store_technical_visit_post_visit_decisions_operation_key_chk
    check (pg_catalog.length(pg_catalog.btrim(operation_key)) > 0
           and pg_catalog.length(operation_key) <= 512),

  constraint store_technical_visit_post_visit_decisions_fingerprint_chk
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),

  constraint store_technical_visit_post_visit_decisions_no_effects_chk
    check (not effects_executed and execution_status = 'not_executed'),

  constraint store_technical_visit_post_visit_decisions_event_key
    unique (organization_id, store_id, result_event_id),

  constraint store_technical_visit_post_visit_decisions_operation_key
    unique (organization_id, store_id, appointment_id, operation_key),

  constraint store_technical_visit_post_visit_decisions_id_scope_key
    unique (id, organization_id, store_id, appointment_id)
);

create index store_technical_visit_post_visit_decisions_scope_idx
  on public.store_technical_visit_post_visit_decisions
    (organization_id, store_id, commercial_opportunity_id, lifecycle_cycle, created_at);

comment on table public.store_technical_visit_post_visit_decisions is
  'Append-only proposed consequence for a current canonical technical-visit result. This authority executes no commercial consequence.';

comment on column public.store_technical_visit_post_visit_decisions.decision_kind is
  'Vocabulary for a future executor: qualification, quote, negotiation, followup, loss, new_visit, needs_resolution, or none.';

create or replace function public.p9_7_5_post_visit_decisions_append_only_internal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  raise exception using errcode = '55000',
    message = 'ZION_P9_7_5_POST_VISIT_DECISIONS_APPEND_ONLY';
end;
$function$;

alter function public.p9_7_5_post_visit_decisions_append_only_internal()
  owner to postgres;

revoke all on function public.p9_7_5_post_visit_decisions_append_only_internal()
  from public, anon, authenticated, service_role;

create trigger store_technical_visit_post_visit_decisions_append_only
before update or delete
on public.store_technical_visit_post_visit_decisions
for each row
execute function public.p9_7_5_post_visit_decisions_append_only_internal();

create or replace function public.decide_post_technical_visit_by_system(
  p_result_event_id uuid,
  p_operation_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  decision_id uuid,
  organization_id uuid,
  store_id uuid,
  appointment_id uuid,
  commercial_opportunity_id uuid,
  lifecycle_cycle integer,
  result_event_id uuid,
  decision_kind text,
  decision_reason text,
  decision_basis jsonb,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := public.zion_resolve_request_role_internal();
  v_event public.store_technical_visit_result_events%rowtype;
  v_current public.store_technical_visit_result_current%rowtype;
  v_appointment public.store_appointments%rowtype;
  v_opportunity public.commercial_opportunities%rowtype;
  v_existing public.store_technical_visit_post_visit_decisions%rowtype;
  v_qualification record;
  v_readiness record;
  v_decision_kind text;
  v_decision_reason text;
  v_basis jsonb := '{}'::jsonb;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_operation_key text := nullif(pg_catalog.btrim(p_operation_key), '');
  v_request_fingerprint text;
  v_decision_id uuid;
begin
  if v_request_role is distinct from 'service_role' then
    raise exception using errcode = '42501',
      message = 'ZION_P9_7_5_DECISION_NOT_AUTHORIZED';
  end if;

  if p_result_event_id is null then
    raise exception using errcode = '22023',
      message = 'ZION_P9_7_5_RESULT_EVENT_REQUIRED';
  end if;

  if v_operation_key is null or pg_catalog.length(v_operation_key) > 512 then
    raise exception using errcode = '22023',
      message = 'ZION_P9_7_5_DECISION_OPERATION_KEY_INVALID';
  end if;

  if pg_catalog.jsonb_typeof(v_metadata) <> 'object' then
    raise exception using errcode = '22023',
      message = 'ZION_P9_7_5_DECISION_METADATA_OBJECT_REQUIRED';
  end if;

  select event_row.*
    into v_event
    from public.store_technical_visit_result_events event_row
   where event_row.id = p_result_event_id;

  if not found then
    raise exception using errcode = '23503',
      message = 'ZION_P9_7_5_RESULT_EVENT_NOT_FOUND';
  end if;

  -- Serialize against the canonical technical-visit result writer itself.
  -- Both authorities must agree on this lock before touching appointment,
  -- opportunity, or current-result state.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'zion:p9:technical-visit-result:v1:' ||
      v_event.organization_id::text || ':' ||
      v_event.store_id::text || ':' ||
      v_event.appointment_id::text,
      0
    )
  );

  select appointment_row.*
    into v_appointment
    from public.store_appointments appointment_row
   where appointment_row.id = v_event.appointment_id
     and appointment_row.organization_id = v_event.organization_id
     and appointment_row.store_id = v_event.store_id
   for update;

  if not found or v_appointment.appointment_type <> 'technical_visit' then
    raise exception using errcode = '23514',
      message = 'ZION_P9_7_5_DECISION_APPOINTMENT_INVALID';
  end if;

  select opportunity_row.*
    into v_opportunity
    from public.commercial_opportunities opportunity_row
   where opportunity_row.id = v_event.commercial_opportunity_id
     and opportunity_row.organization_id = v_event.organization_id
     and opportunity_row.store_id = v_event.store_id
   for update;

  if not found
     or v_event.commercial_opportunity_id is distinct from v_appointment.commercial_opportunity_id
     or v_event.lifecycle_cycle is distinct from v_appointment.commercial_opportunity_lifecycle_cycle
     or v_event.lifecycle_cycle is distinct from v_opportunity.lifecycle_cycle
     or v_event.lifecycle_cycle < 1 then
    raise exception using errcode = '40001',
      message = 'ZION_P9_7_5_DECISION_LIFECYCLE_STALE';
  end if;

  select current_row.*
    into v_current
    from public.store_technical_visit_result_current current_row
   where current_row.organization_id = v_event.organization_id
     and current_row.store_id = v_event.store_id
     and current_row.appointment_id = v_event.appointment_id
   for update;

  if not found or v_current.current_result_event_id is distinct from v_event.id then
    raise exception using errcode = '40001',
      message = 'ZION_P9_7_5_RESULT_EVENT_SUPERSEDED';
  end if;

  -- Fingerprint only the caller request. Derived commercial state belongs
  -- to decision_basis and must not make an otherwise identical retry drift.
  v_request_fingerprint := encode(
    extensions.digest(
      convert_to(
        pg_catalog.jsonb_build_object(
          'authority', 'p9_7_5_post_visit_decision_request_v1',
          'organization_id', v_event.organization_id,
          'store_id', v_event.store_id,
          'appointment_id', v_event.appointment_id,
          'result_event_id', v_event.id,
          'operation_key', v_operation_key,
          'metadata', v_metadata
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select decision_row.*
    into v_existing
    from public.store_technical_visit_post_visit_decisions decision_row
   where decision_row.organization_id = v_event.organization_id
     and decision_row.store_id = v_event.store_id
     and decision_row.result_event_id = v_event.id
   for update;

  if found then
    if v_existing.operation_key is distinct from v_operation_key
       or v_existing.request_fingerprint is distinct from v_request_fingerprint then
      raise exception using errcode = '23505',
        message = 'ZION_P9_7_5_INCOMPATIBLE_DECISION_REPLAY';
    end if;

    return query
      select v_existing.id,
             v_existing.organization_id,
             v_existing.store_id,
             v_existing.appointment_id,
             v_existing.commercial_opportunity_id,
             v_existing.lifecycle_cycle,
             v_existing.result_event_id,
             v_existing.decision_kind,
             v_existing.decision_reason,
             v_existing.decision_basis,
             true;
    return;
  end if;

  select decision_row.*
    into v_existing
    from public.store_technical_visit_post_visit_decisions decision_row
   where decision_row.organization_id = v_event.organization_id
     and decision_row.store_id = v_event.store_id
     and decision_row.appointment_id = v_event.appointment_id
     and decision_row.operation_key = v_operation_key
   for update;

  if found then
    raise exception using errcode = '23505',
      message = 'ZION_P9_7_5_INCOMPATIBLE_DECISION_REPLAY';
  end if;

  if v_event.occurrence = 'unclear' then
    v_decision_kind := 'needs_resolution';
    v_decision_reason := 'technical_visit_occurrence_unclear';
  elsif v_event.occurrence = 'did_not_occur' then
    v_decision_kind := 'followup';
    v_decision_reason := 'technical_visit_did_not_occur';
  elsif v_event.result_kind is null then
    v_decision_kind := 'needs_resolution';
    v_decision_reason := 'technical_visit_result_missing_needs_resolution';
  elsif v_event.result_kind = 'pending' then
    v_decision_kind := 'followup';
    v_decision_reason := 'technical_visit_result_pending';
  elsif v_event.result_kind = 'viable_with_adjustments' then
    v_decision_kind := 'needs_resolution';
    v_decision_reason := 'technical_visit_adjustments_require_resolution';
  elsif v_event.result_kind = 'infeasible' then
    v_decision_kind := 'loss';
    v_decision_reason := 'confirmed_technical_infeasibility';
  elsif v_event.result_kind = 'viable' then
    select *
      into v_qualification
      from public.read_commercial_opportunity_qualification_facts_internal(
        v_event.organization_id,
        v_event.store_id,
        v_event.commercial_opportunity_id
      );

    if not found
       or v_qualification.organization_id is distinct from v_event.organization_id
       or v_qualification.store_id is distinct from v_event.store_id
       or v_qualification.commercial_opportunity_id is distinct from v_event.commercial_opportunity_id then
      raise exception using errcode = 'P0001',
        message = 'ZION_P9_7_5_DECISION_QUALIFICATION_READER_INVALID';
    end if;

    v_basis := v_basis || pg_catalog.jsonb_build_object(
      'qualification_missing_group_count', v_qualification.missing_group_count,
      'qualification_conflict_count', v_qualification.conflict_count
    );

    if v_qualification.missing_group_count > 0
       or v_qualification.conflict_count > 0 then
      v_decision_kind := 'qualification';
      v_decision_reason := 'technical_visit_viable_but_qualification_incomplete';
    else
      select *
        into v_readiness
        from public.p9_resolve_commercial_action_readiness_internal(
          v_event.organization_id,
          v_event.store_id,
          v_event.commercial_opportunity_id,
          'send_quote'
        );

      if not found then
        raise exception using errcode = 'P0001',
          message = 'ZION_P9_7_5_DECISION_QUOTE_READINESS_INVALID';
      end if;

      v_basis := v_basis || pg_catalog.jsonb_build_object(
        'quote_readiness_state', v_readiness.readiness_state,
        'quote_readiness_reason', v_readiness.reason_code,
        'quote_readiness_basis', v_readiness.readiness_basis
      );

      if v_readiness.readiness_state = 'ready'
         or (v_readiness.readiness_state = 'blocked'
             and v_readiness.reason_code = 'send_quote_quote_not_prepared') then
        v_decision_kind := 'quote';
        v_decision_reason := 'technical_visit_viable_quote_ready';
      elsif v_readiness.readiness_state = 'blocked'
            and v_readiness.reason_code = 'send_quote_quote_already_sent' then
        v_decision_kind := 'none';
        v_decision_reason := 'technical_visit_viable_quote_already_sent';
      else
        v_decision_kind := 'needs_resolution';
        v_decision_reason := 'technical_visit_viable_quote_readiness_unresolved';
      end if;
    end if;
  else
    raise exception using errcode = '22023',
      message = 'ZION_P9_7_5_DECISION_RESULT_INVALID';
  end if;

  v_basis := v_basis || pg_catalog.jsonb_build_object(
    'authority', 'p9_7_5_post_visit_decision_v1',
    'result_event_id', v_event.id,
    'result_kind', v_event.result_kind,
    'occurrence', v_event.occurrence,
    'effects_executed', false,
    'metadata', v_metadata
  );


  insert into public.store_technical_visit_post_visit_decisions (
    organization_id,
    store_id,
    appointment_id,
    commercial_opportunity_id,
    lifecycle_cycle,
    result_event_id,
    decision_kind,
    decision_reason,
    decision_basis,
    operation_key,
    request_fingerprint
  ) values (
    v_event.organization_id,
    v_event.store_id,
    v_event.appointment_id,
    v_event.commercial_opportunity_id,
    v_event.lifecycle_cycle,
    v_event.id,
    v_decision_kind,
    v_decision_reason,
    v_basis,
    v_operation_key,
    v_request_fingerprint
  ) returning id into v_decision_id;

  return query
    select v_decision_id,
           v_event.organization_id,
           v_event.store_id,
           v_event.appointment_id,
           v_event.commercial_opportunity_id,
           v_event.lifecycle_cycle,
           v_event.id,
           v_decision_kind,
           v_decision_reason,
           v_basis,
           false;
end;
$function$;

alter function public.decide_post_technical_visit_by_system(uuid, text, jsonb)
  owner to postgres;

revoke all on function public.decide_post_technical_visit_by_system(uuid, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.decide_post_technical_visit_by_system(uuid, text, jsonb)
  to service_role;

alter table public.store_technical_visit_post_visit_decisions enable row level security;

revoke all on table public.store_technical_visit_post_visit_decisions
  from public, anon, authenticated, service_role;

grant select on table public.store_technical_visit_post_visit_decisions
  to service_role;

do $postconditions$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.decide_post_technical_visit_by_system(uuid,text,jsonb)'::pg_catalog.regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, 'ZION_P9_7_5_RESULT_EVENT_SUPERSEDED') = 0
     or pg_catalog.strpos(v_definition, 'ZION_P9_7_5_DECISION_LIFECYCLE_STALE') = 0
     or pg_catalog.strpos(v_definition, 'technical_visit_viable_but_qualification_incomplete') = 0
     or pg_catalog.strpos(v_definition, 'technical_visit_viable_quote_ready') = 0
     or pg_catalog.strpos(v_definition, 'confirmed_technical_infeasibility') = 0
     or pg_catalog.strpos(v_definition, 'technical_visit_did_not_occur') = 0
     or pg_catalog.strpos(v_definition, 'technical_visit_result_missing_needs_resolution') = 0
     or pg_catalog.strpos(v_definition, 'effects_executed') = 0 then
    raise exception using errcode = 'P0001',
      message = 'P9 7.5 decision postcondition failed: canonical branches are missing';
  end if;

  if pg_catalog.strpos(
       v_definition,
       'zion:p9:technical-visit-result:v1:'
     ) = 0
     or pg_catalog.strpos(
       v_definition,
       'p9_7_5_post_visit_decision_request_v1'
     ) = 0
     or pg_catalog.strpos(
       v_definition,
       'request_fingerprint is distinct from v_request_fingerprint'
     ) = 0
     or pg_catalog.strpos(
       v_definition,
       'zion:p9:technical-visit-decision:v1:'
     ) > 0 then
    raise exception using errcode = 'P0001',
      message = 'P9 7.5 decision postcondition failed: lock or replay contract is invalid';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_trigger trigger_row
     where trigger_row.tgrelid =
           'public.store_technical_visit_post_visit_decisions'::pg_catalog.regclass
       and trigger_row.tgname =
           'store_technical_visit_post_visit_decisions_append_only'
       and not trigger_row.tgisinternal
  ) then
    raise exception using errcode = 'P0001',
      message = 'P9 7.5 decision postcondition failed: append-only trigger is missing';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.decide_post_technical_visit_by_system(uuid,text,jsonb)',
       'EXECUTE'
     ) then
    raise exception using errcode = 'P0001',
      message = 'P9 7.5 decision postcondition failed: RPC is publicly executable';
  end if;

  if not has_function_privilege(
       'service_role',
       'public.decide_post_technical_visit_by_system(uuid,text,jsonb)',
       'EXECUTE'
     ) then
    raise exception using errcode = 'P0001',
      message = 'P9 7.5 decision postcondition failed: service_role cannot execute RPC';
  end if;
end
$postconditions$;

commit;

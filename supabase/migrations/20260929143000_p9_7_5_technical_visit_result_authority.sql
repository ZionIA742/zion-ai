-- ZION / Pilar 9 / Bloco 7 / Etapa 7.5

-- Canonical persisted authority for structured technical-visit results.

-- This migration stores facts only. It does not decide stage, loss,

-- follow-up, completion, quote, negotiation, or a new visit.



do $$

begin

  if pg_catalog.to_regclass('public.store_appointments') is null

     or pg_catalog.to_regclass('public.commercial_opportunities') is null

     or pg_catalog.to_regclass('public.schedule_post_appointment_followups') is null

     or pg_catalog.to_regclass('public.schedule_post_appointment_followup_responses') is null

     or pg_catalog.to_regclass('public.store_responsibles') is null

     or pg_catalog.to_regclass('public.store_appointments_scope_id_uidx') is null

     or pg_catalog.to_regclass('public.commercial_opportunities_id_organization_store_uidx') is null

     or pg_catalog.to_regprocedure('public.zion_resolve_request_role_internal()') is null then

    raise exception using errcode = 'P0001',

      message = 'P9 7.5 precondition failed: canonical appointment/followup/system-role authorities are required';

  end if;



  if not exists (

    select 1

    from pg_catalog.pg_extension extension_row

    where extension_row.extname = 'pgcrypto'

  ) then

    raise exception using errcode = 'P0001',

      message = 'P9 7.5 precondition failed: pgcrypto is required for deterministic fingerprints';

  end if;



  if pg_catalog.to_regclass('public.store_technical_visit_result_events') is not null

     or pg_catalog.to_regclass('public.store_technical_visit_result_current') is not null then

    raise exception using errcode = 'P0001',

      message = 'P9 7.5 precondition failed: result authority objects already exist';

  end if;

end

$$;



create table public.store_technical_visit_result_events (

  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null,

  store_id uuid not null,

  appointment_id uuid not null,

  followup_id uuid not null,

  commercial_opportunity_id uuid not null,

  lifecycle_cycle integer not null,



  source_response_id uuid not null,

  responsible_id uuid not null,



  event_number integer not null,

  previous_result_event_id uuid null,



  result_kind text null,

  evidence_text text null,

  adjustment_summary text null,

  uncertainty_reason text null,

  occurrence text not null,

  occurrence_evidence_text text null,



  operation_key text not null,

  request_fingerprint text not null,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default pg_catalog.clock_timestamp(),



  constraint store_technical_visit_result_events_appointment_scope_fkey

    foreign key (appointment_id, organization_id, store_id)

    references public.store_appointments(id, organization_id, store_id)

    on delete restrict,



  constraint store_technical_visit_result_events_opportunity_scope_fkey

    foreign key (commercial_opportunity_id, organization_id, store_id)

    references public.commercial_opportunities(id, organization_id, store_id)

    on delete restrict,



  constraint store_technical_visit_result_events_followup_fkey

    foreign key (followup_id)

    references public.schedule_post_appointment_followups(id)

    on delete restrict,



  constraint store_technical_visit_result_events_source_response_fkey

    foreign key (source_response_id)

    references public.schedule_post_appointment_followup_responses(id)

    on delete restrict,



  constraint store_technical_visit_result_events_responsible_fkey

    foreign key (responsible_id)

    references public.store_responsibles(id)

    on delete restrict,



  constraint store_technical_visit_result_events_previous_scope_fkey

    foreign key (

      previous_result_event_id,

      organization_id,

      store_id,

      appointment_id

    )

    references public.store_technical_visit_result_events(

      id,

      organization_id,

      store_id,

      appointment_id

    )

    on delete restrict,



  constraint store_technical_visit_result_events_result_kind_chk

    check (result_kind is null or result_kind in (

      'viable', 'viable_with_adjustments', 'infeasible', 'pending'

    )),



  constraint store_technical_visit_result_events_result_evidence_chk

    check (

      (result_kind is null and evidence_text is null and adjustment_summary is null)

      or

      (result_kind is not null

       and evidence_text is not null

       and pg_catalog.length(pg_catalog.btrim(evidence_text)) > 0)

    ),



  constraint store_technical_visit_result_events_adjustment_chk

    check (

      (result_kind = 'viable_with_adjustments'

       and adjustment_summary is not null

       and pg_catalog.length(pg_catalog.btrim(adjustment_summary)) > 0)

      or

      (result_kind is distinct from 'viable_with_adjustments'

       and adjustment_summary is null)

    ),



  constraint store_technical_visit_result_events_occurrence_chk

    check (occurrence in ('occurred', 'did_not_occur', 'unclear')),



  constraint store_technical_visit_result_events_conclusive_occurrence_chk

    check (

      result_kind not in ('viable', 'viable_with_adjustments', 'infeasible')

      or occurrence = 'occurred'

    ),



  constraint store_technical_visit_result_events_did_not_occur_chk

    check (

      occurrence <> 'did_not_occur'

      or (result_kind is null and evidence_text is null and adjustment_summary is null)

    ),



  constraint store_technical_visit_result_events_occurrence_evidence_chk

    check (

      (occurrence in ('occurred', 'did_not_occur')

       and occurrence_evidence_text is not null

       and pg_catalog.length(pg_catalog.btrim(occurrence_evidence_text)) > 0)

      or

      (occurrence = 'unclear' and occurrence_evidence_text is null)

    ),



  constraint store_technical_visit_result_events_cycle_chk

    check (lifecycle_cycle >= 1),



  constraint store_technical_visit_result_events_event_number_chk

    check (event_number >= 1),



  constraint store_technical_visit_result_events_operation_key_chk

    check (

      pg_catalog.length(pg_catalog.btrim(operation_key)) > 0

      and pg_catalog.length(operation_key) <= 512

    ),



  constraint store_technical_visit_result_events_fingerprint_chk

    check (request_fingerprint ~ '^[0-9a-f]{64}$'),



  constraint store_technical_visit_result_events_metadata_chk

    check (pg_catalog.jsonb_typeof(metadata) = 'object'),



  constraint store_technical_visit_result_events_scope_event_number_key

    unique (organization_id, store_id, appointment_id, event_number),



  constraint store_technical_visit_result_events_scope_operation_key

    unique (organization_id, store_id, appointment_id, operation_key),



  constraint store_technical_visit_result_events_source_response_key

    unique (source_response_id),



  constraint store_technical_visit_result_events_previous_once

    unique (previous_result_event_id),



  constraint store_technical_visit_result_events_scope_id_key

    unique (id, organization_id, store_id, appointment_id)

);



create index store_technical_visit_result_events_scope_appointment_idx

  on public.store_technical_visit_result_events

    (organization_id, store_id, appointment_id, event_number);



create index store_technical_visit_result_events_source_response_idx

  on public.store_technical_visit_result_events

    (organization_id, store_id, source_response_id);



create table public.store_technical_visit_result_current (

  organization_id uuid not null,

  store_id uuid not null,

  appointment_id uuid not null,

  current_result_event_id uuid not null,

  last_operation_key text not null,

  updated_at timestamptz not null default pg_catalog.clock_timestamp(),



  constraint store_technical_visit_result_current_pkey

    primary key (organization_id, store_id, appointment_id),



  constraint store_technical_visit_result_current_appointment_scope_fkey

    foreign key (appointment_id, organization_id, store_id)

    references public.store_appointments(id, organization_id, store_id)

    on delete restrict,



  constraint store_technical_visit_result_current_event_scope_fkey

    foreign key (

      current_result_event_id,

      organization_id,

      store_id,

      appointment_id

    )

    references public.store_technical_visit_result_events(

      id,

      organization_id,

      store_id,

      appointment_id

    )

    on delete restrict,



  constraint store_technical_visit_result_current_operation_key_chk

    check (

      pg_catalog.length(pg_catalog.btrim(last_operation_key)) > 0

      and pg_catalog.length(last_operation_key) <= 512

    )

);



comment on table public.store_technical_visit_result_events is

  'Append-only canonical facts extracted from a persisted P9 7.4 responsible response. It has no commercial consequence authority.';



comment on table public.store_technical_visit_result_current is

  'Explicit current pointer for the canonical technical-visit result authority. Never resolve current by latest/max.';



comment on column public.store_technical_visit_result_events.lifecycle_cycle is

  'Lifecycle snapshot derived from the appointment and revalidated against the current commercial opportunity at write time.';



comment on column public.store_technical_visit_result_events.result_kind is

  'Technical fact only: viable, viable_with_adjustments, infeasible, or pending. It is not a stage decision.';

comment on column public.store_technical_visit_result_events.source_response_id is
  'Exactly one P9 7.4 persisted response may materialize one canonical result event; evidence snippets are revalidated against that response raw_content by the writer.';




create or replace function public.p9_7_5_compute_technical_visit_result_fingerprint_internal(

  p_organization_id uuid,

  p_store_id uuid,

  p_appointment_id uuid,

  p_followup_id uuid,

  p_commercial_opportunity_id uuid,

  p_lifecycle_cycle integer,

  p_source_response_id uuid,

  p_responsible_id uuid,

  p_result_kind text,

  p_evidence_text text,

  p_adjustment_summary text,

  p_uncertainty_reason text,

  p_occurrence text,

  p_occurrence_evidence_text text,

  p_metadata jsonb

)

returns text

language sql

immutable

parallel safe

security invoker

set search_path = pg_catalog, pg_temp

as $function$

  select pg_catalog.encode(

    extensions.digest(

      pg_catalog.convert_to(

        pg_catalog.jsonb_build_object(

          'schema_version', 1,

          'organization_id', p_organization_id,

          'store_id', p_store_id,

          'appointment_id', p_appointment_id,

          'followup_id', p_followup_id,

          'commercial_opportunity_id', p_commercial_opportunity_id,

          'lifecycle_cycle', p_lifecycle_cycle,

          'source_response_id', p_source_response_id,

          'responsible_id', p_responsible_id,

          'result_kind', p_result_kind,

          'evidence_text', p_evidence_text,

          'adjustment_summary', p_adjustment_summary,

          'uncertainty_reason', p_uncertainty_reason,

          'occurrence', p_occurrence,

          'occurrence_evidence_text', p_occurrence_evidence_text,

          'metadata', p_metadata

        )::text,

        'UTF8'

      ),

      'sha256'

    ),

    'hex'

  );

$function$;



alter function public.p9_7_5_compute_technical_visit_result_fingerprint_internal(

  uuid, uuid, uuid, uuid, uuid, integer, uuid, uuid, text, text, text, text, text, text, jsonb

) owner to postgres;



revoke all on function public.p9_7_5_compute_technical_visit_result_fingerprint_internal(

  uuid, uuid, uuid, uuid, uuid, integer, uuid, uuid, text, text, text, text, text, text, jsonb

) from public, anon, authenticated, service_role;



create or replace function public.p9_7_5_validate_technical_visit_result_event_internal()

returns trigger

language plpgsql

security definer

set search_path = pg_catalog, public, pg_temp

as $function$

declare

  v_current public.store_technical_visit_result_current;

  v_current_event public.store_technical_visit_result_events;

begin

  select current_row.*

    into v_current

    from public.store_technical_visit_result_current current_row

   where current_row.organization_id = new.organization_id

     and current_row.store_id = new.store_id

     and current_row.appointment_id = new.appointment_id

   for update;



  if found then

    select event_row.*

      into v_current_event

      from public.store_technical_visit_result_events event_row

     where event_row.id = v_current.current_result_event_id

       and event_row.organization_id = new.organization_id

       and event_row.store_id = new.store_id

       and event_row.appointment_id = new.appointment_id;



    if not found then

      raise exception using errcode = 'P0001',

        message = 'ZION_P9_7_5_CURRENT_RESULT_EVENT_MISSING';

    end if;



    if new.previous_result_event_id is distinct from v_current_event.id

       or new.event_number is distinct from v_current_event.event_number + 1 then

      raise exception using errcode = '23514',

        message = 'ZION_P9_7_5_RESULT_EVENT_CHAIN_MISMATCH';

    end if;

  elsif new.previous_result_event_id is not null

     or new.event_number <> 1 then

    raise exception using errcode = '23514',

      message = 'ZION_P9_7_5_RESULT_EVENT_FIRST_EVENT_CHAIN_MISMATCH';

  end if;



  return new;

end;

$function$;



alter function public.p9_7_5_validate_technical_visit_result_event_internal()

  owner to postgres;



revoke all on function public.p9_7_5_validate_technical_visit_result_event_internal()

  from public, anon, authenticated, service_role;



create trigger store_technical_visit_result_events_validate_insert

before insert on public.store_technical_visit_result_events

for each row

execute function public.p9_7_5_validate_technical_visit_result_event_internal();



create or replace function public.p9_7_5_technical_visit_result_events_append_only_internal()

returns trigger

language plpgsql

security definer

set search_path = pg_catalog, public, pg_temp

as $function$

begin

  raise exception using errcode = '55000',

    message = 'ZION_P9_7_5_RESULT_EVENTS_APPEND_ONLY';

end;

$function$;



alter function public.p9_7_5_technical_visit_result_events_append_only_internal()

  owner to postgres;



revoke all on function public.p9_7_5_technical_visit_result_events_append_only_internal()

  from public, anon, authenticated, service_role;



create trigger store_technical_visit_result_events_append_only

before update or delete on public.store_technical_visit_result_events

for each row

execute function public.p9_7_5_technical_visit_result_events_append_only_internal();



create or replace function public.p9_7_5_validate_technical_visit_result_current_internal()

returns trigger

language plpgsql

security definer

set search_path = pg_catalog, public, pg_temp

as $function$

declare

  v_event public.store_technical_visit_result_events;

begin

  select event_row.*

    into v_event

    from public.store_technical_visit_result_events event_row

   where event_row.id = new.current_result_event_id

     and event_row.organization_id = new.organization_id

     and event_row.store_id = new.store_id

     and event_row.appointment_id = new.appointment_id;



  if not found then

    raise exception using errcode = '23503',

      message = 'ZION_P9_7_5_CURRENT_RESULT_TARGET_NOT_FOUND';

  end if;



  if new.last_operation_key is distinct from v_event.operation_key then

    raise exception using errcode = '23514',

      message = 'ZION_P9_7_5_CURRENT_RESULT_OPERATION_MISMATCH';

  end if;



  if exists (

    select 1

      from public.store_technical_visit_result_events child_row

     where child_row.previous_result_event_id = v_event.id

  ) then

    raise exception using errcode = '23514',

      message = 'ZION_P9_7_5_CURRENT_RESULT_MUST_POINT_TO_CHAIN_TIP';

  end if;



  new.updated_at := pg_catalog.clock_timestamp();

  return new;

end;

$function$;



alter function public.p9_7_5_validate_technical_visit_result_current_internal()

  owner to postgres;



revoke all on function public.p9_7_5_validate_technical_visit_result_current_internal()

  from public, anon, authenticated, service_role;



create trigger store_technical_visit_result_current_validate

before insert or update on public.store_technical_visit_result_current

for each row

execute function public.p9_7_5_validate_technical_visit_result_current_internal();



create or replace function public.persist_post_technical_visit_result_by_system(

  p_source_response_id uuid,

  p_result_kind text,

  p_evidence_text text,

  p_adjustment_summary text,

  p_uncertainty_reason text,

  p_occurrence text,

  p_occurrence_evidence_text text,

  p_operation_key text,

  p_metadata jsonb default '{}'::jsonb

)

returns table (

  event_id uuid,

  organization_id uuid,

  store_id uuid,

  appointment_id uuid,

  event_number integer,

  current_result_event_id uuid,

  replayed boolean

)

language plpgsql

security definer

set search_path = pg_catalog, public, pg_temp

as $function$

declare

  v_request_role text := public.zion_resolve_request_role_internal();

  v_response public.schedule_post_appointment_followup_responses;

  v_followup public.schedule_post_appointment_followups;

  v_appointment public.store_appointments;

  v_opportunity public.commercial_opportunities;

  v_responsible public.store_responsibles;

  v_current public.store_technical_visit_result_current;

  v_current_event public.store_technical_visit_result_events;

  v_existing public.store_technical_visit_result_events;

  v_operation_key text := nullif(pg_catalog.btrim(p_operation_key), '');

  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);

  v_request_fingerprint text;

  v_event_number integer;

  v_previous_event_id uuid;

  v_new_event_id uuid;

begin

  if v_request_role is distinct from 'service_role' then

    raise exception using errcode = '42501',

      message = 'ZION_P9_7_5_RESULT_WRITER_NOT_AUTHORIZED';

  end if;



  if p_source_response_id is null then

    raise exception using errcode = '22023',

      message = 'ZION_P9_7_5_SOURCE_RESPONSE_REQUIRED';

  end if;



  if v_operation_key is null or pg_catalog.length(v_operation_key) > 512 then

    raise exception using errcode = '22023',

      message = 'ZION_P9_7_5_OPERATION_KEY_INVALID';

  end if;



  if pg_catalog.jsonb_typeof(v_metadata) <> 'object' then

    raise exception using errcode = '22023',

      message = 'ZION_P9_7_5_METADATA_OBJECT_REQUIRED';

  end if;



  if p_result_kind is not null and p_result_kind not in (

    'viable', 'viable_with_adjustments', 'infeasible', 'pending'

  ) then

    raise exception using errcode = '22023',

      message = 'ZION_P9_7_5_RESULT_KIND_INVALID';

  end if;



  if p_result_kind is null and (p_evidence_text is not null or p_adjustment_summary is not null) then

    raise exception using errcode = '23514',

      message = 'ZION_P9_7_5_NULL_RESULT_CANNOT_HAVE_FACT_EVIDENCE';

  end if;



  if p_result_kind is not null

     and nullif(pg_catalog.btrim(coalesce(p_evidence_text, '')), '') is null then

    raise exception using errcode = '23514',

      message = 'ZION_P9_7_5_RESULT_EVIDENCE_REQUIRED';

  end if;



  if p_result_kind = 'viable_with_adjustments'

     and nullif(pg_catalog.btrim(coalesce(p_adjustment_summary, '')), '') is null then

    raise exception using errcode = '23514',

      message = 'ZION_P9_7_5_ADJUSTMENT_SUMMARY_REQUIRED';

  end if;



  if p_result_kind is distinct from 'viable_with_adjustments'

     and p_adjustment_summary is not null then

    raise exception using errcode = '23514',

      message = 'ZION_P9_7_5_UNEXPECTED_ADJUSTMENT_SUMMARY';

  end if;



  if p_occurrence is null

     or p_occurrence not in ('occurred', 'did_not_occur', 'unclear') then

    raise exception using errcode = '22023',

      message = 'ZION_P9_7_5_OCCURRENCE_INVALID';

  end if;



  if p_occurrence in ('occurred', 'did_not_occur')

     and nullif(pg_catalog.btrim(coalesce(p_occurrence_evidence_text, '')), '') is null then

    raise exception using errcode = '23514',

      message = 'ZION_P9_7_5_OCCURRENCE_EVIDENCE_REQUIRED';

  end if;



  if p_occurrence = 'unclear' and p_occurrence_evidence_text is not null then

    raise exception using errcode = '23514',

      message = 'ZION_P9_7_5_UNCLEAR_OCCURRENCE_CANNOT_HAVE_EVIDENCE';

  end if;



  if p_occurrence = 'did_not_occur'

     and (p_result_kind is not null or p_evidence_text is not null or p_adjustment_summary is not null) then

    raise exception using errcode = '23514',

      message = 'ZION_P9_7_5_DID_NOT_OCCUR_CANNOT_HAVE_RESULT';

  end if;



  if p_result_kind in ('viable', 'viable_with_adjustments', 'infeasible')

     and p_occurrence <> 'occurred' then

    raise exception using errcode = '23514',

      message = 'ZION_P9_7_5_CONCLUSIVE_RESULT_REQUIRES_OCCURRED';

  end if;



  select response_row.*

    into v_response

    from public.schedule_post_appointment_followup_responses response_row

   where response_row.id = p_source_response_id

   for update;



  if not found then

    raise exception using errcode = '23503',

      message = 'ZION_P9_7_5_SOURCE_RESPONSE_NOT_FOUND';

  end if;



  if v_response.followup_id is null or v_response.appointment_id is null then

    raise exception using errcode = '23514',

      message = 'ZION_P9_7_5_SOURCE_RESPONSE_NOT_CORRELATED';

  end if;

  -- Canonical result evidence must remain literally grounded in the durable
  -- P9 7.4 response selected by source_response_id. The application extractor
  -- validates the same contract, but the authority writer must fail closed on
  -- fabricated or drifted evidence instead of trusting caller-supplied text.
  if p_evidence_text is not null
     and (
       v_response.raw_content is null
       or pg_catalog.strpos(v_response.raw_content, p_evidence_text) = 0
     ) then
    raise exception using errcode = '23514',
      message = 'ZION_P9_7_5_RESULT_EVIDENCE_NOT_IN_SOURCE_RESPONSE';
  end if;

  if p_adjustment_summary is not null
     and (
       v_response.raw_content is null
       or pg_catalog.strpos(v_response.raw_content, p_adjustment_summary) = 0
     ) then
    raise exception using errcode = '23514',
      message = 'ZION_P9_7_5_ADJUSTMENT_NOT_IN_SOURCE_RESPONSE';
  end if;

  if p_occurrence_evidence_text is not null
     and (
       v_response.raw_content is null
       or pg_catalog.strpos(v_response.raw_content, p_occurrence_evidence_text) = 0
     ) then
    raise exception using errcode = '23514',
      message = 'ZION_P9_7_5_OCCURRENCE_EVIDENCE_NOT_IN_SOURCE_RESPONSE';
  end if;




  select followup_row.*

    into v_followup

    from public.schedule_post_appointment_followups followup_row

   where followup_row.id = v_response.followup_id

     and followup_row.organization_id = v_response.organization_id

     and followup_row.store_id = v_response.store_id

   for update;



  if not found or v_followup.appointment_id is distinct from v_response.appointment_id then

    raise exception using errcode = '23514',

      message = 'ZION_P9_7_5_FOLLOWUP_APPOINTMENT_SCOPE_INVALID';

  end if;



  perform pg_catalog.pg_advisory_xact_lock(

    pg_catalog.hashtextextended(

      'zion:p9:technical-visit-result:v1:' || v_response.organization_id::text || ':' ||

      v_response.store_id::text || ':' || v_response.appointment_id::text,

      0

    )

  );



  select appointment_row.*

    into v_appointment

    from public.store_appointments appointment_row

   where appointment_row.id = v_response.appointment_id

     and appointment_row.organization_id = v_response.organization_id

     and appointment_row.store_id = v_response.store_id

   for update;



  if not found or v_appointment.appointment_type <> 'technical_visit' then

    raise exception using errcode = '23514',

      message = 'ZION_P9_7_5_APPOINTMENT_NOT_TECHNICAL_VISIT';

  end if;



  if v_appointment.commercial_opportunity_id is null

     or v_appointment.commercial_opportunity_lifecycle_cycle is null

     or v_appointment.commercial_opportunity_lifecycle_cycle < 1 then

    raise exception using errcode = '23514',

      message = 'ZION_P9_7_5_APPOINTMENT_COMMERCIAL_ANCHOR_REQUIRED';

  end if;



  select opportunity_row.*

    into v_opportunity

    from public.commercial_opportunities opportunity_row

   where opportunity_row.id = v_appointment.commercial_opportunity_id

     and opportunity_row.organization_id = v_appointment.organization_id

     and opportunity_row.store_id = v_appointment.store_id

   for update;



  if not found then

    raise exception using errcode = '23503',

      message = 'ZION_P9_7_5_OPPORTUNITY_SCOPE_NOT_FOUND';

  end if;



  if v_opportunity.lifecycle_cycle is distinct from v_appointment.commercial_opportunity_lifecycle_cycle then

    raise exception using errcode = '23514',

      message = 'ZION_P9_7_5_LIFECYCLE_SNAPSHOT_STALE';

  end if;



  select responsible_row.*

    into v_responsible

    from public.store_responsibles responsible_row

   where responsible_row.id = v_response.responsible_id

     and responsible_row.organization_id = v_response.organization_id

     and responsible_row.store_id = v_response.store_id;



  if not found then

    raise exception using errcode = '23503',

      message = 'ZION_P9_7_5_RESPONSIBLE_SCOPE_NOT_FOUND';

  end if;



  select current_row.*

    into v_current

    from public.store_technical_visit_result_current current_row

   where current_row.organization_id = v_appointment.organization_id

     and current_row.store_id = v_appointment.store_id

     and current_row.appointment_id = v_appointment.id

   for update;



  if found then

    select event_row.*

      into v_current_event

      from public.store_technical_visit_result_events event_row

     where event_row.id = v_current.current_result_event_id

       and event_row.organization_id = v_current.organization_id

       and event_row.store_id = v_current.store_id

       and event_row.appointment_id = v_current.appointment_id;



    if not found then

      raise exception using errcode = 'P0001',

        message = 'ZION_P9_7_5_CURRENT_RESULT_EVENT_MISSING';

    end if;

    if v_current_event.commercial_opportunity_id
         is distinct from v_appointment.commercial_opportunity_id
       or v_current_event.lifecycle_cycle
         is distinct from v_appointment.commercial_opportunity_lifecycle_cycle
       or v_current_event.followup_id
         is distinct from v_followup.id then
      raise exception using errcode = '23514',
        message = 'ZION_P9_7_5_CURRENT_RESULT_SCOPE_CHANGED_NEEDS_RESOLUTION';
    end if;



    v_event_number := v_current_event.event_number + 1;

    v_previous_event_id := v_current_event.id;

  else

    v_event_number := 1;

    v_previous_event_id := null;

  end if;



  v_request_fingerprint := public.p9_7_5_compute_technical_visit_result_fingerprint_internal(

    v_response.organization_id,

    v_response.store_id,

    v_appointment.id,

    v_followup.id,

    v_appointment.commercial_opportunity_id,

    v_appointment.commercial_opportunity_lifecycle_cycle,

    v_response.id,

    v_response.responsible_id,

    p_result_kind,

    p_evidence_text,

    p_adjustment_summary,

    p_uncertainty_reason,

    p_occurrence,

    p_occurrence_evidence_text,

    v_metadata

  );



  select event_row.*

    into v_existing

    from public.store_technical_visit_result_events event_row

   where event_row.organization_id = v_appointment.organization_id

     and event_row.store_id = v_appointment.store_id

     and event_row.appointment_id = v_appointment.id

     and event_row.operation_key = v_operation_key;



  if found then

    if v_existing.source_response_id is distinct from v_response.id

       or v_existing.request_fingerprint is distinct from v_request_fingerprint then

      raise exception using errcode = '23505',

        message = 'ZION_P9_7_5_INCOMPATIBLE_OPERATION_REPLAY';

    end if;

    -- Replaying an operation that has already been superseded by a newer
    -- canonical result must not pretend that the obsolete event is current.
    if v_current.current_result_event_id is distinct from v_existing.id then
      raise exception using errcode = '40001',
        message = 'ZION_P9_7_5_OBSOLETE_OPERATION_REPLAY';
    end if;




    return query

      select v_existing.id,

             v_existing.organization_id,

             v_existing.store_id,

             v_existing.appointment_id,

             v_existing.event_number,

             v_current.current_result_event_id,

             true;

    return;

  end if;



  select event_row.*

    into v_existing

    from public.store_technical_visit_result_events event_row

   where event_row.organization_id = v_appointment.organization_id

     and event_row.store_id = v_appointment.store_id

     and event_row.appointment_id = v_appointment.id

     and event_row.source_response_id = v_response.id;



  if found then

    raise exception using errcode = '23505',

      message = 'ZION_P9_7_5_SOURCE_RESPONSE_ALREADY_MATERIALIZED';

  end if;



  insert into public.store_technical_visit_result_events (

    organization_id,

    store_id,

    appointment_id,

    followup_id,

    commercial_opportunity_id,

    lifecycle_cycle,

    source_response_id,

    responsible_id,

    event_number,

    previous_result_event_id,

    result_kind,

    evidence_text,

    adjustment_summary,

    uncertainty_reason,

    occurrence,

    occurrence_evidence_text,

    operation_key,

    request_fingerprint,

    metadata

  ) values (

    v_response.organization_id,

    v_response.store_id,

    v_appointment.id,

    v_followup.id,

    v_appointment.commercial_opportunity_id,

    v_appointment.commercial_opportunity_lifecycle_cycle,

    v_response.id,

    v_response.responsible_id,

    v_event_number,

    v_previous_event_id,

    p_result_kind,

    p_evidence_text,

    p_adjustment_summary,

    p_uncertainty_reason,

    p_occurrence,

    p_occurrence_evidence_text,

    v_operation_key,

    v_request_fingerprint,

    v_metadata

  ) returning id into v_new_event_id;



  insert into public.store_technical_visit_result_current (

    organization_id,

    store_id,

    appointment_id,

    current_result_event_id,

    last_operation_key

  ) values (

    v_response.organization_id,

    v_response.store_id,

    v_appointment.id,

    v_new_event_id,

    v_operation_key

  )

  on conflict (organization_id, store_id, appointment_id)

  do update set

    current_result_event_id = excluded.current_result_event_id,

    last_operation_key = excluded.last_operation_key,

    updated_at = pg_catalog.clock_timestamp();



  return query

    select v_new_event_id,

           v_response.organization_id,

           v_response.store_id,

           v_appointment.id,

           v_event_number,

           v_new_event_id,

           false;

end;

$function$;



alter function public.persist_post_technical_visit_result_by_system(

  uuid, text, text, text, text, text, text, text, jsonb

) owner to postgres;



revoke all on function public.persist_post_technical_visit_result_by_system(

  uuid, text, text, text, text, text, text, text, jsonb

) from public, anon, authenticated;



grant execute on function public.persist_post_technical_visit_result_by_system(

  uuid, text, text, text, text, text, text, text, jsonb

) to service_role;



alter table public.store_technical_visit_result_events enable row level security;

alter table public.store_technical_visit_result_current enable row level security;



revoke all on table public.store_technical_visit_result_events

  from public, anon, authenticated, service_role;

revoke all on table public.store_technical_visit_result_current

  from public, anon, authenticated, service_role;



grant select on table public.store_technical_visit_result_events

  to service_role;

grant select on table public.store_technical_visit_result_current

  to service_role;



do $$

begin

  if not has_function_privilege(

    'service_role',

    'public.persist_post_technical_visit_result_by_system(uuid,text,text,text,text,text,text,text,jsonb)',

    'EXECUTE'

  ) then

    raise exception using errcode = 'P0001',

      message = 'P9 7.5 postcondition failed: system result writer is not executable by service_role';

  end if;



  if has_function_privilege(

    'anon',

    'public.persist_post_technical_visit_result_by_system(uuid,text,text,text,text,text,text,text,jsonb)',

    'EXECUTE'

  ) or has_function_privilege(

    'authenticated',

    'public.persist_post_technical_visit_result_by_system(uuid,text,text,text,text,text,text,text,jsonb)',

    'EXECUTE'

  ) then

    raise exception using errcode = 'P0001',

      message = 'P9 7.5 postcondition failed: result writer is publicly executable';

  end if;

end

$$;

-- P9 / Bloco 3 / Etapa 3.5
-- Core Progress Resolvers V1 - manual checks
--
-- Rollback-only runner.
-- Success contract: no exception. The only visible result may be the advisory lock row.
--
-- Validates:
-- - qualification: not_started -> in_progress; never automatic completed
-- - quote: not_started -> in_progress -> needs_resolution -> completed
-- - quote current sent proposal remains completed if its sent version is superseded
-- - post_sale: not_started -> in_progress -> completed -> reopened/in_progress
-- - deterministic fingerprints and internal security contract
-- - all fixture mutations are rolled back

begin;

select pg_catalog.pg_advisory_xact_lock(903503545);

-- ---------------------------------------------------------------------------
-- 0. PRECONDITIONS / INTERNAL SECURITY
-- ---------------------------------------------------------------------------

do $preconditions$
declare
  v_signature text;
  v_oid oid;
begin
  foreach v_signature in array array[
    'public.p9_resolve_qualification_progress_internal(uuid,uuid,uuid)',
    'public.p9_resolve_quote_progress_internal(uuid,uuid,uuid)',
    'public.p9_resolve_post_sale_progress_internal(uuid,uuid,uuid)'
  ]
  loop
    v_oid := pg_catalog.to_regprocedure(v_signature);

    if v_oid is null then
      raise exception using
        errcode = 'P0001',
        message = 'RUNNER_CORE_PROGRESS_RESOLVER_MISSING',
        detail = v_signature;
    end if;

    if pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') then
      raise exception using
        errcode = 'P0001',
        message = 'RUNNER_CORE_PROGRESS_RESOLVER_EXPOSED',
        detail = v_signature;
    end if;
  end loop;
end;
$preconditions$;

-- ---------------------------------------------------------------------------
-- 1. USE ONE EXISTING TENANT SCOPE ONLY AS FK PARENT
-- ---------------------------------------------------------------------------
-- No existing commercial state is changed; all test opportunities are isolated
-- fixed UUIDs and the transaction ends in ROLLBACK.

create temporary table _p9_core_progress_ctx (
  organization_id uuid not null,
  store_id uuid not null,
  customer_id uuid not null,

  qualification_opportunity_id uuid not null,
  quote_opportunity_id uuid not null,
  post_sale_not_started_opportunity_id uuid not null,
  post_sale_active_opportunity_id uuid not null,

  quote_id uuid not null,
  quote_version_id uuid not null,
  qualification_event_id uuid not null
) on commit drop;

do $fixture_parent$
declare
  v_org uuid;
  v_store uuid;
  v_customer uuid;
begin
  select
    opportunity_row.organization_id,
    opportunity_row.store_id,
    opportunity_row.customer_id
  into
    v_org,
    v_store,
    v_customer
  from public.commercial_opportunities opportunity_row
  order by opportunity_row.id::text
  limit 1;

  if v_org is null or v_store is null or v_customer is null then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_CORE_PROGRESS_REQUIRES_ONE_EXISTING_OPPORTUNITY_SCOPE';
  end if;

  insert into pg_temp._p9_core_progress_ctx (
    organization_id,
    store_id,
    customer_id,
    qualification_opportunity_id,
    quote_opportunity_id,
    post_sale_not_started_opportunity_id,
    post_sale_active_opportunity_id,
    quote_id,
    quote_version_id,
    qualification_event_id
  )
  values (
    v_org,
    v_store,
    v_customer,
    '9f350545-0000-4000-8000-000000000001'::uuid,
    '9f350545-0000-4000-8000-000000000002'::uuid,
    '9f350545-0000-4000-8000-000000000003'::uuid,
    '9f350545-0000-4000-8000-000000000004'::uuid,
    '9f350545-0000-4000-8000-000000000011'::uuid,
    '9f350545-0000-4000-8000-000000000021'::uuid,
    '9f350545-0000-4000-8000-000000000031'::uuid
  );
end;
$fixture_parent$;

do $fixture_collision_guard$
declare
  v pg_temp._p9_core_progress_ctx%rowtype;
begin
  select * into v from pg_temp._p9_core_progress_ctx;

  if exists (
    select 1
    from public.commercial_opportunities o
    where o.id in (
      v.qualification_opportunity_id,
      v.quote_opportunity_id,
      v.post_sale_not_started_opportunity_id,
      v.post_sale_active_opportunity_id
    )
  )
  or exists (
    select 1 from public.sales_quotes q where q.id = v.quote_id
  )
  or exists (
    select 1 from public.sales_quote_versions qv where qv.id = v.quote_version_id
  )
  or exists (
    select 1
    from public.commercial_opportunity_qualification_fact_events e
    where e.id = v.qualification_event_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_CORE_PROGRESS_FIXED_UUID_COLLISION';
  end if;
end;
$fixture_collision_guard$;

-- ---------------------------------------------------------------------------
-- 2. BASE OPPORTUNITIES
-- ---------------------------------------------------------------------------

do $base_opportunities$
declare
  v pg_temp._p9_core_progress_ctx%rowtype;
begin
  select * into v from pg_temp._p9_core_progress_ctx;

  insert into public.commercial_opportunities (
    id,
    organization_id,
    store_id,
    customer_id,
    stage,
    lifecycle_cycle
  )
  values
    (
      v.qualification_opportunity_id,
      v.organization_id,
      v.store_id,
      v.customer_id,
      'qualificacao',
      1
    ),
    (
      v.quote_opportunity_id,
      v.organization_id,
      v.store_id,
      v.customer_id,
      'orcamento',
      1
    ),
    (
      v.post_sale_not_started_opportunity_id,
      v.organization_id,
      v.store_id,
      v.customer_id,
      'negociacao',
      1
    ),
    (
      v.post_sale_active_opportunity_id,
      v.organization_id,
      v.store_id,
      v.customer_id,
      'pos_venda',
      1
    );
end;
$base_opportunities$;

-- ---------------------------------------------------------------------------
-- 3. QUALIFICATION: no facts => not_started and deterministic
-- ---------------------------------------------------------------------------

do $qualification_not_started$
declare
  v pg_temp._p9_core_progress_ctx%rowtype;
  r1 record;
  r2 record;
begin
  select * into v from pg_temp._p9_core_progress_ctx;

  select *
  into r1
  from public.p9_resolve_qualification_progress_internal(
    v.organization_id,
    v.store_id,
    v.qualification_opportunity_id
  );

  select *
  into r2
  from public.p9_resolve_qualification_progress_internal(
    v.organization_id,
    v.store_id,
    v.qualification_opportunity_id
  );

  if r1.assessment_state is distinct from 'determined'
     or r1.progress_state is distinct from 'not_started'
     or r1.resolver_key is distinct from 'qualification'
     or r1.resolver_version is distinct from 1
     or r1.reason_code is distinct from 'qualification_no_canonical_facts'
     or r1.authority_fingerprint !~ '^[0-9a-f]{64}$'
     or r1.authority_fingerprint is distinct from r2.authority_fingerprint
     or r1.resolution_basis is distinct from r2.resolution_basis then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_QUALIFICATION_NOT_STARTED_FAILED',
      detail = pg_catalog.jsonb_build_object(
        'first', pg_catalog.to_jsonb(r1),
        'second', pg_catalog.to_jsonb(r2)
      )::text;
  end if;
end;
$qualification_not_started$;

-- ---------------------------------------------------------------------------
-- 4. QUALIFICATION: canonical fact => in_progress; raw value not copied to basis
-- ---------------------------------------------------------------------------

do $qualification_in_progress$
declare
  v pg_temp._p9_core_progress_ctx%rowtype;
  r record;
begin
  select * into v from pg_temp._p9_core_progress_ctx;

  insert into public.commercial_opportunity_qualification_fact_events (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    fact_key,
    value_json,
    normalized_value_text,
    value_kind,
    assertion_level,
    source_type,
    source_message_id,
    source_conversation_id,
    operation_key,
    created_by,
    resolves_conflict
  )
  values (
    v.qualification_event_id,
    v.organization_id,
    v.store_id,
    v.qualification_opportunity_id,
    'need_summary',
    pg_catalog.to_jsonb('piscina residencial'::text),
    'piscina residencial',
    'text',
    'confirmed',
    'crm_manual',
    null,
    null,
    'runner-core-progress-qualification-1',
    'postgres.manual_runner',
    false
  );

  insert into public.commercial_opportunity_qualification_facts_current (
    organization_id,
    store_id,
    commercial_opportunity_id,
    fact_key,
    current_state,
    value_json,
    normalized_value_text,
    value_kind,
    conflict_values_json,
    source_type,
    source_message_id,
    source_conversation_id,
    last_event_id,
    last_operation_key
  )
  values (
    v.organization_id,
    v.store_id,
    v.qualification_opportunity_id,
    'need_summary',
    'confirmed',
    pg_catalog.to_jsonb('piscina residencial'::text),
    'piscina residencial',
    'text',
    null,
    'crm_manual',
    null,
    null,
    v.qualification_event_id,
    'runner-core-progress-qualification-1'
  );

  select *
  into r
  from public.p9_resolve_qualification_progress_internal(
    v.organization_id,
    v.store_id,
    v.qualification_opportunity_id
  );

  if r.assessment_state is distinct from 'determined'
     or r.progress_state is distinct from 'in_progress'
     or r.reason_code is distinct from 'qualification_facts_present_completion_unproven'
     or (r.resolution_basis ->> 'completion_authority_available')::boolean is distinct from false
     or r.resolution_basis::text like '%piscina residencial%'
     or r.progress_state = 'completed' then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_QUALIFICATION_IN_PROGRESS_FAILED',
      detail = pg_catalog.to_jsonb(r)::text;
  end if;
end;
$qualification_in_progress$;

-- ---------------------------------------------------------------------------
-- 5. QUOTE: no artifact => not_started
-- ---------------------------------------------------------------------------

do $quote_not_started$
declare
  v pg_temp._p9_core_progress_ctx%rowtype;
  r record;
begin
  select * into v from pg_temp._p9_core_progress_ctx;

  select *
  into r
  from public.p9_resolve_quote_progress_internal(
    v.organization_id,
    v.store_id,
    v.quote_opportunity_id
  );

  if r.assessment_state is distinct from 'determined'
     or r.progress_state is distinct from 'not_started'
     or r.reason_code is distinct from 'quote_no_canonical_artifact'
     or r.authority_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_QUOTE_NOT_STARTED_FAILED',
      detail = pg_catalog.to_jsonb(r)::text;
  end if;
end;
$quote_not_started$;

-- ---------------------------------------------------------------------------
-- 6. QUOTE: draft artifact => in_progress
-- ---------------------------------------------------------------------------

do $quote_in_progress$
declare
  v pg_temp._p9_core_progress_ctx%rowtype;
  r record;
begin
  select * into v from pg_temp._p9_core_progress_ctx;

  insert into public.sales_quotes (
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    creation_idempotency_key,
    creation_request_fingerprint,
    conversation_id,
    lead_id,
    quote_number,
    title,
    status,
    customer_name,
    subtotal_cents,
    discount_cents,
    total_cents,
    current_version_id,
    metadata
  )
  values (
    v.quote_id,
    v.organization_id,
    v.store_id,
    v.quote_opportunity_id,
    'runner-core-progress-quote-1',
    repeat('a', 64),
    null,
    null,
    'RUNNER-P9-CORE-001',
    'Runner P9 Core Progress',
    'draft',
    'Runner',
    100000,
    0,
    100000,
    null,
    pg_catalog.jsonb_build_object(
      'runner', 'p9_core_progress_resolvers_v1'
    )
  );

  select *
  into r
  from public.p9_resolve_quote_progress_internal(
    v.organization_id,
    v.store_id,
    v.quote_opportunity_id
  );

  if r.assessment_state is distinct from 'determined'
     or r.progress_state is distinct from 'in_progress'
     or r.reason_code is distinct from 'quote_artifact_exists_not_canonically_sent' then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_QUOTE_DRAFT_IN_PROGRESS_FAILED',
      detail = pg_catalog.to_jsonb(r)::text;
  end if;
end;
$quote_in_progress$;

-- ---------------------------------------------------------------------------
-- 7. QUOTE: generated internal version is still in_progress
-- ---------------------------------------------------------------------------

do $quote_version_generated$
declare
  v pg_temp._p9_core_progress_ctx%rowtype;
  r record;
begin
  select * into v from pg_temp._p9_core_progress_ctx;

  insert into public.sales_quote_versions (
    id,
    organization_id,
    store_id,
    quote_id,
    version_number,
    status,
    quote_snapshot,
    generated_by
  )
  values (
    v.quote_version_id,
    v.organization_id,
    v.store_id,
    v.quote_id,
    1,
    'generated',
    '{}'::jsonb,
    'system'
  );

  update public.sales_quotes
  set current_version_id = v.quote_version_id
  where id = v.quote_id
    and organization_id = v.organization_id
    and store_id = v.store_id;

  select *
  into r
  from public.p9_resolve_quote_progress_internal(
    v.organization_id,
    v.store_id,
    v.quote_opportunity_id
  );

  if r.assessment_state is distinct from 'determined'
     or r.progress_state is distinct from 'in_progress'
     or r.reason_code is distinct from 'quote_artifact_exists_not_canonically_sent' then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_QUOTE_GENERATED_IN_PROGRESS_FAILED',
      detail = pg_catalog.to_jsonb(r)::text;
  end if;
end;
$quote_version_generated$;

-- ---------------------------------------------------------------------------
-- 8. QUOTE: sent version without opportunity current proposal => fail closed
-- ---------------------------------------------------------------------------

do $quote_sent_without_pointer$
declare
  v pg_temp._p9_core_progress_ctx%rowtype;
  r record;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  select * into v from pg_temp._p9_core_progress_ctx;

  update public.sales_quotes
  set status = 'sent',
      sent_at = v_now
  where id = v.quote_id
    and organization_id = v.organization_id
    and store_id = v.store_id;

  update public.sales_quote_versions
  set status = 'sent',
      sent_at = v_now
  where id = v.quote_version_id
    and quote_id = v.quote_id
    and organization_id = v.organization_id
    and store_id = v.store_id;

  select *
  into r
  from public.p9_resolve_quote_progress_internal(
    v.organization_id,
    v.store_id,
    v.quote_opportunity_id
  );

  if r.assessment_state is distinct from 'needs_resolution'
     or r.progress_state is not null
     or r.reason_code is distinct from 'quote_sent_without_current_proposal' then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_QUOTE_SENT_WITHOUT_POINTER_FAILED',
      detail = pg_catalog.to_jsonb(r)::text;
  end if;
end;
$quote_sent_without_pointer$;

-- ---------------------------------------------------------------------------
-- 9. QUOTE: canonical current proposal writer => completed
-- ---------------------------------------------------------------------------

do $quote_completed$
declare
  v pg_temp._p9_core_progress_ctx%rowtype;
  r record;
  v_projection record;
begin
  select * into v from pg_temp._p9_core_progress_ctx;

  select *
  into v_projection
  from public.set_current_commercial_proposal_from_sent_quote_by_system(
    v.organization_id,
    v.store_id,
    v.quote_opportunity_id,
    v.quote_id,
    v.quote_version_id,
    'current_commercial_proposal:'
  || v.quote_opportunity_id::text
  || ':'
  || v.quote_id::text
  || ':'
  || v.quote_version_id::text,
'system_current_commercial_proposal_projection'
  );

  if v_projection.current_quote_id is distinct from v.quote_id
     or v_projection.current_quote_version_id is distinct from v.quote_version_id then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_QUOTE_CURRENT_PROPOSAL_WRITER_FAILED',
      detail = pg_catalog.to_jsonb(v_projection)::text;
  end if;

  select *
  into r
  from public.p9_resolve_quote_progress_internal(
    v.organization_id,
    v.store_id,
    v.quote_opportunity_id
  );

  if r.assessment_state is distinct from 'determined'
     or r.progress_state is distinct from 'completed'
     or r.reason_code is distinct from 'quote_current_proposal_canonically_sent'
     or (r.resolution_basis #>> '{current_pointer,canonical_sent_evidence_valid}')::boolean
        is distinct from true then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_QUOTE_COMPLETED_FAILED',
      detail = pg_catalog.to_jsonb(r)::text;
  end if;
end;
$quote_completed$;

-- ---------------------------------------------------------------------------
-- 10. QUOTE: sent pointed version can become superseded while remaining the
--     current commercial proposal until another sent proposal replaces it.
-- ---------------------------------------------------------------------------

do $quote_superseded_sent_still_completed$
declare
  v pg_temp._p9_core_progress_ctx%rowtype;
  r record;
begin
  select * into v from pg_temp._p9_core_progress_ctx;

  update public.sales_quote_versions
  set status = 'superseded'
  where id = v.quote_version_id
    and organization_id = v.organization_id
    and store_id = v.store_id;

  update public.sales_quotes
  set status = 'pending_review'
  where id = v.quote_id
    and organization_id = v.organization_id
    and store_id = v.store_id;

  select *
  into r
  from public.p9_resolve_quote_progress_internal(
    v.organization_id,
    v.store_id,
    v.quote_opportunity_id
  );

  if r.assessment_state is distinct from 'determined'
     or r.progress_state is distinct from 'completed'
     or r.reason_code is distinct from 'quote_current_proposal_canonically_sent' then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_QUOTE_SUPERSEDED_SENT_AUTHORITY_FAILED',
      detail = pg_catalog.to_jsonb(r)::text;
  end if;
end;
$quote_superseded_sent_still_completed$;

-- ---------------------------------------------------------------------------
-- 11. POST-SALE: before post-sale => not_started
-- ---------------------------------------------------------------------------

do $post_sale_not_started$
declare
  v pg_temp._p9_core_progress_ctx%rowtype;
  r record;
begin
  select * into v from pg_temp._p9_core_progress_ctx;

  select *
  into r
  from public.p9_resolve_post_sale_progress_internal(
    v.organization_id,
    v.store_id,
    v.post_sale_not_started_opportunity_id
  );

  if r.assessment_state is distinct from 'determined'
     or r.progress_state is distinct from 'not_started'
     or r.reason_code is distinct from 'post_sale_not_started' then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_POST_SALE_NOT_STARTED_FAILED',
      detail = pg_catalog.to_jsonb(r)::text;
  end if;
end;
$post_sale_not_started$;

-- ---------------------------------------------------------------------------
-- 12. POST-SALE: pos_venda => in_progress
-- ---------------------------------------------------------------------------

do $post_sale_in_progress$
declare
  v pg_temp._p9_core_progress_ctx%rowtype;
  r record;
begin
  select * into v from pg_temp._p9_core_progress_ctx;

  select *
  into r
  from public.p9_resolve_post_sale_progress_internal(
    v.organization_id,
    v.store_id,
    v.post_sale_active_opportunity_id
  );

  if r.assessment_state is distinct from 'determined'
     or r.progress_state is distinct from 'in_progress'
     or r.reason_code is distinct from 'post_sale_stage_in_progress' then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_POST_SALE_IN_PROGRESS_FAILED',
      detail = pg_catalog.to_jsonb(r)::text;
  end if;
end;
$post_sale_in_progress$;

-- ---------------------------------------------------------------------------
-- 13. POST-SALE: canonical conclusion => completed
-- ---------------------------------------------------------------------------

do $post_sale_completed$
declare
  v pg_temp._p9_core_progress_ctx%rowtype;
  r record;
  v_transition record;
begin
  select * into v from pg_temp._p9_core_progress_ctx;

  select *
  into v_transition
  from public.conclude_commercial_opportunity_by_system(
    v.organization_id,
    v.store_id,
    v.post_sale_active_opportunity_id,
    'runner-core-progress-post-sale-conclusion-1',
    'Runner canonical post-sale conclusion',
    'operator_note',
    null::uuid,
    'Canonical conclusion for Core Progress Resolver V1 runner.',
    'system_conclusion'
  );

  if v_transition.stage is distinct from 'concluido_sem_mais_acoes'
     or v_transition.event_type is distinct from 'conclusion'
     or v_transition.lifecycle_cycle is distinct from 1 then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_POST_SALE_CANONICAL_CONCLUSION_WRITER_FAILED',
      detail = pg_catalog.to_jsonb(v_transition)::text;
  end if;

  select *
  into r
  from public.p9_resolve_post_sale_progress_internal(
    v.organization_id,
    v.store_id,
    v.post_sale_active_opportunity_id
  );

  if r.assessment_state is distinct from 'determined'
     or r.progress_state is distinct from 'completed'
     or r.reason_code is distinct from 'post_sale_canonical_conclusion'
     or (r.resolution_basis ->> 'conclusion_count')::integer < 1 then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_POST_SALE_COMPLETED_FAILED',
      detail = pg_catalog.to_jsonb(r)::text;
  end if;
end;
$post_sale_completed$;

-- ---------------------------------------------------------------------------
-- 14. POST-SALE: canonical reopen, same lifecycle cycle => in_progress again
-- ---------------------------------------------------------------------------

do $post_sale_reopened$
declare
  v pg_temp._p9_core_progress_ctx%rowtype;
  r record;
  v_transition record;
begin
  select * into v from pg_temp._p9_core_progress_ctx;

  select *
  into v_transition
  from public.reopen_commercial_opportunity_for_post_sale_by_system(
    v.organization_id,
    v.store_id,
    v.post_sale_active_opportunity_id,
    'runner-core-progress-post-sale-reopen-1',
    'Runner canonical post-sale reopen',
    'operator_note',
    null::uuid,
    'Canonical post-sale reopen for Core Progress Resolver V1 runner.',
    'system_post_sale_reopen'
  );

  if v_transition.stage is distinct from 'pos_venda'
     or v_transition.event_type is distinct from 'post_sale_reopen'
     or v_transition.lifecycle_cycle is distinct from 1 then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_POST_SALE_CANONICAL_REOPEN_WRITER_FAILED',
      detail = pg_catalog.to_jsonb(v_transition)::text;
  end if;

  select *
  into r
  from public.p9_resolve_post_sale_progress_internal(
    v.organization_id,
    v.store_id,
    v.post_sale_active_opportunity_id
  );

  if r.assessment_state is distinct from 'determined'
     or r.progress_state is distinct from 'in_progress'
     or r.reason_code is distinct from 'post_sale_reopened_in_progress'
     or (r.resolution_basis ->> 'post_sale_reopen_count')::integer < 1
     or (r.resolution_basis ->> 'lifecycle_cycle')::integer is distinct from 1 then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_POST_SALE_REOPENED_PROGRESS_FAILED',
      detail = pg_catalog.to_jsonb(r)::text;
  end if;
end;
$post_sale_reopened$;

-- ---------------------------------------------------------------------------
-- 15. STATIC GUARDS
-- ---------------------------------------------------------------------------

do $static_guards$
declare
  v_signature text;
  v_definition text;
  v_normalized text;
begin
  foreach v_signature in array array[
    'public.p9_resolve_qualification_progress_internal(uuid,uuid,uuid)',
    'public.p9_resolve_quote_progress_internal(uuid,uuid,uuid)',
    'public.p9_resolve_post_sale_progress_internal(uuid,uuid,uuid)'
  ]
  loop
    select pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(v_signature))
    into v_definition;

    v_normalized := lower(
      pg_catalog.regexp_replace(coalesce(v_definition, ''), '\s+', ' ', 'g')
    );

    if v_normalized like '%order by created_at desc%'
       or v_normalized like '%order by updated_at desc%'
       or v_normalized like '%max(created_at%'
       or v_normalized like '%max(updated_at%'
       or v_normalized like '%limit 1%' then
      raise exception using
        errcode = 'P0001',
        message = 'RUNNER_CORE_PROGRESS_RECENCY_HEURISTIC_FOUND',
        detail = v_signature;
    end if;
  end loop;

  select pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'public.p9_resolve_qualification_progress_internal(uuid,uuid,uuid)'
    )
  )
  into v_definition;

  if lower(v_definition) like '%v_progress := ''completed''%' then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_QUALIFICATION_AUTOMATIC_COMPLETION_FORBIDDEN';
  end if;

  select pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'public.p9_resolve_quote_progress_internal(uuid,uuid,uuid)'
    )
  )
  into v_definition;

  if lower(v_definition) not like '%quote_current_proposal_cycle_unanchored%'
     or lower(v_definition) not like '%quote_artifact_cycle_unanchored%'
     or lower(v_definition) not like '%lifecycle_cycle > 1%' then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_QUOTE_LIFECYCLE_FAIL_CLOSED_GUARD_MISSING';
  end if;
end;
$static_guards$;

-- ---------------------------------------------------------------------------
-- 16. FIXTURE PRESENCE BEFORE ROLLBACK
-- ---------------------------------------------------------------------------

do $fixture_presence_before_rollback$
declare
  v pg_temp._p9_core_progress_ctx%rowtype;
  v_opp_count integer;
  v_quote_count integer;
  v_version_count integer;
  v_qfact_event_count integer;
  v_qfact_current_count integer;
  v_lifecycle_count integer;
begin
  select * into v from pg_temp._p9_core_progress_ctx;

  select count(*)::integer into v_opp_count
  from public.commercial_opportunities o
  where o.id in (
    v.qualification_opportunity_id,
    v.quote_opportunity_id,
    v.post_sale_not_started_opportunity_id,
    v.post_sale_active_opportunity_id
  );

  select count(*)::integer into v_quote_count
  from public.sales_quotes q
  where q.id = v.quote_id;

  select count(*)::integer into v_version_count
  from public.sales_quote_versions qv
  where qv.id = v.quote_version_id;

  select count(*)::integer into v_qfact_event_count
  from public.commercial_opportunity_qualification_fact_events e
  where e.id = v.qualification_event_id;

  select count(*)::integer into v_qfact_current_count
  from public.commercial_opportunity_qualification_facts_current c
  where c.commercial_opportunity_id = v.qualification_opportunity_id;

  select count(*)::integer into v_lifecycle_count
  from public.commercial_opportunity_lifecycle_events e
  where e.commercial_opportunity_id = v.post_sale_active_opportunity_id
    and e.event_type in ('conclusion', 'post_sale_reopen');

  if v_opp_count <> 4
     or v_quote_count <> 1
     or v_version_count <> 1
     or v_qfact_event_count <> 1
     or v_qfact_current_count <> 1
     or v_lifecycle_count < 2 then
    raise exception using
      errcode = 'P0001',
      message = 'RUNNER_CORE_PROGRESS_FIXTURE_PRESENCE_MISMATCH',
      detail = pg_catalog.jsonb_build_object(
        'opportunities', v_opp_count,
        'quotes', v_quote_count,
        'quote_versions', v_version_count,
        'qualification_events', v_qfact_event_count,
        'qualification_current', v_qfact_current_count,
        'post_sale_lifecycle_events', v_lifecycle_count
      )::text;
  end if;
end;
$fixture_presence_before_rollback$;

rollback;

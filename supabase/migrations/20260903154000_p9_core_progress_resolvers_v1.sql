-- P9 / Bloco 3 / Etapa 3.5
-- Core Progress Resolvers V1
--
-- Internal read-only resolvers for qualification, quote and post_sale.
-- They do not materialize checklist progress current; a later Progress Materializer
-- composes all required/optional items into a complete immutable projection.

begin;

-- ---------------------------------------------------------------------------
-- 0. PRECONDITIONS
-- ---------------------------------------------------------------------------

do $preconditions$
declare
  v_missing text[] := array[]::text[];
begin
  if pg_catalog.to_regclass('public.commercial_opportunities') is null then
    v_missing := v_missing || 'public.commercial_opportunities';
  end if;

  if pg_catalog.to_regclass('public.commercial_opportunity_qualification_facts_current') is null then
    v_missing := v_missing || 'public.commercial_opportunity_qualification_facts_current';
  end if;

  if pg_catalog.to_regclass('public.sales_quotes') is null then
    v_missing := v_missing || 'public.sales_quotes';
  end if;

  if pg_catalog.to_regclass('public.sales_quote_versions') is null then
    v_missing := v_missing || 'public.sales_quote_versions';
  end if;

  if pg_catalog.to_regclass('public.commercial_opportunity_lifecycle_events') is null then
    v_missing := v_missing || 'public.commercial_opportunity_lifecycle_events';
  end if;

  if pg_catalog.to_regprocedure(
       'public.set_current_commercial_proposal_from_sent_quote_by_system(uuid,uuid,uuid,uuid,uuid,text,text)'
     ) is null then
    v_missing := v_missing || 'public.set_current_commercial_proposal_from_sent_quote_by_system(uuid,uuid,uuid,uuid,uuid,text,text)';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace ns
      on ns.oid = proc_row.pronamespace
    where ns.nspname = 'extensions'
      and proc_row.proname = 'digest'
  ) then
    v_missing := v_missing || 'extensions.digest';
  end if;

  if pg_catalog.array_length(v_missing, 1) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_CORE_PROGRESS_RESOLVERS_PRECONDITION_FAILED',
      detail = pg_catalog.array_to_string(v_missing, ', ');
  end if;

  if pg_catalog.to_regprocedure(
       'public.p9_resolve_qualification_progress_internal(uuid,uuid,uuid)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'public.p9_resolve_quote_progress_internal(uuid,uuid,uuid)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'public.p9_resolve_post_sale_progress_internal(uuid,uuid,uuid)'
     ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_CORE_PROGRESS_RESOLVERS_ALREADY_EXIST';
  end if;
end;
$preconditions$;

-- ---------------------------------------------------------------------------
-- 1. QUALIFICATION PROGRESS RESOLVER V1
-- ---------------------------------------------------------------------------
--
-- V1 intentionally never auto-completes qualification.
-- No facts     => determined / not_started
-- Facts exist  => determined / in_progress
-- Any conflict => conflict / NULL
--
-- The canonical facts authority does not expose a universal, explicit
-- qualification-completed authority. Raw fact values are intentionally omitted
-- from the evidence basis; identity/state/provenance are enough to reproduce it.

create function public.p9_resolve_qualification_progress_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
)
returns table (
  assessment_state text,
  progress_state text,
  resolver_key text,
  resolver_version integer,
  authority_fingerprint text,
  resolution_basis jsonb,
  reason_code text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
set row_security = off
as $function$
declare
  v_opportunity public.commercial_opportunities;
  v_fact_count integer := 0;
  v_conflict_count integer := 0;
  v_fact_basis jsonb := '[]'::jsonb;
  v_basis jsonb;
  v_assessment text;
  v_progress text;
  v_reason text;
  v_fingerprint text;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22023',
      message = 'P9_QUALIFICATION_PROGRESS_ARGUMENTS_REQUIRED';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'P9_QUALIFICATION_PROGRESS_OPPORTUNITY_NOT_FOUND';
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where fact_row.current_state = 'conflict'
    )::integer,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'fact_key', fact_row.fact_key,
          'current_state', fact_row.current_state,
          'value_kind', fact_row.value_kind,
          'source_type', fact_row.source_type,
          'source_message_id', fact_row.source_message_id,
          'source_conversation_id', fact_row.source_conversation_id,
          'last_event_id', fact_row.last_event_id,
          'last_operation_key', fact_row.last_operation_key
        )
        order by fact_row.fact_key
      ),
      '[]'::jsonb
    )
  into
    v_fact_count,
    v_conflict_count,
    v_fact_basis
  from public.commercial_opportunity_qualification_facts_current fact_row
  where fact_row.organization_id = p_organization_id
    and fact_row.store_id = p_store_id
    and fact_row.commercial_opportunity_id = p_commercial_opportunity_id;

  if v_conflict_count > 0 then
    v_assessment := 'conflict';
    v_progress := null;
    v_reason := 'qualification_fact_conflict';
  elsif v_fact_count = 0 then
    v_assessment := 'determined';
    v_progress := 'not_started';
    v_reason := 'qualification_no_canonical_facts';
  else
    v_assessment := 'determined';
    v_progress := 'in_progress';
    v_reason := 'qualification_facts_present_completion_unproven';
  end if;

  v_basis := pg_catalog.jsonb_build_object(
    'schema', 'p9_progress_resolution_basis_v1',
    'resolver_key', 'qualification',
    'resolver_version', 1,
    'authority', 'commercial_opportunity_qualification_facts_current',
    'organization_id', p_organization_id,
    'store_id', p_store_id,
    'commercial_opportunity_id', p_commercial_opportunity_id,
    'lifecycle_cycle_context', v_opportunity.lifecycle_cycle,
    'fact_count', v_fact_count,
    'conflict_count', v_conflict_count,
    'facts', v_fact_basis,
    'completion_authority_available', false
  );

  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_basis::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  return query
  select
    v_assessment,
    v_progress,
    'qualification'::text,
    1,
    v_fingerprint,
    v_basis,
    v_reason;
end;
$function$;

alter function public.p9_resolve_qualification_progress_internal(
  uuid, uuid, uuid
) owner to postgres;

revoke all on function public.p9_resolve_qualification_progress_internal(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;

comment on function public.p9_resolve_qualification_progress_internal(
  uuid, uuid, uuid
) is
  'P9 internal read-only Qualification Progress Resolver V1. Uses exact canonical qualification facts and never infers completion without a dedicated completion authority.';

-- ---------------------------------------------------------------------------
-- 2. QUOTE PROGRESS RESOLVER V1
-- ---------------------------------------------------------------------------
--
-- No quote artifact                                      => not_started
-- Quote artifact, no canonical sent proposal             => in_progress
-- Canonical sent version but no opportunity current pair => needs_resolution
-- Explicit current pair + canonical sent-version evidence=> completed
-- Invalid current pair/evidence                          => conflict
--
-- Canonical send evidence for a version is sent_at plus status sent|superseded.
-- A pointed sent version may later become superseded while a newer internal
-- revision is under review; the previously presented proposal remains the
-- current commercial proposal until another sent proposal replaces it.
-- Customer acceptance is a separate gate/action and is not evaluated here.

create function public.p9_resolve_quote_progress_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
)
returns table (
  assessment_state text,
  progress_state text,
  resolver_key text,
  resolver_version integer,
  authority_fingerprint text,
  resolution_basis jsonb,
  reason_code text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
set row_security = off
as $function$
declare
  v_opportunity public.commercial_opportunities;
  v_quote_count integer := 0;
  v_canonical_sent_version_count integer := 0;
  v_quote_basis jsonb := '[]'::jsonb;

  v_current_quote_exists boolean := false;
  v_current_version_exists boolean := false;
  v_current_quote_opportunity_id uuid;
  v_current_quote_status text;
  v_current_quote_current_version_id uuid;
  v_current_version_quote_id uuid;
  v_current_version_status text;
  v_current_version_sent_at timestamptz;
  v_current_version_number integer;

  v_pointer_valid boolean := false;
  v_basis jsonb;
  v_assessment text;
  v_progress text;
  v_reason text;
  v_fingerprint text;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22023',
      message = 'P9_QUOTE_PROGRESS_ARGUMENTS_REQUIRED';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'P9_QUOTE_PROGRESS_OPPORTUNITY_NOT_FOUND';
  end if;

  select
    count(*)::integer,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'quote_id', quote_row.id,
          'quote_status', quote_row.status,
          'quote_current_version_id', quote_row.current_version_id,
          'versions',
          coalesce(
            (
              select pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                  'version_id', version_row.id,
                  'version_number', version_row.version_number,
                  'version_status', version_row.status,
                  'sent_at', version_row.sent_at
                )
                order by version_row.id::text
              )
              from public.sales_quote_versions version_row
              where version_row.organization_id = p_organization_id
                and version_row.store_id = p_store_id
                and version_row.quote_id = quote_row.id
            ),
            '[]'::jsonb
          )
        )
        order by quote_row.id::text
      ),
      '[]'::jsonb
    )
  into
    v_quote_count,
    v_quote_basis
  from public.sales_quotes quote_row
  where quote_row.organization_id = p_organization_id
    and quote_row.store_id = p_store_id
    and quote_row.commercial_opportunity_id = p_commercial_opportunity_id;

  select count(*)::integer
  into v_canonical_sent_version_count
  from public.sales_quotes quote_row
  join public.sales_quote_versions version_row
    on version_row.quote_id = quote_row.id
   and version_row.organization_id = quote_row.organization_id
   and version_row.store_id = quote_row.store_id
  where quote_row.organization_id = p_organization_id
    and quote_row.store_id = p_store_id
    and quote_row.commercial_opportunity_id = p_commercial_opportunity_id
    and version_row.sent_at is not null
    and lower(pg_catalog.btrim(version_row.status)) in ('sent', 'superseded');

  if v_opportunity.current_quote_id is not null
     and v_opportunity.current_quote_version_id is not null then

    select
      true,
      quote_row.commercial_opportunity_id,
      quote_row.status,
      quote_row.current_version_id
    into
      v_current_quote_exists,
      v_current_quote_opportunity_id,
      v_current_quote_status,
      v_current_quote_current_version_id
    from public.sales_quotes quote_row
    where quote_row.id = v_opportunity.current_quote_id
      and quote_row.organization_id = p_organization_id
      and quote_row.store_id = p_store_id;

    if not found then
      v_current_quote_exists := false;
    end if;

    select
      true,
      version_row.quote_id,
      version_row.status,
      version_row.sent_at,
      version_row.version_number
    into
      v_current_version_exists,
      v_current_version_quote_id,
      v_current_version_status,
      v_current_version_sent_at,
      v_current_version_number
    from public.sales_quote_versions version_row
    where version_row.id = v_opportunity.current_quote_version_id
      and version_row.organization_id = p_organization_id
      and version_row.store_id = p_store_id;

    if not found then
      v_current_version_exists := false;
    end if;

    v_pointer_valid :=
      v_current_quote_exists
      and v_current_version_exists
      and v_current_quote_opportunity_id is not distinct from p_commercial_opportunity_id
      and v_current_version_quote_id is not distinct from v_opportunity.current_quote_id
      and v_current_version_sent_at is not null
      and lower(pg_catalog.btrim(coalesce(v_current_version_status, '')))
          in ('sent', 'superseded');

    if not v_pointer_valid then
      v_assessment := 'conflict';
      v_progress := null;
      v_reason := 'quote_current_proposal_authority_conflict';
    elsif v_opportunity.lifecycle_cycle > 1 then
      -- The current-proposal foundation predates an explicit quote lifecycle-cycle
      -- anchor. Cycle 1 proves there was no commercial reopen. From cycle 2 on,
      -- the resolver cannot prove whether this sent proposal belongs to the current
      -- commercial cycle, so it must fail closed instead of reusing stale evidence.
      v_assessment := 'needs_resolution';
      v_progress := null;
      v_reason := 'quote_current_proposal_cycle_unanchored';
    else
      v_assessment := 'determined';
      v_progress := 'completed';
      v_reason := 'quote_current_proposal_canonically_sent';
    end if;

  elsif v_opportunity.current_quote_id is not null
        or v_opportunity.current_quote_version_id is not null then
    v_assessment := 'conflict';
    v_progress := null;
    v_reason := 'quote_current_proposal_pair_conflict';

  elsif v_canonical_sent_version_count > 0 then
    v_assessment := 'needs_resolution';
    v_progress := null;
    v_reason := 'quote_sent_without_current_proposal';

  elsif v_quote_count = 0 then
    v_assessment := 'determined';
    v_progress := 'not_started';
    v_reason := 'quote_no_canonical_artifact';

  elsif v_opportunity.lifecycle_cycle > 1 then
    v_assessment := 'needs_resolution';
    v_progress := null;
    v_reason := 'quote_artifact_cycle_unanchored';

  else
    v_assessment := 'determined';
    v_progress := 'in_progress';
    v_reason := 'quote_artifact_exists_not_canonically_sent';
  end if;

  v_basis := pg_catalog.jsonb_build_object(
    'schema', 'p9_progress_resolution_basis_v1',
    'resolver_key', 'quote',
    'resolver_version', 1,
    'authority', pg_catalog.jsonb_build_array(
      'commercial_opportunities.current_quote_id',
      'commercial_opportunities.current_quote_version_id',
      'sales_quotes',
      'sales_quote_versions'
    ),
    'organization_id', p_organization_id,
    'store_id', p_store_id,
    'commercial_opportunity_id', p_commercial_opportunity_id,
    'lifecycle_cycle_context', v_opportunity.lifecycle_cycle,
    'lifecycle_cycle_proven_for_quote_authority', (v_opportunity.lifecycle_cycle = 1),
    'current_quote_id', v_opportunity.current_quote_id,
    'current_quote_version_id', v_opportunity.current_quote_version_id,
    'current_pointer', pg_catalog.jsonb_build_object(
      'quote_exists', v_current_quote_exists,
      'quote_status', v_current_quote_status,
      'quote_internal_current_version_id', v_current_quote_current_version_id,
      'version_exists', v_current_version_exists,
      'version_quote_id', v_current_version_quote_id,
      'version_number', v_current_version_number,
      'version_status', v_current_version_status,
      'version_sent_at', v_current_version_sent_at,
      'canonical_sent_evidence_valid', v_pointer_valid
    ),
    'quote_count', v_quote_count,
    'canonical_sent_version_count', v_canonical_sent_version_count,
    'quotes', v_quote_basis,
    'customer_acceptance_evaluated', false
  );

  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_basis::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  return query
  select
    v_assessment,
    v_progress,
    'quote'::text,
    1,
    v_fingerprint,
    v_basis,
    v_reason;
end;
$function$;

alter function public.p9_resolve_quote_progress_internal(
  uuid, uuid, uuid
) owner to postgres;

revoke all on function public.p9_resolve_quote_progress_internal(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;

comment on function public.p9_resolve_quote_progress_internal(
  uuid, uuid, uuid
) is
  'P9 internal read-only Quote Progress Resolver V1. Uses explicit current proposal identity plus canonical sent-version evidence; never chooses a quote by recency and does not conflate send with customer acceptance.';

-- ---------------------------------------------------------------------------
-- 3. POST-SALE PROGRESS RESOLVER V1
-- ---------------------------------------------------------------------------
--
-- Current-stage / current-cycle semantics:
--   before post_sale, no conclusion authority => determined / not_started
--   stage = pos_venda                    => determined / in_progress
--   concluded + canonical conclusion     => determined / completed
--   concluded without canonical event    => needs_resolution / NULL
--   incompatible event/projection        => conflict / NULL
--
-- post_sale_reopen preserves lifecycle_cycle, so it intentionally regresses the
-- current projection from completed back to in_progress.

create function public.p9_resolve_post_sale_progress_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid
)
returns table (
  assessment_state text,
  progress_state text,
  resolver_key text,
  resolver_version integer,
  authority_fingerprint text,
  resolution_basis jsonb,
  reason_code text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
set row_security = off
as $function$
declare
  v_opportunity public.commercial_opportunities;
  v_event_count integer := 0;
  v_conclusion_count integer := 0;
  v_reopen_count integer := 0;
  v_invalid_shape_count integer := 0;
  v_event_basis jsonb := '[]'::jsonb;
  v_basis jsonb;
  v_assessment text;
  v_progress text;
  v_reason text;
  v_fingerprint text;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null then
    raise exception using
      errcode = '22023',
      message = 'P9_POST_SALE_PROGRESS_ARGUMENTS_REQUIRED';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
    and opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'P9_POST_SALE_PROGRESS_OPPORTUNITY_NOT_FOUND';
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where event_row.event_type = 'conclusion'
    )::integer,
    count(*) filter (
      where event_row.event_type = 'post_sale_reopen'
    )::integer,
    count(*) filter (
      where (
        event_row.event_type = 'conclusion'
        and (
          event_row.previous_stage is null
          or event_row.new_stage is distinct from 'concluido_sem_mais_acoes'
          or event_row.reason_code is distinct from 'conclusion_writer_required'
        )
      )
      or (
        event_row.event_type = 'post_sale_reopen'
        and (
          event_row.previous_stage is distinct from 'concluido_sem_mais_acoes'
          or event_row.new_stage is distinct from 'pos_venda'
          or event_row.reason_code is distinct from 'post_sale_reopen_writer_required'
        )
      )
    )::integer,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'event_id', event_row.id,
          'event_type', event_row.event_type,
          'previous_stage', event_row.previous_stage,
          'new_stage', event_row.new_stage,
          'reason_code', event_row.reason_code,
          'event_key', event_row.event_key,
          'actor_type', event_row.actor_type,
          'source', event_row.source
        )
        order by event_row.id::text
      ),
      '[]'::jsonb
    )
  into
    v_event_count,
    v_conclusion_count,
    v_reopen_count,
    v_invalid_shape_count,
    v_event_basis
  from public.commercial_opportunity_lifecycle_events event_row
  where event_row.organization_id = p_organization_id
    and event_row.store_id = p_store_id
    and event_row.commercial_opportunity_id = p_commercial_opportunity_id
    and event_row.lifecycle_cycle = v_opportunity.lifecycle_cycle
    and event_row.event_type in ('conclusion', 'post_sale_reopen');

  if v_invalid_shape_count > 0 then
    v_assessment := 'conflict';
    v_progress := null;
    v_reason := 'post_sale_canonical_event_shape_conflict';

  elsif v_opportunity.stage = 'concluido_sem_mais_acoes' then
    if v_conclusion_count > 0 then
      v_assessment := 'determined';
      v_progress := 'completed';
      v_reason := 'post_sale_canonical_conclusion';
    else
      v_assessment := 'needs_resolution';
      v_progress := null;
      v_reason := 'post_sale_concluded_without_canonical_event';
    end if;

  elsif v_opportunity.stage = 'pos_venda' then
    v_assessment := 'determined';
    v_progress := 'in_progress';
    if v_reopen_count > 0 then
      v_reason := 'post_sale_reopened_in_progress';
    else
      v_reason := 'post_sale_stage_in_progress';
    end if;

  elsif v_event_count > 0 then
    v_assessment := 'conflict';
    v_progress := null;
    v_reason := 'post_sale_event_projection_conflict';

  else
    v_assessment := 'determined';
    v_progress := 'not_started';
    v_reason := 'post_sale_not_started';
  end if;

  v_basis := pg_catalog.jsonb_build_object(
    'schema', 'p9_progress_resolution_basis_v1',
    'resolver_key', 'post_sale',
    'resolver_version', 1,
    'authority', pg_catalog.jsonb_build_array(
      'commercial_opportunities.stage',
      'commercial_opportunity_lifecycle_events'
    ),
    'organization_id', p_organization_id,
    'store_id', p_store_id,
    'commercial_opportunity_id', p_commercial_opportunity_id,
    'lifecycle_cycle', v_opportunity.lifecycle_cycle,
    'current_stage', v_opportunity.stage,
    'event_count', v_event_count,
    'conclusion_count', v_conclusion_count,
    'post_sale_reopen_count', v_reopen_count,
    'invalid_shape_count', v_invalid_shape_count,
    'events', v_event_basis
  );

  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_basis::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  return query
  select
    v_assessment,
    v_progress,
    'post_sale'::text,
    1,
    v_fingerprint,
    v_basis,
    v_reason;
end;
$function$;

alter function public.p9_resolve_post_sale_progress_internal(
  uuid, uuid, uuid
) owner to postgres;

revoke all on function public.p9_resolve_post_sale_progress_internal(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;

comment on function public.p9_resolve_post_sale_progress_internal(
  uuid, uuid, uuid
) is
  'P9 internal read-only Post-sale Progress Resolver V1. Uses exact current lifecycle-cycle conclusion/reopen authority and allows explicit post-sale reopen to regress progress back to in_progress.';

-- ---------------------------------------------------------------------------
-- 4. POSTCONDITIONS / SECURITY / ANTI-HEURISTIC GUARDS
-- ---------------------------------------------------------------------------

do $postconditions$
declare
  v_proc_oid oid;
  v_owner text;
  v_security_definer boolean;
  v_volatility "char";
  v_definition text;
  v_normalized_definition text;
  v_signature text;
begin
  foreach v_signature in array array[
    'public.p9_resolve_qualification_progress_internal(uuid,uuid,uuid)',
    'public.p9_resolve_quote_progress_internal(uuid,uuid,uuid)',
    'public.p9_resolve_post_sale_progress_internal(uuid,uuid,uuid)'
  ]
  loop
    v_proc_oid := pg_catalog.to_regprocedure(v_signature);

    if v_proc_oid is null then
      raise exception using
        errcode = 'P0001',
        message = 'P9_CORE_PROGRESS_RESOLVER_POSTCONDITION_MISSING',
        detail = v_signature;
    end if;

    select
      owner_role.rolname,
      proc_row.prosecdef,
      proc_row.provolatile,
      pg_catalog.pg_get_functiondef(proc_row.oid)
    into
      v_owner,
      v_security_definer,
      v_volatility,
      v_definition
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_roles owner_role
      on owner_role.oid = proc_row.proowner
    where proc_row.oid = v_proc_oid;

    if v_owner is distinct from 'postgres'
       or v_security_definer is not true
       or v_volatility is distinct from 's' then
      raise exception using
        errcode = 'P0001',
        message = 'P9_CORE_PROGRESS_RESOLVER_SECURITY_SHAPE_MISMATCH',
        detail = v_signature;
    end if;

    if pg_catalog.has_function_privilege('anon', v_proc_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_proc_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', v_proc_oid, 'EXECUTE') then
      raise exception using
        errcode = 'P0001',
        message = 'P9_CORE_PROGRESS_RESOLVER_EXECUTE_EXPOSED',
        detail = v_signature;
    end if;

    v_normalized_definition := lower(
      pg_catalog.regexp_replace(coalesce(v_definition, ''), '\s+', ' ', 'g')
    );

    if v_normalized_definition like '%order by created_at desc%'
       or v_normalized_definition like '%order by updated_at desc%'
       or v_normalized_definition like '%max(created_at%'
       or v_normalized_definition like '%max(updated_at%'
       or v_normalized_definition like '%limit 1%' then
      raise exception using
        errcode = 'P0001',
        message = 'P9_CORE_PROGRESS_RESOLVER_RECENCY_HEURISTIC_FORBIDDEN',
        detail = v_signature;
    end if;
  end loop;

  v_proc_oid := pg_catalog.to_regprocedure(
    'public.p9_resolve_qualification_progress_internal(uuid,uuid,uuid)'
  );
  v_normalized_definition := lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(v_proc_oid),
      '\s+',
      ' ',
      'g'
    )
  );

  if v_normalized_definition not like '%commercial_opportunity_qualification_facts_current%'
     or v_normalized_definition not like '%qualification_facts_present_completion_unproven%'
     or v_normalized_definition like '%v_progress := ''completed''%' then
    raise exception using
      errcode = 'P0001',
      message = 'P9_QUALIFICATION_PROGRESS_DEFINITION_MISMATCH';
  end if;

  v_proc_oid := pg_catalog.to_regprocedure(
    'public.p9_resolve_quote_progress_internal(uuid,uuid,uuid)'
  );
  v_normalized_definition := lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(v_proc_oid),
      '\s+',
      ' ',
      'g'
    )
  );

  if v_normalized_definition not like '%current_quote_id%'
     or v_normalized_definition not like '%current_quote_version_id%'
     or v_normalized_definition not like '%sent_at is not null%'
     or v_normalized_definition not like '%superseded%'
     or v_normalized_definition not like '%quote_sent_without_current_proposal%'
     or v_normalized_definition not like '%quote_current_proposal_cycle_unanchored%'
     or v_normalized_definition not like '%quote_artifact_cycle_unanchored%' then
    raise exception using
      errcode = 'P0001',
      message = 'P9_QUOTE_PROGRESS_DEFINITION_MISMATCH';
  end if;

  v_proc_oid := pg_catalog.to_regprocedure(
    'public.p9_resolve_post_sale_progress_internal(uuid,uuid,uuid)'
  );
  v_normalized_definition := lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(v_proc_oid),
      '\s+',
      ' ',
      'g'
    )
  );

  if v_normalized_definition not like '%conclusion%'
     or v_normalized_definition not like '%post_sale_reopen%'
     or v_normalized_definition not like '%event_row.lifecycle_cycle = v_opportunity.lifecycle_cycle%'
     or v_normalized_definition not like '%post_sale_reopened_in_progress%'
     or v_normalized_definition not like '%post_sale_concluded_without_canonical_event%' then
    raise exception using
      errcode = 'P0001',
      message = 'P9_POST_SALE_PROGRESS_DEFINITION_MISMATCH';
  end if;
end;
$postconditions$;

commit;

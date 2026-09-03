begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('zion:p9:commercial-action-readiness:v1', 0)
);

-- ============================================================================
-- P9 / Bloco 3 / Etapa 3.5-G
-- Commercial Action Readiness v1.
--
-- Frozen contract:
-- - readiness is action-specific, never a universal opportunity_ready boolean;
-- - this layer answers commercial/business prerequisites only. Route-local
--   authorization, artifact integrity, delivery/provider and calendar-capacity
--   guards remain owned by their canonical action surfaces;
-- - explicit current Checklist + explicit current Progress + lifecycle_cycle are
--   authoritative. latest/max/fuzzy fallbacks are forbidden;
-- - Applicability remains distinct from Progress and Assessment;
-- - optional items do not block an action unless that action explicitly targets
--   the optional item itself;
-- - target-action progress is not treated as a prerequisite when the action is
--   the operation that advances/completes that target (contract/conclusion);
-- - unresolved authority fails closed as needs_resolution; contradictions are
--   conflict; unmet known prerequisites are blocked;
-- - the result is read-time/deterministic and is NOT persisted as another source
--   of truth. Integration routes will compose this business decision with their
--   existing action-specific technical/authorization guards in Etapa 3.5-H.
-- ============================================================================

do $preflight$
declare
  v_table text;
begin
  foreach v_table in array array[
    'commercial_opportunities',
    'commercial_opportunity_checklist_versions',
    'commercial_opportunity_checklist_items',
    'commercial_opportunity_checklist_current',
    'commercial_opportunity_checklist_progress_versions',
    'commercial_opportunity_checklist_progress_items',
    'commercial_opportunity_checklist_progress_current'
  ] loop
    if pg_catalog.to_regclass('public.' || v_table) is null then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format('precondition failed: public.%s is missing', v_table);
    end if;
  end loop;

  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: extensions.digest(bytea,text) is missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.p9_resolve_commercial_action_readiness_internal(uuid,uuid,uuid,text)'
     ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: commercial action readiness function already exists';
  end if;
end;
$preflight$;

create function public.p9_resolve_commercial_action_readiness_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_action_key text
)
returns table (
  action_key text,
  readiness_state text,
  reason_code text,
  blocking_items jsonb,
  readiness_basis jsonb,
  authority_fingerprint text,
  resolver_key text,
  resolver_version integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp, public, extensions
set row_security = off
as $function$
declare
  v_action_key text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_action_key, '')), ''));
  v_opportunity public.commercial_opportunities%rowtype;
  v_checklist_current public.commercial_opportunity_checklist_current%rowtype;
  v_checklist_version public.commercial_opportunity_checklist_versions%rowtype;
  v_progress_current public.commercial_opportunity_checklist_progress_current%rowtype;
  v_progress_version public.commercial_opportunity_checklist_progress_versions%rowtype;

  v_target_key text;
  v_target_item public.commercial_opportunity_checklist_items%rowtype;
  v_target_progress public.commercial_opportunity_checklist_progress_items%rowtype;
  v_quote_item public.commercial_opportunity_checklist_items%rowtype;
  v_quote_progress public.commercial_opportunity_checklist_progress_items%rowtype;
  v_visit_item public.commercial_opportunity_checklist_items%rowtype;
  v_visit_progress public.commercial_opportunity_checklist_progress_items%rowtype;

  v_state text := 'needs_resolution';
  v_reason text := 'action_readiness_unresolved';
  v_blockers jsonb := '[]'::jsonb;
  v_details jsonb := '{}'::jsonb;
  v_basis jsonb;
  v_fingerprint text;
  v_count integer := 0;
begin
  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or v_action_key is null then
    raise exception using
      errcode = '22023',
      message = 'P9_ACTION_READINESS_ARGUMENTS_REQUIRED';
  end if;

  if v_action_key not in (
    'send_quote',
    'schedule_technical_visit',
    'create_contract',
    'conclude_opportunity'
  ) then
    raise exception using
      errcode = '22023',
      message = 'P9_ACTION_READINESS_ACTION_KEY_INVALID';
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
      message = 'P9_ACTION_READINESS_OPPORTUNITY_NOT_FOUND';
  end if;

  <<resolution>>
  begin
    select current_row.*
    into v_checklist_current
    from public.commercial_opportunity_checklist_current current_row
    where current_row.organization_id = p_organization_id
      and current_row.store_id = p_store_id
      and current_row.commercial_opportunity_id = p_commercial_opportunity_id;

    if not found then
      v_state := 'needs_resolution';
      v_reason := 'action_readiness_current_checklist_missing';
      exit resolution;
    end if;

    select version_row.*
    into v_checklist_version
    from public.commercial_opportunity_checklist_versions version_row
    where version_row.id = v_checklist_current.current_checklist_version_id
      and version_row.organization_id = p_organization_id
      and version_row.store_id = p_store_id
      and version_row.commercial_opportunity_id = p_commercial_opportunity_id;

    if not found then
      v_state := 'conflict';
      v_reason := 'action_readiness_current_checklist_pointer_conflict';
      exit resolution;
    end if;

    select current_row.*
    into v_progress_current
    from public.commercial_opportunity_checklist_progress_current current_row
    where current_row.organization_id = p_organization_id
      and current_row.store_id = p_store_id
      and current_row.commercial_opportunity_id = p_commercial_opportunity_id;

    if not found then
      v_state := 'needs_resolution';
      v_reason := 'action_readiness_current_progress_missing';
      exit resolution;
    end if;

    select version_row.*
    into v_progress_version
    from public.commercial_opportunity_checklist_progress_versions version_row
    where version_row.id = v_progress_current.current_progress_version_id
      and version_row.organization_id = p_organization_id
      and version_row.store_id = p_store_id
      and version_row.commercial_opportunity_id = p_commercial_opportunity_id;

    if not found
       or v_progress_version.checklist_version_id is distinct from v_checklist_version.id
       or v_progress_version.lifecycle_cycle is distinct from v_opportunity.lifecycle_cycle then
      v_state := 'conflict';
      v_reason := 'action_readiness_current_projection_conflict';
      exit resolution;
    end if;

    v_target_key := case v_action_key
      when 'send_quote' then 'quote'
      when 'schedule_technical_visit' then 'technical_visit'
      when 'create_contract' then 'contract'
      when 'conclude_opportunity' then 'post_sale'
    end;

    select item_row.*
    into v_target_item
    from public.commercial_opportunity_checklist_items item_row
    where item_row.organization_id = p_organization_id
      and item_row.store_id = p_store_id
      and item_row.commercial_opportunity_id = p_commercial_opportunity_id
      and item_row.checklist_version_id = v_checklist_version.id
      and item_row.item_key = v_target_key;

    if not found then
      v_state := 'needs_resolution';
      v_reason := 'action_readiness_target_gate_missing';
      v_details := pg_catalog.jsonb_build_object('target_item_key', v_target_key);
      exit resolution;
    end if;

    v_details := pg_catalog.jsonb_build_object(
      'target_item_key', v_target_item.item_key,
      'target_item_kind', v_target_item.item_kind,
      'target_applicability_state', v_target_item.applicability_state
    );

    if v_target_item.applicability_state = 'conflict' then
      v_state := 'conflict';
      v_reason := v_action_key || '_target_applicability_conflict';
      v_blockers := pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'item_key', v_target_item.item_key,
          'applicability_state', v_target_item.applicability_state,
          'reason_code', v_target_item.reason_code
        )
      );
      exit resolution;
    elsif v_target_item.applicability_state = 'needs_resolution' then
      v_state := 'needs_resolution';
      v_reason := v_action_key || '_target_applicability_needs_resolution';
      v_blockers := pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'item_key', v_target_item.item_key,
          'applicability_state', v_target_item.applicability_state,
          'reason_code', v_target_item.reason_code
        )
      );
      exit resolution;
    elsif v_target_item.applicability_state = 'not_applicable' then
      v_state := 'blocked';
      v_reason := v_action_key || '_not_applicable';
      v_blockers := pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'item_key', v_target_item.item_key,
          'applicability_state', v_target_item.applicability_state,
          'reason_code', v_target_item.reason_code
        )
      );
      exit resolution;
    end if;

    if v_target_item.applicability_state not in ('required', 'optional') then
      v_state := 'conflict';
      v_reason := 'action_readiness_target_applicability_invalid';
      exit resolution;
    end if;

    if v_action_key in ('send_quote', 'schedule_technical_visit') then
      select progress_item.*
      into v_target_progress
      from public.commercial_opportunity_checklist_progress_items progress_item
      where progress_item.organization_id = p_organization_id
        and progress_item.store_id = p_store_id
        and progress_item.commercial_opportunity_id = p_commercial_opportunity_id
        and progress_item.progress_version_id = v_progress_version.id
        and progress_item.checklist_version_id = v_checklist_version.id
        and progress_item.checklist_item_id = v_target_item.id;

      if not found then
        v_state := 'conflict';
        v_reason := 'action_readiness_target_progress_missing';
        exit resolution;
      end if;

      v_details := v_details || pg_catalog.jsonb_build_object(
        'target_assessment_state', v_target_progress.assessment_state,
        'target_progress_state', v_target_progress.progress_state,
        'target_progress_resolver_key', v_target_progress.resolver_key,
        'target_progress_authority_fingerprint', v_target_progress.authority_fingerprint
      );

      if v_target_progress.assessment_state = 'conflict' then
        v_state := 'conflict';
        v_reason := v_action_key || '_target_progress_conflict';
        v_blockers := pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'item_key', v_target_item.item_key,
            'assessment_state', v_target_progress.assessment_state,
            'reason_code', v_target_progress.reason_code
          )
        );
        exit resolution;
      elsif v_target_progress.assessment_state = 'needs_resolution' then
        v_state := 'needs_resolution';
        v_reason := v_action_key || '_target_progress_needs_resolution';
        v_blockers := pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'item_key', v_target_item.item_key,
            'assessment_state', v_target_progress.assessment_state,
            'reason_code', v_target_progress.reason_code
          )
        );
        exit resolution;
      elsif v_target_progress.assessment_state <> 'determined' then
        v_state := 'conflict';
        v_reason := 'action_readiness_target_assessment_invalid';
        exit resolution;
      end if;
    end if;

    if v_action_key = 'send_quote' then
      if v_target_progress.progress_state = 'not_started' then
        v_state := 'blocked';
        v_reason := 'send_quote_quote_not_prepared';
        v_blockers := pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'item_key', 'quote',
            'progress_state', v_target_progress.progress_state,
            'reason_code', v_target_progress.reason_code
          )
        );
      elsif v_target_progress.progress_state = 'in_progress' then
        v_state := 'ready';
        v_reason := 'send_quote_commercial_prerequisites_ready';
      elsif v_target_progress.progress_state = 'completed' then
        v_state := 'blocked';
        v_reason := 'send_quote_quote_already_sent';
        v_blockers := pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'item_key', 'quote',
            'progress_state', v_target_progress.progress_state,
            'reason_code', v_target_progress.reason_code
          )
        );
      else
        v_state := 'conflict';
        v_reason := 'send_quote_quote_progress_invalid';
      end if;
      exit resolution;
    end if;

    if v_action_key = 'schedule_technical_visit' then
      if v_target_progress.progress_state = 'not_started' then
        v_state := 'ready';
        v_reason := 'schedule_technical_visit_commercial_prerequisites_ready';
      elsif v_target_progress.progress_state = 'in_progress' then
        v_state := 'blocked';
        v_reason := 'schedule_technical_visit_already_active';
        v_blockers := pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'item_key', 'technical_visit',
            'progress_state', v_target_progress.progress_state,
            'reason_code', v_target_progress.reason_code
          )
        );
      elsif v_target_progress.progress_state = 'completed' then
        v_state := 'blocked';
        v_reason := 'schedule_technical_visit_already_completed';
        v_blockers := pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'item_key', 'technical_visit',
            'progress_state', v_target_progress.progress_state,
            'reason_code', v_target_progress.reason_code
          )
        );
      else
        v_state := 'conflict';
        v_reason := 'schedule_technical_visit_progress_invalid';
      end if;
      exit resolution;
    end if;

    if v_action_key = 'create_contract' then
      -- Contract creation itself starts/advances the contract target, so target
      -- Progress is not a prerequisite. The canonical preconditions are the
      -- current sent proposal and a required technical visit, when applicable.
      select item_row.*
      into v_quote_item
      from public.commercial_opportunity_checklist_items item_row
      where item_row.organization_id = p_organization_id
        and item_row.store_id = p_store_id
        and item_row.commercial_opportunity_id = p_commercial_opportunity_id
        and item_row.checklist_version_id = v_checklist_version.id
        and item_row.item_key = 'quote';

      if not found then
        v_state := 'needs_resolution';
        v_reason := 'create_contract_quote_gate_missing';
        exit resolution;
      end if;

      if v_quote_item.applicability_state = 'conflict' then
        v_state := 'conflict';
        v_reason := 'create_contract_quote_applicability_conflict';
        exit resolution;
      elsif v_quote_item.applicability_state = 'needs_resolution' then
        v_state := 'needs_resolution';
        v_reason := 'create_contract_quote_applicability_needs_resolution';
        exit resolution;
      elsif v_quote_item.applicability_state = 'not_applicable' then
        v_state := 'conflict';
        v_reason := 'create_contract_quote_not_applicable_conflict';
        exit resolution;
      elsif v_quote_item.applicability_state not in ('required', 'optional') then
        v_state := 'conflict';
        v_reason := 'create_contract_quote_applicability_invalid';
        exit resolution;
      end if;

      select progress_item.*
      into v_quote_progress
      from public.commercial_opportunity_checklist_progress_items progress_item
      where progress_item.organization_id = p_organization_id
        and progress_item.store_id = p_store_id
        and progress_item.commercial_opportunity_id = p_commercial_opportunity_id
        and progress_item.progress_version_id = v_progress_version.id
        and progress_item.checklist_version_id = v_checklist_version.id
        and progress_item.checklist_item_id = v_quote_item.id;

      if not found then
        v_state := 'conflict';
        v_reason := 'create_contract_quote_progress_missing';
        exit resolution;
      elsif v_quote_progress.assessment_state = 'conflict' then
        v_state := 'conflict';
        v_reason := 'create_contract_quote_progress_conflict';
        exit resolution;
      elsif v_quote_progress.assessment_state = 'needs_resolution' then
        v_state := 'needs_resolution';
        v_reason := 'create_contract_quote_progress_needs_resolution';
        exit resolution;
      elsif v_quote_progress.assessment_state <> 'determined' then
        v_state := 'conflict';
        v_reason := 'create_contract_quote_assessment_invalid';
        exit resolution;
      elsif v_quote_progress.progress_state <> 'completed' then
        v_state := 'blocked';
        v_reason := 'create_contract_quote_not_completed';
        v_blockers := pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'item_key', 'quote',
            'progress_state', v_quote_progress.progress_state,
            'reason_code', v_quote_progress.reason_code
          )
        );
        exit resolution;
      end if;

      select item_row.*
      into v_visit_item
      from public.commercial_opportunity_checklist_items item_row
      where item_row.organization_id = p_organization_id
        and item_row.store_id = p_store_id
        and item_row.commercial_opportunity_id = p_commercial_opportunity_id
        and item_row.checklist_version_id = v_checklist_version.id
        and item_row.item_key = 'technical_visit';

      if found then
        if v_visit_item.applicability_state = 'conflict' then
          v_state := 'conflict';
          v_reason := 'create_contract_technical_visit_applicability_conflict';
          exit resolution;
        elsif v_visit_item.applicability_state = 'needs_resolution' then
          v_state := 'needs_resolution';
          v_reason := 'create_contract_technical_visit_applicability_needs_resolution';
          exit resolution;
        elsif v_visit_item.applicability_state = 'required' then
          select progress_item.*
          into v_visit_progress
          from public.commercial_opportunity_checklist_progress_items progress_item
          where progress_item.organization_id = p_organization_id
            and progress_item.store_id = p_store_id
            and progress_item.commercial_opportunity_id = p_commercial_opportunity_id
            and progress_item.progress_version_id = v_progress_version.id
            and progress_item.checklist_version_id = v_checklist_version.id
            and progress_item.checklist_item_id = v_visit_item.id;

          if not found then
            v_state := 'conflict';
            v_reason := 'create_contract_technical_visit_progress_missing';
            exit resolution;
          elsif v_visit_progress.assessment_state = 'conflict' then
            v_state := 'conflict';
            v_reason := 'create_contract_technical_visit_progress_conflict';
            exit resolution;
          elsif v_visit_progress.assessment_state = 'needs_resolution' then
            v_state := 'needs_resolution';
            v_reason := 'create_contract_technical_visit_progress_needs_resolution';
            exit resolution;
          elsif v_visit_progress.assessment_state <> 'determined' then
            v_state := 'conflict';
            v_reason := 'create_contract_technical_visit_assessment_invalid';
            exit resolution;
          elsif v_visit_progress.progress_state <> 'completed' then
            v_state := 'blocked';
            v_reason := 'create_contract_technical_visit_not_completed';
            v_blockers := pg_catalog.jsonb_build_array(
              pg_catalog.jsonb_build_object(
                'item_key', 'technical_visit',
                'progress_state', v_visit_progress.progress_state,
                'reason_code', v_visit_progress.reason_code
              )
            );
            exit resolution;
          end if;
        end if;
      end if;

      v_state := 'ready';
      v_reason := 'create_contract_commercial_prerequisites_ready';
      v_details := v_details || pg_catalog.jsonb_build_object(
        'quote_progress_state', v_quote_progress.progress_state,
        'technical_visit_applicability_state', v_visit_item.applicability_state,
        'technical_visit_progress_state', v_visit_progress.progress_state
      );
      exit resolution;
    end if;

    if v_action_key = 'conclude_opportunity' then
      if v_opportunity.stage <> 'pos_venda' then
        v_state := 'blocked';
        v_reason := 'conclude_opportunity_stage_not_pos_venda';
        v_details := v_details || pg_catalog.jsonb_build_object(
          'opportunity_stage', v_opportunity.stage
        );
        exit resolution;
      end if;

      -- Applicability uncertainty/conflict outside the post-sale target prevents
      -- a safe conclusion because it is not known whether a prerequisite applies.
      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'item_key', item_row.item_key,
            'item_kind', item_row.item_kind,
            'applicability_state', item_row.applicability_state,
            'reason_code', item_row.reason_code
          )
          order by item_row.item_key
        ),
        '[]'::jsonb
      )
      into v_blockers
      from public.commercial_opportunity_checklist_items item_row
      where item_row.organization_id = p_organization_id
        and item_row.store_id = p_store_id
        and item_row.commercial_opportunity_id = p_commercial_opportunity_id
        and item_row.checklist_version_id = v_checklist_version.id
        and item_row.item_key <> 'post_sale'
        and item_row.applicability_state = 'conflict';

      if pg_catalog.jsonb_array_length(v_blockers) > 0 then
        v_state := 'conflict';
        v_reason := 'conclude_opportunity_prerequisite_applicability_conflict';
        exit resolution;
      end if;

      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'item_key', item_row.item_key,
            'item_kind', item_row.item_kind,
            'applicability_state', item_row.applicability_state,
            'reason_code', item_row.reason_code
          )
          order by item_row.item_key
        ),
        '[]'::jsonb
      )
      into v_blockers
      from public.commercial_opportunity_checklist_items item_row
      where item_row.organization_id = p_organization_id
        and item_row.store_id = p_store_id
        and item_row.commercial_opportunity_id = p_commercial_opportunity_id
        and item_row.checklist_version_id = v_checklist_version.id
        and item_row.item_key <> 'post_sale'
        and item_row.applicability_state = 'needs_resolution';

      if pg_catalog.jsonb_array_length(v_blockers) > 0 then
        v_state := 'needs_resolution';
        v_reason := 'conclude_opportunity_prerequisite_applicability_needs_resolution';
        exit resolution;
      end if;

      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'item_key', item_row.item_key,
            'assessment_state', progress_item.assessment_state,
            'progress_state', progress_item.progress_state,
            'reason_code', progress_item.reason_code
          )
          order by item_row.item_key
        ),
        '[]'::jsonb
      )
      into v_blockers
      from public.commercial_opportunity_checklist_items item_row
      left join public.commercial_opportunity_checklist_progress_items progress_item
        on progress_item.organization_id = item_row.organization_id
       and progress_item.store_id = item_row.store_id
       and progress_item.commercial_opportunity_id = item_row.commercial_opportunity_id
       and progress_item.progress_version_id = v_progress_version.id
       and progress_item.checklist_version_id = item_row.checklist_version_id
       and progress_item.checklist_item_id = item_row.id
      where item_row.organization_id = p_organization_id
        and item_row.store_id = p_store_id
        and item_row.commercial_opportunity_id = p_commercial_opportunity_id
        and item_row.checklist_version_id = v_checklist_version.id
        and item_row.item_key <> 'post_sale'
        and item_row.applicability_state = 'required'
        and (
          progress_item.id is null
          or progress_item.assessment_state = 'conflict'
        );

      if pg_catalog.jsonb_array_length(v_blockers) > 0 then
        v_state := 'conflict';
        v_reason := 'conclude_opportunity_prerequisite_progress_conflict';
        exit resolution;
      end if;

      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'item_key', item_row.item_key,
            'assessment_state', progress_item.assessment_state,
            'progress_state', progress_item.progress_state,
            'reason_code', progress_item.reason_code
          )
          order by item_row.item_key
        ),
        '[]'::jsonb
      )
      into v_blockers
      from public.commercial_opportunity_checklist_items item_row
      join public.commercial_opportunity_checklist_progress_items progress_item
        on progress_item.organization_id = item_row.organization_id
       and progress_item.store_id = item_row.store_id
       and progress_item.commercial_opportunity_id = item_row.commercial_opportunity_id
       and progress_item.progress_version_id = v_progress_version.id
       and progress_item.checklist_version_id = item_row.checklist_version_id
       and progress_item.checklist_item_id = item_row.id
      where item_row.organization_id = p_organization_id
        and item_row.store_id = p_store_id
        and item_row.commercial_opportunity_id = p_commercial_opportunity_id
        and item_row.checklist_version_id = v_checklist_version.id
        and item_row.item_key <> 'post_sale'
        and item_row.applicability_state = 'required'
        and progress_item.assessment_state = 'needs_resolution';

      if pg_catalog.jsonb_array_length(v_blockers) > 0 then
        v_state := 'needs_resolution';
        v_reason := 'conclude_opportunity_prerequisite_progress_needs_resolution';
        exit resolution;
      end if;

      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'item_key', item_row.item_key,
            'assessment_state', progress_item.assessment_state,
            'progress_state', progress_item.progress_state,
            'reason_code', progress_item.reason_code
          )
          order by item_row.item_key
        ),
        '[]'::jsonb
      )
      into v_blockers
      from public.commercial_opportunity_checklist_items item_row
      join public.commercial_opportunity_checklist_progress_items progress_item
        on progress_item.organization_id = item_row.organization_id
       and progress_item.store_id = item_row.store_id
       and progress_item.commercial_opportunity_id = item_row.commercial_opportunity_id
       and progress_item.progress_version_id = v_progress_version.id
       and progress_item.checklist_version_id = item_row.checklist_version_id
       and progress_item.checklist_item_id = item_row.id
      where item_row.organization_id = p_organization_id
        and item_row.store_id = p_store_id
        and item_row.commercial_opportunity_id = p_commercial_opportunity_id
        and item_row.checklist_version_id = v_checklist_version.id
        and item_row.item_key <> 'post_sale'
        and item_row.applicability_state = 'required'
        and progress_item.assessment_state = 'determined'
        and progress_item.progress_state <> 'completed';

      if pg_catalog.jsonb_array_length(v_blockers) > 0 then
        v_state := 'blocked';
        v_reason := 'conclude_opportunity_required_prerequisites_incomplete';
        exit resolution;
      end if;

      v_state := 'ready';
      v_reason := 'conclude_opportunity_commercial_prerequisites_ready';
      v_blockers := '[]'::jsonb;
      exit resolution;
    end if;
  end resolution;

  v_basis := pg_catalog.jsonb_build_object(
    'schema', 'p9_commercial_action_readiness_v1',
    'resolver_key', 'commercial_action_readiness',
    'resolver_version', 1,
    'action_key', v_action_key,
    'readiness_state', v_state,
    'reason_code', v_reason,
    'organization_id', p_organization_id,
    'store_id', p_store_id,
    'commercial_opportunity_id', p_commercial_opportunity_id,
    'opportunity_stage', v_opportunity.stage,
    'lifecycle_cycle', v_opportunity.lifecycle_cycle,
    'current_checklist_version_id', v_checklist_current.current_checklist_version_id,
    'current_progress_version_id', v_progress_current.current_progress_version_id,
    'progress_checklist_version_id', v_progress_version.checklist_version_id,
    'progress_lifecycle_cycle', v_progress_version.lifecycle_cycle,
    'details', coalesce(v_details, '{}'::jsonb),
    'blocking_items', coalesce(v_blockers, '[]'::jsonb),
    'scope', 'commercial_prerequisites',
    'route_local_guards_evaluated', false
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
    v_action_key,
    v_state,
    v_reason,
    coalesce(v_blockers, '[]'::jsonb),
    v_basis,
    v_fingerprint,
    'commercial_action_readiness'::text,
    1;
end;
$function$;

alter function public.p9_resolve_commercial_action_readiness_internal(
  uuid, uuid, uuid, text
) owner to postgres;

revoke all on function public.p9_resolve_commercial_action_readiness_internal(
  uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;

comment on function public.p9_resolve_commercial_action_readiness_internal(
  uuid, uuid, uuid, text
) is
  'Internal P9 action-specific commercial readiness resolver. Uses explicit current Checklist/Progress and lifecycle scope, never a universal ready boolean. Technical/authorization guards remain owned by action routes and are composed later in Etapa 3.5-H.';

-- ============================================================================
-- Postconditions.
-- ============================================================================

do $postconditions$
declare
  v_function oid := pg_catalog.to_regprocedure(
    'public.p9_resolve_commercial_action_readiness_internal(uuid,uuid,uuid,text)'
  );
  v_definition text;
  v_owner text;
  v_security_definer boolean;
  v_volatility "char";
  v_config text[];
begin
  if v_function is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: action readiness resolver missing';
  end if;

  select
    pg_catalog.pg_get_userbyid(proc_row.proowner),
    proc_row.prosecdef,
    proc_row.provolatile,
    proc_row.proconfig,
    pg_catalog.pg_get_functiondef(proc_row.oid)
  into
    v_owner,
    v_security_definer,
    v_volatility,
    v_config,
    v_definition
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_function;

  if v_owner is distinct from 'postgres'
     or not coalesce(v_security_definer, false)
     or v_volatility is distinct from 's'
     or not ('search_path=pg_catalog, pg_temp, public, extensions' = any(coalesce(v_config, array[]::text[])))
     or not ('row_security=off' = any(coalesce(v_config, array[]::text[]))) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: action readiness resolver hardening mismatch';
  end if;

  if pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: internal action readiness resolver leaked EXECUTE';
  end if;

  if pg_catalog.strpos(v_definition, 'send_quote') = 0
     or pg_catalog.strpos(v_definition, 'schedule_technical_visit') = 0
     or pg_catalog.strpos(v_definition, 'create_contract') = 0
     or pg_catalog.strpos(v_definition, 'conclude_opportunity') = 0
     or pg_catalog.strpos(v_definition, 'commercial_opportunity_checklist_current') = 0
     or pg_catalog.strpos(v_definition, 'commercial_opportunity_checklist_progress_current') = 0
     or pg_catalog.strpos(v_definition, 'lifecycle_cycle') = 0
     or pg_catalog.strpos(v_definition, 'route_local_guards_evaluated') = 0
     or v_definition ~* 'order[[:space:]]+by[[:space:]]+(created_at|updated_at|version_number)[[:space:]]+desc'
     or v_definition ~* 'max[[:space:]]*\([[:space:]]*version_number'
     or v_definition ~* 'limit[[:space:]]+1' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: action readiness resolver contract mismatch';
  end if;
end;
$postconditions$;

commit;

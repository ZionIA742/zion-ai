-- ZION P9 / Bloco 6 / Etapa 6.4
-- Corrective migration: fail closed when the canonical Profile/checklist chain
-- required to resolve quote_kind is absent.
--
-- The previous attempt of this SAME migration filename failed before COMMIT
-- because a textual pg_get_functiondef patch anchor did not match.
-- This version replaces the function explicitly and is safe to use because
-- 20260922174500 was not successfully applied.

begin;

do $preflight$
begin
  if pg_catalog.to_regclass('public.sales_quotes') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_profile_current') is null
     or pg_catalog.to_regclass('public.commercial_opportunity_checklist_current') is null
     or pg_catalog.to_regprocedure(
          'public.p9_read_sales_quote_kind_authority_internal(uuid,uuid,uuid)'
        ) is null
     or pg_catalog.to_regprocedure(
          'public.resolve_sales_quote_kind_for_generation_by_system(uuid,uuid,uuid,uuid)'
        ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_6_4_QUOTE_KIND_FAIL_CLOSED_PREFLIGHT_REQUIRED_AUTHORITY_MISSING';
  end if;
end;
$preflight$;


create or replace function public.resolve_sales_quote_kind_for_generation_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_sales_quote_id uuid
)
returns table (
  resolution_state text,
  quote_kind text,
  reason_code text,
  blocking_items jsonb,
  authority_fingerprint text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
set row_security = off
as $function$
declare
  v_request_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', '')
  );
  v_quote public.sales_quotes%rowtype;
  v_profile_current_version_id uuid;
  v_checklist_current_version_id uuid;
  v_authority record;
  v_state text := 'ready';
  v_kind text := 'definitive';
  v_reason text := 'definitive_quote_ready';
  v_blocking jsonb := '[]'::jsonb;
  v_basis jsonb;
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'sales quote kind resolver is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_sales_quote_id is null then
    raise exception using
      errcode = '22023',
      message = 'SALES_QUOTE_KIND_RESOLUTION_ARGUMENTS_REQUIRED';
  end if;

  select quote_row.*
    into v_quote
    from public.sales_quotes quote_row
   where quote_row.id = p_sales_quote_id
     and quote_row.organization_id = p_organization_id
     and quote_row.store_id = p_store_id
     and quote_row.commercial_opportunity_id = p_commercial_opportunity_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'SALES_QUOTE_KIND_QUOTE_NOT_FOUND';
  end if;

  -- Missing Profile current is unresolved authority. It must never be
  -- interpreted as "technical visit not required".
  select profile_current.current_profile_version_id
    into v_profile_current_version_id
    from public.commercial_opportunity_profile_current profile_current
   where profile_current.organization_id = p_organization_id
     and profile_current.store_id = p_store_id
     and profile_current.commercial_opportunity_id = p_commercial_opportunity_id;

  if not found or v_profile_current_version_id is null then
    v_state := 'needs_resolution';
    v_kind := null;
    v_reason := 'quote_kind_profile_current_missing';
    v_blocking := jsonb_build_array(jsonb_build_object(
      'authority', 'commercial_opportunity_profile_current',
      'commercial_opportunity_id', p_commercial_opportunity_id
    ));

    v_basis := jsonb_build_object(
      'schema', 'p9_sales_quote_kind_generation_resolution_v2',
      'sales_quote_id', p_sales_quote_id,
      'commercial_opportunity_id', p_commercial_opportunity_id,
      'profile_current_version_id', null,
      'checklist_current_version_id', null,
      'resolution_state', v_state,
      'quote_kind', v_kind,
      'reason_code', v_reason,
      'blocking_items', v_blocking
    );

    return query
    select
      v_state,
      v_kind,
      v_reason,
      v_blocking,
      encode(digest(convert_to(v_basis::text, 'UTF8'), 'sha256'), 'hex');
    return;
  end if;

  -- Missing checklist current is also unresolved. A Profile may exist while
  -- checklist materialization/reconciliation has not happened yet; absence of
  -- the checklist is not evidence that definitive is allowed.
  select checklist_current.current_checklist_version_id
    into v_checklist_current_version_id
    from public.commercial_opportunity_checklist_current checklist_current
   where checklist_current.organization_id = p_organization_id
     and checklist_current.store_id = p_store_id
     and checklist_current.commercial_opportunity_id = p_commercial_opportunity_id;

  if not found or v_checklist_current_version_id is null then
    v_state := 'needs_resolution';
    v_kind := null;
    v_reason := 'quote_kind_checklist_current_missing';
    v_blocking := jsonb_build_array(jsonb_build_object(
      'authority', 'commercial_opportunity_checklist_current',
      'commercial_opportunity_id', p_commercial_opportunity_id,
      'profile_current_version_id', v_profile_current_version_id
    ));

    v_basis := jsonb_build_object(
      'schema', 'p9_sales_quote_kind_generation_resolution_v2',
      'sales_quote_id', p_sales_quote_id,
      'commercial_opportunity_id', p_commercial_opportunity_id,
      'profile_current_version_id', v_profile_current_version_id,
      'checklist_current_version_id', null,
      'resolution_state', v_state,
      'quote_kind', v_kind,
      'reason_code', v_reason,
      'blocking_items', v_blocking
    );

    return query
    select
      v_state,
      v_kind,
      v_reason,
      v_blocking,
      encode(digest(convert_to(v_basis::text, 'UTF8'), 'sha256'), 'hex');
    return;
  end if;

  -- Only after the prerequisite authority chain exists do we interpret the
  -- technical-visit/checklist authority shared with send readiness.
  select *
    into v_authority
    from public.p9_read_sales_quote_kind_authority_internal(
      p_organization_id,
      p_store_id,
      p_commercial_opportunity_id
    );

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'SALES_QUOTE_KIND_AUTHORITY_EMPTY';
  end if;

  if v_authority.authority_state in ('conflict', 'needs_resolution') then
    v_state := v_authority.authority_state;
    v_kind := null;

    if v_authority.technical_visit_applicability_state in (
      'conflict',
      'needs_resolution'
    ) then
      v_reason :=
        'quote_kind_technical_visit_applicability_'
        || v_authority.technical_visit_applicability_state;

      v_blocking := jsonb_build_array(jsonb_build_object(
        'item_key', 'technical_visit',
        'applicability_state', v_authority.technical_visit_applicability_state,
        'reason_code', v_authority.technical_visit_reason_code
      ));
    elsif v_authority.technical_visit_progress_state is null then
      v_reason := 'quote_kind_technical_visit_progress_missing';

      v_blocking := jsonb_build_array(jsonb_build_object(
        'item_key', 'technical_visit',
        'applicability_state', 'required'
      ));
    else
      v_reason :=
        'quote_kind_technical_visit_progress_'
        || coalesce(
          v_authority.technical_visit_assessment_state,
          'needs_resolution'
        );

      v_blocking := jsonb_build_array(jsonb_build_object(
        'item_key', 'technical_visit',
        'assessment_state', v_authority.technical_visit_assessment_state,
        'reason_code', v_authority.technical_visit_progress_reason_code
      ));
    end if;

  elsif v_authority.technical_visit_applicability_state = 'required'
        and v_authority.technical_visit_progress_state is distinct from 'completed' then
    if v_authority.preliminary_allowed then
      v_kind := 'preliminary';
      v_reason := 'preliminary_quote_before_visit_allowed';
    else
      v_state := 'blocked';
      v_kind := null;
      v_reason := 'preliminary_quote_before_visit_not_allowed';
      v_blocking := jsonb_build_array(jsonb_build_object(
        'item_key', 'preliminary_quote_before_technical_visit',
        'technical_visit_progress_state',
          v_authority.technical_visit_progress_state,
        'technical_visit_assessment_state',
          v_authority.technical_visit_assessment_state
      ));
    end if;
  end if;

  v_basis := jsonb_build_object(
    'schema', 'p9_sales_quote_kind_generation_resolution_v2',
    'sales_quote_id', p_sales_quote_id,
    'commercial_opportunity_id', p_commercial_opportunity_id,
    'profile_current_version_id', v_profile_current_version_id,
    'checklist_current_version_id', v_checklist_current_version_id,
    'authority_fingerprint', v_authority.authority_fingerprint,
    'resolution_state', v_state,
    'quote_kind', v_kind,
    'reason_code', v_reason,
    'blocking_items', v_blocking
  );

  return query
  select
    v_state,
    v_kind,
    v_reason,
    v_blocking,
    encode(digest(convert_to(v_basis::text, 'UTF8'), 'sha256'), 'hex');
end;
$function$;


alter function public.resolve_sales_quote_kind_for_generation_by_system(
  uuid, uuid, uuid, uuid
) owner to postgres;

revoke all on function public.resolve_sales_quote_kind_for_generation_by_system(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.resolve_sales_quote_kind_for_generation_by_system(
  uuid, uuid, uuid, uuid
) to service_role;


comment on function public.resolve_sales_quote_kind_for_generation_by_system(
  uuid, uuid, uuid, uuid
) is
  'Resolves preliminary/definitive quote kind fail-closed. Missing current Profile/checklist is needs_resolution and can never be interpreted as definitive readiness.';


do $postconditions$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.resolve_sales_quote_kind_for_generation_by_system(uuid,uuid,uuid,uuid)'::regprocedure
  ) into v_definition;

  if v_definition not like '%commercial_opportunity_profile_current%'
     or v_definition not like '%quote_kind_profile_current_missing%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: resolver does not fail closed on missing Profile current';
  end if;

  if v_definition not like '%commercial_opportunity_checklist_current%'
     or v_definition not like '%quote_kind_checklist_current_missing%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: resolver does not fail closed on missing checklist current';
  end if;

  if position(
       'quote_kind_profile_current_missing' in v_definition
     ) > position(
       'p9_read_sales_quote_kind_authority_internal' in v_definition
     )
     or position(
       'quote_kind_checklist_current_missing' in v_definition
     ) > position(
       'p9_read_sales_quote_kind_authority_internal' in v_definition
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: missing-authority checks occur after quote-kind authority interpretation';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.resolve_sales_quote_kind_for_generation_by_system(uuid,uuid,uuid,uuid)',
       'execute'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: authenticated can execute quote-kind generation resolver';
  end if;

  if not has_function_privilege(
       'service_role',
       'public.resolve_sales_quote_kind_for_generation_by_system(uuid,uuid,uuid,uuid)',
       'execute'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: service_role lost quote-kind generation resolver execution';
  end if;
end;
$postconditions$;

commit;

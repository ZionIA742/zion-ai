-- ZION P19-A / Bloco 3 / Pacote E
-- Quote-kind readiness:
-- 1. pure read of canonical current pointers;
-- 2. no embedded materialization;
-- 3. service-role-only internal RPC.

begin;

create or replace function public.read_quote_kind_send_readiness_scoped(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_sales_quote_version_id uuid
)
returns table (
  readiness_state text,
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
  v_version public.sales_quote_versions;
  v_technical_item public.commercial_opportunity_checklist_items;
  v_technical public.commercial_opportunity_checklist_progress_items;
  v_preliminary_policy public.commercial_opportunity_checklist_items;
  v_basis jsonb;
  v_state text := 'ready';
  v_reason text := 'quote_kind_send_ready';
  v_blocking jsonb := '[]'::jsonb;
begin
  select *
  into v_version
  from public.sales_quote_versions version_row
  where version_row.id = p_sales_quote_version_id
    and version_row.organization_id = p_organization_id
    and version_row.store_id = p_store_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'QUOTE_KIND_VERSION_NOT_FOUND';
  end if;

  if coalesce(v_version.quote_kind, '') not in ('preliminary', 'definitive') then
    return query select 'ready'::text, 'legacy_quote_kind_send'::text, '[]'::jsonb, null::text;
    return;
  end if;

  select item_row.*
  into v_technical_item
  from public.commercial_opportunity_checklist_current current_row
  join public.commercial_opportunity_checklist_items item_row
    on item_row.checklist_version_id = current_row.current_checklist_version_id
   and item_row.organization_id = current_row.organization_id
   and item_row.store_id = current_row.store_id
   and item_row.commercial_opportunity_id = current_row.commercial_opportunity_id
  where current_row.organization_id = p_organization_id
    and current_row.store_id = p_store_id
    and current_row.commercial_opportunity_id = p_commercial_opportunity_id
    and item_row.item_key = 'technical_visit';

  if found and v_technical_item.applicability_state in ('conflict', 'needs_resolution') then
    v_state := v_technical_item.applicability_state;
    v_reason := 'quote_kind_technical_visit_applicability_' || v_technical_item.applicability_state;
    v_blocking := jsonb_build_array(
      jsonb_build_object(
        'item_key', 'technical_visit',
        'applicability_state', v_technical_item.applicability_state,
        'reason_code', v_technical_item.reason_code
      )
    );
  elsif found and v_technical_item.applicability_state = 'required' then
    select progress_row.*
    into v_technical
    from public.commercial_opportunity_checklist_progress_current current_row
    join public.commercial_opportunity_checklist_progress_items progress_row
      on progress_row.progress_version_id = current_row.current_progress_version_id
     and progress_row.organization_id = current_row.organization_id
     and progress_row.store_id = current_row.store_id
     and progress_row.commercial_opportunity_id = current_row.commercial_opportunity_id
    where current_row.organization_id = p_organization_id
      and current_row.store_id = p_store_id
      and current_row.commercial_opportunity_id = p_commercial_opportunity_id
      and progress_row.checklist_item_id = v_technical_item.id;

    if not found then
      v_state := 'needs_resolution';
      v_reason := 'quote_kind_technical_visit_progress_missing';
      v_blocking := jsonb_build_array(
        jsonb_build_object(
          'item_key', 'technical_visit',
          'applicability_state', 'required'
        )
      );
    elsif v_technical.assessment_state in ('conflict', 'needs_resolution') then
      v_state := v_technical.assessment_state;
      v_reason := 'quote_kind_technical_visit_progress_' || v_technical.assessment_state;
      v_blocking := jsonb_build_array(
        jsonb_build_object(
          'item_key', 'technical_visit',
          'assessment_state', v_technical.assessment_state,
          'reason_code', v_technical.reason_code
        )
      );
    elsif v_technical.progress_state is distinct from 'completed' then
      if v_version.quote_kind = 'definitive' then
        v_state := 'blocked';
        v_reason := 'definitive_quote_requires_completed_technical_visit';
        v_blocking := jsonb_build_array(
          jsonb_build_object(
            'item_key', 'technical_visit',
            'progress_state', v_technical.progress_state,
            'assessment_state', v_technical.assessment_state
          )
        );
      else
        select item_row.*
        into v_preliminary_policy
        from public.commercial_opportunity_checklist_current current_row
        join public.commercial_opportunity_checklist_items item_row
          on item_row.checklist_version_id = current_row.current_checklist_version_id
         and item_row.organization_id = current_row.organization_id
         and item_row.store_id = current_row.store_id
         and item_row.commercial_opportunity_id = current_row.commercial_opportunity_id
        where current_row.organization_id = p_organization_id
          and current_row.store_id = p_store_id
          and current_row.commercial_opportunity_id = p_commercial_opportunity_id
          and item_row.item_key = 'preliminary_quote_before_technical_visit'
          and item_row.applicability_state = 'optional';

        if not found then
          v_state := 'blocked';
          v_reason := 'preliminary_quote_before_visit_not_allowed';
          v_blocking := jsonb_build_array(
            jsonb_build_object(
              'item_key', 'preliminary_quote_before_technical_visit',
              'technical_visit_progress_state', v_technical.progress_state,
              'technical_visit_assessment_state', v_technical.assessment_state
            )
          );
        else
          v_reason := 'preliminary_quote_before_visit_allowed';
        end if;
      end if;
    end if;
  end if;

  v_basis := jsonb_build_object(
    'schema', 'p19a_quote_kind_send_readiness_v1',
    'sales_quote_version_id', p_sales_quote_version_id,
    'quote_kind', v_version.quote_kind,
    'technical_visit_applicability_state', v_technical_item.applicability_state,
    'technical_visit_progress_state', v_technical.progress_state,
    'preliminary_before_visit_policy_item_id', v_preliminary_policy.id,
    'readiness_state', v_state,
    'reason_code', v_reason,
    'blocking_items', v_blocking
  );

  return query
  select v_state, v_reason, v_blocking, encode(digest(convert_to(v_basis::text, 'UTF8'), 'sha256'), 'hex');
end;
$function$;

alter function public.read_quote_kind_send_readiness_scoped(
  uuid, uuid, uuid, uuid
) owner to postgres;

revoke all on function public.read_quote_kind_send_readiness_scoped(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.read_quote_kind_send_readiness_scoped(
  uuid, uuid, uuid, uuid
) to service_role;

commit;

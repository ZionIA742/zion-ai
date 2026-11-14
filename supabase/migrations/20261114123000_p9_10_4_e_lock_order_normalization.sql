begin;

/*
 * Normalize the two remaining lock-order edges without introducing another
 * authority.  Recovery authority is acquired first; the existing writer then
 * acquires its opportunity/task lock while the conversation and lease locks
 * remain held by this transaction.
 */

do $stage_lock_order$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.apply_commercial_opportunity_stage_transition_internal(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text,uuid)'
  );
  v_definition text;
  v_guard constant text := $guard$
  if v_source like 'ai_sales%'
     and v_opportunity.primary_conversation_id is not null then
    perform public.p9_10_4_d_assert_recovery_write_authority(
      p_organization_id,
      p_store_id,
      v_opportunity.primary_conversation_id
    );
  end if;
$guard$;
  v_preflight constant text := $preflight$
  if v_source like 'ai_sales%' then
    select opportunity_row.primary_conversation_id
      into v_recovery_conversation_id
      from public.commercial_opportunities opportunity_row
     where opportunity_row.id = p_commercial_opportunity_id
       and opportunity_row.organization_id = p_organization_id
       and opportunity_row.store_id = p_store_id;
    if v_recovery_conversation_id is not null then
      perform public.p9_10_4_d_assert_recovery_write_authority(
        p_organization_id,
        p_store_id,
        v_recovery_conversation_id
      );
    end if;
  end if;
$preflight$;
  v_select constant text := $select$
  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
  for update;
$select$;
begin
  if v_oid is null then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_STAGE_AUTHORITY_MISSING';
  end if;
  select pg_catalog.pg_get_functiondef(v_oid) into v_definition;
  if pg_catalog.strpos(v_definition, v_guard) = 0 then
    raise exception using errcode = 'P0001', message = 'P9_10_4_E_STAGE_LOCK_ORDER_DRIFT';
  end if;
  if pg_catalog.strpos(v_definition, v_select) = 0 then
    raise exception using errcode = 'P0001', message = 'P9_10_4_E_STAGE_LOCK_ANCHOR_MISSING';
  end if;

  v_definition := pg_catalog.replace(v_definition, v_guard, '');
  v_definition := pg_catalog.replace(
    v_definition,
    '  v_opportunity public.commercial_opportunities;',
    '  v_opportunity public.commercial_opportunities;' || E'\n' ||
    '  v_recovery_conversation_id uuid;'
  );
  v_definition := pg_catalog.replace(v_definition, v_select, v_preflight || E'\n' || v_select);
  v_definition := pg_catalog.replace(
    v_definition,
    '  if v_opportunity.organization_id is distinct from p_organization_id',
    '  if v_source like ''ai_sales%''\n' ||
    '     and v_opportunity.primary_conversation_id is distinct from v_recovery_conversation_id then\n' ||
    '    if v_opportunity.primary_conversation_id is not null or v_recovery_conversation_id is not null then\n' ||
    '      raise exception using errcode = ''P0001'', message = ''P9_10_4_D_RECOVERY_SCOPE_CHANGED'';\n' ||
    '    end if;\n' ||
    '  end if;\n\n' ||
    '  if v_opportunity.organization_id is distinct from p_organization_id'
  );
  execute v_definition;
end;
$stage_lock_order$;

do $quote_lock_order$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.issue_quote_preparation_task_authorization_by_system(uuid,uuid,uuid,uuid)'
  );
  v_definition text;
  v_old_guard constant text := $old_guard$
    IF (v_task.task_payload ->> 'p9_recovery_response_set_id') IS NOT NULL THEN
        PERFORM public.p9_10_4_d_assert_recovery_set_authority(
            (v_task.task_payload ->> 'p9_recovery_response_set_id')::uuid,
            p_organization_id,
            p_store_id,
            v_task.related_conversation_id,
            p_request_message_id
        );
    END IF;

$old_guard$;
  v_anchor constant text := $anchor$
    SELECT *
    INTO v_task
    FROM public.store_assistant_operational_tasks
$anchor$;
  v_preflight constant text := $preflight$
    SELECT *
    INTO v_recovery_task
    FROM public.store_assistant_operational_tasks
    WHERE id = p_task_id
      AND organization_id = p_organization_id
      AND store_id = p_store_id;
    v_recovery_set_id := coalesce(
        nullif(v_recovery_task.task_payload ->> 'p9_recovery_response_set_id', '')::uuid,
        nullif(v_recovery_task.task_payload -> 'quote_preparation' ->> 'p9_recovery_response_set_id', '')::uuid
    );
    IF v_recovery_set_id IS NOT NULL THEN
        PERFORM public.p9_10_4_d_assert_recovery_set_authority(
            v_recovery_set_id,
            p_organization_id,
            p_store_id,
            v_recovery_task.related_conversation_id,
            p_request_message_id
        );
    END IF;

$preflight$;
begin
  if v_oid is null then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_QUOTE_AUTHORITY_MISSING';
  end if;
  select pg_catalog.pg_get_functiondef(v_oid) into v_definition;
  if pg_catalog.strpos(v_definition, v_old_guard) = 0 then
    raise exception using errcode = 'P0001', message = 'P9_10_4_E_QUOTE_LOCK_ORDER_DRIFT';
  end if;
  if pg_catalog.strpos(v_definition, v_anchor) = 0 then
    raise exception using errcode = 'P0001', message = 'P9_10_4_E_QUOTE_LOCK_ANCHOR_MISSING';
  end if;

  v_definition := pg_catalog.replace(v_definition, v_old_guard, '');
  v_definition := pg_catalog.replace(
    v_definition,
    '    v_task public.store_assistant_operational_tasks%ROWTYPE;',
    '    v_task public.store_assistant_operational_tasks%ROWTYPE;' || E'\n' ||
    '    v_recovery_task public.store_assistant_operational_tasks%ROWTYPE;' || E'\n' ||
    '    v_recovery_set_id uuid;'
  );
  v_definition := pg_catalog.replace(v_definition, v_anchor, v_preflight || v_anchor);
  execute v_definition;
end;
$quote_lock_order$;

commit;

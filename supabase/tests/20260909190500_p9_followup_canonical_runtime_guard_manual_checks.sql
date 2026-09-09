begin;

do $checks$
declare
  v_count integer;
  v_source text;
begin
  select count(*)
  into v_count
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname =
      'record_commercial_opportunity_followup_attempt_by_system'
    and pg_catalog.pg_get_function_identity_arguments(proc_row.oid) =
      'p_organization_id uuid, p_store_id uuid, p_commercial_opportunity_id uuid, p_operation_key text';

  if v_count <> 1 then
    raise exception
      'P9 5.2 CHECK FAILED: system attempt writer missing';
  end if;

  select count(*)
  into v_count
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname =
      'resolve_commercial_opportunity_followup_by_system'
    and pg_catalog.pg_get_function_identity_arguments(proc_row.oid) =
      'p_organization_id uuid, p_store_id uuid, p_commercial_opportunity_id uuid, p_operation_key text';

  if v_count <> 1 then
    raise exception
      'P9 5.2 CHECK FAILED: system resolve writer missing';
  end if;

  select count(*)
  into v_count
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname =
      'ai_sales_execute_canonical_followup_queue'
    and pg_catalog.pg_get_function_identity_arguments(proc_row.oid) =
      'p_action_queue_id uuid'
    and proc_row.prosecdef = true;

  if v_count <> 1 then
    raise exception
      'P9 5.2 CHECK FAILED: canonical runtime helper missing or not SECURITY DEFINER';
  end if;

  select proc_row.prosrc
  into v_source
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname =
      'ai_sales_execute_canonical_followup_queue'
    and pg_catalog.pg_get_function_identity_arguments(proc_row.oid) =
      'p_action_queue_id uuid';

  if position('commercial_opportunity_id' in v_source) = 0
     or position('followup_id' in v_source) = 0
     or position('followup_cycle' in v_source) = 0
     or position('followup_operation_key' in v_source) = 0 then
    raise exception
      'P9 5.2 CHECK FAILED: canonical identity is incomplete';
  end if;

  if position('followup_noncanonical_queue' in v_source) = 0 then
    raise exception
      'P9 5.2 CHECK FAILED: legacy/noncanonical queue is not fail-closed';
  end if;

  if position('message_row.created_at > v_queue.enqueued_at' in v_source) = 0
     or position('followup_stale_customer_replied' in v_source) = 0 then
    raise exception
      'P9 5.2 CHECK FAILED: customer reply stale guard missing';
  end if;

  if position(
       'resolve_commercial_opportunity_followup_by_system'
       in v_source
     ) = 0 then
    raise exception
      'P9 5.2 CHECK FAILED: stale customer return does not resolve followup cycle';
  end if;

  if position(
       'record_commercial_opportunity_followup_attempt_by_system'
       in v_source
     ) = 0 then
    raise exception
      'P9 5.2 CHECK FAILED: successful runtime does not record system attempt';
  end if;

  select proc_row.prosrc
  into v_source
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname = 'ai_sales_action_execute'
    and pg_catalog.pg_get_function_identity_arguments(proc_row.oid) =
      'p_action_queue_id uuid';

  if position(
       'ai_sales_execute_canonical_followup_queue'
       in v_source
     ) = 0 then
    raise exception
      'P9 5.2 CHECK FAILED: action executor does not route followups through canonical runtime';
  end if;

  if position(
       'v_queue.next_action in (''followup_offer'', ''followup_visit'')'
       in v_source
     ) = 0 then
    raise exception
      'P9 5.2 CHECK FAILED: canonical routing is not scoped to followup actions';
  end if;
end;
$checks$;

do $terminal_guard_checks$
declare
  v_source text;
begin
  select proc_row.prosrc
  into v_source
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname =
      'ai_sales_execute_canonical_followup_queue'
    and pg_catalog.pg_get_function_identity_arguments(proc_row.oid) =
      'p_action_queue_id uuid';

  if position(
       'followup_stale_opportunity_terminal'
       in v_source
     ) = 0 then
    raise exception
      'P9 5.2 CHECK FAILED: terminal opportunity stale guard missing';
  end if;

  if position('''perdido''' in v_source) = 0
     or position('''concluido_sem_mais_acoes''' in v_source) = 0 then
    raise exception
      'P9 5.2 CHECK FAILED: canonical terminal stages missing';
  end if;

  if position(
       'system_resolve_terminal_opportunity:'
       in v_source
     ) = 0
     or position(
       'resolve_commercial_opportunity_followup_by_system'
       in v_source
     ) = 0 then
    raise exception
      'P9 5.2 CHECK FAILED: terminal opportunity does not close followup cycle';
  end if;

  if position(
       'followup_stale_opportunity_terminal'
       in v_source
     ) <= position(
       'followup_stale_cycle_not_active'
       in v_source
     )
     or position(
       'followup_stale_opportunity_terminal'
       in v_source
     ) <= position(
       'followup_stale_action_changed'
       in v_source
     ) then
    raise exception
      'P9 5.2 CHECK FAILED: terminal guard executes before exact active followup validation';
  end if;
end;
$terminal_guard_checks$;

select
  'PASS'::text as p9_5_2_canonical_runtime_contract;

rollback;
begin;

/*
 * A recovery row may be updated by a generic writer.  The old value is part
 * of the authority decision: clearing or replacing the recovery locator must
 * not turn a protected row into an ordinary row.
 */
create or replace function public.p9_10_4_d_guard_recovery_row_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_row jsonb := to_jsonb(new);
  v_old_row jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_set_id uuid := nullif(v_row ->> 'p9_recovery_response_set_id', '')::uuid;
  v_old_set_id uuid := nullif(v_old_row ->> 'p9_recovery_response_set_id', '')::uuid;
  v_organization_id uuid := nullif(v_row ->> 'organization_id', '')::uuid;
  v_store_id uuid := nullif(v_row ->> 'store_id', '')::uuid;
  v_conversation_id uuid := coalesce(
    nullif(v_row ->> 'conversation_id', ''),
    nullif(v_row ->> 'related_conversation_id', '')
  )::uuid;
  v_anchor_id uuid := nullif(v_row ->> 'anchor_message_id', '')::uuid;
begin
  if v_set_id is null and tg_table_name = 'ai_run_queue'
     and v_row -> 'input' ->> 'type' = 'sales_ai_post_materialization_recovery' then
    v_set_id := nullif(v_row -> 'input' ->> 'responseSetId', '')::uuid;
    v_anchor_id := nullif(v_row -> 'input' ->> 'anchorMessageId', '')::uuid;
  end if;
  if v_old_set_id is null and tg_table_name = 'ai_run_queue'
     and v_old_row -> 'input' ->> 'type' = 'sales_ai_post_materialization_recovery' then
    v_old_set_id := nullif(v_old_row -> 'input' ->> 'responseSetId', '')::uuid;
  end if;
  if v_set_id is null then
    v_set_id := coalesce(
      nullif(v_row -> 'task_payload' ->> 'p9_recovery_response_set_id', '')::uuid,
      nullif(v_row -> 'payload' ->> 'p9_recovery_response_set_id', '')::uuid,
      nullif(v_row -> 'context' ->> 'p9_recovery_response_set_id', '')::uuid,
      nullif(v_row -> 'metadata' ->> 'p9_recovery_response_set_id', '')::uuid
    );
  end if;
  if v_old_set_id is null then
    v_old_set_id := coalesce(
      nullif(v_old_row -> 'task_payload' ->> 'p9_recovery_response_set_id', '')::uuid,
      nullif(v_old_row -> 'payload' ->> 'p9_recovery_response_set_id', '')::uuid,
      nullif(v_old_row -> 'context' ->> 'p9_recovery_response_set_id', '')::uuid,
      nullif(v_old_row -> 'metadata' ->> 'p9_recovery_response_set_id', '')::uuid
    );
  end if;

  if tg_op = 'UPDATE' and v_old_set_id is not null
     and v_set_id is distinct from v_old_set_id then
    raise exception using errcode = 'P0001',
      message = 'P9_10_4_D_RECOVERY_AUTHORITY_MUTATION';
  end if;
  if v_set_id is null then
    return new;
  end if;
  perform public.p9_10_4_d_assert_recovery_set_authority(
    v_set_id, v_organization_id, v_store_id, v_conversation_id, v_anchor_id
  );
  return new;
end;
$function$;

alter function public.p9_10_4_d_guard_recovery_row_write() owner to postgres;

/*
 * Recovery callers pass the response-set locator explicitly.  The locator is
 * not authority by itself: this overload locks and validates the canonical
 * set before delegating to the existing four-argument P19-A authority in the
 * same transaction.  The four-argument signature remains the normal P19-A
 * path and therefore does not acquire a recovery fence.
 */
create or replace function public.issue_quote_preparation_task_authorization_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_task_id uuid,
  p_request_message_id uuid,
  p_recovery_response_set_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
set row_security = off
as $function$
declare
  v_task public.store_assistant_operational_tasks%rowtype;
begin
  if public.zion_resolve_request_role_internal() is distinct from 'service_role' then
    raise exception 'P19A_QUOTE_PREP_AUTH_SYSTEM_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_recovery_response_set_id is null then
    raise exception 'P9_10_4_D_RECOVERY_RESPONSE_SET_REQUIRED' using errcode = '22023';
  end if;

  select * into v_task
    from public.store_assistant_operational_tasks
   where id = p_task_id
     and organization_id = p_organization_id
     and store_id = p_store_id;
  if not found then
    raise exception 'P19A_QUOTE_PREP_AUTH_TASK_NOT_FOUND';
  end if;

  perform public.p9_10_4_d_assert_recovery_set_authority(
    p_recovery_response_set_id,
    p_organization_id,
    p_store_id,
    v_task.related_conversation_id,
    p_request_message_id
  );

  return public.issue_quote_preparation_task_authorization_by_system(
    p_organization_id,
    p_store_id,
    p_task_id,
    p_request_message_id
  );
end;
$function$;

alter function public.issue_quote_preparation_task_authorization_by_system(
  uuid, uuid, uuid, uuid, uuid
) owner to postgres;
revoke all on function public.issue_quote_preparation_task_authorization_by_system(
  uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.issue_quote_preparation_task_authorization_by_system(
  uuid, uuid, uuid, uuid, uuid
) to service_role;

commit;

begin;

create or replace function public.ai_sales_action_queue_ready_now(
  p_action_queue_id uuid
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp', 'public'
set row_security to 'off'
as $function$
declare
  v_queue public.ai_sales_action_queue;
  v_followup public.commercial_opportunity_followups;
  v_opportunity public.commercial_opportunities;
begin
  select queue_row.*
  into v_queue
  from public.ai_sales_action_queue queue_row
  where queue_row.id = p_action_queue_id;

  if not found then
    return false;
  end if;

  if v_queue.next_action not in ('followup_offer', 'followup_visit') then
    return true;
  end if;

  /*
   * Filas antigas, não canônicas ou com identidade inconsistente devem
   * continuar elegíveis para que o executor canônico possa consumi-las
   * como stale/invalid. Apenas um follow-up canônico, íntegro, ativo e
   * realmente futuro deve permanecer aguardando.
   */
  if pg_catalog.jsonb_typeof(v_queue.payload) is distinct from 'object'
     or nullif(v_queue.payload ->> 'commercial_opportunity_id', '') is null
     or nullif(v_queue.payload ->> 'followup_id', '') is null
     or nullif(v_queue.payload ->> 'followup_cycle', '') is null
     or nullif(v_queue.payload ->> 'followup_operation_key', '') is null
     or nullif(v_queue.payload ->> 'conversation_id', '') is null
     or nullif(v_queue.payload ->> 'organization_id', '') is null
     or nullif(v_queue.payload ->> 'store_id', '') is null then
    return true;
  end if;

  if (v_queue.payload ->> 'organization_id')
       is distinct from v_queue.organization_id::text
     or (v_queue.payload ->> 'store_id')
       is distinct from v_queue.store_id::text
     or (v_queue.payload ->> 'conversation_id')
       is distinct from v_queue.conversation_id::text then
    return true;
  end if;

  select followup_row.*
  into v_followup
  from public.commercial_opportunity_followups followup_row
  where followup_row.id::text =
          v_queue.payload ->> 'followup_id'
    and followup_row.organization_id = v_queue.organization_id
    and followup_row.store_id = v_queue.store_id
    and followup_row.commercial_opportunity_id::text =
          v_queue.payload ->> 'commercial_opportunity_id'
    and followup_row.cycle::text =
          v_queue.payload ->> 'followup_cycle';

  if not found then
    return true;
  end if;

  if v_followup.status <> 'active' then
    return true;
  end if;

  if v_followup.next_action is distinct from v_queue.next_action then
    return true;
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = v_followup.commercial_opportunity_id
    and opportunity_row.organization_id = v_queue.organization_id
    and opportunity_row.store_id = v_queue.store_id;

  if not found then
    return true;
  end if;

  if v_opportunity.primary_conversation_id
       is distinct from v_queue.conversation_id then
    return true;
  end if;

  /*
   * Mesmo antes do horário programado, condições que tornaram a fila
   * stale precisam ser processadas imediatamente para fechar o ciclo
   * sem qualquer envio.
   */
  if v_opportunity.stage in (
    'perdido',
    'concluido_sem_mais_acoes'
  ) then
    return true;
  end if;

  if exists (
    select 1
    from public.messages message_row
    where message_row.conversation_id = v_queue.conversation_id
      and message_row.sender = 'user'
      and message_row.direction = 'incoming'
      and message_row.deleted_at is null
      and message_row.created_at > v_queue.enqueued_at
  ) then
    return true;
  end if;

  /*
   * A autoridade temporal é o ciclo canônico de follow-up.
   * next_action_at não é duplicado na queue.
   */
  if v_followup.next_action_at > pg_catalog.clock_timestamp() then
    return false;
  end if;

  return true;
end;
$function$;

revoke all
on function public.ai_sales_action_queue_ready_now(uuid)
from public, anon, authenticated;

grant execute
on function public.ai_sales_action_queue_ready_now(uuid)
to service_role;


create or replace function public.reconcile_terminal_followup_pending_queues()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp', 'public'
set row_security to 'off'
as $function$
begin
  /*
   * A queue pertence a um ciclo que terminou sem ter sido executado.
   * Não há mensagem nem attempt para registrar.
   *
   * Só reconciliamos filas sem qualquer ai_sales_action_run.
   * Se já existe run, o mecanismo normal de reconciliação do worker
   * continua sendo a autoridade.
   */
  update public.ai_sales_action_queue queue_row
  set
    processed_at = pg_catalog.clock_timestamp(),
    processing_error = null,
    payload =
      queue_row.payload
      || pg_catalog.jsonb_build_object(
        'followup_queue_reconciled',
        true,
        'followup_queue_reconciled_reason',
        'followup_cycle_' || new.status,
        'followup_queue_reconciled_at',
        pg_catalog.clock_timestamp()
      )
  where queue_row.organization_id = new.organization_id
    and queue_row.store_id = new.store_id
    and queue_row.next_action in ('followup_offer', 'followup_visit')
    and queue_row.processed_at is null
    and queue_row.processing_error is null
    and queue_row.payload ->> 'commercial_opportunity_id' =
          new.commercial_opportunity_id::text
    and queue_row.payload ->> 'followup_id' = new.id::text
    and queue_row.payload ->> 'followup_cycle' = new.cycle::text
    and not exists (
      select 1
      from public.ai_sales_action_runs run_row
      where run_row.action_queue_id = queue_row.id
    );

  return new;
end;
$function$;

revoke all
on function public.reconcile_terminal_followup_pending_queues()
from public, anon, authenticated;

drop trigger if exists
  p9_reconcile_terminal_followup_pending_queues
on public.commercial_opportunity_followups;

create trigger p9_reconcile_terminal_followup_pending_queues
after update of status
on public.commercial_opportunity_followups
for each row
when (
  old.status = 'active'
  and new.status <> 'active'
)
execute function public.reconcile_terminal_followup_pending_queues();


/*
 * Reconcilia filas canônicas antigas que já ficaram penduradas em ciclos
 * terminais antes da criação do trigger.
 */
update public.ai_sales_action_queue queue_row
set
  processed_at = pg_catalog.clock_timestamp(),
  processing_error = null,
  payload =
    queue_row.payload
    || pg_catalog.jsonb_build_object(
      'followup_queue_reconciled',
      true,
      'followup_queue_reconciled_reason',
      'preexisting_terminal_followup_cycle',
      'followup_queue_reconciled_at',
      pg_catalog.clock_timestamp()
    )
from public.commercial_opportunity_followups followup_row
where queue_row.organization_id = followup_row.organization_id
  and queue_row.store_id = followup_row.store_id
  and queue_row.next_action in ('followup_offer', 'followup_visit')
  and queue_row.processed_at is null
  and queue_row.processing_error is null
  and followup_row.status <> 'active'
  and queue_row.payload ->> 'commercial_opportunity_id' =
        followup_row.commercial_opportunity_id::text
  and queue_row.payload ->> 'followup_id' = followup_row.id::text
  and queue_row.payload ->> 'followup_cycle' = followup_row.cycle::text
  and not exists (
    select 1
    from public.ai_sales_action_runs run_row
    where run_row.action_queue_id = queue_row.id
  );


create or replace function public.process_next_ai_sales_action_queue(
  p_organization_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_queue record;
  v_run_id uuid;
  v_output jsonb;
  v_result text;
  v_started_at timestamptz;
  v_finished_at timestamptz;
  v_mode record;
  v_guard record;
begin
  if p_organization_id is null then
    raise exception 'p_organization_id não pode ser null';
  end if;

  -- Auto-reconciliação: run succeeded com fila pendente
  update public.ai_sales_action_queue q
  set processed_at = coalesce(r.finished_at, now()),
      processing_error = null
  from public.ai_sales_action_runs r
  where q.organization_id = p_organization_id
    and q.id = r.action_queue_id
    and q.processed_at is null
    and q.processing_error is null
    and r.status = 'succeeded';

  -- Auto-reconciliação: run failed com fila pendente
  update public.ai_sales_action_queue q
  set processed_at = null,
      processing_error =
        coalesce(nullif(r.error_text, ''), 'existing failed run')
  from public.ai_sales_action_runs r
  where q.organization_id = p_organization_id
    and q.id = r.action_queue_id
    and q.processed_at is null
    and q.processing_error is null
    and r.status = 'failed';

  select
    q.id as queue_id,
    q.organization_id,
    q.store_id,
    q.conversation_id,
    q.ai_run_id,
    q.next_action,
    q.action_key,
    q.payload,
    q.enqueued_at
  into v_queue
  from public.ai_sales_action_queue q
  where q.organization_id = p_organization_id
    and q.processed_at is null
    and q.processing_error is null
    and not exists (
      select 1
      from public.ai_sales_action_runs r
      where r.action_queue_id = q.id
    )
    and public.ai_sales_action_queue_ready_now(q.id)
  order by q.enqueued_at asc
  limit 1
  for update skip locked;

  if v_queue.queue_id is null then
    return;
  end if;

  select *
  into v_mode
  from public.ai_sales_action_execution_mode();

  select *
  into v_guard
  from public.ai_sales_real_execution_guard();

  v_started_at := now();

  insert into public.ai_sales_action_runs (
    action_queue_id,
    organization_id,
    store_id,
    conversation_id,
    ai_run_id,
    next_action,
    status,
    input,
    started_at,
    execution_mode_snapshot,
    safe_mode_enabled_snapshot,
    real_execution_enabled_snapshot,
    guard_status_snapshot
  )
  values (
    v_queue.queue_id,
    v_queue.organization_id,
    v_queue.store_id,
    v_queue.conversation_id,
    v_queue.ai_run_id,
    v_queue.next_action,
    'running',
    v_queue.payload,
    v_started_at,
    v_mode.execution_mode,
    v_mode.safe_mode_enabled,
    v_mode.real_execution_enabled,
    v_guard.guard_status
  )
  returning id into v_run_id;

  begin
    v_output := public.ai_sales_action_execute(v_queue.queue_id);

    v_result :=
      coalesce(
        v_output ->> 'result',
        v_output -> 'dispatch' ->> 'status',
        ''
      );

    v_finished_at := now();

    /*
     * Defesa de corrida: se o horário canônico mudou entre seleção e
     * execução, desfazemos o run criado nesta mesma transação e mantemos
     * a queue pendente.
     */
    if v_result = 'followup_not_due_yet' then
      delete from public.ai_sales_action_runs
      where id = v_run_id;

      return;
    end if;

    if public.ai_sales_action_result_requires_failure(v_output) then
      update public.ai_sales_action_runs
      set status = 'failed',
          output = v_output,
          error_text = v_result,
          finished_at = v_finished_at
      where id = v_run_id;

      update public.ai_sales_action_queue
      set processed_at = null,
          processing_error = v_result
      where id = v_queue.queue_id;

      return;
    end if;

    update public.ai_sales_action_runs
    set status = 'succeeded',
        output = v_output,
        error_text = null,
        finished_at = v_finished_at
    where id = v_run_id;

    update public.ai_sales_action_queue
    set processed_at = v_finished_at,
        processing_error = null
    where id = v_queue.queue_id;

  exception
    when others then
      v_finished_at := now();

      update public.ai_sales_action_runs
      set status = 'failed',
          error_text = left(sqlerrm, 2000),
          finished_at = v_finished_at
      where id = v_run_id;

      update public.ai_sales_action_queue
      set processed_at = null,
          processing_error = left(sqlerrm, 2000)
      where id = v_queue.queue_id;

      return;
  end;

  return;
end;
$function$;


create or replace function public.zion_ai_sales_worker_tick(
  p_organization_id uuid,
  p_iterations integer default 10
)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_i integer := 0;
  v_processed integer := 0;
  v_has_more_work boolean;
begin
  if p_organization_id is null then
    raise exception 'p_organization_id não pode ser null';
  end if;

  if p_iterations is null then
    raise exception 'p_iterations não pode ser null';
  end if;

  if p_iterations <= 0 then
    raise exception 'p_iterations deve ser maior que zero';
  end if;

  if p_iterations > 100 then
    raise exception 'p_iterations não pode ser maior que 100';
  end if;

  while v_i < p_iterations loop
    select exists (
      select 1
      from public.ai_sales_action_queue q
      where q.organization_id = p_organization_id
        and q.processed_at is null
        and q.processing_error is null
        and not exists (
          select 1
          from public.ai_sales_action_runs r
          where r.action_queue_id = q.id
        )
        and public.ai_sales_action_queue_ready_now(q.id)
    )
    into v_has_more_work;

    if coalesce(v_has_more_work, false) = false then
      exit;
    end if;

    perform public.process_next_ai_sales_action_queue(
      p_organization_id
    );

    v_i := v_i + 1;
    v_processed := v_processed + 1;
  end loop;

  return json_build_object(
    'worker',
    'zion_ai_sales_worker_tick',
    'organization_id',
    p_organization_id,
    'iterations',
    v_i,
    'processed_attempts',
    v_processed,
    'stopped_early',
    v_i < p_iterations,
    'timestamp',
    now()
  );
end;
$function$;


create or replace function public.ai_sales_execute_canonical_followup_queue(
  p_action_queue_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp', 'public'
set row_security to 'off'
as $function$
declare
  v_queue public.ai_sales_action_queue;
  v_opportunity_id uuid;
  v_followup_id uuid;
  v_followup_cycle integer;
  v_followup_operation_key text;
  v_opportunity public.commercial_opportunities;
  v_followup public.commercial_opportunity_followups;
  v_attempt public.commercial_opportunity_followups;
  v_resolved public.commercial_opportunity_followups;
  v_customer_message_at timestamptz;
  v_existing_message_id uuid;
  v_message public.messages;
  v_content text;
  v_source text;
  v_precheck record;
  v_reply_guard record;
begin
  select queue_row.*
  into v_queue
  from public.ai_sales_action_queue queue_row
  where queue_row.id = p_action_queue_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'status', 'action_queue_not_found',
      'result', 'action_queue_not_found',
      'action_queue_id', p_action_queue_id
    );
  end if;

  if v_queue.next_action not in ('followup_offer', 'followup_visit') then
    return jsonb_build_object(
      'ok', false,
      'status', 'unsupported_next_action',
      'result', 'unsupported_next_action',
      'action_queue_id', v_queue.id,
      'next_action', v_queue.next_action
    );
  end if;

  select *
  into v_precheck
  from public.ai_sales_real_execution_precheck(
    v_queue.next_action
  );

  if coalesce(v_precheck.can_run_real, false) = false then
    return jsonb_build_object(
      'ok', false,
      'status', v_precheck.precheck_status,
      'result', v_precheck.precheck_status,
      'action_queue_id', v_queue.id,
      'next_action', v_queue.next_action,
      'guard_status', v_precheck.guard_status,
      'handler_key', v_precheck.handler_key
    );
  end if;

  if pg_catalog.jsonb_typeof(v_queue.payload) is distinct from 'object'
     or nullif(v_queue.payload ->> 'commercial_opportunity_id', '') is null
     or nullif(v_queue.payload ->> 'followup_id', '') is null
     or nullif(v_queue.payload ->> 'followup_cycle', '') is null
     or nullif(v_queue.payload ->> 'followup_operation_key', '') is null
     or nullif(v_queue.payload ->> 'conversation_id', '') is null
     or nullif(v_queue.payload ->> 'organization_id', '') is null
     or nullif(v_queue.payload ->> 'store_id', '') is null then
    return jsonb_build_object(
      'ok', false,
      'status', 'followup_noncanonical_queue',
      'result', 'followup_noncanonical_queue',
      'action_queue_id', v_queue.id,
      'next_action', v_queue.next_action
    );
  end if;

  begin
    v_opportunity_id :=
      (v_queue.payload ->> 'commercial_opportunity_id')::uuid;
    v_followup_id :=
      (v_queue.payload ->> 'followup_id')::uuid;
    v_followup_cycle :=
      (v_queue.payload ->> 'followup_cycle')::integer;
  exception
    when invalid_text_representation then
      return jsonb_build_object(
        'ok', false,
        'status', 'followup_invalid_identity_payload',
        'result', 'followup_invalid_identity_payload',
        'action_queue_id', v_queue.id
      );
  end;

  v_followup_operation_key :=
    public.normalize_commercial_opportunity_followup_operation_key(
      v_queue.payload ->> 'followup_operation_key'
    );

  if (v_queue.payload ->> 'organization_id')
        is distinct from v_queue.organization_id::text
     or (v_queue.payload ->> 'store_id')
        is distinct from v_queue.store_id::text
     or (v_queue.payload ->> 'conversation_id')
        is distinct from v_queue.conversation_id::text then
    return jsonb_build_object(
      'ok', false,
      'status', 'followup_stale_scope_mismatch',
      'result', 'followup_stale_scope_mismatch',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(
      'p9_followup_runtime:' || v_followup_id::text
    )
  );

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = v_opportunity_id
    and opportunity_row.organization_id = v_queue.organization_id
    and opportunity_row.store_id = v_queue.store_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'status', 'followup_stale_opportunity_missing',
      'result', 'followup_stale_opportunity_missing',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id
    );
  end if;

  perform public.validate_commercial_opportunity_followup_integrity(
    v_opportunity
  );


  if v_opportunity.primary_conversation_id
       is distinct from v_queue.conversation_id then
    return jsonb_build_object(
      'ok', false,
      'status', 'followup_stale_conversation_changed',
      'result', 'followup_stale_conversation_changed',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id
    );
  end if;

  select followup_row.*
  into v_followup
  from public.commercial_opportunity_followups followup_row
  where followup_row.id = v_followup_id
    and followup_row.organization_id = v_queue.organization_id
    and followup_row.store_id = v_queue.store_id
    and followup_row.commercial_opportunity_id = v_opportunity_id
    and followup_row.cycle = v_followup_cycle
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'status', 'followup_stale_identity_mismatch',
      'result', 'followup_stale_identity_mismatch',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id,
      'followup_id', v_followup_id,
      'followup_cycle', v_followup_cycle
    );
  end if;

  if v_followup.status <> 'active' then
    return jsonb_build_object(
      'ok', false,
      'status', 'followup_stale_cycle_not_active',
      'result', 'followup_stale_cycle_not_active',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id,
      'followup_id', v_followup_id,
      'followup_cycle', v_followup_cycle,
      'followup_status', v_followup.status
    );
  end if;

  if v_followup.next_action is distinct from v_queue.next_action then
    return jsonb_build_object(
      'ok', false,
      'status', 'followup_stale_action_changed',
      'result', 'followup_stale_action_changed',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id,
      'followup_id', v_followup_id,
      'followup_cycle', v_followup_cycle
    );
  end if;
  if v_opportunity.stage in (
    'perdido',
    'concluido_sem_mais_acoes'
  ) then
    v_resolved :=
      public.resolve_commercial_opportunity_followup_by_system(
        v_queue.organization_id,
        v_queue.store_id,
        v_opportunity_id,
        'system_resolve_terminal_opportunity:' || v_queue.id::text
      );

    return jsonb_build_object(
      'ok', true,
      'status', 'followup_stale_opportunity_terminal',
      'result', 'followup_stale_opportunity_terminal',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id,
      'followup_id', v_followup_id,
      'followup_cycle', v_followup_cycle,
      'opportunity_stage', v_opportunity.stage,
      'followup_status', v_resolved.status
    );
  end if;

  select pg_catalog.max(message_row.created_at)
  into v_customer_message_at
  from public.messages message_row
  where message_row.conversation_id = v_queue.conversation_id
    and message_row.sender = 'user'
    and message_row.direction = 'incoming'
    and message_row.deleted_at is null
    and message_row.created_at > v_queue.enqueued_at;

  if v_customer_message_at is not null then
    v_resolved :=
      public.resolve_commercial_opportunity_followup_by_system(
        v_queue.organization_id,
        v_queue.store_id,
        v_opportunity_id,
        'system_resolve_customer_reply:' || v_queue.id::text
      );

    return jsonb_build_object(
      'ok', true,
      'status', 'followup_stale_customer_replied',
      'result', 'followup_stale_customer_replied',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id,
      'followup_id', v_followup_id,
      'followup_cycle', v_followup_cycle,
      'customer_message_at', v_customer_message_at,
      'followup_status', v_resolved.status
    );
  end if;

  /*
   * Defesa temporal final sob o lock do ciclo canônico.
   * Se next_action_at foi remarcado depois da seleção do worker,
   * nenhuma mensagem ou tentativa pode ser criada antes do horário.
   */
  if v_followup.next_action_at > pg_catalog.clock_timestamp() then
    return jsonb_build_object(
      'ok', true,
      'status', 'followup_not_due_yet',
      'result', 'followup_not_due_yet',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id,
      'followup_id', v_followup_id,
      'followup_cycle', v_followup_cycle,
      'next_action_at', v_followup.next_action_at
    );
  end if;

  select *
  into v_reply_guard
  from public.ai_sales_has_ai_reply_after_last_customer_message(
    v_queue.conversation_id
  );

  if coalesce(v_reply_guard.has_ai_reply, false) then
    return jsonb_build_object(
      'ok', true,
      'status', 'already_replied_after_last_customer_message',
      'result', 'already_replied_after_last_customer_message',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id,
      'followup_id', v_followup_id,
      'followup_cycle', v_followup_cycle,
      'latest_ai_message_id', v_reply_guard.latest_ai_message_id,
      'latest_ai_message_at', v_reply_guard.latest_ai_message_at
    );
  end if;

  v_source :=
    case
      when v_queue.next_action = 'followup_visit'
        then 'ai_sales_real_handler_followup_visit'
      else 'ai_sales_real_handler_followup_offer'
    end;

  select message_row.id
  into v_existing_message_id
  from public.messages message_row
  where message_row.conversation_id = v_queue.conversation_id
    and message_row.sender = 'ai'
    and message_row.direction = 'outgoing'
    and message_row.metadata ->> 'source' = v_source
    and message_row.metadata ->> 'commercial_opportunity_id'
          = v_opportunity_id::text
    and message_row.metadata ->> 'followup_id'
          = v_followup_id::text
    and message_row.metadata ->> 'followup_cycle'
          = v_followup_cycle::text
  order by message_row.created_at desc
  limit 1;

  if v_existing_message_id is not null then
    return jsonb_build_object(
      'ok', true,
      'status', 'already_sent',
      'result', 'already_sent',
      'action_queue_id', v_queue.id,
      'message_id', v_existing_message_id,
      'commercial_opportunity_id', v_opportunity_id,
      'followup_id', v_followup_id,
      'followup_cycle', v_followup_cycle
    );
  end if;

  v_content :=
    case
      when v_queue.next_action = 'followup_visit'
        then 'Olá! Passando para acompanhar sua visita. O que você achou e em que ponto posso te ajudar a avançar?'
      else 'Olá! Passando para saber o que você achou da proposta. Se quiser, posso te ajudar a revisar os detalhes para avançarmos.'
    end;

  select *
  into v_message
  from public.insert_message(
    v_queue.conversation_id,
    'ai',
    'outgoing',
    'text',
    v_content,
    null,
    null,
    jsonb_build_object(
      'source', v_source,
      'handler_key',
        case
          when v_queue.next_action = 'followup_visit'
            then 'real_handler_followup_visit'
          else 'real_handler_followup_offer'
        end,
      'execution_mode', 'real',
      'action_queue_id', v_queue.id,
      'commercial_opportunity_id', v_opportunity_id,
      'followup_id', v_followup_id,
      'followup_cycle', v_followup_cycle,
      'followup_operation_key', v_followup_operation_key
    )
  );

  v_attempt :=
    public.record_commercial_opportunity_followup_attempt_by_system(
      v_queue.organization_id,
      v_queue.store_id,
      v_opportunity_id,
      'system_attempt:' || v_queue.id::text
    );

  return jsonb_build_object(
    'ok', true,
    'status', 'message_inserted',
    'result', 'message_inserted',
    'action', v_queue.next_action,
    'action_queue_id', v_queue.id,
    'message_id', v_message.id,
    'commercial_opportunity_id', v_opportunity_id,
    'followup_id', v_followup_id,
    'followup_cycle', v_followup_cycle,
    'attempt_count', v_attempt.attempt_count
  );
end;
$function$;

revoke all
on function public.ai_sales_execute_canonical_followup_queue(uuid)
from public, anon, authenticated;

grant execute
on function public.ai_sales_execute_canonical_followup_queue(uuid)
to service_role;


create or replace function public.ai_sales_action_execute(
  p_action_queue_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_mode record;
  v_queue record;
  v_real record;
  v_safe jsonb;
  v_followup jsonb;
begin
  select *
  into v_mode
  from public.ai_sales_action_execution_mode();

  select
    q.id,
    q.organization_id,
    q.store_id,
    q.conversation_id,
    q.ai_run_id,
    q.next_action,
    q.action_key
  into v_queue
  from public.ai_sales_action_queue q
  where q.id = p_action_queue_id;

  if not found then
    return jsonb_build_object(
      'mode', 'router',
      'type', 'ai_sales_action_execute',
      'result', 'action_queue_not_found',
      'action_queue_id', p_action_queue_id
    );
  end if;

  if v_mode.execution_mode = 'invalid' then
    return jsonb_build_object(
      'mode', 'invalid',
      'type', 'ai_sales_action_execute',
      'source', 'ai_sales_action_execute',
      'result', 'invalid_execution_mode_flags',
      'action_queue_id', v_queue.id,
      'ai_run_id', v_queue.ai_run_id,
      'next_action', v_queue.next_action,
      'safe_mode_enabled', v_mode.safe_mode_enabled,
      'real_execution_enabled', v_mode.real_execution_enabled
    );
  end if;

  /*
   * Segunda barreira. O worker também filtra por esta autoridade,
   * porém nenhuma chamada direta ao router pode executar follow-up
   * antes do horário.
   */
  if v_queue.next_action in ('followup_offer', 'followup_visit')
     and not public.ai_sales_action_queue_ready_now(v_queue.id) then
    return jsonb_build_object(
      'mode', v_mode.execution_mode,
      'type', 'ai_sales_action_execute',
      'source', 'ai_sales_action_execute',
      'result', 'followup_not_due_yet',
      'action_queue_id', v_queue.id,
      'ai_run_id', v_queue.ai_run_id,
      'next_action', v_queue.next_action
    );
  end if;

  if v_mode.execution_mode = 'real' then
    if v_queue.next_action in ('followup_offer', 'followup_visit') then
      v_followup :=
        public.ai_sales_execute_canonical_followup_queue(
          v_queue.id
        );

      return jsonb_build_object(
        'mode', 'real',
        'type', 'ai_sales_action_execute',
        'source', 'ai_sales_action_execute',
        'result',
          coalesce(
            v_followup ->> 'result',
            v_followup ->> 'status',
            'canonical_followup_completed'
          ),
        'action_queue_id', v_queue.id,
        'ai_run_id', v_queue.ai_run_id,
        'next_action', v_queue.next_action,
        'dispatch', v_followup
      );
    end if;

    select *
    into v_real
    from public.ai_sales_action_dispatch_real(
      v_queue.organization_id,
      v_queue.store_id,
      v_queue.conversation_id,
      v_queue.next_action
    );

    return jsonb_build_object(
      'mode', 'real',
      'type', 'ai_sales_action_execute',
      'source', 'ai_sales_action_execute',
      'result', coalesce(v_real.status, 'real_dispatch_completed'),
      'action_queue_id', v_queue.id,
      'ai_run_id', v_queue.ai_run_id,
      'next_action', v_queue.next_action,
      'dispatch', jsonb_build_object(
        'ok', v_real.ok,
        'status', v_real.status,
        'action', v_real.action,
        'details', v_real.details
      )
    );
  end if;

  v_safe :=
    public.ai_sales_action_apply_safe(
      p_action_queue_id
    );

  return jsonb_build_object(
    'mode', 'safe',
    'type', 'ai_sales_action_execute',
    'source', 'ai_sales_action_execute',
    'result',
      coalesce(
        v_safe ->> 'result',
        'safe_dispatch_completed'
      ),
    'action_queue_id', v_queue.id,
    'ai_run_id', v_queue.ai_run_id,
    'next_action', v_queue.next_action,
    'execution_mode', v_mode.execution_mode,
    'safe_output', v_safe
  );
end;
$function$;

commit;
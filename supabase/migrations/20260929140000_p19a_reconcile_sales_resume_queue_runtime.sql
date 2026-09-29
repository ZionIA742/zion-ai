-- P19-A / Bloco 2 / Etapa 2.4 / Fase 3.1.
-- Reconciles the real window writer/reader with the TypeScript resume consumer.
-- This migration is intentionally not applied by the repository test runner.
--
-- Important runtime contract:
-- - public.process_ai_window_resumes() keeps RETURNS integer;
-- - the function remains SECURITY DEFINER with the existing owner/ACL object;
-- - due window rows are locked with SKIP LOCKED;
-- - resume enqueue does NOT call public.enqueue_ai_run_queue(), so it does not
--   recalculate can_ai_reply_now() or mutate the window during materialization;
-- - conversation_ai_window_state is NOT cleared here. The TypeScript consumer
--   remains the terminal owner of clearing/consuming the window;
-- - pre-existing conflicting/stale queue rows are not silently repaired or
--   re-executed by this migration.

do $preflight$
declare
  v_table text;
  v_column text;
  v_return_type text;
  v_owner text;
  v_security_definer boolean;
begin
  if to_regprocedure('public.process_ai_window_resumes()') is null then
    raise exception 'precondition failed: public.process_ai_window_resumes() is missing';
  end if;

  select
    pg_catalog.pg_get_function_result(proc_row.oid),
    pg_catalog.pg_get_userbyid(proc_row.proowner),
    proc_row.prosecdef
  into
    v_return_type,
    v_owner,
    v_security_definer
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = 'public.process_ai_window_resumes()'::regprocedure;

  if v_return_type <> 'integer' then
    raise exception 'precondition failed: public.process_ai_window_resumes() must return integer, found %', v_return_type;
  end if;

  if v_owner <> 'postgres' then
    raise exception 'precondition failed: public.process_ai_window_resumes() owner must be postgres, found %', v_owner;
  end if;

  if coalesce(v_security_definer, false) = false then
    raise exception 'precondition failed: public.process_ai_window_resumes() must be SECURITY DEFINER';
  end if;

  if not pg_catalog.has_function_privilege(
    'service_role',
    'public.process_ai_window_resumes()',
    'EXECUTE'
  ) then
    raise exception 'precondition failed: service_role EXECUTE on public.process_ai_window_resumes() is missing';
  end if;

  foreach v_table in array array[
    'conversation_ai_window_state',
    'ai_run_queue',
    'messages',
    'conversations',
    'leads'
  ] loop
    if to_regclass(format('public.%s', v_table)) is null then
      raise exception 'precondition failed: public.% table is missing', v_table;
    end if;
  end loop;

  foreach v_column in array array[
    'conversation_id',
    'organization_id',
    'store_id',
    'next_resume_at',
    'resume_reason'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_attribute attribute_row
      where attribute_row.attrelid = 'public.conversation_ai_window_state'::regclass
        and attribute_row.attname = v_column
        and attribute_row.attnum > 0
        and not attribute_row.attisdropped
    ) then
      raise exception 'precondition failed: conversation_ai_window_state.% column is missing', v_column;
    end if;
  end loop;

  foreach v_column in array array[
    'id',
    'organization_id',
    'store_id',
    'conversation_id',
    'lead_id',
    'queue_key',
    'input',
    'enqueued_at',
    'processed_at',
    'processing_error'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_attribute attribute_row
      where attribute_row.attrelid = 'public.ai_run_queue'::regclass
        and attribute_row.attname = v_column
        and attribute_row.attnum > 0
        and not attribute_row.attisdropped
    ) then
      raise exception 'precondition failed: ai_run_queue.% column is missing', v_column;
    end if;
  end loop;

  foreach v_column in array array[
    'id',
    'organization_id',
    'lead_id'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_attribute attribute_row
      where attribute_row.attrelid = 'public.conversations'::regclass
        and attribute_row.attname = v_column
        and attribute_row.attnum > 0
        and not attribute_row.attisdropped
    ) then
      raise exception 'precondition failed: conversations.% column is missing', v_column;
    end if;
  end loop;

  foreach v_column in array array['id', 'store_id'] loop
    if not exists (
      select 1
      from pg_catalog.pg_attribute attribute_row
      where attribute_row.attrelid = 'public.leads'::regclass
        and attribute_row.attname = v_column
        and attribute_row.attnum > 0
        and not attribute_row.attisdropped
    ) then
      raise exception 'precondition failed: leads.% column is missing', v_column;
    end if;
  end loop;

  foreach v_column in array array[
    'id',
    'organization_id',
    'store_id',
    'conversation_id',
    'sender',
    'direction',
    'created_at'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_attribute attribute_row
      where attribute_row.attrelid = 'public.messages'::regclass
        and attribute_row.attname = v_column
        and attribute_row.attnum > 0
        and not attribute_row.attisdropped
    ) then
      raise exception 'precondition failed: messages.% column is missing', v_column;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_index index_row
    where index_row.indrelid = 'public.ai_run_queue'::regclass
      and index_row.indisunique
      and index_row.indnkeyatts = 2
      and position(
        '(organization_id, queue_key)'
        in pg_catalog.pg_get_indexdef(index_row.indexrelid)
      ) > 0
  ) then
    raise exception 'precondition failed: ai_run_queue unique index on (organization_id, queue_key) is missing';
  end if;
end;
$preflight$;

create or replace function public.process_ai_window_resumes()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_state record;
  v_anchor_message_id uuid;
  v_now timestamptz;
  v_queue_id uuid;
  v_queue_key text;
  v_style_hint text;
  v_input jsonb;
  v_count integer := 0;
begin
  v_now := pg_catalog.clock_timestamp();

  for v_state in
    select
      state_row.organization_id,
      state_row.store_id,
      state_row.conversation_id,
      state_row.next_resume_at,
      state_row.resume_reason,
      conversation_row.lead_id
    from public.conversation_ai_window_state state_row
    join public.conversations conversation_row
      on conversation_row.id = state_row.conversation_id
     and conversation_row.organization_id = state_row.organization_id
    join public.leads lead_row
      on lead_row.id = conversation_row.lead_id
     and lead_row.store_id = state_row.store_id
    where state_row.next_resume_at is not null
      and state_row.next_resume_at <= v_now
      and state_row.resume_reason in (
        'sales_ai_after_hours_policy',
        'fast_lead_delay',
        'normal_reply_delay',
        'next_day_window',
        'customer_requested_tomorrow',
        'customer_requested_next_week',
        'customer_requested_next_month',
        'customer_needs_internal_alignment',
        'customer_requested_later'
      )
    order by state_row.next_resume_at asc
    for update of state_row skip locked
  loop
    select message_row.id
      into v_anchor_message_id
    from public.messages message_row
    where message_row.organization_id = v_state.organization_id
      and message_row.store_id = v_state.store_id
      and message_row.conversation_id = v_state.conversation_id
      and message_row.sender = 'user'
      and message_row.direction = 'incoming'
    order by message_row.created_at desc, message_row.id desc
    limit 1;

    -- No canonical inbound anchor means no executable resume. Keep the window
    -- intact so the condition remains visible/auditable; never invent an anchor.
    if v_anchor_message_id is null then
      continue;
    end if;

    v_queue_key := format(
      'resume:%s:%s:%s',
      v_state.conversation_id,
      v_state.resume_reason,
      to_char(
        v_state.next_resume_at at time zone 'America/Sao_Paulo',
        'YYYYMMDDHH24MI'
      )
    );

    v_style_hint := case v_state.resume_reason
      when 'next_day_window' then
        'Responder de forma natural e humana. Não justificar atraso/horário. Começar com "Bom dia" e seguir direto com a solução.'
      when 'fast_lead_delay' then
        'Responder com ritmo natural e comercial, como conversa quente e engajada. Não justificar atraso.'
      when 'customer_requested_tomorrow' then
        'Retomar com leveza, sem pressão e sem justificar atraso. Respeitar que o cliente pediu para falar no dia seguinte.'
      when 'customer_requested_next_week' then
        'Retomar com leveza e contexto, sem soar insistente. Respeitar que o cliente pediu contato na semana seguinte.'
      when 'customer_needs_internal_alignment' then
        'Retomar de forma gentil, dando espaço e sem pressão. O cliente precisava alinhar a decisão com outra pessoa.'
      else
        'Responder de forma natural, humana e comercial. Não justificar atraso.'
    end;

    v_input := jsonb_build_object(
      'type', 'resume_sales_conversation',
      'reason', v_state.resume_reason,
      'resumeAt', v_state.next_resume_at,
      'anchorMessageId', v_anchor_message_id,
      'system_event', 'ai_window_resume',
      'resume_mode', v_state.resume_reason,
      'style_hint', v_style_hint,
      'created_at_iso', v_now,
      'created_at_sp', to_char(
        v_now at time zone 'America/Sao_Paulo',
        'YYYY-MM-DD HH24:MI:SS'
      ),
      'queue_key', v_queue_key,
      'next_resume_at', v_state.next_resume_at,
      'timezone_name', 'America/Sao_Paulo'
    );

    v_queue_id := null;

    -- Resume materialization intentionally bypasses enqueue_ai_run_queue().
    -- That legacy helper calls can_ai_reply_now() and would recalculate/mutate
    -- the already-due window. Existing conflicting rows are left untouched so
    -- this migration never silently repairs or executes a stale legacy payload.
    insert into public.ai_run_queue (
      organization_id,
      store_id,
      conversation_id,
      lead_id,
      queue_key,
      input,
      enqueued_at,
      processed_at,
      processing_error
    ) values (
      v_state.organization_id,
      v_state.store_id,
      v_state.conversation_id,
      v_state.lead_id,
      v_queue_key,
      v_input,
      v_now,
      null,
      null
    )
    on conflict (organization_id, queue_key) do nothing
    returning id into v_queue_id;

    if v_queue_id is not null then
      v_count := v_count + 1;
    end if;

    -- Do NOT clear conversation_ai_window_state here. The TypeScript consumer
    -- owns terminal consumption/clear after success or terminal rejection.
  end loop;

  return v_count;
end;
$function$;

-- CREATE OR REPLACE keeps the existing function object, owner and ACL because
-- the signature is unchanged. Intentionally no ALTER OWNER / GRANT / REVOKE.

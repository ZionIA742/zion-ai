-- P19-A / Bloco 4 / 4-T3-N.2
-- Completa exclusivamente as duas fences comprovadamente ausentes:
-- hard_hold no worker e no gate final de envio externo.
-- Nao cria cron, nao libera takeover e nao altera o P0.

begin;

do $worker_patch$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.materialize_sales_ai_reply_set_by_worker_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,text,uuid,uuid,jsonb,jsonb,jsonb)'
  );
  v_definition text;
  v_declaration_anchor constant text := '  v_expires_at timestamptz;';
  v_guard_anchor constant text :=
    '  -- Reutiliza integralmente a autoridade atual.';
  v_guard constant text := $guard$

  -- Revalida a autoridade diretamente no lease. A fence do materializador
  -- original continua sendo a autoridade atomica final sob a mesma transacao.
  declare
    v_lease_organization_id uuid;
    v_lease_store_id uuid;
    v_hard_hold boolean;
    v_released_at timestamptz;
  begin
    select lease_row.organization_id, lease_row.store_id,
           lease_row.hard_hold, lease_row.released_at
      into v_lease_organization_id, v_lease_store_id, v_hard_hold, v_released_at
      from public.conversation_human_takeover_leases lease_row
     where lease_row.conversation_id = p_conversation_id;

    if found and (
         v_lease_organization_id is distinct from p_organization_id
         or v_lease_store_id is distinct from p_store_id
         or v_hard_hold is true
         or v_released_at is null
       ) then
      raise exception using errcode = '42501',
        message = 'P19A_4_T3_N2_AI_BLOCKED_BY_HUMAN_CONTROL';
    end if;
  end;
$guard$;
begin
  if v_oid is null then
    raise exception using errcode = 'P0001',
      message = 'P19A_4_T3_N2_WORKER_FENCE_MISSING';
  end if;

  select pg_catalog.pg_get_functiondef(v_oid) into v_definition;
  if pg_catalog.strpos(v_definition, 'P19A_4_T3_N2_AI_BLOCKED_BY_HUMAN_CONTROL') > 0 then
    return;
  end if;
  if pg_catalog.strpos(v_definition, v_declaration_anchor) = 0
     or pg_catalog.strpos(v_definition, v_guard_anchor) = 0 then
    raise exception using errcode = 'P0001',
      message = 'P19A_4_T3_N2_WORKER_FENCE_DRIFT';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    v_declaration_anchor,
    v_declaration_anchor || E'\n  v_lease_organization_id uuid;\n  v_lease_store_id uuid;\n  v_hard_hold boolean;\n  v_released_at timestamptz;'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    v_guard_anchor,
    v_guard_anchor || v_guard
  );
  execute v_definition;
end;
$worker_patch$;

do $send_patch$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)'
  );
  v_definition text;
  v_declaration_pattern constant text := '(?i)v_conversation_status[[:space:]]+text[[:space:]]*;';
  v_guard_pattern constant text := '(?i)select[[:space:]]+message_row[.][*][[:space:]]+into[[:space:]]+v_message[[:space:]]+from[[:space:]]+public[.]messages[[:space:]]+message_row[[:space:]]+where[[:space:]]+message_row[.]id[[:space:]]*=[[:space:]]*p_message_id[[:space:]]+and[[:space:]]+message_row[.]organization_id[[:space:]]*=[[:space:]]*p_organization_id[[:space:]]+and[[:space:]]+message_row[.]store_id[[:space:]]*=[[:space:]]*p_store_id[[:space:]]+and[[:space:]]+message_row[.]conversation_id[[:space:]]*=[[:space:]]*v_message[.]conversation_id[[:space:]]+for[[:space:]]+update[[:space:]]*;';
  v_declaration_anchor text;
  v_guard_anchor text;
  v_declaration_count integer;
  v_guard_count integer;
  v_guard constant text := $guard$
    if v_block_reason is null and v_initial_sender = 'ai'
       and v_message.sender = 'ai' then
      select lease_row.organization_id, lease_row.store_id,
             lease_row.hard_hold, lease_row.released_at
        into v_lease_organization_id, v_lease_store_id,
             v_hard_hold, v_lease_released_at
        from public.conversation_human_takeover_leases lease_row
       where lease_row.conversation_id = v_message.conversation_id
       for update;

      if found and (
           v_lease_organization_id is distinct from p_organization_id
           or v_lease_store_id is distinct from p_store_id
           or v_hard_hold is true
           or v_lease_released_at is null
         ) then
        v_block_reason := 'human_takeover_hard_hold';
      end if;
    end if;

$guard$;
begin
  if v_oid is null then
    raise exception using errcode = 'P0001',
      message = 'P19A_4_T3_N2_SEND_GATE_MISSING';
  end if;

  select pg_catalog.pg_get_functiondef(v_oid) into v_definition;
  if pg_catalog.strpos(v_definition, 'v_lease_released_at') > 0 then
    return;
  end if;
  select count(*) into v_declaration_count
    from pg_catalog.regexp_matches(v_definition, v_declaration_pattern, 'g');
  select count(*) into v_guard_count
    from pg_catalog.regexp_matches(v_definition, v_guard_pattern, 'g');
  if v_declaration_count <> 1 or v_guard_count <> 1 then
    raise exception using errcode = 'P0001',
      message = 'P19A_4_T3_N2_SEND_GATE_DRIFT',
      detail = pg_catalog.format('declaration=%s; fresh_read=%s', v_declaration_count, v_guard_count);
  end if;
  v_declaration_anchor := pg_catalog.substring(v_definition, v_declaration_pattern);
  v_guard_anchor := pg_catalog.substring(v_definition, v_guard_pattern);
  -- Insert before the fresh message row lock, after the conversation row lock.
  if pg_catalog.strpos(v_definition, 'WHATSAPP_EXTERNAL_SEND_GATE_MESSAGE_DISAPPEARED') = 0
     or pg_catalog.strpos(v_definition, 'human_takeover_active') = 0
     or pg_catalog.strpos(v_definition, 'private_acquire_sales_contract_conversation_xact_lock') = 0
     or pg_catalog.strpos(v_definition, 'private_acquire_sales_contract_conversation_xact_lock') >= pg_catalog.strpos(v_definition, 'human_takeover_active')
     or pg_catalog.strpos(v_definition, 'human_takeover_active') >= pg_catalog.strpos(v_definition, v_guard_anchor)
     or pg_catalog.strpos(v_definition, v_guard_anchor) >= pg_catalog.strpos(v_definition, 'WHATSAPP_EXTERNAL_SEND_GATE_MESSAGE_DISAPPEARED') then
    raise exception using errcode = 'P0001',
      message = 'P19A_4_T3_N2_SEND_GATE_DRIFT',
      detail = 'Unexpected ordering of conversation and fresh message locks';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    v_declaration_anchor,
    v_declaration_anchor || E'\n  v_lease_organization_id uuid;\n  v_lease_store_id uuid;\n  v_hard_hold boolean;\n  v_lease_released_at timestamptz;'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    v_guard_anchor,
    v_guard || '  ' || v_guard_anchor
  );
  execute v_definition;
end;
$send_patch$;

alter function public.materialize_sales_ai_reply_set_by_worker_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, boolean, text, uuid, uuid, jsonb, jsonb, jsonb
) owner to postgres;
alter function public.validate_or_cancel_whatsapp_external_send_by_system(uuid, uuid, uuid)
  owner to postgres;

do $postconditions$
declare
  v_worker text := pg_catalog.pg_get_functiondef(
    'public.materialize_sales_ai_reply_set_by_worker_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,text,uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure
  );
  v_send text := pg_catalog.pg_get_functiondef(
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)'::regprocedure
  );
begin
  if pg_catalog.strpos(v_worker, 'P19A_4_T3_N2_AI_BLOCKED_BY_HUMAN_CONTROL') = 0
     or pg_catalog.strpos(v_worker, 'conversation_human_takeover_leases') = 0
     or pg_catalog.strpos(v_send, 'v_lease_released_at') = 0
     or pg_catalog.strpos(v_send, 'human_takeover_hard_hold') = 0 then
    raise exception using errcode = 'P0001',
      message = 'P19A_4_T3_N2_POSTCONDITION_FAILED';
  end if;
end;
$postconditions$;

commit;

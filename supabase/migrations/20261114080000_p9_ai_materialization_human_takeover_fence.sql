-- P9 10.4-D: close the race between AI generation and human takeover.
-- The external-send gate remains the last provider-side fence. This patch
-- prevents the same stale response from being materialized into messages.

begin;

do $patch$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)'
  );
  v_definition text;
  v_anchor text := $anchor$
  perform public.private_acquire_sales_contract_conversation_xact_lock(p_conversation_id);

  select * into v_conversation
  from public.conversations
  where id = p_conversation_id and organization_id = p_organization_id and lead_id = p_lead_id;
  if not found then
    raise exception using errcode = '42501', message = 'P19A_I8_CONVERSATION_SCOPE_MISMATCH';
  end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id and organization_id = p_organization_id and store_id = p_store_id;
  if not found then
    raise exception using errcode = '42501', message = 'P19A_I8_LEAD_SCOPE_MISMATCH';
  end if;

$anchor$;
  v_guard text := $guard$
  -- Human control is revalidated after the conversation lock and before any
  -- response-set or message row can be created. The lease is locked second.
  select conversation_row.*
    into v_conversation
    from public.conversations conversation_row
   where conversation_row.id = p_conversation_id
     and conversation_row.organization_id = p_organization_id
     and conversation_row.lead_id = p_lead_id
   for update;
  if not found then
    raise exception using errcode = '42501', message = 'P19A_I8_CONVERSATION_SCOPE_MISMATCH';
  end if;

  select lease_row.hard_hold
    into v_hard_hold
    from public.conversation_human_takeover_leases lease_row
   where lease_row.conversation_id = p_conversation_id
     and lease_row.organization_id = p_organization_id
     and lease_row.store_id = p_store_id
   for update;

  if coalesce(v_conversation.is_human_active, false)
     or lower(btrim(coalesce(v_conversation.status, ''))) = 'humano_assumiu'
     or coalesce(v_hard_hold, false) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_10_4_D_AI_BLOCKED_BY_HUMAN_TAKEOVER';
  end if;

$guard$;
begin
  if v_oid is null then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_MATERIALIZER_MISSING';
  end if;

  select pg_catalog.pg_get_functiondef(v_oid) into v_definition;

  if pg_catalog.strpos(v_definition, 'P9_10_4_D_AI_BLOCKED_BY_HUMAN_TAKEOVER') > 0 then
    return;
  end if;

  if pg_catalog.strpos(v_definition, '  v_stop_event_exists boolean;') = 0 then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_DECLARATION_ANCHOR_MISSING';
  end if;
  v_definition := pg_catalog.replace(
    v_definition,
    '  v_stop_event_exists boolean;',
    E'  v_stop_event_exists boolean;\n  v_hard_hold boolean := false;'
  );

  if pg_catalog.strpos(v_definition, v_anchor) = 0 then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_MATERIALIZER_DRIFT';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    v_anchor,
    v_anchor || v_guard
  );

  execute v_definition;
end;
$patch$;

alter function public.materialize_sales_ai_reply_set_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, boolean, jsonb, jsonb, jsonb
) owner to postgres;

do $declaration_patch$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)'::regprocedure
  );
begin
  if pg_catalog.strpos(v_definition, 'v_hard_hold boolean') = 0 then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_DECLARATION_POSTCONDITION_FAILED';
  end if;
end;
$declaration_patch$;

do $postconditions$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)'::regprocedure
  );
begin
  if pg_catalog.strpos(v_definition, 'for update;') = 0
     or pg_catalog.strpos(v_definition, 'conversation_human_takeover_leases') = 0
     or pg_catalog.strpos(v_definition, 'v_hard_hold') = 0
     or pg_catalog.strpos(v_definition, 'P9_10_4_D_AI_BLOCKED_BY_HUMAN_TAKEOVER') = 0
     or pg_catalog.strpos(v_definition, 'SECURITY DEFINER') = 0
     or pg_catalog.strpos(v_definition, 'SET search_path TO pg_catalog, pg_temp, public') = 0 then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_MATERIALIZER_POSTCONDITION_FAILED';
  end if;
end;
$postconditions$;

commit;

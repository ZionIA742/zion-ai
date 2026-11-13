-- P9 10.4-D: durably schedule post-materialization reconciliation.
-- The response-set transaction is the durable boundary. A replay during human
-- control remains read-only; this queue is consumed only after control ends.

begin;

do $patch$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)'
  );
  v_definition text;
  v_anchor constant text := $anchor$
  update public.p19a_sales_ai_reply_sets
  set text_message_id = v_text_message.id, document_message_ids = v_document_ids, photo_message_id = v_photo_id, materialization_state = 'confirmed', confirmed_at = clock_timestamp()
  where id = v_set_id;

  return query select v_set_id, v_text_message.id, v_document_ids, v_photo_id, v_fingerprint, false;
$anchor$;
  v_replacement constant text := $replacement$
  update public.p19a_sales_ai_reply_sets
  set text_message_id = v_text_message.id, document_message_ids = v_document_ids, photo_message_id = v_photo_id, materialization_state = 'confirmed', confirmed_at = clock_timestamp()
  where id = v_set_id;

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
    p_organization_id,
    p_store_id,
    p_conversation_id,
    p_lead_id,
    format('sales-ai-post-materialization:%s', v_set_id),
    jsonb_build_object(
      'type', 'sales_ai_post_materialization_recovery',
      'responseSetId', v_set_id,
      'anchorMessageId', p_anchor_message_id
    ),
    clock_timestamp(),
    null,
    null
  )
  on conflict (organization_id, queue_key) do nothing;

  return query select v_set_id, v_text_message.id, v_document_ids, v_photo_id, v_fingerprint, false;
$replacement$;
begin
  if v_oid is null then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_RECOVERY_MATERIALIZER_MISSING';
  end if;

  if pg_catalog.to_regclass('public.ai_run_queue') is null then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_RECOVERY_QUEUE_MISSING';
  end if;

  select pg_catalog.pg_get_functiondef(v_oid) into v_definition;
  if pg_catalog.strpos(v_definition, v_anchor) = 0 then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_RECOVERY_MATERIALIZER_DRIFT';
  end if;

  v_definition := pg_catalog.replace(v_definition, v_anchor, v_replacement);
  execute v_definition;
end;
$patch$;

alter function public.materialize_sales_ai_reply_set_by_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, boolean, jsonb, jsonb, jsonb
) owner to postgres;

do $postconditions$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)'::regprocedure
  );
begin
  if pg_catalog.strpos(v_definition, 'sales_ai_post_materialization_recovery') = 0
     or pg_catalog.strpos(v_definition, 'on conflict (organization_id, queue_key) do nothing') = 0
     or pg_catalog.strpos(v_definition, 'P9_10_4_D_AI_BLOCKED_BY_HUMAN_TAKEOVER') = 0 then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_RECOVERY_POSTCONDITION_FAILED';
  end if;
end;
$postconditions$;

commit;

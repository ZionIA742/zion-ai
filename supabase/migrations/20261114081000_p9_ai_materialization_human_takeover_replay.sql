-- P9 10.4-D corrective migration: preserve confirmed response-set replay.
-- A takeover blocks new materialization, but must not turn a confirmed,
-- fingerprint-matched replay into a second write or a false failure.

begin;

do $patch$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)'
  );
  v_definition text;
  v_declaration_anchor constant text := '  v_hard_hold boolean := false;';
  v_declaration_replacement constant text := E'  v_hard_hold boolean := false;\n  v_human_takeover_blocked boolean := false;';
  v_guard_anchor constant text := $guard_anchor$
  if coalesce(v_conversation.is_human_active, false)
     or lower(btrim(coalesce(v_conversation.status, ''))) = 'humano_assumiu'
     or coalesce(v_hard_hold, false) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_10_4_D_AI_BLOCKED_BY_HUMAN_TAKEOVER';
  end if;
$guard_anchor$;
  v_guard_replacement constant text := E'  v_human_takeover_blocked :=\n'
    || '    coalesce(v_conversation.is_human_active, false)'
    || E'\n'
    || '    or lower(btrim(coalesce(v_conversation.status, ''''))) = ''humano_assumiu'''
    || E'\n'
    || '    or coalesce(v_hard_hold, false);';
  v_replay_anchor constant text := $replay_anchor$
  if found then
    if v_existing.materialization_state <> 'confirmed' or v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23514', message = 'P19A_I8_RESPONSE_SET_PAYLOAD_MISMATCH_OR_INCOMPLETE';
    end if;
    return query select v_existing.id, v_existing.text_message_id, v_existing.document_message_ids, v_existing.photo_message_id, v_existing.request_fingerprint, true;
    return;
  end if;
$replay_anchor$;
  v_replay_replacement constant text := v_replay_anchor || E'

  -- A confirmed, exact replay returned above is read-only and safe during
  -- takeover. Every new or incomplete response remains fail-closed.
  if v_human_takeover_blocked then
    raise exception using
      errcode = 'P0001',
      message = 'P9_10_4_D_AI_BLOCKED_BY_HUMAN_TAKEOVER';
  end if;';
begin
  if v_oid is null then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_REPLAY_MATERIALIZER_MISSING';
  end if;

  select pg_catalog.pg_get_functiondef(v_oid) into v_definition;

  if pg_catalog.strpos(v_definition, 'v_human_takeover_blocked') > 0 then
    return;
  end if;

  if pg_catalog.strpos(v_definition, v_declaration_anchor) = 0
     or pg_catalog.strpos(v_definition, v_guard_anchor) = 0
     or pg_catalog.strpos(v_definition, v_replay_anchor) = 0 then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_REPLAY_MATERIALIZER_DRIFT';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    v_declaration_anchor,
    v_declaration_replacement
  );
  v_definition := pg_catalog.replace(
    v_definition,
    v_guard_anchor,
    v_guard_replacement
  );
  v_definition := pg_catalog.replace(
    v_definition,
    v_replay_anchor,
    v_replay_replacement
  );

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
  if pg_catalog.strpos(v_definition, 'v_human_takeover_blocked') = 0
     or pg_catalog.strpos(v_definition, 'P9_10_4_D_AI_BLOCKED_BY_HUMAN_TAKEOVER') = 0
     or pg_catalog.strpos(v_definition, 'P19A_I8_RESPONSE_SET_PAYLOAD_MISMATCH_OR_INCOMPLETE') = 0
     or pg_catalog.strpos(v_definition, 'materialization_state <> ''confirmed''') = 0
     or pg_catalog.strpos(v_definition, 'SECURITY DEFINER') = 0
     or pg_catalog.strpos(v_definition, 'SET search_path TO pg_catalog, pg_temp, public') = 0 then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_REPLAY_POSTCONDITION_FAILED';
  end if;
end;
$postconditions$;

commit;

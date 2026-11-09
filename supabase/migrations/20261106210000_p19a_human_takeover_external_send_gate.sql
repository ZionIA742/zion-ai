-- ZION | Etapa 3 | takeover humano deve invalidar IA antes da linearizacao externa
-- Esta migration apenas endurece a autoridade SQL existente do sender.

begin;

do $patch$
declare
  v_signature constant text :=
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)';
  v_definition text;
  v_normalized_definition text;
  v_normalized_anchor text;
  v_lock_match text;
  v_lock_position integer;
  v_declaration_anchor constant text :=
    '  v_real_whatsapp boolean := false;';
  v_lock_anchor constant text := E'  perform public.private_acquire_sales_contract_conversation_xact_lock(\n'
    || E'    v_message.conversation_id\n'
    || E'  );';
  v_lock_pattern constant text :=
    'perform[[:space:]]+public[.]private_acquire_sales_contract_conversation_xact_lock[[:space:]]*[(][[:space:]]*v_message[.]conversation_id[[:space:]]*[)][[:space:]]*;';
  v_lock_insertion constant text :=
    E'\n\n'
    || '  /*\n'
    || '   * The canonical takeover writer locks the same conversation row.\n'
    || '   * Read it while locked so a human takeover cannot race the final\n'
    || '   * processing -> uncertain transition for an AI message.\n'
    || '   */\n'
    || '  if v_block_reason is null\n'
    || '     and v_message.sender = ''ai'' then\n'
    || '    select conversation_row.is_human_active, conversation_row.status\n'
    || '    into v_conversation_is_human_active, v_conversation_status\n'
    || '    from public.conversations conversation_row\n'
    || '    join public.leads lead_row\n'
    || '      on lead_row.id = conversation_row.lead_id\n'
    || '     and lead_row.organization_id = p_organization_id\n'
    || '     and lead_row.store_id = p_store_id\n'
    || '    where conversation_row.id = v_message.conversation_id\n'
    || '      and conversation_row.organization_id = p_organization_id\n'
    || '    for update of conversation_row;\n\n'
    || '    if not found then\n'
    || '      v_block_reason := ''human_takeover_conversation_scope_mismatch'';\n'
    || '    elsif coalesce(v_conversation_is_human_active, false)\n'
    || '       or pg_catalog.lower(pg_catalog.btrim(coalesce(v_conversation_status, '''')))\n'
    || '            = ''humano_assumiu'' then\n'
    || '      v_block_reason := ''human_takeover_active'';\n'
    || '    end if;\n'
    || '  end if;';
  v_declaration_replacement constant text :=
    pg_catalog.replace(
      v_declaration_anchor
      || E'\n'
      || '  v_conversation_is_human_active boolean;\n'
      || '  v_conversation_status text;',
      E'\\n',
      E'\n'
    );
begin
  if pg_catalog.to_regprocedure(v_signature) is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_HUMAN_TAKEOVER_GATE_FUNCTION_MISSING';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(v_signature::regprocedure);

  if pg_catalog.strpos(v_definition, v_declaration_anchor) = 0
     or pg_catalog.strpos(v_definition, 'v_conversation_is_human_active') > 0
  then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_HUMAN_TAKEOVER_GATE_UNEXPECTED_DEFINITION';
  end if;

  v_normalized_definition := pg_catalog.regexp_replace(
    v_definition,
    '[[:space:]]+',
    ' ',
    'g'
  );
  v_normalized_anchor := pg_catalog.regexp_replace(
    v_lock_anchor,
    '[[:space:]]+',
    ' ',
    'g'
  );

  if pg_catalog.length(v_normalized_definition)
       - pg_catalog.length(
           pg_catalog.replace(v_normalized_definition, v_normalized_anchor, '')
         )
       <> pg_catalog.length(v_normalized_anchor)
  then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_HUMAN_TAKEOVER_GATE_LOCK_PATTERN_COUNT_INVALID';
  end if;

  select match[1]
    into v_lock_match
    from pg_catalog.regexp_matches(
      v_definition,
      '(' || v_lock_pattern || ')',
      'n'
    ) match;

  if v_lock_match is null then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_HUMAN_TAKEOVER_GATE_LOCK_PATTERN_NOT_FOUND';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    v_declaration_anchor,
    v_declaration_replacement
  );

  v_lock_position := pg_catalog.strpos(v_definition, v_lock_match);

  if v_lock_position <= 0 then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_HUMAN_TAKEOVER_GATE_LOCK_PATTERN_NOT_FOUND';
  end if;

  v_definition := pg_catalog.substr(v_definition, 1, v_lock_position - 1)
    || v_lock_match
    || pg_catalog.replace(v_lock_insertion, E'\\n', E'\n')
    || pg_catalog.substr(
      v_definition,
      v_lock_position + pg_catalog.length(v_lock_match)
    );

  if pg_catalog.strpos(v_definition, 'human_takeover_active') = 0
     or pg_catalog.strpos(v_definition, 'for update of conversation_row') = 0
     or pg_catalog.strpos(v_definition, 'v_conversation_is_human_active') = 0
  then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_HUMAN_TAKEOVER_GATE_PATCH_NOT_APPLIED';
  end if;

  execute v_definition;
end;
$patch$;

alter function public.validate_or_cancel_whatsapp_external_send_by_system(uuid, uuid, uuid)
  owner to postgres;

revoke all on function
  public.validate_or_cancel_whatsapp_external_send_by_system(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.validate_or_cancel_whatsapp_external_send_by_system(uuid, uuid, uuid)
to service_role;

do $postconditions$
declare
  v_definition text;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)'::regprocedure
  );

  if pg_catalog.strpos(v_definition, 'human_takeover_active') = 0
     or pg_catalog.strpos(v_definition, 'for update of conversation_row') = 0
     or pg_catalog.strpos(v_definition, 'v_conversation_is_human_active') = 0
  then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_HUMAN_TAKEOVER_GATE_POSTCONDITION_FAILED';
  end if;
end;
$postconditions$;

commit;

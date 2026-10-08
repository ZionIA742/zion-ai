begin;

-- Read-only contract check for the I4 reader migration. No fixtures are
-- inserted, and the transaction is always rolled back.
do $check$
declare
  v_definition text;
begin
  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(
        'public.get_pending_external_messages_v2(uuid,uuid,integer,integer)'::pg_catalog.regprocedure
      ),
      '\s+',
      ' ',
      'g'
    )
  )
  into v_definition;

  if v_definition not like '%message_row.sender = ''ai'' and message_row.message_type in (''text'', ''image'', ''document'')%'
     or v_definition not like '%outbound_origin'', '''') in ( ''crm_manual_text'', ''crm_manual_image'', ''crm_manual_document'' ) and message_row.message_type in (''text'', ''image'', ''document'')%'
     or v_definition not like '%message_row.sender = ''human'' and coalesce(message_row.metadata ->> ''outbound_origin'', '''') = ''sales_quote_send'' and message_row.message_type in (''text'', ''image'', ''document'')%'
     or v_definition not like '%outbound_origin'', '''') = ''crm_manual_audio'' and message_row.message_type = ''audio''%'
     or v_definition not like '%outbound_origin'', '''') = ''crm_manual_video'' and message_row.message_type = ''video''%'
     or v_definition not like '%crm_manual_text%'
     or v_definition not like '%crm_manual_image%'
     or v_definition not like '%crm_manual_document%'
     or v_definition like '%sales_quote_send'' and message_row.message_type in (''text'', ''image'', ''audio'', ''video'', ''document'')%'
     or v_definition like '%message_row.sender = ''ai'' and message_row.message_type in (''text'', ''image'', ''audio'', ''video'', ''document'')%'
     or v_definition not like '%message_row.organization_id = p_organization_id%'
     or v_definition not like '%message_row.store_id = p_store_id%'
     or v_definition not like '%lead_row.store_id = message_row.store_id%'
     or v_definition not like '%outbound_attempt_started_at is null%'
     or v_definition not like '%outbound_claimed_at <%'
     or v_definition not like '%external_message_id is null%'
     or v_definition not like '%deleted_at is null%'
     or v_definition not like '%send_external%'
     or v_definition not like '%external_channel%'
     or v_definition like '%outbound_delivery_state = ''uncertain''%' then
    raise exception using
      errcode = 'P0001',
      message = 'P19A_I4_MANUAL_AUDIO_VIDEO_READER_CONTRACT_FAILED';
  end if;
end;
$check$;

rollback;

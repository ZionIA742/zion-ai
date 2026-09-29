begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public;

-- P9 / Bug B
-- Repair the real qualify_lead Sales AI handler so a reply generated from an
-- exact real Meta WhatsApp inbound is materialized as a transport-eligible
-- reactive_ai_reply. Internal/panel paths remain internal.
--
-- The installed handler is not versioned in the repository in its current
-- full form. Patch only the exact audited baseline, fail closed on drift, and
-- preserve every unrelated branch of the installed definition.

do $migration$
declare
  v_function_oid oid;
  v_definition text;
  v_patched text;
  v_owner text;
  v_security_definer boolean;
  v_proconfig text[];
  v_anchor text;
  v_replacement text;
  v_anchor_count integer;
begin
  select
    proc_row.oid,
    pg_catalog.pg_get_functiondef(proc_row.oid),
    owner_row.rolname,
    proc_row.prosecdef,
    proc_row.proconfig
  into
    v_function_oid,
    v_definition,
    v_owner,
    v_security_definer,
    v_proconfig
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  join pg_catalog.pg_roles owner_row
    on owner_row.oid = proc_row.proowner
  where namespace_row.nspname = 'public'
    and proc_row.proname = 'ai_sales_real_handler_qualify_lead'
    and pg_catalog.pg_get_function_identity_arguments(proc_row.oid) =
          'p_organization_id uuid, p_store_id uuid, p_conversation_id uuid';

  if v_function_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'P9_BUG_B_QUALIFY_HANDLER_NOT_FOUND';
  end if;

  if pg_catalog.md5(v_definition) <> '425991b1ff8ef75a2f8c8549e65a20b0'
     or pg_catalog.length(v_definition) <> 17296 then
    raise exception using
      errcode = 'P0001',
      message = 'P9_BUG_B_QUALIFY_HANDLER_BASELINE_DRIFT';
  end if;

  if v_owner <> 'postgres'
     or v_security_definer is distinct from true
     or v_proconfig is distinct from array['search_path=public, pg_temp']::text[] then
    raise exception using
      errcode = 'P0001',
      message = 'P9_BUG_B_QUALIFY_HANDLER_SECURITY_CONTRACT_DRIFT';
  end if;

  if pg_catalog.has_function_privilege('anon', v_function_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_function_oid, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'P9_BUG_B_QUALIFY_HANDLER_ACL_DRIFT';
  end if;

  v_patched := v_definition;

  -- 1. Add only the state required to bind the outbound reply to the exact
  -- customer source message and its immutable commercial snapshot.
  v_anchor := $anchor$
  v_existing_message_id uuid;
  v_message public.messages;
  v_content text;
  v_conv record;
  v_last_customer_message_at timestamptz;
$anchor$;

  v_replacement := $replacement$
  v_existing_message_id uuid;
  v_message public.messages;
  v_source_message public.messages;
  v_source_message_id uuid;
  v_commercial_opportunity_id uuid;
  v_external_metadata jsonb := '{}'::jsonb;
  v_content text;
  v_conv record;
  v_last_customer_message_at timestamptz;
$replacement$;

  v_anchor_count :=
    (pg_catalog.length(v_patched) -
     pg_catalog.length(pg_catalog.replace(v_patched, v_anchor, ''))) /
    pg_catalog.length(v_anchor);

  if v_anchor_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'P9_BUG_B_DECLARATION_ANCHOR_MISMATCH';
  end if;

  v_patched := pg_catalog.replace(v_patched, v_anchor, v_replacement);

  -- 2. Capture the exact latest non-deleted customer inbound. Its immutable
  -- commercial_session_context_link_id is the source of opportunity identity.
  v_anchor := $anchor$
  select max(m.created_at)
  into v_last_customer_message_at
  from public.messages m
  where m.conversation_id = p_conversation_id
    and m.sender = 'user'
    and m.direction = 'incoming';
$anchor$;

  v_replacement := $replacement$
  select m.*
  into v_source_message
  from public.messages m
  where m.organization_id = p_organization_id
    and m.store_id = p_store_id
    and m.conversation_id = p_conversation_id
    and m.sender = 'user'
    and m.direction = 'incoming'
    and m.deleted_at is null
  order by m.created_at desc, m.id desc
  limit 1;

  if found then
    v_source_message_id := v_source_message.id;

    if v_source_message.commercial_session_context_link_id is not null then
      select context_row.commercial_opportunity_id
      into v_commercial_opportunity_id
      from public.commercial_session_context_links context_row
      where context_row.id =
            v_source_message.commercial_session_context_link_id
        and context_row.organization_id = p_organization_id
        and context_row.store_id = p_store_id
      limit 1;
    end if;
  end if;

  select max(m.created_at)
  into v_last_customer_message_at
  from public.messages m
  where m.conversation_id = p_conversation_id
    and m.sender = 'user'
    and m.direction = 'incoming';
$replacement$;

  v_anchor_count :=
    (pg_catalog.length(v_patched) -
     pg_catalog.length(pg_catalog.replace(v_patched, v_anchor, ''))) /
    pg_catalog.length(v_anchor);

  if v_anchor_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'P9_BUG_B_SOURCE_MESSAGE_ANCHOR_MISMATCH';
  end if;

  v_patched := pg_catalog.replace(v_patched, v_anchor, v_replacement);

  -- 3. External activation is deliberately stricter than merely having a
  -- WhatsApp message somewhere in the conversation. The exact latest source
  -- inbound must itself be a Meta WhatsApp inbound on the currently active
  -- phone_number_id, and it must already carry a commercial opportunity
  -- snapshot. Otherwise the existing handler behavior remains internal-only.
  v_anchor := $anchor$
  select *
  into v_message
  from public.insert_message(
$anchor$;

  v_replacement := $replacement$
  if v_source_message_id is not null
     and v_commercial_opportunity_id is not null
     and public.is_real_whatsapp_conversation_for_external_send(
       p_organization_id,
       p_store_id,
       p_conversation_id
     )
     and v_source_message.metadata ->> 'source' = 'meta_whatsapp_webhook'
     and v_source_message.metadata ->> 'channel' = 'whatsapp'
     and v_source_message.metadata ->> 'external_channel' = 'whatsapp'
     and v_source_message.metadata ->> 'provider' = 'meta'
     and exists (
       select 1
       from public.get_active_whatsapp_integration_for_external_send_by_system(
         p_organization_id,
         p_store_id
       ) integration_row
       where integration_row.phone_number_id =
             nullif(
               pg_catalog.btrim(
                 coalesce(v_source_message.metadata ->> 'phone_number_id', '')
               ),
               ''
             )
     ) then
    v_external_metadata := pg_catalog.jsonb_build_object(
      'channel', 'whatsapp',
      'external_channel', 'whatsapp',
      'send_external', true,
      'outbound_origin', 'ai_sales_reply',
      'whatsapp_detected_from_conversation', true,
      'outbound_kind', 'reactive_ai_reply',
      'source_message_id', v_source_message_id,
      'commercial_opportunity_id', v_commercial_opportunity_id
    );
  end if;

  select *
  into v_message
  from public.insert_message(
$replacement$;

  v_anchor_count :=
    (pg_catalog.length(v_patched) -
     pg_catalog.length(pg_catalog.replace(v_patched, v_anchor, ''))) /
    pg_catalog.length(v_anchor);

  if v_anchor_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'P9_BUG_B_INSERT_ANCHOR_MISMATCH';
  end if;

  v_patched := pg_catalog.replace(v_patched, v_anchor, v_replacement);

  -- 4. Keep the handler's existing source/handler metadata for idempotency and
  -- append only the canonical external-transport contract when eligible.
  v_anchor := $anchor$
      'pool_count', v_pool_count,
      'pool_with_photos_count', v_pool_with_photos_count
    )
  );
$anchor$;

  v_replacement := $replacement$
      'pool_count', v_pool_count,
      'pool_with_photos_count', v_pool_with_photos_count
    ) || v_external_metadata
  );
$replacement$;

  v_anchor_count :=
    (pg_catalog.length(v_patched) -
     pg_catalog.length(pg_catalog.replace(v_patched, v_anchor, ''))) /
    pg_catalog.length(v_anchor);

  if v_anchor_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'P9_BUG_B_METADATA_ANCHOR_MISMATCH';
  end if;

  v_patched := pg_catalog.replace(v_patched, v_anchor, v_replacement);

  if v_patched = v_definition then
    raise exception using
      errcode = 'P0001',
      message = 'P9_BUG_B_PATCH_DID_NOT_CHANGE_HANDLER';
  end if;

  execute v_patched;
end;
$migration$;

alter function public.ai_sales_real_handler_qualify_lead(uuid, uuid, uuid)
  owner to postgres;

revoke all on function
  public.ai_sales_real_handler_qualify_lead(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.ai_sales_real_handler_qualify_lead(uuid, uuid, uuid)
to service_role;

comment on function
  public.ai_sales_real_handler_qualify_lead(uuid, uuid, uuid)
is
  'P9 Bug B repair: real qualify_lead replies become canonical reactive WhatsApp outbound only when the exact source inbound is proven Meta WhatsApp on the active integration and both source/outbound commercial context remain gate-verifiable.';

do $postconditions$
declare
  v_function_oid oid;
  v_definition text;
  v_owner text;
  v_security_definer boolean;
  v_proconfig text[];
begin
  select
    proc_row.oid,
    pg_catalog.pg_get_functiondef(proc_row.oid),
    owner_row.rolname,
    proc_row.prosecdef,
    proc_row.proconfig
  into
    v_function_oid,
    v_definition,
    v_owner,
    v_security_definer,
    v_proconfig
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  join pg_catalog.pg_roles owner_row
    on owner_row.oid = proc_row.proowner
  where namespace_row.nspname = 'public'
    and proc_row.proname = 'ai_sales_real_handler_qualify_lead'
    and pg_catalog.pg_get_function_identity_arguments(proc_row.oid) =
          'p_organization_id uuid, p_store_id uuid, p_conversation_id uuid';

  if v_function_oid is null
     or v_owner <> 'postgres'
     or v_security_definer is distinct from true
     or v_proconfig is distinct from array['search_path=public, pg_temp']::text[] then
    raise exception using
      errcode = 'P0001',
      message = 'P9_BUG_B_POSTCONDITION_SECURITY_CONTRACT_FAILED';
  end if;

  if pg_catalog.has_function_privilege('anon', v_function_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_function_oid, 'EXECUTE') then
    raise exception using
      errcode = 'P0001',
      message = 'P9_BUG_B_POSTCONDITION_ACL_FAILED';
  end if;

  if pg_catalog.md5(v_definition) = '425991b1ff8ef75a2f8c8549e65a20b0'
     or pg_catalog.strpos(v_definition, '''outbound_kind'', ''reactive_ai_reply''') = 0
     or pg_catalog.strpos(v_definition, '''source_message_id'', v_source_message_id') = 0
     or pg_catalog.strpos(v_definition, '''commercial_opportunity_id'', v_commercial_opportunity_id') = 0
     or pg_catalog.strpos(v_definition, '''send_external'', true') = 0
     or pg_catalog.strpos(v_definition, '''outbound_origin'', ''ai_sales_reply''') = 0
     or pg_catalog.strpos(
          v_definition,
          'is_real_whatsapp_conversation_for_external_send'
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          'get_active_whatsapp_integration_for_external_send_by_system'
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          'm.metadata->>''source'' = ''ai_sales_real_handler_qualify_lead'''
        ) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'P9_BUG_B_POSTCONDITION_HANDLER_CONTRACT_FAILED';
  end if;
end;
$postconditions$;

commit;

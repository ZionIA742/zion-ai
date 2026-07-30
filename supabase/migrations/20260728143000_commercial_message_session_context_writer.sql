begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:b1:e1.4:commercial-message-session-context-writer:v1',
    0
  )
);

create temp table pg_temp._p9_e14_writer_baseline (
  singleton boolean primary key default true check (singleton),
  insert_message_oid oid not null,
  insert_message_owner name not null,
  insert_message_language name not null,
  insert_message_result text not null,
  insert_message_default_count integer not null,
  insert_message_acl text not null,
  insert_message_comment text null,
  insert_message_proconfig text not null,
  insert_message_provolatile "char" not null,
  insert_message_proparallel "char" not null,
  insert_message_prosecdef boolean not null,
  insert_message_definition_text text not null,
  insert_message_definition_md5 text not null,
  panel_send_message_oid oid not null,
  panel_send_message_owner name not null,
  panel_send_message_acl text not null,
  panel_send_message_proconfig text not null,
  panel_send_message_definition_md5 text not null,
  panel_send_message_scoped_oid oid not null,
  panel_send_message_scoped_owner name not null,
  panel_send_message_scoped_acl text not null,
  panel_send_message_scoped_proconfig text not null,
  panel_send_message_scoped_definition_md5 text not null
) on commit drop;

do $preflight$
declare
  v_insert_oid oid;
  v_panel_oid oid;
  v_panel_scoped_oid oid;
  v_insert_owner name;
  v_insert_language name;
  v_insert_result text;
  v_insert_default_count integer;
  v_insert_acl text;
  v_insert_comment text;
  v_insert_proconfig text;
  v_insert_provolatile "char";
  v_insert_proparallel "char";
  v_insert_prosecdef boolean;
  v_insert_definition text;
  v_panel_owner name;
  v_panel_acl text;
  v_panel_proconfig text;
  v_panel_definition_md5 text;
  v_panel_scoped_owner name;
  v_panel_scoped_acl text;
  v_panel_scoped_proconfig text;
  v_panel_scoped_definition_md5 text;
begin
  v_insert_oid := pg_catalog.to_regprocedure(
    'public.insert_message(uuid,text,text,text,text,text,text,jsonb)'
  );
  v_panel_oid := pg_catalog.to_regprocedure(
    'public.panel_send_message(uuid,text,text,text)'
  );
  v_panel_scoped_oid := pg_catalog.to_regprocedure(
    'public.panel_send_message_scoped(uuid,uuid,text)'
  );

  if pg_catalog.to_regclass('public.conversation_sessions') is null
     or pg_catalog.to_regclass('public.commercial_session_context_links') is null
     or pg_catalog.to_regclass('public.commercial_opportunities') is null
     or pg_catalog.to_regclass('public.lead_customer_links') is null
     or pg_catalog.to_regclass('public.messages') is null
     or pg_catalog.to_regclass('public.conversations') is null
     or pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.stores') is null
     or pg_catalog.to_regclass('public.memberships') is null
     or pg_catalog.to_regclass('public.customers') is null
     or pg_catalog.to_regclass('public.organizations') is null
     or v_insert_oid is null
     or v_panel_oid is null
     or v_panel_scoped_oid is null
     or pg_catalog.to_regprocedure(
       'public.link_commercial_session_context(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,uuid,jsonb,timestamp with time zone)'
     ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: required message/session/context objects are missing';
  end if;

  if pg_catalog.to_regprocedure(
       'public.ensure_commercial_conversation_session_context(uuid,uuid,uuid)'
     ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.ensure_commercial_conversation_session_context(uuid,uuid,uuid) already exists';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'ensure_commercial_conversation_session_context'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: unexpected overload already exists for ensure_commercial_conversation_session_context';
  end if;

  select
    role_row.rolname,
    language_row.lanname,
    pg_catalog.pg_get_function_result(proc_row.oid),
    proc_row.pronargdefaults,
    coalesce(pg_catalog.array_to_string(proc_row.proacl, ','), ''),
    pg_catalog.obj_description(proc_row.oid, 'pg_proc'),
    coalesce(pg_catalog.array_to_string(proc_row.proconfig, ','), ''),
    proc_row.provolatile,
    proc_row.proparallel,
    proc_row.prosecdef,
    pg_catalog.pg_get_functiondef(proc_row.oid)
  into
    v_insert_owner,
    v_insert_language,
    v_insert_result,
    v_insert_default_count,
    v_insert_acl,
    v_insert_comment,
    v_insert_proconfig,
    v_insert_provolatile,
    v_insert_proparallel,
    v_insert_prosecdef,
    v_insert_definition
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_roles role_row
    on role_row.oid = proc_row.proowner
  join pg_catalog.pg_language language_row
    on language_row.oid = proc_row.prolang
  where proc_row.oid = v_insert_oid;

  select
    role_row.rolname,
    coalesce(pg_catalog.array_to_string(proc_row.proacl, ','), ''),
    coalesce(pg_catalog.array_to_string(proc_row.proconfig, ','), ''),
    md5(pg_catalog.pg_get_functiondef(proc_row.oid))
  into
    v_panel_owner,
    v_panel_acl,
    v_panel_proconfig,
    v_panel_definition_md5
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_roles role_row
    on role_row.oid = proc_row.proowner
  where proc_row.oid = v_panel_oid;

  select
    role_row.rolname,
    coalesce(pg_catalog.array_to_string(proc_row.proacl, ','), ''),
    coalesce(pg_catalog.array_to_string(proc_row.proconfig, ','), ''),
    md5(pg_catalog.pg_get_functiondef(proc_row.oid))
  into
    v_panel_scoped_owner,
    v_panel_scoped_acl,
    v_panel_scoped_proconfig,
    v_panel_scoped_definition_md5
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_roles role_row
    on role_row.oid = proc_row.proowner
  where proc_row.oid = v_panel_scoped_oid;

  if v_insert_owner <> 'postgres'
     or v_insert_language <> 'plpgsql'
     or v_insert_result <> 'messages'
     or v_insert_default_count <> 3
     or not v_insert_prosecdef
     or v_insert_provolatile <> 'v'
     or v_insert_proconfig <> 'search_path=public, pg_temp'
     or md5(v_insert_definition) <> 'b1bf0cddecc4f6a7a7eae40b7c43388f'
     or pg_catalog.strpos(v_insert_definition, 'ensure_commercial_conversation_session_context') > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: insert_message contract is not in the approved baseline shape';
  end if;

  if v_panel_definition_md5 <> '0349045b9f557c85ae2dbceab84a7efd'
     or v_panel_scoped_definition_md5 <> '1877bd63fcb5a5f7885b708c237c6d30' then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: panel_send_message contract is not in the approved baseline shape';
  end if;

  insert into pg_temp._p9_e14_writer_baseline (
    insert_message_oid,
    insert_message_owner,
    insert_message_language,
    insert_message_result,
    insert_message_default_count,
    insert_message_acl,
    insert_message_comment,
    insert_message_proconfig,
    insert_message_provolatile,
    insert_message_proparallel,
    insert_message_prosecdef,
    insert_message_definition_text,
    insert_message_definition_md5,
    panel_send_message_oid,
    panel_send_message_owner,
    panel_send_message_acl,
    panel_send_message_proconfig,
    panel_send_message_definition_md5,
    panel_send_message_scoped_oid,
    panel_send_message_scoped_owner,
    panel_send_message_scoped_acl,
    panel_send_message_scoped_proconfig,
    panel_send_message_scoped_definition_md5
  )
  values (
    v_insert_oid,
    v_insert_owner,
    v_insert_language,
    v_insert_result,
    v_insert_default_count,
    v_insert_acl,
    v_insert_comment,
    v_insert_proconfig,
    v_insert_provolatile,
    v_insert_proparallel,
    v_insert_prosecdef,
    replace(replace(v_insert_definition, E'\r\n', E'\n'), E'\r', E'\n'),
    md5(v_insert_definition),
    v_panel_oid,
    v_panel_owner,
    v_panel_acl,
    v_panel_proconfig,
    v_panel_definition_md5,
    v_panel_scoped_oid,
    v_panel_scoped_owner,
    v_panel_scoped_acl,
    v_panel_scoped_proconfig,
    v_panel_scoped_definition_md5
  );
end;
$preflight$;

create function public.ensure_commercial_conversation_session_context(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid
)
returns table (
  conversation_session_id uuid,
  commercial_session_context_link_id uuid,
  commercial_opportunity_id uuid,
  commercial_context_state text,
  session_created boolean,
  context_link_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_set_role text;
  v_claim_role_setting text;
  v_claim_role_json text;
  v_claim_role text;
  v_claim_sub_setting text;
  v_claim_sub_json text;
  v_claims_text text;
  v_claims jsonb;
  v_request_role text;
  v_request_sub uuid;
  v_link_source text;
  v_link_actor_type text;
  v_link_actor_user_id uuid;
  v_conversation public.conversations;
  v_lead public.leads;
  v_store public.stores;
  v_existing_session public.conversation_sessions;
  v_existing_context public.commercial_session_context_links;
  v_created_context public.commercial_session_context_links;
  v_session_created boolean := false;
  v_context_created boolean := false;
  v_link_idempotency_key text;
  v_active_link_count bigint;
  v_active_customer_count bigint;
  v_lead_customer_link_ids uuid[];
  v_link_customer_ids uuid[];
  v_explicit_opportunity_count bigint;
  v_explicit_opportunity_customer_count bigint;
  v_commercial_opportunity_ids uuid[];
  v_opportunity_customer_ids uuid[];
begin
  v_set_role := nullif(pg_catalog.current_setting('role', true), '');
  if v_set_role = 'none' then
    v_set_role := null;
  end if;

  v_claim_role_setting := nullif(
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  v_claim_sub_setting := nullif(
    pg_catalog.current_setting('request.jwt.claim.sub', true),
    ''
  );
  v_claims_text := nullif(
    pg_catalog.current_setting('request.jwt.claims', true),
    ''
  );

  if v_claims_text is not null then
    begin
      v_claims := v_claims_text::jsonb;
    exception
      when invalid_text_representation then
        raise exception using
          errcode = '42501',
          message = 'commercial message session writer is not authorized';
    end;

    if pg_catalog.jsonb_typeof(v_claims) <> 'object' then
      raise exception using
        errcode = '42501',
        message = 'commercial message session writer is not authorized';
    end if;

    v_claim_role_json := nullif(v_claims ->> 'role', '');
    v_claim_sub_json := nullif(v_claims ->> 'sub', '');
  end if;

  if v_claim_role_setting is not null
     and v_claim_role_json is not null
     and v_claim_role_setting <> v_claim_role_json then
    raise exception using
      errcode = '42501',
      message = 'commercial message session writer is not authorized';
  end if;

  if v_claim_sub_setting is not null
     and v_claim_sub_json is not null
     and v_claim_sub_setting <> v_claim_sub_json then
    raise exception using
      errcode = '42501',
      message = 'commercial message session writer is not authorized';
  end if;

  v_claim_role := coalesce(v_claim_role_setting, v_claim_role_json);

  if v_set_role in ('authenticated', 'service_role', 'anon') then
    if v_claim_role is not null and v_claim_role <> v_set_role then
      raise exception using
        errcode = '42501',
        message = 'commercial message session writer is not authorized';
    end if;
    v_request_role := v_set_role;
  elsif session_user = 'postgres'
        and (v_set_role is null or v_set_role = 'postgres') then
    if v_claim_role is not null then
      raise exception using
        errcode = '42501',
        message = 'commercial message session writer is not authorized';
    end if;
    v_request_role := 'postgres';
  else
    raise exception using
      errcode = '42501',
      message = 'commercial message session writer is not authorized';
  end if;

  begin
    v_request_sub := coalesce(v_claim_sub_setting, v_claim_sub_json)::uuid;
  exception
    when invalid_text_representation then
      raise exception using
        errcode = '42501',
        message = 'commercial message session writer is not authorized';
  end;

  if v_request_role = 'anon' then
    raise exception using
      errcode = '42501',
      message = 'commercial message session writer is not authorized';
  end if;

  if v_request_role = 'authenticated' then
    if v_request_sub is null
       or not exists (
         select 1
         from public.memberships membership_row
         where membership_row.organization_id = p_organization_id
           and membership_row.user_id = v_request_sub
       ) then
      raise exception using
        errcode = '42501',
        message = 'commercial message session writer is not authorized';
    end if;

    v_link_source := 'manual';
    v_link_actor_type := 'human';
    v_link_actor_user_id := v_request_sub;
  else
    v_link_source := 'system';
    v_link_actor_type := 'system';
    v_link_actor_user_id := null;
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_conversation_id is null then
    raise exception using
      errcode = '22004',
      message = 'commercial message session writer input is incomplete';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'zion:p9:b1:e1.4:commercial-conversation-session:' || p_conversation_id::text,
      0
    )
  );

  select conversation_row.*
  into v_conversation
  from public.conversations conversation_row
  where conversation_row.id = p_conversation_id
  for update;

  if not found or v_conversation.organization_id is distinct from p_organization_id then
    raise exception using
      errcode = '23514',
      message = 'commercial message session writer relation mismatch';
  end if;

  select lead_row.*
  into v_lead
  from public.leads lead_row
  where lead_row.id = v_conversation.lead_id
  for update;

  if not found
     or v_lead.organization_id is distinct from p_organization_id
     or v_lead.store_id is distinct from p_store_id then
    raise exception using
      errcode = '23514',
      message = 'commercial message session writer relation mismatch';
  end if;

  select store_row.*
  into v_store
  from public.stores store_row
  where store_row.id = p_store_id
    and store_row.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'commercial message session writer relation mismatch';
  end if;

  select session_row.*
  into v_existing_session
  from public.conversation_sessions session_row
  where session_row.organization_id = p_organization_id
    and session_row.store_id = p_store_id
    and session_row.conversation_id = p_conversation_id
    and session_row.status = 'active'
  for update;

  if not found then
    begin
      insert into public.conversation_sessions (
        organization_id,
        store_id,
        conversation_id,
        status
      )
      values (
        p_organization_id,
        p_store_id,
        p_conversation_id,
        'active'
      )
      returning * into v_existing_session;

      v_session_created := true;
    exception
      when unique_violation then
        select session_row.*
        into v_existing_session
        from public.conversation_sessions session_row
        where session_row.organization_id = p_organization_id
          and session_row.store_id = p_store_id
          and session_row.conversation_id = p_conversation_id
          and session_row.status = 'active'
        for update;

        if not found then
          raise;
        end if;
    end;
  end if;

  select context_row.*
  into v_existing_context
  from public.commercial_session_context_links context_row
  where context_row.organization_id = p_organization_id
    and context_row.store_id = p_store_id
    and context_row.conversation_session_id = v_existing_session.id
    and context_row.status = 'active'
  for update;

  if found then
    return query
    select
      v_existing_session.id,
      v_existing_context.id,
      v_existing_context.commercial_opportunity_id,
      'existing_captured'::text,
      v_session_created,
      false;
    return;
  end if;

  select
    count(*),
    count(distinct link_row.customer_id),
    array_agg(link_row.id order by link_row.id),
    array_agg(link_row.customer_id order by link_row.id)
  into
    v_active_link_count,
    v_active_customer_count,
    v_lead_customer_link_ids,
    v_link_customer_ids
  from public.lead_customer_links link_row
  where link_row.organization_id = p_organization_id
    and link_row.store_id = p_store_id
    and link_row.lead_id = v_lead.id
    and link_row.status = 'active'
    and link_row.unlinked_at is null;

  if coalesce(v_active_link_count, 0) <> 1
     or coalesce(v_active_customer_count, 0) <> 1
     or coalesce(pg_catalog.array_length(v_lead_customer_link_ids, 1), 0) <> 1
     or coalesce(pg_catalog.array_length(v_link_customer_ids, 1), 0) <> 1
     or v_lead_customer_link_ids[1] is null
     or v_link_customer_ids[1] is null then
    return query
    select
      v_existing_session.id,
      null::uuid,
      null::uuid,
      'pending_context'::text,
      v_session_created,
      false;
    return;
  end if;

  select
    count(*),
    count(distinct opportunity_row.customer_id),
    array_agg(opportunity_row.id order by opportunity_row.id),
    array_agg(opportunity_row.customer_id order by opportunity_row.id)
  into
    v_explicit_opportunity_count,
    v_explicit_opportunity_customer_count,
    v_commercial_opportunity_ids,
    v_opportunity_customer_ids
  from public.commercial_opportunities opportunity_row
  where opportunity_row.organization_id = p_organization_id
    and opportunity_row.store_id = p_store_id
    and opportunity_row.customer_id = v_link_customer_ids[1]
    and opportunity_row.primary_conversation_id = p_conversation_id
    and opportunity_row.origin_lead_id = v_lead.id;

  if coalesce(v_explicit_opportunity_count, 0) <> 1
     or coalesce(v_explicit_opportunity_customer_count, 0) <> 1
     or coalesce(pg_catalog.array_length(v_commercial_opportunity_ids, 1), 0) <> 1
     or coalesce(pg_catalog.array_length(v_opportunity_customer_ids, 1), 0) <> 1
     or v_commercial_opportunity_ids[1] is null
     or v_opportunity_customer_ids[1] is distinct from v_link_customer_ids[1] then
    return query
    select
      v_existing_session.id,
      null::uuid,
      null::uuid,
      'pending_context'::text,
      v_session_created,
      false;
    return;
  end if;

  v_link_idempotency_key := pg_catalog.format(
    'zion:first-commercial-context:%s:%s:%s:%s',
    p_organization_id,
    p_store_id,
    v_existing_session.id,
    v_commercial_opportunity_ids[1]
  );

  begin
    select *
    into v_created_context
    from public.link_commercial_session_context(
      p_organization_id,
      p_store_id,
      v_existing_session.id,
      v_link_customer_ids[1],
      v_commercial_opportunity_ids[1],
      v_lead_customer_link_ids[1],
      v_link_source,
      v_link_actor_type,
      v_link_actor_user_id,
      pg_catalog.format(
        'ensure_commercial_conversation_session_context:%s',
        p_conversation_id
      ),
      v_link_idempotency_key,
      null,
      jsonb_build_object(
        'writer', 'ensure_commercial_conversation_session_context',
        'auto_link', true,
        'mode', 'explicit_primary_conversation'
      ),
      null
    );
    v_context_created := true;
  exception
    when unique_violation then
      select context_row.*
      into v_created_context
      from public.commercial_session_context_links context_row
      where context_row.organization_id = p_organization_id
        and context_row.store_id = p_store_id
        and context_row.conversation_session_id = v_existing_session.id
        and context_row.status = 'active'
      for update;

      if not found then
        raise;
      end if;
      v_context_created := false;
  end;

  return query
  select
    v_existing_session.id,
    v_created_context.id,
    v_created_context.commercial_opportunity_id,
    case
      when v_context_created then 'captured'::text
      else 'existing_captured'::text
    end,
    v_session_created,
    v_context_created;
end;
$function$;

alter function public.ensure_commercial_conversation_session_context(
  uuid,
  uuid,
  uuid
) owner to postgres;

comment on function public.ensure_commercial_conversation_session_context(
  uuid,
  uuid,
  uuid
) is
  'Cria ou reutiliza a conversation_session ativa de uma conversa e tenta vincular com seguranca o primeiro contexto comercial explicito pela primary_conversation_id.';

revoke all on function public.ensure_commercial_conversation_session_context(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated, service_role;

grant execute on function public.ensure_commercial_conversation_session_context(
  uuid,
  uuid,
  uuid
) to service_role;

create or replace function public.insert_message(
  p_conversation_id uuid,
  p_sender text,
  p_direction text,
  p_message_type text,
  p_content text,
  p_external_message_id text default null,
  p_media_url text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.messages
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_org_id uuid;
  v_lead_id uuid;
  v_store_id uuid;
  v_row public.messages;
  v_content text;
  v_sender text;
  v_direction text;
  v_message_type text;
begin
  perform set_config('app.insert_via_function', 'true', true);

  v_sender := lower(trim(p_sender));
  v_direction := lower(trim(p_direction));
  v_message_type := lower(trim(p_message_type));
  v_content := nullif(btrim(p_content), '');

  select
    c.organization_id,
    c.lead_id
  into
    v_org_id,
    v_lead_id
  from public.conversations c
  where c.id = p_conversation_id;

  if v_org_id is null then
    raise exception 'conversation_not_found: %', p_conversation_id;
  end if;

  if v_lead_id is null then
    raise exception 'conversation_without_lead: %', p_conversation_id;
  end if;

  select l.store_id
  into v_store_id
  from public.leads l
  where l.id = v_lead_id;

  if not found then
    raise exception 'lead_not_found_for_conversation: %, lead_id=%', p_conversation_id, v_lead_id;
  end if;

  if v_store_id is null then
    raise exception 'lead_without_store: %, lead_id=%', p_conversation_id, v_lead_id;
  end if;

  if v_sender not in ('user', 'ai', 'human') then
    raise exception 'invalid_sender: %', p_sender;
  end if;

  if v_direction not in ('incoming', 'outgoing') then
    raise exception 'invalid_direction: %', p_direction;
  end if;

  if v_message_type not in ('text', 'image', 'audio', 'video', 'document') then
    raise exception 'invalid_message_type: %', p_message_type;
  end if;

  if v_message_type = 'text' and v_content is null then
    raise exception 'text_message_requires_content';
  end if;

  if v_message_type = 'text' and p_media_url is not null then
    raise exception 'text_message_cannot_have_media_url';
  end if;

  if v_message_type in ('image', 'audio', 'video', 'document') and p_media_url is null then
    raise exception 'media_message_requires_media_url: %', v_message_type;
  end if;

  if v_message_type in ('image', 'audio', 'video', 'document') and v_content is null then
    raise exception 'media_message_requires_content: %', v_message_type;
  end if;

  perform public.ensure_commercial_conversation_session_context(
    v_org_id,
    v_store_id,
    p_conversation_id
  );

  insert into public.messages (
    organization_id,
    conversation_id,
    sender,
    direction,
    message_type,
    content,
    external_message_id,
    media_url,
    metadata,
    lead_id,
    store_id
  )
  values (
    v_org_id,
    p_conversation_id,
    v_sender,
    v_direction,
    v_message_type,
    v_content,
    p_external_message_id,
    p_media_url,
    coalesce(p_metadata, '{}'::jsonb),
    v_lead_id,
    v_store_id
  )
  returning * into v_row;

  return v_row;
end;
$function$;

alter function public.insert_message(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) owner to postgres;

do $postconditions$
declare
  v_helper_oid oid;
  v_helper_owner name;
  v_helper_acl text;
  v_helper_proconfig text;
  v_helper_prosecdef boolean;
  v_helper_provolatile "char";
  v_insert_oid oid;
  v_insert_language name;
  v_insert_result text;
  v_insert_default_count integer;
  v_insert_definition text;
  v_insert_owner name;
  v_insert_acl text;
  v_insert_comment text;
  v_insert_proconfig text;
  v_insert_provolatile "char";
  v_insert_proparallel "char";
  v_insert_prosecdef boolean;
  v_insert_definition_normalized text;
  v_insert_definition_without_helper text;
  v_insert_definition_without_helper_md5 text;
  v_insert_definition_occurrence_count integer;
  v_insert_definition_helper_block text := E'\n  perform public.ensure_commercial_conversation_session_context(\n    v_org_id,\n    v_store_id,\n    p_conversation_id\n  );\n';
  v_panel_owner name;
  v_panel_acl text;
  v_panel_proconfig text;
  v_panel_definition_md5 text;
  v_panel_scoped_owner name;
  v_panel_scoped_acl text;
  v_panel_scoped_proconfig text;
  v_panel_scoped_definition_md5 text;
begin
  v_helper_oid := pg_catalog.to_regprocedure(
    'public.ensure_commercial_conversation_session_context(uuid,uuid,uuid)'
  );
  v_insert_oid := pg_catalog.to_regprocedure(
    'public.insert_message(uuid,text,text,text,text,text,text,jsonb)'
  );

  if v_helper_oid is null or v_insert_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: required functions are missing after migration';
  end if;

  select
    role_row.rolname,
    coalesce(pg_catalog.array_to_string(proc_row.proacl, ','), ''),
    coalesce(pg_catalog.array_to_string(proc_row.proconfig, ','), ''),
    proc_row.prosecdef,
    proc_row.provolatile
  into
    v_helper_owner,
    v_helper_acl,
    v_helper_proconfig,
    v_helper_prosecdef,
    v_helper_provolatile
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_roles role_row
    on role_row.oid = proc_row.proowner
  where proc_row.oid = v_helper_oid;

  if v_helper_owner <> 'postgres'
     or not v_helper_prosecdef
     or v_helper_provolatile <> 'v'
     or pg_catalog.strpos(v_helper_proconfig, 'search_path=pg_catalog, pg_temp, public') = 0
     or pg_catalog.strpos(v_helper_proconfig, 'row_security=off') = 0
     or has_function_privilege('anon', v_helper_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_helper_oid, 'EXECUTE')
     or not has_function_privilege('service_role', v_helper_oid, 'EXECUTE')
     or exists (
       select 1
       from pg_catalog.aclexplode((select proc_row.proacl from pg_catalog.pg_proc proc_row where proc_row.oid = v_helper_oid)) acl_row
       where acl_row.grantee = 0
         and acl_row.privilege_type = 'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: helper security contract mismatch';
  end if;

  select
    pg_catalog.pg_get_functiondef(proc_row.oid),
    role_row.rolname,
    language_row.lanname,
    pg_catalog.pg_get_function_result(proc_row.oid),
    proc_row.pronargdefaults,
    coalesce(pg_catalog.array_to_string(proc_row.proacl, ','), ''),
    pg_catalog.obj_description(proc_row.oid, 'pg_proc'),
    coalesce(pg_catalog.array_to_string(proc_row.proconfig, ','), ''),
    proc_row.provolatile,
    proc_row.proparallel,
    proc_row.prosecdef
  into
    v_insert_definition,
    v_insert_owner,
    v_insert_language,
    v_insert_result,
    v_insert_default_count,
    v_insert_acl,
    v_insert_comment,
    v_insert_proconfig,
    v_insert_provolatile,
    v_insert_proparallel,
    v_insert_prosecdef
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_roles role_row
    on role_row.oid = proc_row.proowner
  join pg_catalog.pg_language language_row
    on language_row.oid = proc_row.prolang
  where proc_row.oid = v_insert_oid;

  v_insert_definition_normalized := replace(
    replace(v_insert_definition, E'\r\n', E'\n'),
    E'\r',
    E'\n'
  );
  v_insert_definition_occurrence_count :=
    (
      pg_catalog.length(v_insert_definition_normalized)
      - pg_catalog.length(
          replace(
            v_insert_definition_normalized,
            'perform public.ensure_commercial_conversation_session_context',
            ''
          )
        )
    )
    / pg_catalog.length('perform public.ensure_commercial_conversation_session_context');
v_insert_definition_without_helper := replace(
v_insert_definition_normalized,
v_insert_definition_helper_block,
''
);
  v_insert_definition_without_helper_md5 := md5(v_insert_definition_without_helper);

  select
    role_row.rolname,
    coalesce(pg_catalog.array_to_string(proc_row.proacl, ','), ''),
    coalesce(pg_catalog.array_to_string(proc_row.proconfig, ','), ''),
    md5(pg_catalog.pg_get_functiondef(proc_row.oid))
  into
    v_panel_owner,
    v_panel_acl,
    v_panel_proconfig,
    v_panel_definition_md5
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_roles role_row
    on role_row.oid = proc_row.proowner
  where proc_row.oid = (
    select panel_send_message_oid
    from pg_temp._p9_e14_writer_baseline
  );

  select
    role_row.rolname,
    coalesce(pg_catalog.array_to_string(proc_row.proacl, ','), ''),
    coalesce(pg_catalog.array_to_string(proc_row.proconfig, ','), ''),
    md5(pg_catalog.pg_get_functiondef(proc_row.oid))
  into
    v_panel_scoped_owner,
    v_panel_scoped_acl,
    v_panel_scoped_proconfig,
    v_panel_scoped_definition_md5
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_roles role_row
    on role_row.oid = proc_row.proowner
  where proc_row.oid = (
    select panel_send_message_scoped_oid
    from pg_temp._p9_e14_writer_baseline
  );

  if v_insert_owner is distinct from (
       select insert_message_owner from pg_temp._p9_e14_writer_baseline
     )
     or v_insert_language is distinct from (
       select insert_message_language from pg_temp._p9_e14_writer_baseline
     )
     or v_insert_result is distinct from (
       select insert_message_result from pg_temp._p9_e14_writer_baseline
     )
     or v_insert_default_count is distinct from (
       select insert_message_default_count from pg_temp._p9_e14_writer_baseline
     )
     or v_insert_acl is distinct from (
       select insert_message_acl from pg_temp._p9_e14_writer_baseline
     )
     or v_insert_comment is distinct from (
       select insert_message_comment from pg_temp._p9_e14_writer_baseline
     )
     or v_insert_proconfig is distinct from (
       select insert_message_proconfig from pg_temp._p9_e14_writer_baseline
     )
     or v_insert_provolatile is distinct from (
       select insert_message_provolatile from pg_temp._p9_e14_writer_baseline
     )
     or v_insert_proparallel is distinct from (
       select insert_message_proparallel from pg_temp._p9_e14_writer_baseline
     )
     or v_insert_prosecdef is distinct from (
       select insert_message_prosecdef from pg_temp._p9_e14_writer_baseline
     )
     or v_insert_definition_occurrence_count <> 1
     or v_insert_definition_without_helper = v_insert_definition_normalized
     or v_insert_definition_without_helper_md5 is distinct from (
       select md5(insert_message_definition_text)
       from pg_temp._p9_e14_writer_baseline
     )
     or v_insert_definition_without_helper is distinct from (
       select insert_message_definition_text
       from pg_temp._p9_e14_writer_baseline
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: insert_message contract was not preserved safely';
  end if;

  if v_panel_owner is distinct from (
       select panel_send_message_owner from pg_temp._p9_e14_writer_baseline
     )
     or v_panel_acl is distinct from (
       select panel_send_message_acl from pg_temp._p9_e14_writer_baseline
     )
     or v_panel_proconfig is distinct from (
       select panel_send_message_proconfig from pg_temp._p9_e14_writer_baseline
     )
     or v_panel_definition_md5 is distinct from (
       select panel_send_message_definition_md5 from pg_temp._p9_e14_writer_baseline
     )
     or v_panel_scoped_owner is distinct from (
       select panel_send_message_scoped_owner from pg_temp._p9_e14_writer_baseline
     )
     or v_panel_scoped_acl is distinct from (
       select panel_send_message_scoped_acl from pg_temp._p9_e14_writer_baseline
     )
     or v_panel_scoped_proconfig is distinct from (
       select panel_send_message_scoped_proconfig from pg_temp._p9_e14_writer_baseline
     )
     or v_panel_scoped_definition_md5 is distinct from (
       select panel_send_message_scoped_definition_md5 from pg_temp._p9_e14_writer_baseline
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: panel_send_message or panel_send_message_scoped changed unexpectedly';
  end if;
end;
$postconditions$;

commit;

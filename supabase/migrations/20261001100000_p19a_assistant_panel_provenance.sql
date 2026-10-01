-- P19-A / Bloco 5 / Etapa 5.7
-- Keep panel and responsible WhatsApp messages in the same canonical thread,
-- while preserving the canonical responsible provenance for panel messages.

create or replace function public.assistant_send_human_message(
  p_organization_id uuid,
  p_store_id uuid,
  p_content text
)
returns public.store_assistant_messages
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_trimmed_content text := pg_catalog.btrim(coalesce(p_content, ''));
  v_responsible_id uuid;
  v_responsible_count bigint;
  v_function_row record;
  v_arg_row record;
  v_arguments text[] := array[]::text[];
  v_argument_sql text;
  v_thread_sql text;
  v_thread_json jsonb;
  v_thread_id uuid;
  v_thread_organization_id uuid;
  v_thread_store_id uuid;
  v_thread_row public.store_assistant_threads%rowtype;
  v_message public.store_assistant_messages%rowtype;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'insufficient privilege: tenant access denied';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_organization_id
      and membership_row.user_id = auth.uid()
      and membership_row.is_active is true
  ) or not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.organization_id = p_organization_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'insufficient privilege: tenant access denied';
  end if;

  if v_trimmed_content = '' then
    raise exception using
      errcode = 'P0001',
      message = 'MENSAGEM_VAZIA';
  end if;

  select count(*)::bigint, max(responsible_row.id::text)::uuid
  into v_responsible_count, v_responsible_id
  from public.store_responsibles responsible_row
  where responsible_row.organization_id = p_organization_id
    and responsible_row.store_id = p_store_id
    and responsible_row.is_primary is true
    and responsible_row.is_active is true;

  if v_responsible_count <> 1 or v_responsible_id is null then
    raise exception using
      errcode = '42501',
      message = 'canonical primary responsible unavailable';
  end if;

  select
    proc_row.oid,
    proc_row.pronargs,
    proc_row.proargnames,
    string_to_array(pg_catalog.oidvectortypes(proc_row.proargtypes), ', ') as arg_types
  into v_function_row
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname = 'assistant_get_or_create_primary_thread';

  if v_function_row.oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'assistant_get_or_create_primary_thread not found';
  end if;

  if v_function_row.pronargs < 1
     or v_function_row.proargnames is null
     or array_length(v_function_row.proargnames, 1) is distinct from v_function_row.pronargs
     or array_length(v_function_row.arg_types, 1) is distinct from v_function_row.pronargs then
    raise exception using
      errcode = 'P0001',
      message = 'assistant_get_or_create_primary_thread signature metadata is unavailable';
  end if;

  for v_arg_row in
    select
      v_function_row.proargnames[arg_index] as arg_name,
      v_function_row.arg_types[arg_index] as arg_type
    from generate_series(1, v_function_row.pronargs) arg_index
  loop
    if v_arg_row.arg_name is null or v_arg_row.arg_name = '' then
      raise exception using
        errcode = 'P0001',
        message = 'assistant_get_or_create_primary_thread contains unnamed parameters';
    end if;

    if v_arg_row.arg_type = 'uuid' then
      if v_arg_row.arg_name like '%organization%' then
        v_argument_sql := pg_catalog.format('%I => %L::uuid', v_arg_row.arg_name, p_organization_id);
      elsif v_arg_row.arg_name like '%store%' then
        v_argument_sql := pg_catalog.format('%I => %L::uuid', v_arg_row.arg_name, p_store_id);
      else
        v_argument_sql := pg_catalog.format('%I => null::uuid', v_arg_row.arg_name);
      end if;
    elsif v_arg_row.arg_type = 'jsonb' then
      v_argument_sql := pg_catalog.format('%I => ''{}''::jsonb', v_arg_row.arg_name);
    elsif v_arg_row.arg_type = 'json' then
      v_argument_sql := pg_catalog.format('%I => ''{}''::json', v_arg_row.arg_name);
    elsif v_arg_row.arg_type in ('text', 'character varying') then
      v_argument_sql := pg_catalog.format('%I => %L', v_arg_row.arg_name, 'assistant_send_human_message');
    elsif v_arg_row.arg_type = 'boolean' then
      v_argument_sql := pg_catalog.format('%I => false', v_arg_row.arg_name);
    elsif v_arg_row.arg_type = 'integer' then
      v_argument_sql := pg_catalog.format('%I => 0', v_arg_row.arg_name);
    elsif v_arg_row.arg_type = 'bigint' then
      v_argument_sql := pg_catalog.format('%I => 0::bigint', v_arg_row.arg_name);
    elsif v_arg_row.arg_type = 'timestamp with time zone' then
      v_argument_sql := pg_catalog.format('%I => pg_catalog.now()', v_arg_row.arg_name);
    else
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'assistant_get_or_create_primary_thread has unsupported parameter type %s for %s',
          v_arg_row.arg_type,
          v_arg_row.arg_name
        );
    end if;

    v_arguments := array_append(v_arguments, v_argument_sql);
  end loop;

  v_thread_sql := 'select pg_catalog.to_jsonb(thread_row) from public.assistant_get_or_create_primary_thread('
    || array_to_string(v_arguments, ', ')
    || ') as thread_row';

  execute v_thread_sql into v_thread_json;

  if v_thread_json is null then
    raise exception using
      errcode = '42501',
      message = 'assistant thread resolution failed';
  end if;

  if pg_catalog.jsonb_typeof(v_thread_json) = 'object' then
    v_thread_id := nullif(v_thread_json ->> 'id', '')::uuid;
    v_thread_organization_id := nullif(v_thread_json ->> 'organization_id', '')::uuid;
    v_thread_store_id := nullif(v_thread_json ->> 'store_id', '')::uuid;
  elsif pg_catalog.jsonb_typeof(v_thread_json) = 'string' then
    v_thread_id := trim(both '"' from v_thread_json::text)::uuid;
  end if;

  if v_thread_id is null then
    raise exception using
      errcode = '42501',
      message = 'assistant thread resolution failed';
  end if;

  if v_thread_organization_id is null or v_thread_store_id is null then
    select *
    into v_thread_row
    from public.store_assistant_threads thread_row
    where thread_row.id = v_thread_id;

    v_thread_organization_id := v_thread_row.organization_id;
    v_thread_store_id := v_thread_row.store_id;
  end if;

  if v_thread_organization_id is distinct from p_organization_id
     or v_thread_store_id is distinct from p_store_id then
    raise exception using
      errcode = '42501',
      message = 'assistant thread tenant mismatch';
  end if;

  insert into public.store_assistant_messages (
    organization_id,
    store_id,
    thread_id,
    sender,
    sender_role,
    direction,
    message_type,
    content,
    metadata
  )
  values (
    p_organization_id,
    p_store_id,
    v_thread_id,
    'human',
    'store_responsible',
    'incoming',
    'text',
    v_trimmed_content,
    pg_catalog.jsonb_build_object(
      'origin', 'panel',
      'channel', 'panel',
      'responsible_id', v_responsible_id
    )
  )
  returning *
  into v_message;

  update public.store_assistant_threads thread_row
  set
    last_message_at = coalesce(v_message.created_at, pg_catalog.clock_timestamp()),
    last_message_preview = v_trimmed_content,
    updated_at = pg_catalog.clock_timestamp()
  where thread_row.id = v_thread_id
    and thread_row.organization_id = p_organization_id
    and thread_row.store_id = p_store_id;

  return v_message;
end;
$function$;

revoke execute on function public.assistant_send_human_message(uuid, uuid, text)
from public, anon, service_role;
grant execute on function public.assistant_send_human_message(uuid, uuid, text)
to authenticated;

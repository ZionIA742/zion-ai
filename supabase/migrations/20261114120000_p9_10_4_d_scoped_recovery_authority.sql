-- P9 10.4-D: escopo transacional somente para efeitos vinculados
-- a um conjunto de resposta confirmado. O identificador persistido serve
-- apenas para localizar a autoridade; a autoridade é revalidada abaixo.

begin;

alter table public.conversation_ai_window_state
  add column if not exists p9_recovery_response_set_id uuid null;

alter table public.store_assistant_threads
  add column if not exists p9_recovery_response_set_id uuid null;

create or replace function public.p9_10_4_d_assert_recovery_set_authority(
  p_response_set_id uuid,
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_anchor_message_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_set public.p19a_sales_ai_reply_sets%rowtype;
begin
  if p_response_set_id is null then
    raise exception using errcode = '22023', message = 'P9_10_4_D_RECOVERY_SET_REQUIRED';
  end if;

  perform public.p9_10_4_d_assert_recovery_write_authority(
    p_organization_id, p_store_id, p_conversation_id
  );

  select * into v_set
    from public.p19a_sales_ai_reply_sets
   where id = p_response_set_id
     and organization_id = p_organization_id
     and store_id = p_store_id
     and conversation_id = p_conversation_id
     and materialization_state = 'confirmed'
     and confirmed_at is not null
   for update;

  if not found then
    raise exception using errcode = '42501', message = 'P9_10_4_D_RECOVERY_SET_SCOPE_MISMATCH';
  end if;

  if p_anchor_message_id is not null
     and v_set.anchor_message_id is distinct from p_anchor_message_id then
    raise exception using errcode = 'P9_10_4_D_RECOVERY_ANCHOR_MISMATCH';
  end if;

  if exists (
    select 1
      from public.messages newer
     where newer.organization_id = v_set.organization_id
       and newer.store_id = v_set.store_id
       and newer.conversation_id = v_set.conversation_id
       and newer.created_at > (
         select anchor.created_at
           from public.messages anchor
          where anchor.id = v_set.anchor_message_id
            and anchor.organization_id = v_set.organization_id
            and anchor.store_id = v_set.store_id
       )
       and (newer.sender = 'human' or newer.direction = 'inbound')
  ) then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_RECOVERY_CONTEXT_STALE';
  end if;
end;
$function$;

create or replace function public.p9_10_4_d_guard_recovery_row_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_row jsonb := to_jsonb(new);
  v_set_id uuid := nullif(v_row ->> 'p9_recovery_response_set_id', '')::uuid;
  v_organization_id uuid := nullif(v_row ->> 'organization_id', '')::uuid;
  v_store_id uuid := nullif(v_row ->> 'store_id', '')::uuid;
  v_conversation_id uuid := coalesce(
    nullif(v_row ->> 'conversation_id', ''),
    nullif(v_row ->> 'related_conversation_id', '')
  )::uuid;
  v_anchor_id uuid := nullif(v_row ->> 'anchor_message_id', '')::uuid;
begin
  if v_set_id is null and TG_TABLE_NAME = 'ai_run_queue'
     and v_row -> 'input' ->> 'type' = 'sales_ai_post_materialization_recovery' then
    v_set_id := nullif(v_row -> 'input' ->> 'responseSetId', '')::uuid;
    v_anchor_id := nullif(v_row -> 'input' ->> 'anchorMessageId', '')::uuid;
  end if;
  if v_set_id is null then
    v_set_id := coalesce(
      nullif(v_row -> 'task_payload' ->> 'p9_recovery_response_set_id', '')::uuid,
      nullif(v_row -> 'payload' ->> 'p9_recovery_response_set_id', '')::uuid,
      nullif(v_row -> 'context' ->> 'p9_recovery_response_set_id', '')::uuid,
      nullif(v_row -> 'metadata' ->> 'p9_recovery_response_set_id', '')::uuid
    );
  end if;
  if v_conversation_id is null and v_set_id is not null then
    select s.conversation_id, s.organization_id, s.store_id, s.anchor_message_id
      into v_conversation_id, v_organization_id, v_store_id, v_anchor_id
      from public.p19a_sales_ai_reply_sets s
     where s.id = v_set_id;
  end if;
  if v_set_id is null then
    return new;
  end if;
  perform public.p9_10_4_d_assert_recovery_set_authority(
    v_set_id, v_organization_id, v_store_id, v_conversation_id, v_anchor_id
  );
  return new;
end;
$function$;

do $triggers$
declare
  v_table text;
  v_trigger text;
begin
  foreach v_table in array array[
    'commercial_opportunity_cross_sell_suggestions',
    'conversation_ai_window_state',
    'store_assistant_messages',
    'store_assistant_notification_queue',
    'store_assistant_operational_tasks',
    'store_assistant_operational_task_queue',
    'store_assistant_threads',
    'ai_run_queue'
  ] loop
    if pg_catalog.to_regclass('public.' || v_table) is null then
      raise exception using errcode = 'P0001', message = 'P9_10_4_D_REQUIRED_WRITER_TABLE_MISSING:' || v_table;
    end if;
    v_trigger := 'trg_p9_10_4_d_recovery_' || v_table;
    execute pg_catalog.format('drop trigger if exists %I on public.%I', v_trigger, v_table);
    execute pg_catalog.format(
      'create trigger %I before insert or update on public.%I for each row execute function public.p9_10_4_d_guard_recovery_row_write()',
      v_trigger, v_table
    );
  end loop;
end;
$triggers$;

alter function public.p9_10_4_d_assert_recovery_set_authority(uuid,uuid,uuid,uuid,uuid) owner to postgres;
alter function public.p9_10_4_d_guard_recovery_row_write() owner to postgres;
revoke all on function public.p9_10_4_d_assert_recovery_set_authority(uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.p9_10_4_d_guard_recovery_row_write() from public, anon, authenticated;
grant execute on function public.p9_10_4_d_assert_recovery_set_authority(uuid,uuid,uuid,uuid,uuid) to service_role;

commit;

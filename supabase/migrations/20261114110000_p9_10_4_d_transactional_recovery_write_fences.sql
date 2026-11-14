-- P9 10.4-D: transactional fences for every post-materialization writer.
-- The trigger executes in the writer transaction.  The conversation lock is
-- acquired before the lease lock and both remain held until COMMIT/ROLLBACK.

begin;

create or replace function public.p9_10_4_d_assert_recovery_write_authority(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_conversation public.conversations%rowtype;
  v_lease public.conversation_human_takeover_leases%rowtype;
begin
  if p_organization_id is null or p_store_id is null or p_conversation_id is null then
    raise exception using errcode = '22023', message = 'P9_10_4_D_RECOVERY_SCOPE_REQUIRED';
  end if;

  -- Canonical lock order: conversation -> lease.
  select c.* into v_conversation
    from public.conversations c
    join public.leads l
      on l.id = c.lead_id
     and l.organization_id = p_organization_id
     and l.store_id = p_store_id
    join public.stores s
      on s.id = l.store_id
     and s.organization_id = l.organization_id
   where c.id = p_conversation_id
     and c.organization_id = p_organization_id
   for update of c;

  if not found then
    raise exception using errcode = '42501', message = 'P9_10_4_D_RECOVERY_SCOPE_MISMATCH';
  end if;

  select h.* into v_lease
    from public.conversation_human_takeover_leases h
   where h.conversation_id = p_conversation_id
     and h.organization_id = p_organization_id
     and h.store_id = p_store_id
   for update;

  if coalesce(v_conversation.is_human_active, false)
     or pg_catalog.lower(pg_catalog.btrim(coalesce(v_conversation.status, ''))) = 'humano_assumiu'
     or coalesce(v_lease.hard_hold, false)
     or (v_lease.conversation_id is not null and v_lease.released_at is null) then
    raise exception using
      errcode = 'P0001',
      message = 'P9_10_4_D_RECOVERY_BLOCKED_BY_HUMAN_TAKEOVER';
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
  v_organization_id uuid := nullif(v_row ->> 'organization_id', '')::uuid;
  v_store_id uuid := nullif(v_row ->> 'store_id', '')::uuid;
  v_conversation_id uuid := coalesce(
    nullif(v_row ->> 'conversation_id', ''),
    nullif(v_row ->> 'related_conversation_id', '')
  )::uuid;
  v_opportunity_id uuid := coalesce(
    nullif(v_row ->> 'commercial_opportunity_id', ''),
    nullif(v_row -> 'context' ->> 'commercial_opportunity_id', ''),
    nullif(v_row -> 'metadata' ->> 'commercial_opportunity_id', ''),
    nullif(v_row -> 'task_payload' -> 'quote_preparation' ->> 'commercial_opportunity_id', '')
  )::uuid;
  v_anchor_message_id uuid := coalesce(
    nullif(v_row ->> 'anchor_message_id', ''),
    nullif(v_row -> 'context' ->> 'source_message_id', ''),
    nullif(v_row -> 'metadata' ->> 'source_message_id', ''),
    nullif(v_row -> 'task_payload' -> 'quote_preparation' ->> 'request_message_id', '')
  )::uuid;
  v_anchor_created_at timestamptz;
begin
  -- Rows without a conversation are not a recovery effect and cannot be
  -- attributed safely to this 10.4-D authority.
  if v_conversation_id is null then
    return new;
  end if;

  perform public.p9_10_4_d_assert_recovery_write_authority(
    v_organization_id, v_store_id, v_conversation_id
  );

  if v_opportunity_id is not null then
    perform 1
      from public.commercial_opportunities o
     where o.id = v_opportunity_id
       and o.organization_id = v_organization_id
       and o.store_id = v_store_id
       and o.primary_conversation_id = v_conversation_id
     for update;
    if not found then
      raise exception using errcode = '42501', message = 'P9_10_4_D_RECOVERY_OPPORTUNITY_SCOPE_MISMATCH';
    end if;
  end if;

  if v_anchor_message_id is not null then
    select m.created_at into v_anchor_created_at
      from public.messages m
     where m.id = v_anchor_message_id
       and m.organization_id = v_organization_id
       and m.store_id = v_store_id
       and m.conversation_id = v_conversation_id
       and (m.sender = 'human' or m.direction = 'inbound');
    if not found then
      raise exception using errcode = '42501', message = 'P9_10_4_D_RECOVERY_ANCHOR_SCOPE_MISMATCH';
    end if;
    if exists (
      select 1
        from public.messages newer
       where newer.organization_id = v_organization_id
         and newer.store_id = v_store_id
         and newer.conversation_id = v_conversation_id
         and newer.created_at > v_anchor_created_at
         and (newer.sender = 'human' or newer.direction = 'inbound')
    ) then
      raise exception using errcode = 'P0001', message = 'P9_10_4_D_RECOVERY_CONTEXT_STALE';
    end if;
  end if;
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

do $stage_patch$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.apply_commercial_opportunity_stage_transition_internal(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text,uuid)'
  );
  v_definition text;
  v_anchor constant text := $anchor$
  if v_opportunity.organization_id is distinct from p_organization_id
     or v_opportunity.store_id is distinct from p_store_id then
    raise exception using
      errcode = '23514',
      message = 'commercial opportunity scope mismatch';
  end if;
$anchor$;
  v_guard constant text := $guard$
  if v_source like 'ai_sales%'
     and v_opportunity.primary_conversation_id is not null then
    perform public.p9_10_4_d_assert_recovery_write_authority(
      p_organization_id,
      p_store_id,
      v_opportunity.primary_conversation_id
    );
  end if;
$guard$;
begin
  if v_oid is null then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_STAGE_AUTHORITY_MISSING';
  end if;
  select pg_catalog.pg_get_functiondef(v_oid) into v_definition;
  if pg_catalog.strpos(v_definition, 'p9_10_4_d_assert_recovery_write_authority') > 0 then
    return;
  end if;
  if pg_catalog.strpos(v_definition, v_anchor) = 0 then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_STAGE_AUTHORITY_DRIFT';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_anchor, v_anchor || E'\n' || v_guard);
  execute v_definition;
end;
$stage_patch$;

alter function public.p9_10_4_d_assert_recovery_write_authority(uuid, uuid, uuid)
  owner to postgres;
alter function public.p9_10_4_d_guard_recovery_row_write()
  owner to postgres;
revoke all on function public.p9_10_4_d_assert_recovery_write_authority(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.p9_10_4_d_guard_recovery_row_write()
  from public, anon, authenticated;
grant execute on function public.p9_10_4_d_assert_recovery_write_authority(uuid, uuid, uuid)
  to service_role;

do $postconditions$
declare
  v_guard text := pg_catalog.pg_get_functiondef(
    'public.p9_10_4_d_assert_recovery_write_authority(uuid,uuid,uuid)'::regprocedure
  );
  v_trigger_count integer;
begin
  select count(*) into v_trigger_count
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and t.tgname like 'trg_p9_10_4_d_recovery_%'
     and not t.tgisinternal;
  if pg_catalog.strpos(v_guard, 'for update of c') = 0
     or pg_catalog.strpos(v_guard, 'conversation_human_takeover_leases') = 0
     or pg_catalog.strpos(v_guard, 'humano_assumiu') = 0
     or v_trigger_count < 7 then
    raise exception using errcode = 'P0001', message = 'P9_10_4_D_TRANSACTIONAL_FENCE_POSTCONDITION_FAILED';
  end if;
end;
$postconditions$;

commit;

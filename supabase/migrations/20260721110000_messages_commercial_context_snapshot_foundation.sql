begin;

do $preflight$
declare
  v_expected_columns text[] := array[
    'id',
    'organization_id',
    'conversation_id',
    'sender',
    'content',
    'created_at',
    'lead_id',
    'store_id',
    'metadata',
    'external_message_id',
    'media_url',
    'message_type',
    'direction',
    'read_at',
    'delivered_at',
    'edited_at',
    'deleted_at'
  ];
  v_actual_columns text[];
  v_total_columns integer;
  v_new_columns_present integer;
  v_fill_function_sql text;
  v_fill_function_search_path text;
  v_fill_function_acl text;
  v_fill_function_owner oid;
  v_fill_function_prosecdef boolean;
  v_fill_function_provolatile "char";
  v_trigger_tgfoid oid;
  v_trigger_tgenabled "char";
  v_trigger_tgtype smallint;
  v_legacy_message_count bigint;
begin
  if pg_catalog.to_regclass('public.messages') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.messages does not exist';
  end if;

  if pg_catalog.to_regclass('public.conversation_sessions') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.conversation_sessions does not exist';
  end if;

  if pg_catalog.to_regclass('public.commercial_session_context_links') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.commercial_session_context_links does not exist';
  end if;

  if pg_catalog.to_regprocedure('public.fill_messages_lead_store_from_conversation()') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.fill_messages_lead_store_from_conversation() does not exist';
  end if;

  if (
    select count(distinct procedure_row.proname)
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = procedure_row.pronamespace
    where namespace_row.nspname = 'public'
      and procedure_row.proname in (
        'insert_message',
        'panel_send_message',
        'panel_send_message_scoped',
        'mark_message_external_sent'
      )
  ) <> 4 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: one or more message RPCs are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'postgres'
  ) or not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'service_role'
  ) or not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'authenticated'
  ) or not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'anon'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: required API roles are missing';
  end if;

  lock table public.messages in share row exclusive mode;

  select
    pg_catalog.array_agg(column_row.column_name::text order by column_row.ordinal_position)
  into
    v_actual_columns
  from information_schema.columns column_row
  where column_row.table_schema = 'public'
    and column_row.table_name = 'messages'
    and column_row.column_name not in (
      'conversation_session_id',
      'commercial_session_context_link_id',
      'commercial_context_capture_state'
    );

  select count(*)
  into v_total_columns
  from information_schema.columns column_row
  where column_row.table_schema = 'public'
    and column_row.table_name = 'messages';

  if v_actual_columns is distinct from v_expected_columns then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.messages does not match the approved 17-column legacy contract';
  end if;

  select count(*)
  into v_new_columns_present
  from information_schema.columns column_row
  where column_row.table_schema = 'public'
    and column_row.table_name = 'messages'
    and column_row.column_name in (
      'conversation_session_id',
      'commercial_session_context_link_id',
      'commercial_context_capture_state'
    );

  if v_total_columns not in (17, 20) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.messages column count diverged unexpectedly';
  end if;

  if v_new_columns_present not in (0, 3) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.messages contains a partial commercial context snapshot rollout';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    join pg_catalog.pg_namespace index_namespace
      on index_namespace.oid = index_relation.relnamespace
    join pg_catalog.pg_class table_relation
      on table_relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = table_relation.relnamespace
    where index_namespace.nspname = 'public'
      and index_relation.relname = 'conversation_sessions_id_org_store_uidx'
      and table_namespace.nspname = 'public'
      and table_relation.relname = 'conversation_sessions'
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indpred is null
      and index_row.indexprs is null
      and (
        select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
        from pg_catalog.unnest(index_row.indkey::smallint[])
             with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = index_row.indrelid
         and attribute_row.attnum = key_column.attnum
      ) = array['id', 'organization_id', 'store_id']::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: conversation_sessions_id_org_store_uidx is missing or invalid';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    join pg_catalog.pg_namespace index_namespace
      on index_namespace.oid = index_relation.relnamespace
    join pg_catalog.pg_class table_relation
      on table_relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = table_relation.relnamespace
    where index_namespace.nspname = 'public'
      and index_relation.relname = 'commercial_session_context_links_id_org_store_session_uidx'
      and table_namespace.nspname = 'public'
      and table_relation.relname = 'commercial_session_context_links'
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indpred is null
      and index_row.indexprs is null
      and (
        select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
        from pg_catalog.unnest(index_row.indkey::smallint[])
             with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = index_row.indrelid
         and attribute_row.attnum = key_column.attnum
      ) = array['id', 'organization_id', 'store_id', 'conversation_session_id']::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: commercial_session_context_links_id_org_store_session_uidx is missing or invalid';
  end if;

  select
    pg_catalog.pg_get_functiondef('public.fill_messages_lead_store_from_conversation()'::pg_catalog.regprocedure),
    procedure_row.proowner,
    coalesce(pg_catalog.array_to_string(procedure_row.proacl, ','), ''),
    procedure_row.prosecdef,
    procedure_row.provolatile,
    (
      select config_entry
      from pg_catalog.unnest(coalesce(procedure_row.proconfig, '{}'::text[])) config_entry
      where config_entry like 'search_path=%'
      limit 1
    )
  into
    v_fill_function_sql,
    v_fill_function_owner,
    v_fill_function_acl,
    v_fill_function_prosecdef,
    v_fill_function_provolatile,
    v_fill_function_search_path
  from pg_catalog.pg_proc procedure_row
  where procedure_row.oid = 'public.fill_messages_lead_store_from_conversation()'::pg_catalog.regprocedure;

  if pg_catalog.strpos(pg_catalog.lower(v_fill_function_sql), 'new.organization_id') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_fill_function_sql), 'new.lead_id') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_fill_function_sql), 'new.store_id') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_fill_function_sql), 'public.conversations') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: fill_messages_lead_store_from_conversation() no longer contains the approved organization/lead/store fill behavior';
  end if;

  select
    trigger_row.tgfoid,
    trigger_row.tgenabled,
    trigger_row.tgtype
  into
    v_trigger_tgfoid,
    v_trigger_tgenabled,
    v_trigger_tgtype
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgrelid = 'public.messages'::pg_catalog.regclass
    and not trigger_row.tgisinternal
    and trigger_row.tgname = 'trg_fill_messages_lead_store';

  if v_trigger_tgfoid is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: trg_fill_messages_lead_store is missing';
  end if;

  select count(*)
  into v_legacy_message_count
  from public.messages;

  create temp table pg_temp._p9_messages_context_snapshot_baseline (
    already_applied boolean not null,
    legacy_message_count bigint not null,
    fill_function_owner oid not null,
    fill_function_acl text not null,
    fill_function_prosecdef boolean not null,
    fill_function_provolatile "char" not null,
    fill_function_search_path text null,
    trigger_tgfoid oid not null,
    trigger_tgenabled "char" not null,
    trigger_tgtype smallint not null
  ) on commit drop;

  insert into pg_temp._p9_messages_context_snapshot_baseline (
    already_applied,
    legacy_message_count,
    fill_function_owner,
    fill_function_acl,
    fill_function_prosecdef,
    fill_function_provolatile,
    fill_function_search_path,
    trigger_tgfoid,
    trigger_tgenabled,
    trigger_tgtype
  ) values (
    v_new_columns_present = 3,
    v_legacy_message_count,
    v_fill_function_owner,
    v_fill_function_acl,
    v_fill_function_prosecdef,
    v_fill_function_provolatile,
    v_fill_function_search_path,
    v_trigger_tgfoid,
    v_trigger_tgenabled,
    v_trigger_tgtype
  );

  create temp table pg_temp._p9_messages_context_snapshot_rpc_baseline
  on commit drop
  as
  select
    procedure_row.proname::text as routine_name,
    procedure_row.oid::pg_catalog.regprocedure::text as regprocedure_text,
    pg_catalog.pg_get_function_identity_arguments(procedure_row.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(procedure_row.oid) as result_signature
  from pg_catalog.pg_proc procedure_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = procedure_row.pronamespace
  where namespace_row.nspname = 'public'
    and procedure_row.proname in (
      'insert_message',
      'panel_send_message',
      'panel_send_message_scoped',
      'mark_message_external_sent'
    )
  order by procedure_row.proname, procedure_row.oid::pg_catalog.regprocedure::text;
end;
$preflight$;

create unique index if not exists conversation_sessions_id_org_store_conv_uidx
  on public.conversation_sessions (id, organization_id, store_id, conversation_id);

alter table public.messages
  add column if not exists conversation_session_id uuid null,
  add column if not exists commercial_session_context_link_id uuid null,
  add column if not exists commercial_context_capture_state text;

alter table public.messages
  alter column commercial_context_capture_state set default 'legacy_unknown';

update public.messages
set commercial_context_capture_state = 'legacy_unknown'
where commercial_context_capture_state is null;

alter table public.messages
  alter column commercial_context_capture_state set not null;

do $constraints$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.messages'::pg_catalog.regclass
      and constraint_row.conname = 'messages_commercial_context_state_check'
  ) then
    alter table public.messages
      add constraint messages_commercial_context_state_check
      check (
        (
          commercial_context_capture_state in ('legacy_unknown', 'no_active_session')
          and conversation_session_id is null
          and commercial_session_context_link_id is null
        )
        or (
          commercial_context_capture_state = 'pending_context'
          and conversation_session_id is not null
          and commercial_session_context_link_id is null
        )
        or (
          commercial_context_capture_state = 'captured'
          and conversation_session_id is not null
          and commercial_session_context_link_id is not null
        )
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.messages'::pg_catalog.regclass
      and constraint_row.conname = 'messages_conversation_session_scope_fkey'
  ) then
    alter table public.messages
      add constraint messages_conversation_session_scope_fkey
      foreign key (
        conversation_session_id,
        organization_id,
        store_id,
        conversation_id
      )
      references public.conversation_sessions(
        id,
        organization_id,
        store_id,
        conversation_id
      )
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.messages'::pg_catalog.regclass
      and constraint_row.conname = 'messages_context_link_scope_fkey'
  ) then
    alter table public.messages
      add constraint messages_context_link_scope_fkey
      foreign key (
        commercial_session_context_link_id,
        organization_id,
        store_id,
        conversation_session_id
      )
      references public.commercial_session_context_links(
        id,
        organization_id,
        store_id,
        conversation_session_id
      )
      on delete restrict;
  end if;
end;
$constraints$;

create index if not exists messages_org_store_session_created_idx
  on public.messages (
    organization_id,
    store_id,
    conversation_session_id,
    created_at desc
  )
  where conversation_session_id is not null;

create index if not exists messages_org_store_ctx_link_created_idx
  on public.messages (
    organization_id,
    store_id,
    commercial_session_context_link_id,
    created_at desc
  )
  where commercial_session_context_link_id is not null;

create or replace function public.fill_messages_lead_store_from_conversation()
returns trigger
language plpgsql
volatile
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_lead_id uuid;
  v_store_id uuid;
  v_org_id uuid;
  v_conversation_session_id uuid;
  v_commercial_session_context_link_id uuid;
begin
  select
    conversation_row.lead_id,
    conversation_row.organization_id
  into
    v_lead_id,
    v_org_id
  from public.conversations conversation_row
  where conversation_row.id = new.conversation_id;

  if v_lead_id is null then
    raise exception
      'conversation_id % não existe ou não possui lead_id',
      new.conversation_id;
  end if;

  select lead_row.store_id
  into v_store_id
  from public.leads lead_row
  where lead_row.id = v_lead_id;

  if v_store_id is null then
    raise exception
      'lead_id % não possui store_id',
      v_lead_id;
  end if;

  new.lead_id := v_lead_id;
  new.store_id := v_store_id;

  if new.organization_id is null then
    new.organization_id := v_org_id;
  elsif new.organization_id is distinct from v_org_id then
    raise exception
      'organization_id (%) não bate com a conversation.organization_id (%)',
      new.organization_id,
      v_org_id;
  end if;

  if tg_op = 'UPDATE' then
    if new.conversation_session_id is distinct from old.conversation_session_id
       or new.commercial_session_context_link_id is distinct from old.commercial_session_context_link_id
       or new.commercial_context_capture_state is distinct from old.commercial_context_capture_state then
      raise exception using
        errcode = 'P0001',
        message = 'messages commercial context snapshot is immutable after insert';
    end if;

    new.conversation_session_id := old.conversation_session_id;
    new.commercial_session_context_link_id := old.commercial_session_context_link_id;
    new.commercial_context_capture_state := old.commercial_context_capture_state;

    return new;
  end if;

  select
    scope_row.conversation_session_id,
    scope_row.commercial_session_context_link_id
  into
    v_conversation_session_id,
    v_commercial_session_context_link_id
  from (
    select
      session_row.id as conversation_session_id,
      context_row.id as commercial_session_context_link_id
    from public.conversation_sessions session_row
    left join public.commercial_session_context_links context_row
      on context_row.organization_id = session_row.organization_id
     and context_row.store_id = session_row.store_id
     and context_row.conversation_session_id = session_row.id
     and context_row.status = 'active'
    where session_row.organization_id = new.organization_id
      and session_row.store_id = new.store_id
      and session_row.conversation_id = new.conversation_id
      and session_row.status = 'active'
    limit 1
  ) scope_row;

  if v_conversation_session_id is null then
    new.conversation_session_id := null;
    new.commercial_session_context_link_id := null;
    new.commercial_context_capture_state := 'no_active_session';
  elsif v_commercial_session_context_link_id is null then
    new.conversation_session_id := v_conversation_session_id;
    new.commercial_session_context_link_id := null;
    new.commercial_context_capture_state := 'pending_context';
  else
    new.conversation_session_id := v_conversation_session_id;
    new.commercial_session_context_link_id := v_commercial_session_context_link_id;
    new.commercial_context_capture_state := 'captured';
  end if;

  return new;
end;
$function$;

do $postconditions$
declare
  v_already_applied boolean;
  v_legacy_message_count bigint;
  v_fill_function_owner oid;
  v_fill_function_acl_before text;
  v_fill_function_prosecdef boolean;
  v_fill_function_provolatile "char";
  v_fill_function_search_path text;
  v_trigger_tgfoid oid;
  v_trigger_tgenabled "char";
  v_trigger_tgtype smallint;
  v_fill_function_sql text;
  v_fill_function_acl_after text;
  v_current_search_path text;
  v_message_count bigint;
  v_invalid_legacy_rows bigint;
begin
  select
    baseline_row.already_applied,
    baseline_row.legacy_message_count,
    baseline_row.fill_function_owner,
    baseline_row.fill_function_acl,
    baseline_row.fill_function_prosecdef,
    baseline_row.fill_function_provolatile,
    baseline_row.fill_function_search_path,
    baseline_row.trigger_tgfoid,
    baseline_row.trigger_tgenabled,
    baseline_row.trigger_tgtype
  into
    v_already_applied,
    v_legacy_message_count,
    v_fill_function_owner,
    v_fill_function_acl_before,
    v_fill_function_prosecdef,
    v_fill_function_provolatile,
    v_fill_function_search_path,
    v_trigger_tgfoid,
    v_trigger_tgenabled,
    v_trigger_tgtype
  from pg_temp._p9_messages_context_snapshot_baseline baseline_row;

  if (
    select count(*)
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'messages'
  ) <> 20 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.messages must have exactly 20 columns';
  end if;

  if exists (
    select 1
    from (
      values
        ('conversation_session_id'::text, 'uuid'::text, 'YES'::text, null::text),
        ('commercial_session_context_link_id'::text, 'uuid'::text, 'YES'::text, null::text),
        ('commercial_context_capture_state'::text, 'text'::text, 'NO'::text, '''legacy_unknown''::text'::text)
    ) as expected(column_name, data_type, is_nullable, default_value)
    left join information_schema.columns column_row
      on column_row.table_schema = 'public'
     and column_row.table_name = 'messages'
     and column_row.column_name = expected.column_name
    where column_row.column_name is null
       or column_row.data_type <> expected.data_type
       or column_row.is_nullable <> expected.is_nullable
       or (
         expected.default_value is null
         and column_row.column_default is not null
       )
       or (
         expected.default_value is not null
         and pg_catalog.lower(coalesce(column_row.column_default, '')) <> pg_catalog.lower(expected.default_value)
       )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: new public.messages column contract mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.messages'::pg_catalog.regclass
      and constraint_row.conname = 'messages_commercial_context_state_check'
      and constraint_row.contype = 'c'
      and pg_catalog.strpos(pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid)), 'legacy_unknown') > 0
      and pg_catalog.strpos(pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid)), 'no_active_session') > 0
      and pg_catalog.strpos(pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid)), 'pending_context') > 0
      and pg_catalog.strpos(pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid)), 'captured') > 0
      and pg_catalog.strpos(pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid)), 'conversation_session_id is null') > 0
      and pg_catalog.strpos(pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid)), 'commercial_session_context_link_id is null') > 0
      and pg_catalog.strpos(pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid)), 'conversation_session_id is not null') > 0
      and pg_catalog.strpos(pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid)), 'commercial_session_context_link_id is not null') > 0
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: messages commercial context state check is missing or incomplete';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.messages'::pg_catalog.regclass
      and constraint_row.conname = 'messages_conversation_session_scope_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.conversation_sessions'::pg_catalog.regclass
      and constraint_row.confdeltype = 'r'
      and (
        select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
        from pg_catalog.unnest(constraint_row.conkey) with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = constraint_row.conrelid
         and attribute_row.attnum = key_column.attnum
      ) = array[
        'conversation_session_id',
        'organization_id',
        'store_id',
        'conversation_id'
      ]::text[]
      and (
        select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
        from pg_catalog.unnest(constraint_row.confkey) with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = constraint_row.confrelid
         and attribute_row.attnum = key_column.attnum
      ) = array[
        'id',
        'organization_id',
        'store_id',
        'conversation_id'
      ]::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: messages_conversation_session_scope_fkey mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.messages'::pg_catalog.regclass
      and constraint_row.conname = 'messages_context_link_scope_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.commercial_session_context_links'::pg_catalog.regclass
      and constraint_row.confdeltype = 'r'
      and (
        select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
        from pg_catalog.unnest(constraint_row.conkey) with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = constraint_row.conrelid
         and attribute_row.attnum = key_column.attnum
      ) = array[
        'commercial_session_context_link_id',
        'organization_id',
        'store_id',
        'conversation_session_id'
      ]::text[]
      and (
        select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
        from pg_catalog.unnest(constraint_row.confkey) with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = constraint_row.confrelid
         and attribute_row.attnum = key_column.attnum
      ) = array[
        'id',
        'organization_id',
        'store_id',
        'conversation_session_id'
      ]::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: messages_context_link_scope_fkey mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    join pg_catalog.pg_namespace index_namespace
      on index_namespace.oid = index_relation.relnamespace
    join pg_catalog.pg_class table_relation
      on table_relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = table_relation.relnamespace
    where index_namespace.nspname = 'public'
      and index_relation.relname = 'conversation_sessions_id_org_store_conv_uidx'
      and table_namespace.nspname = 'public'
      and table_relation.relname = 'conversation_sessions'
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indpred is null
      and index_row.indexprs is null
      and (
        select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
        from pg_catalog.unnest(index_row.indkey::smallint[])
             with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = index_row.indrelid
         and attribute_row.attnum = key_column.attnum
      ) = array['id', 'organization_id', 'store_id', 'conversation_id']::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: conversation_sessions_id_org_store_conv_uidx mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    join pg_catalog.pg_namespace index_namespace
      on index_namespace.oid = index_relation.relnamespace
    join pg_catalog.pg_class table_relation
      on table_relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = table_relation.relnamespace
    where index_namespace.nspname = 'public'
      and index_relation.relname = 'messages_org_store_session_created_idx'
      and table_namespace.nspname = 'public'
      and table_relation.relname = 'messages'
      and not index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indexprs is null
      and pg_catalog.regexp_replace(
            pg_catalog.lower(
              pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid)
            ),
            '[[:space:]()]',
            '',
            'g'
          ) = 'conversation_session_idisnotnull'
      and (
        select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
        from pg_catalog.unnest(index_row.indkey::smallint[])
             with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = index_row.indrelid
         and attribute_row.attnum = key_column.attnum
      ) = array[
        'organization_id',
        'store_id',
        'conversation_session_id',
        'created_at'
      ]::text[]
      and (
        select pg_catalog.array_agg(option_column.option_value order by option_column.ordinality)
        from pg_catalog.unnest(index_row.indoption::smallint[])
             with ordinality as option_column(option_value, ordinality)
      ) = array[0, 0, 0, 3]::smallint[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: messages_org_store_session_created_idx mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    join pg_catalog.pg_namespace index_namespace
      on index_namespace.oid = index_relation.relnamespace
    join pg_catalog.pg_class table_relation
      on table_relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = table_relation.relnamespace
    where index_namespace.nspname = 'public'
      and index_relation.relname = 'messages_org_store_ctx_link_created_idx'
      and table_namespace.nspname = 'public'
      and table_relation.relname = 'messages'
      and not index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indexprs is null
      and pg_catalog.regexp_replace(
            pg_catalog.lower(
              pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid)
            ),
            '[[:space:]()]',
            '',
            'g'
          ) = 'commercial_session_context_link_idisnotnull'
      and (
        select pg_catalog.array_agg(attribute_row.attname::text order by key_column.ordinality)
        from pg_catalog.unnest(index_row.indkey::smallint[])
             with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = index_row.indrelid
         and attribute_row.attnum = key_column.attnum
      ) = array[
        'organization_id',
        'store_id',
        'commercial_session_context_link_id',
        'created_at'
      ]::text[]
      and (
        select pg_catalog.array_agg(option_column.option_value order by option_column.ordinality)
        from pg_catalog.unnest(index_row.indoption::smallint[])
             with ordinality as option_column(option_value, ordinality)
      ) = array[0, 0, 0, 3]::smallint[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: messages_org_store_ctx_link_created_idx mismatch';
  end if;

  select
    pg_catalog.pg_get_functiondef('public.fill_messages_lead_store_from_conversation()'::pg_catalog.regprocedure),
    coalesce(pg_catalog.array_to_string(procedure_row.proacl, ','), ''),
    (
      select config_entry
      from pg_catalog.unnest(coalesce(procedure_row.proconfig, '{}'::text[])) config_entry
      where config_entry like 'search_path=%'
      limit 1
    )
  into
    v_fill_function_sql,
    v_fill_function_acl_after,
    v_current_search_path
  from pg_catalog.pg_proc procedure_row
  where procedure_row.oid = 'public.fill_messages_lead_store_from_conversation()'::pg_catalog.regprocedure;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure_row
    where procedure_row.oid = 'public.fill_messages_lead_store_from_conversation()'::pg_catalog.regprocedure
      and procedure_row.proowner = v_fill_function_owner
      and procedure_row.prosecdef = v_fill_function_prosecdef
      and procedure_row.provolatile = v_fill_function_provolatile
  ) or v_fill_function_acl_after <> v_fill_function_acl_before
     or v_current_search_path is distinct from v_fill_function_search_path then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: fill_messages_lead_store_from_conversation() owner, grants, volatility, security mode or search_path changed unexpectedly';
  end if;

  if pg_catalog.strpos(pg_catalog.lower(v_fill_function_sql), 'new.organization_id :=') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_fill_function_sql), 'new.lead_id :=') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_fill_function_sql), 'new.store_id :=') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_fill_function_sql), 'new.organization_id is null') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_fill_function_sql), 'new.organization_id is distinct from v_org_id') = 0
     or pg_catalog.strpos(v_fill_function_sql, 'conversation_id % não existe ou não possui lead_id') = 0
     or pg_catalog.strpos(v_fill_function_sql, 'lead_id % não possui store_id') = 0
     or pg_catalog.strpos(v_fill_function_sql, 'organization_id (%) não bate com a conversation.organization_id (%)') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_fill_function_sql), 'no_active_session') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_fill_function_sql), 'pending_context') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_fill_function_sql), 'captured') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_fill_function_sql), 'messages commercial context snapshot is immutable after insert') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_fill_function_sql), 'public.conversation_sessions') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_fill_function_sql), 'public.commercial_session_context_links') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_fill_function_sql), 'session_row.status = ''active''') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_fill_function_sql), 'context_row.status = ''active''') = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: fill_messages_lead_store_from_conversation() does not preserve the approved fill and snapshot behavior';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.messages'::pg_catalog.regclass
      and not trigger_row.tgisinternal
      and trigger_row.tgname = 'trg_fill_messages_lead_store'
      and trigger_row.tgfoid = v_trigger_tgfoid
      and trigger_row.tgenabled = v_trigger_tgenabled
      and trigger_row.tgtype = v_trigger_tgtype
      and trigger_row.tgenabled = 'O'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: trg_fill_messages_lead_store changed unexpectedly or is not enabled';
  end if;

  if exists (
    select 1
    from (
      select
        procedure_row.proname::text as routine_name,
        procedure_row.oid::pg_catalog.regprocedure::text as regprocedure_text,
        pg_catalog.pg_get_function_identity_arguments(procedure_row.oid) as identity_arguments,
        pg_catalog.pg_get_function_result(procedure_row.oid) as result_signature
      from pg_catalog.pg_proc procedure_row
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = procedure_row.pronamespace
      where namespace_row.nspname = 'public'
        and procedure_row.proname in (
          'insert_message',
          'panel_send_message',
          'panel_send_message_scoped',
          'mark_message_external_sent'
        )
    ) current_row
    full outer join pg_temp._p9_messages_context_snapshot_rpc_baseline baseline_row
      on baseline_row.routine_name = current_row.routine_name
     and baseline_row.regprocedure_text = current_row.regprocedure_text
     and baseline_row.identity_arguments = current_row.identity_arguments
     and baseline_row.result_signature = current_row.result_signature
    where baseline_row.routine_name is null
       or current_row.routine_name is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: message RPC signatures changed unexpectedly';
  end if;

  select count(*)
  into v_message_count
  from public.messages;

  if v_message_count < v_legacy_message_count then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.messages row count was reduced';
  end if;

  if not v_already_applied then
    select count(*)
    into v_invalid_legacy_rows
    from public.messages message_row
    where message_row.conversation_session_id is not null
       or message_row.commercial_session_context_link_id is not null
       or message_row.commercial_context_capture_state <> 'legacy_unknown';

    if v_message_count <> v_legacy_message_count
       or v_invalid_legacy_rows > 0 then
      raise exception using
        errcode = 'P0001',
        message = 'postcondition failed: legacy public.messages rows were not preserved as legacy_unknown with null historical snapshot ids';
    end if;
  end if;
end;
$postconditions$;

commit;

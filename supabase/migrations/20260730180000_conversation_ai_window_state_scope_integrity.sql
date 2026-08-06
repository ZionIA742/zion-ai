begin;

set local search_path = public, pg_catalog;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'p18:conversation_ai_window_state_scope_integrity',
    0
  )
);

lock table public.conversation_ai_window_state in access exclusive mode;
lock table public.conversations in share row exclusive mode;
lock table public.leads in share row exclusive mode;
lock table public.stores in share row exclusive mode;

do $$
declare
  v_target_conversation_id constant uuid := '0866458a-c2cd-4d45-a3a8-645d2c2f4560';
  v_old_organization_id constant uuid := '3cb1d3d4-5d43-4679-8dcf-ee219b89d294';
  v_canonical_organization_id constant uuid := 'b02252ce-0e73-4371-9e23-f1009e7b1698';
  v_canonical_store_id constant uuid := '6ac8f4b1-e50f-42c0-9cae-78951d6daf7b';
  v_canonical_lead_id constant uuid := 'faef5890-18c5-4231-98d4-100bbcad932a';
  v_actual_organization_id uuid;
  v_actual_store_id uuid;
  v_existing_constraint pg_catalog.pg_constraint%rowtype;
  v_existing_proc pg_catalog.pg_proc%rowtype;
  v_existing_trigger pg_catalog.pg_trigger%rowtype;
  v_existing_function_oid oid;
  v_existing_lang name;
  v_existing_owner name;
  v_existing_return_type regtype;
  v_existing_function_identity_arguments text;
  v_expected_conrelid oid := 'public.conversation_ai_window_state'::pg_catalog.regclass;
  v_expected_conversation_confrelid oid := 'public.conversations'::pg_catalog.regclass;
  v_expected_store_confrelid oid := 'public.stores'::pg_catalog.regclass;
  v_expected_function_config text[] := array['search_path=pg_catalog, public'];
  v_state_conversation_org_conkey smallint[];
  v_state_store_org_conkey smallint[];
  v_conversation_confkey smallint[];
  v_store_confkey smallint[];
  v_scope_trigger_attrs smallint[];
  v_parent_conversation_trigger_attrs smallint[];
  v_parent_lead_trigger_attrs smallint[];
  v_existing_trigger_attrs smallint[];
  v_normalized_existing_body text;
  v_normalized_expected_body text;
  v_scope_function_body text := $fn$
begin
  if not exists (
    select 1
    from public.conversations conversation_row
    join public.leads lead_row
      on lead_row.id = conversation_row.lead_id
    join public.stores store_row
      on store_row.id = new.store_id
    where conversation_row.id is not distinct from new.conversation_id
      and conversation_row.organization_id is not distinct from new.organization_id
      and lead_row.organization_id is not distinct from new.organization_id
      and lead_row.store_id is not distinct from new.store_id
      and store_row.organization_id is not distinct from new.organization_id
  ) then
    raise exception using
      errcode = '23503',
      constraint = 'conversation_ai_window_state_canonical_scope_fkey',
      message = 'conversation_ai_window_state must match the canonical conversation, lead and store scope';
  end if;

  return new;
end;
$fn$;
  v_parent_conversation_function_body text := $fn$
begin
  if new.organization_id is distinct from old.organization_id
     or new.lead_id is distinct from old.lead_id
  then
    if exists (
      select 1
      from public.conversation_ai_window_state state_row
      left join public.leads lead_row
        on lead_row.id = new.lead_id
      left join public.stores store_row
        on store_row.id = state_row.store_id
      where state_row.conversation_id is not distinct from new.id
        and (
          new.lead_id is null
          or lead_row.id is null
          or new.organization_id is distinct from state_row.organization_id
          or lead_row.organization_id is distinct from new.organization_id
          or lead_row.store_id is distinct from state_row.store_id
          or store_row.id is null
          or store_row.organization_id is distinct from state_row.organization_id
        )
    ) then
      raise exception using
        errcode = '23503',
        constraint = 'conversation_ai_window_state_parent_conversation_scope_fkey',
        message = 'conversation update would break existing conversation_ai_window_state canonical scope';
    end if;
  end if;

  return new;
end;
$fn$;
  v_parent_lead_function_body text := $fn$
begin
  if new.organization_id is distinct from old.organization_id
     or new.store_id is distinct from old.store_id
  then
    if exists (
      select 1
      from public.conversations conversation_row
      join public.conversation_ai_window_state state_row
        on state_row.conversation_id = conversation_row.id
      left join public.stores store_row
        on store_row.id = new.store_id
      where conversation_row.lead_id is not distinct from new.id
        and (
          conversation_row.organization_id is distinct from new.organization_id
          or state_row.organization_id is distinct from new.organization_id
          or state_row.store_id is distinct from new.store_id
          or store_row.id is null
          or store_row.organization_id is distinct from new.organization_id
        )
    ) then
      raise exception using
        errcode = '23503',
        constraint = 'conversation_ai_window_state_parent_lead_scope_fkey',
        message = 'lead update would break existing conversation_ai_window_state canonical scope';
    end if;
  end if;

  return new;
end;
$fn$;
begin
  select array_agg(attnum order by ordinality)
  into v_state_conversation_org_conkey
  from pg_catalog.pg_attribute
  cross join unnest(array['conversation_id','organization_id']) with ordinality as cols(attname, ordinality)
  where attrelid = 'public.conversation_ai_window_state'::pg_catalog.regclass
    and pg_catalog.pg_attribute.attname = cols.attname;

  select array_agg(attnum order by ordinality)
  into v_state_store_org_conkey
  from pg_catalog.pg_attribute
  cross join unnest(array['store_id','organization_id']) with ordinality as cols(attname, ordinality)
  where attrelid = 'public.conversation_ai_window_state'::pg_catalog.regclass
    and pg_catalog.pg_attribute.attname = cols.attname;

  select array_agg(attnum order by ordinality)
  into v_conversation_confkey
  from pg_catalog.pg_attribute
  cross join unnest(array['id','organization_id']) with ordinality as cols(attname, ordinality)
  where attrelid = 'public.conversations'::pg_catalog.regclass
    and pg_catalog.pg_attribute.attname = cols.attname;

  select array_agg(attnum order by ordinality)
  into v_store_confkey
  from pg_catalog.pg_attribute
  cross join unnest(array['id','organization_id']) with ordinality as cols(attname, ordinality)
  where attrelid = 'public.stores'::pg_catalog.regclass
    and pg_catalog.pg_attribute.attname = cols.attname;

  select array_agg(attnum order by ordinality)
  into v_scope_trigger_attrs
  from pg_catalog.pg_attribute
  cross join unnest(array['conversation_id','organization_id','store_id']) with ordinality as cols(attname, ordinality)
  where attrelid = 'public.conversation_ai_window_state'::pg_catalog.regclass
    and pg_catalog.pg_attribute.attname = cols.attname;

  select array_agg(attnum order by ordinality)
  into v_parent_conversation_trigger_attrs
  from pg_catalog.pg_attribute
  cross join unnest(array['lead_id','organization_id']) with ordinality as cols(attname, ordinality)
  where attrelid = 'public.conversations'::pg_catalog.regclass
    and pg_catalog.pg_attribute.attname = cols.attname;

  select array_agg(attnum order by ordinality)
  into v_parent_lead_trigger_attrs
  from pg_catalog.pg_attribute
  cross join unnest(array['organization_id','store_id']) with ordinality as cols(attname, ordinality)
  where attrelid = 'public.leads'::pg_catalog.regclass
    and pg_catalog.pg_attribute.attname = cols.attname;

  perform 1
  from public.conversations conversation_row
  where conversation_row.id = v_target_conversation_id
    and conversation_row.organization_id = v_canonical_organization_id
    and conversation_row.lead_id = v_canonical_lead_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical conversation chain changed';
  end if;

  perform 1
  from public.leads lead_row
  where lead_row.id = v_canonical_lead_id
    and lead_row.organization_id = v_canonical_organization_id
    and lead_row.store_id = v_canonical_store_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical lead chain changed';
  end if;

  perform 1
  from public.stores store_row
  where store_row.id = v_canonical_store_id
    and store_row.organization_id = v_canonical_organization_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: canonical store chain changed';
  end if;

  select state_row.organization_id, state_row.store_id
  into v_actual_organization_id, v_actual_store_id
  from public.conversation_ai_window_state state_row
  where state_row.conversation_id = v_target_conversation_id
  for update;

  if v_actual_organization_id is null or v_actual_store_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: target conversation_ai_window_state row is missing';
  end if;

  if not (
    (
      v_actual_organization_id is not distinct from v_old_organization_id
      and v_actual_store_id is not distinct from v_canonical_store_id
    )
    or
    (
      v_actual_organization_id is not distinct from v_canonical_organization_id
      and v_actual_store_id is not distinct from v_canonical_store_id
    )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: target conversation_ai_window_state row is not in an approved idempotent state';
  end if;

  if v_actual_organization_id is not distinct from v_old_organization_id then
    update public.conversation_ai_window_state
    set organization_id = v_canonical_organization_id
    where conversation_id = v_target_conversation_id
      and organization_id = v_old_organization_id
      and store_id = v_canonical_store_id;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'correction failed: target conversation_ai_window_state row changed during update';
    end if;
  end if;

  select *
  into v_existing_constraint
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conname = 'conversation_ai_window_state_conversation_org_fkey'
    and constraint_row.conrelid = v_expected_conrelid;

  if not found then
    alter table public.conversation_ai_window_state
      add constraint conversation_ai_window_state_conversation_org_fkey
      foreign key (conversation_id, organization_id)
      references public.conversations(id, organization_id)
      on delete cascade
      not valid;
  else
    if v_existing_constraint.contype is distinct from 'f'
       or v_existing_constraint.conmatchtype is distinct from 's'
       or v_existing_constraint.conrelid is distinct from v_expected_conrelid
       or v_existing_constraint.confrelid is distinct from v_expected_conversation_confrelid
       or v_existing_constraint.conkey is distinct from v_state_conversation_org_conkey
       or v_existing_constraint.confkey is distinct from v_conversation_confkey
       or v_existing_constraint.confdeltype is distinct from 'c'
       or v_existing_constraint.confupdtype is distinct from 'a'
       or v_existing_constraint.condeferrable is distinct from false
       or v_existing_constraint.condeferred is distinct from false
    then
      raise exception using
        errcode = 'P0001',
        message = 'precondition failed: conversation_ai_window_state_conversation_org_fkey exists with a divergent definition';
    end if;
  end if;

  alter table public.conversation_ai_window_state
    validate constraint conversation_ai_window_state_conversation_org_fkey;

  select *
  into v_existing_constraint
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conname = 'conversation_ai_window_state_store_org_fkey'
    and constraint_row.conrelid = v_expected_conrelid;

  if not found then
    alter table public.conversation_ai_window_state
      add constraint conversation_ai_window_state_store_org_fkey
      foreign key (store_id, organization_id)
      references public.stores(id, organization_id)
      on delete cascade
      not valid;
  else
    if v_existing_constraint.contype is distinct from 'f'
       or v_existing_constraint.conmatchtype is distinct from 's'
       or v_existing_constraint.conrelid is distinct from v_expected_conrelid
       or v_existing_constraint.confrelid is distinct from v_expected_store_confrelid
       or v_existing_constraint.conkey is distinct from v_state_store_org_conkey
       or v_existing_constraint.confkey is distinct from v_store_confkey
       or v_existing_constraint.confdeltype is distinct from 'c'
       or v_existing_constraint.confupdtype is distinct from 'a'
       or v_existing_constraint.condeferrable is distinct from false
       or v_existing_constraint.condeferred is distinct from false
    then
      raise exception using
        errcode = 'P0001',
        message = 'precondition failed: conversation_ai_window_state_store_org_fkey exists with a divergent definition';
    end if;
  end if;

  alter table public.conversation_ai_window_state
    validate constraint conversation_ai_window_state_store_org_fkey;

  v_existing_function_oid := pg_catalog.to_regprocedure(
    'public.enforce_conversation_ai_window_state_canonical_scope()'
  );

  if v_existing_function_oid is null then
    execute format(
      $sql$
      create function public.enforce_conversation_ai_window_state_canonical_scope()
      returns trigger
      language plpgsql
      security definer
      set search_path = pg_catalog, public
      as $fn$
      %s
      $fn$;
      $sql$,
      v_scope_function_body
    );

    v_existing_function_oid := pg_catalog.to_regprocedure(
      'public.enforce_conversation_ai_window_state_canonical_scope()'
    );
  end if;

  if v_existing_function_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: enforce_conversation_ai_window_state_canonical_scope() was not created with the exact expected signature';
  end if;

  select *
  into strict v_existing_proc
  from pg_catalog.pg_proc
  where oid = v_existing_function_oid;

  select language_row.lanname
  into strict v_existing_lang
  from pg_catalog.pg_language language_row
  where language_row.oid = v_existing_proc.prolang;

  select pg_catalog.pg_get_userbyid(v_existing_proc.proowner)
  into strict v_existing_owner;

  v_existing_return_type := v_existing_proc.prorettype::pg_catalog.regtype;
  v_existing_function_identity_arguments := pg_catalog.pg_get_function_identity_arguments(v_existing_function_oid);
  v_normalized_existing_body := pg_catalog.regexp_replace(
    pg_catalog.btrim(v_existing_proc.prosrc),
    '\s+',
    ' ',
    'g'
  );
  v_normalized_expected_body := pg_catalog.regexp_replace(
    pg_catalog.btrim(v_scope_function_body),
    '\s+',
    ' ',
    'g'
  );

  if v_existing_function_identity_arguments <> ''
     or v_existing_return_type <> 'trigger'::pg_catalog.regtype
     or v_existing_lang <> 'plpgsql'
     or v_existing_proc.prosecdef is distinct from true
     or coalesce(v_existing_proc.proconfig, '{}'::text[]) <> v_expected_function_config
     or v_existing_owner <> 'postgres'
     or v_normalized_existing_body <> v_normalized_expected_body
  then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: enforce_conversation_ai_window_state_canonical_scope() exists with a divergent definition';
  end if;

  v_existing_function_oid := pg_catalog.to_regprocedure(
    'public.guard_conversation_ai_window_state_parent_conversation()'
  );

  if v_existing_function_oid is null then
    execute format(
      $sql$
      create function public.guard_conversation_ai_window_state_parent_conversation()
      returns trigger
      language plpgsql
      security definer
      set search_path = pg_catalog, public
      as $fn$
      %s
      $fn$;
      $sql$,
      v_parent_conversation_function_body
    );

    v_existing_function_oid := pg_catalog.to_regprocedure(
      'public.guard_conversation_ai_window_state_parent_conversation()'
    );
  end if;

  if v_existing_function_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: guard_conversation_ai_window_state_parent_conversation() was not created with the exact expected signature';
  end if;

  select *
  into strict v_existing_proc
  from pg_catalog.pg_proc
  where oid = v_existing_function_oid;

  select language_row.lanname
  into strict v_existing_lang
  from pg_catalog.pg_language language_row
  where language_row.oid = v_existing_proc.prolang;

  select pg_catalog.pg_get_userbyid(v_existing_proc.proowner)
  into strict v_existing_owner;

  v_existing_return_type := v_existing_proc.prorettype::pg_catalog.regtype;
  v_existing_function_identity_arguments := pg_catalog.pg_get_function_identity_arguments(v_existing_function_oid);
  v_normalized_existing_body := pg_catalog.regexp_replace(
    pg_catalog.btrim(v_existing_proc.prosrc),
    '\s+',
    ' ',
    'g'
  );
  v_normalized_expected_body := pg_catalog.regexp_replace(
    pg_catalog.btrim(v_parent_conversation_function_body),
    '\s+',
    ' ',
    'g'
  );

  if v_existing_function_identity_arguments <> ''
     or v_existing_return_type <> 'trigger'::pg_catalog.regtype
     or v_existing_lang <> 'plpgsql'
     or v_existing_proc.prosecdef is distinct from true
     or coalesce(v_existing_proc.proconfig, '{}'::text[]) <> v_expected_function_config
     or v_existing_owner <> 'postgres'
     or v_normalized_existing_body <> v_normalized_expected_body
  then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: guard_conversation_ai_window_state_parent_conversation() exists with a divergent definition';
  end if;

  v_existing_function_oid := pg_catalog.to_regprocedure(
    'public.guard_conversation_ai_window_state_parent_lead()'
  );

  if v_existing_function_oid is null then
    execute format(
      $sql$
      create function public.guard_conversation_ai_window_state_parent_lead()
      returns trigger
      language plpgsql
      security definer
      set search_path = pg_catalog, public
      as $fn$
      %s
      $fn$;
      $sql$,
      v_parent_lead_function_body
    );

    v_existing_function_oid := pg_catalog.to_regprocedure(
      'public.guard_conversation_ai_window_state_parent_lead()'
    );
  end if;

  if v_existing_function_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: guard_conversation_ai_window_state_parent_lead() was not created with the exact expected signature';
  end if;

  select *
  into strict v_existing_proc
  from pg_catalog.pg_proc
  where oid = v_existing_function_oid;

  select language_row.lanname
  into strict v_existing_lang
  from pg_catalog.pg_language language_row
  where language_row.oid = v_existing_proc.prolang;

  select pg_catalog.pg_get_userbyid(v_existing_proc.proowner)
  into strict v_existing_owner;

  v_existing_return_type := v_existing_proc.prorettype::pg_catalog.regtype;
  v_existing_function_identity_arguments := pg_catalog.pg_get_function_identity_arguments(v_existing_function_oid);
  v_normalized_existing_body := pg_catalog.regexp_replace(
    pg_catalog.btrim(v_existing_proc.prosrc),
    '\s+',
    ' ',
    'g'
  );
  v_normalized_expected_body := pg_catalog.regexp_replace(
    pg_catalog.btrim(v_parent_lead_function_body),
    '\s+',
    ' ',
    'g'
  );

  if v_existing_function_identity_arguments <> ''
     or v_existing_return_type <> 'trigger'::pg_catalog.regtype
     or v_existing_lang <> 'plpgsql'
     or v_existing_proc.prosecdef is distinct from true
     or coalesce(v_existing_proc.proconfig, '{}'::text[]) <> v_expected_function_config
     or v_existing_owner <> 'postgres'
     or v_normalized_existing_body <> v_normalized_expected_body
  then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: guard_conversation_ai_window_state_parent_lead() exists with a divergent definition';
  end if;

  select *
  into v_existing_trigger
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgname = 'trg_conversation_ai_window_state_canonical_scope'
    and trigger_row.tgrelid = 'public.conversation_ai_window_state'::pg_catalog.regclass
    and not trigger_row.tgisinternal;

  if not found then
    create trigger trg_conversation_ai_window_state_canonical_scope
    before insert or update of conversation_id, organization_id, store_id
    on public.conversation_ai_window_state
    for each row
    execute function public.enforce_conversation_ai_window_state_canonical_scope();
  else
    select array_agg(trigger_attr order by ordinality)
    into v_existing_trigger_attrs
    from unnest(v_existing_trigger.tgattr::smallint[]) with ordinality as trigger_attrs(trigger_attr, ordinality);

    if v_existing_trigger.tgfoid <> 'public.enforce_conversation_ai_window_state_canonical_scope()'::pg_catalog.regprocedure
       or v_existing_trigger.tgtype <> 23
       or v_existing_trigger_attrs is distinct from v_scope_trigger_attrs
       or v_existing_trigger.tgenabled <> 'O'
       or v_existing_trigger.tgnargs <> 0
       or v_existing_trigger.tgqual is not null
       or v_existing_trigger.tgconstraint <> 0
       or v_existing_trigger.tgdeferrable is distinct from false
       or v_existing_trigger.tginitdeferred is distinct from false
       or v_existing_trigger.tgisinternal is distinct from false
    then
      raise exception using
        errcode = 'P0001',
        message = 'precondition failed: trg_conversation_ai_window_state_canonical_scope exists with a divergent definition';
    end if;
  end if;

  select *
  into v_existing_trigger
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgname = 'trg_guard_conversation_ai_window_state_parent_conversation'
    and trigger_row.tgrelid = 'public.conversations'::pg_catalog.regclass
    and not trigger_row.tgisinternal;

  if not found then
    create trigger trg_guard_conversation_ai_window_state_parent_conversation
    before update of lead_id, organization_id
    on public.conversations
    for each row
    execute function public.guard_conversation_ai_window_state_parent_conversation();
  else
    select array_agg(trigger_attr order by ordinality)
    into v_existing_trigger_attrs
    from unnest(v_existing_trigger.tgattr::smallint[]) with ordinality as trigger_attrs(trigger_attr, ordinality);

    if v_existing_trigger.tgfoid <> 'public.guard_conversation_ai_window_state_parent_conversation()'::pg_catalog.regprocedure
       or v_existing_trigger.tgtype <> 19
       or v_existing_trigger_attrs is distinct from v_parent_conversation_trigger_attrs
       or v_existing_trigger.tgenabled <> 'O'
       or v_existing_trigger.tgnargs <> 0
       or v_existing_trigger.tgqual is not null
       or v_existing_trigger.tgconstraint <> 0
       or v_existing_trigger.tgdeferrable is distinct from false
       or v_existing_trigger.tginitdeferred is distinct from false
       or v_existing_trigger.tgisinternal is distinct from false
    then
      raise exception using
        errcode = 'P0001',
        message = 'precondition failed: trg_guard_conversation_ai_window_state_parent_conversation exists with a divergent definition';
    end if;
  end if;

  select *
  into v_existing_trigger
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgname = 'trg_guard_conversation_ai_window_state_parent_lead'
    and trigger_row.tgrelid = 'public.leads'::pg_catalog.regclass
    and not trigger_row.tgisinternal;

  if not found then
    create trigger trg_guard_conversation_ai_window_state_parent_lead
    before update of organization_id, store_id
    on public.leads
    for each row
    execute function public.guard_conversation_ai_window_state_parent_lead();
  else
    select array_agg(trigger_attr order by ordinality)
    into v_existing_trigger_attrs
    from unnest(v_existing_trigger.tgattr::smallint[]) with ordinality as trigger_attrs(trigger_attr, ordinality);

    if v_existing_trigger.tgfoid <> 'public.guard_conversation_ai_window_state_parent_lead()'::pg_catalog.regprocedure
       or v_existing_trigger.tgtype <> 19
       or v_existing_trigger_attrs is distinct from v_parent_lead_trigger_attrs
       or v_existing_trigger.tgenabled <> 'O'
       or v_existing_trigger.tgnargs <> 0
       or v_existing_trigger.tgqual is not null
       or v_existing_trigger.tgconstraint <> 0
       or v_existing_trigger.tgdeferrable is distinct from false
       or v_existing_trigger.tginitdeferred is distinct from false
       or v_existing_trigger.tgisinternal is distinct from false
    then
      raise exception using
        errcode = 'P0001',
        message = 'precondition failed: trg_guard_conversation_ai_window_state_parent_lead exists with a divergent definition';
    end if;
  end if;

  perform 1
  from public.conversation_ai_window_state state_row
  join public.conversations conversation_row
    on conversation_row.id = state_row.conversation_id
  join public.leads lead_row
    on lead_row.id = conversation_row.lead_id
  join public.stores store_row
    on store_row.id = state_row.store_id
  where state_row.conversation_id = v_target_conversation_id
    and state_row.organization_id = v_canonical_organization_id
    and state_row.store_id = v_canonical_store_id
    and conversation_row.organization_id = v_canonical_organization_id
    and lead_row.organization_id = v_canonical_organization_id
    and lead_row.store_id = v_canonical_store_id
    and store_row.organization_id = v_canonical_organization_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: historical conversation_ai_window_state row is not in canonical scope';
  end if;

  if exists (
    select 1
    from public.conversation_ai_window_state state_row
    left join public.conversations conversation_row
      on conversation_row.id = state_row.conversation_id
    left join public.leads lead_row
      on lead_row.id = conversation_row.lead_id
    left join public.stores store_row
      on store_row.id = state_row.store_id
    where conversation_row.id is null
       or lead_row.id is null
       or store_row.id is null
       or state_row.organization_id is distinct from conversation_row.organization_id
       or lead_row.organization_id is distinct from conversation_row.organization_id
       or lead_row.store_id is distinct from state_row.store_id
       or store_row.organization_id is distinct from state_row.organization_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: conversation_ai_window_state contains inconsistent canonical chains';
  end if;
end;
$$;

commit;

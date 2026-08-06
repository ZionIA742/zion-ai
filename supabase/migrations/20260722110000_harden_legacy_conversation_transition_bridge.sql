-- ZION / Pilar 18 / Bloco 3 / Etapa 7
-- Ponte temporaria e auditavel para endurecer o fluxo legado de transicao
-- de conversa ate a substituicao pelo modelo canonico por oportunidade
-- comercial no Bloco 4.
--
-- Escopo estrito:
-- - nao cria o modelo definitivo de oportunidades;
-- - nao altera tabelas;
-- - nao amplia o modelo legado;
-- - cria wrappers ausentes usados pela aplicacao;
-- - endurece autorizacao, grants e autoria das transicoes;
-- - centraliza a escrita legado-compat em um unico caminho controlado.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local idle_in_transaction_session_timeout = '120s';
set local search_path = pg_catalog, pg_temp;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p18:b3:etapa7:harden-legacy-conversation-transition-bridge:v1',
    0
  )
);

do $preflight$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.transition_conversation_state(uuid,text,text)',
    'public.update_conversation_state(uuid,text)',
    'public.update_conversation_state(uuid,text,text)',
    'public.panel_transition_conversation_state_scoped(uuid,uuid,text,text)',
    'public.panel_takeover_conversation_scoped(uuid,uuid,text)',
    'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)',
    'public.human_takeover_conversation(uuid,text)',
    'public.human_release_conversation_to_ai(uuid,text,text)',
    'public.apply_ai_decision(uuid)',
    'public.apply_auto_state_transition_after_event()',
    'public.block_direct_human_flag_update()',
    'public.trg_log_conversation_status_change()'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception using
        errcode = 'P0001',
        message = 'precondition failed: required function is missing: ' || v_signature;
    end if;
  end loop;

  if pg_catalog.pg_get_function_result(
       'public.transition_conversation_state(uuid,text,text)'::pg_catalog.regprocedure
     ) <> 'void'
  then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: transition_conversation_state return type changed';
  end if;

  if pg_catalog.pg_get_function_result(
       'public.update_conversation_state(uuid,text)'::pg_catalog.regprocedure
     ) <> 'void'
     or pg_catalog.pg_get_function_result(
          'public.update_conversation_state(uuid,text,text)'::pg_catalog.regprocedure
        ) <> 'void'
     or pg_catalog.pg_get_function_result(
          'public.panel_transition_conversation_state_scoped(uuid,uuid,text,text)'::pg_catalog.regprocedure
        ) <> 'void'
     or pg_catalog.pg_get_function_result(
          'public.panel_takeover_conversation_scoped(uuid,uuid,text)'::pg_catalog.regprocedure
        ) <> 'void'
     or pg_catalog.pg_get_function_result(
          'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'::pg_catalog.regprocedure
        ) <> 'void'
     or pg_catalog.pg_get_function_result(
          'public.human_takeover_conversation(uuid,text)'::pg_catalog.regprocedure
        ) <> 'void'
     or pg_catalog.pg_get_function_result(
          'public.human_release_conversation_to_ai(uuid,text,text)'::pg_catalog.regprocedure
        ) <> 'void'
     or pg_catalog.pg_get_function_result(
          'public.apply_ai_decision(uuid)'::pg_catalog.regprocedure
        ) <> 'void'
     or pg_catalog.pg_get_function_result(
          'public.apply_auto_state_transition_after_event()'::pg_catalog.regprocedure
        ) <> 'trigger'
     or pg_catalog.pg_get_function_result(
          'public.block_direct_human_flag_update()'::pg_catalog.regprocedure
        ) <> 'trigger'
     or pg_catalog.pg_get_function_result(
          'public.trg_log_conversation_status_change()'::pg_catalog.regprocedure
        ) <> 'trigger'
  then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: one or more legacy function return types changed';
  end if;

  if pg_catalog.to_regclass('public.conversations') is null
     or pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.stores') is null
     or pg_catalog.to_regclass('public.memberships') is null
     or pg_catalog.to_regclass('public.state_transition_log') is null
     or pg_catalog.to_regclass('public.state_transitions') is null
     or pg_catalog.to_regclass('public.conversation_states') is null
     or pg_catalog.to_regclass('public.conversation_state_history') is null
  then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: required legacy transition tables are missing';
  end if;

  if pg_catalog.to_regprocedure('extensions.gen_random_uuid()') is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: extensions.gen_random_uuid() is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'conversations'
      and column_name in (
        'id',
        'organization_id',
        'lead_id',
        'status',
        'is_human_active',
        'last_status_actor_type',
        'last_status_actor_user_id',
        'last_status_reason',
        'last_status_metadata'
      )
    group by table_schema, table_name
    having pg_catalog.count(*) = 9
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: conversations structure is unexpected';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name in ('id', 'organization_id', 'store_id', 'state')
    group by table_schema, table_name
    having pg_catalog.count(*) = 4
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: leads structure is unexpected';
  end if;


  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
          'public.leads'::pg_catalog.regclass
      and constraint_row.conname =
          'leads_state_allowed_check'
      and constraint_row.contype = 'c'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: leads_state_allowed_check is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stores'
      and column_name in ('id', 'organization_id')
    group by table_schema, table_name
    having pg_catalog.count(*) = 2
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: stores structure is unexpected';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'memberships'
      and column_name in (
        'organization_id',
        'user_id',
        'role',
        'created_at'
      )
    group by table_schema, table_name
    having pg_catalog.count(*) = 4
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: memberships structure is unexpected';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'state_transition_log'
      and column_name in (
        'id',
        'organization_id',
        'store_id',
        'conversation_id',
        'from_state',
        'to_state',
        'actor_type',
        'actor_user_id',
        'reason',
        'metadata',
        'created_at',
        'event_key'
      )
    group by table_schema, table_name
    having pg_catalog.count(*) = 12
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: state_transition_log structure is unexpected';
  end if;


  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'conversation_states'
      and column_name in (
        'conversation_id',
        'organization_id',
        'state',
        'entered_at',
        'created_at',
        'updated_at'
      )
    group by table_schema, table_name
    having pg_catalog.count(*) = 6
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: conversation_states structure is unexpected';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'conversation_state_history'
      and column_name in (
        'conversation_id',
        'organization_id',
        'from_state',
        'to_state',
        'changed_by'
      )
    group by table_schema, table_name
    having pg_catalog.count(*) = 5
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: conversation_state_history structure is unexpected';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'state_transitions'
      and column_name in ('from_state', 'to_state')
    group by table_schema, table_name
    having pg_catalog.count(*) = 2
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: state_transitions structure is unexpected';
  end if;



  if exists (
    select 1
    from public.conversation_states state_row
    join public.conversations conversation_row
      on conversation_row.id =
         state_row.conversation_id
    where state_row.organization_id
          is distinct from
          conversation_row.organization_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'precondition failed: conversation_states organization mismatch was found';
  end if;

  if exists (
    select 1
    from public.conversation_states state_row
    group by state_row.conversation_id
    having pg_catalog.count(*) > 1
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: duplicate conversation_states rows were found';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class table_row
      on table_row.oid = index_row.indrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = table_row.relnamespace
    where namespace_row.nspname = 'public'
      and table_row.relname = 'state_transition_log'
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indnkeyatts = 1
      and (
        select pg_catalog.array_agg(
                 attribute_row.attname::text
                 order by key_column.ordinality
               )
        from pg_catalog.unnest(
               index_row.indkey::smallint[]
             ) with ordinality
             as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid =
             index_row.indrelid
         and attribute_row.attnum =
             key_column.attnum
        where key_column.ordinality <=
              index_row.indnkeyatts
      ) = array['event_key']::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: state_transition_log event_key unique index is missing';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class table_row
      on table_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = table_row.relnamespace
    where not trigger_row.tgisinternal
      and namespace_row.nspname = 'public'
      and table_row.relname = 'conversations'
      and trigger_row.tgname =
          'log_conversation_status_change'
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: conversation status log trigger binding is unexpected';
  end if;
end;
$preflight$;

create or replace function public._conversation_transition_context(
  p_conversation_id uuid
)
returns table (
  conversation_id uuid,
  lead_id uuid,
  store_id uuid,
  organization_id uuid,
  conversation_status text,
  conversation_state text,
  lead_state text,
  current_state text,
  is_human_active boolean
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
begin
  return query
  select
    conversation_row.id,
    conversation_row.lead_id,
    lead_row.store_id,
    lead_row.organization_id,
    conversation_row.status,
    state_row.state,
    lead_row.state,
    coalesce(
      state_row.state,
      lead_row.state,
      conversation_row.status
    ),
    conversation_row.is_human_active
  from public.conversations conversation_row
  join public.leads lead_row
    on lead_row.id = conversation_row.lead_id
  join public.stores store_row
    on store_row.id = lead_row.store_id
   and store_row.organization_id = lead_row.organization_id
  left join public.conversation_states state_row
    on state_row.conversation_id = conversation_row.id
   and state_row.organization_id = lead_row.organization_id
  where conversation_row.id = p_conversation_id
    and conversation_row.organization_id = lead_row.organization_id
  for update of conversation_row;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'conversation canonical context is invalid';
  end if;
end;
$function$;

alter function public._conversation_transition_context(uuid)
  owner to postgres;

revoke all on function public._conversation_transition_context(uuid)
  from public, anon, authenticated, service_role;

create or replace function public._conversation_transition_role_is_allowed(
  p_role text
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
  select pg_catalog.lower(pg_catalog.btrim(coalesce(p_role, ''))) = 'owner'
$function$;

alter function public._conversation_transition_role_is_allowed(text)
  owner to postgres;

revoke all on function public._conversation_transition_role_is_allowed(text)
  from public, anon, authenticated, service_role;

create or replace function public._conversation_transition_normalize_state(
  p_state text
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_state text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_state, '')));
begin
  if v_state = '' then
    raise exception using
      errcode = '22023',
      message = 'invalid conversation state';
  end if;

  return v_state;
end;
$function$;

alter function public._conversation_transition_normalize_state(text)
  owner to postgres;

revoke all on function public._conversation_transition_normalize_state(text)
  from public, anon, authenticated, service_role;

create or replace function public._conversation_transition_validate_actor(
  p_actor_type text,
  p_actor_user_id uuid
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_actor_type text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_actor_type, '')));
begin
  if v_actor_type not in ('human', 'ai', 'system') then
    raise exception using
      errcode = '22023',
      message = 'invalid conversation transition actor';
  end if;

  if v_actor_type = 'human' and p_actor_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'invalid conversation transition actor';
  end if;

  if v_actor_type <> 'human' and p_actor_user_id is not null then
    raise exception using
      errcode = '22023',
      message = 'invalid conversation transition actor';
  end if;

  return v_actor_type;
end;
$function$;

alter function public._conversation_transition_validate_actor(text, uuid)
  owner to postgres;

revoke all on function public._conversation_transition_validate_actor(text, uuid)
  from public, anon, authenticated, service_role;

create or replace function public._conversation_transition_normalize_source(
  p_source text
)
returns text
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
  select coalesce(
    nullif(
      pg_catalog.btrim(coalesce(p_source, '')),
      ''
    ),
    'conversation_transition'
  )
$function$;

alter function public._conversation_transition_normalize_source(text)
  owner to postgres;

revoke all on function public._conversation_transition_normalize_source(text)
  from public, anon, authenticated, service_role;

create or replace function public._conversation_transition_effective_event_key(
  p_event_key text
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_event_key text := nullif(
    pg_catalog.btrim(coalesce(p_event_key, '')),
    ''
  );
begin
  if v_event_key is not null then
    return v_event_key;
  end if;

  return 'state_transition:' || extensions.gen_random_uuid()::text;
end;
$function$;

alter function public._conversation_transition_effective_event_key(text)
  owner to postgres;

revoke all on function public._conversation_transition_effective_event_key(text)
  from public, anon, authenticated, service_role;

create or replace function public.trg_log_conversation_status_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_store_id uuid;
  v_metadata jsonb;
  v_source text;
  v_event_key text;
begin
  if tg_op <> 'UPDATE'
     or old.status is not distinct from new.status
  then
    return new;
  end if;

  if coalesce(
       pg_catalog.current_setting(
         'app.skip_conversation_status_transition_log',
         true
       ),
       'false'
     ) = 'true'
  then
    return new;
  end if;

  select lead_row.store_id
  into v_store_id
  from public.leads lead_row
  join public.stores store_row
    on store_row.id = lead_row.store_id
   and store_row.organization_id = lead_row.organization_id
  where lead_row.id = new.lead_id
    and lead_row.organization_id = new.organization_id;

  if v_store_id is null then
    raise exception using
      errcode = '23514',
      message = 'conversation canonical context is invalid';
  end if;

  v_metadata := coalesce(
    new.last_status_metadata,
    '{}'::jsonb
  );

  v_source := coalesce(
    nullif(
      pg_catalog.btrim(v_metadata ->> 'source'),
      ''
    ),
    nullif(
      pg_catalog.btrim(v_metadata ->> 'origin'),
      ''
    ),
    'conversation_status_trigger'
  );

  v_event_key := nullif(
    pg_catalog.btrim(v_metadata ->> 'event_key'),
    ''
  );

  if v_event_key is null then
    v_event_key := 'conversation_status_trigger:'
      || extensions.gen_random_uuid()::text;
  end if;

  v_metadata := v_metadata
    || pg_catalog.jsonb_build_object(
      'source',
      v_source,
      'event_key',
      v_event_key
    );

  insert into public.state_transition_log (
    organization_id,
    store_id,
    conversation_id,
    from_state,
    to_state,
    actor_type,
    actor_user_id,
    reason,
    metadata,
    event_key
  )
  values (
    new.organization_id,
    v_store_id,
    new.id,
    old.status,
    new.status,
    coalesce(
      new.last_status_actor_type,
      'system'
    ),
    new.last_status_actor_user_id,
    new.last_status_reason,
    v_metadata,
    v_event_key
  );

  return new;
end;
$function$;

alter function public.trg_log_conversation_status_change()
  owner to postgres;

revoke all on function public.trg_log_conversation_status_change()
  from public, anon, authenticated, service_role;

drop trigger if exists log_conversation_status_change
  on public.conversations;

create trigger log_conversation_status_change
  after update of status on public.conversations
  for each row
  execute function public.trg_log_conversation_status_change();

create or replace function public.block_direct_human_flag_update()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if new.is_human_active
       is distinct from old.is_human_active
     and coalesce(
           pg_catalog.current_setting(
             'app.allow_state_update',
             true
           ),
           'false'
         ) <> 'true'
  then
    raise exception using
      errcode = '42501',
      message = 'direct is_human_active update is not allowed';
  end if;

  return new;
end;
$function$;

alter function public.block_direct_human_flag_update()
  owner to postgres;

revoke all on function public.block_direct_human_flag_update()
  from public, anon, authenticated, service_role;

create or replace function public.resolve_human_release_target_state(
  p_conversation_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_target_state text;
begin
  select pg_catalog.lower(
           pg_catalog.btrim(log_row.from_state)
         )
  into v_target_state
  from public.state_transition_log log_row
  where log_row.conversation_id =
        p_conversation_id
    and pg_catalog.lower(
          pg_catalog.btrim(
            coalesce(
              log_row.to_state,
              ''
            )
          )
        ) = 'humano_assumiu'
    and nullif(
          pg_catalog.btrim(
            coalesce(
              log_row.from_state,
              ''
            )
          ),
          ''
        ) is not null
    and exists (
      select 1
      from public.state_transitions transition_row
      where pg_catalog.lower(
              pg_catalog.btrim(
                coalesce(
                  transition_row.from_state,
                  ''
                )
              )
            ) = 'humano_assumiu'
        and pg_catalog.lower(
              pg_catalog.btrim(
                coalesce(
                  transition_row.to_state,
                  ''
                )
              )
            )
            =
            pg_catalog.lower(
              pg_catalog.btrim(log_row.from_state)
            )
    )
  order by log_row.created_at desc, log_row.id desc
  limit 1;

  if v_target_state is not null then
    return v_target_state;
  end if;

  select pg_catalog.lower(
           pg_catalog.btrim(
             coalesce(
               nullif(
                 pg_catalog.btrim(state_row.state),
                 ''
               ),
               nullif(
                 pg_catalog.btrim(lead_row.state),
                 ''
               )
             )
           )
         )
  into v_target_state
  from public.conversations conversation_row
  join public.leads lead_row
    on lead_row.id = conversation_row.lead_id
   and lead_row.organization_id =
       conversation_row.organization_id
  left join public.conversation_states state_row
    on state_row.conversation_id =
       conversation_row.id
   and state_row.organization_id =
       conversation_row.organization_id
  where conversation_row.id =
        p_conversation_id;

  if v_target_state is not null
     and v_target_state <> 'humano_assumiu'
     and exists (
       select 1
       from public.state_transitions transition_row
       where pg_catalog.lower(
               pg_catalog.btrim(
                 coalesce(
                   transition_row.from_state,
                   ''
                 )
               )
             ) = 'humano_assumiu'
         and pg_catalog.lower(
               pg_catalog.btrim(
                 coalesce(
                   transition_row.to_state,
                   ''
                 )
               )
             ) = v_target_state
     )
  then
    return v_target_state;
  end if;

  if not exists (
    select 1
    from public.state_transitions transition_row
    where pg_catalog.lower(
            pg_catalog.btrim(
              coalesce(
                transition_row.from_state,
                ''
              )
            )
          ) = 'humano_assumiu'
      and pg_catalog.lower(
            pg_catalog.btrim(
              coalesce(
                transition_row.to_state,
                ''
              )
            )
          ) = 'qualificacao'
  ) then
    raise exception using
      errcode = '23514',
      message =
        'human release fallback transition is unavailable';
  end if;

  return 'qualificacao';
end;
$function$;

alter function public.resolve_human_release_target_state(uuid)
  owner to postgres;

revoke all on function public.resolve_human_release_target_state(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.resolve_human_release_target_state(uuid)
  to postgres;

create or replace function public._apply_conversation_state_transition(
  p_conversation_id uuid,
  p_to_state text,
  p_actor_type text,
  p_actor_user_id uuid default null,
  p_reason text default null,
  p_source text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_event_key text default null,
  p_request_organization_id uuid default null,
  p_require_owner boolean default false
)
returns public.conversations
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_context record;
  v_target_state text;
  v_actor_type text;
  v_membership_role text;
  v_result public.conversations%rowtype;
  v_input_metadata jsonb :=
    coalesce(p_metadata, '{}'::jsonb);
  v_audit_metadata jsonb;
  v_event_key text;
  v_source text;
  v_existing_log public.state_transition_log%rowtype;
  v_previous_allow_state_update text;
  v_previous_skip_status_log text;
  v_state_changed boolean;
  v_sync_needed boolean;
  v_lead_state_sync_allowed boolean;
begin
  select *
  into v_context
  from public._conversation_transition_context(
    p_conversation_id
  );

  v_target_state :=
    public._conversation_transition_normalize_state(
      p_to_state
    );

  v_actor_type :=
    public._conversation_transition_validate_actor(
      p_actor_type,
      p_actor_user_id
    );

  if p_request_organization_id is not null
     and p_request_organization_id
           is distinct from v_context.organization_id
  then
    raise exception using
      errcode = '23514',
      message =
        'conversation transition organization mismatch';
  end if;

  if pg_catalog.jsonb_typeof(v_input_metadata)
       <> 'object'
  then
    raise exception using
      errcode = '22023',
      message =
        'invalid conversation transition metadata';
  end if;

  if v_actor_type = 'human' then
    select membership_row.role
    into v_membership_role
    from public.memberships membership_row
    where membership_row.organization_id =
          v_context.organization_id
      and membership_row.user_id =
          p_actor_user_id
    order by membership_row.created_at nulls first
    limit 1;

    if v_membership_role is null then
      raise exception using
        errcode = '42501',
        message =
          'conversation transition is not authorized';
    end if;

    if p_require_owner
       and not public._conversation_transition_role_is_allowed(
         v_membership_role
       )
    then
      raise exception using
        errcode = '42501',
        message =
          'conversation transition is not authorized';
    end if;
  end if;

  if v_context.current_state is distinct from
       v_target_state
     and not exists (
       select 1
       from public.state_transitions transition_row
       where pg_catalog.lower(
               pg_catalog.btrim(
                 coalesce(
                   transition_row.from_state,
                   ''
                 )
               )
             )
             =
             pg_catalog.lower(
               pg_catalog.btrim(
                 coalesce(
                   v_context.current_state,
                   ''
                 )
               )
             )
         and pg_catalog.lower(
               pg_catalog.btrim(
                 coalesce(
                   transition_row.to_state,
                   ''
                 )
               )
             )
             = v_target_state
     )
  then
    raise exception using
      errcode = '23514',
      message =
        'invalid conversation state transition';
  end if;

  v_event_key :=
    public._conversation_transition_effective_event_key(
      p_event_key
    );

  v_source :=
    public._conversation_transition_normalize_source(
      p_source
    );


  select pg_catalog.strpos(
           pg_catalog.pg_get_constraintdef(
             constraint_row.oid,
             true
           ),
           pg_catalog.quote_literal(v_target_state)
         ) > 0
  into v_lead_state_sync_allowed
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid =
        'public.leads'::pg_catalog.regclass
    and constraint_row.conname =
        'leads_state_allowed_check'
    and constraint_row.contype = 'c';

  if v_lead_state_sync_allowed is null then
    raise exception using
      errcode = 'P0001',
      message =
        'legacy lead state constraint could not be resolved';
  end if;

  v_audit_metadata :=
    v_input_metadata
    || pg_catalog.jsonb_build_object(
      'source',
      v_source,
      'event_key',
      v_event_key,
      'organization_id',
      v_context.organization_id,
      'store_id',
      v_context.store_id,
      'compatibility_bridge',
      'legacy_conversation_transition',
      'legacy_lead_state_sync_policy',
      case
        when v_lead_state_sync_allowed
          then 'allowed_by_legacy_constraint'
        else 'skipped_by_legacy_constraint'
      end
    );

  select *
  into v_existing_log
  from public.state_transition_log log_row
  where log_row.event_key = v_event_key;

  if found then
    if v_existing_log.conversation_id
         is distinct from p_conversation_id
       or pg_catalog.lower(
            pg_catalog.btrim(
              coalesce(
                v_existing_log.to_state,
                ''
              )
            )
          )
          is distinct from v_target_state
       or pg_catalog.lower(
            pg_catalog.btrim(
              coalesce(
                v_existing_log.actor_type,
                ''
              )
            )
          )
          is distinct from v_actor_type
       or v_existing_log.actor_user_id
            is distinct from p_actor_user_id
       or coalesce(
            v_existing_log.reason,
            ''
          )
          is distinct from
          coalesce(p_reason, '')
       or coalesce(
            v_existing_log.metadata ->> 'source',
            ''
          )
          is distinct from v_source
       or coalesce(
            v_existing_log.metadata,
            '{}'::jsonb
          )
          is distinct from v_audit_metadata
    then
      raise exception using
        errcode = '23505',
        message =
          'conversation transition event_key conflict';
    end if;

    select *
    into v_result
    from public.conversations conversation_row
    where conversation_row.id =
          p_conversation_id;

    return v_result;
  end if;

  v_state_changed :=
    v_context.current_state
      is distinct from v_target_state;

  v_sync_needed :=
    v_context.conversation_status
      is distinct from v_target_state
    or v_context.conversation_state
      is distinct from v_target_state
    or (
      v_lead_state_sync_allowed
      and v_context.lead_state
            is distinct from v_target_state
    )
    or coalesce(
         v_context.is_human_active,
         false
       )
       is distinct from
       (v_target_state = 'humano_assumiu');

  if not v_state_changed
     and not v_sync_needed
  then
    select *
    into v_result
    from public.conversations conversation_row
    where conversation_row.id =
          p_conversation_id;

    return v_result;
  end if;

  v_previous_allow_state_update :=
    pg_catalog.current_setting(
      'app.allow_state_update',
      true
    );

  v_previous_skip_status_log :=
    pg_catalog.current_setting(
      'app.skip_conversation_status_transition_log',
      true
    );

  begin
    perform pg_catalog.set_config(
      'app.allow_state_update',
      'true',
      true
    );

    perform pg_catalog.set_config(
      'app.skip_conversation_status_transition_log',
      'true',
      true
    );

    update public.conversations
    set
      status = v_target_state,
      is_human_active =
        (v_target_state = 'humano_assumiu'),
      last_status_actor_type = v_actor_type,
      last_status_actor_user_id =
        p_actor_user_id,
      last_status_reason = p_reason,
      last_status_metadata =
        v_audit_metadata
    where id = p_conversation_id
      and organization_id =
          v_context.organization_id;

    if not found then
      raise exception using
        errcode = '23514',
        message =
          'conversation canonical context is invalid';
    end if;

    if v_state_changed then
      update public.conversation_states
      set
        state = v_target_state,
        entered_at =
          pg_catalog.clock_timestamp(),
        updated_at =
          pg_catalog.clock_timestamp()
      where conversation_id =
            p_conversation_id
        and organization_id =
            v_context.organization_id;

      if not found then
        insert into public.conversation_states (
          conversation_id,
          organization_id,
          state,
          entered_at,
          created_at,
          updated_at
        )
        values (
          p_conversation_id,
          v_context.organization_id,
          v_target_state,
          pg_catalog.clock_timestamp(),
          pg_catalog.clock_timestamp(),
          pg_catalog.clock_timestamp()
        );
      end if;
    elsif v_context.conversation_state
            is distinct from v_target_state
    then
      update public.conversation_states
      set
        state = v_target_state,
        updated_at =
          pg_catalog.clock_timestamp()
      where conversation_id =
            p_conversation_id
        and organization_id =
            v_context.organization_id;

      if not found then
        insert into public.conversation_states (
          conversation_id,
          organization_id,
          state,
          entered_at,
          created_at,
          updated_at
        )
        values (
          p_conversation_id,
          v_context.organization_id,
          v_target_state,
          pg_catalog.clock_timestamp(),
          pg_catalog.clock_timestamp(),
          pg_catalog.clock_timestamp()
        );
      end if;
    end if;

    -- Ponte temporaria do modelo legado. Esta
    -- sincronizacao sera removida quando o modelo
    -- canonico por oportunidade comercial entrar
    -- no Bloco 4.
    update public.leads
    set state = v_target_state
    where id = v_context.lead_id
      and organization_id =
          v_context.organization_id
      and v_lead_state_sync_allowed
      and state is distinct from v_target_state;

    if v_state_changed then
      insert into public.conversation_state_history (
        conversation_id,
        organization_id,
        from_state,
        to_state,
        changed_by
      )
      values (
        p_conversation_id,
        v_context.organization_id,
        v_context.current_state,
        v_target_state,
        v_actor_type
      );

      insert into public.state_transition_log (
        organization_id,
        store_id,
        conversation_id,
        from_state,
        to_state,
        actor_type,
        actor_user_id,
        reason,
        metadata,
        event_key
      )
      values (
        v_context.organization_id,
        v_context.store_id,
        p_conversation_id,
        v_context.current_state,
        v_target_state,
        v_actor_type,
        p_actor_user_id,
        p_reason,
        v_audit_metadata,
        v_event_key
      );
    end if;

    select *
    into v_result
    from public.conversations conversation_row
    where conversation_row.id =
          p_conversation_id;

    perform pg_catalog.set_config(
      'app.skip_conversation_status_transition_log',
      coalesce(
        v_previous_skip_status_log,
        ''
      ),
      true
    );

    perform pg_catalog.set_config(
      'app.allow_state_update',
      coalesce(
        v_previous_allow_state_update,
        ''
      ),
      true
    );
  exception
    when others then
      perform pg_catalog.set_config(
        'app.skip_conversation_status_transition_log',
        coalesce(
          v_previous_skip_status_log,
          ''
        ),
        true
      );

      perform pg_catalog.set_config(
        'app.allow_state_update',
        coalesce(
          v_previous_allow_state_update,
          ''
        ),
        true
      );

      raise;
  end;

  return v_result;
end;
$function$;

alter function public._apply_conversation_state_transition(
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  jsonb,
  text,
  uuid,
  boolean
)
  owner to postgres;

comment on function public._apply_conversation_state_transition(
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  jsonb,
  text,
  uuid,
  boolean
) is
  'Ponte temporaria legado-compat para transicoes de conversa; substituir no Bloco 4 pelo modelo canonico por oportunidade comercial.';

revoke all on function public._apply_conversation_state_transition(
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  jsonb,
  text,
  uuid,
  boolean
)
  from public, anon, authenticated, service_role;

grant execute on function public._apply_conversation_state_transition(
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  jsonb,
  text,
  uuid,
  boolean
)
  to postgres;

create or replace function public.transition_conversation_state(
  p_conversation_id uuid,
  p_to_state text,
  p_changed_by text default 'system'::text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_changed_by text :=
    pg_catalog.lower(
      pg_catalog.btrim(
        coalesce(p_changed_by, '')
      )
    );
  v_user_id uuid := auth.uid();
  v_request_role text :=
    nullif(
      pg_catalog.current_setting(
        'request.jwt.claim.role',
        true
      ),
      ''
    );
begin
  if v_changed_by = 'human'
     and v_user_id is not null
     and v_request_role = 'authenticated'
  then
    perform public.transition_conversation_state_by_user(
      p_conversation_id =>
        p_conversation_id,
      p_to_state => p_to_state,
      p_actor_user_id => v_user_id,
      p_reason => null,
      p_source =>
        'transition_conversation_state',
      p_request_organization_id => null,
      p_event_key => null,
      p_metadata =>
        pg_catalog.jsonb_build_object(
          'compatibility_bridge',
          'legacy_conversation_transition',
          'legacy_changed_by',
          v_changed_by
        )
    );

    return;
  end if;

  perform public._apply_conversation_state_transition(
    p_conversation_id =>
      p_conversation_id,
    p_to_state => p_to_state,
    p_actor_type =>
      case
        when v_changed_by = 'ai' then 'ai'
        else 'system'
      end,
    p_actor_user_id => null,
    p_reason => null,
    p_source =>
      'transition_conversation_state',
    p_metadata =>
      pg_catalog.jsonb_build_object(
        'compatibility_bridge',
        'legacy_conversation_transition',
        'legacy_changed_by',
        coalesce(
          nullif(v_changed_by, ''),
          'system'
        ),
        'legacy_actor_normalized_to',
        case
          when v_changed_by = 'ai' then 'ai'
          else 'system'
        end
      ),
    p_event_key => null,
    p_request_organization_id => null,
    p_require_owner => false
  );
end;
$function$;

alter function public.transition_conversation_state(
  uuid,
  text,
  text
)
  owner to postgres;

create or replace function public.update_conversation_state(
  p_conversation_id uuid,
  p_new_state text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
begin
  perform public.transition_conversation_state(
    p_conversation_id,
    p_new_state,
    'system'
  );
end;
$function$;

create or replace function public.update_conversation_state(
  p_conversation_id uuid,
  p_new_state text,
  p_changed_by text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
begin
  perform public.transition_conversation_state(
    p_conversation_id,
    p_new_state,
    p_changed_by
  );
end;
$function$;

alter function public.update_conversation_state(
  uuid,
  text
)
  owner to postgres;

alter function public.update_conversation_state(
  uuid,
  text,
  text
)
  owner to postgres;

create or replace function public.transition_conversation_state_internal(
  p_conversation_id uuid,
  p_to_state text,
  p_reason text,
  p_actor_type text,
  p_source text,
  p_event_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.conversations
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_request_role text :=
    nullif(
      pg_catalog.current_setting(
        'request.jwt.claim.role',
        true
      ),
      ''
    );
  v_actor_type text;
begin
  v_actor_type :=
    public._conversation_transition_validate_actor(
      p_actor_type,
      null
    );

  if v_actor_type not in ('ai', 'system') then
    raise exception using
      errcode = '22023',
      message =
        'invalid conversation transition actor';
  end if;

  if v_request_role <> 'service_role'
     and session_user <> 'postgres'
  then
    raise exception using
      errcode = '42501',
      message =
        'conversation transition is not authorized';
  end if;

  return public._apply_conversation_state_transition(
    p_conversation_id =>
      p_conversation_id,
    p_to_state => p_to_state,
    p_actor_type => v_actor_type,
    p_actor_user_id => null,
    p_reason => p_reason,
    p_source => p_source,
    p_metadata => p_metadata,
    p_event_key => p_event_key,
    p_request_organization_id => null,
    p_require_owner => false
  );
end;
$function$;

alter function public.transition_conversation_state_internal(
  uuid,
  text,
  text,
  text,
  text,
  text,
  jsonb
)
  owner to postgres;

create or replace function public.transition_conversation_state_by_user(
  p_conversation_id uuid,
  p_to_state text,
  p_actor_user_id uuid,
  p_reason text,
  p_source text,
  p_request_organization_id uuid default null,
  p_event_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.conversations
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_authenticated_user_id uuid := auth.uid();
  v_request_role text :=
    nullif(
      pg_catalog.current_setting(
        'request.jwt.claim.role',
        true
      ),
      ''
    );
begin
  if v_request_role = 'authenticated' then
    if v_authenticated_user_id is null
       or p_actor_user_id
            is distinct from
            v_authenticated_user_id
    then
      raise exception using
        errcode = '42501',
        message =
          'conversation transition is not authorized';
    end if;
  elsif v_request_role = 'service_role' then
    if p_actor_user_id is null
       or p_request_organization_id is null
    then
      raise exception using
        errcode = '42501',
        message =
          'conversation transition is not authorized';
    end if;
  elsif session_user = 'postgres' then
    if p_actor_user_id is null then
      raise exception using
        errcode = '42501',
        message =
          'conversation transition is not authorized';
    end if;
  else
    raise exception using
      errcode = '42501',
      message =
        'conversation transition is not authorized';
  end if;

  return public._apply_conversation_state_transition(
    p_conversation_id =>
      p_conversation_id,
    p_to_state => p_to_state,
    p_actor_type => 'human',
    p_actor_user_id => p_actor_user_id,
    p_reason => p_reason,
    p_source => p_source,
    p_metadata => p_metadata,
    p_event_key => p_event_key,
    p_request_organization_id =>
      p_request_organization_id,
    p_require_owner => true
  );
end;
$function$;

alter function public.transition_conversation_state_by_user(
  uuid,
  text,
  uuid,
  text,
  text,
  uuid,
  text,
  jsonb
)
  owner to postgres;

create or replace function public.human_takeover_conversation(
  p_conversation_id uuid,
  p_reason text default 'painel'::text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text :=
    nullif(
      pg_catalog.current_setting(
        'request.jwt.claim.role',
        true
      ),
      ''
    );
begin
  if v_user_id is not null
     and v_request_role = 'authenticated'
  then
    perform public.transition_conversation_state_by_user(
      p_conversation_id =>
        p_conversation_id,
      p_to_state => 'humano_assumiu',
      p_actor_user_id => v_user_id,
      p_reason => p_reason,
      p_source =>
        'human_takeover_conversation',
      p_request_organization_id => null,
      p_event_key => null,
      p_metadata =>
        pg_catalog.jsonb_build_object(
          'compatibility_bridge',
          'legacy_conversation_transition',
          'wrapper',
          'human_takeover_conversation',
          'takeover_mode',
          'authenticated_human'
        )
    );

    return;
  end if;

  if v_request_role = 'service_role'
     or session_user = 'postgres'
  then
    perform public.transition_conversation_state_internal(
      p_conversation_id =>
        p_conversation_id,
      p_to_state => 'humano_assumiu',
      p_reason => p_reason,
      p_actor_type => 'system',
      p_source =>
        'human_takeover_conversation',
      p_event_key => null,
      p_metadata =>
        pg_catalog.jsonb_build_object(
          'compatibility_bridge',
          'legacy_conversation_transition',
          'wrapper',
          'human_takeover_conversation',
          'takeover_mode',
          'internal_system'
        )
    );

    return;
  end if;

  raise exception using
    errcode = '42501',
    message =
      'conversation transition is not authorized';
end;
$function$;

alter function public.human_takeover_conversation(
  uuid,
  text
)
  owner to postgres;

create or replace function public.human_release_conversation_to_ai(
  p_conversation_id uuid,
  p_to_state text default null,
  p_reason text default 'painel'::text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text :=
    nullif(
      pg_catalog.current_setting(
        'request.jwt.claim.role',
        true
      ),
      ''
    );
  v_target_state text;
begin
  v_target_state :=
    coalesce(
      nullif(
        pg_catalog.btrim(
          coalesce(
            p_to_state,
            ''
          )
        ),
        ''
      ),
      public.resolve_human_release_target_state(
        p_conversation_id
      )
    );

  if v_user_id is not null
     and v_request_role = 'authenticated'
  then
    perform public.transition_conversation_state_by_user(
      p_conversation_id =>
        p_conversation_id,
      p_to_state => v_target_state,
      p_actor_user_id => v_user_id,
      p_reason => p_reason,
      p_source =>
        'human_release_conversation_to_ai',
      p_request_organization_id => null,
      p_event_key => null,
      p_metadata =>
        pg_catalog.jsonb_build_object(
          'compatibility_bridge',
          'legacy_conversation_transition',
          'wrapper',
          'human_release_conversation_to_ai',
          'release_mode',
          'authenticated_human'
        )
    );

    return;
  end if;

  if v_request_role = 'service_role'
     or session_user = 'postgres'
  then
    perform public.transition_conversation_state_internal(
      p_conversation_id =>
        p_conversation_id,
      p_to_state => v_target_state,
      p_reason => p_reason,
      p_actor_type => 'system',
      p_source =>
        'human_release_conversation_to_ai',
      p_event_key => null,
      p_metadata =>
        pg_catalog.jsonb_build_object(
          'compatibility_bridge',
          'legacy_conversation_transition',
          'wrapper',
          'human_release_conversation_to_ai',
          'release_mode',
          'internal_system'
        )
    );

    return;
  end if;

  raise exception using
    errcode = '42501',
    message =
      'conversation transition is not authorized';
end;
$function$;

alter function public.human_release_conversation_to_ai(
  uuid,
  text,
  text
)
  owner to postgres;

create or replace function public.panel_transition_conversation_state_scoped(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_to_state text,
  p_reason text default 'manual_move_from_crm'::text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'conversation transition is not authorized';
  end if;

  perform public.transition_conversation_state_by_user(
    p_conversation_id => p_conversation_id,
    p_to_state => p_to_state,
    p_actor_user_id => v_user_id,
    p_reason => p_reason,
    p_source => 'panel_transition_conversation_state_scoped',
    p_request_organization_id => p_organization_id,
    p_event_key => null,
    p_metadata => pg_catalog.jsonb_build_object(
      'compatibility_bridge',
      'legacy_conversation_transition',
      'wrapper',
      'panel_transition_conversation_state_scoped'
    )
  );
end;
$function$;

alter function public.panel_transition_conversation_state_scoped(uuid, uuid, text, text)
  owner to postgres;

create or replace function public.panel_takeover_conversation_scoped(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_reason text default 'painel'::text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'conversation transition is not authorized';
  end if;

  perform public.transition_conversation_state_by_user(
    p_conversation_id => p_conversation_id,
    p_to_state => 'humano_assumiu',
    p_actor_user_id => v_user_id,
    p_reason => p_reason,
    p_source => 'panel_takeover_conversation_scoped',
    p_request_organization_id => p_organization_id,
    p_event_key => null,
    p_metadata => pg_catalog.jsonb_build_object(
      'compatibility_bridge',
      'legacy_conversation_transition',
      'wrapper',
      'panel_takeover_conversation_scoped'
    )
  );
end;
$function$;

alter function public.panel_takeover_conversation_scoped(uuid, uuid, text)
  owner to postgres;

create or replace function public.panel_release_conversation_to_ai_scoped(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_to_state text default null,
  p_reason text default 'painel'::text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text :=
    nullif(
      pg_catalog.current_setting(
        'request.jwt.claim.role',
        true
      ),
      ''
    );
  v_target_state text;
begin
  if v_user_id is null
     or v_request_role <> 'authenticated'
  then
    raise exception using
      errcode = '42501',
      message =
        'conversation transition is not authorized';
  end if;

  v_target_state :=
    coalesce(
      nullif(
        pg_catalog.btrim(
          coalesce(
            p_to_state,
            ''
          )
        ),
        ''
      ),
      public.resolve_human_release_target_state(
        p_conversation_id
      )
    );

  perform public.transition_conversation_state_by_user(
    p_conversation_id =>
      p_conversation_id,
    p_to_state => v_target_state,
    p_actor_user_id => v_user_id,
    p_reason => p_reason,
    p_source =>
      'panel_release_conversation_to_ai_scoped',
    p_request_organization_id =>
      p_organization_id,
    p_event_key => null,
    p_metadata =>
      pg_catalog.jsonb_build_object(
        'compatibility_bridge',
        'legacy_conversation_transition',
        'wrapper',
        'panel_release_conversation_to_ai_scoped',
        'requested_to_state',
        p_to_state
      )
  );
end;
$function$;

alter function public.panel_release_conversation_to_ai_scoped(
  uuid,
  uuid,
  text,
  text
)
  owner to postgres;

revoke all on function public.transition_conversation_state(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.update_conversation_state(uuid, text)
  from public, anon, authenticated;
revoke all on function public.update_conversation_state(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.transition_conversation_state_internal(
  uuid, text, text, text, text, text, jsonb
)
  from public, anon, authenticated;
revoke all on function public.transition_conversation_state_by_user(
  uuid, text, uuid, text, text, uuid, text, jsonb
)
  from public, anon;
revoke all on function public.human_takeover_conversation(uuid, text)
  from public, anon, authenticated;
revoke all on function public.human_release_conversation_to_ai(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.panel_transition_conversation_state_scoped(uuid, uuid, text, text)
  from public, anon;
revoke all on function public.panel_takeover_conversation_scoped(uuid, uuid, text)
  from public, anon;
revoke all on function public.panel_release_conversation_to_ai_scoped(uuid, uuid, text, text)
  from public, anon;
revoke all on function public.apply_ai_decision(uuid)
  from public, anon, authenticated;
revoke all on function public.apply_auto_state_transition_after_event()
  from public, anon, authenticated, service_role;
revoke all on function public.block_direct_human_flag_update()
  from public, anon, authenticated, service_role;

grant execute on function public.transition_conversation_state(uuid, text, text)
  to service_role, postgres;
grant execute on function public.update_conversation_state(uuid, text)
  to service_role, postgres;
grant execute on function public.update_conversation_state(uuid, text, text)
  to service_role, postgres;
grant execute on function public.transition_conversation_state_internal(
  uuid, text, text, text, text, text, jsonb
)
  to service_role, postgres;
grant execute on function public.transition_conversation_state_by_user(
  uuid, text, uuid, text, text, uuid, text, jsonb
)
  to authenticated, service_role, postgres;
grant execute on function public.human_takeover_conversation(uuid, text)
  to service_role, postgres;
grant execute on function public.human_release_conversation_to_ai(uuid, text, text)
  to service_role, postgres;
grant execute on function public.panel_transition_conversation_state_scoped(uuid, uuid, text, text)
  to authenticated, service_role, postgres;
grant execute on function public.panel_takeover_conversation_scoped(uuid, uuid, text)
  to authenticated, service_role, postgres;
grant execute on function public.panel_release_conversation_to_ai_scoped(uuid, uuid, text, text)
  to authenticated, service_role, postgres;
grant execute on function public.apply_ai_decision(uuid)
  to service_role, postgres;

do $postconditions$
declare
  v_signature text;
  v_oid oid;
  v_definition text;
  v_trigger_count integer;
begin
  foreach v_signature in array array[
    'public.transition_conversation_state(uuid,text,text)',
    'public.update_conversation_state(uuid,text)',
    'public.update_conversation_state(uuid,text,text)',
    'public.panel_transition_conversation_state_scoped(uuid,uuid,text,text)',
    'public.panel_takeover_conversation_scoped(uuid,uuid,text)',
    'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)',
    'public.human_takeover_conversation(uuid,text)',
    'public.human_release_conversation_to_ai(uuid,text,text)',
    'public.apply_ai_decision(uuid)',
    'public.trg_log_conversation_status_change()',
    'public.transition_conversation_state_internal(uuid,text,text,text,text,text,jsonb)',
    'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception using
        errcode = 'P0001',
        message = 'postcondition failed: required function is missing: ' || v_signature;
    end if;
  end loop;

  if pg_catalog.pg_get_function_result(
       'public.transition_conversation_state(uuid,text,text)'::pg_catalog.regprocedure
     ) <> 'void'
     or pg_catalog.pg_get_function_result(
          'public.update_conversation_state(uuid,text)'::pg_catalog.regprocedure
        ) <> 'void'
     or pg_catalog.pg_get_function_result(
          'public.update_conversation_state(uuid,text,text)'::pg_catalog.regprocedure
        ) <> 'void'
     or pg_catalog.pg_get_function_result(
          'public.panel_transition_conversation_state_scoped(uuid,uuid,text,text)'::pg_catalog.regprocedure
        ) <> 'void'
     or pg_catalog.pg_get_function_result(
          'public.panel_takeover_conversation_scoped(uuid,uuid,text)'::pg_catalog.regprocedure
        ) <> 'void'
     or pg_catalog.pg_get_function_result(
          'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'::pg_catalog.regprocedure
        ) <> 'void'
     or pg_catalog.pg_get_function_result(
          'public.human_takeover_conversation(uuid,text)'::pg_catalog.regprocedure
        ) <> 'void'
     or pg_catalog.pg_get_function_result(
          'public.human_release_conversation_to_ai(uuid,text,text)'::pg_catalog.regprocedure
        ) <> 'void'
     or pg_catalog.pg_get_function_result(
          'public.apply_ai_decision(uuid)'::pg_catalog.regprocedure
        ) <> 'void'
     or pg_catalog.pg_get_function_result(
          'public.trg_log_conversation_status_change()'::pg_catalog.regprocedure
        ) <> 'trigger'
     or pg_catalog.pg_get_function_result(
          'public.transition_conversation_state_internal(uuid,text,text,text,text,text,jsonb)'::pg_catalog.regprocedure
        ) <> 'public.conversations'
     or pg_catalog.pg_get_function_result(
          'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)'::pg_catalog.regprocedure
        ) <> 'public.conversations'
  then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: one or more function return types changed unexpectedly';
  end if;

  if has_function_privilege(
       'anon',
       'public.panel_transition_conversation_state_scoped(uuid,uuid,text,text)',
       'EXECUTE'
     )
     or exists (
          select 1
          from pg_catalog.pg_proc procedure_row
          cross join lateral pg_catalog.aclexplode(
            coalesce(
              procedure_row.proacl,
              pg_catalog.acldefault('f', procedure_row.proowner)
            )
          ) acl_row
          where procedure_row.oid =
                'public.panel_transition_conversation_state_scoped(uuid,uuid,text,text)'::pg_catalog.regprocedure
            and acl_row.grantee = 0
            and acl_row.privilege_type = 'EXECUTE'
        )
  then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: panel_transition_conversation_state_scoped remains executable by anon or PUBLIC';
  end if;

  if has_function_privilege(
       'anon',
       'public.update_conversation_state(uuid,text)',
       'EXECUTE'
     )
     or exists (
          select 1
          from pg_catalog.pg_proc procedure_row
          cross join lateral pg_catalog.aclexplode(
            coalesce(
              procedure_row.proacl,
              pg_catalog.acldefault('f', procedure_row.proowner)
            )
          ) acl_row
          where procedure_row.oid =
                'public.update_conversation_state(uuid,text)'::pg_catalog.regprocedure
            and acl_row.grantee = 0
            and acl_row.privilege_type = 'EXECUTE'
        )
     or has_function_privilege(
          'authenticated',
          'public.update_conversation_state(uuid,text)',
          'EXECUTE'
        )
     or has_function_privilege(
          'anon',
          'public.update_conversation_state(uuid,text,text)',
          'EXECUTE'
        )
     or exists (
          select 1
          from pg_catalog.pg_proc procedure_row
          cross join lateral pg_catalog.aclexplode(
            coalesce(
              procedure_row.proacl,
              pg_catalog.acldefault('f', procedure_row.proowner)
            )
          ) acl_row
          where procedure_row.oid =
                'public.update_conversation_state(uuid,text,text)'::pg_catalog.regprocedure
            and acl_row.grantee = 0
            and acl_row.privilege_type = 'EXECUTE'
        )
     or has_function_privilege(
          'authenticated',
          'public.update_conversation_state(uuid,text,text)',
          'EXECUTE'
        )
  then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: update_conversation_state remains exposed outside internal roles';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.transition_conversation_state_internal(uuid,text,text,text,text,text,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
          'anon',
          'public.transition_conversation_state_internal(uuid,text,text,text,text,text,jsonb)',
          'EXECUTE'
        )
     or exists (
          select 1
          from pg_catalog.pg_proc procedure_row
          cross join lateral pg_catalog.aclexplode(
            coalesce(
              procedure_row.proacl,
              pg_catalog.acldefault('f', procedure_row.proowner)
            )
          ) acl_row
          where procedure_row.oid =
                'public.transition_conversation_state_internal(uuid,text,text,text,text,text,jsonb)'::pg_catalog.regprocedure
            and acl_row.grantee = 0
            and acl_row.privilege_type = 'EXECUTE'
        )
  then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: transition_conversation_state_internal is executable by non-internal roles';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure_row
    where procedure_row.oid =
          'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)'::pg_catalog.regprocedure
      and procedure_row.prosecdef
      and procedure_row.proconfig @> array[
        'search_path=pg_catalog, pg_temp',
        'row_security=off'
      ]::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: transition_conversation_state_by_user has unsafe SECURITY DEFINER configuration';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure_row
    where procedure_row.oid =
          'public.transition_conversation_state_internal(uuid,text,text,text,text,text,jsonb)'::pg_catalog.regprocedure
      and procedure_row.prosecdef
      and procedure_row.proconfig @> array[
        'search_path=pg_catalog, pg_temp',
        'row_security=off'
      ]::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: transition_conversation_state_internal has unsafe SECURITY DEFINER configuration';
  end if;


  if not has_function_privilege(
       'authenticated',
       'public.panel_transition_conversation_state_scoped(uuid,uuid,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
          'authenticated',
          'public.panel_takeover_conversation_scoped(uuid,uuid,text)',
          'EXECUTE'
        )
     or not has_function_privilege(
          'authenticated',
          'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)',
          'EXECUTE'
        )
  then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: one or more authenticated panel wrappers lost EXECUTE';
  end if;

  if not has_function_privilege(
       'service_role',
       'public.transition_conversation_state_internal(uuid,text,text,text,text,text,jsonb)',
       'EXECUTE'
     )
     or not has_function_privilege(
          'service_role',
          'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)',
          'EXECUTE'
        )
  then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: required backend transition wrappers lost EXECUTE';
  end if;

  if has_function_privilege(
       'authenticated',
       'public._apply_conversation_state_transition(uuid,text,text,uuid,text,text,jsonb,text,uuid,boolean)',
       'EXECUTE'
     )
     or has_function_privilege(
          'anon',
          'public._apply_conversation_state_transition(uuid,text,text,uuid,text,text,jsonb,text,uuid,boolean)',
          'EXECUTE'
        )
     or has_function_privilege(
          'service_role',
          'public._apply_conversation_state_transition(uuid,text,text,uuid,text,text,jsonb,text,uuid,boolean)',
          'EXECUTE'
        )
     or has_function_privilege(
          'authenticated',
          'public.resolve_human_release_target_state(uuid)',
          'EXECUTE'
        )
     or has_function_privilege(
          'anon',
          'public.resolve_human_release_target_state(uuid)',
          'EXECUTE'
        )
     or has_function_privilege(
          'service_role',
          'public.resolve_human_release_target_state(uuid)',
          'EXECUTE'
        )
     or has_function_privilege(
          'authenticated',
          'public.trg_log_conversation_status_change()',
          'EXECUTE'
        )
     or has_function_privilege(
          'anon',
          'public.trg_log_conversation_status_change()',
          'EXECUTE'
        )
  then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: internal transition helpers remain exposed';
  end if;

  select pg_catalog.lower(
           pg_catalog.pg_get_functiondef(
             'public._apply_conversation_state_transition(uuid,text,text,uuid,text,text,jsonb,text,uuid,boolean)'::pg_catalog.regprocedure
           )
         )
  into v_definition;

  if pg_catalog.strpos(
       v_definition,
       'app.allow_state_update'
     ) = 0
     or pg_catalog.strpos(
          v_definition,
          '''true'''
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          'app.skip_conversation_status_transition_log'
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          'insert into public.state_transition_log'
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          'insert into public.conversation_state_history'
        ) = 0
  then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: central transition bridge is missing required guarded writes';
  end if;

  select pg_catalog.lower(
           pg_catalog.pg_get_functiondef(
             'public.trg_log_conversation_status_change()'::pg_catalog.regprocedure
           )
         )
  into v_definition;

  if pg_catalog.strpos(
       v_definition,
       'app.skip_conversation_status_transition_log'
     ) = 0
     or pg_catalog.strpos(
          v_definition,
          'source'
        ) = 0
  then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: status trigger does not honor the bridge bypass';
  end if;

  select pg_catalog.count(*)
  into v_trigger_count
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_class table_row
    on table_row.oid = trigger_row.tgrelid
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = table_row.relnamespace
  where not trigger_row.tgisinternal
    and namespace_row.nspname = 'public'
    and table_row.relname = 'conversations'
    and trigger_row.tgname = 'log_conversation_status_change'
    and trigger_row.tgfoid =
        'public.trg_log_conversation_status_change()'::pg_catalog.regprocedure;

  if v_trigger_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: status transition trigger binding is invalid';
  end if;


  if not exists (
    select 1
    from pg_catalog.pg_proc procedure_row
    where procedure_row.oid =
          'public.block_direct_human_flag_update()'::pg_catalog.regprocedure
      and not procedure_row.prosecdef
      and procedure_row.proconfig @> array[
        'search_path=pg_catalog, pg_temp'
      ]::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: block_direct_human_flag_update configuration is unsafe';
  end if;

  foreach v_signature in array array[
    'public._conversation_transition_context(uuid)',
    'public.trg_log_conversation_status_change()',
    'public.resolve_human_release_target_state(uuid)',
    'public._apply_conversation_state_transition(uuid,text,text,uuid,text,text,jsonb,text,uuid,boolean)',
    'public.transition_conversation_state(uuid,text,text)',
    'public.update_conversation_state(uuid,text)',
    'public.update_conversation_state(uuid,text,text)',
    'public.transition_conversation_state_internal(uuid,text,text,text,text,text,jsonb)',
    'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)',
    'public.human_takeover_conversation(uuid,text)',
    'public.human_release_conversation_to_ai(uuid,text,text)',
    'public.panel_transition_conversation_state_scoped(uuid,uuid,text,text)',
    'public.panel_takeover_conversation_scoped(uuid,uuid,text)',
    'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'
  ] loop
    v_oid := pg_catalog.to_regprocedure(v_signature);

    if v_oid is null then
      raise exception using
        errcode = 'P0001',
        message = 'postcondition failed: SECURITY DEFINER function missing after migration: ' || v_signature;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_proc procedure_row
      where procedure_row.oid = v_oid
        and procedure_row.prosecdef
        and procedure_row.proconfig @> array[
          'search_path=pg_catalog, pg_temp'
        ]::text[]
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'postcondition failed: unsafe SECURITY DEFINER search_path on ' || v_signature;
    end if;
  end loop;
end;
$postconditions$;

commit;

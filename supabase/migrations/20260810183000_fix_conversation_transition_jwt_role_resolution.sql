begin;

do $preflight$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)',
    'public.human_takeover_conversation(uuid,text)',
    'public.human_release_conversation_to_ai(uuid,text,text)',
    'public.panel_takeover_conversation_scoped(uuid,uuid,text)',
    'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception using
        errcode = 'P0001',
        message = 'precondition failed: required function is missing: ' || v_signature;
    end if;
  end loop;
end;
$preflight$;

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
    coalesce(
      nullif(
        pg_catalog.current_setting(
          'request.jwt.claim.role',
          true
        ),
        ''
      ),
      nullif(
        auth.jwt() ->> 'role',
        ''
      )
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
    coalesce(
      nullif(
        pg_catalog.current_setting(
          'request.jwt.claim.role',
          true
        ),
        ''
      ),
      nullif(
        auth.jwt() ->> 'role',
        ''
      )
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
    coalesce(
      nullif(
        pg_catalog.current_setting(
          'request.jwt.claim.role',
          true
        ),
        ''
      ),
      nullif(
        auth.jwt() ->> 'role',
        ''
      )
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
  v_request_role text :=
    coalesce(
      nullif(
        pg_catalog.current_setting(
          'request.jwt.claim.role',
          true
        ),
        ''
      ),
      nullif(
        auth.jwt() ->> 'role',
        ''
      )
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

alter function public.panel_takeover_conversation_scoped(
  uuid,
  uuid,
  text
)
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
    coalesce(
      nullif(
        pg_catalog.current_setting(
          'request.jwt.claim.role',
          true
        ),
        ''
      ),
      nullif(
        auth.jwt() ->> 'role',
        ''
      )
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

do $postconditions$
declare
  v_signature text;
  v_definition text;
  v_normalized_definition text;
begin
  foreach v_signature in array array[
    'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)',
    'public.human_takeover_conversation(uuid,text)',
    'public.human_release_conversation_to_ai(uuid,text,text)',
    'public.panel_takeover_conversation_scoped(uuid,uuid,text)',
    'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception using
        errcode = 'P0001',
        message = 'postcondition failed: missing function after jwt role fix: ' || v_signature;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_proc proc_row
      where proc_row.oid = pg_catalog.to_regprocedure(v_signature)
        and proc_row.prosecdef
        and proc_row.proconfig @> array[
          'search_path=pg_catalog, pg_temp',
          'row_security=off'
        ]::text[]
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'postcondition failed: unsafe security contract after jwt role fix: ' || v_signature;
    end if;

    select pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(v_signature))
    into v_definition;
    v_normalized_definition :=
      pg_catalog.regexp_replace(
        coalesce(v_definition, ''),
        '\s+',
        ' ',
        'g'
      );

    if v_definition is null
       or position('auth.jwt() ->> ''role''' in v_normalized_definition) = 0
       or position('request.jwt.claim.role' in v_normalized_definition) = 0 then
      raise exception using
        errcode = 'P0001',
        message = 'postcondition failed: jwt role fallback missing from function: ' || v_signature;
    end if;
  end loop;

  select pg_catalog.pg_get_functiondef(
           'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)'::pg_catalog.regprocedure
         )
  into v_definition;
  v_normalized_definition :=
    pg_catalog.regexp_replace(
      coalesce(v_definition, ''),
      '\s+',
      ' ',
      'g'
    );

  if v_definition is null
     or position('p_actor_user_id' in v_normalized_definition) = 0
     or position('v_authenticated_user_id' in v_normalized_definition) = 0
     or position('p_require_owner => true' in v_normalized_definition) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: human ownership contract changed in transition_conversation_state_by_user';
  end if;

  select pg_catalog.pg_get_functiondef(
           'public._apply_conversation_state_transition(uuid,text,text,uuid,text,text,jsonb,text,uuid,boolean)'::pg_catalog.regprocedure
         )
  into v_definition;
  v_normalized_definition :=
    pg_catalog.regexp_replace(
      coalesce(v_definition, ''),
      '\s+',
      ' ',
      'g'
    );

  if v_definition is null
     or position('membership_row.organization_id = v_context.organization_id' in v_normalized_definition) = 0
     or position('membership_row.user_id = p_actor_user_id' in v_normalized_definition) = 0
     or position('conversation transition is not authorized' in v_normalized_definition) = 0
     or position('conversation transition organization mismatch' in v_normalized_definition) = 0
     or position('public._conversation_transition_role_is_allowed' in v_normalized_definition) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: membership, organization, or owner enforcement changed in _apply_conversation_state_transition';
  end if;

  if exists (
       select 1
       from pg_catalog.pg_proc proc_row
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           proc_row.proacl,
           pg_catalog.acldefault('f', proc_row.proowner)
         )
       ) acl_row
       where proc_row.oid in (
         'public.panel_takeover_conversation_scoped(uuid,uuid,text)'::pg_catalog.regprocedure,
         'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'::pg_catalog.regprocedure,
         'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)'::pg_catalog.regprocedure
       )
         and acl_row.grantee = 0
         and acl_row.privilege_type = 'EXECUTE'
     )
     or has_function_privilege(
          'anon',
          'public.panel_takeover_conversation_scoped(uuid,uuid,text)',
          'EXECUTE'
        )
     or has_function_privilege(
          'anon',
          'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)',
          'EXECUTE'
        )
     or has_function_privilege(
          'anon',
          'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)',
          'EXECUTE'
        ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: anon gained EXECUTE on the legacy conversation bridge';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.panel_takeover_conversation_scoped(uuid,uuid,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
          'authenticated',
          'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)',
          'EXECUTE'
        )
     or not has_function_privilege(
          'authenticated',
          'public.transition_conversation_state_by_user(uuid,text,uuid,text,text,uuid,text,jsonb)',
          'EXECUTE'
        ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: authenticated lost required EXECUTE on the legacy conversation bridge';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.human_takeover_conversation(uuid,text)',
       'EXECUTE'
     )
     or has_function_privilege(
          'authenticated',
          'public.human_release_conversation_to_ai(uuid,text,text)',
          'EXECUTE'
        ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: authenticated unexpectedly gained direct execute on human wrapper functions';
  end if;
end;
$postconditions$;

commit;

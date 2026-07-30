begin isolation level repeatable read;

do $preflight$
declare
  v_count bigint;
  v_old_user_oid oid;
  v_old_system_oid oid;
  v_old_reopen_oid oid;
  v_old_dependents text;
  v_log_state_transition_oid oid;
  v_normalize_loss_reason_oid oid;
  v_normalize_stage_oid oid;
  v_digest_oid oid;
  v_convert_to_oid oid;
  v_encode_oid oid;
begin
  v_old_user_oid := pg_catalog.to_regprocedure(
    'public.mark_commercial_opportunity_lost_by_user(uuid,uuid,uuid,text,text,uuid,text,text)'
  );
  v_old_system_oid := pg_catalog.to_regprocedure(
    'public.mark_commercial_opportunity_lost_by_system(uuid,uuid,uuid,text,uuid,text,text,text)'
  );
  v_old_reopen_oid := pg_catalog.to_regprocedure(
    'public.reopen_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text)'
  );
  v_log_state_transition_oid := pg_catalog.to_regprocedure(
    'public.log_state_transition(uuid,uuid,uuid,text,text,text,uuid,text,jsonb)'
  );
  v_normalize_loss_reason_oid := pg_catalog.to_regprocedure(
    'public.normalize_commercial_opportunity_loss_reason_code(text)'
  );
  v_normalize_stage_oid := pg_catalog.to_regprocedure(
    'public.normalize_commercial_opportunity_stage(text)'
  );

  if v_old_user_oid is null
     or v_old_system_oid is null
     or v_old_reopen_oid is null
     or v_log_state_transition_oid is null
     or v_normalize_loss_reason_oid is null
     or v_normalize_stage_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: required canonical functions are missing';
  end if;

  select pg_catalog.string_agg(
           pg_catalog.pg_describe_object(
             depend_row.classid,
             depend_row.objid,
             depend_row.objsubid
           ),
           '; '
           order by depend_row.classid, depend_row.objid, depend_row.objsubid
         )
  into v_old_dependents
  from pg_catalog.pg_depend depend_row
  where depend_row.refobjid in (v_old_user_oid, v_old_system_oid, v_old_reopen_oid)
    and depend_row.deptype = 'n';

  if v_old_dependents is not null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: old lifecycle rpcs still have dependent sql objects',
      detail = v_old_dependents;
  end if;

  if (
    select count(*)
    from pg_catalog.pg_depend depend_row
    where depend_row.refobjid in (v_old_user_oid, v_old_system_oid, v_old_reopen_oid)
      and depend_row.deptype = 'n'
  ) <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: old lifecycle rpcs still have dependent sql objects';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'mark_commercial_opportunity_lost_by_user'
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: unexpected overloads for public.mark_commercial_opportunity_lost_by_user';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'mark_commercial_opportunity_lost_by_system'
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: unexpected overloads for public.mark_commercial_opportunity_lost_by_system';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'reopen_commercial_opportunity_by_user'
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: unexpected overloads for public.reopen_commercial_opportunity_by_user';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_roles role_row
      on role_row.oid = proc_row.proowner
    where proc_row.oid = v_old_user_oid
      and proc_row.pronargs = 8
      and proc_row.proargnames[1:proc_row.pronargs] = array[
        'p_request_organization_id',
        'p_store_id',
        'p_commercial_opportunity_id',
        'p_reason_code',
        'p_reason_details',
        'p_evidence_message_id',
        'p_evidence_summary',
        'p_source'
      ]
      and proc_row.proargmodes = array[
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char"
      ]
      and proc_row.proargnames[proc_row.pronargs + 1:pg_catalog.array_length(proc_row.proargnames, 1)] = array[
        'commercial_opportunity_id',
        'stage',
        'lifecycle_cycle',
        'current_loss_event_id',
        'lost_at',
        'lost_reason_code',
        'lost_reason_details'
      ]
      and proc_row.proallargtypes = array[
        'uuid'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'integer'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'timestamp with time zone'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'text'::pg_catalog.regtype
      ]::oid[]
      and pg_catalog.pg_get_function_result(proc_row.oid) = 'TABLE(commercial_opportunity_id uuid, stage text, lifecycle_cycle integer, current_loss_event_id uuid, lost_at timestamp with time zone, lost_reason_code text, lost_reason_details text)'
      and pg_catalog.pg_get_expr(proc_row.proargdefaults, 0) = 'NULL::text, NULL::uuid, NULL::text, ''manual_user_loss''::text'
      and role_row.rolname = 'postgres'
      and proc_row.prosecdef
      and proc_row.provolatile = 'v'
      and proc_row.proparallel = 'u'
      and proc_row.pronargdefaults = 4
      and pg_catalog.obj_description(proc_row.oid, 'pg_proc') is null
      and proc_row.proacl is not null
      and has_function_privilege('postgres', proc_row.oid, 'EXECUTE')
      and has_function_privilege('authenticated', proc_row.oid, 'EXECUTE')
      and not has_function_privilege('service_role', proc_row.oid, 'EXECUTE')
      and not has_function_privilege('anon', proc_row.oid, 'EXECUTE')
      and not exists (
        select 1
        from pg_catalog.aclexplode(proc_row.proacl) acl_row
        where acl_row.grantee = 0
          and acl_row.privilege_type = 'EXECUTE'
      )
      and exists (
        select 1
        from pg_catalog.unnest(proc_row.proconfig) config_row
        where config_row = 'search_path=pg_catalog, pg_temp, public'
      )
      and exists (
        select 1
        from pg_catalog.unnest(proc_row.proconfig) config_row
        where config_row = 'row_security=off'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: old user loss rpc contract mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_roles role_row
      on role_row.oid = proc_row.proowner
    where proc_row.oid = v_old_system_oid
      and proc_row.pronargs = 8
      and proc_row.proargnames[1:proc_row.pronargs] = array[
        'p_organization_id',
        'p_store_id',
        'p_commercial_opportunity_id',
        'p_reason_code',
        'p_evidence_message_id',
        'p_evidence_summary',
        'p_actor_type',
        'p_source'
      ]
      and proc_row.proargmodes = array[
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char"
      ]
      and proc_row.proargnames[proc_row.pronargs + 1:pg_catalog.array_length(proc_row.proargnames, 1)] = array[
        'commercial_opportunity_id',
        'stage',
        'lifecycle_cycle',
        'current_loss_event_id',
        'lost_at',
        'lost_reason_code'
      ]
      and proc_row.proallargtypes = array[
        'uuid'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'integer'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'timestamp with time zone'::pg_catalog.regtype,
        'text'::pg_catalog.regtype
      ]::oid[]
      and pg_catalog.pg_get_function_result(proc_row.oid) = 'TABLE(commercial_opportunity_id uuid, stage text, lifecycle_cycle integer, current_loss_event_id uuid, lost_at timestamp with time zone, lost_reason_code text)'
      and proc_row.proargdefaults is null
      and role_row.rolname = 'postgres'
      and proc_row.prosecdef
      and proc_row.provolatile = 'v'
      and proc_row.proparallel = 'u'
      and proc_row.pronargdefaults = 0
      and pg_catalog.obj_description(proc_row.oid, 'pg_proc') is null
      and proc_row.proacl is not null
      and has_function_privilege('postgres', proc_row.oid, 'EXECUTE')
      and has_function_privilege('service_role', proc_row.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', proc_row.oid, 'EXECUTE')
      and not has_function_privilege('anon', proc_row.oid, 'EXECUTE')
      and not exists (
        select 1
        from pg_catalog.aclexplode(proc_row.proacl) acl_row
        where acl_row.grantee = 0
          and acl_row.privilege_type = 'EXECUTE'
      )
      and exists (
        select 1
        from pg_catalog.unnest(proc_row.proconfig) config_row
        where config_row = 'search_path=pg_catalog, pg_temp, public'
      )
      and exists (
        select 1
        from pg_catalog.unnest(proc_row.proconfig) config_row
        where config_row = 'row_security=off'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: old system loss rpc contract mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_roles role_row
      on role_row.oid = proc_row.proowner
    where proc_row.oid = v_old_reopen_oid
      and proc_row.pronargs = 6
      and proc_row.proargnames[1:proc_row.pronargs] = array[
        'p_request_organization_id',
        'p_store_id',
        'p_commercial_opportunity_id',
        'p_target_stage',
        'p_reason_details',
        'p_source'
      ]
      and proc_row.proargmodes = array[
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char"
      ]
      and proc_row.proargnames[proc_row.pronargs + 1:pg_catalog.array_length(proc_row.proargnames, 1)] = array[
        'commercial_opportunity_id',
        'stage',
        'lifecycle_cycle',
        'current_loss_event_id',
        'last_reopened_at'
      ]
      and proc_row.proallargtypes = array[
        'uuid'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'integer'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'timestamp with time zone'::pg_catalog.regtype
      ]::oid[]
      and pg_catalog.pg_get_function_result(proc_row.oid) = 'TABLE(commercial_opportunity_id uuid, stage text, lifecycle_cycle integer, current_loss_event_id uuid, last_reopened_at timestamp with time zone)'
      and proc_row.proargdefaults is null
      and role_row.rolname = 'postgres'
      and proc_row.prosecdef
      and proc_row.provolatile = 'v'
      and proc_row.proparallel = 'u'
      and proc_row.pronargdefaults = 0
      and pg_catalog.obj_description(proc_row.oid, 'pg_proc') is null
      and proc_row.proacl is not null
      and has_function_privilege('postgres', proc_row.oid, 'EXECUTE')
      and has_function_privilege('authenticated', proc_row.oid, 'EXECUTE')
      and not has_function_privilege('service_role', proc_row.oid, 'EXECUTE')
      and not has_function_privilege('anon', proc_row.oid, 'EXECUTE')
      and not exists (
        select 1
        from pg_catalog.aclexplode(proc_row.proacl) acl_row
        where acl_row.grantee = 0
          and acl_row.privilege_type = 'EXECUTE'
      )
      and exists (
        select 1
        from pg_catalog.unnest(proc_row.proconfig) config_row
        where config_row = 'search_path=pg_catalog, pg_temp, public'
      )
      and exists (
        select 1
        from pg_catalog.unnest(proc_row.proconfig) config_row
        where config_row = 'row_security=off'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: old reopen rpc contract mismatch';
  end if;

  select count(*)
  into v_count
  from public.commercial_opportunities;

  if v_count <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.commercial_opportunities must be empty before idempotency hardening';
  end if;

  select count(*)
  into v_count
  from public.commercial_opportunity_lifecycle_events;

  if v_count <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.commercial_opportunity_lifecycle_events must be empty before idempotency hardening';
  end if;

  if exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'commercial_opportunity_lifecycle_events'
      and column_row.column_name in ('idempotency_key', 'event_key')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: lifecycle event idempotency columns already exist';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class class_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname in (
        'commercial_opportunity_lifecycle_events_idempotency_uidx',
        'commercial_opportunity_lifecycle_events_operational_slot_uidx'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: lifecycle event idempotency indexes already exist';
  end if;

  v_digest_oid := pg_catalog.to_regprocedure('extensions.digest(bytea,text)');
  v_convert_to_oid := pg_catalog.to_regprocedure('pg_catalog.convert_to(text,name)');
  v_encode_oid := pg_catalog.to_regprocedure('pg_catalog.encode(bytea,text)');
  if v_digest_oid is null
     or v_convert_to_oid is null
     or v_encode_oid is null
     or not exists (
       select 1
       from pg_catalog.pg_proc proc_row
       join pg_catalog.pg_namespace namespace_row
         on namespace_row.oid = proc_row.pronamespace
       where namespace_row.nspname = 'pg_catalog'
         and proc_row.proname = 'jsonb_build_object'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: required digest and json helpers are unavailable';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class class_row
      on class_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'commercial_opportunities'
      and trigger_row.tgname = 'commercial_opportunities_prevent_core_change'
      and trigger_row.tgenabled = 'O'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: commercial_opportunities_prevent_core_change trigger is missing or disabled';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class class_row
      on class_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'commercial_opportunities'
      and trigger_row.tgname = 'commercial_opportunities_05_enforce_lifecycle_projection'
      and trigger_row.tgenabled = 'O'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: commercial_opportunities_05_enforce_lifecycle_projection trigger is missing or disabled';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class class_row
      on class_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'commercial_opportunities'
      and trigger_row.tgname = 'commercial_opportunities_10_enforce_loss_stage_transition'
      and trigger_row.tgenabled = 'O'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: commercial_opportunities_10_enforce_loss_stage_transition trigger is missing or disabled';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class class_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'commercial_opportunities'
      and class_row.relrowsecurity
      and not class_row.relforcerowsecurity
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.commercial_opportunities must keep rls enabled';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class class_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'commercial_opportunity_lifecycle_events'
      and class_row.relrowsecurity
      and not class_row.relforcerowsecurity
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.commercial_opportunity_lifecycle_events must keep rls enabled';
  end if;

  if not has_table_privilege('authenticated', 'public.commercial_opportunities', 'SELECT')
     or not has_table_privilege('authenticated', 'public.commercial_opportunities', 'INSERT')
     or not has_table_privilege('authenticated', 'public.commercial_opportunities', 'UPDATE')
     or has_table_privilege('authenticated', 'public.commercial_opportunities', 'DELETE')
     or has_table_privilege('authenticated', 'public.commercial_opportunities', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.commercial_opportunities', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.commercial_opportunities', 'TRIGGER')
     or has_table_privilege('anon', 'public.commercial_opportunities', 'SELECT')
     or has_table_privilege('anon', 'public.commercial_opportunities', 'INSERT')
     or has_table_privilege('anon', 'public.commercial_opportunities', 'UPDATE')
     or has_table_privilege('anon', 'public.commercial_opportunities', 'DELETE')
     or has_table_privilege('anon', 'public.commercial_opportunities', 'TRUNCATE')
     or has_table_privilege('anon', 'public.commercial_opportunities', 'REFERENCES')
     or has_table_privilege('anon', 'public.commercial_opportunities', 'TRIGGER')
     or not has_table_privilege('service_role', 'public.commercial_opportunities', 'INSERT')
     or not has_table_privilege('service_role', 'public.commercial_opportunities', 'UPDATE')
     or not has_table_privilege('service_role', 'public.commercial_opportunities', 'DELETE')
     or not has_table_privilege('service_role', 'public.commercial_opportunities', 'TRUNCATE')
     or not has_table_privilege('service_role', 'public.commercial_opportunities', 'REFERENCES')
     or not has_table_privilege('service_role', 'public.commercial_opportunities', 'TRIGGER') then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.commercial_opportunities grants diverged from audited state';
  end if;

  if not has_table_privilege('authenticated', 'public.commercial_opportunity_lifecycle_events', 'SELECT')
     or has_table_privilege('authenticated', 'public.commercial_opportunity_lifecycle_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.commercial_opportunity_lifecycle_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.commercial_opportunity_lifecycle_events', 'DELETE')
     or has_table_privilege('authenticated', 'public.commercial_opportunity_lifecycle_events', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.commercial_opportunity_lifecycle_events', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.commercial_opportunity_lifecycle_events', 'TRIGGER')
     or has_table_privilege('anon', 'public.commercial_opportunity_lifecycle_events', 'SELECT')
     or has_table_privilege('anon', 'public.commercial_opportunity_lifecycle_events', 'INSERT')
     or has_table_privilege('anon', 'public.commercial_opportunity_lifecycle_events', 'UPDATE')
     or has_table_privilege('anon', 'public.commercial_opportunity_lifecycle_events', 'DELETE')
     or has_table_privilege('anon', 'public.commercial_opportunity_lifecycle_events', 'TRUNCATE')
     or has_table_privilege('anon', 'public.commercial_opportunity_lifecycle_events', 'REFERENCES')
     or has_table_privilege('anon', 'public.commercial_opportunity_lifecycle_events', 'TRIGGER')
     or not has_table_privilege('service_role', 'public.commercial_opportunity_lifecycle_events', 'SELECT')
     or has_table_privilege('service_role', 'public.commercial_opportunity_lifecycle_events', 'INSERT')
     or has_table_privilege('service_role', 'public.commercial_opportunity_lifecycle_events', 'UPDATE')
     or has_table_privilege('service_role', 'public.commercial_opportunity_lifecycle_events', 'DELETE')
     or has_table_privilege('service_role', 'public.commercial_opportunity_lifecycle_events', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.commercial_opportunity_lifecycle_events', 'REFERENCES')
     or has_table_privilege('service_role', 'public.commercial_opportunity_lifecycle_events', 'TRIGGER') then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.commercial_opportunity_lifecycle_events grants diverged from audited state';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policy policy_row
    join pg_catalog.pg_class class_row
      on class_row.oid = policy_row.polrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'commercial_opportunities'
      and policy_row.polname = 'commercial_opportunities_insert_by_membership'
      and policy_row.polcmd = 'a'
      and policy_row.polpermissive
      and policy_row.polroles = array['authenticated'::pg_catalog.regrole]::oid[]
      and pg_catalog.btrim(
            pg_catalog.regexp_replace(
              pg_catalog.replace(
                pg_catalog.pg_get_expr(policy_row.polwithcheck, policy_row.polrelid),
                'public.',
                ''
              ),
              '\s+',
              ' ',
              'g'
            )
          ) = pg_catalog.btrim(
            pg_catalog.regexp_replace(
              '((EXISTS ( SELECT 1 FROM memberships m WHERE ((m.organization_id = commercial_opportunities.organization_id) AND (m.user_id = auth.uid())))) AND (EXISTS ( SELECT 1 FROM stores s WHERE ((s.id = commercial_opportunities.store_id) AND (s.organization_id = commercial_opportunities.organization_id)))) AND (EXISTS ( SELECT 1 FROM customers c WHERE ((c.id = commercial_opportunities.customer_id) AND (c.organization_id = commercial_opportunities.organization_id)))))',
              '\s+',
              ' ',
              'g'
            )
          )
      and policy_row.polqual is null
  ) or not exists (
    select 1
    from pg_catalog.pg_policy policy_row
    join pg_catalog.pg_class class_row
      on class_row.oid = policy_row.polrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'commercial_opportunities'
      and policy_row.polname = 'commercial_opportunities_update_by_membership'
      and policy_row.polcmd = 'w'
      and policy_row.polpermissive
      and policy_row.polroles = array['authenticated'::pg_catalog.regrole]::oid[]
      and pg_catalog.btrim(
            pg_catalog.regexp_replace(
              pg_catalog.replace(
                pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid),
                'public.',
                ''
              ),
              '\s+',
              ' ',
              'g'
            )
          ) = pg_catalog.btrim(
            pg_catalog.regexp_replace(
              '(EXISTS ( SELECT 1 FROM memberships m WHERE ((m.organization_id = commercial_opportunities.organization_id) AND (m.user_id = auth.uid()))))',
              '\s+',
              ' ',
              'g'
            )
          )
      and pg_catalog.btrim(
            pg_catalog.regexp_replace(
              pg_catalog.replace(
                pg_catalog.pg_get_expr(policy_row.polwithcheck, policy_row.polrelid),
                'public.',
                ''
              ),
              '\s+',
              ' ',
              'g'
            )
          ) = pg_catalog.btrim(
            pg_catalog.regexp_replace(
              '((EXISTS ( SELECT 1 FROM memberships m WHERE ((m.organization_id = commercial_opportunities.organization_id) AND (m.user_id = auth.uid())))) AND (EXISTS ( SELECT 1 FROM stores s WHERE ((s.id = commercial_opportunities.store_id) AND (s.organization_id = commercial_opportunities.organization_id)))) AND (EXISTS ( SELECT 1 FROM customers c WHERE ((c.id = commercial_opportunities.customer_id) AND (c.organization_id = commercial_opportunities.organization_id)))))',
              '\s+',
              ' ',
              'g'
            )
          )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: expected commercial_opportunities write policies are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_roles role_row
      on role_row.oid = proc_row.proowner
    where proc_row.oid = v_log_state_transition_oid
      and role_row.rolname = 'postgres'
      and pg_catalog.pg_get_function_arguments(proc_row.oid) = 'p_organization_id uuid, p_store_id uuid, p_conversation_id uuid, p_from_state text, p_to_state text, p_actor_type text, p_actor_user_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_metadata jsonb DEFAULT ''{}''::jsonb'
      and pg_catalog.pg_get_function_result(proc_row.oid) = 'uuid'
      and proc_row.provolatile = 'v'
      and proc_row.proparallel = 'u'
      and proc_row.prosecdef
      and proc_row.pronargdefaults = 3
      and exists (
        select 1
        from pg_catalog.unnest(proc_row.proconfig) config_row
        where config_row = 'search_path=pg_catalog, pg_temp'
      )
      and pg_catalog.obj_description(proc_row.oid, 'pg_proc') = 'Registra transicao de estado com escopo canonico conversation -> lead -> store e event_key deterministico.'
      and has_function_privilege('postgres', proc_row.oid, 'EXECUTE')
      and has_function_privilege('service_role', proc_row.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', proc_row.oid, 'EXECUTE')
      and not has_function_privilege('anon', proc_row.oid, 'EXECUTE')
      and not exists (
        select 1
        from pg_catalog.aclexplode(coalesce(proc_row.proacl, pg_catalog.acldefault('f', proc_row.proowner))) acl_row
        where acl_row.grantee = 0
          and acl_row.privilege_type = 'EXECUTE'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: log_state_transition contract mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_roles role_row
      on role_row.oid = proc_row.proowner
    where proc_row.oid = v_normalize_loss_reason_oid
      and role_row.rolname = 'postgres'
      and pg_catalog.pg_get_function_arguments(proc_row.oid) = 'p_reason_code text'
      and pg_catalog.pg_get_function_result(proc_row.oid) = 'text'
      and proc_row.provolatile = 'v'
      and proc_row.proparallel = 'u'
      and not proc_row.prosecdef
      and proc_row.pronargdefaults = 0
      and exists (
        select 1
        from pg_catalog.unnest(proc_row.proconfig) config_row
        where config_row = 'search_path=pg_catalog, pg_temp'
      )
      and pg_catalog.obj_description(proc_row.oid, 'pg_proc') is null
      and has_function_privilege('postgres', proc_row.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', proc_row.oid, 'EXECUTE')
      and not has_function_privilege('service_role', proc_row.oid, 'EXECUTE')
      and not has_function_privilege('anon', proc_row.oid, 'EXECUTE')
      and not exists (
        select 1
        from pg_catalog.aclexplode(coalesce(proc_row.proacl, pg_catalog.acldefault('f', proc_row.proowner))) acl_row
        where acl_row.grantee = 0
          and acl_row.privilege_type = 'EXECUTE'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: normalize_commercial_opportunity_loss_reason_code contract mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_roles role_row
      on role_row.oid = proc_row.proowner
    where proc_row.oid = v_normalize_stage_oid
      and role_row.rolname = 'postgres'
      and pg_catalog.pg_get_function_arguments(proc_row.oid) = 'p_stage text'
      and pg_catalog.pg_get_function_result(proc_row.oid) = 'text'
      and proc_row.provolatile = 'v'
      and proc_row.proparallel = 'u'
      and not proc_row.prosecdef
      and proc_row.pronargdefaults = 0
      and exists (
        select 1
        from pg_catalog.unnest(proc_row.proconfig) config_row
        where config_row = 'search_path=pg_catalog, pg_temp'
      )
      and pg_catalog.obj_description(proc_row.oid, 'pg_proc') is null
      and has_function_privilege('postgres', proc_row.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', proc_row.oid, 'EXECUTE')
      and not has_function_privilege('service_role', proc_row.oid, 'EXECUTE')
      and not has_function_privilege('anon', proc_row.oid, 'EXECUTE')
      and not exists (
        select 1
        from pg_catalog.aclexplode(coalesce(proc_row.proacl, pg_catalog.acldefault('f', proc_row.proowner))) acl_row
        where acl_row.grantee = 0
          and acl_row.privilege_type = 'EXECUTE'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: normalize_commercial_opportunity_stage contract mismatch';
  end if;
end;
$preflight$;

create or replace function public.log_state_transition(
  p_organization_id uuid,
  p_store_id uuid,
  p_conversation_id uuid,
  p_from_state text,
  p_to_state text,
  p_actor_type text,
  p_actor_user_id uuid default null::uuid,
  p_reason text default null::text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_id uuid;
  v_event_key text;
  v_canonical_organization_id uuid;
  v_canonical_store_id uuid;
begin
  if p_conversation_id is null then
    raise exception using
      errcode = '23514',
      message = 'log_state_transition conversation_id is required';
  end if;

  select
    lead_row.organization_id,
    lead_row.store_id
  into
    v_canonical_organization_id,
    v_canonical_store_id
  from public.conversations conversation_row
  join public.leads lead_row
    on lead_row.id = conversation_row.lead_id
  join public.stores store_row
    on store_row.id = lead_row.store_id
   and store_row.organization_id = lead_row.organization_id
  where conversation_row.id = p_conversation_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'log_state_transition canonical conversation scope could not be resolved';
  end if;

  if p_organization_id is distinct from v_canonical_organization_id then
    raise exception using
      errcode = '23514',
      message = 'log_state_transition organization_id does not match canonical conversation scope';
  end if;

  if p_store_id is distinct from v_canonical_store_id then
    raise exception using
      errcode = '23514',
      message = 'log_state_transition store_id does not match canonical conversation scope';
  end if;

  v_event_key := pg_catalog.encode(
    extensions.digest(
      coalesce(p_organization_id::text, '') ||
      coalesce(p_store_id::text, '') ||
      coalesce(p_conversation_id::text, '') ||
      coalesce(p_from_state, '') ||
      coalesce(p_to_state, '') ||
      coalesce(p_actor_type, '') ||
      coalesce(p_actor_user_id::text, '') ||
      coalesce(p_reason, ''),
      'sha256'::text
    ),
    'hex'::text
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
    p_organization_id,
    p_store_id,
    p_conversation_id,
    p_from_state,
    p_to_state,
    p_actor_type,
    p_actor_user_id,
    p_reason,
    coalesce(p_metadata, '{}'::jsonb),
    v_event_key
  )
  returning id into v_id;

  return v_id;
end;
$function$;

alter function public.log_state_transition(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  jsonb
) owner to postgres;

comment on function public.log_state_transition(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  jsonb
) is
  'Registra transicao de estado com escopo canonico conversation -> lead -> store e event_key deterministico.';

revoke all on function public.log_state_transition(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.log_state_transition(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  jsonb
) to service_role;

create or replace function public.normalize_commercial_opportunity_loss_reason_code(
  p_reason_code text
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_reason_code text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_reason_code, '')));
begin
  if v_reason_code = '' then
    return null;
  end if;

  if v_reason_code not in (
    'explicit_refusal',
    'bought_from_competitor',
    'confirmed_out_of_service_area',
    'confirmed_technical_infeasibility',
    'contact_opt_out',
    'other'
  ) then
    raise exception using
      errcode = '22023',
      message = 'ZION_INVALID_LOSS_REASON';
  end if;

  return v_reason_code;
end;
$function$;

alter function public.normalize_commercial_opportunity_loss_reason_code(text)
  owner to postgres;

revoke all on function public.normalize_commercial_opportunity_loss_reason_code(text)
  from public, anon, authenticated, service_role;

create or replace function public.normalize_commercial_opportunity_stage(
  p_stage text
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_stage text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_stage, '')));
begin
  if v_stage = '' then
    return null;
  end if;

  if v_stage not in (
    'novo_lead',
    'qualificacao',
    'orcamento',
    'visita_tecnica',
    'negociacao',
    'fechamento_pagamento',
    'instalacao_entrega',
    'pos_venda',
    'perdido',
    'concluido_sem_mais_acoes'
  ) then
    raise exception using
      errcode = '22023',
      message = 'invalid commercial opportunity stage';
  end if;

  return v_stage;
end;
$function$;

alter function public.normalize_commercial_opportunity_stage(text)
  owner to postgres;

revoke all on function public.normalize_commercial_opportunity_stage(text)
  from public, anon, authenticated, service_role;

alter table public.commercial_opportunity_lifecycle_events
  add column idempotency_key text,
  add column event_key text;

alter table public.commercial_opportunity_lifecycle_events
  alter column idempotency_key set not null,
  alter column event_key set not null;

alter table public.commercial_opportunity_lifecycle_events
  add constraint commercial_opportunity_lifecycle_events_idempotency_key_check
    check (
      pg_catalog.length(pg_catalog.btrim(idempotency_key)) > 0
      and idempotency_key = pg_catalog.btrim(idempotency_key)
    ),
  add constraint commercial_opportunity_lifecycle_events_event_key_sha256_check
    check (event_key ~ '^[0-9a-f]{64}$');

create unique index commercial_opportunity_lifecycle_events_idempotency_uidx
  on public.commercial_opportunity_lifecycle_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    idempotency_key
  );

create unique index commercial_opportunity_lifecycle_events_operational_slot_uidx
  on public.commercial_opportunity_lifecycle_events (
    organization_id,
    store_id,
    commercial_opportunity_id,
    lifecycle_cycle,
    event_type
  )
  where event_type in ('marked_lost', 'reopened');

revoke all on table public.commercial_opportunities
  from public, anon, authenticated, service_role;

grant select on table public.commercial_opportunities
  to authenticated, service_role;

drop policy commercial_opportunities_insert_by_membership
  on public.commercial_opportunities;

drop policy commercial_opportunities_update_by_membership
  on public.commercial_opportunities;

create or replace function public.prevent_commercial_opportunity_core_change()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if new.organization_id is distinct from old.organization_id
     or new.store_id is distinct from old.store_id
     or new.customer_id is distinct from old.customer_id
     or new.origin_lead_id is distinct from old.origin_lead_id
     or new.primary_conversation_id is distinct from old.primary_conversation_id then
    raise exception using
      errcode = 'P0001',
      message = 'commercial opportunity core fields are immutable';
  end if;

  return new;
end;
$function$;

alter function public.prevent_commercial_opportunity_core_change()
  owner to postgres;

comment on function public.prevent_commercial_opportunity_core_change() is
  'Impede alteracao de organization_id, store_id, customer_id, origin_lead_id e primary_conversation_id apos o insert de commercial_opportunities.';

revoke all on function public.prevent_commercial_opportunity_core_change()
  from public, anon, authenticated, service_role;

create or replace function public.enforce_commercial_opportunity_loss_stage_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp, public
as $function$
declare
  v_transition_event public.commercial_opportunity_lifecycle_events;
  v_current_tx bigint := pg_catalog.txid_current();
  v_transition_count integer;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.stage is not distinct from old.stage then
    if old.stage = 'perdido'
       and (
         new.current_loss_event_id is distinct from old.current_loss_event_id
         or new.lost_at is distinct from old.lost_at
         or new.lost_reason_code is distinct from old.lost_reason_code
         or new.lost_reason_details is distinct from old.lost_reason_details
         or new.lifecycle_cycle is distinct from old.lifecycle_cycle
         or new.last_reopened_at is distinct from old.last_reopened_at
       ) then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_DIRECT_LOSS_STAGE_TRANSITION_FORBIDDEN';
    end if;

    if old.stage <> 'perdido'
       and (
         new.lifecycle_cycle is distinct from old.lifecycle_cycle
         or new.lost_at is distinct from old.lost_at
         or new.lost_reason_code is distinct from old.lost_reason_code
         or new.lost_reason_details is distinct from old.lost_reason_details
         or new.current_loss_event_id is distinct from old.current_loss_event_id
         or new.last_reopened_at is distinct from old.last_reopened_at
       ) then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_DIRECT_STAGE_TRANSITION_FORBIDDEN';
    end if;

    return new;
  end if;

  if old.stage <> 'perdido'
     and new.stage = 'perdido' then
    if new.current_loss_event_id is null then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_DIRECT_LOSS_STAGE_TRANSITION_FORBIDDEN';
    end if;

    select lifecycle_event.*
    into v_transition_event
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.id = new.current_loss_event_id
      and lifecycle_event.transaction_id = v_current_tx
      and lifecycle_event.organization_id = old.organization_id
      and lifecycle_event.store_id = old.store_id
      and lifecycle_event.commercial_opportunity_id = old.id
      and lifecycle_event.customer_id = old.customer_id
      and lifecycle_event.lifecycle_cycle = old.lifecycle_cycle
      and lifecycle_event.event_type = 'marked_lost'
      and lifecycle_event.previous_stage is not distinct from old.stage
      and lifecycle_event.new_stage = 'perdido'
    limit 1;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_DIRECT_LOSS_STAGE_TRANSITION_FORBIDDEN';
    end if;

    select count(*)
    into v_transition_count
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.transaction_id = v_current_tx
      and lifecycle_event.organization_id = old.organization_id
      and lifecycle_event.store_id = old.store_id
      and lifecycle_event.commercial_opportunity_id = old.id
      and lifecycle_event.customer_id = old.customer_id
      and lifecycle_event.lifecycle_cycle = old.lifecycle_cycle
      and lifecycle_event.event_type = 'marked_lost';

    if v_transition_count <> 1 then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_LOSS_TRANSITION_EVENT_AMBIGUOUS';
    end if;

    if new.current_loss_event_id is distinct from v_transition_event.id
       or new.lost_at is distinct from v_transition_event.created_at
       or new.lost_reason_code is distinct from v_transition_event.reason_code
       or new.lost_reason_details is distinct from v_transition_event.reason_details
       or new.lifecycle_cycle is distinct from old.lifecycle_cycle
       or new.last_reopened_at is distinct from old.last_reopened_at then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_LOSS_PROJECTION_EVENT_MISMATCH';
    end if;

    return new;
  end if;

  if old.stage = 'perdido'
     and new.stage <> 'perdido' then
    select lifecycle_event.*
    into v_transition_event
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.transaction_id = v_current_tx
      and lifecycle_event.organization_id = old.organization_id
      and lifecycle_event.store_id = old.store_id
      and lifecycle_event.commercial_opportunity_id = old.id
      and lifecycle_event.customer_id = old.customer_id
      and lifecycle_event.lifecycle_cycle = old.lifecycle_cycle
      and lifecycle_event.event_type = 'reopened'
      and lifecycle_event.previous_stage = 'perdido'
      and lifecycle_event.new_stage = new.stage
    order by lifecycle_event.created_at desc
    limit 1;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_DIRECT_REOPEN_TRANSITION_FORBIDDEN';
    end if;

    select count(*)
    into v_transition_count
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.transaction_id = v_current_tx
      and lifecycle_event.organization_id = old.organization_id
      and lifecycle_event.store_id = old.store_id
      and lifecycle_event.commercial_opportunity_id = old.id
      and lifecycle_event.customer_id = old.customer_id
      and lifecycle_event.lifecycle_cycle = old.lifecycle_cycle
      and lifecycle_event.event_type = 'reopened';

    if v_transition_count <> 1 then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_REOPEN_TRANSITION_EVENT_AMBIGUOUS';
    end if;

    if new.lifecycle_cycle <> old.lifecycle_cycle + 1
       or new.current_loss_event_id is not null
       or new.lost_at is not null
       or new.lost_reason_code is not null
       or new.lost_reason_details is not null
       or new.last_reopened_at is distinct from v_transition_event.created_at then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_REOPEN_PROJECTION_EVENT_MISMATCH';
    end if;

    return new;
  end if;

  raise exception using
    errcode = 'P0001',
    message = 'ZION_DIRECT_STAGE_TRANSITION_FORBIDDEN';
end;
$function$;

alter function public.enforce_commercial_opportunity_loss_stage_transition()
  owner to postgres;

revoke all on function public.enforce_commercial_opportunity_loss_stage_transition()
  from public, anon, authenticated, service_role;

create or replace function public.compute_commercial_opportunity_event_fingerprint_internal(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_lifecycle_cycle integer,
  p_event_type text,
  p_previous_stage text,
  p_new_stage text,
  p_actor_type text,
  p_actor_user_id uuid,
  p_reason_code text,
  p_reason_details text,
  p_source text,
  p_evidence_type text,
  p_evidence_message_id uuid,
  p_evidence_summary text
)
returns text
language sql
immutable
parallel safe
security invoker
set search_path = pg_catalog, pg_temp
as $function$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        (
          pg_catalog.jsonb_build_object(
            'organization_id', p_organization_id,
            'store_id', p_store_id,
            'commercial_opportunity_id', p_commercial_opportunity_id,
            'lifecycle_cycle', p_lifecycle_cycle,
            'event_type', p_event_type,
            'previous_stage', p_previous_stage,
            'new_stage', p_new_stage,
            'actor_type', p_actor_type,
            'actor_user_id', p_actor_user_id,
            'reason_code', p_reason_code,
            'reason_details', p_reason_details,
            'source', p_source,
            'evidence_type', p_evidence_type,
            'evidence_message_id', p_evidence_message_id,
            'evidence_summary', p_evidence_summary
          )
        )::text,
        'UTF8'::name
      ),
      'sha256'::text
    ),
    'hex'::text
  );
$function$;

alter function public.compute_commercial_opportunity_event_fingerprint_internal(
  uuid,
  uuid,
  uuid,
  integer,
  text,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  text
)
  owner to postgres;

revoke all on function public.compute_commercial_opportunity_event_fingerprint_internal(
  uuid,
  uuid,
  uuid,
  integer,
  text,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  text
)
  from public, anon, authenticated, service_role;

drop function public.mark_commercial_opportunity_lost_by_user(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  text
);

drop function public.mark_commercial_opportunity_lost_by_system(
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  text,
  text,
  text
);

drop function public.reopen_commercial_opportunity_by_user(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text
);

create or replace function public.mark_commercial_opportunity_lost_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_idempotency_key text,
  p_reason_code text,
  p_reason_details text default null,
  p_evidence_message_id uuid default null,
  p_evidence_summary text default null,
  p_source text default 'manual_user_loss'
)
returns table (
  commercial_opportunity_id uuid,
  stage text,
  lifecycle_cycle integer,
  current_loss_event_id uuid,
  lost_at timestamptz,
  lost_reason_code text,
  lost_reason_details text
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
  v_reason_code text;
  v_reason_details text := nullif(pg_catalog.btrim(coalesce(p_reason_details, '')), '');
  v_evidence_summary text := nullif(pg_catalog.btrim(coalesce(p_evidence_summary, '')), '');
  v_source text := nullif(pg_catalog.btrim(coalesce(p_source, '')), '');
  v_idempotency_key text := nullif(pg_catalog.btrim(coalesce(p_idempotency_key, '')), '');
  v_opportunity public.commercial_opportunities;
  v_loss_event public.commercial_opportunity_lifecycle_events;
  v_existing_event public.commercial_opportunity_lifecycle_events;
  v_existing_slot_event public.commercial_opportunity_lifecycle_events;
  v_event_key text;
  v_stored_event_key text;
  v_candidate_event_key text;
  v_constraint_name text;
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity loss by user is not authorized';
  end if;

  if p_request_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or v_idempotency_key is null
     or v_source is null then
    raise exception using
      errcode = '22023',
      message = 'commercial opportunity loss by user requires organization, store, opportunity, idempotency_key and source';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_request_organization_id
      and membership_row.user_id = v_user_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity loss by user is not authorized';
  end if;

  v_reason_code := public.normalize_commercial_opportunity_loss_reason_code(p_reason_code);

  if v_reason_code = 'other' and v_reason_details is null then
    raise exception using
      errcode = '22023',
      message = 'ZION_LOSS_OTHER_DETAILS_REQUIRED';
  end if;

  if v_reason_code = 'contact_opt_out' then
    raise exception using
      errcode = 'P0001',
      message = 'ZION_CONTACT_OPT_OUT_ATOMIC_BLOCK_REQUIRED';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'commercial opportunity not found';
  end if;

  if v_opportunity.organization_id is distinct from p_request_organization_id
     or v_opportunity.store_id is distinct from p_store_id then
    raise exception using
      errcode = '23514',
      message = 'commercial opportunity scope mismatch';
  end if;

  select lifecycle_event.*
  into v_existing_event
  from public.commercial_opportunity_lifecycle_events lifecycle_event
  where lifecycle_event.organization_id = v_opportunity.organization_id
    and lifecycle_event.store_id = v_opportunity.store_id
    and lifecycle_event.commercial_opportunity_id = v_opportunity.id
    and lifecycle_event.idempotency_key = v_idempotency_key
  limit 1;

  if found then
    if v_existing_event.event_type <> 'marked_lost' then
      raise exception using
        errcode = '23505',
        message = 'ZION_IDEMPOTENCY_KEY_REUSED';
    end if;

    v_stored_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
      v_existing_event.organization_id,
      v_existing_event.store_id,
      v_existing_event.commercial_opportunity_id,
      v_existing_event.lifecycle_cycle,
      v_existing_event.event_type,
      v_existing_event.previous_stage,
      v_existing_event.new_stage,
      v_existing_event.actor_type,
      v_existing_event.actor_user_id,
      v_existing_event.reason_code,
      v_existing_event.reason_details,
      v_existing_event.source,
      v_existing_event.evidence_type,
      v_existing_event.evidence_message_id,
      v_existing_event.evidence_summary
    );

    if v_existing_event.event_key is distinct from v_stored_event_key then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_STORED_EVENT_FINGERPRINT_MISMATCH';
    end if;

    v_candidate_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
      v_opportunity.organization_id,
      v_opportunity.store_id,
      v_opportunity.id,
      v_existing_event.lifecycle_cycle,
      'marked_lost',
      v_existing_event.previous_stage,
      'perdido',
      'human',
      v_user_id,
      v_reason_code,
      v_reason_details,
      v_source,
      case when p_evidence_message_id is null then null else 'message' end,
      p_evidence_message_id,
      v_evidence_summary
    );

    if v_candidate_event_key is distinct from v_existing_event.event_key then
      raise exception using
        errcode = '23505',
        message = 'ZION_IDEMPOTENCY_KEY_REUSED';
    end if;

    if v_existing_event.new_stage <> 'perdido' then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_STORED_EVENT_FINGERPRINT_MISMATCH';
    end if;

    return query
    select
      v_existing_event.commercial_opportunity_id,
      'perdido'::text,
      v_existing_event.lifecycle_cycle,
      v_existing_event.id,
      v_existing_event.created_at,
      v_existing_event.reason_code,
      v_existing_event.reason_details;
    return;
  end if;

  if v_opportunity.stage = 'perdido' then
    raise exception using
      errcode = '23514',
      message = 'ZION_OPPORTUNITY_ALREADY_LOST';
  end if;

  perform public.assert_commercial_opportunity_message_evidence(
    p_organization_id => v_opportunity.organization_id,
    p_store_id => v_opportunity.store_id,
    p_commercial_opportunity_id => v_opportunity.id,
    p_customer_id => v_opportunity.customer_id,
    p_evidence_message_id => p_evidence_message_id
  );

  v_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_opportunity.id,
    v_opportunity.lifecycle_cycle,
    'marked_lost',
    v_opportunity.stage,
    'perdido',
    'human',
    v_user_id,
    v_reason_code,
    v_reason_details,
    v_source,
    case when p_evidence_message_id is null then null else 'message' end,
    p_evidence_message_id,
    v_evidence_summary
  );

  begin
    insert into public.commercial_opportunity_lifecycle_events (
      organization_id,
      store_id,
      commercial_opportunity_id,
      customer_id,
      lifecycle_cycle,
      event_type,
      previous_stage,
      new_stage,
      reason_code,
      reason_details,
      evidence_type,
      evidence_message_id,
      evidence_summary,
      actor_type,
      actor_user_id,
      source,
      metadata,
      idempotency_key,
      event_key
    )
    values (
      v_opportunity.organization_id,
      v_opportunity.store_id,
      v_opportunity.id,
      v_opportunity.customer_id,
      v_opportunity.lifecycle_cycle,
      'marked_lost',
      v_opportunity.stage,
      'perdido',
      v_reason_code,
      v_reason_details,
      case when p_evidence_message_id is null then null else 'message' end,
      p_evidence_message_id,
      v_evidence_summary,
      'human',
      v_user_id,
      v_source,
      pg_catalog.jsonb_build_object(
        'request_organization_id', p_request_organization_id,
        'requested_store_id', p_store_id
      ),
      v_idempotency_key,
      v_event_key
    )
    returning *
    into v_loss_event;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;

      if v_constraint_name = 'commercial_opportunity_lifecycle_events_idempotency_uidx'
         or v_constraint_name = 'commercial_opportunity_lifecycle_events_operational_slot_uidx' then
        select lifecycle_event.*
        into v_existing_event
        from public.commercial_opportunity_lifecycle_events lifecycle_event
        where lifecycle_event.organization_id = v_opportunity.organization_id
          and lifecycle_event.store_id = v_opportunity.store_id
          and lifecycle_event.commercial_opportunity_id = v_opportunity.id
          and lifecycle_event.idempotency_key = v_idempotency_key
        limit 1;

        if found then
          if v_existing_event.event_type <> 'marked_lost' then
            raise exception using
              errcode = '23505',
              message = 'ZION_IDEMPOTENCY_KEY_REUSED';
          end if;

          v_stored_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
            v_existing_event.organization_id,
            v_existing_event.store_id,
            v_existing_event.commercial_opportunity_id,
            v_existing_event.lifecycle_cycle,
            v_existing_event.event_type,
            v_existing_event.previous_stage,
            v_existing_event.new_stage,
            v_existing_event.actor_type,
            v_existing_event.actor_user_id,
            v_existing_event.reason_code,
            v_existing_event.reason_details,
            v_existing_event.source,
            v_existing_event.evidence_type,
            v_existing_event.evidence_message_id,
            v_existing_event.evidence_summary
          );

          if v_existing_event.event_key is distinct from v_stored_event_key then
            raise exception using
              errcode = 'P0001',
              message = 'ZION_STORED_EVENT_FINGERPRINT_MISMATCH';
          end if;

          v_candidate_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
            v_opportunity.organization_id,
            v_opportunity.store_id,
            v_opportunity.id,
            v_existing_event.lifecycle_cycle,
            'marked_lost',
            v_existing_event.previous_stage,
            'perdido',
            'human',
            v_user_id,
            v_reason_code,
            v_reason_details,
            v_source,
            case when p_evidence_message_id is null then null else 'message' end,
            p_evidence_message_id,
            v_evidence_summary
          );

          if v_candidate_event_key is distinct from v_existing_event.event_key then
            raise exception using
              errcode = '23505',
              message = 'ZION_IDEMPOTENCY_KEY_REUSED';
          end if;

          return query
          select
            v_existing_event.commercial_opportunity_id,
            'perdido'::text,
            v_existing_event.lifecycle_cycle,
            v_existing_event.id,
            v_existing_event.created_at,
            v_existing_event.reason_code,
            v_existing_event.reason_details;
          return;
        end if;

        if v_constraint_name = 'commercial_opportunity_lifecycle_events_operational_slot_uidx' then
          select lifecycle_event.*
          into v_existing_slot_event
          from public.commercial_opportunity_lifecycle_events lifecycle_event
          where lifecycle_event.organization_id = v_opportunity.organization_id
            and lifecycle_event.store_id = v_opportunity.store_id
            and lifecycle_event.commercial_opportunity_id = v_opportunity.id
            and lifecycle_event.lifecycle_cycle = v_opportunity.lifecycle_cycle
            and lifecycle_event.event_type = 'marked_lost'
          limit 1;

          if found then
            raise exception using
              errcode = '23505',
              message = 'ZION_OPERATIONAL_SLOT_ALREADY_CONSUMED';
          end if;
        end if;
      end if;

      raise;
  end;

  update public.commercial_opportunities opportunity_row
  set
    stage = 'perdido',
    lost_at = v_loss_event.created_at,
    lost_reason_code = v_loss_event.reason_code,
    lost_reason_details = v_loss_event.reason_details,
    current_loss_event_id = v_loss_event.id
  where opportunity_row.id = v_opportunity.id;

  return query
  select
    opportunity_row.id,
    opportunity_row.stage,
    opportunity_row.lifecycle_cycle,
    opportunity_row.current_loss_event_id,
    opportunity_row.lost_at,
    opportunity_row.lost_reason_code,
    opportunity_row.lost_reason_details
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = v_opportunity.id;
end;
$function$;

alter function public.mark_commercial_opportunity_lost_by_user(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text
)
  owner to postgres;

create or replace function public.mark_commercial_opportunity_lost_by_system(
  p_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_idempotency_key text,
  p_reason_code text,
  p_evidence_message_id uuid,
  p_evidence_summary text,
  p_actor_type text,
  p_source text
)
returns table (
  commercial_opportunity_id uuid,
  stage text,
  lifecycle_cycle integer,
  current_loss_event_id uuid,
  lost_at timestamptz,
  lost_reason_code text
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
  v_reason_code text;
  v_actor_type text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_actor_type, '')));
  v_evidence_summary text := nullif(pg_catalog.btrim(coalesce(p_evidence_summary, '')), '');
  v_source text := nullif(pg_catalog.btrim(coalesce(p_source, '')), '');
  v_idempotency_key text := nullif(pg_catalog.btrim(coalesce(p_idempotency_key, '')), '');
  v_opportunity public.commercial_opportunities;
  v_loss_event public.commercial_opportunity_lifecycle_events;
  v_existing_event public.commercial_opportunity_lifecycle_events;
  v_existing_slot_event public.commercial_opportunity_lifecycle_events;
  v_event_key text;
  v_stored_event_key text;
  v_candidate_event_key text;
  v_constraint_name text;
begin
  if (v_request_role is distinct from 'service_role')
     and session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity loss by system is not authorized';
  end if;

  if p_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or p_evidence_message_id is null
     or v_evidence_summary is null
     or v_source is null
     or v_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'commercial opportunity loss by system requires scope, evidence, idempotency_key and source';
  end if;

  if v_actor_type not in ('ai', 'system') then
    raise exception using
      errcode = '22023',
      message = 'ZION_SYSTEM_LOSS_ACTOR_INVALID';
  end if;

  v_reason_code := public.normalize_commercial_opportunity_loss_reason_code(p_reason_code);

  if v_reason_code not in (
       'explicit_refusal',
       'bought_from_competitor',
       'confirmed_out_of_service_area'
     ) then
    raise exception using
      errcode = '22023',
      message = 'ZION_SYSTEM_LOSS_REASON_FORBIDDEN';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'commercial opportunity not found';
  end if;

  if v_opportunity.organization_id is distinct from p_organization_id
     or v_opportunity.store_id is distinct from p_store_id then
    raise exception using
      errcode = '23514',
      message = 'commercial opportunity scope mismatch';
  end if;

  select lifecycle_event.*
  into v_existing_event
  from public.commercial_opportunity_lifecycle_events lifecycle_event
  where lifecycle_event.organization_id = v_opportunity.organization_id
    and lifecycle_event.store_id = v_opportunity.store_id
    and lifecycle_event.commercial_opportunity_id = v_opportunity.id
    and lifecycle_event.idempotency_key = v_idempotency_key
  limit 1;

  if found then
    if v_existing_event.event_type <> 'marked_lost' then
      raise exception using
        errcode = '23505',
        message = 'ZION_IDEMPOTENCY_KEY_REUSED';
    end if;

    v_stored_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
      v_existing_event.organization_id,
      v_existing_event.store_id,
      v_existing_event.commercial_opportunity_id,
      v_existing_event.lifecycle_cycle,
      v_existing_event.event_type,
      v_existing_event.previous_stage,
      v_existing_event.new_stage,
      v_existing_event.actor_type,
      v_existing_event.actor_user_id,
      v_existing_event.reason_code,
      v_existing_event.reason_details,
      v_existing_event.source,
      v_existing_event.evidence_type,
      v_existing_event.evidence_message_id,
      v_existing_event.evidence_summary
    );

    if v_existing_event.event_key is distinct from v_stored_event_key then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_STORED_EVENT_FINGERPRINT_MISMATCH';
    end if;

    v_candidate_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
      v_opportunity.organization_id,
      v_opportunity.store_id,
      v_opportunity.id,
      v_existing_event.lifecycle_cycle,
      'marked_lost',
      v_existing_event.previous_stage,
      'perdido',
      v_actor_type,
      null,
      v_reason_code,
      null,
      v_source,
      'message',
      p_evidence_message_id,
      v_evidence_summary
    );

    if v_candidate_event_key is distinct from v_existing_event.event_key then
      raise exception using
        errcode = '23505',
        message = 'ZION_IDEMPOTENCY_KEY_REUSED';
    end if;

    return query
    select
      v_existing_event.commercial_opportunity_id,
      'perdido'::text,
      v_existing_event.lifecycle_cycle,
      v_existing_event.id,
      v_existing_event.created_at,
      v_existing_event.reason_code;
    return;
  end if;

  if v_opportunity.stage = 'perdido' then
    raise exception using
      errcode = '23514',
      message = 'ZION_OPPORTUNITY_ALREADY_LOST';
  end if;

  perform public.assert_commercial_opportunity_message_evidence(
    p_organization_id => v_opportunity.organization_id,
    p_store_id => v_opportunity.store_id,
    p_commercial_opportunity_id => v_opportunity.id,
    p_customer_id => v_opportunity.customer_id,
    p_evidence_message_id => p_evidence_message_id
  );

  v_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_opportunity.id,
    v_opportunity.lifecycle_cycle,
    'marked_lost',
    v_opportunity.stage,
    'perdido',
    v_actor_type,
    null,
    v_reason_code,
    null,
    v_source,
    'message',
    p_evidence_message_id,
    v_evidence_summary
  );

  begin
    insert into public.commercial_opportunity_lifecycle_events (
      organization_id,
      store_id,
      commercial_opportunity_id,
      customer_id,
      lifecycle_cycle,
      event_type,
      previous_stage,
      new_stage,
      reason_code,
      reason_details,
      evidence_type,
      evidence_message_id,
      evidence_summary,
      actor_type,
      actor_user_id,
      source,
      metadata,
      idempotency_key,
      event_key
    )
    values (
      v_opportunity.organization_id,
      v_opportunity.store_id,
      v_opportunity.id,
      v_opportunity.customer_id,
      v_opportunity.lifecycle_cycle,
      'marked_lost',
      v_opportunity.stage,
      'perdido',
      v_reason_code,
      null,
      'message',
      p_evidence_message_id,
      v_evidence_summary,
      v_actor_type,
      null,
      v_source,
      pg_catalog.jsonb_build_object(
        'internal_operation', true
      ),
      v_idempotency_key,
      v_event_key
    )
    returning *
    into v_loss_event;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;

      if v_constraint_name = 'commercial_opportunity_lifecycle_events_idempotency_uidx'
         or v_constraint_name = 'commercial_opportunity_lifecycle_events_operational_slot_uidx' then
        select lifecycle_event.*
        into v_existing_event
        from public.commercial_opportunity_lifecycle_events lifecycle_event
        where lifecycle_event.organization_id = v_opportunity.organization_id
          and lifecycle_event.store_id = v_opportunity.store_id
          and lifecycle_event.commercial_opportunity_id = v_opportunity.id
          and lifecycle_event.idempotency_key = v_idempotency_key
        limit 1;

        if found then
          if v_existing_event.event_type <> 'marked_lost' then
            raise exception using
              errcode = '23505',
              message = 'ZION_IDEMPOTENCY_KEY_REUSED';
          end if;

          v_stored_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
            v_existing_event.organization_id,
            v_existing_event.store_id,
            v_existing_event.commercial_opportunity_id,
            v_existing_event.lifecycle_cycle,
            v_existing_event.event_type,
            v_existing_event.previous_stage,
            v_existing_event.new_stage,
            v_existing_event.actor_type,
            v_existing_event.actor_user_id,
            v_existing_event.reason_code,
            v_existing_event.reason_details,
            v_existing_event.source,
            v_existing_event.evidence_type,
            v_existing_event.evidence_message_id,
            v_existing_event.evidence_summary
          );

          if v_existing_event.event_key is distinct from v_stored_event_key then
            raise exception using
              errcode = 'P0001',
              message = 'ZION_STORED_EVENT_FINGERPRINT_MISMATCH';
          end if;

          v_candidate_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
            v_opportunity.organization_id,
            v_opportunity.store_id,
            v_opportunity.id,
            v_existing_event.lifecycle_cycle,
            'marked_lost',
            v_existing_event.previous_stage,
            'perdido',
            v_actor_type,
            null,
            v_reason_code,
            null,
            v_source,
            'message',
            p_evidence_message_id,
            v_evidence_summary
          );

          if v_candidate_event_key is distinct from v_existing_event.event_key then
            raise exception using
              errcode = '23505',
              message = 'ZION_IDEMPOTENCY_KEY_REUSED';
          end if;

          return query
          select
            v_existing_event.commercial_opportunity_id,
            'perdido'::text,
            v_existing_event.lifecycle_cycle,
            v_existing_event.id,
            v_existing_event.created_at,
            v_existing_event.reason_code;
          return;
        end if;

        if v_constraint_name = 'commercial_opportunity_lifecycle_events_operational_slot_uidx' then
          select lifecycle_event.*
          into v_existing_slot_event
          from public.commercial_opportunity_lifecycle_events lifecycle_event
          where lifecycle_event.organization_id = v_opportunity.organization_id
            and lifecycle_event.store_id = v_opportunity.store_id
            and lifecycle_event.commercial_opportunity_id = v_opportunity.id
            and lifecycle_event.lifecycle_cycle = v_opportunity.lifecycle_cycle
            and lifecycle_event.event_type = 'marked_lost'
          limit 1;

          if found then
            raise exception using
              errcode = '23505',
              message = 'ZION_OPERATIONAL_SLOT_ALREADY_CONSUMED';
          end if;
        end if;
      end if;

      raise;
  end;

  update public.commercial_opportunities opportunity_row
  set
    stage = 'perdido',
    lost_at = v_loss_event.created_at,
    lost_reason_code = v_loss_event.reason_code,
    lost_reason_details = null,
    current_loss_event_id = v_loss_event.id
  where opportunity_row.id = v_opportunity.id;

  return query
  select
    opportunity_row.id,
    opportunity_row.stage,
    opportunity_row.lifecycle_cycle,
    opportunity_row.current_loss_event_id,
    opportunity_row.lost_at,
    opportunity_row.lost_reason_code
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = v_opportunity.id;
end;
$function$;

alter function public.mark_commercial_opportunity_lost_by_system(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  text
)
  owner to postgres;

create or replace function public.reopen_commercial_opportunity_by_user(
  p_request_organization_id uuid,
  p_store_id uuid,
  p_commercial_opportunity_id uuid,
  p_idempotency_key text,
  p_target_stage text,
  p_reason_details text,
  p_source text
)
returns table (
  commercial_opportunity_id uuid,
  stage text,
  lifecycle_cycle integer,
  current_loss_event_id uuid,
  last_reopened_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_role text := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
  v_target_stage text;
  v_reason_details text := nullif(pg_catalog.btrim(coalesce(p_reason_details, '')), '');
  v_source text := nullif(pg_catalog.btrim(coalesce(p_source, '')), '');
  v_idempotency_key text := nullif(pg_catalog.btrim(coalesce(p_idempotency_key, '')), '');
  v_opportunity public.commercial_opportunities;
  v_reopen_event public.commercial_opportunity_lifecycle_events;
  v_existing_event public.commercial_opportunity_lifecycle_events;
  v_existing_slot_event public.commercial_opportunity_lifecycle_events;
  v_event_key text;
  v_stored_event_key text;
  v_candidate_event_key text;
  v_constraint_name text;
begin
  if v_user_id is null or v_request_role <> 'authenticated' then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity reopen by user is not authorized';
  end if;

  if p_request_organization_id is null
     or p_store_id is null
     or p_commercial_opportunity_id is null
     or v_source is null
     or v_reason_details is null
     or v_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'commercial opportunity reopen by user requires scope, reason_details, idempotency_key and source';
  end if;

  if not exists (
    select 1
    from public.memberships membership_row
    where membership_row.organization_id = p_request_organization_id
      and membership_row.user_id = v_user_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'commercial opportunity reopen by user is not authorized';
  end if;

  v_target_stage := public.normalize_commercial_opportunity_stage(p_target_stage);

  if v_target_stage not in (
       'novo_lead',
       'qualificacao',
       'orcamento',
       'visita_tecnica',
       'negociacao',
       'fechamento_pagamento',
       'instalacao_entrega',
       'pos_venda'
     ) then
    raise exception using
      errcode = '22023',
      message = 'ZION_REOPEN_TARGET_STAGE_INVALID';
  end if;

  select opportunity_row.*
  into v_opportunity
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = p_commercial_opportunity_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'commercial opportunity not found';
  end if;

  if v_opportunity.organization_id is distinct from p_request_organization_id
     or v_opportunity.store_id is distinct from p_store_id then
    raise exception using
      errcode = '23514',
      message = 'commercial opportunity scope mismatch';
  end if;

  select lifecycle_event.*
  into v_existing_event
  from public.commercial_opportunity_lifecycle_events lifecycle_event
  where lifecycle_event.organization_id = v_opportunity.organization_id
    and lifecycle_event.store_id = v_opportunity.store_id
    and lifecycle_event.commercial_opportunity_id = v_opportunity.id
    and lifecycle_event.idempotency_key = v_idempotency_key
  limit 1;

  if found then
    if v_existing_event.event_type <> 'reopened' then
      raise exception using
        errcode = '23505',
        message = 'ZION_IDEMPOTENCY_KEY_REUSED';
    end if;

    v_stored_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
      v_existing_event.organization_id,
      v_existing_event.store_id,
      v_existing_event.commercial_opportunity_id,
      v_existing_event.lifecycle_cycle,
      v_existing_event.event_type,
      v_existing_event.previous_stage,
      v_existing_event.new_stage,
      v_existing_event.actor_type,
      v_existing_event.actor_user_id,
      v_existing_event.reason_code,
      v_existing_event.reason_details,
      v_existing_event.source,
      v_existing_event.evidence_type,
      v_existing_event.evidence_message_id,
      v_existing_event.evidence_summary
    );

    if v_existing_event.event_key is distinct from v_stored_event_key then
      raise exception using
        errcode = 'P0001',
        message = 'ZION_STORED_EVENT_FINGERPRINT_MISMATCH';
    end if;

    v_candidate_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
      v_opportunity.organization_id,
      v_opportunity.store_id,
      v_opportunity.id,
      v_existing_event.lifecycle_cycle,
      'reopened',
      'perdido',
      v_target_stage,
      'human',
      v_user_id,
      null,
      v_reason_details,
      v_source,
      null,
      null,
      null
    );

    if v_candidate_event_key is distinct from v_existing_event.event_key then
      raise exception using
        errcode = '23505',
        message = 'ZION_IDEMPOTENCY_KEY_REUSED';
    end if;

    return query
    select
      v_existing_event.commercial_opportunity_id,
      v_existing_event.new_stage,
      v_existing_event.lifecycle_cycle + 1,
      null::uuid,
      v_existing_event.created_at;
    return;
  end if;

  if v_opportunity.stage <> 'perdido' then
    raise exception using
      errcode = '23514',
      message = 'ZION_REOPEN_REQUIRES_LOST_STAGE';
  end if;

  v_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
    v_opportunity.organization_id,
    v_opportunity.store_id,
    v_opportunity.id,
    v_opportunity.lifecycle_cycle,
    'reopened',
    'perdido',
    v_target_stage,
    'human',
    v_user_id,
    null,
    v_reason_details,
    v_source,
    null,
    null,
    null
  );

  begin
    insert into public.commercial_opportunity_lifecycle_events (
      organization_id,
      store_id,
      commercial_opportunity_id,
      customer_id,
      lifecycle_cycle,
      event_type,
      previous_stage,
      new_stage,
      reason_code,
      reason_details,
      evidence_type,
      evidence_message_id,
      evidence_summary,
      actor_type,
      actor_user_id,
      source,
      metadata,
      idempotency_key,
      event_key
    )
    values (
      v_opportunity.organization_id,
      v_opportunity.store_id,
      v_opportunity.id,
      v_opportunity.customer_id,
      v_opportunity.lifecycle_cycle,
      'reopened',
      'perdido',
      v_target_stage,
      null,
      v_reason_details,
      null,
      null,
      null,
      'human',
      v_user_id,
      v_source,
      pg_catalog.jsonb_build_object(
        'request_organization_id', p_request_organization_id,
        'requested_store_id', p_store_id
      ),
      v_idempotency_key,
      v_event_key
    )
    returning *
    into v_reopen_event;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;

      if v_constraint_name = 'commercial_opportunity_lifecycle_events_idempotency_uidx'
         or v_constraint_name = 'commercial_opportunity_lifecycle_events_operational_slot_uidx' then
        select lifecycle_event.*
        into v_existing_event
        from public.commercial_opportunity_lifecycle_events lifecycle_event
        where lifecycle_event.organization_id = v_opportunity.organization_id
          and lifecycle_event.store_id = v_opportunity.store_id
          and lifecycle_event.commercial_opportunity_id = v_opportunity.id
          and lifecycle_event.idempotency_key = v_idempotency_key
        limit 1;

        if found then
          if v_existing_event.event_type <> 'reopened' then
            raise exception using
              errcode = '23505',
              message = 'ZION_IDEMPOTENCY_KEY_REUSED';
          end if;

          v_stored_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
            v_existing_event.organization_id,
            v_existing_event.store_id,
            v_existing_event.commercial_opportunity_id,
            v_existing_event.lifecycle_cycle,
            v_existing_event.event_type,
            v_existing_event.previous_stage,
            v_existing_event.new_stage,
            v_existing_event.actor_type,
            v_existing_event.actor_user_id,
            v_existing_event.reason_code,
            v_existing_event.reason_details,
            v_existing_event.source,
            v_existing_event.evidence_type,
            v_existing_event.evidence_message_id,
            v_existing_event.evidence_summary
          );

          if v_existing_event.event_key is distinct from v_stored_event_key then
            raise exception using
              errcode = 'P0001',
              message = 'ZION_STORED_EVENT_FINGERPRINT_MISMATCH';
          end if;

          v_candidate_event_key := public.compute_commercial_opportunity_event_fingerprint_internal(
            v_opportunity.organization_id,
            v_opportunity.store_id,
            v_opportunity.id,
            v_existing_event.lifecycle_cycle,
            'reopened',
            'perdido',
            v_target_stage,
            'human',
            v_user_id,
            null,
            v_reason_details,
            v_source,
            null,
            null,
            null
          );

          if v_candidate_event_key is distinct from v_existing_event.event_key then
            raise exception using
              errcode = '23505',
              message = 'ZION_IDEMPOTENCY_KEY_REUSED';
          end if;

          return query
          select
            v_existing_event.commercial_opportunity_id,
            v_existing_event.new_stage,
            v_existing_event.lifecycle_cycle + 1,
            null::uuid,
            v_existing_event.created_at;
          return;
        end if;

        if v_constraint_name = 'commercial_opportunity_lifecycle_events_operational_slot_uidx' then
          select lifecycle_event.*
          into v_existing_slot_event
          from public.commercial_opportunity_lifecycle_events lifecycle_event
          where lifecycle_event.organization_id = v_opportunity.organization_id
            and lifecycle_event.store_id = v_opportunity.store_id
            and lifecycle_event.commercial_opportunity_id = v_opportunity.id
            and lifecycle_event.lifecycle_cycle = v_opportunity.lifecycle_cycle
            and lifecycle_event.event_type = 'reopened'
          limit 1;

          if found then
            raise exception using
              errcode = '23505',
              message = 'ZION_OPERATIONAL_SLOT_ALREADY_CONSUMED';
          end if;
        end if;
      end if;

      raise;
  end;

  update public.commercial_opportunities opportunity_row
  set
    lifecycle_cycle = opportunity_row.lifecycle_cycle + 1,
    stage = v_target_stage,
    lost_at = null,
    lost_reason_code = null,
    lost_reason_details = null,
    current_loss_event_id = null,
    last_reopened_at = v_reopen_event.created_at
  where opportunity_row.id = v_opportunity.id;

  return query
  select
    opportunity_row.id,
    opportunity_row.stage,
    opportunity_row.lifecycle_cycle,
    opportunity_row.current_loss_event_id,
    opportunity_row.last_reopened_at
  from public.commercial_opportunities opportunity_row
  where opportunity_row.id = v_opportunity.id;
end;
$function$;

alter function public.reopen_commercial_opportunity_by_user(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text
)
  owner to postgres;

revoke all on function public.mark_commercial_opportunity_lost_by_user(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text
)
  from public, anon, authenticated, service_role;

grant execute on function public.mark_commercial_opportunity_lost_by_user(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text
)
  to authenticated;

revoke all on function public.mark_commercial_opportunity_lost_by_system(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  text
)
  from public, anon, authenticated, service_role;

grant execute on function public.mark_commercial_opportunity_lost_by_system(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  text
)
  to service_role;

revoke all on function public.reopen_commercial_opportunity_by_user(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text
)
  from public, anon, authenticated, service_role;

grant execute on function public.reopen_commercial_opportunity_by_user(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text
)
  to authenticated;

do $postconditions$
declare
  v_user_oid oid;
  v_system_oid oid;
  v_reopen_oid oid;
  v_helper_oid oid;
  v_log_oid oid;
  v_stage_trigger_oid oid;
  v_core_trigger_oid oid;
  v_definition text;
begin
  if pg_catalog.to_regprocedure(
    'public.mark_commercial_opportunity_lost_by_user(uuid,uuid,uuid,text,text,uuid,text,text)'
  ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: old user loss signature still exists';
  end if;

  if pg_catalog.to_regprocedure(
    'public.mark_commercial_opportunity_lost_by_system(uuid,uuid,uuid,text,uuid,text,text,text)'
  ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: old system loss signature still exists';
  end if;

  if pg_catalog.to_regprocedure(
    'public.reopen_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text)'
  ) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: old reopen signature still exists';
  end if;

  v_user_oid := pg_catalog.to_regprocedure(
    'public.mark_commercial_opportunity_lost_by_user(uuid,uuid,uuid,text,text,text,uuid,text,text)'
  );
  v_system_oid := pg_catalog.to_regprocedure(
    'public.mark_commercial_opportunity_lost_by_system(uuid,uuid,uuid,text,text,uuid,text,text,text)'
  );
  v_reopen_oid := pg_catalog.to_regprocedure(
    'public.reopen_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text,text)'
  );
  v_helper_oid := pg_catalog.to_regprocedure(
    'public.compute_commercial_opportunity_event_fingerprint_internal(uuid,uuid,uuid,integer,text,text,text,text,uuid,text,text,text,text,uuid,text)'
  );
  v_log_oid := pg_catalog.to_regprocedure(
    'public.log_state_transition(uuid,uuid,uuid,text,text,text,uuid,text,jsonb)'
  );

  if v_user_oid is null
     or v_system_oid is null
     or v_reopen_oid is null
     or v_helper_oid is null
     or v_log_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: required hardened functions are missing';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'mark_commercial_opportunity_lost_by_user'
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: unexpected overloads remain for user loss rpc';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'mark_commercial_opportunity_lost_by_system'
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: unexpected overloads remain for system loss rpc';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname = 'reopen_commercial_opportunity_by_user'
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: unexpected overloads remain for reopen rpc';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_roles role_row
      on role_row.oid = proc_row.proowner
    where proc_row.oid = v_helper_oid
      and proc_row.proargnames = array[
        'p_organization_id',
        'p_store_id',
        'p_commercial_opportunity_id',
        'p_lifecycle_cycle',
        'p_event_type',
        'p_previous_stage',
        'p_new_stage',
        'p_actor_type',
        'p_actor_user_id',
        'p_reason_code',
        'p_reason_details',
        'p_source',
        'p_evidence_type',
        'p_evidence_message_id',
        'p_evidence_summary'
      ]
      and role_row.rolname = 'postgres'
      and proc_row.provolatile = 'i'
      and proc_row.proparallel = 's'
      and not proc_row.prosecdef
      and proc_row.pronargdefaults = 0
      and exists (
        select 1
        from pg_catalog.unnest(proc_row.proconfig) config_row
        where config_row = 'search_path=pg_catalog, pg_temp'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: fingerprint helper contract mismatch';
  end if;

  if has_function_privilege(
    'anon',
    'public.compute_commercial_opportunity_event_fingerprint_internal(uuid,uuid,uuid,integer,text,text,text,text,uuid,text,text,text,text,uuid,text)',
    'EXECUTE'
  )
     or has_function_privilege(
       'authenticated',
       'public.compute_commercial_opportunity_event_fingerprint_internal(uuid,uuid,uuid,integer,text,text,text,text,uuid,text,text,text,text,uuid,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.compute_commercial_opportunity_event_fingerprint_internal(uuid,uuid,uuid,integer,text,text,text,text,uuid,text,text,text,text,uuid,text)',
       'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: fingerprint helper execute grants are too broad';
  end if;

  if not has_function_privilege(
    'postgres',
    'public.compute_commercial_opportunity_event_fingerprint_internal(uuid,uuid,uuid,integer,text,text,text,text,uuid,text,text,text,text,uuid,text)',
    'EXECUTE'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: fingerprint helper must remain executable by postgres';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_user_oid
      and proc_row.pronargs = 9
      and proc_row.proargnames[1:proc_row.pronargs] = array[
        'p_request_organization_id',
        'p_store_id',
        'p_commercial_opportunity_id',
        'p_idempotency_key',
        'p_reason_code',
        'p_reason_details',
        'p_evidence_message_id',
        'p_evidence_summary',
        'p_source'
      ]
      and proc_row.proargmodes = array[
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char"
      ]
      and proc_row.proargnames[proc_row.pronargs + 1:pg_catalog.array_length(proc_row.proargnames, 1)] = array[
        'commercial_opportunity_id',
        'stage',
        'lifecycle_cycle',
        'current_loss_event_id',
        'lost_at',
        'lost_reason_code',
        'lost_reason_details'
      ]
      and proc_row.proallargtypes = array[
        'uuid'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'integer'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'timestamp with time zone'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'text'::pg_catalog.regtype
      ]::oid[]
      and pg_catalog.pg_get_function_result(proc_row.oid) = 'TABLE(commercial_opportunity_id uuid, stage text, lifecycle_cycle integer, current_loss_event_id uuid, lost_at timestamp with time zone, lost_reason_code text, lost_reason_details text)'
      and pg_catalog.pg_get_expr(proc_row.proargdefaults, 0) = 'NULL::text, NULL::uuid, NULL::text, ''manual_user_loss''::text'
      and proc_row.pronargdefaults = 4
      and proc_row.prosecdef
      and proc_row.provolatile = 'v'
      and proc_row.proparallel = 'u'
      and pg_catalog.obj_description(proc_row.oid, 'pg_proc') is null
      and exists (
        select 1
        from pg_catalog.unnest(proc_row.proconfig) config_row
        where config_row = 'search_path=pg_catalog, pg_temp, public'
      )
      and exists (
        select 1
        from pg_catalog.unnest(proc_row.proconfig) config_row
        where config_row = 'row_security=off'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: user loss rpc signature or config mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_system_oid
      and proc_row.pronargs = 9
      and proc_row.proargnames[1:proc_row.pronargs] = array[
        'p_organization_id',
        'p_store_id',
        'p_commercial_opportunity_id',
        'p_idempotency_key',
        'p_reason_code',
        'p_evidence_message_id',
        'p_evidence_summary',
        'p_actor_type',
        'p_source'
      ]
      and proc_row.proargmodes = array[
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char"
      ]
      and proc_row.proargnames[proc_row.pronargs + 1:pg_catalog.array_length(proc_row.proargnames, 1)] = array[
        'commercial_opportunity_id',
        'stage',
        'lifecycle_cycle',
        'current_loss_event_id',
        'lost_at',
        'lost_reason_code'
      ]
      and proc_row.proallargtypes = array[
        'uuid'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'integer'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'timestamp with time zone'::pg_catalog.regtype,
        'text'::pg_catalog.regtype
      ]::oid[]
      and pg_catalog.pg_get_function_result(proc_row.oid) = 'TABLE(commercial_opportunity_id uuid, stage text, lifecycle_cycle integer, current_loss_event_id uuid, lost_at timestamp with time zone, lost_reason_code text)'
      and proc_row.proargdefaults is null
      and proc_row.pronargdefaults = 0
      and proc_row.prosecdef
      and proc_row.provolatile = 'v'
      and proc_row.proparallel = 'u'
      and pg_catalog.obj_description(proc_row.oid, 'pg_proc') is null
      and exists (
        select 1
        from pg_catalog.unnest(proc_row.proconfig) config_row
        where config_row = 'search_path=pg_catalog, pg_temp, public'
      )
      and exists (
        select 1
        from pg_catalog.unnest(proc_row.proconfig) config_row
        where config_row = 'row_security=off'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: system loss rpc signature or config mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc_row
    where proc_row.oid = v_reopen_oid
      and proc_row.pronargs = 7
      and proc_row.proargnames[1:proc_row.pronargs] = array[
        'p_request_organization_id',
        'p_store_id',
        'p_commercial_opportunity_id',
        'p_idempotency_key',
        'p_target_stage',
        'p_reason_details',
        'p_source'
      ]
      and proc_row.proargmodes = array[
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        'i'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char",
        't'::"char"
      ]
      and proc_row.proargnames[proc_row.pronargs + 1:pg_catalog.array_length(proc_row.proargnames, 1)] = array[
        'commercial_opportunity_id',
        'stage',
        'lifecycle_cycle',
        'current_loss_event_id',
        'last_reopened_at'
      ]
      and proc_row.proallargtypes = array[
        'uuid'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'text'::pg_catalog.regtype,
        'integer'::pg_catalog.regtype,
        'uuid'::pg_catalog.regtype,
        'timestamp with time zone'::pg_catalog.regtype
      ]::oid[]
      and pg_catalog.pg_get_function_result(proc_row.oid) = 'TABLE(commercial_opportunity_id uuid, stage text, lifecycle_cycle integer, current_loss_event_id uuid, last_reopened_at timestamp with time zone)'
      and proc_row.proargdefaults is null
      and proc_row.pronargdefaults = 0
      and proc_row.prosecdef
      and proc_row.provolatile = 'v'
      and proc_row.proparallel = 'u'
      and pg_catalog.obj_description(proc_row.oid, 'pg_proc') is null
      and exists (
        select 1
        from pg_catalog.unnest(proc_row.proconfig) config_row
        where config_row = 'search_path=pg_catalog, pg_temp, public'
      )
      and exists (
        select 1
        from pg_catalog.unnest(proc_row.proconfig) config_row
        where config_row = 'row_security=off'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: reopen rpc signature or config mismatch';
  end if;

  if not has_function_privilege(
    'postgres',
    'public.mark_commercial_opportunity_lost_by_user(uuid,uuid,uuid,text,text,text,uuid,text,text)',
    'EXECUTE'
  )
     or not has_function_privilege(
    'authenticated',
    'public.mark_commercial_opportunity_lost_by_user(uuid,uuid,uuid,text,text,text,uuid,text,text)',
    'EXECUTE'
  )
     or has_function_privilege(
       'anon',
       'public.mark_commercial_opportunity_lost_by_user(uuid,uuid,uuid,text,text,text,uuid,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.mark_commercial_opportunity_lost_by_user(uuid,uuid,uuid,text,text,text,uuid,text,text)',
       'EXECUTE'
     )
     or exists (
       select 1
       from pg_catalog.aclexplode(coalesce((select proc_row.proacl from pg_catalog.pg_proc proc_row where proc_row.oid = v_user_oid), pg_catalog.acldefault('f', (select proc_row.proowner from pg_catalog.pg_proc proc_row where proc_row.oid = v_user_oid)))) acl_row
       where acl_row.grantee = 0
         and acl_row.privilege_type = 'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: user loss rpc grants mismatch';
  end if;

  if not has_function_privilege(
    'postgres',
    'public.mark_commercial_opportunity_lost_by_system(uuid,uuid,uuid,text,text,uuid,text,text,text)',
    'EXECUTE'
  )
     or not has_function_privilege(
    'service_role',
    'public.mark_commercial_opportunity_lost_by_system(uuid,uuid,uuid,text,text,uuid,text,text,text)',
    'EXECUTE'
  )
     or has_function_privilege(
       'anon',
       'public.mark_commercial_opportunity_lost_by_system(uuid,uuid,uuid,text,text,uuid,text,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.mark_commercial_opportunity_lost_by_system(uuid,uuid,uuid,text,text,uuid,text,text,text)',
       'EXECUTE'
     )
     or exists (
       select 1
       from pg_catalog.aclexplode(coalesce((select proc_row.proacl from pg_catalog.pg_proc proc_row where proc_row.oid = v_system_oid), pg_catalog.acldefault('f', (select proc_row.proowner from pg_catalog.pg_proc proc_row where proc_row.oid = v_system_oid)))) acl_row
       where acl_row.grantee = 0
         and acl_row.privilege_type = 'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: system loss rpc grants mismatch';
  end if;

  if not has_function_privilege(
    'postgres',
    'public.reopen_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text,text)',
    'EXECUTE'
  )
     or not has_function_privilege(
    'authenticated',
    'public.reopen_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text,text)',
    'EXECUTE'
  )
     or has_function_privilege(
       'anon',
       'public.reopen_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.reopen_commercial_opportunity_by_user(uuid,uuid,uuid,text,text,text,text)',
       'EXECUTE'
     )
     or exists (
       select 1
       from pg_catalog.aclexplode(coalesce((select proc_row.proacl from pg_catalog.pg_proc proc_row where proc_row.oid = v_reopen_oid), pg_catalog.acldefault('f', (select proc_row.proowner from pg_catalog.pg_proc proc_row where proc_row.oid = v_reopen_oid)))) acl_row
       where acl_row.grantee = 0
         and acl_row.privilege_type = 'EXECUTE'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: reopen rpc grants mismatch';
  end if;

  if has_table_privilege('authenticated', 'public.commercial_opportunities', 'INSERT')
     or has_table_privilege('authenticated', 'public.commercial_opportunities', 'UPDATE')
     or has_table_privilege('authenticated', 'public.commercial_opportunities', 'DELETE')
     or has_table_privilege('authenticated', 'public.commercial_opportunities', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.commercial_opportunities', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.commercial_opportunities', 'TRIGGER')
     or has_table_privilege('service_role', 'public.commercial_opportunities', 'INSERT')
     or has_table_privilege('service_role', 'public.commercial_opportunities', 'UPDATE')
     or has_table_privilege('service_role', 'public.commercial_opportunities', 'DELETE')
     or has_table_privilege('service_role', 'public.commercial_opportunities', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.commercial_opportunities', 'REFERENCES')
     or has_table_privilege('service_role', 'public.commercial_opportunities', 'TRIGGER')
     or has_table_privilege('anon', 'public.commercial_opportunities', 'SELECT')
     or has_table_privilege('anon', 'public.commercial_opportunities', 'INSERT')
     or has_table_privilege('anon', 'public.commercial_opportunities', 'UPDATE')
     or has_table_privilege('anon', 'public.commercial_opportunities', 'DELETE')
     or has_table_privilege('anon', 'public.commercial_opportunities', 'TRUNCATE')
     or has_table_privilege('anon', 'public.commercial_opportunities', 'REFERENCES')
     or has_table_privilege('anon', 'public.commercial_opportunities', 'TRIGGER')
     or not has_table_privilege('authenticated', 'public.commercial_opportunities', 'SELECT')
     or not has_table_privilege('service_role', 'public.commercial_opportunities', 'SELECT') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: commercial opportunities grants mismatch';
  end if;

  if not has_table_privilege('authenticated', 'public.commercial_opportunity_lifecycle_events', 'SELECT')
     or has_table_privilege('authenticated', 'public.commercial_opportunity_lifecycle_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.commercial_opportunity_lifecycle_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.commercial_opportunity_lifecycle_events', 'DELETE')
     or has_table_privilege('authenticated', 'public.commercial_opportunity_lifecycle_events', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.commercial_opportunity_lifecycle_events', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.commercial_opportunity_lifecycle_events', 'TRIGGER')
     or not has_table_privilege('service_role', 'public.commercial_opportunity_lifecycle_events', 'SELECT')
     or has_table_privilege('service_role', 'public.commercial_opportunity_lifecycle_events', 'INSERT')
     or has_table_privilege('service_role', 'public.commercial_opportunity_lifecycle_events', 'UPDATE')
     or has_table_privilege('service_role', 'public.commercial_opportunity_lifecycle_events', 'DELETE')
     or has_table_privilege('service_role', 'public.commercial_opportunity_lifecycle_events', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.commercial_opportunity_lifecycle_events', 'REFERENCES')
     or has_table_privilege('service_role', 'public.commercial_opportunity_lifecycle_events', 'TRIGGER')
     or has_table_privilege('anon', 'public.commercial_opportunity_lifecycle_events', 'SELECT') then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: lifecycle events grants mismatch';
  end if;

  if exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name in (
        'commercial_opportunities',
        'commercial_opportunity_lifecycle_events'
      )
      and (
        has_column_privilege('authenticated', pg_catalog.format('%I.%I', column_row.table_schema, column_row.table_name), column_row.column_name, 'INSERT')
        or has_column_privilege('authenticated', pg_catalog.format('%I.%I', column_row.table_schema, column_row.table_name), column_row.column_name, 'UPDATE')
        or has_column_privilege('authenticated', pg_catalog.format('%I.%I', column_row.table_schema, column_row.table_name), column_row.column_name, 'REFERENCES')
        or has_column_privilege('service_role', pg_catalog.format('%I.%I', column_row.table_schema, column_row.table_name), column_row.column_name, 'INSERT')
        or has_column_privilege('service_role', pg_catalog.format('%I.%I', column_row.table_schema, column_row.table_name), column_row.column_name, 'UPDATE')
        or has_column_privilege('service_role', pg_catalog.format('%I.%I', column_row.table_schema, column_row.table_name), column_row.column_name, 'REFERENCES')
        or has_column_privilege('anon', pg_catalog.format('%I.%I', column_row.table_schema, column_row.table_name), column_row.column_name, 'SELECT')
        or has_column_privilege('anon', pg_catalog.format('%I.%I', column_row.table_schema, column_row.table_name), column_row.column_name, 'INSERT')
        or has_column_privilege('anon', pg_catalog.format('%I.%I', column_row.table_schema, column_row.table_name), column_row.column_name, 'UPDATE')
        or has_column_privilege('anon', pg_catalog.format('%I.%I', column_row.table_schema, column_row.table_name), column_row.column_name, 'REFERENCES')
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: column-level write or anonymous privileges remain on hardened commercial tables';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policy policy_row
    join pg_catalog.pg_class class_row
      on class_row.oid = policy_row.polrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'commercial_opportunities'
      and policy_row.polname in (
        'commercial_opportunities_insert_by_membership',
        'commercial_opportunities_update_by_membership'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: direct write policies still exist on commercial_opportunities';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'commercial_opportunity_lifecycle_events'
      and column_row.column_name = 'idempotency_key'
      and column_row.is_nullable = 'NO'
      and column_row.data_type = 'text'
  ) or not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'commercial_opportunity_lifecycle_events'
      and column_row.column_name = 'event_key'
      and column_row.is_nullable = 'NO'
      and column_row.data_type = 'text'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: lifecycle event idempotency columns contract mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class class_row
      on class_row.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'commercial_opportunity_lifecycle_events'
      and constraint_row.conname = 'commercial_opportunity_lifecycle_events_idempotency_key_check'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) ilike '%length(btrim(idempotency_key)) > 0%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) ilike '%idempotency_key = btrim(idempotency_key)%'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: idempotency key check constraint mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class class_row
      on class_row.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'commercial_opportunity_lifecycle_events'
      and constraint_row.conname = 'commercial_opportunity_lifecycle_events_event_key_sha256_check'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) ilike '%event_key ~%'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: event key check constraint mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class class_row
      on class_row.oid = index_row.indexrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'commercial_opportunity_lifecycle_events_idempotency_uidx'
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and pg_catalog.pg_get_indexdef(index_row.indexrelid) ilike '%(organization_id, store_id, commercial_opportunity_id, idempotency_key)%'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: idempotency unique index mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class class_row
      on class_row.oid = index_row.indexrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'commercial_opportunity_lifecycle_events_operational_slot_uidx'
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indpred is not null
      and pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid) ilike '%marked_lost%'
      and pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid) ilike '%reopened%'
      and pg_catalog.pg_get_indexdef(index_row.indexrelid) ilike '%(organization_id, store_id, commercial_opportunity_id, lifecycle_cycle, event_type)%'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: operational slot unique index mismatch';
  end if;

  if exists (
    select 1
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    where lifecycle_event.idempotency_key is null
       or lifecycle_event.event_key is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: lifecycle event idempotency columns contain nulls';
  end if;

  if (select count(*) from public.commercial_opportunities) <> 0
     or (select count(*) from public.commercial_opportunity_lifecycle_events) <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: hardened commercial tables must remain empty after migration';
  end if;

  if exists (
    select 1
    from public.commercial_opportunity_lifecycle_events lifecycle_event
    group by
      lifecycle_event.organization_id,
      lifecycle_event.store_id,
      lifecycle_event.commercial_opportunity_id,
      lifecycle_event.lifecycle_cycle,
      lifecycle_event.event_type
    having count(*) > 1
       and bool_or(lifecycle_event.event_type in ('marked_lost', 'reopened'))
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: operational slot duplicates detected';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(v_log_oid);
  if v_definition ilike '%pg_catalog.coalesce%'
     or v_definition ilike '%pg_catalog.nullif%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: log_state_transition still contains invalid qualified coalesce or nullif';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.normalize_commercial_opportunity_loss_reason_code(text)')
  );
  if v_definition ilike '%pg_catalog.coalesce%'
     or v_definition ilike '%pg_catalog.nullif%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: normalize_commercial_opportunity_loss_reason_code still contains invalid qualified coalesce or nullif';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.normalize_commercial_opportunity_stage(text)')
  );
  if v_definition ilike '%pg_catalog.coalesce%'
     or v_definition ilike '%pg_catalog.nullif%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: normalize_commercial_opportunity_stage still contains invalid qualified coalesce or nullif';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(v_user_oid);
  if v_definition ilike '%pg_catalog.coalesce%'
     or v_definition ilike '%pg_catalog.nullif%'
     or v_definition not ilike '%ZION_CONTACT_OPT_OUT_ATOMIC_BLOCK_REQUIRED%'
     or v_definition not ilike '%v_candidate_event_key := public.compute_commercial_opportunity_event_fingerprint_internal%'
     or v_definition not ilike '%ZION_STORED_EVENT_FINGERPRINT_MISMATCH%'
     or v_definition not ilike '%p_idempotency_key text%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: user loss rpc normalization or business rule mismatch';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(v_system_oid);
  if v_definition ilike '%pg_catalog.coalesce%'
     or v_definition ilike '%pg_catalog.nullif%'
     or v_definition not ilike '%v_candidate_event_key := public.compute_commercial_opportunity_event_fingerprint_internal%'
     or v_definition not ilike '%ZION_STORED_EVENT_FINGERPRINT_MISMATCH%'
     or v_definition not ilike '%p_idempotency_key text%'
     or v_definition not ilike '%p_reason_code text%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: system loss rpc still contains invalid qualified coalesce or nullif';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(v_reopen_oid);
  if v_definition ilike '%pg_catalog.coalesce%'
     or v_definition ilike '%pg_catalog.nullif%'
     or v_definition not ilike '%last_reopened_at = v_reopen_event.created_at%'
     or v_definition ilike '%ZION_IDEMPOTENT_REOPEN_OBSOLETE%'
     or v_definition not ilike '%v_candidate_event_key := public.compute_commercial_opportunity_event_fingerprint_internal%'
     or v_definition not ilike '%ZION_STORED_EVENT_FINGERPRINT_MISMATCH%'
     or v_definition not ilike '%p_idempotency_key text%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: reopen rpc normalization or projection mismatch';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(v_helper_oid);
  if v_definition ilike '%metadata%'
     or v_definition ilike '%idempotency_key%'
     or v_definition not ilike '%p_evidence_summary text%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: helper must not include metadata or idempotency key';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.prevent_commercial_opportunity_core_change()')
  );
  if v_definition not ilike '%origin_lead_id%'
     or v_definition not ilike '%primary_conversation_id%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: core immutability trigger no longer protects create-only fields';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.enforce_commercial_opportunity_loss_stage_transition()')
  );
  if v_definition not ilike '%ZION_DIRECT_STAGE_TRANSITION_FORBIDDEN%'
     or v_definition not ilike '%ZION_REOPEN_PROJECTION_EVENT_MISMATCH%'
     or v_definition not ilike '%new.last_reopened_at is distinct from old.last_reopened_at%' then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: stage transition hardening mismatch';
  end if;

  v_core_trigger_oid := (
    select trigger_row.oid
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class class_row
      on class_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'commercial_opportunities'
      and trigger_row.tgname = 'commercial_opportunities_prevent_core_change'
      and trigger_row.tgenabled = 'O'
  );
  v_stage_trigger_oid := (
    select trigger_row.oid
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class class_row
      on class_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'commercial_opportunities'
      and trigger_row.tgname = 'commercial_opportunities_10_enforce_loss_stage_transition'
      and trigger_row.tgenabled = 'O'
  );

  if v_core_trigger_oid is null or v_stage_trigger_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: critical commercial opportunity triggers are missing or disabled';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class class_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'commercial_opportunities'
      and class_row.relrowsecurity
      and not class_row.relforcerowsecurity
  ) or not exists (
    select 1
    from pg_catalog.pg_class class_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = 'commercial_opportunity_lifecycle_events'
      and class_row.relrowsecurity
      and not class_row.relforcerowsecurity
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: rls must remain enabled on hardened commercial tables';
  end if;
end;
$postconditions$;

commit;

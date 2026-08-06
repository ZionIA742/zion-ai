begin;

do $checks$
declare
  v_profiles_is_blocked_default text;
  v_memberships_is_active_default text;
  v_profiles_rls_enabled boolean;
  v_profiles_rls_forced boolean;
  v_memberships_rls_enabled boolean;
  v_memberships_rls_forced boolean;
  v_memberships_unique_preserved boolean;
  v_profile_user_id uuid;
  v_membership_user_id uuid;
  v_membership_organization_id uuid;
  v_expected_error_state text;
begin
  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'profiles'
      and column_row.column_name = 'is_blocked'
      and column_row.udt_name = 'bool'
      and column_row.is_nullable = 'NO'
  ) then
    raise exception 'manual check failed: public.profiles.is_blocked contract mismatch';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'memberships'
      and column_row.column_name = 'is_active'
      and column_row.udt_name = 'bool'
      and column_row.is_nullable = 'NO'
  ) then
    raise exception 'manual check failed: public.memberships.is_active contract mismatch';
  end if;

  select pg_catalog.pg_get_expr(def.adbin, def.adrelid)
  into v_profiles_is_blocked_default
  from pg_catalog.pg_attribute attr
  join pg_catalog.pg_attrdef def
    on def.adrelid = attr.attrelid
   and def.adnum = attr.attnum
  where attr.attrelid = 'public.profiles'::regclass
    and attr.attname = 'is_blocked';

  if v_profiles_is_blocked_default not in ('false', 'false::boolean') then
    raise exception 'manual check failed: public.profiles.is_blocked default mismatch: %', v_profiles_is_blocked_default;
  end if;

  select pg_catalog.pg_get_expr(def.adbin, def.adrelid)
  into v_memberships_is_active_default
  from pg_catalog.pg_attribute attr
  join pg_catalog.pg_attrdef def
    on def.adrelid = attr.attrelid
   and def.adnum = attr.attnum
  where attr.attrelid = 'public.memberships'::regclass
    and attr.attname = 'is_active';

  if v_memberships_is_active_default not in ('true', 'true::boolean') then
    raise exception 'manual check failed: public.memberships.is_active default mismatch: %', v_memberships_is_active_default;
  end if;

  if exists (
    select 1
    from public.profiles profile_row
    where profile_row.is_blocked is distinct from false
  ) then
    raise exception 'manual check failed: profiles backfill mismatch';
  end if;

  if exists (
    select 1
    from public.memberships membership_row
    where membership_row.is_active is distinct from true
  ) then
    raise exception 'manual check failed: memberships backfill mismatch';
  end if;

  select class_row.relrowsecurity, class_row.relforcerowsecurity
  into v_profiles_rls_enabled, v_profiles_rls_forced
  from pg_catalog.pg_class class_row
  where class_row.oid = 'public.profiles'::regclass;

  if v_profiles_rls_enabled is not true or v_profiles_rls_forced is not true then
    raise exception 'manual check failed: public.profiles must keep RLS enabled and forced';
  end if;

  select class_row.relrowsecurity, class_row.relforcerowsecurity
  into v_memberships_rls_enabled, v_memberships_rls_forced
  from pg_catalog.pg_class class_row
  where class_row.oid = 'public.memberships'::regclass;

  if v_memberships_rls_enabled is not true or v_memberships_rls_forced is not true then
    raise exception 'manual check failed: public.memberships must keep RLS enabled and forced';
  end if;

  select exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.memberships'::regclass
      and constraint_row.contype = 'u'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) ilike '%organization_id, user_id%'
  )
  into v_memberships_unique_preserved;

  if v_memberships_unique_preserved is not true then
    raise exception 'manual check failed: memberships organization/user uniqueness changed';
  end if;

  select profile_row.user_id
  into v_profile_user_id
  from public.profiles profile_row
  where profile_row.user_id is not null
  order by profile_row.user_id
  limit 1;

  if v_profile_user_id is null then
    raise exception 'manual check failed: no real profile fixture available for profiles.is_blocked permission test';
  end if;

  begin
    execute 'set local role authenticated';
    perform pg_catalog.set_config('request.jwt.claim.sub', v_profile_user_id::text, true);
    perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
    perform pg_catalog.set_config(
      'request.jwt.claims',
      json_build_object('sub', v_profile_user_id::text, 'role', 'authenticated')::text,
      true
    );

    update public.profiles profile_row
    set is_blocked = not profile_row.is_blocked
    where profile_row.user_id = v_profile_user_id;

    execute 'reset role';
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config('request.jwt.claim.role', '', true);
    perform pg_catalog.set_config('request.jwt.claims', '', true);

    raise exception 'manual check failed: authenticated unexpectedly updated profiles.is_blocked for its own profile';
  exception
    when others then
      get stacked diagnostics v_expected_error_state = returned_sqlstate;

      execute 'reset role';
      perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
      perform pg_catalog.set_config('request.jwt.claim.role', '', true);
      perform pg_catalog.set_config('request.jwt.claims', '', true);

      if v_expected_error_state <> '42501' then
        raise exception
          'manual check failed: profiles.is_blocked denial expected SQLSTATE 42501, got %',
          v_expected_error_state;
      end if;
  end;

  select membership_row.user_id, membership_row.organization_id
  into v_membership_user_id, v_membership_organization_id
  from public.memberships membership_row
  where membership_row.user_id is not null
    and membership_row.organization_id is not null
  order by membership_row.organization_id, membership_row.user_id
  limit 1;

  if v_membership_user_id is null or v_membership_organization_id is null then
    raise exception 'manual check failed: no real membership fixture available for memberships.is_active permission test';
  end if;

  begin
    execute 'set local role authenticated';
    perform pg_catalog.set_config('request.jwt.claim.sub', v_membership_user_id::text, true);
    perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
    perform pg_catalog.set_config(
      'request.jwt.claims',
      json_build_object('sub', v_membership_user_id::text, 'role', 'authenticated')::text,
      true
    );

    update public.memberships membership_row
    set is_active = not membership_row.is_active
    where membership_row.user_id = v_membership_user_id
      and membership_row.organization_id = v_membership_organization_id;

    execute 'reset role';
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config('request.jwt.claim.role', '', true);
    perform pg_catalog.set_config('request.jwt.claims', '', true);

    raise exception 'manual check failed: authenticated unexpectedly updated memberships.is_active';
  exception
    when others then
      get stacked diagnostics v_expected_error_state = returned_sqlstate;

      execute 'reset role';
      perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
      perform pg_catalog.set_config('request.jwt.claim.role', '', true);
      perform pg_catalog.set_config('request.jwt.claims', '', true);

      if v_expected_error_state <> '42501' then
        raise exception
          'manual check failed: memberships.is_active denial expected SQLSTATE 42501, got %',
          v_expected_error_state;
      end if;
  end;
end;
$checks$;

rollback;

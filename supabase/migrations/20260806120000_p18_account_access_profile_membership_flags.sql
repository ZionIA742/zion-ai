do $migration$
declare
  v_profiles_regclass regclass := pg_catalog.to_regclass('public.profiles');
  v_memberships_regclass regclass := pg_catalog.to_regclass('public.memberships');
  v_profiles_is_blocked_udt text;
  v_memberships_is_active_udt text;
begin
  if v_profiles_regclass is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.profiles is missing';
  end if;

  if v_memberships_regclass is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.memberships is missing';
  end if;

  select column_row.udt_name
  into v_profiles_is_blocked_udt
  from information_schema.columns column_row
  where column_row.table_schema = 'public'
    and column_row.table_name = 'profiles'
    and column_row.column_name = 'is_blocked';

  if v_profiles_is_blocked_udt is null then
    execute 'alter table public.profiles add column is_blocked boolean';
  elsif v_profiles_is_blocked_udt <> 'bool' then
    raise exception using
      errcode = 'P0001',
      message = 'collision detected: public.profiles.is_blocked must be boolean';
  end if;

  execute 'update public.profiles set is_blocked = false where is_blocked is null';
  execute 'alter table public.profiles alter column is_blocked set default false';
  execute 'alter table public.profiles alter column is_blocked set not null';
  execute $sql$
    comment on column public.profiles.is_blocked is
      'Security flag controlled only by trusted server-side workflows to block all authenticated access for this profile.'
  $sql$;

  select column_row.udt_name
  into v_memberships_is_active_udt
  from information_schema.columns column_row
  where column_row.table_schema = 'public'
    and column_row.table_name = 'memberships'
    and column_row.column_name = 'is_active';

  if v_memberships_is_active_udt is null then
    execute 'alter table public.memberships add column is_active boolean';
  elsif v_memberships_is_active_udt <> 'bool' then
    raise exception using
      errcode = 'P0001',
      message = 'collision detected: public.memberships.is_active must be boolean';
  end if;

  execute 'update public.memberships set is_active = true where is_active is null';
  execute 'alter table public.memberships alter column is_active set default true';
  execute 'alter table public.memberships alter column is_active set not null';
  execute $sql$
    comment on column public.memberships.is_active is
      'Security flag controlled only by trusted server-side workflows to decide whether this membership participates in canonical tenant resolution.'
  $sql$;
end;
$migration$;

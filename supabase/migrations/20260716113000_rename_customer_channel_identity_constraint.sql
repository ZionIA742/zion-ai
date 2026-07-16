do $$
declare
  current_constraint_def text;
begin
  if exists (
    select 1
    from pg_constraint con
    join pg_class rel
      on rel.oid = con.conrelid
    join pg_namespace nsp
      on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'customer_channel_identities'
      and con.conname = 'customer_channel_identities_normalized_identity_not_blank_chk'
  ) then
    if exists (
      select 1
      from pg_constraint con
      join pg_class rel
        on rel.oid = con.conrelid
      join pg_namespace nsp
        on nsp.oid = rel.relnamespace
      where nsp.nspname = 'public'
        and rel.relname = 'customer_channel_identities'
        and con.conname = 'customer_channel_identities_normalized_external_identity_not_bl'
    ) then
      raise exception
        'Unexpected constraint state on public.customer_channel_identities: both old truncated name and new target name exist';
    end if;

    select pg_get_constraintdef(con.oid, true)
      into current_constraint_def
    from pg_constraint con
    join pg_class rel
      on rel.oid = con.conrelid
    join pg_namespace nsp
      on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'customer_channel_identities'
      and con.conname = 'customer_channel_identities_normalized_identity_not_blank_chk';

    if current_constraint_def <> 'CHECK (length(btrim(normalized_external_identity)) > 0)' then
      raise exception
        'Unexpected definition for public.customer_channel_identities.customer_channel_identities_normalized_identity_not_blank_chk: %',
        current_constraint_def;
    end if;

    return;
  end if;

  if not exists (
    select 1
    from pg_constraint con
    join pg_class rel
      on rel.oid = con.conrelid
    join pg_namespace nsp
      on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'customer_channel_identities'
      and con.conname = 'customer_channel_identities_normalized_external_identity_not_bl'
  ) then
    raise exception
      'Expected truncated constraint public.customer_channel_identities.customer_channel_identities_normalized_external_identity_not_bl was not found';
  end if;

  select pg_get_constraintdef(con.oid, true)
    into current_constraint_def
  from pg_constraint con
  join pg_class rel
    on rel.oid = con.conrelid
  join pg_namespace nsp
    on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'customer_channel_identities'
    and con.conname = 'customer_channel_identities_normalized_external_identity_not_bl';

  if current_constraint_def <> 'CHECK (length(btrim(normalized_external_identity)) > 0)' then
    raise exception
      'Unexpected definition for public.customer_channel_identities.customer_channel_identities_normalized_external_identity_not_bl: %',
      current_constraint_def;
  end if;

  alter table public.customer_channel_identities
    rename constraint customer_channel_identities_normalized_external_identity_not_bl
    to customer_channel_identities_normalized_identity_not_blank_chk;
end;
$$;

do $$
declare
  invalid_row_count bigint;
begin
  select count(*)
    into invalid_row_count
  from public.customer_channel_identities
  where normalized_external_identity is null
     or length(btrim(normalized_external_identity)) = 0;

  if invalid_row_count > 0 then
    raise exception
      'Cannot add constraint customer_channel_identities_normalized_external_identity_not_blank_check: found % invalid row(s) with null, empty, or whitespace-only normalized_external_identity',
      invalid_row_count;
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
      and con.conname = 'customer_channel_identities_normalized_external_identity_not_blank_check'
  ) then
    alter table public.customer_channel_identities
      add constraint customer_channel_identities_normalized_external_identity_not_blank_check
      check (length(btrim(normalized_external_identity)) > 0);
  end if;
end;
$$;

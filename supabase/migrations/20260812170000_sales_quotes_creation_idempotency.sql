do $$
begin
  alter table public.sales_quotes
    add column if not exists creation_idempotency_key text null,
    add column if not exists creation_request_fingerprint text null;
exception
  when duplicate_column then
    null;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.sales_quotes'::pg_catalog.regclass
      and constraint_row.conname = 'sales_quotes_creation_idempotency_pair_check'
  ) then
    alter table public.sales_quotes
      add constraint sales_quotes_creation_idempotency_pair_check
      check (
        (
          creation_idempotency_key is null
          and creation_request_fingerprint is null
        )
        or (
          creation_idempotency_key is not null
          and creation_request_fingerprint is not null
        )
      );
  end if;
end;
$$;

create unique index if not exists sales_quotes_org_store_creation_idempotency_uidx
  on public.sales_quotes (organization_id, store_id, creation_idempotency_key)
  where creation_idempotency_key is not null;

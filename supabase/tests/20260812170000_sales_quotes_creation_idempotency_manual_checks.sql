begin;

do $$
declare
  v_creation_key_column record;
  v_creation_fingerprint_column record;
  v_constraint_expr text;
  v_normalized_constraint_expr text;
  v_index_predicate text;
  v_index_keys text[];
begin
  select
    column_name,
    is_nullable,
    data_type
  into v_creation_key_column
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'sales_quotes'
    and column_name = 'creation_idempotency_key';

  if v_creation_key_column.column_name is null
     or v_creation_key_column.is_nullable <> 'YES'
     or v_creation_key_column.data_type <> 'text' then
    raise exception 'manual check failed: creation_idempotency_key contract mismatch';
  end if;

  select
    column_name,
    is_nullable,
    data_type
  into v_creation_fingerprint_column
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'sales_quotes'
    and column_name = 'creation_request_fingerprint';

  if v_creation_fingerprint_column.column_name is null
     or v_creation_fingerprint_column.is_nullable <> 'YES'
     or v_creation_fingerprint_column.data_type <> 'text' then
    raise exception 'manual check failed: creation_request_fingerprint contract mismatch';
  end if;

  select pg_catalog.pg_get_expr(constraint_row.conbin, constraint_row.conrelid, true)
  into v_constraint_expr
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.sales_quotes'::pg_catalog.regclass
    and constraint_row.contype = 'c'
    and constraint_row.conname = 'sales_quotes_creation_idempotency_pair_check';

  v_normalized_constraint_expr := lower(
    regexp_replace(coalesce(v_constraint_expr, ''), '\s+', ' ', 'g')
  );

  if v_constraint_expr is null
     or v_normalized_constraint_expr !~ 'creation_idempotency_key\s+is\s+null'
     or v_normalized_constraint_expr !~ 'creation_request_fingerprint\s+is\s+null'
     or v_normalized_constraint_expr !~ 'creation_idempotency_key\s+is\s+not\s+null'
     or v_normalized_constraint_expr !~ 'creation_request_fingerprint\s+is\s+not\s+null'
     or (
       v_normalized_constraint_expr !~ '\(*\s*creation_idempotency_key\s+is\s+null\s+and\s+creation_request_fingerprint\s+is\s+null\s*\)*\s+or\s+\(*\s*creation_idempotency_key\s+is\s+not\s+null\s+and\s+creation_request_fingerprint\s+is\s+not\s+null\s*\)*'
       and v_normalized_constraint_expr !~ '\(*\s*creation_idempotency_key\s+is\s+not\s+null\s+and\s+creation_request_fingerprint\s+is\s+not\s+null\s*\)*\s+or\s+\(*\s*creation_idempotency_key\s+is\s+null\s+and\s+creation_request_fingerprint\s+is\s+null\s*\)*'
     ) then
    raise exception 'manual check failed: pair check constraint mismatch';
  end if;

  select
    pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid),
    array_agg(attribute_row.attname order by key_column.ordinality)
  into
    v_index_predicate,
    v_index_keys
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class class_row
    on class_row.oid = index_row.indexrelid
  join unnest(index_row.indkey) with ordinality as key_column(attnum, ordinality)
    on true
  join pg_catalog.pg_attribute attribute_row
    on attribute_row.attrelid = index_row.indrelid
   and attribute_row.attnum = key_column.attnum
  where index_row.indrelid = 'public.sales_quotes'::pg_catalog.regclass
    and class_row.relname = 'sales_quotes_org_store_creation_idempotency_uidx'
    and index_row.indisunique
  group by index_row.indpred, index_row.indrelid;

  if v_index_keys is null
     or pg_catalog.array_length(v_index_keys, 1) <> 3
     or v_index_keys[1] <> 'organization_id'
     or v_index_keys[2] <> 'store_id'
     or v_index_keys[3] <> 'creation_idempotency_key'
     or coalesce(v_index_predicate, '') <> '(creation_idempotency_key IS NOT NULL)' then
    raise exception 'manual check failed: unique partial index contract mismatch';
  end if;
end;
$$;

rollback;

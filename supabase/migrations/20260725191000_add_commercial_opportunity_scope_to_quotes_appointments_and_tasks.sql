begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';
set local idle_in_transaction_session_timeout = '180s';
set local search_path = pg_catalog, pg_temp, public;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:etapa-1-3:commercial-opportunity-scope-foundation:v1',
    0
  )
);

create or replace function pg_temp.describe_index_contract(
  p_index_schema text,
  p_index_name text,
  p_table_schema text,
  p_table_name text,
  p_expected_access_method text,
  p_expected_is_unique boolean,
  p_expected_is_primary boolean,
  p_expected_indnkeyatts integer,
  p_expected_indnatts integer,
  p_expected_columns text[]
)
returns table (
  object_exists boolean,
  index_schema text,
  index_name text,
  table_schema text,
  table_name text,
  relkind text,
  access_method text,
  indisunique boolean,
  indisprimary boolean,
  indisvalid boolean,
  indisready boolean,
  indnkeyatts integer,
  indnatts integer,
  has_expressions boolean,
  is_partial boolean,
  actual_columns text[],
  exact_contract_matches boolean
)
language sql
as $function$
  with actual as (
    select
      index_namespace_row.nspname::text as index_schema,
      index_class_row.relname::text as index_name,
      table_namespace_row.nspname::text as table_schema,
      table_class_row.relname::text as table_name,
      index_class_row.relkind::text as relkind,
      access_method_row.amname::text as access_method,
      index_row.indisunique,
      index_row.indisprimary,
      index_row.indisvalid,
      index_row.indisready,
      index_row.indnkeyatts::integer as indnkeyatts,
      index_row.indnatts::integer as indnatts,
      index_row.indexprs is not null as has_expressions,
      index_row.indpred is not null as is_partial,
      (
        select array_agg(attribute_row.attname::text order by key_row.ordinality)
        from unnest(index_row.indkey::smallint[]) with ordinality as key_row(attnum, ordinality)
        join pg_catalog.pg_attribute attribute_row
          on attribute_row.attrelid = index_row.indrelid
         and attribute_row.attnum = key_row.attnum
         and not attribute_row.attisdropped
      ) as actual_columns
    from pg_catalog.pg_class index_class_row
    join pg_catalog.pg_namespace index_namespace_row
      on index_namespace_row.oid = index_class_row.relnamespace
    left join pg_catalog.pg_index index_row
      on index_row.indexrelid = index_class_row.oid
    left join pg_catalog.pg_class table_class_row
      on table_class_row.oid = index_row.indrelid
    left join pg_catalog.pg_namespace table_namespace_row
      on table_namespace_row.oid = table_class_row.relnamespace
    left join pg_catalog.pg_am access_method_row
      on access_method_row.oid = index_class_row.relam
    where index_namespace_row.nspname = p_index_schema
      and index_class_row.relname = p_index_name
    limit 1
  )
  select
    true as object_exists,
    actual.index_schema,
    coalesce(actual.index_name, p_index_name) as index_name,
    actual.table_schema,
    actual.table_name,
    actual.relkind,
    actual.access_method,
    actual.indisunique,
    actual.indisprimary,
    actual.indisvalid,
    actual.indisready,
    actual.indnkeyatts,
    actual.indnatts,
    actual.has_expressions,
    actual.is_partial,
    actual.actual_columns,
    coalesce(
      actual.index_schema = p_index_schema
      and actual.table_schema = p_table_schema
      and actual.table_name = p_table_name
      and actual.relkind = 'i'
      and actual.access_method = p_expected_access_method
      and actual.indisunique = p_expected_is_unique
      and actual.indisprimary = p_expected_is_primary
      and actual.indisvalid is true
      and actual.indisready is true
      and actual.has_expressions is false
      and actual.is_partial is false
      and actual.indnkeyatts = p_expected_indnkeyatts
      and actual.indnatts = p_expected_indnatts
      and actual.actual_columns = p_expected_columns,
      false
    ) as exact_contract_matches
  from actual
  union all
  select
    false as object_exists,
    p_index_schema,
    p_index_name,
    null::text,
    null::text,
    null::text,
    null::text,
    null::boolean,
    null::boolean,
    null::boolean,
    null::boolean,
    null::integer,
    null::integer,
    null::boolean,
    null::boolean,
    null::text[],
    false
  where not exists (select 1 from actual);
$function$;

do $preflight$
declare
  v_table text;
  v_expected_owner name;
  v_actual_owner name;
  v_column record;
  v_index record;
  v_index_contract record;
  v_constraint record;
begin
  foreach v_table in array array[
    'public.commercial_opportunities',
    'public.sales_quotes',
    'public.store_appointments',
    'public.store_assistant_operational_tasks',
    'public.sales_contracts'
  ] loop
    if pg_catalog.to_regclass(v_table) is null then
      raise exception using
        errcode = 'P0001',
        message = 'precondition failed: required relation is missing: ' || v_table;
    end if;
  end loop;

  select pg_catalog.pg_get_userbyid(class_row.relowner)
  into v_expected_owner
  from pg_catalog.pg_class class_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = class_row.relnamespace
  where namespace_row.nspname = 'public'
    and class_row.relname = 'commercial_opportunities';

  if v_expected_owner is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: could not resolve expected owner for public.commercial_opportunities';
  end if;

  foreach v_table in array array[
    'commercial_opportunities',
    'sales_quotes',
    'store_appointments',
    'store_assistant_operational_tasks',
    'sales_contracts'
  ] loop
    select pg_catalog.pg_get_userbyid(class_row.relowner)
    into v_actual_owner
    from pg_catalog.pg_class class_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'public'
      and class_row.relname = v_table;

    if v_actual_owner is distinct from v_expected_owner then
      raise exception using
        errcode = 'P0001',
        message = format(
          'precondition failed: public.%s owner mismatch (expected %s, found %s)',
          v_table,
          v_expected_owner,
          coalesce(v_actual_owner, '<null>')
        );
    end if;
  end loop;

  for v_column in
    select *
    from (
      values
        ('commercial_opportunities'::text, 'id'::text, 'uuid'::text),
        ('commercial_opportunities', 'organization_id', 'uuid'),
        ('commercial_opportunities', 'store_id', 'uuid'),
        ('sales_quotes', 'id', 'uuid'),
        ('sales_quotes', 'organization_id', 'uuid'),
        ('sales_quotes', 'store_id', 'uuid'),
        ('store_appointments', 'id', 'uuid'),
        ('store_appointments', 'organization_id', 'uuid'),
        ('store_appointments', 'store_id', 'uuid'),
        ('store_assistant_operational_tasks', 'id', 'uuid'),
        ('store_assistant_operational_tasks', 'organization_id', 'uuid'),
        ('store_assistant_operational_tasks', 'store_id', 'uuid'),
        ('sales_contracts', 'id', 'uuid'),
        ('sales_contracts', 'organization_id', 'uuid'),
        ('sales_contracts', 'store_id', 'uuid')
    ) as expected(table_name, column_name, data_type)
  loop
    if exists (
      select 1
      from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = v_column.table_name
        and column_row.column_name = v_column.column_name
        and column_row.data_type = v_column.data_type
    ) then
      continue;
    end if;

    raise exception using
      errcode = 'P0001',
      message = format(
        'precondition failed: public.%s.%s must exist as %s',
        v_column.table_name,
        v_column.column_name,
        v_column.data_type
      );
  end loop;

  foreach v_table in array array[
    'sales_quotes',
    'store_appointments',
    'store_assistant_operational_tasks'
  ] loop
    if exists (
      select 1
      from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = v_table
        and column_row.column_name = 'commercial_opportunity_id'
        and (
          column_row.data_type <> 'uuid'
          or column_row.is_nullable <> 'YES'
        )
    ) then
      raise exception using
        errcode = 'P0001',
        message = format(
          'precondition failed: public.%s.commercial_opportunity_id must be uuid nullable when already present',
          v_table
        );
    end if;
  end loop;

  if exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'sales_contracts'
      and column_row.column_name = 'commercial_opportunity_id'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.sales_contracts already has commercial_opportunity_id and must not be altered in this stage';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.commercial_opportunities'::pg_catalog.regclass
      and constraint_row.contype = 'p'
      and constraint_row.conkey = array[
        (
          select attnum
          from pg_catalog.pg_attribute
          where attrelid = 'public.commercial_opportunities'::pg_catalog.regclass
            and attname = 'id'
            and not attisdropped
        )
      ]::smallint[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.commercial_opportunities primary key contract mismatch';
  end if;

  for v_index in
    select *
    from (
      values
        ('commercial_opportunities'::text, 'commercial_opportunities_id_organization_store_uidx'::text, true, false, array['id', 'organization_id', 'store_id']::text[]),
        ('sales_quotes', 'sales_quotes_organization_store_commercial_opportunity_idx', false, false, array['organization_id', 'store_id', 'commercial_opportunity_id']::text[]),
        ('store_appointments', 'store_appointments_org_store_commercial_opportunity_idx', false, false, array['organization_id', 'store_id', 'commercial_opportunity_id']::text[]),
        ('store_assistant_operational_tasks', 'store_assistant_operational_tasks_org_store_opportunity_idx', false, false, array['organization_id', 'store_id', 'commercial_opportunity_id']::text[])
    ) as expected(table_name, index_name, expected_is_unique, expected_is_primary, expected_columns)
  loop
    select *
    into v_index_contract
    from pg_temp.describe_index_contract(
      'public',
      v_index.index_name,
      'public',
      v_index.table_name,
      'btree',
      v_index.expected_is_unique,
      v_index.expected_is_primary,
      3,
      3,
      v_index.expected_columns
    );

    if v_index_contract.object_exists is true
      and v_index_contract.exact_contract_matches is not true then
      raise exception using
        errcode = 'P0001',
        message = case
          when v_index.index_name = 'commercial_opportunities_id_organization_store_uidx'
            then 'precondition failed: commercial_opportunities_id_organization_store_uidx exists with a divergent contract'
          else format(
            'precondition failed: public.%s %s exists with a divergent contract',
            v_index.table_name,
            v_index.index_name
          )
        end,
        detail = format(
          'object_exists=%s, index_schema=%s, index_name=%s, table_schema=%s, table_name=%s, access_method=%s, indisunique=%s, indisprimary=%s, indisvalid=%s, indisready=%s, indnkeyatts=%s, indnatts=%s, has_expressions=%s, is_partial=%s, actual_columns=%s',
          coalesce(v_index_contract.object_exists::text, '<null>'),
          coalesce(v_index_contract.index_schema, '<null>'),
          coalesce(v_index_contract.index_name, '<null>'),
          coalesce(v_index_contract.table_schema, '<null>'),
          coalesce(v_index_contract.table_name, '<null>'),
          coalesce(v_index_contract.access_method, '<null>'),
          coalesce(v_index_contract.indisunique::text, '<null>'),
          coalesce(v_index_contract.indisprimary::text, '<null>'),
          coalesce(v_index_contract.indisvalid::text, '<null>'),
          coalesce(v_index_contract.indisready::text, '<null>'),
          coalesce(v_index_contract.indnkeyatts::text, '<null>'),
          coalesce(v_index_contract.indnatts::text, '<null>'),
          coalesce(v_index_contract.has_expressions::text, '<null>'),
          coalesce(v_index_contract.is_partial::text, '<null>'),
          coalesce(
            case
              when v_index_contract.actual_columns is null then null
              else format('[%s]', array_to_string(v_index_contract.actual_columns, ', '))
            end,
            '<null>'
          )
        );
    end if;
  end loop;

  for v_constraint in
    select *
    from (
      values
        ('sales_quotes'::text, 'sales_quotes_commercial_opportunity_scope_fkey'::text),
        ('store_appointments', 'store_appointments_commercial_opportunity_scope_fkey'),
        ('store_assistant_operational_tasks', 'store_assistant_operational_tasks_commercial_scope_fkey')
    ) as expected(table_name, constraint_name)
  loop
    if exists (
      select 1
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = format('public.%I', v_constraint.table_name)::pg_catalog.regclass
        and constraint_row.conname = v_constraint.constraint_name
        and constraint_row.contype <> 'f'
    ) then
      raise exception using
        errcode = 'P0001',
        message = format(
          'precondition failed: public.%s %s exists with a divergent constraint kind',
          v_constraint.table_name,
          v_constraint.constraint_name
        );
    end if;

    if exists (
      select 1
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = format('public.%I', v_constraint.table_name)::pg_catalog.regclass
        and constraint_row.conname = v_constraint.constraint_name
        and (
          constraint_row.contype <> 'f'
          or constraint_row.confrelid <> 'public.commercial_opportunities'::pg_catalog.regclass
          or constraint_row.confmatchtype <> 's'
          or constraint_row.confupdtype <> 'a'
          or constraint_row.confdeltype <> 'r'
          or constraint_row.condeferrable is not false
          or constraint_row.condeferred is not false
          or constraint_row.conkey <> array[
            (
              select attnum
              from pg_catalog.pg_attribute
              where attrelid = format('public.%I', v_constraint.table_name)::pg_catalog.regclass
                and attname = 'commercial_opportunity_id'
                and not attisdropped
            ),
            (
              select attnum
              from pg_catalog.pg_attribute
              where attrelid = format('public.%I', v_constraint.table_name)::pg_catalog.regclass
                and attname = 'organization_id'
                and not attisdropped
            ),
            (
              select attnum
              from pg_catalog.pg_attribute
              where attrelid = format('public.%I', v_constraint.table_name)::pg_catalog.regclass
                and attname = 'store_id'
                and not attisdropped
            )
          ]::smallint[]
          or constraint_row.confkey <> array[
            (
              select attnum
              from pg_catalog.pg_attribute
              where attrelid = 'public.commercial_opportunities'::pg_catalog.regclass
                and attname = 'id'
                and not attisdropped
            ),
            (
              select attnum
              from pg_catalog.pg_attribute
              where attrelid = 'public.commercial_opportunities'::pg_catalog.regclass
                and attname = 'organization_id'
                and not attisdropped
            ),
            (
              select attnum
              from pg_catalog.pg_attribute
              where attrelid = 'public.commercial_opportunities'::pg_catalog.regclass
                and attname = 'store_id'
                and not attisdropped
            )
          ]::smallint[]
        )
    ) then
      raise exception using
        errcode = 'P0001',
        message = format(
          'precondition failed: public.%s %s exists with a divergent FK contract',
          v_constraint.table_name,
          v_constraint.constraint_name
        );
    end if;
  end loop;
end;
$preflight$;

create unique index if not exists commercial_opportunities_id_organization_store_uidx
  on public.commercial_opportunities (id, organization_id, store_id);

alter table public.sales_quotes
  add column if not exists commercial_opportunity_id uuid null;

alter table public.store_appointments
  add column if not exists commercial_opportunity_id uuid null;

alter table public.store_assistant_operational_tasks
  add column if not exists commercial_opportunity_id uuid null;

create index if not exists sales_quotes_organization_store_commercial_opportunity_idx
  on public.sales_quotes (organization_id, store_id, commercial_opportunity_id);

create index if not exists store_appointments_org_store_commercial_opportunity_idx
  on public.store_appointments (organization_id, store_id, commercial_opportunity_id);

create index if not exists store_assistant_operational_tasks_org_store_opportunity_idx
  on public.store_assistant_operational_tasks (organization_id, store_id, commercial_opportunity_id);

do $ensure_constraints$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.sales_quotes'::pg_catalog.regclass
      and constraint_row.conname = 'sales_quotes_commercial_opportunity_scope_fkey'
  ) then
    alter table public.sales_quotes
      add constraint sales_quotes_commercial_opportunity_scope_fkey
      foreign key (commercial_opportunity_id, organization_id, store_id)
      references public.commercial_opportunities (id, organization_id, store_id)
      on update no action
      on delete restrict
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.store_appointments'::pg_catalog.regclass
      and constraint_row.conname = 'store_appointments_commercial_opportunity_scope_fkey'
  ) then
    alter table public.store_appointments
      add constraint store_appointments_commercial_opportunity_scope_fkey
      foreign key (commercial_opportunity_id, organization_id, store_id)
      references public.commercial_opportunities (id, organization_id, store_id)
      on update no action
      on delete restrict
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.store_assistant_operational_tasks'::pg_catalog.regclass
      and constraint_row.conname = 'store_assistant_operational_tasks_commercial_scope_fkey'
  ) then
    alter table public.store_assistant_operational_tasks
      add constraint store_assistant_operational_tasks_commercial_scope_fkey
      foreign key (commercial_opportunity_id, organization_id, store_id)
      references public.commercial_opportunities (id, organization_id, store_id)
      on update no action
      on delete restrict
      not valid;
  end if;
end;
$ensure_constraints$;

alter table public.sales_quotes
  validate constraint sales_quotes_commercial_opportunity_scope_fkey;

alter table public.store_appointments
  validate constraint store_appointments_commercial_opportunity_scope_fkey;

alter table public.store_assistant_operational_tasks
  validate constraint store_assistant_operational_tasks_commercial_scope_fkey;

do $postflight$
declare
  v_table text;
  v_index record;
  v_index_contract record;
  v_constraint record;
begin
  foreach v_table in array array[
    'sales_quotes',
    'store_appointments',
    'store_assistant_operational_tasks'
  ] loop
    if not exists (
      select 1
      from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = v_table
        and column_row.column_name = 'commercial_opportunity_id'
        and column_row.data_type = 'uuid'
        and column_row.is_nullable = 'YES'
    ) then
      raise exception using
        errcode = 'P0001',
        message = format(
          'postcondition failed: public.%s.commercial_opportunity_id must exist as uuid nullable',
          v_table
        );
    end if;
  end loop;

  for v_index in
    select *
    from (
      values
        ('commercial_opportunities'::text, 'commercial_opportunities_id_organization_store_uidx'::text, true, false, array['id', 'organization_id', 'store_id']::text[]),
        ('sales_quotes', 'sales_quotes_organization_store_commercial_opportunity_idx', false, false, array['organization_id', 'store_id', 'commercial_opportunity_id']::text[]),
        ('store_appointments', 'store_appointments_org_store_commercial_opportunity_idx', false, false, array['organization_id', 'store_id', 'commercial_opportunity_id']::text[]),
        ('store_assistant_operational_tasks', 'store_assistant_operational_tasks_org_store_opportunity_idx', false, false, array['organization_id', 'store_id', 'commercial_opportunity_id']::text[])
    ) as expected(table_name, index_name, expected_is_unique, expected_is_primary, expected_columns)
  loop
    select *
    into v_index_contract
    from pg_temp.describe_index_contract(
      'public',
      v_index.index_name,
      'public',
      v_index.table_name,
      'btree',
      v_index.expected_is_unique,
      v_index.expected_is_primary,
      3,
      3,
      v_index.expected_columns
    );

    if v_index_contract.object_exists is not true
      or v_index_contract.exact_contract_matches is not true then
      raise exception using
        errcode = 'P0001',
        message = case
          when v_index.index_name = 'commercial_opportunities_id_organization_store_uidx'
            then 'postcondition failed: commercial_opportunities_id_organization_store_uidx contract mismatch'
          else format(
            'postcondition failed: public.%s %s contract mismatch',
            v_index.table_name,
            v_index.index_name
          )
        end,
        detail = format(
          'object_exists=%s, index_schema=%s, index_name=%s, table_schema=%s, table_name=%s, access_method=%s, indisunique=%s, indisprimary=%s, indisvalid=%s, indisready=%s, indnkeyatts=%s, indnatts=%s, has_expressions=%s, is_partial=%s, actual_columns=%s',
          coalesce(v_index_contract.object_exists::text, '<null>'),
          coalesce(v_index_contract.index_schema, '<null>'),
          coalesce(v_index_contract.index_name, '<null>'),
          coalesce(v_index_contract.table_schema, '<null>'),
          coalesce(v_index_contract.table_name, '<null>'),
          coalesce(v_index_contract.access_method, '<null>'),
          coalesce(v_index_contract.indisunique::text, '<null>'),
          coalesce(v_index_contract.indisprimary::text, '<null>'),
          coalesce(v_index_contract.indisvalid::text, '<null>'),
          coalesce(v_index_contract.indisready::text, '<null>'),
          coalesce(v_index_contract.indnkeyatts::text, '<null>'),
          coalesce(v_index_contract.indnatts::text, '<null>'),
          coalesce(v_index_contract.has_expressions::text, '<null>'),
          coalesce(v_index_contract.is_partial::text, '<null>'),
          coalesce(
            case
              when v_index_contract.actual_columns is null then null
              else format('[%s]', array_to_string(v_index_contract.actual_columns, ', '))
            end,
            '<null>'
          )
        );
    end if;
  end loop;

  if exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'sales_contracts'
      and column_row.column_name = 'commercial_opportunity_id'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: public.sales_contracts was altered unexpectedly';
  end if;

  for v_constraint in
    select *
    from (
      values
        ('sales_quotes'::text, 'sales_quotes_commercial_opportunity_scope_fkey'::text),
        ('store_appointments', 'store_appointments_commercial_opportunity_scope_fkey'),
        ('store_assistant_operational_tasks', 'store_assistant_operational_tasks_commercial_scope_fkey')
    ) as expected(table_name, constraint_name)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = format('public.%I', v_constraint.table_name)::pg_catalog.regclass
        and constraint_row.conname = v_constraint.constraint_name
        and constraint_row.contype = 'f'
        and constraint_row.confrelid = 'public.commercial_opportunities'::pg_catalog.regclass
        and constraint_row.convalidated
        and constraint_row.confmatchtype = 's'
        and constraint_row.confupdtype = 'a'
        and constraint_row.confdeltype = 'r'
        and constraint_row.condeferrable is false
        and constraint_row.condeferred is false
        and constraint_row.conkey = array[
          (
            select attnum
            from pg_catalog.pg_attribute
            where attrelid = format('public.%I', v_constraint.table_name)::pg_catalog.regclass
              and attname = 'commercial_opportunity_id'
              and not attisdropped
          ),
          (
            select attnum
            from pg_catalog.pg_attribute
            where attrelid = format('public.%I', v_constraint.table_name)::pg_catalog.regclass
              and attname = 'organization_id'
              and not attisdropped
          ),
          (
            select attnum
            from pg_catalog.pg_attribute
            where attrelid = format('public.%I', v_constraint.table_name)::pg_catalog.regclass
              and attname = 'store_id'
              and not attisdropped
          )
        ]::smallint[]
        and constraint_row.confkey = array[
          (
            select attnum
            from pg_catalog.pg_attribute
            where attrelid = 'public.commercial_opportunities'::pg_catalog.regclass
              and attname = 'id'
              and not attisdropped
          ),
          (
            select attnum
            from pg_catalog.pg_attribute
            where attrelid = 'public.commercial_opportunities'::pg_catalog.regclass
              and attname = 'organization_id'
              and not attisdropped
          ),
          (
            select attnum
            from pg_catalog.pg_attribute
            where attrelid = 'public.commercial_opportunities'::pg_catalog.regclass
              and attname = 'store_id'
              and not attisdropped
          )
        ]::smallint[]
    ) then
      raise exception using
        errcode = 'P0001',
        message = format(
          'postcondition failed: public.%s %s contract mismatch',
          v_constraint.table_name,
          v_constraint.constraint_name
        );
    end if;
  end loop;
end;
$postflight$;

drop function if exists pg_temp.describe_index_contract(
  text,
  text,
  text,
  text,
  text,
  boolean,
  boolean,
  integer,
  integer,
  text[]
);

commit;

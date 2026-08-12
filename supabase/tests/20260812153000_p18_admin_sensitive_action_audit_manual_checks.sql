create temp table pg_temp._p18_admin_audit_matrix (
  scenario_number integer primary key,
  scenario_name text not null
);

insert into pg_temp._p18_admin_audit_matrix (scenario_number, scenario_name)
values
  (1, 'audit table exists'),
  (2, 'audit columns exist with expected nullability'),
  (3, 'audit table has RLS enabled'),
  (4, 'audit outcome constraint exists'),
  (5, 'audit action constraint exists'),
  (6, 'audit metadata object constraint exists'),
  (7, 'operation_id index exists for investigation ordering'),
  (8, 'anon has no direct DML or select'),
  (9, 'authenticated has no direct DML or select'),
  (10, 'service_role has insert and select only'),
  (11, 'service_role does not have update or delete'),
  (12, 'append-only structure rejects invalid outcome');

create temp table pg_temp._p18_admin_audit_results (
  scenario_number integer primary key,
  scenario_name text not null,
  status text not null,
  details text not null
);

create or replace function pg_temp._p18_admin_audit_record(
  p_scenario_number integer,
  p_status text,
  p_details text
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp._p18_admin_audit_results (
    scenario_number,
    scenario_name,
    status,
    details
  )
  values (
    p_scenario_number,
    (
      select matrix_row.scenario_name
      from pg_temp._p18_admin_audit_matrix matrix_row
      where matrix_row.scenario_number = p_scenario_number
    ),
    p_status,
    p_details
  )
  on conflict (scenario_number) do update
  set status = excluded.status,
      details = excluded.details;
end;
$function$;

create or replace function pg_temp._p18_admin_audit_require(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
as $function$
begin
  if coalesce(p_condition, false) is not true then
    raise exception using
      errcode = 'P0001',
      message = 'HARNESS_ERROR: ' || p_message;
  end if;
end;
$function$;

create or replace function pg_temp._p18_admin_audit_record_exception(
  p_scenario_number integer,
  p_error_message text
)
returns void
language plpgsql
as $function$
declare
  v_status text;
  v_details text;
begin
  if p_error_message like 'HARNESS_ERROR: %' then
    v_status := 'HARNESS_ERROR';
    v_details := substring(p_error_message from 16);
  else
    v_status := 'SUT_FAIL';
    v_details := p_error_message;
  end if;

  perform pg_temp._p18_admin_audit_record(
    p_scenario_number,
    v_status,
    coalesce(v_details, '<null>')
  );
end;
$function$;

do $scenario$
begin
  perform pg_temp._p18_admin_audit_require(
    pg_catalog.to_regclass('public.zion_admin_audit_events') is not null,
    'public.zion_admin_audit_events is required'
  );

  perform pg_temp._p18_admin_audit_record(
    1,
    'PASS',
    'audit table is present'
  );
exception
  when others then
    perform pg_temp._p18_admin_audit_record_exception(1, sqlerrm);
end;
$scenario$;

do $scenario$
declare
  v_missing_count integer;
begin
  select count(*)
  into v_missing_count
  from (
    values
      ('id', false),
      ('operation_id', false),
      ('created_at', false),
      ('actor_user_id', false),
      ('action', false),
      ('target_type', false),
      ('target_id', true),
      ('organization_id', true),
      ('store_id', true),
      ('outcome', false),
      ('metadata', false)
  ) as expected(column_name, is_nullable)
  where not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'zion_admin_audit_events'
      and column_row.column_name = expected.column_name
      and column_row.is_nullable =
        case
          when expected.is_nullable then 'YES'
          else 'NO'
        end
  );

  perform pg_temp._p18_admin_audit_require(
    v_missing_count = 0,
    format('expected audit columns are missing or nullable mismatch count=%s', v_missing_count)
  );

  perform pg_temp._p18_admin_audit_record(
    2,
    'PASS',
    'audit columns and nullability match the contract'
  );
exception
  when others then
    perform pg_temp._p18_admin_audit_record_exception(2, sqlerrm);
end;
$scenario$;

do $scenario$
declare
  v_rls_enabled boolean;
begin
  select class_row.relrowsecurity
  into v_rls_enabled
  from pg_catalog.pg_class class_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = class_row.relnamespace
  where namespace_row.nspname = 'public'
    and class_row.relname = 'zion_admin_audit_events';

  perform pg_temp._p18_admin_audit_require(
    v_rls_enabled is true,
    'audit table must have RLS enabled'
  );

  perform pg_temp._p18_admin_audit_record(
    3,
    'PASS',
    'audit table has row level security enabled'
  );
exception
  when others then
    perform pg_temp._p18_admin_audit_record_exception(3, sqlerrm);
end;
$scenario$;

do $scenario$
begin
  perform pg_temp._p18_admin_audit_require(
    exists (
      select 1
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = 'public.zion_admin_audit_events'::regclass
        and constraint_row.conname = 'zion_admin_audit_events_outcome_check'
        and pg_catalog.pg_get_constraintdef(constraint_row.oid) ilike '%outcome%'
        and pg_catalog.pg_get_constraintdef(constraint_row.oid) ilike '%started%'
        and pg_catalog.pg_get_constraintdef(constraint_row.oid) ilike '%success%'
        and pg_catalog.pg_get_constraintdef(constraint_row.oid) ilike '%failed%'
        and pg_catalog.pg_get_constraintdef(constraint_row.oid) ilike '%denied%'
    ),
    'missing outcome constraint'
  );

  perform pg_temp._p18_admin_audit_record(4, 'PASS', 'outcome constraint is present');
exception
  when others then
    perform pg_temp._p18_admin_audit_record_exception(4, sqlerrm);
end;
$scenario$;

do $scenario$
begin
  perform pg_temp._p18_admin_audit_require(
    exists (
      select 1
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = 'public.zion_admin_audit_events'::regclass
        and constraint_row.conname = 'zion_admin_audit_events_action_check'
        and pg_catalog.pg_get_constraintdef(constraint_row.oid) ilike '%account.create%'
        and pg_catalog.pg_get_constraintdef(constraint_row.oid) ilike '%store.reactivate%'
    ),
    'missing action constraint'
  );

  perform pg_temp._p18_admin_audit_record(5, 'PASS', 'action constraint is present');
exception
  when others then
    perform pg_temp._p18_admin_audit_record_exception(5, sqlerrm);
end;
$scenario$;

do $scenario$
begin
  perform pg_temp._p18_admin_audit_require(
    exists (
      select 1
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = 'public.zion_admin_audit_events'::regclass
        and constraint_row.conname = 'zion_admin_audit_events_metadata_object_check'
        and pg_catalog.pg_get_constraintdef(constraint_row.oid) ilike '%jsonb_typeof(metadata)%'
    ),
    'missing metadata object constraint'
  );

  perform pg_temp._p18_admin_audit_record(6, 'PASS', 'metadata object constraint is present');
exception
  when others then
    perform pg_temp._p18_admin_audit_record_exception(6, sqlerrm);
end;
$scenario$;

do $scenario$
begin
  perform pg_temp._p18_admin_audit_require(
    exists (
      select 1
      from pg_catalog.pg_indexes index_row
      where index_row.schemaname = 'public'
        and index_row.tablename = 'zion_admin_audit_events'
        and index_row.indexname = 'zion_admin_audit_events_operation_id_created_at_idx'
        and index_row.indexdef ilike '%operation_id%'
        and index_row.indexdef ilike '%created_at%'
    ),
    'missing operation_id created_at investigation index'
  );

  perform pg_temp._p18_admin_audit_record(7, 'PASS', 'operation_id investigation index is present');
exception
  when others then
    perform pg_temp._p18_admin_audit_record_exception(7, sqlerrm);
end;
$scenario$;

do $scenario$
begin
  perform pg_temp._p18_admin_audit_require(
    not pg_catalog.has_table_privilege('anon', 'public.zion_admin_audit_events', 'SELECT')
    and not pg_catalog.has_table_privilege('anon', 'public.zion_admin_audit_events', 'INSERT')
    and not pg_catalog.has_table_privilege('anon', 'public.zion_admin_audit_events', 'UPDATE')
    and not pg_catalog.has_table_privilege('anon', 'public.zion_admin_audit_events', 'DELETE'),
    'anon must not have direct audit privileges'
  );

  perform pg_temp._p18_admin_audit_record(8, 'PASS', 'anon has no direct audit privileges');
exception
  when others then
    perform pg_temp._p18_admin_audit_record_exception(8, sqlerrm);
end;
$scenario$;

do $scenario$
begin
  perform pg_temp._p18_admin_audit_require(
    not pg_catalog.has_table_privilege('authenticated', 'public.zion_admin_audit_events', 'SELECT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.zion_admin_audit_events', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.zion_admin_audit_events', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.zion_admin_audit_events', 'DELETE'),
    'authenticated must not have direct audit privileges'
  );

  perform pg_temp._p18_admin_audit_record(9, 'PASS', 'authenticated has no direct audit privileges');
exception
  when others then
    perform pg_temp._p18_admin_audit_record_exception(9, sqlerrm);
end;
$scenario$;

do $scenario$
begin
  perform pg_temp._p18_admin_audit_require(
    pg_catalog.has_table_privilege('service_role', 'public.zion_admin_audit_events', 'SELECT')
    and pg_catalog.has_table_privilege('service_role', 'public.zion_admin_audit_events', 'INSERT')
    ,
    'service_role must have select and insert'
  );

  perform pg_temp._p18_admin_audit_record(10, 'PASS', 'service_role has select and insert');
exception
  when others then
    perform pg_temp._p18_admin_audit_record_exception(10, sqlerrm);
end;
$scenario$;

do $scenario$
begin
  perform pg_temp._p18_admin_audit_require(
    not pg_catalog.has_table_privilege('service_role', 'public.zion_admin_audit_events', 'UPDATE')
    and not pg_catalog.has_table_privilege('service_role', 'public.zion_admin_audit_events', 'DELETE'),
    'service_role must not have update or delete'
  );

  perform pg_temp._p18_admin_audit_record(11, 'PASS', 'service_role has no update or delete');
exception
  when others then
    perform pg_temp._p18_admin_audit_record_exception(11, sqlerrm);
end;
$scenario$;

do $scenario$
declare
  v_constraint_def text;
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
  into v_constraint_def
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.zion_admin_audit_events'::regclass
    and constraint_row.conname = 'zion_admin_audit_events_outcome_check';

  perform pg_temp._p18_admin_audit_require(
    coalesce(v_constraint_def, '') not ilike '%unknown%',
    'outcome constraint unexpectedly allows arbitrary values'
  );

  perform pg_temp._p18_admin_audit_record(12, 'PASS', 'append-only outcome constraint rejects invalid values');
exception
  when others then
    perform pg_temp._p18_admin_audit_record_exception(12, sqlerrm);
end;
$scenario$;

select
  matrix_row.scenario_number,
  matrix_row.scenario_name,
  coalesce(result_row.status, 'NOT_RUN') as status,
  coalesce(result_row.details, 'scenario did not execute') as details
from pg_temp._p18_admin_audit_matrix matrix_row
left join pg_temp._p18_admin_audit_results result_row
  on result_row.scenario_number = matrix_row.scenario_number
order by matrix_row.scenario_number;

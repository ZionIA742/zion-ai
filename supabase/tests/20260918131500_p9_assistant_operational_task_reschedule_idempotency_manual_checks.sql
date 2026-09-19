-- P9 / Bloco 5 / Etapa 5.5.6
-- Manual checks:
-- Assistant operational reschedule task idempotency.

do $check$
declare
  v_index_definition text;
begin
  select pg_catalog.pg_get_indexdef(index_row.indexrelid)
    into v_index_definition
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_class
    on index_class.oid = index_row.indexrelid
  join pg_catalog.pg_namespace index_namespace
    on index_namespace.oid = index_class.relnamespace
  where index_namespace.nspname = 'public'
    and index_class.relname =
      'store_assistant_operational_tasks_reschedule_operation_key_uidx'
    and index_row.indrelid =
      'public.store_assistant_operational_tasks'::pg_catalog.regclass
    and index_row.indisunique is true
    and index_row.indisvalid is true
    and index_row.indisready is true;

  if v_index_definition is null then
    raise exception
      'P9_CHECK_FAILED: unique reschedule operation_key index is missing or invalid';
  end if;

  if position('organization_id' in v_index_definition) = 0
     or position('store_id' in v_index_definition) = 0
     or position('operation_key' in v_index_definition) = 0 then
    raise exception
      'P9_CHECK_FAILED: unique reschedule operation_key index has unexpected key definition: %',
      v_index_definition;
  end if;

  if position('appointment_reschedule_with_customer' in v_index_definition) = 0
     or position('appointment_reschedule_find_customer_availability' in v_index_definition) = 0 then
    raise exception
      'P9_CHECK_FAILED: unique reschedule operation_key index has unexpected predicate: %',
      v_index_definition;
  end if;

  if exists (
    select 1
    from public.store_assistant_operational_tasks task_row
    where task_row.task_type in (
      'appointment_reschedule_with_customer',
      'appointment_reschedule_find_customer_availability'
    )
      and nullif(
        pg_catalog.btrim(task_row.task_payload ->> 'operation_key'),
        ''
      ) is not null
    group by
      task_row.organization_id,
      task_row.store_id,
      pg_catalog.btrim(task_row.task_payload ->> 'operation_key')
    having count(*) > 1
  ) then
    raise exception
      'P9_CHECK_FAILED: duplicate reschedule operation_key exists';
  end if;
end;
$check$;
begin;

-- P9 / Bloco 5 / Etapa 5.5.6
--
-- Durable idempotency guard for Assistant operational reschedule flows.
--
-- The application writes a deterministic operation_key inside task_payload
-- for:
--   - appointment_reschedule_with_customer
--   - appointment_reschedule_find_customer_availability
--
-- Runtime lookup/dedupe alone is not sufficient under true concurrency:
-- two concurrent requests could both observe no existing task and then both
-- insert. This partial unique index makes the operation key authoritative at
-- the database boundary.
--
-- Scope:
--   organization_id + store_id + normalized operation_key
--
-- task_type is intentionally NOT part of the unique key so the same logical
-- operation cannot escape dedupe by being materialized under either supported
-- reschedule task type.
--
-- status is intentionally NOT part of the unique key. Once an operation key
-- has been consumed, resolved/cancelled/failed history remains idempotent and
-- cannot be recreated as a new logical operation.

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'p9_assistant_operational_task_reschedule_operation_key_uniqueness',
    0
  )
);

do $preflight$
begin
  if pg_catalog.to_regclass(
    'public.store_assistant_operational_tasks'
  ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: public.store_assistant_operational_tasks is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'store_assistant_operational_tasks'
      and column_row.column_name = 'task_payload'
      and column_row.udt_name = 'jsonb'
      and column_row.is_nullable = 'NO'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'precondition failed: store_assistant_operational_tasks.task_payload must be jsonb not null';
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
    raise exception using
      errcode = '23505',
      message = 'precondition failed: duplicate reschedule operational task operation_key already exists';
  end if;
end;
$preflight$;

create unique index if not exists
  store_assistant_operational_tasks_reschedule_operation_key_uidx
on public.store_assistant_operational_tasks (
  organization_id,
  store_id,
  (
    pg_catalog.btrim(
      task_payload ->> 'operation_key'
    )
  )
)
where task_type in (
  'appointment_reschedule_with_customer',
  'appointment_reschedule_find_customer_availability'
)
and nullif(
  pg_catalog.btrim(task_payload ->> 'operation_key'),
  ''
) is not null;

do $postflight$
begin
  if not exists (
    select 1
    from pg_catalog.pg_class index_class
    join pg_catalog.pg_namespace index_namespace
      on index_namespace.oid = index_class.relnamespace
    join pg_catalog.pg_index index_row
      on index_row.indexrelid = index_class.oid
    where index_namespace.nspname = 'public'
      and index_class.relname =
        'store_assistant_operational_tasks_reschedule_operation_key_uidx'
      and index_row.indrelid =
        'public.store_assistant_operational_tasks'::pg_catalog.regclass
      and index_row.indisunique is true
      and index_row.indisvalid is true
      and index_row.indisready is true
      and index_row.indexprs is not null
      and index_row.indpred is not null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'postcondition failed: reschedule operational task operation_key unique index contract mismatch';
  end if;
end;
$postflight$;

commit;
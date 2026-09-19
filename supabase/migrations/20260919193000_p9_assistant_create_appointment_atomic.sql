begin;

-- P9 / Bloco 5 / Etapa 5.5.6

--

-- Atomic appointment creation for appointment_create_with_customer.

--

-- Guarantees:

-- - durable CREATE operation_key uniqueness;

-- - service-role-only system writer;

-- - exact task / tenant / identity / window validation;
-- - durable customer authority required before the write (confirmed target or explicit available counterproposal);
-- - canonical appointment title read from task_payload;

-- - fail-closed canonical service Settings;

-- - canonical availability revalidation;

-- - appointment creation through the existing commercial-context writer;

-- - related_appointment_id + first post-write markers committed in the

--   same transaction as the appointment;

-- - replay returns the exact existing appointment instead of creating another.

select pg_catalog.pg_advisory_xact_lock(

  pg_catalog.hashtextextended(

    'p9:assistant:create_appointment_atomic:migration',

    0

  )

);

do $preflight$

declare

  v_missing_column text;

begin

  if pg_catalog.to_regclass(

    'public.store_assistant_operational_tasks'

  ) is null then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: public.store_assistant_operational_tasks is missing';

  end if;

  if pg_catalog.to_regclass(

    'public.store_appointments'

  ) is null then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: public.store_appointments is missing';

  end if;

  if pg_catalog.to_regclass(

    'public.store_operation_settings'

  ) is null then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: public.store_operation_settings is missing';

  end if;

  foreach v_missing_column in array array[

    'id',

    'organization_id',

    'store_id',

    'task_type',

    'status',

    'title',

    'related_lead_id',

    'related_conversation_id',

    'related_appointment_id',

    'customer_name',

    'customer_phone',

    'target_start_at',

    'target_end_at',

    'task_payload',

    'commercial_opportunity_id'

  ] loop

    if not exists (

      select 1

      from information_schema.columns column_row

      where column_row.table_schema = 'public'

        and column_row.table_name = 'store_assistant_operational_tasks'

        and column_row.column_name = v_missing_column

    ) then

      raise exception using

        errcode = 'P0001',

        message = pg_catalog.format(

          'precondition failed: store_assistant_operational_tasks.%s is missing',

          v_missing_column

        );

    end if;

  end loop;

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

  if not exists (

    select 1

    from information_schema.columns column_row

    where column_row.table_schema = 'public'

      and column_row.table_name = 'store_operation_settings'

      and column_row.column_name = 'offers_technical_visit'

      and column_row.udt_name = 'bool'

  ) then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: store_operation_settings.offers_technical_visit is missing';

  end if;

  if not exists (

    select 1

    from information_schema.columns column_row

    where column_row.table_schema = 'public'

      and column_row.table_name = 'store_operation_settings'

      and column_row.column_name = 'offers_installation'

      and column_row.udt_name = 'bool'

  ) then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: store_operation_settings.offers_installation is missing';

  end if;

  if pg_catalog.to_regprocedure(

    'public.create_store_appointment_with_commercial_context(uuid,uuid,uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,uuid,uuid)'

  ) is null then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: canonical commercial appointment writer is missing';

  end if;

  if pg_catalog.to_regprocedure(

    'public.check_store_appointment_availability_by_system(uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid)'

  ) is null then

    raise exception using

      errcode = 'P0001',

      message = 'precondition failed: canonical appointment availability reader is missing';

  end if;

  if exists (

    select 1

    from public.store_assistant_operational_tasks task_row

    where task_row.task_type = 'appointment_create_with_customer'

      and nullif(

        pg_catalog.btrim(task_row.task_payload ->> 'operation_key'),

        ''

      ) is not null

    group by

      task_row.organization_id,

      task_row.store_id,

      pg_catalog.btrim(task_row.task_payload ->> 'operation_key')

    having pg_catalog.count(*) > 1

  ) then

    raise exception using

      errcode = '23505',

      message = 'precondition failed: duplicate CREATE operational task operation_key already exists';

  end if;

end;

$preflight$;

create unique index if not exists

  store_assistant_operational_tasks_create_operation_key_uidx

on public.store_assistant_operational_tasks (

  organization_id,

  store_id,

  (

    pg_catalog.btrim(

      task_payload ->> 'operation_key'

    )

  )

)

where task_type = 'appointment_create_with_customer'

  and nullif(

    pg_catalog.btrim(task_payload ->> 'operation_key'),

    ''

  ) is not null;

create or replace function public.create_assistant_appointment_by_task_atomic(

  p_task_id uuid,

  p_organization_id uuid,

  p_store_id uuid,

  p_expected_operation_key text,

  p_expected_lead_id uuid,

  p_expected_conversation_id uuid,

  p_expected_commercial_opportunity_id uuid,

  p_expected_appointment_type text,

  p_expected_start_at timestamp with time zone,

  p_expected_end_at timestamp with time zone

)

returns public.store_appointments

language plpgsql

security definer

set search_path = pg_catalog, public, pg_temp

set row_security = off

as $function$

declare

  v_request_role text :=

    coalesce(

      nullif(

        pg_catalog.current_setting('request.jwt.claim.role', true),

        ''

      ),

      nullif(auth.jwt() ->> 'role', '')

    );

  v_task public.store_assistant_operational_tasks%rowtype;

  v_existing public.store_appointments;

  v_created public.store_appointments;

  v_operation_key text;

  v_appointment_type text;

  v_appointment_title text;

  v_write_succeeded boolean := false;

  v_settings_count bigint;

  v_offers_technical_visit boolean;

  v_offers_installation boolean;

  v_available boolean;

  v_reason_code text;

begin

  if v_request_role <> 'service_role'

     and session_user <> 'postgres' then

    raise exception using

      errcode = '42501',

      message = 'ZION_ASSISTANT_CREATE_APPOINTMENT_NOT_AUTHORIZED';

  end if;

  if p_task_id is null

     or p_organization_id is null

     or p_store_id is null then

    raise exception using

      errcode = '22004',

      message = 'ZION_ASSISTANT_CREATE_APPOINTMENT_SCOPE_REQUIRED';

  end if;

  if p_expected_lead_id is null

     or p_expected_conversation_id is null

     or p_expected_start_at is null

     or p_expected_end_at is null then

    raise exception using

      errcode = '22004',

      message = 'ZION_ASSISTANT_CREATE_APPOINTMENT_EXPECTED_IDENTITY_REQUIRED';

  end if;

  if p_expected_end_at <= p_expected_start_at then

    raise exception using

      errcode = '22007',

      message = 'ZION_ASSISTANT_CREATE_APPOINTMENT_INVALID_WINDOW';

  end if;

  v_operation_key :=

    nullif(

      pg_catalog.btrim(

        coalesce(p_expected_operation_key, '')

      ),

      ''

    );

  if v_operation_key is null then

    raise exception using

      errcode = '22004',

      message = 'ZION_ASSISTANT_CREATE_APPOINTMENT_OPERATION_KEY_REQUIRED';

  end if;

  if p_expected_appointment_type not in (

    'technical_visit',

    'installation'

  ) then

    raise exception using

      errcode = '23514',

      message = 'ZION_ASSISTANT_CREATE_APPOINTMENT_TYPE_NOT_ALLOWED';

  end if;

  select task_row.*

  into v_task

  from public.store_assistant_operational_tasks task_row

  where task_row.id = p_task_id

    and task_row.organization_id = p_organization_id

    and task_row.store_id = p_store_id

  for update;

  if not found then

    raise exception using

      errcode = 'P0002',

      message = 'ZION_ASSISTANT_CREATE_TASK_NOT_FOUND';

  end if;

  if v_task.task_type <> 'appointment_create_with_customer' then

    raise exception using

      errcode = '23514',

      message = 'ZION_ASSISTANT_CREATE_TASK_TYPE_MISMATCH';

  end if;

  if nullif(

       pg_catalog.btrim(v_task.task_payload ->> 'operation_key'),

       ''

     ) is distinct from v_operation_key then

    raise exception using

      errcode = '23514',

      message = 'ZION_ASSISTANT_CREATE_OPERATION_KEY_MISMATCH';

  end if;

  if v_task.related_lead_id is distinct from p_expected_lead_id

     or v_task.related_conversation_id is distinct from p_expected_conversation_id

     or v_task.commercial_opportunity_id is distinct from p_expected_commercial_opportunity_id

     or v_task.target_start_at is distinct from p_expected_start_at

     or v_task.target_end_at is distinct from p_expected_end_at then

    raise exception using

      errcode = '23514',

      message = 'ZION_ASSISTANT_CREATE_TASK_IDENTITY_OR_WINDOW_MISMATCH';

  end if;

  v_appointment_type :=

    nullif(

      pg_catalog.btrim(v_task.task_payload ->> 'appointment_type'),

      ''

    );

  if v_appointment_type is distinct from p_expected_appointment_type then

    raise exception using

      errcode = '23514',

      message = 'ZION_ASSISTANT_CREATE_APPOINTMENT_TYPE_MISMATCH';

  end if;

  if pg_catalog.jsonb_typeof(

       v_task.task_payload -> 'appointment_write_succeeded'

     ) = 'boolean' then

    v_write_succeeded :=

      (v_task.task_payload ->> 'appointment_write_succeeded')::boolean;

  end if;

  -- Idempotent replay after the atomic write.

  if v_write_succeeded is true

     or v_task.related_appointment_id is not null then

    if v_write_succeeded is not true

       or v_task.related_appointment_id is null then

      raise exception using

        errcode = '23514',

        message = 'ZION_ASSISTANT_CREATE_POST_WRITE_MARKER_INCONSISTENT';

    end if;

    if v_task.task_payload ->> 'appointment_id'

       is distinct from v_task.related_appointment_id::text

       or pg_catalog.jsonb_typeof(

            v_task.task_payload -> 'agenda_updated'

          ) is distinct from 'boolean'

       or (v_task.task_payload ->> 'agenda_updated')::boolean is not true

       or pg_catalog.jsonb_typeof(

            v_task.task_payload -> 'atomic_appointment_write_completed'

          ) is distinct from 'boolean'

       or (v_task.task_payload ->> 'atomic_appointment_write_completed')::boolean is not true then

      raise exception using

        errcode = '23514',

        message = 'ZION_ASSISTANT_CREATE_POST_WRITE_MARKER_INCONSISTENT';

    end if;

    select appointment_row.*

    into v_existing

    from public.store_appointments appointment_row

    where appointment_row.id = v_task.related_appointment_id

      and appointment_row.organization_id = p_organization_id

      and appointment_row.store_id = p_store_id

    for key share;

    if not found then

      raise exception using

        errcode = '23503',

        message = 'ZION_ASSISTANT_CREATE_MARKED_APPOINTMENT_NOT_FOUND';

    end if;

    if v_existing.lead_id is distinct from p_expected_lead_id

       or v_existing.conversation_id is distinct from p_expected_conversation_id

       or v_existing.commercial_opportunity_id is distinct from p_expected_commercial_opportunity_id

       or v_existing.appointment_type is distinct from p_expected_appointment_type

       or v_existing.scheduled_start is distinct from p_expected_start_at

       or v_existing.scheduled_end is distinct from p_expected_end_at then

      raise exception using

        errcode = '23514',

        message = 'ZION_ASSISTANT_CREATE_MARKED_APPOINTMENT_MISMATCH';

    end if;

    if v_existing.status <> 'scheduled' then

      raise exception using

        errcode = '23514',

        message = 'ZION_ASSISTANT_CREATE_MARKED_APPOINTMENT_NOT_SCHEDULED';

    end if;

    return v_existing;

  end if;

  if v_task.status <> 'waiting_customer_response' then

    raise exception using

      errcode = '23514',

      message = 'ZION_ASSISTANT_CREATE_TASK_NOT_WAITING_CUSTOMER_RESPONSE';

  end if;

  v_appointment_title :=
    nullif(
      pg_catalog.btrim(v_task.task_payload ->> 'title'),
      ''
    );

  if v_appointment_title is null then
    raise exception using
      errcode = '23514',
      message = 'ZION_ASSISTANT_CREATE_APPOINTMENT_TITLE_REQUIRED';
  end if;

  if nullif(
       pg_catalog.btrim(v_task.task_payload ->> 'last_customer_reply_decision_type'),
       ''
     ) not in ('confirmed', 'suggested_other_time')
     or nullif(
          pg_catalog.btrim(v_task.task_payload ->> 'last_customer_reply_message_id'),
          ''
        ) is null
     or nullif(
          pg_catalog.btrim(v_task.task_payload ->> 'last_processed_queue_id'),
          ''
        ) is null
     or nullif(
          pg_catalog.btrim(v_task.task_payload ->> 'last_processed_conversation_id'),
          ''
        ) is null then
    raise exception using
      errcode = '23514',
      message = 'ZION_ASSISTANT_CREATE_CUSTOMER_CONFIRMATION_REQUIRED';
  end if;

  if pg_catalog.btrim(
       v_task.task_payload ->> 'last_processed_conversation_id'
     ) is distinct from v_task.related_conversation_id::text then
    raise exception using
      errcode = '23514',
      message = 'ZION_ASSISTANT_CREATE_CUSTOMER_CONFIRMATION_CONTEXT_MISMATCH';
  end if;

  if pg_catalog.btrim(
       v_task.task_payload ->> 'last_customer_reply_decision_type'
     ) = 'suggested_other_time' then
    if pg_catalog.jsonb_typeof(
         v_task.task_payload -> 'suggested_time_available'
       ) is distinct from 'boolean'
       or (v_task.task_payload ->> 'suggested_time_available')::boolean is not true
       or nullif(
            pg_catalog.btrim(v_task.task_payload ->> 'suggested_start_at'),
            ''
          ) is null
       or nullif(
            pg_catalog.btrim(v_task.task_payload ->> 'suggested_end_at'),
            ''
          ) is null
       or (v_task.task_payload ->> 'suggested_start_at')::timestamp with time zone
            is distinct from p_expected_start_at
       or (v_task.task_payload ->> 'suggested_end_at')::timestamp with time zone
            is distinct from p_expected_end_at then
      raise exception using
        errcode = '23514',
        message = 'ZION_ASSISTANT_CREATE_CUSTOMER_SUGGESTED_WINDOW_NOT_AUTHORIZED';
    end if;
  end if;

  if p_expected_appointment_type = 'technical_visit'

     and p_expected_commercial_opportunity_id is null then

    raise exception using

      errcode = '23514',

      message = 'ZION_ASSISTANT_CREATE_TECHNICAL_VISIT_OPPORTUNITY_REQUIRED';

  end if;

  if p_expected_appointment_type = 'technical_visit'

     and not exists (

       select 1

       from public.commercial_opportunities opportunity_row

       where opportunity_row.id = p_expected_commercial_opportunity_id

         and opportunity_row.organization_id = p_organization_id

         and opportunity_row.store_id = p_store_id

         and opportunity_row.origin_lead_id = p_expected_lead_id

         and opportunity_row.primary_conversation_id = p_expected_conversation_id

     ) then

    raise exception using

      errcode = '23514',

      message = 'ZION_ASSISTANT_CREATE_TECHNICAL_VISIT_OPPORTUNITY_MISMATCH';

  end if;

  select

    pg_catalog.count(*),

    pg_catalog.bool_and(settings_row.offers_technical_visit is true),

    pg_catalog.bool_and(settings_row.offers_installation is true)

  into

    v_settings_count,

    v_offers_technical_visit,

    v_offers_installation

  from public.store_operation_settings settings_row

  where settings_row.organization_id = p_organization_id

    and settings_row.store_id = p_store_id;

  if v_settings_count <> 1 then

    raise exception using

      errcode = '23514',

      message = 'ZION_ASSISTANT_CREATE_OPERATION_SETTINGS_NOT_CANONICAL';

  end if;

  if p_expected_appointment_type = 'technical_visit'

     and v_offers_technical_visit is not true then

    raise exception using

      errcode = '23514',

      message = 'ZION_ASSISTANT_CREATE_TECHNICAL_VISIT_DISABLED';

  end if;

  if p_expected_appointment_type = 'installation'

     and v_offers_installation is not true then

    raise exception using

      errcode = '23514',

      message = 'ZION_ASSISTANT_CREATE_INSTALLATION_DISABLED';

  end if;

  select availability_row.available, availability_row.reason_code

  into v_available, v_reason_code

  from public.check_store_appointment_availability_by_system(

    p_organization_id,

    p_store_id,

    p_expected_appointment_type,

    p_expected_start_at,

    p_expected_end_at,

    null

  ) availability_row;

  if v_available is not true then

    raise exception using

      errcode = '23514',

      message =

        'ZION_ASSISTANT_CREATE_APPOINTMENT_UNAVAILABLE:' ||

        coalesce(v_reason_code, 'unknown');

  end if;

  select *

  into v_created

  from public.create_store_appointment_with_commercial_context(

    p_organization_id,

    p_store_id,

    p_expected_lead_id,

    p_expected_conversation_id,

    v_appointment_title,

    p_expected_appointment_type,

    'scheduled',

    p_expected_start_at,

    p_expected_end_at,

    v_task.customer_name,

    v_task.customer_phone,

    nullif(

      pg_catalog.btrim(v_task.task_payload ->> 'address_text'),

      ''

    ),

    'Criado pela assistente apos confirmacao do cliente.',

    'ai_operator',

    null,

    p_expected_commercial_opportunity_id

  );

  if v_created.id is null then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_ASSISTANT_CREATE_APPOINTMENT_WRITER_RETURNED_NO_ID';

  end if;

  if v_created.organization_id is distinct from p_organization_id

     or v_created.store_id is distinct from p_store_id

     or v_created.lead_id is distinct from p_expected_lead_id

     or v_created.conversation_id is distinct from p_expected_conversation_id

     or v_created.commercial_opportunity_id is distinct from p_expected_commercial_opportunity_id

     or v_created.appointment_type is distinct from p_expected_appointment_type

     or v_created.scheduled_start is distinct from p_expected_start_at

     or v_created.scheduled_end is distinct from p_expected_end_at

     or v_created.status <> 'scheduled' then

    raise exception using

      errcode = '23514',

      message = 'ZION_ASSISTANT_CREATE_APPOINTMENT_WRITER_RESULT_MISMATCH';

  end if;

  update public.store_assistant_operational_tasks task_row

  set

    related_appointment_id = v_created.id,

    task_payload =

      coalesce(task_row.task_payload, '{}'::jsonb)

      ||

      pg_catalog.jsonb_build_object(

        'appointment_id', v_created.id,

        'appointment_write_succeeded', true,

        'agenda_updated', true,

        'appointment_created_at', v_created.created_at,

        'atomic_appointment_write_completed', true

      ),

    last_action_at = pg_catalog.transaction_timestamp(),

    updated_at = pg_catalog.transaction_timestamp()

  where task_row.id = p_task_id

    and task_row.organization_id = p_organization_id

    and task_row.store_id = p_store_id;

  if not found then

    raise exception using

      errcode = 'P0001',

      message = 'ZION_ASSISTANT_CREATE_TASK_ATOMIC_MARKER_UPDATE_FAILED';

  end if;

  return v_created;

end;

$function$;

alter function public.create_assistant_appointment_by_task_atomic(

  uuid,

  uuid,

  uuid,

  text,

  uuid,

  uuid,

  uuid,

  text,

  timestamp with time zone,

  timestamp with time zone

) owner to postgres;

revoke all on function public.create_assistant_appointment_by_task_atomic(

  uuid,

  uuid,

  uuid,

  text,

  uuid,

  uuid,

  uuid,

  text,

  timestamp with time zone,

  timestamp with time zone

) from public;

revoke all on function public.create_assistant_appointment_by_task_atomic(

  uuid,

  uuid,

  uuid,

  text,

  uuid,

  uuid,

  uuid,

  text,

  timestamp with time zone,

  timestamp with time zone

) from anon;

revoke all on function public.create_assistant_appointment_by_task_atomic(

  uuid,

  uuid,

  uuid,

  text,

  uuid,

  uuid,

  uuid,

  text,

  timestamp with time zone,

  timestamp with time zone

) from authenticated;

grant execute on function public.create_assistant_appointment_by_task_atomic(

  uuid,

  uuid,

  uuid,

  text,

  uuid,

  uuid,

  uuid,

  text,

  timestamp with time zone,

  timestamp with time zone

) to service_role;

comment on function public.create_assistant_appointment_by_task_atomic(

  uuid,

  uuid,

  uuid,

  text,

  uuid,

  uuid,

  uuid,

  text,

  timestamp with time zone,

  timestamp with time zone

) is

  'P9 atomic CREATE authority for appointment_create_with_customer. Locks and validates the canonical task, requires durable customer authority (confirmed target or explicit available counterproposal), uses the canonical appointment title from task_payload, revalidates service Settings and agenda availability, creates at most one appointment, and commits the task post-write marker in the same transaction.';

do $postflight$

begin

  if pg_catalog.to_regprocedure(

    'public.create_assistant_appointment_by_task_atomic(uuid,uuid,uuid,text,uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone)'

  ) is null then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: atomic assistant appointment RPC is missing';

  end if;

  if not pg_catalog.has_function_privilege(

    'service_role',

    'public.create_assistant_appointment_by_task_atomic(uuid,uuid,uuid,text,uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone)',

    'EXECUTE'

  ) then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: service_role cannot execute atomic assistant appointment RPC';

  end if;

  if pg_catalog.has_function_privilege(

    'authenticated',

    'public.create_assistant_appointment_by_task_atomic(uuid,uuid,uuid,text,uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone)',

    'EXECUTE'

  ) then

    raise exception using

      errcode = 'P0001',

      message = 'postcondition failed: authenticated unexpectedly has atomic assistant appointment RPC execute';

  end if;

  if not exists (

    select 1

    from pg_catalog.pg_class index_class

    join pg_catalog.pg_namespace index_namespace

      on index_namespace.oid = index_class.relnamespace

    join pg_catalog.pg_index index_row

      on index_row.indexrelid = index_class.oid

    where index_namespace.nspname = 'public'

      and index_class.relname =

        'store_assistant_operational_tasks_create_operation_key_uidx'

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

      message = 'postcondition failed: CREATE operational task operation_key unique index contract mismatch';

  end if;

end;

$postflight$;

commit;

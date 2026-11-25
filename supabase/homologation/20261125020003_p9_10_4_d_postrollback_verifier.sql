-- Independent read-only P9 rollback verification.

do $p9_comprehensive_verification$
declare
  r record;
  v_oid oid;
  v_exists boolean;
  v_checked integer:=0;

  v_ids uuid[]:=array[
    '6ca982df-2439-4731-b268-602c84d15a95'::uuid,
    'd197c289-f78b-4bcb-948d-120600952018'::uuid,
    '4f80525a-53b3-4616-b66b-f1932f038703'::uuid,
    '4638313c-5cb6-49d0-86bc-26cfc16bf1d1'::uuid,
    '238f988a-6922-4537-b41b-efc432a1bfdb'::uuid,
    '9c5da80c-0e8e-4111-b70e-9d962325cb0b'::uuid,
    'fc1b4b18-0e21-45f2-8925-03996e58559c'::uuid,
    '37fa5ccc-8649-42fa-b799-0977d9b86e8e'::uuid,
    '757582d9-d8d6-4c55-b44f-9a97ca87ed1c'::uuid,
    '4f5743d7-2e2e-47a3-b001-e457594e9cf6'::uuid,
    '42e009aa-d137-409a-b75a-17ab07a4091f'::uuid,
    'f8f7e197-f7e2-4511-a970-3652945b2eb9'::uuid,
    '43f3d0ff-a3da-45a3-b4a2-8552ef0e20d7'::uuid,
    '5b404c9c-e8c7-4523-9365-ca07e988cab7'::uuid
  ];

begin
  if current_user<>'postgres'
     or session_user<>'postgres' then
    raise exception 'P9_VERIFICATION_ADMIN_REQUIRED';
  end if;

  -- Original function definitions must remain intact.

  for r in select * from (values
    ('public.private_acquire_sales_contract_conversation_xact_lock(uuid)','a5828f3d3d8a5ddb6bd5567106e02a5e'),
    ('public.claim_ai_run_queue_tasks_by_system(uuid,uuid,integer,text,integer,integer)','336804411a538f26856664a6b41ddd4b'),
    ('public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)','4d44f7b4a2ad6dd33d2806ae251d8e2e'),
    ('public.materialize_sales_ai_reply_set_by_worker_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,text,uuid,uuid,jsonb,jsonb,jsonb)','70ab29097ea4fb55be6d05afbac35492'),
    ('public.process_next_ai_run_queue(uuid)','d7c43290bce0c4dbc1d6b0f89c5fafeb'),
    ('public.enqueue_ai_run(uuid,uuid,uuid,uuid,jsonb)','219bb0ad93eac3b751543b81fad11b0c'),
    ('public.record_commercial_cross_sell_suggestion_by_system(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,jsonb)','0ef0eb3aa5dd58c8c6201309c0f628f9')
  ) x(signature,expected_md5)
  loop
    v_oid:=pg_catalog.to_regprocedure(r.signature);

    if v_oid is null or
       pg_catalog.md5(
         pg_catalog.pg_get_functiondef(v_oid)
       ) is distinct from r.expected_md5
    then
      raise exception
        'P9_ORIGINAL_FUNCTION_DRIFT:%',
        r.signature;
    end if;
  end loop;

  -- Candidate tables must not exist outside rehearsal.

  if to_regclass(
       'public.zion_p9_recovery_activation'
     ) is not null
  or to_regclass(
       'public.p9_recovery_followup_receipts'
     ) is not null
  then
    raise exception 'P9_CANDIDATE_TABLE_RESIDUE';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n
      on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
      'p9_10_4_d_recovery_enqueue_enabled',
      'p9_10_4_d_assert_recovery_write_authority',
      'p9_10_4_d_assert_recovery_set_claim_authority',
      'p9_10_4_d_assert_recovery_set_authority',
      'p9_10_4_d_transition_recovery_stage_by_system',
      'p9_10_4_d_write_recovery_window_state_by_system',
      'p9_10_4_d_guard_recovery_row_write',
      'p9_10_4_d_write_recovery_qualification_fact_by_system',
      'release_ai_run_queue_recovery_claim_by_system',
      'p9_10_4_d_refund_expired_held_recovery_claims',
      'p9_10_4_d_write_assistant_effect_by_system',
      'p9_10_4_d_apply_recovery_followup_by_system',
      'p9_10_4_d_settle_recovery_failure_by_system'
      )
  ) then
    raise exception 'P9_CANDIDATE_FUNCTION_RESIDUE';
  end if;

  if to_regprocedure(
    'public.issue_quote_preparation_task_authorization_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid)'
  ) is not null then
    raise exception 'P9_QUOTE_OVERLOAD_RESIDUE';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and (
        (
          table_name='ai_run_queue'
          and column_name='p9_recovery_claim_started_at'
        )
        or (
          table_name in (
            'conversation_ai_window_state',
            'store_assistant_threads'
          )
          and column_name='p9_recovery_response_set_id'
        )
      )
  ) then
    raise exception 'P9_CANDIDATE_COLUMN_RESIDUE';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c
      on c.oid=t.tgrelid
    join pg_catalog.pg_namespace n
      on n.oid=c.relnamespace
    where n.nspname='public'
      and left(t.tgname,length('trg_p9_10_4_d_i4_'))='trg_p9_10_4_d_i4_'
  ) then
    raise exception 'P9_CANDIDATE_TRIGGER_RESIDUE';
  end if;

  if exists (
    select 1
    from supabase_migrations.schema_migrations
    where version='20261125020000'
  ) then
    raise exception 'P9_MIGRATION_REGISTRY_RESIDUE';
  end if;

  if to_regclass(
    'public.zion_admin_diagnostic_operational_failure_events'
  ) is null then
    raise exception 'P9_DIAGNOSTIC_TABLE_MISSING';
  end if;

  -- Scan known UUID identities in public base tables.
  -- No real customer data is selected or returned.

  for r in
    select
      n.nspname as schema_name,
      c.relname as table_name,
      a.attname as column_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n
      on n.oid=c.relnamespace
    join pg_catalog.pg_attribute a
      on a.attrelid=c.oid
    where n.nspname='public'
      and c.relkind in ('r','p')
      and a.attnum>0
      and not a.attisdropped
      and a.atttypid='uuid'::regtype
      and (
        a.attname in (
          'organization_id',
          'store_id',
          'customer_id',
          'lead_id',
          'origin_lead_id',
          'related_lead_id',
          'conversation_id',
          'primary_conversation_id',
          'related_conversation_id',
          'conversation_session_id',
          'commercial_opportunity_id',
          'opportunity_id'
        )
        or (
          a.attname='id'
          and c.relname in (
            'organizations',
            'stores',
            'customers',
            'leads',
            'conversations',
            'conversation_sessions',
            'commercial_opportunities'
          )
        )
      )
    order by c.relname,a.attname
  loop
    execute pg_catalog.format(
      'select exists (select 1 from %I.%I where %I=any($1))',
      r.schema_name,
      r.table_name,
      r.column_name
    )
    into v_exists
    using v_ids;

    if v_exists then
      raise exception
        'P9_SYNTHETIC_IDENTITY_RESIDUE:%.%',
        r.table_name,
        r.column_name;
    end if;

    v_checked:=v_checked+1;
  end loop;

  if v_checked<7 then
    raise exception 'P9_VERIFICATION_COVERAGE_INVALID';
  end if;

  raise notice
    'P9_UUID_COLUMNS_VERIFIED:%',v_checked;
end;
$p9_comprehensive_verification$;

select
  'schema_and_synthetic_identity_rollback' as test,
  'PASS' as result,
  7 as original_functions_verified,
  14 as synthetic_identities_checked;

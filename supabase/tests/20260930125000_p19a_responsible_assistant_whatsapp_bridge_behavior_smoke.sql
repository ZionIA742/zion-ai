-- P19-A / Bloco 5 / Etapa 5.1
-- Behavioral smoke for the responsible WhatsApp -> Assistant bridge.
-- DEV ONLY.
-- This runner exercises the real ledger/claim contract inside a transaction
-- and rolls everything back at the end.

begin;

select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

do $$
declare
  v_org_id uuid;
  v_store_id uuid;
  v_responsible_id uuid;
  v_destination text;
  v_thread_id uuid;
  v_event_id uuid := gen_random_uuid();
  v_external_message_id text :=
    'p19a-5.1-behavior-' || replace(gen_random_uuid()::text, '-', '');
  v_claim_token text :=
    'p19a-5.1-claim-' || replace(gen_random_uuid()::text, '-', '');
  v_claim record;
  v_second_claim record;
  v_status text;
  v_locked_by text;
  v_claim_token_db text;
  v_locked_at timestamptz;
  v_duplicate_blocked boolean := false;
  v_null_thread_blocked boolean := false;
  v_null_now_blocked boolean := false;
begin
  -- Use an existing canonical primary responsible and an Assistant thread
  -- from the same tenant/store. No business fixture is created permanently.
  select
    responsible.organization_id,
    responsible.store_id,
    responsible.id,
    responsible.whatsapp_number,
    thread_row.id
  into
    v_org_id,
    v_store_id,
    v_responsible_id,
    v_destination,
    v_thread_id
  from public.store_responsibles responsible
  join public.store_assistant_threads thread_row
    on thread_row.organization_id = responsible.organization_id
   and thread_row.store_id = responsible.store_id
  where responsible.is_primary = true
    and responsible.is_active = true
    and nullif(btrim(responsible.whatsapp_number), '') is not null
  order by responsible.created_at desc nulls last, thread_row.created_at desc nulls last
  limit 1;

  if v_org_id is null
     or v_store_id is null
     or v_responsible_id is null
     or v_thread_id is null then
    raise exception
      'P19A_5_1_BEHAVIOR_FIXTURE_MISSING: need one active primary responsible and one Assistant thread in the same store';
  end if;

  insert into public.store_assistant_responsible_whatsapp_events (
    id,
    organization_id,
    store_id,
    responsible_id,
    external_message_id,
    thread_id,
    destination,
    status
  )
  values (
    v_event_id,
    v_org_id,
    v_store_id,
    v_responsible_id,
    v_external_message_id,
    v_thread_id,
    v_destination,
    'received'
  );

  -- Replay barrier: the same external message cannot create a second event.
  begin
    insert into public.store_assistant_responsible_whatsapp_events (
      organization_id,
      store_id,
      responsible_id,
      external_message_id,
      thread_id,
      destination,
      status
    )
    values (
      v_org_id,
      v_store_id,
      v_responsible_id,
      v_external_message_id,
      v_thread_id,
      v_destination,
      'received'
    );
  exception
    when unique_violation then
      v_duplicate_blocked := true;
  end;

  if not v_duplicate_blocked then
    raise exception 'P19A_5_1_BEHAVIOR_DUPLICATE_EVENT_NOT_BLOCKED';
  end if;

  -- MATCH SIMPLE hardening: message id cannot be present with NULL thread.
  begin
    update public.store_assistant_responsible_whatsapp_events
       set thread_id = null,
           inbound_message_id = gen_random_uuid()
     where id = v_event_id;
  exception
    when check_violation then
      v_null_thread_blocked := true;
  end;

  if not v_null_thread_blocked then
    raise exception 'P19A_5_1_BEHAVIOR_NULL_THREAD_GUARD_FAILED';
  end if;

  -- Atomic claim: exactly one worker owns received -> processing.
  select *
    into v_claim
    from public.claim_store_assistant_responsible_whatsapp_event(
      v_event_id,
      v_claim_token,
      now(),
      interval '10 minutes'
    );

  if v_claim.event_id is distinct from v_event_id
     or v_claim.claimed is distinct from true
     or v_claim.status is distinct from 'processing'
     or v_claim.claim_token is distinct from v_claim_token then
    raise exception 'P19A_5_1_BEHAVIOR_FIRST_CLAIM_FAILED';
  end if;

  select
    status,
    locked_by,
    claim_token,
    locked_at
  into
    v_status,
    v_locked_by,
    v_claim_token_db,
    v_locked_at
  from public.store_assistant_responsible_whatsapp_events
  where id = v_event_id;

  if v_status is distinct from 'processing'
     or v_locked_by is distinct from v_claim_token
     or v_claim_token_db is distinct from v_claim_token
     or v_locked_at is null then
    raise exception 'P19A_5_1_BEHAVIOR_CLAIM_FENCING_NOT_PERSISTED';
  end if;

  -- Same event cannot be claimed a second time while already processing.
  select *
    into v_second_claim
    from public.claim_store_assistant_responsible_whatsapp_event(
      v_event_id,
      'second-' || v_claim_token,
      now(),
      interval '10 minutes'
    );

  if v_second_claim.event_id is distinct from v_event_id
     or v_second_claim.claimed is distinct from false
     or v_second_claim.status is distinct from 'processing'
     or v_second_claim.claim_token is distinct from v_claim_token then
    raise exception 'P19A_5_1_BEHAVIOR_SECOND_CLAIM_NOT_BLOCKED';
  end if;

  -- Invalid clock input must fail closed.
  begin
    perform *
      from public.claim_store_assistant_responsible_whatsapp_event(
        v_event_id,
        'null-now-' || v_claim_token,
        null,
        interval '10 minutes'
      );
  exception
    when sqlstate '42501' then
      v_null_now_blocked := true;
  end;

  if not v_null_now_blocked then
    raise exception 'P19A_5_1_BEHAVIOR_NULL_NOW_NOT_BLOCKED';
  end if;
end;
$$;

rollback;

select
  '5.1 responsible assistant bridge behavioral smoke passed (transaction rolled back)'
  as result;

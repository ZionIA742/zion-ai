-- ZION P9 / Bloco 6 / Etapa 6.4
-- Manual checks for canonical quote kind resolution and lazy quote expiration.
-- Run only after applying 20260922170000_p9_sales_quote_kind_expiration_lazy.sql in DEV.
-- All fixture mutations are transactional and rolled back.

begin;

do $checks$
declare
  v_date date;
  v_bool boolean;
  v_internal_definition text;
  v_generation_definition text;
  v_readiness_definition text;
  v_approval_definition text;
  v_send_definition text;
  v_quote public.sales_quotes%rowtype;
  v_base_version public.sales_quote_versions%rowtype;
  v_expired_version_id uuid;
  v_today_version_id uuid;
  v_expired_snapshot jsonb;
  v_today_snapshot jsonb;
  v_next_version_number integer;
  v_status text;
  v_sent_at timestamptz;
  v_expected_key text;
  v_message_count bigint;
  v_resolution_state text;
  v_quote_kind text;
  v_reason_code text;
  v_blocking_items jsonb;
  v_authority_fingerprint text;
  v_caught boolean;
begin
  select public.resolve_sales_quote_version_valid_until(
    '{"quote":{"validUntil":"2026-09-21"}}'::jsonb,
    '2026-09-30'::date
  ) into v_date;
  if v_date is distinct from '2026-09-21'::date then
    raise exception 'scenario 1 failed: snapshot validUntil must win over sales_quotes.valid_until';
  end if;

  select public.resolve_sales_quote_version_valid_until(
    '{"quote":{"validUntil":null}}'::jsonb,
    '2026-09-30'::date
  ) into v_date;
  if v_date is not null then
    raise exception 'scenario 2 failed: explicit snapshot validUntil null must not fall back';
  end if;

  select public.resolve_sales_quote_version_valid_until(
    '{"quote":{"quoteNumber":"ORC-1"}}'::jsonb,
    '2026-09-30'::date
  ) into v_date;
  if v_date is distinct from '2026-09-30'::date then
    raise exception 'scenario 3 failed: legacy snapshot without validUntil must fall back to sales_quotes.valid_until';
  end if;

  select public.sales_quote_version_is_expired(
    '{"quote":{"validUntil":"2026-09-21"}}'::jsonb,
    '2026-09-30'::date,
    '2026-09-22'::date
  ) into v_bool;
  if v_bool is not true then
    raise exception 'scenario 4 failed: yesterday must be expired';
  end if;

  select public.sales_quote_version_is_expired(
    '{"quote":{"validUntil":"2026-09-22"}}'::jsonb,
    null,
    '2026-09-22'::date
  ) into v_bool;
  if v_bool is not false then
    raise exception 'scenario 5 failed: today must remain valid';
  end if;

  select public.sales_quote_version_is_expired(
    '{"quote":{"validUntil":"2026-09-23"}}'::jsonb,
    null,
    '2026-09-22'::date
  ) into v_bool;
  if v_bool is not false then
    raise exception 'scenario 6 failed: future must remain valid';
  end if;

  select public.sales_quote_version_is_expired(
    '{"quote":{"validUntil":null}}'::jsonb,
    '2026-09-21'::date,
    '2026-09-22'::date
  ) into v_bool;
  if v_bool is not false then
    raise exception 'scenario 7 failed: null snapshot validUntil means no expiration';
  end if;

  select pg_get_functiondef(
    'public.p9_read_sales_quote_kind_authority_internal(uuid,uuid,uuid)'::regprocedure
  ) into v_internal_definition;
  if v_internal_definition not like '%commercial_opportunity_checklist_current%'
     or v_internal_definition not like '%commercial_opportunity_checklist_progress_current%'
     or v_internal_definition not like '%technical_visit%'
     or v_internal_definition not like '%preliminary_quote_before_technical_visit%' then
    raise exception 'scenario 8 failed: shared quote-kind authority reader is not anchored to canonical current projections';
  end if;

  select pg_get_functiondef(
    'public.resolve_sales_quote_kind_for_generation_by_system(uuid,uuid,uuid,uuid)'::regprocedure
  ) into v_generation_definition;
  if v_generation_definition not like '%p9_read_sales_quote_kind_authority_internal%'
     or v_generation_definition like '%commercial_opportunity_checklist_current%'
     or v_generation_definition like '%commercial_opportunity_checklist_progress_current%' then
    raise exception 'scenario 9 failed: generation resolver must delegate exclusively to shared quote-kind authority';
  end if;

  if v_generation_definition like '%sales_quote_versions%' then
    raise exception 'scenario 10 failed: generation resolver must not depend on an existing version';
  end if;

  select pg_get_functiondef(
    'public.read_quote_kind_send_readiness_scoped(uuid,uuid,uuid,uuid)'::regprocedure
  ) into v_readiness_definition;
  if v_readiness_definition not like '%p9_read_sales_quote_kind_authority_internal%'
     or v_readiness_definition like '%commercial_opportunity_checklist_current%'
     or v_readiness_definition like '%commercial_opportunity_checklist_progress_current%' then
    raise exception 'scenario 11 failed: send readiness must delegate exclusively to shared quote-kind authority';
  end if;

  select pg_get_functiondef(
    'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid)'::regprocedure
  ) into v_approval_definition;
  if v_approval_definition not like '%sales_quote_version_is_expired%'
     or position('sales_quote_version_is_expired' in v_approval_definition)
        > position('update public.sales_quote_versions' in v_approval_definition) then
    raise exception 'scenario 12 failed: approval writer must block expired versions before lifecycle mutation';
  end if;

  select pg_get_functiondef(
    'public.materialize_sales_quote_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text)'::regprocedure
  ) into v_send_definition;
  if v_send_definition not like '%sales_quote_version_is_expired%'
     or position('sales_quote_version_is_expired' in v_send_definition)
        > position('insert_message' in v_send_definition) then
    raise exception 'scenario 13 failed: send writer must block expired versions before outbound effects';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.resolve_sales_quote_kind_for_generation_by_system(uuid,uuid,uuid,uuid)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.resolve_sales_quote_kind_for_generation_by_system(uuid,uuid,uuid,uuid)',
       'execute'
     ) then
    raise exception 'scenario 14 failed: generation resolver privilege contract changed';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.read_quote_kind_send_readiness_scoped(uuid,uuid,uuid,uuid)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.read_quote_kind_send_readiness_scoped(uuid,uuid,uuid,uuid)',
       'execute'
     ) then
    raise exception 'scenario 15 failed: quote-kind send readiness privilege contract changed';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.materialize_sales_quote_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.approve_sales_quote_version_by_system(uuid,uuid,uuid,uuid)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.materialize_sales_quote_send_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text)',
       'execute'
     ) then
    raise exception 'scenario 16 failed: canonical approve/send writer privilege contract changed';
  end if;

  if has_function_privilege(
       'service_role',
       'public.p9_read_sales_quote_kind_authority_internal(uuid,uuid,uuid)',
       'execute'
     )
     or has_function_privilege(
       'service_role',
       'public.resolve_sales_quote_version_valid_until(jsonb,date)',
       'execute'
     )
     or has_function_privilege(
       'service_role',
       'public.sales_quote_version_is_expired(jsonb,date,date)',
       'execute'
     ) then
    raise exception 'scenario 17 failed: internal P9 6.4 helpers must not be directly executable by service_role';
  end if;

  select quote_row.* into v_quote
    from public.sales_quotes quote_row
   where quote_row.current_version_id is not null
     and quote_row.commercial_opportunity_id is not null
     and quote_row.conversation_id is not null
   order by quote_row.created_at desc
   limit 1;
  if not found then
    raise exception 'precondition failed: scenario 18+ require one existing quote with current version, opportunity and conversation';
  end if;

  select version_row.* into v_base_version
    from public.sales_quote_versions version_row
   where version_row.id = v_quote.current_version_id
     and version_row.quote_id = v_quote.id
     and version_row.organization_id = v_quote.organization_id
     and version_row.store_id = v_quote.store_id;
  if not found then
    raise exception 'precondition failed: selected quote current_version_id is not a coherent scoped version';
  end if;

  select coalesce(max(version_number), 0) + 100 into v_next_version_number
    from public.sales_quote_versions
   where quote_id = v_quote.id;

  v_expired_version_id := gen_random_uuid();
  v_expired_snapshot :=
    coalesce(v_base_version.quote_snapshot, '{}'::jsonb)
    || jsonb_build_object(
      'quote',
      coalesce(v_base_version.quote_snapshot -> 'quote', '{}'::jsonb)
      || jsonb_build_object(
        'validUntil', (((now() at time zone 'UTC')::date - 1)::text)
      )
    );

  insert into public.sales_quote_versions (
    id, organization_id, store_id, quote_id, version_number, status, quote_kind,
    store_file_id, storage_bucket, storage_path, original_filename, mime_type,
    size_bytes, generated_by, quote_snapshot
  ) values (
    v_expired_version_id,
    v_quote.organization_id,
    v_quote.store_id,
    v_quote.id,
    v_next_version_number,
    'generated',
    coalesce(v_base_version.quote_kind, 'definitive'),
    v_base_version.store_file_id,
    coalesce(v_base_version.storage_bucket, 'zion-store-files'),
    v_base_version.storage_path,
    v_base_version.original_filename,
    coalesce(v_base_version.mime_type, 'application/pdf'),
    v_base_version.size_bytes,
    'system',
    v_expired_snapshot
  );

  update public.sales_quotes
     set current_version_id = v_expired_version_id,
         valid_until = ((now() at time zone 'UTC')::date + 30)
   where id = v_quote.id
     and organization_id = v_quote.organization_id
     and store_id = v_quote.store_id;

  -- 18. Snapshot expired date wins over future sales_quotes.valid_until and
  -- approval fails before lifecycle mutation.
  v_caught := false;
  begin
    perform *
      from public.approve_sales_quote_version_by_system(
        v_quote.organization_id,
        v_quote.store_id,
        v_quote.id,
        v_expired_version_id
      );
    raise exception 'scenario 18 failed: expired snapshot version was approved';
  exception
    when sqlstate '23514' then
      if sqlerrm is distinct from 'ZION_SALES_QUOTE_VERSION_EXPIRED' then
        raise;
      end if;
      v_caught := true;
  end;

  if not v_caught then
    raise exception 'scenario 18 failed: expected expiration exception was not observed';
  end if;

  select status, sent_at into v_status, v_sent_at
    from public.sales_quote_versions
   where id = v_expired_version_id;
  if v_status is distinct from 'generated' or v_sent_at is not null then
    raise exception 'scenario 18 failed: expired approval mutated version lifecycle';
  end if;

  -- 19. Expired send fails before insert_message / outbound materialization.
  v_expected_key :=
    'sales_quote_send:'
    || v_quote.organization_id::text || ':'
    || v_quote.store_id::text || ':'
    || v_quote.commercial_opportunity_id::text || ':'
    || v_quote.id::text || ':'
    || v_expired_version_id::text;

  select count(*) into v_message_count
    from public.messages
   where organization_id = v_quote.organization_id
     and store_id = v_quote.store_id
     and outbound_idempotency_key = v_expected_key;
  if v_message_count <> 0 then
    raise exception 'precondition failed: scenario 19 generated idempotency key unexpectedly already exists';
  end if;

  v_caught := false;
  begin
    perform *
      from public.materialize_sales_quote_send_by_system(
        v_quote.organization_id,
        v_quote.store_id,
        v_quote.commercial_opportunity_id,
        v_quote.conversation_id,
        v_quote.id,
        v_expired_version_id,
        'P9 6.4 expired send check',
        '{}'::jsonb,
        v_expected_key,
        'sales_quote_send_route'
      );
    raise exception 'scenario 19 failed: expired version materialized outbound message';
  exception
    when sqlstate '23514' then
      if sqlerrm is distinct from 'SALES_QUOTE_VERSION_EXPIRED_FOR_SEND' then
        raise;
      end if;
      v_caught := true;
  end;

  if not v_caught then
    raise exception 'scenario 19 failed: expected send expiration exception was not observed';
  end if;

  select count(*) into v_message_count
    from public.messages
   where organization_id = v_quote.organization_id
     and store_id = v_quote.store_id
     and outbound_idempotency_key = v_expected_key;
  if v_message_count <> 0 then
    raise exception 'scenario 19 failed: expired send created an outbound message';
  end if;

  -- 20. Today is valid at the canonical approval writer boundary.
  v_today_version_id := gen_random_uuid();
  v_today_snapshot :=
    coalesce(v_base_version.quote_snapshot, '{}'::jsonb)
    || jsonb_build_object(
      'quote',
      coalesce(v_base_version.quote_snapshot -> 'quote', '{}'::jsonb)
      || jsonb_build_object('validUntil', ((now() at time zone 'UTC')::date::text))
    );

  insert into public.sales_quote_versions (
    id, organization_id, store_id, quote_id, version_number, status, quote_kind,
    store_file_id, storage_bucket, storage_path, original_filename, mime_type,
    size_bytes, generated_by, quote_snapshot
  ) values (
    v_today_version_id,
    v_quote.organization_id,
    v_quote.store_id,
    v_quote.id,
    v_next_version_number + 1,
    'generated',
    coalesce(v_base_version.quote_kind, 'definitive'),
    v_base_version.store_file_id,
    coalesce(v_base_version.storage_bucket, 'zion-store-files'),
    v_base_version.storage_path,
    v_base_version.original_filename,
    coalesce(v_base_version.mime_type, 'application/pdf'),
    v_base_version.size_bytes,
    'system',
    v_today_snapshot
  );

  update public.sales_quotes
     set current_version_id = v_today_version_id
   where id = v_quote.id
     and organization_id = v_quote.organization_id
     and store_id = v_quote.store_id;

  perform *
    from public.approve_sales_quote_version_by_system(
      v_quote.organization_id,
      v_quote.store_id,
      v_quote.id,
      v_today_version_id
    );

  select status, sent_at into v_status, v_sent_at
    from public.sales_quote_versions
   where id = v_today_version_id;
  if v_status is distinct from 'approved' or v_sent_at is not null then
    raise exception 'scenario 20 failed: valid-today version was not approved cleanly';
  end if;

  -- 21. Real generation resolver executes against the selected real authority.
  select
    resolution_state,
    quote_kind,
    reason_code,
    blocking_items,
    authority_fingerprint
  into
    v_resolution_state,
    v_quote_kind,
    v_reason_code,
    v_blocking_items,
    v_authority_fingerprint
  from public.resolve_sales_quote_kind_for_generation_by_system(
    v_quote.organization_id,
    v_quote.store_id,
    v_quote.commercial_opportunity_id,
    v_quote.id
  );

  if v_resolution_state = 'ready' then
    if v_quote_kind not in ('preliminary', 'definitive')
       or v_authority_fingerprint is null then
      raise exception 'scenario 21 failed: ready generation resolution must return explicit kind and fingerprint';
    end if;
  elsif v_resolution_state in ('blocked', 'conflict', 'needs_resolution') then
    if v_quote_kind is not null
       or v_reason_code is null
       or v_authority_fingerprint is null then
      raise exception 'scenario 21 failed: non-ready generation resolution contract is incoherent';
    end if;
  else
    raise exception 'scenario 21 failed: unexpected generation resolution state %', v_resolution_state;
  end if;

  -- 22. Functions are owned by postgres.
  if (
    select count(*)
      from pg_catalog.pg_proc proc_row
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = proc_row.pronamespace
     where namespace_row.nspname = 'public'
       and proc_row.proname in (
         'p9_read_sales_quote_kind_authority_internal',
         'resolve_sales_quote_kind_for_generation_by_system',
         'read_quote_kind_send_readiness_scoped',
         'approve_sales_quote_version_by_system',
         'materialize_sales_quote_send_by_system',
         'resolve_sales_quote_version_valid_until',
         'sales_quote_version_is_expired'
       )
       and pg_catalog.pg_get_userbyid(proc_row.proowner) <> 'postgres'
  ) <> 0 then
    raise exception 'scenario 22 failed: one or more P9 6.4 functions are not owned by postgres';
  end if;
end;
$checks$;

rollback;

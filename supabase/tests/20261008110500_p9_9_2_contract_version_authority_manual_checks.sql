-- ZION / P9 / 9.2-B1
-- CORRECTED REAL-SUT rollback-only checks for contract-version authority.
--
-- Why this revision exists:
-- 1) pg_get_triggerdef() may deparse UPDATE/DELETE event order differently,
--    so trigger coverage is verified from pg_trigger.tgtype bits instead of text.
-- 2) A valid current-contract + active-template fixture is environment-dependent.
--    Its absence is SKIP, not FAIL. Structural/immutability checks still run.
-- 3) The runner always emits exactly 30 numbered scenarios.
--
-- Run only AFTER 20261008110000_p9_9_2_contract_version_authority.sql
-- is installed in the target database.
-- No Storage/HTTP calls are made. Every DB write is transaction-local.
-- The script ends in ROLLBACK.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local idle_in_transaction_session_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    '20261008110500_p9_9_2_contract_version_authority_manual_checks_v3',
    0
  )
);

create temp table p9_9_2_results (
  n integer primary key,
  name text not null,
  status text not null check (status in ('PASS', 'FAIL', 'ERROR', 'SKIP')),
  details text null
) on commit drop;

create or replace function pg_temp.p9_9_2_record(
  p_n integer,
  p_name text,
  p_status text,
  p_details text default null
)
returns void
language plpgsql
as $function$
begin
  insert into pg_temp.p9_9_2_results(n, name, status, details)
  values (p_n, p_name, p_status, p_details)
  on conflict (n) do update
  set
    name = excluded.name,
    status = excluded.status,
    details = excluded.details;

  raise notice '% %: % -- %',
    p_status,
    p_n,
    p_name,
    coalesce(p_details, '');
end;
$function$;

create or replace function pg_temp.p9_9_2_assert(
  p_n integer,
  p_name text,
  p_ok boolean,
  p_details text default null
)
returns void
language plpgsql
as $function$
begin
  perform pg_temp.p9_9_2_record(
    p_n,
    p_name,
    case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end,
    p_details
  );
end;
$function$;

create or replace function pg_temp.p9_9_2_skip(
  p_n integer,
  p_name text,
  p_details text default null
)
returns void
language plpgsql
as $function$
begin
  perform pg_temp.p9_9_2_record(
    p_n,
    p_name,
    'SKIP',
    p_details
  );
end;
$function$;

-- ============================================================================
-- A. Structural installation checks: scenarios 1-10.
-- ============================================================================

do $structural$
declare
  v_version regclass := to_regclass('public.sales_contract_versions');
  v_contract regclass := to_regclass('public.sales_contracts');
  v_writer oid :=
    to_regprocedure(
      'public.create_sales_contract_version_by_system(uuid,uuid,uuid,text,text,text,uuid,text,text,text,text,bigint,text,jsonb)'
    );

  v_version_contract_fk record;
  v_current_version_fk record;
  v_immutability_trigger record;
  v_writer_def text;

  v_expected_version_conkey smallint[];
  v_expected_version_confkey smallint[];
  v_expected_current_conkey smallint[];
  v_expected_current_confkey smallint[];

  v_hash_check_count integer;
  v_authority_shape_exists boolean;
begin
  perform pg_temp.p9_9_2_assert(
    1,
    'authority columns installed',
    v_version is not null
    and exists (
      select 1 from pg_attribute
      where attrelid = v_version
        and attname = 'operation_key'
        and not attisdropped
    )
    and exists (
      select 1 from pg_attribute
      where attrelid = v_version
        and attname = 'request_fingerprint'
        and not attisdropped
    )
    and exists (
      select 1 from pg_attribute
      where attrelid = v_version
        and attname = 'content_fingerprint'
        and not attisdropped
    )
    and exists (
      select 1 from pg_attribute
      where attrelid = v_version
        and attname = 'pdf_sha256'
        and not attisdropped
    ),
    'operation_key/request_fingerprint/content_fingerprint/pdf_sha256'
  );

  select count(*)
  into v_hash_check_count
  from pg_constraint
  where conrelid = v_version
    and contype = 'c'
    and conname in (
      'sales_contract_versions_request_fingerprint_check',
      'sales_contract_versions_content_fingerprint_check',
      'sales_contract_versions_pdf_sha256_check'
    );

  select exists (
    select 1
    from pg_constraint
    where conrelid = v_version
      and contype = 'c'
      and conname = 'sales_contract_versions_authority_shape_check'
      and convalidated
  )
  into v_authority_shape_exists;

  perform pg_temp.p9_9_2_assert(
    2,
    'hash and authority-shape CHECK constraints installed',
    v_hash_check_count = 3
    and v_authority_shape_exists,
    format(
      'hash_checks=%s authority_shape=%s',
      v_hash_check_count,
      v_authority_shape_exists
    )
  );

  select array[
    (
      select attnum::smallint
      from pg_attribute
      where attrelid = v_version
        and attname = 'contract_id'
        and not attisdropped
    ),
    (
      select attnum::smallint
      from pg_attribute
      where attrelid = v_version
        and attname = 'organization_id'
        and not attisdropped
    ),
    (
      select attnum::smallint
      from pg_attribute
      where attrelid = v_version
        and attname = 'store_id'
        and not attisdropped
    )
  ]::smallint[]
  into v_expected_version_conkey;

  select array[
    (
      select attnum::smallint
      from pg_attribute
      where attrelid = v_contract
        and attname = 'id'
        and not attisdropped
    ),
    (
      select attnum::smallint
      from pg_attribute
      where attrelid = v_contract
        and attname = 'organization_id'
        and not attisdropped
    ),
    (
      select attnum::smallint
      from pg_attribute
      where attrelid = v_contract
        and attname = 'store_id'
        and not attisdropped
    )
  ]::smallint[]
  into v_expected_version_confkey;

  select
    conkey,
    confkey,
    confrelid,
    confdeltype,
    convalidated
  into v_version_contract_fk
  from pg_constraint
  where conrelid = v_version
    and conname = 'sales_contract_versions_contract_scope_fkey'
    and contype = 'f';

  perform pg_temp.p9_9_2_assert(
    3,
    'version to contract FK is exact contract/org/store scope',
    v_version_contract_fk.conkey = v_expected_version_conkey
    and v_version_contract_fk.confkey = v_expected_version_confkey
    and v_version_contract_fk.confrelid = v_contract
    and v_version_contract_fk.confdeltype in ('a', 'r')
    and v_version_contract_fk.convalidated,
    coalesce(
      pg_get_constraintdef(
        (
          select oid
          from pg_constraint
          where conrelid = v_version
            and conname = 'sales_contract_versions_contract_scope_fkey'
        ),
        true
      ),
      'missing'
    )
  );

  select array[
    (
      select attnum::smallint
      from pg_attribute
      where attrelid = v_contract
        and attname = 'current_version_id'
        and not attisdropped
    ),
    (
      select attnum::smallint
      from pg_attribute
      where attrelid = v_contract
        and attname = 'id'
        and not attisdropped
    ),
    (
      select attnum::smallint
      from pg_attribute
      where attrelid = v_contract
        and attname = 'organization_id'
        and not attisdropped
    ),
    (
      select attnum::smallint
      from pg_attribute
      where attrelid = v_contract
        and attname = 'store_id'
        and not attisdropped
    )
  ]::smallint[]
  into v_expected_current_conkey;

  select array[
    (
      select attnum::smallint
      from pg_attribute
      where attrelid = v_version
        and attname = 'id'
        and not attisdropped
    ),
    (
      select attnum::smallint
      from pg_attribute
      where attrelid = v_version
        and attname = 'contract_id'
        and not attisdropped
    ),
    (
      select attnum::smallint
      from pg_attribute
      where attrelid = v_version
        and attname = 'organization_id'
        and not attisdropped
    ),
    (
      select attnum::smallint
      from pg_attribute
      where attrelid = v_version
        and attname = 'store_id'
        and not attisdropped
    )
  ]::smallint[]
  into v_expected_current_confkey;

  select
    conkey,
    confkey,
    confrelid,
    confdeltype,
    convalidated
  into v_current_version_fk
  from pg_constraint
  where conrelid = v_contract
    and conname = 'sales_contracts_current_version_scope_fkey'
    and contype = 'f';

  perform pg_temp.p9_9_2_assert(
    4,
    'current_version FK is exact version/contract/org/store scope',
    v_current_version_fk.conkey = v_expected_current_conkey
    and v_current_version_fk.confkey = v_expected_current_confkey
    and v_current_version_fk.confrelid = v_version
    and v_current_version_fk.confdeltype in ('a', 'r')
    and v_current_version_fk.convalidated,
    coalesce(
      pg_get_constraintdef(
        (
          select oid
          from pg_constraint
          where conrelid = v_contract
            and conname = 'sales_contracts_current_version_scope_fkey'
        ),
        true
      ),
      'missing'
    )
  );

  select
    tgtype,
    tgenabled,
    tgfoid
  into v_immutability_trigger
  from pg_trigger
  where tgrelid = v_version
    and tgname = 'p9_sales_contract_version_immutability_guard'
    and not tgisinternal;

  perform pg_temp.p9_9_2_assert(
    5,
    'immutability trigger covers BEFORE UPDATE and BEFORE DELETE',
    v_immutability_trigger.tgenabled <> 'D'
    and (v_immutability_trigger.tgtype & 2) <> 0
    and (v_immutability_trigger.tgtype & 8) <> 0
    and (v_immutability_trigger.tgtype & 16) <> 0
    and v_immutability_trigger.tgfoid =
      to_regprocedure('public.p9_guard_sales_contract_version_immutability()'),
    coalesce(
      (
        select pg_get_triggerdef(oid, true)
        from pg_trigger
        where tgrelid = v_version
          and tgname = 'p9_sales_contract_version_immutability_guard'
          and not tgisinternal
      ),
      'missing'
    )
  );

  perform pg_temp.p9_9_2_assert(
    6,
    'TRUNCATE privilege absent for service_role',
    not has_table_privilege(
      'service_role',
      'public.sales_contract_versions',
      'TRUNCATE'
    ),
    'service_role cannot bypass row triggers through TRUNCATE'
  );

  perform pg_temp.p9_9_2_assert(
    7,
    'canonical RPC ACL is server-only',
    v_writer is not null
    and has_function_privilege(
      'service_role',
      v_writer,
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      v_writer,
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      v_writer,
      'EXECUTE'
    ),
    'service_role=EXECUTE; anon/authenticated=denied'
  );

  if v_writer is not null then
    select pg_get_functiondef(v_writer)
    into v_writer_def;
  end if;

  perform pg_temp.p9_9_2_assert(
    8,
    'RPC carries scoped storage/template/current-proposal gates',
    coalesce(v_writer_def, '') like '%P9_9_2_STORE_FILE_SCOPE_INVALID%'
    and coalesce(v_writer_def, '') like '%P9_9_2_TEMPLATE_AUTHORITY_INVALID%'
    and coalesce(v_writer_def, '') like '%P9_9_2_TEMPLATE_RULES_INVALID%'
    and coalesce(v_writer_def, '') like '%p9_assert_sales_contract_current_proposal_lineage_internal%',
    'definition contains all canonical authority gates'
  );

  perform pg_temp.p9_9_2_assert(
    9,
    'RPC replay/collision contract is installed',
    position(
      'materialized_at'
      in coalesce(v_writer_def, '')
    ) > 0
    and position(
      'P9_9_2_OPERATION_KEY_CONFLICT'
      in coalesce(v_writer_def, '')
    ) > 0
    and position(
      'P9_9_2_CONTENT_FINGERPRINT_CONFLICT'
      in coalesce(v_writer_def, '')
    ) > 0,
    'stable snapshot replay + deterministic conflict markers'
  );

  perform pg_temp.p9_9_2_assert(
    10,
    'historical NULL authority tuples remain compatible',
    not exists (
      select 1
      from public.sales_contract_versions v
      where (
        v.operation_key is null
        or v.request_fingerprint is null
        or v.content_fingerprint is null
        or v.pdf_sha256 is null
      )
      and not (
        v.operation_key is null
        and v.request_fingerprint is null
        and v.content_fingerprint is null
        and v.pdf_sha256 is null
      )
    ),
    'authority tuple is either historical-all-NULL or canonical-all-present'
  );
end;
$structural$;

-- ============================================================================
-- B. Runtime append-only/scoped invariants using an existing historical/current
--    version. These tests do not need a configured contract template.
--    Scenarios 11-20.
-- ============================================================================

do $history_runtime$
declare
  v_version public.sales_contract_versions%rowtype;
  v_contract public.sales_contracts%rowtype;
  v_other_version uuid;
  v_probe_error text;
begin
  select v.*
  into v_version
  from public.sales_contract_versions v
  order by v.created_at, v.id
  limit 1;

  if not found then
    for i in 11..20 loop
      perform pg_temp.p9_9_2_skip(
        i,
        case i
          when 11 then 'existing version fixture available'
          when 12 then 'version number immutable'
          when 13 then 'contract snapshot immutable'
          when 14 then 'storage identity immutable'
          when 15 then 'content fingerprint immutable'
          when 16 then 'operation key immutable'
          when 17 then 'metadata immutable'
          when 18 then 'version DELETE rejected'
          when 19 then 'workflow generation_error remains mutable'
          when 20 then 'current pointer cannot target another contract version'
        end,
        'no sales_contract_versions row exists in target database'
      );
    end loop;
    return;
  end if;

  select c.*
  into v_contract
  from public.sales_contracts c
  where c.id = v_version.contract_id;

  perform pg_temp.p9_9_2_record(
    11,
    'existing version fixture available',
    'PASS',
    'version=' || v_version.id::text ||
    ' contract=' || v_version.contract_id::text
  );

  begin
    update public.sales_contract_versions
    set version_number = version_number + 100000
    where id = v_version.id;

    perform pg_temp.p9_9_2_record(
      12,
      'version number immutable',
      'FAIL',
      'UPDATE unexpectedly changed version_number'
    );
  exception
    when others then
      perform pg_temp.p9_9_2_assert(
        12,
        'version number immutable',
        sqlerrm = 'P9_9_2_CONTRACT_VERSION_IMMUTABLE_FIELD',
        sqlstate || ' ' || sqlerrm
      );
  end;

  begin
    update public.sales_contract_versions
    set contract_snapshot =
      contract_snapshot || '{"p9_9_2_runner_tamper":true}'::jsonb
    where id = v_version.id;

    perform pg_temp.p9_9_2_record(
      13,
      'contract snapshot immutable',
      'FAIL',
      'UPDATE unexpectedly changed contract_snapshot'
    );
  exception
    when others then
      perform pg_temp.p9_9_2_assert(
        13,
        'contract snapshot immutable',
        sqlerrm = 'P9_9_2_CONTRACT_VERSION_IMMUTABLE_FIELD',
        sqlstate || ' ' || sqlerrm
      );
  end;

  begin
    update public.sales_contract_versions
    set storage_path =
      coalesce(storage_path, '') || '.p9_9_2_runner_tamper'
    where id = v_version.id;

    perform pg_temp.p9_9_2_record(
      14,
      'storage identity immutable',
      'FAIL',
      'UPDATE unexpectedly changed storage_path'
    );
  exception
    when others then
      perform pg_temp.p9_9_2_assert(
        14,
        'storage identity immutable',
        sqlerrm = 'P9_9_2_CONTRACT_VERSION_IMMUTABLE_FIELD',
        sqlstate || ' ' || sqlerrm
      );
  end;

  begin
    update public.sales_contract_versions
    set content_fingerprint =
      coalesce(content_fingerprint, repeat('1', 64))
    where id = v_version.id;

    if v_version.content_fingerprint is null then
      perform pg_temp.p9_9_2_record(
        15,
        'content fingerprint immutable',
        'FAIL',
        'historical NULL fingerprint was unexpectedly populated'
      );
    else
      -- If it already had that same value, force a different valid hash.
      update public.sales_contract_versions
      set content_fingerprint =
        case
          when content_fingerprint = repeat('2', 64)
            then repeat('3', 64)
          else repeat('2', 64)
        end
      where id = v_version.id;

      perform pg_temp.p9_9_2_record(
        15,
        'content fingerprint immutable',
        'FAIL',
        'canonical fingerprint was unexpectedly changed'
      );
    end if;
  exception
    when others then
      perform pg_temp.p9_9_2_assert(
        15,
        'content fingerprint immutable',
        sqlerrm = 'P9_9_2_CONTRACT_VERSION_IMMUTABLE_FIELD',
        sqlstate || ' ' || sqlerrm
      );
  end;

  begin
    update public.sales_contract_versions
    set operation_key =
      coalesce(
        operation_key,
        'p9:9.2:runner:tamper:' || gen_random_uuid()::text
      )
    where id = v_version.id;

    if v_version.operation_key is null then
      perform pg_temp.p9_9_2_record(
        16,
        'operation key immutable',
        'FAIL',
        'historical NULL operation_key was unexpectedly populated'
      );
    else
      update public.sales_contract_versions
      set operation_key = operation_key || ':tampered'
      where id = v_version.id;

      perform pg_temp.p9_9_2_record(
        16,
        'operation key immutable',
        'FAIL',
        'canonical operation_key was unexpectedly changed'
      );
    end if;
  exception
    when others then
      perform pg_temp.p9_9_2_assert(
        16,
        'operation key immutable',
        sqlerrm = 'P9_9_2_CONTRACT_VERSION_IMMUTABLE_FIELD',
        sqlstate || ' ' || sqlerrm
      );
  end;

  begin
    update public.sales_contract_versions
    set metadata =
      coalesce(metadata, '{}'::jsonb) ||
      '{"p9_9_2_runner_tamper":true}'::jsonb
    where id = v_version.id;

    perform pg_temp.p9_9_2_record(
      17,
      'metadata immutable',
      'FAIL',
      'UPDATE unexpectedly changed metadata'
    );
  exception
    when others then
      perform pg_temp.p9_9_2_assert(
        17,
        'metadata immutable',
        sqlerrm = 'P9_9_2_CONTRACT_VERSION_IMMUTABLE_FIELD',
        sqlstate || ' ' || sqlerrm
      );
  end;

  begin
    delete from public.sales_contract_versions
    where id = v_version.id;

    perform pg_temp.p9_9_2_record(
      18,
      'version DELETE rejected',
      'FAIL',
      'DELETE unexpectedly removed history'
    );
  exception
    when others then
      perform pg_temp.p9_9_2_assert(
        18,
        'version DELETE rejected',
        sqlerrm = 'P9_9_2_CONTRACT_VERSION_DELETE_FORBIDDEN',
        sqlstate || ' ' || sqlerrm
      );
  end;

  begin
    v_probe_error :=
      'p9-9.2-runner-' ||
      replace(gen_random_uuid()::text, '-', '');

    update public.sales_contract_versions
    set generation_error = v_probe_error
    where id = v_version.id;

    perform pg_temp.p9_9_2_assert(
      19,
      'workflow generation_error remains mutable',
      (
        select generation_error
        from public.sales_contract_versions
        where id = v_version.id
      ) = v_probe_error,
      'operational error field can still be updated'
    );
  exception
    when others then
      perform pg_temp.p9_9_2_record(
        19,
        'workflow generation_error remains mutable',
        'ERROR',
        sqlstate || ' ' || sqlerrm
      );
  end;

  select v.id
  into v_other_version
  from public.sales_contract_versions v
  where v.contract_id <> v_version.contract_id
  order by v.created_at, v.id
  limit 1;

  if v_other_version is null then
    perform pg_temp.p9_9_2_skip(
      20,
      'current pointer cannot target another contract version',
      'no second contract version exists to exercise cross-contract pointer'
    );
  else
    begin
      update public.sales_contracts
      set current_version_id = v_other_version
      where id = v_contract.id
        and organization_id = v_contract.organization_id
        and store_id = v_contract.store_id;

      perform pg_temp.p9_9_2_record(
        20,
        'current pointer cannot target another contract version',
        'FAIL',
        'scoped FK unexpectedly accepted another contract version'
      );
    exception
      when foreign_key_violation then
        perform pg_temp.p9_9_2_record(
          20,
          'current pointer cannot target another contract version',
          'PASS',
          '23503 scoped current-version FK rejected mismatch'
        );
      when others then
        perform pg_temp.p9_9_2_record(
          20,
          'current pointer cannot target another contract version',
          'ERROR',
          sqlstate || ' ' || sqlerrm
        );
    end;
  end if;
end;
$history_runtime$;

-- ============================================================================
-- C. Canonical writer REAL-SUT. This needs one existing contract whose current
--    proposal is still current AND whose store has an active template/version
--    with final rules. If DEV has no such business fixture, scenarios 21-30
--    are SKIP instead of producing a false implementation failure.
-- ============================================================================

do $canonical_runtime$
declare
  v_contract public.sales_contracts%rowtype;
  v_template public.store_contract_templates%rowtype;
  v_template_version public.store_contract_template_versions%rowtype;

  v_candidate_found boolean := false;
  v_guard_state text;
  v_rules jsonb;
  v_snapshot jsonb;
  v_snapshot_replay jsonb;
  v_snapshot_collision jsonb;
  v_snapshot_bad_template jsonb;
  v_snapshot_bad_rule jsonb;
  v_snapshot_bad_clause jsonb;
  v_snapshot_bad_file jsonb;

  v_file_1 uuid := gen_random_uuid();
  v_file_2 uuid := gen_random_uuid();
  v_path_1 text;
  v_path_2 text;
  v_filename_1 text;
  v_filename_2 text;

  v_operation text :=
    'p9:9.2:runner:' || gen_random_uuid()::text;
  v_request text := repeat('a', 64);
  v_content text := repeat('b', 64);
  v_pdf text := repeat('c', 64);

  v_created record;
  v_replay record;
  v_dedupe record;

  v_before_count bigint;
  v_after_count bigint;
  v_expected_version integer;
  v_old_current uuid;

  v_bad_template_id uuid := gen_random_uuid();
  v_negative_ok boolean;
  v_negative_details text;
begin
  for v_contract in
    select c.*
    from public.sales_contracts c
    where c.quote_id is not null
      and c.quote_version_id is not null
    order by c.created_at, c.id
  loop
    begin
      select guard_state
      into v_guard_state
      from public.p9_assert_sales_contract_current_proposal_lineage_internal(
        v_contract.organization_id,
        v_contract.store_id,
        v_contract.id
      );

      -- Successful execution is the authority decision. 'legacy_not_guarded'
      -- is intentionally compatible; stale/invalid canonical lineage raises.
    exception
      when others then
        continue;
    end;

    select t.*
    into v_template
    from public.store_contract_templates t
    where t.organization_id = v_contract.organization_id
      and t.store_id = v_contract.store_id
      and t.status = 'active'
      and t.active_version_id is not null
    limit 1;

    if not found then
      continue;
    end if;

    select tv.*
    into v_template_version
    from public.store_contract_template_versions tv
    where tv.id = v_template.active_version_id
      and tv.template_id = v_template.id
      and tv.organization_id = v_contract.organization_id
      and tv.store_id = v_contract.store_id
      and tv.status = 'active';

    if not found then
      continue;
    end if;

    if not exists (
      select 1
      from public.store_contract_template_extracted_rules er
      where er.template_version_id = v_template_version.id
        and er.organization_id = v_contract.organization_id
        and er.store_id = v_contract.store_id
        and lower(btrim(coalesce(er.review_status, '')))
              in ('approved', 'edited')
        and nullif(btrim(er.value_text), '') is not null
    ) then
      continue;
    end if;

    v_candidate_found := true;
    exit;
  end loop;

  if not v_candidate_found then
    for i in 21..30 loop
      perform pg_temp.p9_9_2_skip(
        i,
        case i
          when 21 then 'canonical lineage-authority + active-template fixture available'
          when 22 then 'canonical RPC happy path'
          when 23 then 'version number and current pointer advance atomically'
          when 24 then 'storage identity is normalized'
          when 25 then 'same operation replays across volatile materialization/file attempt'
          when 26 then 'same operation with changed request conflicts'
          when 27 then 'different operation with equivalent canonical content deduplicates'
          when 28 then 'same content hash with different stable snapshot conflicts'
          when 29 then 'template/rule/fallback/store-file negative gates'
          when 30 then 'rollback-only canonical fixtures exist before rollback'
        end,
        'DEV currently has no contract satisfying lineage-authority + active-template + final-rules preconditions'
      );
    end loop;
    return;
  end if;

  perform pg_temp.p9_9_2_record(
    21,
    'canonical lineage-authority + active-template fixture available',
    'PASS',
    'contract=' || v_contract.id::text ||
    ' guard_state=' || coalesce(v_guard_state, '<null>') ||
    ' template=' || v_template.id::text ||
    ' template_version=' || v_template_version.id::text
  );

  select jsonb_agg(
           jsonb_build_object(
             'rule_id', er.id::text,
             'rule_key', er.rule_key,
             'rule_group', er.rule_group,
             'label', er.label,
             'value_text', btrim(er.value_text),
             'review_status', lower(btrim(er.review_status)),
             'sort_order', er.sort_order
           )
           order by
             coalesce(er.sort_order, 2147483647),
             er.id
         )
  into v_rules
  from public.store_contract_template_extracted_rules er
  where er.template_version_id = v_template_version.id
    and er.organization_id = v_contract.organization_id
    and er.store_id = v_contract.store_id
    and lower(btrim(coalesce(er.review_status, '')))
          in ('approved', 'edited')
    and nullif(btrim(er.value_text), '') is not null;

  v_old_current := v_contract.current_version_id;

  select
    count(*),
    coalesce(max(version_number), 0) + 1
  into
    v_before_count,
    v_expected_version
  from public.sales_contract_versions
  where contract_id = v_contract.id;

  v_filename_1 :=
    'p9-9-2-runner-' ||
    left(replace(v_file_1::text, '-', ''), 12) ||
    '.pdf';

  v_path_1 :=
    v_contract.organization_id::text || '/' ||
    v_contract.store_id::text || '/sales-contracts/' ||
    v_contract.id::text || '/runner/' ||
    v_filename_1;

  insert into public.store_files(
    id,
    organization_id,
    store_id,
    file_kind,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    uploaded_by
  )
  values(
    v_file_1,
    v_contract.organization_id,
    v_contract.store_id,
    'sales_contract_pdf',
    'zion-store-files',
    v_path_1,
    v_filename_1,
    'application/pdf',
    1024,
    'system'
  );

  v_snapshot :=
    jsonb_build_object(
      'schema', 'zion.sales_contract_snapshot.v2',
      'identity', jsonb_build_object(
        'contract_id', v_contract.id::text,
        'organization_id', v_contract.organization_id::text,
        'store_id', v_contract.store_id::text
      ),
      'lineage', jsonb_build_object(
        'quote_id', v_contract.quote_id::text,
        'quote_version_id', v_contract.quote_version_id::text,
        'commercial_opportunity_id',
          nullif(
            btrim(v_contract.metadata->>'commercial_opportunity_id'),
            ''
          ),
        'proposal_acceptance_event_id',
          nullif(
            btrim(v_contract.metadata->>'proposal_acceptance_event_id'),
            ''
          )
      ),
      'template_authority', jsonb_build_object(
        'template_id', v_template.id::text,
        'template_version_id', v_template_version.id::text,
        'template_version_number', v_template_version.version_number,
        'rules', v_rules
      ),
      'renderer_input', jsonb_build_object(
        'identity', jsonb_build_object(
          'contractId', v_contract.id::text,
          'organizationId', v_contract.organization_id::text,
          'storeId', v_contract.store_id::text,
          'quoteId', v_contract.quote_id::text,
          'quoteVersionId', v_contract.quote_version_id::text
        ),
        'templateAuthority', jsonb_build_object(
          'templateId', v_template.id::text,
          'templateVersionId', v_template_version.id::text,
          'templateVersionNumber', v_template_version.version_number,
          'rules', v_rules,
          'clauses', 'P9 9.2 rollback-only authorized template clauses'
        ),
        'createdAt', v_contract.created_at
      ),
      'content_fingerprint', v_content,
      'materialized_at', clock_timestamp()::text
    );

  select *
  into v_created
  from public.create_sales_contract_version_by_system(
    v_contract.organization_id,
    v_contract.store_id,
    v_contract.id,
    v_operation,
    v_request,
    v_content,
    v_file_1,
    ' zion-store-files ',
    ' ' || v_path_1 || ' ',
    ' ' || v_filename_1 || ' ',
    ' APPLICATION/PDF ',
    1024,
    v_pdf,
    v_snapshot
  );

  select count(*)
  into v_after_count
  from public.sales_contract_versions
  where contract_id = v_contract.id;

  perform pg_temp.p9_9_2_assert(
    22,
    'canonical RPC happy path',
    v_created.id is not null
    and v_created.replayed is false
    and v_after_count = v_before_count + 1,
    format(
      'version=%s before=%s after=%s',
      v_created.id,
      v_before_count,
      v_after_count
    )
  );

  perform pg_temp.p9_9_2_assert(
    23,
    'version number and current pointer advance atomically',
    v_created.version_number = v_expected_version
    and (
      select current_version_id
      from public.sales_contracts
      where id = v_contract.id
    ) = v_created.id,
    format(
      'number=%s expected=%s old_current=%s new_current=%s',
      v_created.version_number,
      v_expected_version,
      coalesce(v_old_current::text, '<null>'),
      v_created.id
    )
  );

  perform pg_temp.p9_9_2_assert(
    24,
    'storage identity is normalized',
    exists (
      select 1
      from public.sales_contract_versions v
      where v.id = v_created.id
        and v.storage_bucket = 'zion-store-files'
        and v.storage_path = v_path_1
        and v.original_filename = v_filename_1
        and v.mime_type = 'application/pdf'
        and v.pdf_sha256 = v_pdf
    ),
    'whitespace/case caller input normalized before persistence'
  );

  v_filename_2 :=
    'p9-9-2-runner-' ||
    left(replace(v_file_2::text, '-', ''), 12) ||
    '.pdf';

  v_path_2 :=
    v_contract.organization_id::text || '/' ||
    v_contract.store_id::text || '/sales-contracts/' ||
    v_contract.id::text || '/runner/' ||
    v_filename_2;

  insert into public.store_files(
    id,
    organization_id,
    store_id,
    file_kind,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    uploaded_by
  )
  values(
    v_file_2,
    v_contract.organization_id,
    v_contract.store_id,
    'sales_contract_pdf',
    'zion-store-files',
    v_path_2,
    v_filename_2,
    'application/pdf',
    1024,
    'system'
  );

  v_snapshot_replay :=
    jsonb_set(
      v_snapshot,
      '{materialized_at}',
      to_jsonb(clock_timestamp()::text),
      true
    );

  select *
  into v_replay
  from public.create_sales_contract_version_by_system(
    v_contract.organization_id,
    v_contract.store_id,
    v_contract.id,
    v_operation,
    v_request,
    v_content,
    v_file_2,
    'zion-store-files',
    v_path_2,
    v_filename_2,
    'application/pdf',
    1024,
    repeat('d', 64),
    v_snapshot_replay
  );

  perform pg_temp.p9_9_2_assert(
    25,
    'same operation replays across volatile materialization/file attempt',
    v_replay.id = v_created.id
    and v_replay.replayed is true
    and (
      select count(*)
      from public.sales_contract_versions
      where contract_id = v_contract.id
    ) = v_after_count,
    'same logical attempt returned original durable version'
  );

  begin
    perform *
    from public.create_sales_contract_version_by_system(
      v_contract.organization_id,
      v_contract.store_id,
      v_contract.id,
      v_operation,
      repeat('e', 64),
      v_content,
      v_file_2,
      'zion-store-files',
      v_path_2,
      v_filename_2,
      'application/pdf',
      1024,
      repeat('d', 64),
      v_snapshot_replay
    );

    perform pg_temp.p9_9_2_record(
      26,
      'same operation with changed request conflicts',
      'FAIL',
      'RPC unexpectedly accepted operation-key conflict'
    );
  exception
    when others then
      perform pg_temp.p9_9_2_assert(
        26,
        'same operation with changed request conflicts',
        sqlstate = '23505'
        and sqlerrm = 'P9_9_2_OPERATION_KEY_CONFLICT',
        sqlstate || ' ' || sqlerrm
      );
  end;

  select *
  into v_dedupe
  from public.create_sales_contract_version_by_system(
    v_contract.organization_id,
    v_contract.store_id,
    v_contract.id,
    v_operation || ':equivalent-content',
    repeat('f', 64),
    v_content,
    v_file_2,
    'zion-store-files',
    v_path_2,
    v_filename_2,
    'application/pdf',
    1024,
    repeat('d', 64),
    v_snapshot_replay
  );

  perform pg_temp.p9_9_2_assert(
    27,
    'different operation with equivalent canonical content deduplicates',
    v_dedupe.id = v_created.id
    and v_dedupe.replayed is true
    and (
      select count(*)
      from public.sales_contract_versions
      where contract_id = v_contract.id
    ) = v_after_count,
    'equivalent stable content reused original durable version'
  );

  v_snapshot_collision :=
    jsonb_set(
      v_snapshot_replay,
      '{renderer_input,templateAuthority,clauses}',
      to_jsonb('tampered clauses with same content fingerprint'::text),
      true
    );

  begin
    perform *
    from public.create_sales_contract_version_by_system(
      v_contract.organization_id,
      v_contract.store_id,
      v_contract.id,
      v_operation || ':collision',
      repeat('0', 64),
      v_content,
      v_file_2,
      'zion-store-files',
      v_path_2,
      v_filename_2,
      'application/pdf',
      1024,
      repeat('d', 64),
      v_snapshot_collision
    );

    perform pg_temp.p9_9_2_record(
      28,
      'same content hash with different stable snapshot conflicts',
      'FAIL',
      'RPC unexpectedly accepted content-fingerprint collision'
    );
  exception
    when others then
      perform pg_temp.p9_9_2_assert(
        28,
        'same content hash with different stable snapshot conflicts',
        sqlstate = '23505'
        and sqlerrm = 'P9_9_2_CONTENT_FINGERPRINT_CONFLICT',
        sqlstate || ' ' || sqlerrm
      );
  end;

  v_negative_ok := true;
  v_negative_details := '';

  -- Invalid template authority.
  v_snapshot_bad_template :=
    jsonb_set(
      jsonb_set(
        jsonb_set(
          v_snapshot_replay,
          '{template_authority,template_id}',
          to_jsonb(v_bad_template_id::text),
          true
        ),
        '{renderer_input,templateAuthority,templateId}',
        to_jsonb(v_bad_template_id::text),
        true
      ),
      '{content_fingerprint}',
      to_jsonb(repeat('1', 64)),
      true
    );

  begin
    perform *
    from public.create_sales_contract_version_by_system(
      v_contract.organization_id,
      v_contract.store_id,
      v_contract.id,
      v_operation || ':bad-template',
      repeat('2', 64),
      repeat('1', 64),
      v_file_2,
      'zion-store-files',
      v_path_2,
      v_filename_2,
      'application/pdf',
      1024,
      repeat('3', 64),
      v_snapshot_bad_template
    );

    v_negative_ok := false;
    v_negative_details :=
      v_negative_details || 'bad-template unexpectedly accepted; ';
  exception
    when others then
      if not (
        sqlstate = '23514'
        and sqlerrm = 'P9_9_2_TEMPLATE_AUTHORITY_INVALID'
      ) then
        v_negative_ok := false;
        v_negative_details :=
          v_negative_details ||
          'bad-template=' || sqlstate || ' ' || sqlerrm || '; ';
      end if;
  end;

  -- Tampered rule identity.
  v_snapshot_bad_rule :=
    jsonb_set(
      jsonb_set(
        jsonb_set(
          v_snapshot_replay,
          '{template_authority,rules,0,rule_key}',
          to_jsonb('tampered_rule_key'::text),
          true
        ),
        '{renderer_input,templateAuthority,rules,0,rule_key}',
        to_jsonb('tampered_rule_key'::text),
        true
      ),
      '{content_fingerprint}',
      to_jsonb(repeat('4', 64)),
      true
    );

  begin
    perform *
    from public.create_sales_contract_version_by_system(
      v_contract.organization_id,
      v_contract.store_id,
      v_contract.id,
      v_operation || ':bad-rule',
      repeat('5', 64),
      repeat('4', 64),
      v_file_2,
      'zion-store-files',
      v_path_2,
      v_filename_2,
      'application/pdf',
      1024,
      repeat('6', 64),
      v_snapshot_bad_rule
    );

    v_negative_ok := false;
    v_negative_details :=
      v_negative_details || 'bad-rule unexpectedly accepted; ';
  exception
    when others then
      if not (
        sqlstate = '23514'
        and sqlerrm = 'P9_9_2_TEMPLATE_RULES_INVALID'
      ) then
        v_negative_ok := false;
        v_negative_details :=
          v_negative_details ||
          'bad-rule=' || sqlstate || ' ' || sqlerrm || '; ';
      end if;
  end;

  -- Forbidden legacy fallback.
  v_snapshot_bad_clause :=
    jsonb_set(
      jsonb_set(
        v_snapshot_replay,
        '{renderer_input,templateAuthority,clauses}',
        to_jsonb('A definir pela loja.'::text),
        true
      ),
      '{content_fingerprint}',
      to_jsonb(repeat('7', 64)),
      true
    );

  begin
    perform *
    from public.create_sales_contract_version_by_system(
      v_contract.organization_id,
      v_contract.store_id,
      v_contract.id,
      v_operation || ':forbidden-fallback',
      repeat('8', 64),
      repeat('7', 64),
      v_file_2,
      'zion-store-files',
      v_path_2,
      v_filename_2,
      'application/pdf',
      1024,
      repeat('9', 64),
      v_snapshot_bad_clause
    );

    v_negative_ok := false;
    v_negative_details :=
      v_negative_details || 'forbidden-fallback unexpectedly accepted; ';
  exception
    when others then
      if not (
        sqlstate = '23514'
        and sqlerrm = 'P9_9_2_TEMPLATE_CLAUSES_INVALID'
      ) then
        v_negative_ok := false;
        v_negative_details :=
          v_negative_details ||
          'fallback=' || sqlstate || ' ' || sqlerrm || '; ';
      end if;
  end;

  -- Unknown/cross-scope file identity.
  v_snapshot_bad_file :=
    jsonb_set(
      v_snapshot_replay,
      '{content_fingerprint}',
      to_jsonb(repeat('d', 64)),
      true
    );

  begin
    perform *
    from public.create_sales_contract_version_by_system(
      v_contract.organization_id,
      v_contract.store_id,
      v_contract.id,
      v_operation || ':unknown-file',
      repeat('a', 64),
      repeat('d', 64),
      gen_random_uuid(),
      'zion-store-files',
      v_path_2,
      v_filename_2,
      'application/pdf',
      1024,
      repeat('e', 64),
      v_snapshot_bad_file
    );

    v_negative_ok := false;
    v_negative_details :=
      v_negative_details || 'unknown-file unexpectedly accepted; ';
  exception
    when others then
      if not (
        sqlstate = '23514'
        and sqlerrm = 'P9_9_2_STORE_FILE_SCOPE_INVALID'
      ) then
        v_negative_ok := false;
        v_negative_details :=
          v_negative_details ||
          'unknown-file=' || sqlstate || ' ' || sqlerrm || '; ';
      end if;
  end;

  perform pg_temp.p9_9_2_assert(
    29,
    'template/rule/fallback/store-file negative gates',
    v_negative_ok,
    case
      when v_negative_ok then
        'all four negative authorities rejected deterministically'
      else
        v_negative_details
    end
  );

  perform pg_temp.p9_9_2_assert(
    30,
    'rollback-only canonical fixtures exist before rollback',
    exists (
      select 1
      from public.sales_contract_versions
      where id = v_created.id
    )
    and exists (
      select 1
      from public.store_files
      where id in (v_file_1, v_file_2)
    ),
    'fixtures exist only inside current transaction; final ROLLBACK follows'
  );
end;
$canonical_runtime$;

-- ============================================================================
-- D. Results and fail gate.
-- ============================================================================

select
  r.n as scenario,
  r.name,
  r.status as result,
  r.details,
  s.pass_count,
  s.fail_count,
  s.error_count,
  s.skip_count,
  s.scenario_count,
  case
    when s.fail_count > 0 or s.error_count > 0 or s.scenario_count <> 30
      then 'P9_9_2_B1_REVIEW_REQUIRED'
    when s.skip_count > 0
      then 'P9_9_2_B1_PASS_WITH_FIXTURE_SKIPS'
    else 'P9_9_2_B1_REAL_SUT_PASS'
  end as overall_status,
  true as rollback_only
from pg_temp.p9_9_2_results r
cross join lateral (
  select
    count(*) filter (where status = 'PASS') as pass_count,
    count(*) filter (where status = 'FAIL') as fail_count,
    count(*) filter (where status = 'ERROR') as error_count,
    count(*) filter (where status = 'SKIP') as skip_count,
    count(*) as scenario_count
  from pg_temp.p9_9_2_results
) s
order by r.n;

do $assert_all$
declare
  v_fail bigint;
  v_error bigint;
  v_count bigint;
begin
  select
    count(*) filter (where status = 'FAIL'),
    count(*) filter (where status = 'ERROR'),
    count(*)
  into
    v_fail,
    v_error,
    v_count
  from pg_temp.p9_9_2_results;

  if v_fail <> 0
     or v_error <> 0
     or v_count <> 30 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'P9_9_2_B1_MANUAL_CHECKS_FAILED fail=%s error=%s count=%s',
        v_fail,
        v_error,
        v_count
      );
  end if;
end;
$assert_all$;

rollback;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';
set local search_path = pg_catalog, pg_temp, public, auth, extensions;

do $preconditions$
declare
  v_oid oid;
  v_owner name;
  v_security_definer boolean;
  v_acl text;
begin
  v_oid := to_regprocedure(
    'public.approve_sales_contract_by_user_atomic(uuid,uuid,uuid,uuid,uuid)'
  );
  if v_oid is null then raise exception 'approval RPC signature is missing'; end if;

  select proowner::regrole, prosecdef
    into v_owner, v_security_definer
    from pg_proc
   where oid = v_oid;
  if v_owner <> 'postgres' or not v_security_definer then
    raise exception 'approval RPC security/owner contract is invalid';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'approval RPC is executable by anon/authenticated';
  end if;
  if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'approval RPC is not executable by service_role';
  end if;
  select coalesce(string_agg(privilege_type, ',' order by privilege_type), '')
    into v_acl
    from pg_proc function_row
    cross join lateral aclexplode(coalesce(function_row.proacl, '{}'::aclitem[])) privilege_row
   where function_row.oid = v_oid
     and privilege_row.grantee = 0;
  if v_acl <> '' then raise exception 'public has approval RPC privileges: %', v_acl; end if;
  raise notice 'PASS signature, owner, security definer and ACL';
end
$preconditions$;

do $behavior$
declare
  v_org uuid;
  v_store uuid;
  v_contract uuid;
  v_version uuid;
  v_actor uuid;
  v_quote_id uuid;
  v_opportunity_id uuid;
  v_original_current_quote_id uuid;
  v_original_current_quote_version_id uuid;
  v_stale_error text;
  v_missing_storage_contract uuid;
  v_missing_storage_version uuid;
  v_result jsonb;
  v_original_approved_at timestamptz;
  v_original_approved_by uuid;
  v_contract_status text;
  v_version_status text;
  v_storage_bucket text;
  v_storage_path text;
  v_status text;

  v_customer uuid;
  v_lead uuid;
  v_conversation uuid;
  v_quote_version_id uuid;
  v_acceptance uuid;
  v_message public.messages%rowtype;
  v_guard record;
  v_now timestamptz;
  v_accepted_at timestamptz;
begin
  -- --------------------------------------------------------------------------
  -- Self-contained rollback-only fixture.
  --
  -- Do not depend on a real accepted proposal or canonical contract existing
  -- in the target database. Every row below is created inside this transaction
  -- and disappears in the final ROLLBACK.
  -- --------------------------------------------------------------------------

  v_org := gen_random_uuid();
  v_store := gen_random_uuid();
  v_customer := gen_random_uuid();
  v_lead := gen_random_uuid();
  v_conversation := gen_random_uuid();
  v_actor := gen_random_uuid();
  v_opportunity_id := gen_random_uuid();
  v_quote_id := gen_random_uuid();
  v_quote_version_id := gen_random_uuid();
  v_acceptance := gen_random_uuid();
  v_contract := gen_random_uuid();
  v_version := gen_random_uuid();

  v_now := pg_catalog.clock_timestamp();

  v_storage_bucket := 'zion-store-files';
  v_storage_path :=
    v_org::text || '/' ||
    v_store::text ||
    '/p9-9-3/' ||
    v_contract::text ||
    '/contract-v1.pdf';

  insert into auth.users(id)
  values(v_actor);

  insert into public.organizations(
    id,
    name,
    subscription_status
  )
  values(
    v_org,
    'P9 9.3 approval runner org ' ||
      pg_catalog.left(v_contract::text, 8),
    'active'
  );

  insert into public.stores(
    id,
    organization_id,
    name
  )
  values(
    v_store,
    v_org,
    'P9 9.3 approval runner store'
  );

  insert into public.customers(
    id,
    organization_id,
    display_name,
    normalized_name
  )
  values(
    v_customer,
    v_org,
    'P9 9.3 Runner Customer',
    'p9 9 3 runner customer'
  );

  insert into public.customer_store_links(
    organization_id,
    store_id,
    customer_id
  )
  values(
    v_org,
    v_store,
    v_customer
  );

  insert into public.memberships(
    organization_id,
    user_id,
    role,
    is_active
  )
  values(
    v_org,
    v_actor,
    'admin',
    true
  );

  insert into public.leads(
    id,
    organization_id,
    store_id,
    name,
    phone,
    state,
    created_at,
    updated_at
  )
  values(
    v_lead,
    v_org,
    v_store,
    'P9 9.3 Runner Lead',
    '55119' ||
      pg_catalog.translate(
        pg_catalog.left(
          pg_catalog.replace(v_contract::text, '-', ''),
          8
        ),
        'abcdef',
        '123456'
      ),
    'novo_lead',
    v_now,
    v_now
  );

  insert into public.conversations(
    id,
    organization_id,
    lead_id,
    status,
    is_human_active,
    created_at
  )
  values(
    v_conversation,
    v_org,
    v_lead,
    'open',
    false,
    v_now
  );

  insert into public.commercial_opportunities(
    id,
    organization_id,
    store_id,
    customer_id,
    origin_lead_id,
    primary_conversation_id,
    stage,
    lifecycle_cycle
  )
  values(
    v_opportunity_id,
    v_org,
    v_store,
    v_customer,
    v_lead,
    v_conversation,
    'orcamento',
    1
  );

  insert into public.sales_quotes(
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    conversation_id,
    lead_id,
    quote_number,
    title,
    status,
    customer_name,
    customer_phone,
    valid_until,
    subtotal_cents,
    discount_cents,
    total_cents,
    metadata
  )
  values(
    v_quote_id,
    v_org,
    v_store,
    v_opportunity_id,
    v_conversation,
    v_lead,
    'P993-Q-' ||
      pg_catalog.upper(
        pg_catalog.left(
          pg_catalog.replace(v_quote_id::text, '-', ''),
          12
        )
      ),
    'P9 9.3 approval runner quote',
    'sent',
    'P9 9.3 Runner Customer',
    '5511999999999',
    ((v_now at time zone 'UTC')::date + 30),
    100000,
    0,
    100000,
    pg_catalog.jsonb_build_object(
      'runner',
      'p9_9_3_contract_approval_atomic'
    )
  );

  insert into public.sales_quote_versions(
    id,
    quote_id,
    organization_id,
    store_id,
    version_number,
    status,
    quote_kind,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    generated_by,
    quote_snapshot,
    created_at,
    sent_at
  )
  values(
    v_quote_version_id,
    v_quote_id,
    v_org,
    v_store,
    1,
    'sent',
    null,
    'zion-store-files',
    v_org::text || '/' ||
      v_store::text ||
      '/p9-9-3/quote/' ||
      v_quote_id::text ||
      '/v1.pdf',
    'p9-9-3-quote.pdf',
    'application/pdf',
    1000,
    'system',
    pg_catalog.jsonb_build_object(
      'quote',
      pg_catalog.jsonb_build_object(
        'id',
        v_quote_id::text,
        'subtotalCents',
        100000,
        'discountCents',
        0,
        'totalCents',
        100000
      ),
      'items',
      pg_catalog.jsonb_build_array()
    ),
    v_now - interval '2 minutes',
    v_now - interval '1 minute'
  );

  update public.sales_quotes
     set current_version_id = v_quote_version_id
   where id = v_quote_id
     and organization_id = v_org
     and store_id = v_store;

  if not found then
    raise exception 'self-contained quote current version was not linked';
  end if;

  perform *
  from public.set_current_commercial_proposal_from_sent_quote_by_system(
    v_org,
    v_store,
    v_opportunity_id,
    v_quote_id,
    v_quote_version_id,
    'current_commercial_proposal:' ||
      v_opportunity_id::text ||
      ':' ||
      v_quote_id::text ||
      ':' ||
      v_quote_version_id::text,
    'p9_9_3_runner'
  );

  select *
    into v_message
  from public.insert_message(
    v_conversation,
    'user',
    'incoming',
    'text',
    'Aceito a proposta para o runner P9 9.3.',
    'p9_9_3_accept:' || v_contract::text,
    null,
    '{}'::jsonb
  );

  if v_message.id is null then
    raise exception 'self-contained acceptance message was not created';
  end if;

  v_accepted_at := pg_catalog.clock_timestamp();

  insert into public.commercial_proposal_acceptance_events(
    id,
    organization_id,
    store_id,
    commercial_opportunity_id,
    customer_id,
    lifecycle_cycle,
    quote_id,
    quote_version_id,
    source_message_id,
    signal_kind,
    customer_signal_at,
    confirmed_by_user_id,
    accepted_at
  )
  values(
    v_acceptance,
    v_org,
    v_store,
    v_opportunity_id,
    v_customer,
    1,
    v_quote_id,
    v_quote_version_id,
    v_message.id,
    'customer_accepted_quote',
    v_message.created_at,
    v_actor,
    v_accepted_at
  );

  insert into public.sales_contracts(
    id,
    organization_id,
    store_id,
    lead_id,
    conversation_id,
    quote_id,
    quote_version_id,
    current_version_id,
    contract_number,
    status,
    title,
    customer_name,
    customer_phone,
    currency,
    subtotal_cents,
    discount_cents,
    total_cents,
    payment_terms,
    delivery_terms,
    warranty_terms,
    contract_terms,
    valid_until,
    metadata
  )
  values(
    v_contract,
    v_org,
    v_store,
    v_lead,
    v_conversation,
    v_quote_id,
    v_quote_version_id,
    null,
    'P993-C-' ||
      pg_catalog.upper(
        pg_catalog.left(
          pg_catalog.replace(v_contract::text, '-', ''),
          16
        )
      ),
    'pending_review',
    'P9 9.3 canonical approval runner contract',
    'P9 9.3 Runner Customer',
    '5511999999999',
    'BRL',
    100000,
    0,
    100000,
    'Pix',
    null,
    null,
    null,
    ((v_now at time zone 'UTC')::date + 30),
    pg_catalog.jsonb_build_object(
      'source',
      'accepted_quote_version_snapshot',
      'commercial_opportunity_id',
      v_opportunity_id,
      'quote_version_id',
      v_quote_version_id,
      'proposal_acceptance_event_id',
      v_acceptance,
      'proposal_acceptance_source_message_id',
      v_message.id,
      'proposal_accepted_at',
      v_accepted_at,
      'created_via',
      'create_sales_contract_from_current_accepted_proposal_by_system',
      'runner',
      'p9_9_3_contract_approval_atomic'
    )
  );

  insert into public.sales_contract_versions(
    id,
    contract_id,
    organization_id,
    store_id,
    version_number,
    status,
    store_file_id,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    generated_by,
    contract_snapshot
  )
  values(
    v_version,
    v_contract,
    v_org,
    v_store,
    1,
    'generated',
    null,
    v_storage_bucket,
    v_storage_path,
    'p9-9-3-contract.pdf',
    'application/pdf',
    1000,
    'system',
    pg_catalog.jsonb_build_object(
      'runner',
      'p9_9_3_contract_approval_atomic',
      'contract_id',
      v_contract::text
    )
  );

  update public.sales_contracts
     set current_version_id = v_version
   where id = v_contract
     and organization_id = v_org
     and store_id = v_store;

  if not found then
    raise exception 'self-contained contract current version was not linked';
  end if;

  select *
    into v_guard
  from public.p9_assert_sales_contract_current_proposal_lineage_internal(
    v_org,
    v_store,
    v_contract
  );

  if not found
     or v_guard.guard_state is distinct from 'current'
     or v_guard.commercial_opportunity_id
          is distinct from v_opportunity_id
     or v_guard.quote_id
          is distinct from v_quote_id
     or v_guard.quote_version_id
          is distinct from v_quote_version_id
     or v_guard.acceptance_event_id
          is distinct from v_acceptance then
    raise exception
      'self-contained canonical contract lineage is not current';
  end if;

  raise notice
    'PASS self-contained current proposal + acceptance + canonical contract fixture';
  update public.sales_contracts
     set status = 'pending_review', approved_at = null, approved_by = null
   where id = v_contract and organization_id = v_org and store_id = v_store;
  update public.sales_contract_versions
     set status = 'generated', approved_at = null,
         storage_bucket = v_storage_bucket, storage_path = v_storage_path
   where id = v_version and contract_id = v_contract and organization_id = v_org and store_id = v_store;

  v_result := public.approve_sales_contract_by_user_atomic(v_org, v_store, v_contract, v_version, v_actor);
  if v_result ->> 'outcome' <> 'approved'
     or v_result ->> 'replayed' <> 'false'
     or v_result ->> 'reconciled' <> 'false'
     or v_result ->> 'contract_status' <> 'approved'
     or v_result ->> 'version_status' <> 'approved'
     or v_result ->> 'approved_by' <> v_actor::text then
    raise exception 'fresh approval returned invalid result: %', v_result;
  end if;
  select c.approved_at, c.approved_by, c.status, v.status
    into v_original_approved_at, v_original_approved_by, v_contract_status, v_version_status
    from public.sales_contracts c
    join public.sales_contract_versions v on v.id = c.current_version_id
   where c.id = v_contract and c.organization_id = v_org and c.store_id = v_store;
  if v_contract_status <> 'approved' or v_version_status <> 'approved'
     or v_original_approved_at is null or v_original_approved_by <> v_actor then
    raise exception 'fresh approval did not persist coherent audit';
  end if;
  raise notice 'PASS fresh pending_review/generated approval';

  v_result := public.approve_sales_contract_by_user_atomic(v_org, v_store, v_contract, v_version, v_actor);
  if v_result ->> 'outcome' <> 'already_applied'
     or v_result ->> 'replayed' <> 'true'
     or v_result ->> 'reconciled' <> 'false' then
    raise exception 'complete replay returned invalid result: %', v_result;
  end if;
  if (select approved_at from public.sales_contracts where id = v_contract) is distinct from v_original_approved_at
     or (select approved_by from public.sales_contracts where id = v_contract) is distinct from v_original_approved_by then
    raise exception 'complete replay overwrote contract audit';
  end if;
  raise notice 'PASS complete replay preserves original audit';

  update public.sales_contracts
     set status = 'approved', approved_at = v_original_approved_at, approved_by = v_original_approved_by
   where id = v_contract and organization_id = v_org and store_id = v_store;
  update public.sales_contract_versions
     set status = 'generated', approved_at = null
   where id = v_version and contract_id = v_contract and organization_id = v_org and store_id = v_store;
  v_result := public.approve_sales_contract_by_user_atomic(v_org, v_store, v_contract, v_version, v_actor);
  if v_result ->> 'outcome' <> 'reconciled_partial_state'
     or v_result ->> 'replayed' <> 'true'
     or v_result ->> 'reconciled' <> 'true' then
    raise exception 'partial reconciliation returned invalid result: %', v_result;
  end if;
  if (select approved_at from public.sales_contract_versions where id = v_version) is distinct from v_original_approved_at then
    raise exception 'partial reconciliation did not copy contract audit';
  end if;
  raise notice 'PASS approved contract plus generated version reconciliation';

  update public.sales_contracts
     set status = 'pending_review', approved_at = null, approved_by = null
   where id = v_contract and organization_id = v_org and store_id = v_store;
  update public.sales_contract_versions
     set status = 'approved', approved_at = v_original_approved_at
   where id = v_version and contract_id = v_contract and organization_id = v_org and store_id = v_store;
  begin
    perform public.approve_sales_contract_by_user_atomic(v_org, v_store, v_contract, v_version, v_actor);
    raise exception 'inverse partial state was accepted';
  exception when sqlstate '23514' then
    raise notice 'PASS pending contract plus approved version rejected';
  end;

  update public.sales_contract_versions
     set status = 'generated', approved_at = null
   where id = v_version and contract_id = v_contract and organization_id = v_org and store_id = v_store;

  begin
    perform public.approve_sales_contract_by_user_atomic(v_org, v_store, v_contract, gen_random_uuid(), v_actor);
    raise exception 'wrong expected version was accepted';
  exception when sqlstate '23514' then
    raise notice 'PASS wrong expected current version rejected';
  end;

  begin
    perform public.approve_sales_contract_by_user_atomic(
      gen_random_uuid(),
      v_store,
      v_contract,
      v_version,
      v_actor
    );

    raise exception using
      errcode = 'ZX001',
      message = 'wrong organization was accepted';
  exception
    when sqlstate 'P0001' then
      if SQLERRM is distinct from 'P9_CONTRACT_APPROVAL_CONTRACT_NOT_FOUND' then
        raise exception
          'wrong organization failed with unexpected error: %',
          SQLERRM;
      end if;

      raise notice 'PASS wrong organization rejected with exact authority error';
  end;

  v_missing_storage_contract := gen_random_uuid();
  v_missing_storage_version := gen_random_uuid();

  insert into public.sales_contracts (
    id,
    organization_id,
    store_id,
    lead_id,
    conversation_id,
    quote_id,
    quote_version_id,
    current_version_id,
    contract_number,
    status,
    title,
    customer_name,
    customer_phone,
    currency,
    subtotal_cents,
    discount_cents,
    total_cents,
    payment_terms,
    delivery_terms,
    warranty_terms,
    contract_terms,
    valid_until,
    metadata
  )
  select
    v_missing_storage_contract,
    v_org,
    v_store,
    source_contract.lead_id,
    source_contract.conversation_id,
    null,
    null,
    null,
    'P9-9-3-MISS-' ||
      pg_catalog.replace(v_missing_storage_contract::text, '-', ''),
    'pending_review',
    'P9 9.3 missing storage fixture',
    source_contract.customer_name,
    source_contract.customer_phone,
    source_contract.currency,
    source_contract.subtotal_cents,
    source_contract.discount_cents,
    source_contract.total_cents,
    source_contract.payment_terms,
    source_contract.delivery_terms,
    source_contract.warranty_terms,
    source_contract.contract_terms,
    source_contract.valid_until,
    pg_catalog.jsonb_build_object(
      'runner',
      'p9_9_3_missing_storage'
    )
  from public.sales_contracts source_contract
  where source_contract.id = v_contract
    and source_contract.organization_id = v_org
    and source_contract.store_id = v_store;

  if not found then
    raise exception 'missing-storage contract fixture was not created';
  end if;

  insert into public.sales_contract_versions (
    id,
    contract_id,
    organization_id,
    store_id,
    version_number,
    status,
    store_file_id,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    contract_snapshot
  )
  values (
    v_missing_storage_version,
    v_missing_storage_contract,
    v_org,
    v_store,
    1,
    'generated',
    null,
    '',
    'p9-9-3/missing-storage.pdf',
    'p9-9-3-missing-storage.pdf',
    'application/pdf',
    1,
    pg_catalog.jsonb_build_object(
      'runner',
      'p9_9_3_missing_storage'
    )
  );

  update public.sales_contracts
     set current_version_id = v_missing_storage_version
   where id = v_missing_storage_contract
     and organization_id = v_org
     and store_id = v_store;

  if not found then
    raise exception 'missing-storage current-version fixture was not linked';
  end if;

  begin
    perform public.approve_sales_contract_by_user_atomic(
      v_org,
      v_store,
      v_missing_storage_contract,
      v_missing_storage_version,
      v_actor
    );

    raise exception using
      errcode = 'ZX002',
      message = 'missing storage metadata was accepted';
  exception
    when sqlstate '23514' then
      if SQLERRM is distinct from 'P9_CONTRACT_APPROVAL_PDF_STORAGE_MISSING' then
        raise exception
          'missing storage failed with unexpected error: %',
          SQLERRM;
      end if;

      raise notice 'PASS missing PDF storage rejected by exact authority gate';
  end;

  if (
    select contract_row.status
      from public.sales_contracts contract_row
     where contract_row.id = v_missing_storage_contract
       and contract_row.organization_id = v_org
       and contract_row.store_id = v_store
  ) is distinct from 'pending_review' then
    raise exception 'missing-storage rejection mutated contract state';
  end if;

  foreach v_status in array array['cancelled', 'completed', 'sent_to_customer'] loop
    update public.sales_contracts
       set status = v_status, approved_at = null, approved_by = null
     where id = v_contract and organization_id = v_org and store_id = v_store;
    begin
      perform public.approve_sales_contract_by_user_atomic(v_org, v_store, v_contract, v_version, v_actor);
      raise exception 'blocked contract status % was accepted', v_status;
    exception when sqlstate '23514' then
      raise notice 'PASS blocked contract status % rejected', v_status;
    end;
  end loop;
  update public.sales_contracts
     set status = 'pending_review', approved_at = null, approved_by = null
   where id = v_contract and organization_id = v_org and store_id = v_store;

  foreach v_status in array array['superseded', 'failed', 'sent'] loop
    update public.sales_contract_versions
       set status = v_status, approved_at = null
     where id = v_version and contract_id = v_contract and organization_id = v_org and store_id = v_store;
    begin
      perform public.approve_sales_contract_by_user_atomic(v_org, v_store, v_contract, v_version, v_actor);
      raise exception 'blocked version status % was accepted', v_status;
    exception when sqlstate '23514' then
      raise notice 'PASS blocked version status % rejected', v_status;
    end;
  end loop;
  update public.sales_contract_versions
     set status = 'generated', approved_at = null
   where id = v_version and contract_id = v_contract and organization_id = v_org and store_id = v_store;

  select opportunity_row.current_quote_id,
         opportunity_row.current_quote_version_id
    into v_original_current_quote_id,
         v_original_current_quote_version_id
    from public.commercial_opportunities opportunity_row
   where opportunity_row.id = v_opportunity_id
     and opportunity_row.organization_id = v_org
     and opportunity_row.store_id = v_store
   for update;

  if not found
     or v_original_current_quote_id is null
     or v_original_current_quote_version_id is null then
    raise exception 'current commercial proposal pointers are unavailable for stale-lineage fixture';
  end if;

  update public.commercial_opportunities
     set current_quote_id = null,
         current_quote_version_id = null
   where id = v_opportunity_id
     and organization_id = v_org
     and store_id = v_store;

  if not found then
    raise exception 'stale-lineage fixture did not update the commercial opportunity';
  end if;

  if exists (
    select 1
      from public.commercial_opportunities opportunity_row
     where opportunity_row.id = v_opportunity_id
       and opportunity_row.organization_id = v_org
       and opportunity_row.store_id = v_store
       and (
         opportunity_row.current_quote_id is not null
         or opportunity_row.current_quote_version_id is not null
       )
  ) then
    raise exception 'stale-lineage fixture did not clear both current proposal pointers';
  end if;

  v_stale_error := null;

  begin
    perform public.approve_sales_contract_by_user_atomic(
      v_org,
      v_store,
      v_contract,
      v_version,
      v_actor
    );

    raise exception 'stale lineage was accepted';
  exception
    when sqlstate 'P0001' then
      v_stale_error := SQLERRM;

      if v_stale_error is distinct from 'ZION_CONTRACT_DOWNSTREAM_PROPOSAL_STALE' then
        raise exception
          'stale lineage failed with unexpected error: %',
          v_stale_error;
      end if;
  end;

  if (
    select contract_row.status
      from public.sales_contracts contract_row
     where contract_row.id = v_contract
       and contract_row.organization_id = v_org
       and contract_row.store_id = v_store
  ) is distinct from 'pending_review' then
    raise exception 'stale lineage rejection mutated the contract approval state';
  end if;

  update public.commercial_opportunities
     set current_quote_id = v_original_current_quote_id,
         current_quote_version_id = v_original_current_quote_version_id
   where id = v_opportunity_id
     and organization_id = v_org
     and store_id = v_store;

  if not found then
    raise exception 'failed to restore current commercial proposal pointers after stale-lineage test';
  end if;

  if exists (
    select 1
      from public.commercial_opportunities opportunity_row
     where opportunity_row.id = v_opportunity_id
       and opportunity_row.organization_id = v_org
       and opportunity_row.store_id = v_store
       and (
         opportunity_row.current_quote_id
           is distinct from v_original_current_quote_id
         or opportunity_row.current_quote_version_id
           is distinct from v_original_current_quote_version_id
       )
  ) then
    raise exception 'current commercial proposal pointers were not restored after stale-lineage test';
  end if;

  raise notice 'PASS stale lineage rejected specifically by canonical proposal-stale guard';

  update public.sales_contracts
     set status = 'pending_review', approved_at = null, approved_by = null
   where id = v_contract and organization_id = v_org and store_id = v_store;
  update public.sales_contract_versions
     set status = 'generated', approved_at = null
   where id = v_version and contract_id = v_contract and organization_id = v_org and store_id = v_store;

  create or replace function pg_temp.p9_9_3_fail_version_update()
  returns trigger
  language plpgsql
  as $trigger$
  begin
    raise exception using errcode = 'P0001', message = 'P9_9_3_RUNNER_SECOND_UPDATE_FAILURE';
  end
  $trigger$;
  create trigger p9_9_3_runner_fail_version_update
  before update of status, approved_at on public.sales_contract_versions
  for each row execute function pg_temp.p9_9_3_fail_version_update();
  begin
    perform public.approve_sales_contract_by_user_atomic(
      v_org,
      v_store,
      v_contract,
      v_version,
      v_actor
    );

    raise exception using
      errcode = 'ZX003',
      message = 'forced second update failure was not raised';
  exception
    when sqlstate 'P0001' then
      if SQLERRM is distinct from 'P9_9_3_RUNNER_SECOND_UPDATE_FAILURE' then
        raise exception
          'atomic rollback failed with unexpected error: %',
          SQLERRM;
      end if;
  end;
  drop trigger p9_9_3_runner_fail_version_update on public.sales_contract_versions;
  if (select status from public.sales_contracts where id = v_contract) <> 'pending_review' then
    raise exception 'atomic rollback left contract approved after second update failure';
  end if;
  raise notice 'PASS transaction rollback prevents partial contract approval';
end
$behavior$;

rollback;

do $postconditions$
declare
  v_trigger_count integer;
begin
  select count(*) into v_trigger_count
    from pg_trigger
   where tgname = 'p9_9_3_runner_fail_version_update';
  if v_trigger_count <> 0 then raise exception 'runner trigger survived rollback'; end if;
  raise notice 'PASS rollback leaves no runner trigger or persistent fixture mutation';
end
$postconditions$;
